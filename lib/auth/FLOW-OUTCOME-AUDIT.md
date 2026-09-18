# Student Auth flow-outcome audit — 2026-09-16

Follow-up: the controlled hosted signup responses and browser outcomes have now been
observed. See [Hosted outcome verification](HOSTED-OUTCOME-VERIFICATION.md) for that
evidence and the current delivery/security-test status. Hosted limitations below describe
the initial audit before controlled recipients were supplied.

## Evidence and scope

Inspected all nine student POST handlers, session GET, all student entry pages and account,
all Auth form components, shared submit/navigation synchronization, request validation,
provider gateways, cookie transfer, recovery grants, and all existing student Auth tests.
No git commands were executed. No dependencies, migrations, schema, policies, admin Auth,
password requirements, rollout rules, rate-limit policies, or cookie attributes were changed.
Temporary local provider test users were created and removed; hosted users were not modified.

**Hosted observation:** a read-only request to the configured hosted project's
`/auth/v1/settings` returned HTTP 200 with `mailer_autoconfirm:false`,
`phone_autoconfirm:false`, `disable_signup:false`, `external.email:true`,
`external.phone:false`. Secrets and project identifiers were not logged.

**Not observed:** the exact hosted signup response from the reported incident, signup
responses for controlled hosted new/unconfirmed/confirmed recipients, and their SMTP/inbox
records. Controlled recipient addresses/inbox access were requested but not supplied.
Do not substitute the local results or upstream source for those missing hosted observations.

**Local provider observations:** using the existing local Supabase stack and mail catcher:

| Case | SDK result | Email observation |
| --- | --- | --- |
| New signup | `error:null`, `user` present, `session:null`, one identity | Confirmation OTP received and verified |
| Repeat unconfirmed signup | `error:null`, same real user ID, `session:null`, one identity | Confirmation flow remained usable |
| Repeat confirmed signup | `error.code:user_already_exists`, `user:null`, `session:null` | No additional message appeared |
| Recovery OTP with `type:signup` | `otp_expired`, no session | Code was not consumed |
| Same recovery OTP with `type:email` | `error:null`, session present | Confirmed the cross-flow defect |

Local phone confirmation is disabled; hosted phone autoconfirm is false. Consequently,
the local confirmed-account error is **not** the expected hosted fake-user shape.
The disposable local account was deleted after the checks.

## Root cause and expected hosted provider response

Before this change, register destructured only `error` from `signUp`. The shared email
helper suppressed recipient-dependent errors and provider throttling. Register returned
HTTP 200 with the neutral `AUTH_MESSAGES.email` for either a successful provider envelope
or a suppressed error. RegisterForm treated any truthy submit result as proof of delivery,
mounted ConfirmEmailForm, and that form asserted that a code had been sent.

Thus the application defect is confirmed regardless of whether this particular incident
returned an obfuscated user or `user_already_exists`: both were accepted identically and
both automatically opened code entry. The server's neutral acknowledgment was reasonable
for enumeration protection; the client assigned it a stronger meaning it did not carry.

The installed auth-js 2.116.0 adapter maps a returned user body to
`{data:{user,session:null},error:null}`. Under the observed hosted settings, upstream
GoTrue's confirmed-account branch returns an obfuscated user: randomized ID, empty
`identities`, cleared confirmation fields, and a synthetic `confirmation_sent_at`.
That branch returns before confirmation sending. A timestamp in this object is therefore
not proof of email issuance. For new/unconfirmed users, the normal branch sends confirmation
subject to rate limits/provider errors and returns a real user with no session.

