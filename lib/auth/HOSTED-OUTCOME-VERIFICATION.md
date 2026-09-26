# Hosted Auth outcome verification — 2026-09-16

Application: `http://localhost:3000`.
Provider: CampusIntell Staging, `https://znwluaiylogqapansuht.supabase.co`.
All times below are UTC; Lagos is UTC+1.

## Method and limits

The user supplied three controlled recipients and authorized signup and recovery testing.
No mailbox credentials or existing passwords were requested. New random test passwords
were generated in memory. No password replacement or admin user update was performed.

Read-only, email-filtered Auth admin requests established the before/after state of only
these recipients. IDs were hashed in the temporary evidence. An isolated Chrome session
submitted the actual application registration form once per recipient. A temporary
server-side observer captured sanitized SDK signup results from those same requests;
there was no separate direct-provider signup that could change the initial state.
It recorded no passwords, OTPs, session tokens or complete user objects.

Initial browser attempts did not submit signup requests because the existing local server
referenced missing JavaScript chunks from an older build. Read-only staging checks confirmed
no user changes after those attempts. The app was rebuilt and restarted with matching assets
before the recorded signup attempts. This was an execution-environment correction, not an
Auth logic change.

Application HTTP results, visible UI and cookie/session status below are observed.
Provider shapes and persisted Auth metadata are also observed, not predictions based on
Supabase documentation. Inbox receipt remains a separate user observation. A sent timestamp
alone is not proof of mailbox delivery, especially when it belongs to an obfuscated user.

## Signup results

| Recipient and initial state | Request completed | Application outcome | Observed provider SDK classification | Real Auth record change | Observed UI/session |
| --- | --- | --- | --- | --- | --- |
| NEW — `talou.ta@yahoo.com`, absent before test | 17:24:00 | HTTP 200, neutral confirmation receipt | Real unconfirmed user, one identity, no session, no provider error code | Created at 17:23:58.112174; persisted confirmation-send timestamp 17:23:58.171957 | Neutral receipt; no code input; password inputs removed; signedIn false; zero student-session cookies |
| UNCONFIRMED — `talabi.eni@gmail.com`, existing unconfirmed user | 17:24:04 | Same HTTP 200 and body | Existing real user ID, one identity, no session, no provider error code | Same ID and creation time; remains unconfirmed; confirmation-send timestamp advanced from 06:52:29.104909 to 17:24:02.880890 | Same neutral receipt; no code input; password inputs removed; signedIn false; zero student-session cookies |
| CONFIRMED — `moonboyest@gmail.com`, existing confirmed user | 17:24:08 | Same HTTP 200 and body | Obfuscated user: returned ID differs from real user ID; zero identities; appears unconfirmed; no session; no provider error code; synthetic confirmation timestamp 17:24:07.471369111 | Real ID, confirmation status, creation/update/last-sign-in timestamps unchanged; real confirmation-send timestamp remains null | Same neutral receipt; no code input; password inputs removed; signedIn false; zero student-session cookies |

The application body was identical for all three:

```json
{"message":"If this address can receive a confirmation email, instructions will arrive shortly."}
```

The screen offered “I have received a code”, “Change email”, “Sign in” and “Forgot password?”.
It did not claim signup succeeded or that a code was delivered. All three session checks
returned `{"enabled":true,"signedIn":false}`. The provider/account differences remained
server-side; the public application response and UI did not reveal account existence.

This directly confirms that the specified hosted backend uses the obfuscated success-shaped
response for the controlled confirmed recipient. The new user and unconfirmed user produce
real user objects. The fake confirmation timestamp did not correspond to an updated real
user record. This is a reproduction of the provider behavior, not a recovered log of the
original incident.

## Confirmation email issuance and delivery

| Recipient | Server-side evidence from this run | Inbox evidence |
| --- | --- | --- |
| NEW | Real user created and real confirmation-send timestamp persisted | Awaiting user report |
| UNCONFIRMED | Existing real user's confirmation-send timestamp advanced | Awaiting user report |
| CONFIRMED | Obfuscated response only; real user and real confirmation-send timestamp unchanged | Awaiting user report |

No SMTP delivery logs or mailbox contents were accessed. NEW/UNCONFIRMED have persisted
confirmation-request evidence. CONFIRMED has no persisted new confirmation-send evidence;
its response timestamp is demonstrably synthetic. Final message arrival/absence must be
reported by the inbox owner. Non-arrival alone cannot rule out delay or filtering.

## Recovery OTP separation check

A separate recovery request was submitted for CONFIRMED at 17:25:38 UTC (18:25:38 Lagos).
The application returned HTTP 200 with the neutral recovery message, no student-session
cookie, and `signedIn:false`. A subsequent Auth record read observed persisted
`recovery_sent_at: 2026-09-16T17:25:37.024238Z`; the real confirmation-send timestamp
remained null. This request does not change the password.

**Attempt 1 (17:25:38 request):** Recovery OTP delivery: ARRIVED. Verification result:
NOT TESTED — OTP EXPIRED BEFORE INPUT. The code aged out while the verifier continued other
audit steps before requesting it. This is a test-procedure delay, not an application failure.

