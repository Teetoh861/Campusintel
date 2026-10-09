<!-- docs/transactional-email-release.md — Approved auth-email identity, template contract and release procedure. -->
# Transactional email release readiness

This is the current deployment contract. Dated Auth audit records describe historical
tests; they do not prove current SMTP/DNS configuration or production delivery.
Repository tests do not send external email. Hosted changes require a separate approved
operations step. Supabase Auth generates and sends auth email through custom SMTP;
there is no application Resend SDK or callback-link architecture.

## Approved identity

| Purpose | Identity |
| --- | --- |
| Delivery provider | Resend |
| Transactional sending domain | `auth.campusintell.com` |
| Sender display name | `CampusIntell` |
| From address | `no-reply@auth.campusintell.com` |
| Required Reply-To | `hello@campusintell.com` |
| Public support | `hello@campusintell.com` (`lib/contact.ts`) |
| Separate material requests | `campusintell@gmail.com` (`lib/material-email.ts`), unchanged |

The support inbox must receive mail and have a named monitoring owner. Sending-domain
verification does not provision that inbox. The no-reply sender is not a support inbox.

## Configuration owners

### Application deployment

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the target
  environment's public Supabase project configuration.
- `SUPABASE_SECRET_KEY`: server-only modern secret for the narrow Auth/RPC operations.
- `AUTH_INTERNAL_SECRET`: server-only strong random secret, consistent across instances
  within one environment and distinct between staging and production.
- `NEXT_PUBLIC_SITE_URL`: `https://campusintell.com` in production; the exact approved
  staging application origin in staging. Configure before building. Local development
  must use matching application and Supabase Site URLs (`localhost` and `127.0.0.1`
  are distinct origins).
- `STUDENT_AUTH_ENABLED`: enable only after the target's release gates pass.

Staging and production use their own Supabase project, credentials and operational
evidence. Never copy local/staging secrets into production or into review artifacts.
SMTP credentials are not application variables and must never have `NEXT_PUBLIC_` names.

### Supabase Auth

- Enable custom SMTP with host `smtp.resend.com`, port `465` (TLS), username `resend`
  and that environment's private Resend SMTP credential. Set the approved sender name
  and address above. Do not rely on Supabase's restricted built-in mail service.
- Enable email confirmation; require minimum password length 8. Verify the existing
  rate-limit/recovery migrations and recovery-expiry cron job in the target ledger.
- Install the two OTP templates below in hosted Auth settings. Local `config.toml`
  and migrations do not install hosted templates or SMTP settings.
- Set Site URL to the target application origin. These OTP flows do not supply
  `emailRedirectTo`/`redirectTo`, consume callback links or require a callback route.
  Any enabled redirect-based flow must have separately reviewed exact redirect URLs;
  do not add broad Preview wildcards for these code flows.
- Auth POST origin validation accepts the canonical origin and, only in Vercel Preview,
  the exact current server-provided `VERCEL_URL` with `VERCEL=1`/`VERCEL_ENV=preview`.
  This application guard is separate from Supabase's redirect allowlist.
- Verify numeric OTP length and expiry against the app's numeric, maximum-32-character
  input. The local baseline is 6 digits and 3600 seconds; record the hosted values.
- Review project-wide send quotas, recipient cooldown, verification limits and direct
  Auth API limits. Local `email_sent=100` and `max_frequency="1s"` are test settings,
  not a production policy. Verify Auth IP forwarding is enabled for the modern secret
  key and direct Vercel ingress; otherwise server requests can share one provider IP bucket.

[Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp),
[Resend SMTP integration](https://resend.com/docs/send-with-supabase-smtp),
[Supabase rate limits](https://supabase.com/docs/guides/auth/rate-limits).

### Resend and DNS

- Verify `auth.campusintell.com`; use separate staging/production credentials and
  credential scope where supported. Keep credentials in private provider/Supabase
  configuration, never source control, logs, shell arguments or screenshots.
- Obtain the exact SPF, DKIM and return-path records from Resend. Check existing DNS
  before applying them; do not invent selectors, record values or duplicate SPF records.
- Establish aligned DMARC and reporting appropriate to existing legitimate mail sources;
  validate headers before tightening enforcement. Preserve existing receiving-mail DNS.
- Review capacity, sent/delivered/delayed/failed/bounced/complained/suppressed events,
  suppression handling and alert ownership. Record delivery IDs privately, never OTP bodies.
  SMTP-sent messages appear in Resend's email records; application acceptance is not delivery.
- Keep auth mail separate from marketing. Disable click/open tracking for auth messages.

[Resend domains](https://resend.com/docs/dashboard/domains/introduction),
[DMARC](https://resend.com/docs/dashboard/domains/dmarc),
[SMTP delivery records](https://resend.com/docs/send-with-smtp).

### Reply handling: required external acceptance gate

Received confirmation and recovery email must contain `Reply-To: hello@campusintell.com`.
Supabase's documented SMTP configuration exposes sender name/address but does not document
an independent Reply-To setting. Resend can transport headers supplied by its SMTP client;
an HTML template or application environment variable does not set a message header.

Verify native header support with Supabase/Resend and inspect a real received message.
If their SMTP path cannot set the required header, record this gate as **BLOCKED** and
obtain an approved supported solution before launch. Do not claim that this repository
configures Reply-To, change From to the support address, add a send hook/SDK, or switch
providers silently. This patch does not implement a different mail-sending architecture.

## Hosted template contract

The repository HTML is the deployment source; retain its existing presentation.

| Hosted template | Subject | Body source | Token verification |
| --- | --- | --- | --- |
| Confirm sign up | `Confirm your CampusIntell email` | `supabase/templates/confirmation.html` | `/api/auth/confirm-email`, `type: signup` |
| Reset password | `Reset your CampusIntell password` | `supabase/templates/recovery.html` | `/api/auth/verify-recovery`, `type: recovery` |

Both bodies must show `{{ .Token }}` as text, instructions to enter it on CampusIntell,
and the existing non-sharing/ignore guidance. Do not replace it with `{{ .TokenHash }}`,
`{{ .ConfirmationURL }}`, automatic verification links or credentials in URLs.
An email/page GET must not consume a code. A recovery code must never authorize signup
confirmation or ordinary student access. “Change email” in these forms restarts input;
it is not an account email-change feature.

Compare hosted subject/body with these source files, then verify the actual received mail
contains the rendered numeric code, no literal template placeholder and no action link.
Do not export credentials when inspecting settings. Provider acceptance, synthetic signup
timestamps and SMTP acceptance are not proof of inbox receipt. Default-template fallback
after a template parse error must be treated as a failed contract check.

[Supabase template variables and hosted ownership](https://supabase.com/docs/guides/auth/auth-email-templates).

## Repeatable release verification

Run the same matrix for staging, then for production in a separately authorized gate.
Use disposable accounts and controlled mailboxes; remove owned test data/users afterward.
Never use a real student's account or log/share a password, code, cookie or token.
Record environment/deployment, template version, timestamp, sanitized status/outcome,
delivery status and cleanup result. Do not mark an inaccessible inbox/provider check PASS.

### Automated repository checks (no external delivery)

Use Node 22/pnpm 9 and local Supabase only:

```sh
node --require ./lib/auth/test-loader.cjs --test lib/auth/*.test.ts lib/auth/*.test.cjs
node scripts/dev-workflow/cli.cjs verify --db
```

Start/reset the intended local test database through the normal local workflow first;
stop it afterward. Local mail is captured in the testing inbox, not delivered externally.
Automated tests cover neutral send/no-op/cooldown/provider-failure responses, safe server
diagnostics, limits, origin/input rejection, code-purpose separation and single-use
email-bound grants. They do not assert SPF/DKIM/DMARC, real receipt or provider availability.

### Manual application and mailbox matrix

| Area | Cases | Required evidence |
| --- | --- | --- |
| Signup | New account, correct/wrong/expired/reused code | No session before verification; code arrives; correct signup code establishes the verified HttpOnly session and follows the safe internal destination/profile gate; other codes fail safely. |
| Signup repetition | Existing unconfirmed and confirmed recipients | Neutral outward initiation; no password replacement or account-existence disclosure; confirmed repetition does not create a new identity/session. |
| Confirmation resend | Accepted resend, prior/superseded code, recipient cooldown, application/provider quotas | Neutral acknowledgment promises no new delivery; verify which code remains valid; application/quota limits remain 429; private diagnostics distinguish the outcome. |
| Recovery initiation | Existing/nonexistent recipient, returned delivery rejection and transport failure | Same neutral 200 body, cache headers and cleared recovery cookie; no provider detail, ordinary session or grant. Provider failures have safe private diagnostics. |
| Recovery verification | Correct/wrong/expired/reused/superseded code; opposite-purpose code | Only the correct recovery code issues a recovery-only grant; no normal student session or Account access; replay and purpose substitution fail. |
| Password replacement | Correct grant, expiry/replay, wrong-email binding, policy/provider failure | Grant consumed once before password mutation; failure requires restart; success returns to login; new password works and old password fails. |
| Session revocation | Existing sessions before reset, retained JWT and refresh token after reset | All old refresh sessions revoked; account-owned routes/Data API deny retained revoked-session JWTs; reset flow itself creates no ordinary session. |
| Continuation | Lost tab, refresh, resend and code entry at phone width | Honest restart/code path, usable input and safe internal navigation; no credential in URL/storage or confirmation through GET. |

### Manual provider/delivery matrix

| Check | Required result |
| --- | --- |
| Real inboxes | Confirmation and recovery arrive in controlled representative inboxes; record delivery delay and spam placement. Test the newly configured provider, not just historical mail. |
| Identity/replies | Approved From display/address and exact Reply-To header; an actual reply reaches the monitored support inbox. Material requests remain separate. |
| Authentication | Inspect recipient `Authentication-Results`: SPF/DKIM results and DMARC alignment/pass with the approved From domain. Record return-path/DKIM signing domain privately; no invented DNS values. |
| Delayed delivery | Observe delay event/status and later receipt or failure; codes older than expiry fail; do not promise an unexpired code will arrive. |
| Provider rejection | Correlate private Auth/provider failure with neutral initiation; code verification stays secure; operators can recognize/configure/resolve the fault. |
| Bounce/complaint/suppression | Use provider-supported test recipients to observe events and suppression behavior; verify the operational alert/recovery procedure, not a fabricated CI delivery result. |
| Capacity and separation | Review sender quotas/cooldown and expected release volume; staging traffic/credentials must not consume or expose production account authority. |

[Resend event-test recipients](https://resend.com/docs/dashboard/emails/send-test-emails)
can simulate delivery, bounce, complaint and suppression without mailing arbitrary addresses.
They do not provide a real inbox for completing OTP journeys. SMTP acceptance does not prove
inbox placement; logs/events and the controlled mailbox provide different evidence.

Release requires the matrix, DNS/provider configuration, Reply-To and support-inbox gates
to pass. Local CI success alone is insufficient. No hosted setting is changed by this document.