These are source-backed expectations, not a captured hosted incident. See
[Supabase signup documentation](https://supabase.com/docs/reference/javascript/auth-signup)
and [GoTrue signup implementation, v2.192.0](https://github.com/supabase/auth/blob/v2.192.0/internal/api/signup.go#L178-L355).
The hosted service version and incident delivery logs were not available. The answer to
“was a code actually issued in that hosted attempt?” remains **unverified**; the
obfuscated confirmed-account branch itself issues none.

## Findings and fixes

| Severity | Files and original behavior | Resolution |
| --- | --- | --- |
| High | `app/api/auth/confirm-email/route.ts:23-24`: broad `email` verification accepted recovery OTPs, creating a normal student session instead of recovery-only authority | Use explicit `signup` verification; recovery continues using `recovery`. Real local reproduction confirmed this defect. |
| Medium | `app/register/RegisterForm.tsx:26-34` and the analogous `EmailForm`, `ConfirmEmailForm`, `RecoveryFlow` transitions: acknowledgment or suppressed throttle was presented as delivered mail | Neutral receipt for initiation, explicit recipient action to open code entry, conditional copy for resends; no automatic delivery claim |
| Medium | `components/auth/useAuthSubmit.ts:28-47`: any HTTP 2xx object, including `{}` or `{error:...}`, authorized downstream navigation and session-change broadcasts | Strict endpoint-specific success schemas, before returning results or broadcasting |
| Medium | `app/api/auth/login/route.ts:39-47`, `app/api/auth/confirm-email/route.ts:29-38`: presence of session/error absence was insufficient to validate identity or transfer | Validate matching confirmed user, nonempty tokens and successful matching transfer; discard cookie-bearing success response on failure |
| Medium | `app/api/auth/confirm-email/route.ts:29-40`: a consumed successful OTP followed by transfer failure left the user retrying a code that could no longer work | HTTP 503 with “Your email is confirmed. Sign in to continue.” plus a sign-in link; no success redirect or cookie publication |
| Medium | `app/account/page.tsx:18-25`: lookup infrastructure failure became a sign-in redirect | Render generic unavailable state; redirect only for missing student identity |
| Medium | `app/api/auth/logout/route.ts:15-20`: discarded claims lookup error | Stop with HTTP 503 instead of treating failed lookup as successful logout |
| Medium | `app/api/auth/session/route.ts:12-18`, `lib/auth/student-state.ts:8-13`: malformed success-shaped identity could become signed-out state | Reject malformed identity/claims; only explicit absent identity means signed out |
| Medium | `lib/auth/errors.ts:29-35`: signup provider password-policy rejection appeared as an internal outage | Known `weak_password` maps to safe 400 password guidance; policy itself unchanged |
| Medium | `lib/auth/errors.ts:12-14`: known `user_banned` returned 503 instead of ordinary credential/code rejection | Map to the same outward 400 as invalid credentials/OTP, avoiding a distinct banned-account classification |
| Medium (2026-09-17, hosted) | `lib/auth/errors.ts` `classifyEmailInitiation`: recovery initiation mapped the provider's per-recipient cooldown to 429 while a nonexistent address received the neutral 200, so two requests within ~30 s revealed account existence | Cooldown shares the neutral acknowledgment for every initiation; recipient-independent limits (`over_request_rate_limit`, project send quota, generic 429) and send/provider failures keep their 429/503. See [Hosted outcome verification](HOSTED-OUTCOME-VERIFICATION.md), 2026-09-17 |

The broad email token behavior is visible in
[GoTrue verify implementation](https://github.com/supabase/auth/blob/v2.192.0/internal/api/verify.go#L683-L700).
It was independently reproduced against the local provider. This correction enforces the
existing separation requirement; it does not change the recovery-grant architecture.

## Chosen behavior and alternatives

**Superseded 2026-09-16 (product decision):** the intermediate `EmailRequestReceipt` screen
described below was removed. Registration, resend and unconfirmed login now continue directly
to the compact confirmation screen on any HTTP 200; recovery continues directly to the recovery
code screen. Enumeration protection was never carried by that screen: the server returns the
identical body for new, unconfirmed, confirmed, already-exists, not-found and provider-throttle
outcomes, so the client cannot branch on account state either way. Genuine failures (400 weak
password/invalid input, 429 application limit, 503 infrastructure) still keep the user on the
originating form with feedback. The confirmation screen makes no delivery claim
("Enter the code you received at …") and only the verification endpoint judges a code.


All normal new/unconfirmed/confirmed registration outcomes present the **same neutral
receipt**, never an automatic code screen or “account created” claim. The receipt offers
“I have received a code”, “Change email”, sign-in, and recovery. The first action voluntarily
opens a verifier for a received code; it is not a server claim that a code exists, that the
account is registered, or that the recipient is authenticated. Only OTP verification can
establish identity or grant authority. Entering a code remains possible without persistent
browser state, URL tokens, or email links.

This is the least invasive change: keep the existing neutral outward response, stop assigning
it delivery semantics, and let a recipient choose to supply a code. An HTTP response cannot
prove final mailbox delivery. We do not expose `identities.length`, fake IDs, confirmation
flags, or account existence. The provider's per-recipient cooldown remains a neutral
acknowledgment because it is emitted only for an existing recipient (hosted evidence,
2026-09-17: a nonexistent address receives a silent 200 instead); recipient-independent
provider limits (`over_request_rate_limit`, the project-wide send quota, generic 429) and
application rate-limit rejection stay an explicit 429. Infrastructure and unrecognized
failures remain 503, not acknowledgments.

Rejected alternatives:

- Returning “Email already registered”, or branching the visible response on empty identities,
  creates an existence oracle and would require an explicit policy change.
- Sending login/recovery OTPs during signup or falling back to another Auth flow changes
  authentication semantics and mixes flows.
- Disabling enumeration protection, enabling autoconfirm, introducing preflight account
  lookups, or redesigning verification delivery is unnecessary for this fix.

Login's explicit unconfirmed state is supported by a password-authentication result, not
an email lookup. An accepted resend acknowledgment does not establish delivery. **Updated
2026-09-16 (classification refactor):** the earlier `accepted`/`limited`/`failed` resend
result type was removed. An unconfirmed login advances to Confirm email only when its
confirmation resend was accepted or rejected by the per-recipient cooldown (the prior code
stays usable); an application limit, a recipient-independent provider limit or a send
failure stays on Login with the corresponding `limited`/`unavailable` copy. Supabase's
source checks password validity before returning `email_not_confirmed`:
[password grant implementation](https://github.com/supabase/auth/blob/v2.192.0/internal/api/token.go#L164-L170).

Enumeration protection here means no new outward account-existence distinction across
recipient-dependent initiation outcomes. It is not a claim of constant-time behavior or
an assessment of direct access to Supabase's public API. Valid password/OTP holders can
necessarily learn about their own authenticated identity.

## Transition regression matrix

Message keys below refer to exact copy in `constants.ts`. “Receipt” is a neutral request
acknowledgment, not delivery/confirmation. “Stay” includes showing a safe error.
Except for explicit login/confirmation success, no row creates a student session.
“Retry” always remains subject to the unchanged application and provider limits.

### Register and confirmation requests

| Server/provider condition | HTTP/result | UI | Signed in | Email/code expectation | Outward message | Existence inference | Retry/resend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| New signup, real user/no session | 200 receipt | Receipt; no auto code entry | No | Provider normally issues confirmation; delivery unverified | `email` | Same as existing | Yes |
| Existing unconfirmed signup | 200 receipt | Same receipt | No | May send confirmation subject to cooldown; password not assumed replaced | `email` | Same as new/confirmed | Yes |
| Existing confirmed, obfuscated user | 200 receipt | Same receipt | No | No confirmation issued by fake-user branch | `email` | Same as new/unconfirmed | Yes; sign-in/recovery offered |
| Existing confirmed, explicit already-exists error | 200 receipt | Same receipt | No | None | `email` | Same as new/unconfirmed | Same |
| Invalid email, short/long password, extra fields | 400 | Stay on form | No | None; no provider call | `invalid` (client validation may be more specific) | Input only | Correct input |
| Provider weak password | 400 | Stay | No | None | `signupPassword` | Input policy; not existence | Stronger password |
| Application account/origin limit | 429 | Stay | No | No provider call | `limited` | Attempt history, not account existence | After limit |
| Provider recipient-dependent rate limit | 200 receipt | Neutral receipt | No | No new mail promised | `email` | Suppressed | Later |
| Provider rejection/configuration/internal/transport failure | 503 | Stay | No | Unknown/none; never asserted | `unavailable` | No account-specific text | Retry later |
| Malformed provider success/missing user | 503 | Stay | No | Unknown | `unavailable` | No account-specific text | Retry/support |
| Unexpected auto-confirmed signup session | 503 | Stay, no session transfer | No browser session | Configuration drift; no OTP assumption | `unavailable` | No account-specific text | Configuration review |
| Recipient clicks “I have received a code” | Local action | Open code verifier for in-memory email | No | Recipient supplies code; server has not verified it | Conditional instructions | No server account disclosure | Can return/change email |
| Resend: eligible/unconfirmed, confirmed, absent, known recipient rejection | 200 receipt | Initial receipt or stay in current verifier | No | May send only for eligible recipient | `email` | Identical outward body | Yes |
| Resend: provider recipient throttle | 200 receipt | Same receipt/stay | No | No new mail promised | `email` | Suppressed | Later |
| Resend: application throttle / infrastructure failure | 429 / 503 | Stay, no delivery claim | No | None/unknown | `limited` / `unavailable` | No recipient details | Later |
| Change confirmation email | Local reset | Original form, password/code cleared | No | None | None | None | New request |

### Confirmation and login

| Server/provider condition | HTTP/result | UI | Signed in | Email/code expectation | Outward message | Existence inference | Retry/resend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Correct signup OTP + matching session + successful transfer | 200 `next` | Validated destination | Yes, HttpOnly | Consumes code, no new email | Destination | Valid-code holder only | Login/logout thereafter |
| Wrong / expired / consumed signup OTP | 400 | Stay | No | No new email | `code` | Generic invalid/expired | Retry or request; confirmed users can sign in |
| Recovery OTP submitted to confirmation endpoint | 400 | Stay | No | Recovery token not accepted/consumed as signup token | `code` | Generic | Use recovery flow |
| Provider OTP disabled / user banned | 400 | Stay | No | None | `code` | Same invalid-code response | Appropriate retry/recovery |
| OTP application/provider rate limit | 429 | Stay | No | None | `limited` | No account detail | Later |
| OTP internal/transport failure | 503 | Stay | No | Consumption may be uncertain | `unavailable` | No account detail | Retry/resend/sign in |
| OTP succeeds but transfer returns error/null/mismatched identity | 503 | Stay with sign-in guidance | No published browser session | OTP consumed; account confirmed | `confirmationSignIn` | Verified OTP holder only | Sign in, not repeat consumed code |
| Invalid/mismatched/unconfirmed provider session | 503 | Stay | No published session | Unknown | `unavailable` | No account detail | Retry/support |
| Valid confirmed login + matching session transfer | 200 `next` | Validated destination | Yes, HttpOnly | No email | Destination | Correct credentials only | Logout |
| Wrong password / unknown email / banned user | 400 | Stay, credentials retained | No | No resend | `credentials` | Identical response | Retry/recovery |
| Correct unconfirmed login, resend accepted | 200 confirmation-required | Confirm email; password cleared | No | Provider accepts resend; no delivery promise | Code screen copy | Password-authenticated condition | Recipient can enter code/resend |
| Correct unconfirmed login, resend in recipient cooldown | 200 confirmation-required | Confirm email; password cleared | No | No new code; prior code remains usable (hosted-verified) | Code screen copy | Password-authenticated condition | Use received code, or resend after cooldown |
| Correct unconfirmed login, application resend limit / recipient-independent provider limit | 429 | Stay on Login | No | No fresh code promised | `limited` | Password-authenticated condition | Later |
| Correct unconfirmed login, resend delivery/provider failure | 503 | Stay on Login | No | No fresh code promised | `unavailable` | Password-authenticated condition | Later, or use received code |
| Login application/provider rate limit | 429 | Stay | No | None | `limited` | No account detail | Later |
| Login provider/internal/transport failure or missing session | 503 | Stay | No published session | None | `unavailable` | No account detail | Retry |
| Login transfer fails/missing/mismatched result | 503 | Stay | No published session | None | `unavailable` | No account detail | Retry |

### Recovery

| Server/provider condition | HTTP/result | UI | Signed in | Email/code expectation | Outward message | Existence inference | Retry/resend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Recovery request accepted (eligible recipient) | 200 | Recovery code screen | No | Provider sends; delivery not claimed (conditional copy) | `recovery` | Identical to the two rows below | Yes |
| Nonexistent recipient (provider silent no-op, `{}`) | 200 | Recovery code screen | No | None; not claimed | `recovery` | Identical to accepted | Yes |
| Existing recipient inside provider cooldown (~30 s hosted, `over_email_send_rate_limit` "For security purposes…") | 200 | Recovery code screen | No | No new code; a prior code may be consumed, which only verification decides | `recovery` | Identical to accepted (normalized 2026-09-17 after a hosted oracle) | Resend after cooldown |
| Application rate limit | 429 | Stay on request screen | No | None; no provider call | `limited` | Attempt history only, not existence | After limit |
| Provider-wide request limit / send quota (pre-lookup, recipient-independent) | 429 | Stay | No | None | `limited` | Applies to every address alike | Later |
| Delivery/provider failure (SMTP send error, email disabled) | 503 | Stay | No | None; never asserted | `unavailable` | Send errors only occur for existing recipients, so an SMTP outage is a residual outage-bounded channel; steady-state neutral | Retry later |
| Malformed success envelope | 503 | Stay | No | Unknown | `unavailable` | No account detail | Retry/support |
| Unexpected provider failure / transport exception | 503 | Stay | No | Unknown | `unavailable` | No account detail | Retry |
| Application limit / invalid request / internal failure | 429 / 400 / 503 | Stay | No | None/unknown | `limited` / `invalid` / `unavailable` | No recipient detail | Correct/retry later |
| Recipient chooses code entry | Local action | Recovery verifier | No | Supply received recovery OTP | Conditional instructions | None | Verify or change email |
| Wrong / expired / consumed recovery OTP | 400 | Stay at code | No | No grant | `recoveryCode` | Generic | Retry/resend |
| Signup OTP submitted to recovery | Provider rejection, 400 | Stay at code | No | No grant | `recoveryCode` | Generic | Use correct flow |
| Verification rate limit | 429 | Stay at code | No | No grant | `limited` | No account detail | Later |
| Verification provider/store failure before successful verification | 503 | Stay; no password screen | No | No grant published | `unavailable` | No account detail | Retry/resend |
| Verified recovery OTP + matching identity + temporary revocation + grant write | 200 `verified:true` | Password fields | No | Code consumed; opaque HttpOnly grant issued | Password form | Valid OTP holder only | One password attempt |
| OTP accepted but session/identity missing or invalid | 503 + restart | Return to request | No | No grant; code may be consumed | `unavailable`, restart guidance | No new recipient detail | Request new code |
| Temporary-session revocation fails | 503 + restart | Return to request | No | No grant | `unavailable`, restart guidance | Valid OTP holder only | New code |
| Grant issuance fails | 503 + restart | Return to request | No | No grant cookie published | `unavailable`, restart guidance | Valid OTP holder only | New code |
| Valid grant + password replacement transaction succeeds | 200 reset destination | Sign-in with reset notice | No | Consumed grant; global refresh-session revocation | `resetSuccess` | Authorized grant holder | Login with new password |
| Missing / expired / replayed / wrong-email / tampered grant | 400 + restart | Request stage | No | No password change | `recoveryRestart` | No account detail | New code |
| Invalid password before grant consumption | 400 | Stay at password | No | Grant not consumed | `invalid` or field validation | Input only | Correct password |
| Same/weak password provider rejection after grant consumption | 400 + restart | Request stage | No | Grant consumed; no restored authority | `samePassword` / `weakPassword` | Authorized grant holder | New code |
| Provider rate limit after grant consumption | 429 + restart | Request stage | No | Grant consumed | `limited` + restart | Authorized grant holder | Later/new code |
| Store/update/revocation transaction failure after consumption begins | 503 + restart | Request stage | No | Grant never restored; update may be uncertain | `unavailable` + restart | No raw details | New code |
| Recovery resend acknowledged | 200 receipt | Stay at code; neutral message | No | Prior grant discarded; no delivery promise | `recovery` | Same eligible/absent response | Yes |
| Change email: grant cancellation succeeds | 200 `success:true` | Clear inputs, request stage | No | Grant discarded, cookie cleared | None | None | New request |
| Change email: cancellation fails | 503 | Stay; do not pretend cancellation | No new session | Grant state uncertain | `unavailable` | No details | Retry |
| Direct reset/confirmation page visit without in-memory context | Page guidance | Entry links, no authorized password form | No | None; GET verifies nothing | Start from relevant entry flow | None | Start flow |

### Session, shared boundaries and logout

| Server condition | HTTP/result | UI | Session effect | Email/code | Outward message | Existence inference | Retry |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Session lookup validates subject | 200 enabled/signedIn true | Account/logout | Existing session; refresh cookies preserved | None | Navigation | Cookie holder only | Recheck |
| Explicit no claims/user | 200 enabled/signedIn false; account redirects | Sign-in/register | Signed out | None | Navigation | None | Login |
| Rollout disabled | GET 200 enabled false; POST 503 | Disabled presentation | No identity lookup or new authority | None | `comingSoon` | None | When enabled |
| Session lookup throws/returns error/malformed claims | 503 | Preserve last known nav/unknown; account shows error | No invented sign-out | None | `unavailable` | No account detail | Recheck |
| Existing student attempts identity entry | 409 existing-session + account destination; page redirect | Account | Existing identity retained | No gateway/rate-limit work | Account | Cookie holder only | Log out first |
| Identity guard lookup failure/malformed identity | 503 / error page | Stay/error | No invented signed-out authorization | None | `unavailable` | None | Retry |
| Logout: grant discard, claims lookup and local signOut succeed | 200 `success:true` | Replace current location with `/login`; notify other tabs | Local student session removed; other devices preserved | None | Signed-out navigation | Cookie holder only | Login |
| Logout: grant store / lookup / provider failure | 503 | Stay; no success broadcast/navigation | Outcome not asserted; cookie-bearing success withheld | None | `unavailable` | No account detail | Retry |
| Cross-tab identity notification/bfcache restoration | Recheck/reload | Discard ephemeral flow | Server remains authoritative | None | Current state | No secrets in event | Automatic |
| Invalid JSON/body/content type/origin/oversize | 400 / 415 / 403 / 413 | Stay | None; no provider work | None | Safe generic/input copy | None | Correct request |
| Successful HTTP with empty/wrong/contradictory payload | Client rejects | Stay; no navigation/broadcast | No client inference of session | None | `unavailable` | None | Retry |
| Network/non-JSON/non-2xx response | Client rejects | Stay; known recovery restart honored | No client inference of session | Unknown after transport loss | Whitelisted error/generic | No provider text | Retry as flow allows |

## Test audit and coverage

Previously the suite supplied `{}` as a successful registration result and explicitly
expected it to open confirmation. Route tests asserted neutral outward bodies without
checking the resulting UI. Recovery alone checked `verified:true`. Provider fakes lacked
actual fake-user/session envelopes, real cookie-transfer outcomes and cross-purpose OTP
behavior. Resend tests checked enumeration safety but not false delivery copy. Account
lookup failure, logout lookup failure and malformed successful client payloads lacked
coverage. This explains why the existing-email issue passed.

Added `flow-outcomes.test.cjs` executes routes with real request validation and table-driven
provider outcomes: new/unconfirmed/fake-confirmed signup, explicit recipient errors,
policy errors, provider/application throttles, malformed success, configuration drift,
wrong/expired/consumed/cross-purpose codes, banned users, matching identity and transfer,
partial confirmation success, recovery revocation/issuance failure, logout/cancellation,
rollout, same-origin and malformed request boundaries. Cookie publication and lack of
student-session creation are asserted on failures.

Expanded `routes.test.cjs` runs the actual submit hook for every POST endpoint against
malformed successful HTTP bodies and valid endpoint-specific results; verifies that only
validated session-changing successes broadcast. Expanded component tests check the
neutral receipt, no automatic confirmation/recovery code screen, explicit recipient action,
password clearing, bound email, email-change and resend copy. Expanded session tests cover
malformed claims, unavailable account rendering and genuine signed-out redirects.
Provider fixtures now represent the confirmed identity/session shape instead of allowing
missing user/session fields to imply success.

Existing tests continue covering recovery grant expiration, replay, email binding,
cancellation, replacement, opaque cookies, password-update failures, reset destinations,
rate-limit/request bounds, rollout, cookie security, student/admin exclusion, cross-tab
reconciliation and nav presentation. Tests with hooks/provider/store doubles are not
full browser or hosted email end-to-end tests. Local provider checks supplement them;
hosted OTP delivery and provider error behavior still require the checks below.

## Shared modules and engineering decisions

- `outcomes.ts`: one authoritative client response schema per endpoint. These are validators,
  not a shared Auth state machine. Each flow retains its own transitions.
- `verified-session.ts`: common matching confirmed identity/session validation used before
  login/confirmation transfer and before recovery-grant issuance.
- `signup-result.ts`: signup-specific acknowledgment guard; real and fake users both remain
  neutral. Unexpected immediate sessions/missing users fail closed.
- `errors.ts`: shared neutral initiation classification and safe contextual rejection mapping.
- `constants.ts`: authoritative product messages and distinct signup/recovery OTP types
  (the accepted/limited/failed resend type was removed with the receipt screen).
- `EmailRequestReceipt.tsx`: removed with the receipt screen (see the superseded note above).

Engineering decisions within the stated boundaries: add an explicit recipient step rather
than reveal existence; rename `fresh` to `accepted`; fail closed on malformed successful
provider/HTTP results; offer sign-in after confirmed-email transfer failure; scope OTP
verification to the correct purpose; preserve banned-account indistinguishability.
No new account lookup, email service, token persistence, dependency or database design was added.

## Files changed

Production:

- `app/account/page.tsx`
- `app/api/auth/register/route.ts`
- `app/api/auth/resend-confirmation/route.ts`
- `app/api/auth/forgot-password/route.ts`
- `app/api/auth/login/route.ts`
- `app/api/auth/confirm-email/route.ts`
- `app/api/auth/verify-recovery/route.ts`
- `app/api/auth/session/route.ts`
- `app/api/auth/logout/route.ts`
- `app/register/RegisterForm.tsx`
- `app/login/LoginForm.tsx`
- `app/confirm-email/ConfirmEmailForm.tsx`
- `app/forgot-password/RecoveryFlow.tsx`
- `components/auth/EmailForm.tsx`
- `components/auth/EmailRequestReceipt.tsx` (new; removed by the superseding product decision)
- `components/auth/useAuthSubmit.ts`
- `lib/auth/constants.ts`
- `lib/auth/errors.ts`
- `lib/auth/outcomes.ts` (new)
- `lib/auth/signup-result.ts` (new)
- `lib/auth/verified-session.ts` (new)
- `lib/auth/student-state.ts`

Tests/documentation:

- `lib/auth/flow-outcomes.test.cjs` (new)
- `lib/auth/recovery-grant.test.cjs`
- `lib/auth/recovery-ui.test.cjs`
- `lib/auth/routes.test.cjs`
- `lib/auth/reset-flow.test.cjs`
- `lib/auth/session-presentation.test.cjs`
- `lib/auth/student-state.test.cjs`
- `lib/auth/FLOW-OUTCOME-AUDIT.md` (new)

## Verification results

- `node --require ./lib/auth/test-loader.cjs --test lib/auth/*.test.ts lib/auth/*.test.cjs`: **60 passed**, zero failures/skips. Table-driven cases exercise many outcomes per named test.
- `supabase test db`: **91 passed** across rate limits, recovery grants and profile RLS. Existing local schema only; no reset or migrations.
- `pnpm exec tsc --noEmit`: **passed**.
- `pnpm build --webpack`: **passed** production compilation, TypeScript, static generation and route build.
- Default `pnpm build` (Turbopack): **environment-blocked**, including elevated retry; its CSS worker could not bind a port. Webpack was used without changing the build script, dependencies or application configuration. The first webpack attempt was blocked fetching the existing Google Font; the network-enabled retry passed.
- Real local Supabase/signup/mail/OTP separation checks: **passed**, disposable test account removed.
- Read-only hosted settings: **passed**; actual hosted signup/delivery matrix remains unverified.
- Filesystem whitespace/final-newline/conflict-marker scan: **passed**, 56 Auth files. `git diff --check` deliberately **not run** because all git operations were prohibited.
- Environment used Node 24.14.0. No runtime/dependency installation was performed.

No git operation was executed. The filesystem scan is not represented as a git diff check.

## Hosted verification still required

1. Use controlled inboxes for new and existing unconfirmed signup, then confirm one account
   and repeat signup. Capture only sanitized fields: HTTP status, provider error code,
   session present/absent, identity count and real/fake identity comparison. Do not log
   passwords, codes, tokens or full user objects.
2. Correlate each attempt with Auth/SMTP delivery logs and inbox timestamps. Specifically
   verify no usable confirmation code is issued for the existing confirmed signup and that
   the new/unconfirmed path still delivers usable OTPs. A fake timestamp is not evidence.
3. Exercise hosted confirmation with `type:signup`, resend/cooldown and consumed/expired OTPs.
   Verify recovery OTP rejection by confirmation and signup OTP rejection by recovery.
4. Repeat hosted login for correct/incorrect/unconfirmed credentials, resend accepted/limited/
   failed, and post-confirmation sign-in. Verify actual HttpOnly cookie transfer and refresh.
5. Repeat hosted recovery grant issuance/expiry/replay/password replacement and old refresh
   token rejection; verify no student session during recovery. No migrations were run here.
6. Exercise the deployed UI at mobile/desktop sizes, receipt/code navigation and keyboard
   focus, cross-tab changes, rollout disabled, provider outages and logout failure.

Password policy: unchanged. Recovery-grant architecture: unchanged. Session/cookie security
architecture: unchanged; outcome validation and confirmation/recovery purpose separation
were tightened. Database schema/policies: unchanged; no migrations, only disposable local
provider test data. Dependencies: unchanged. Admin Auth: unchanged.