**Procedure change:** after any OTP send that needs manual inbox input, the verifier stops
immediately after the send succeeds, requests the code, and runs nothing else until it arrives.

Planned observations:

1. Submit that recovery OTP to `/api/auth/confirm-email` in a fresh signed-out context.
2. Require invalid-code rejection, no student-session cookie, signedIn false, and no access
   to `/account`.
3. Submit the **same** code to `/api/auth/verify-recovery` as a positive control. This proves
   the confirmation rejection was purpose-specific rather than caused by a wrong/expired code.
4. Confirm no student session, then cancel any issued test recovery grant. Do not change
   the account password.

A 400 rejection without a successful positive control is not a complete security pass.

### Attempt 2 — 17:42 UTC, completed

The local production server (`.next` build `H-YbY2yxM2CAlU2oLUSNy`, the clean rebuild from
the earlier run) was not running and was started with `npm start`; no code changed.

| Step | Time (UTC) | Request | Result | Cookies set | `/api/auth/session` | `/account` |
| --- | --- | --- | --- | --- | --- | --- |
| Trigger | 17:42:18 | `POST /api/auth/forgot-password` for CONFIRMED | HTTP 200, neutral recovery message | `ci-recovery-grant` cleared only | `signedIn:false` | — |
| Inbox | — | User reported the 6-digit code | ARRIVED (~1 min) | — | — | — |
| Negative | 17:44:01 | Recovery OTP → `POST /api/auth/confirm-email` (type `signup`), fresh signed-out jar | **HTTP 400** `{"error":"Invalid or expired code."}` | **none** | `signedIn:false` | HTTP 307 → `/login?next=%2Faccount` |
| Positive control | 17:44:12 | **Same** OTP → `POST /api/auth/verify-recovery` (type `recovery`), fresh signed-out jar | **HTTP 200** `{"verified":true}` | `ci-recovery-grant` only (Path=/api/auth, Max-Age=600, HttpOnly, Secure, SameSite=lax); no `sb-*` student-session cookie | `signedIn:false` | HTTP 307 → `/login?next=%2Faccount` |
| Cleanup | 17:44:3x | `POST /api/auth/cancel-recovery` with the grant cookie | HTTP 200 `{"success":true}`, grant cookie cleared | — | `signedIn:false` | — |

Outcome: **PASS.** The recovery OTP was rejected on the signup-confirmation path and created no
student session, while the identical, still-valid code was accepted on the recovery-verification
path 11 seconds later. The rejection is therefore purpose-specific (`type: signup` vs
`type: recovery`), not a wrong or expired code. Neither path produced a signed-in state or
`/account` access. No password was changed; the account remains confirmed. The issued test
grant was cancelled; even if the cancel request had not carried the cookie, the grant expires
at 17:54:14 UTC. Rate-limit budget used: 1 of 3 `PASSWORD_RESET_REQUEST`, 1 of 5
`CONFIRM_EMAIL`, 1 of 5 `PASSWORD_RESET_SUBMIT` for this recipient.

## Scope and cleanup

No git operations, migrations, dependency changes or unrelated Auth fixes were performed.
The new test user remains unconfirmed. The existing unconfirmed user remains unconfirmed.
The existing confirmed user remains confirmed. No controlled user was deleted.

Temporary gateway instrumentation has been removed. The gateway source was restored
byte-for-byte to its pre-test contents; the clean production build passed and a scan
confirmed no observer references remain in the compiled server. The app was restarted
on port 3000 with the clean build and returned HTTP 200 with Auth enabled/signedIn false.
No instrumentation remains active. The recovery OTP separation test is complete (above);
signup confirmation delivery reports for NEW/UNCONFIRMED remain a user inbox observation.
The app was left running on port 3000.

## Cooldown and throttle validation — 2026-09-17

Application: local production build of the outcome-classification refactor on `http://localhost:3000`,
same hosted project. Provider result shapes were captured by a session-only `NODE_OPTIONS --require`
fetch observer in the scratchpad (status, `code`/`message`, presence booleans, hashed IDs; no request
bodies, tokens, passwords or OTPs). Account state was read with email-filtered, read-only admin
requests. All times UTC. Controlled recipients: `moonboyest@gmail.com` (confirmed),
`talou.ta@yahoo.com` (unconfirmed, password unknown), and a new user `talabi.eni+ci@gmail.com`
created with user permission because `talabi.eni@gmail.com` had been confirmed on 2026-09-16 18:05.

**Hosted facts established**

- The per-recipient cooldown is **~30 seconds** ("For security purposes, you can only request this
  after 28 seconds." two seconds after a send), code `over_email_send_rate_limit`, HTTP 429, no
  `Retry-After` header. It applies to `/recover`, `/signup` (existing unconfirmed) and `/resend`.
- A cooldown rejection issues no email and leaves `recovery_sent_at`/`confirmation_sent_at` unchanged.
- Repeat unconfirmed signup did **not** replace the account password (login with the new password
  returned `invalid_credentials`); `email_not_confirmed` is only returned after password validation.
- A nonexistent address receives `/recover` **200 `{}`** and `/resend` **200 `{}`** every time.

| Case | Provider | App (before fix) | Email | OTP / session |
| --- | --- | --- | --- | --- |
| Recovery, confirmed recipient, 07:04:47 | `/recover` 200 `{}` | 200 neutral; grant cookie cleared | Arrived | Code verified 07:10:26 → `verified:true`, `ci-recovery-grant` only, `signedIn:false`; grant cancelled; replay → 400 (`otp_expired`) |
| Same, +2 s | `/recover` 429 cooldown | **429 `limited`, stayed** | None | — |
| Nonexistent address, twice within 1 s | `/recover` 200, 200 | 200, 200 | None | — |
| Register existing unconfirmed, 07:04:50 | `/signup` 200 real user, 1 identity | 200 → Confirm email | Arrived | Code verified 07:10:24 after two cooldown rejections → HttpOnly session, `/account` 200; replay → 400 |
| Register again, +1 s | `/signup` 429 cooldown | 200 → advance | None | Prior code remained usable (above) |
| Resend-confirmation, +17 s | `/resend` 429 cooldown ("after 11 seconds") | 200 → advance | None | Prior code remained usable (above) |
| New user register, 07:10:53 | `/signup` 200 | 200 → Confirm email | Arrived (08:10 Lagos) | Superseded by the later accepted resend: → 400 `otp_expired` |
| Unconfirmed login, +2 s | `/token` `email_not_confirmed`; `/resend` 429 cooldown | 200 `EMAIL_CONFIRMATION_REQUIRED` → Confirm email directly | None | — |
| Unconfirmed login, +34 s | `email_not_confirmed`; `/resend` 200 `{}` | 200 code → Confirm email directly | Arrived (08:11 Lagos) | Verified 07:14:04 after a cooldown rejection → HttpOnly session; logout 200 cleared it |
| Unconfirmed login, +2 s | `email_not_confirmed`; `/resend` 429 cooldown | 200 code → advance | None | — |
| Unconfirmed login, +1 s | `email_not_confirmed`; `/resend` not called | **429 `limited`, stayed on Login** (application `RESEND_CONFIRMATION` 3/h) | None | — |

No receipt/intermediate screen appeared on any path. Recovery verification created no student
session on any path. Confirmation, unconfirmed-login and register classifications matched the
implementation.

**Demonstrated oracle.** Recovery initiation returned 200 then 429 for an existing recipient
inside cooldown, but 200 then 200 for a nonexistent address under identical timing. GoTrue
emits the cooldown only after finding the account, so the 429 answered whether the address
was registered (bounded by `PASSWORD_RESET_REQUEST` to roughly ten addresses per origin per hour,
but real). The pre-refactor helper had folded provider throttles into 200; the audit matrix
also specified 200 for recovery throttles.

**Chosen normalization.** `classifyEmailInitiation` now returns the neutral acknowledgment for
the per-recipient cooldown on every initiation (register, resend, unconfirmed login, recovery),
so accepted send, nonexistent no-op and cooldown are outwardly identical: HTTP 200, the same
body, the same cleared grant cookie, no session. Recipient-independent outcomes are unchanged:
application limits and pre-lookup provider limits (`over_request_rate_limit`, project send quota
"email rate limit exceeded", generic 429) remain 429; send failures, disabled email, malformed
success envelopes and unexpected failures remain 503. The recovery UI advances to the code screen,
whose copy ("Enter the recovery code you received at …") and resend acknowledgment are conditional
and claim no fresh email. A stale or consumed recovery code cannot progress: replay was rejected
and verification alone issues a grant.

**Why confirmation cooldown remains different.** It is not different outwardly anymore (both are
neutral 200); the semantics differ. A confirmation cooldown leaves the prior signup code usable
(verified twice above), so advancing is exactly right. A recovery cooldown may follow a consumed
code, so advancing can lead to one rejected entry followed by a resend after ~30 s. That
recoverable inconvenience was accepted over an externally observable account-existence signal.

**Remaining provider-dependent risks, not verified.** Project-wide email quota and
`over_request_rate_limit` were not manufactured (about thirteen email-counted provider requests
did not trip them); their "stay on Login/request screen with `limited`" branch is verified only via
the application limit. An SMTP/send failure is only reachable for an existing recipient, so during
a provider outage 503 versus 200 would still differ by existence; that outage-bounded channel is
retained deliberately in favour of truthful failure handling. Inbox counts for cooldown rejections
rest on unchanged send timestamps plus the reported codes.

**Housekeeping.** `talou.ta@yahoo.com` and `talabi.eni+ci@gmail.com` are now confirmed test
accounts; no password was changed or replaced. The `talabi.eni+ci` test session was logged out.
The `talou.ta` test session cookie jar was discarded without logout, leaving an unheld refresh
session server-side; the repository's only JWT-free global revocation is
`replacePasswordAndRevokeSessions` (admin password update), which is a password mutation rather
than a pure session revocation, so it was not used. Application rate-limit budget consumed for
these recipients expires within the hour. The observer, throwaway passwords and cookie jars were
removed; no repository instrumentation was added.
