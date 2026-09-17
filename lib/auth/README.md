<!-- lib/auth/README.md — A2 authentication architecture, verification and deployment handoff. -->
# Student authentication (A2)

Student auth is server-only and separate from the custom admin cookie. Only literal
`STUDENT_AUTH_ENABLED=true` enables it; keep it disabled until the remaining Phase A
launch gates are complete. Missing configuration is read lazily and fails closed.

The browser submits email/password/OTP in same-origin POST bodies. It never calls
Supabase Auth. For login and confirmation, access and refresh tokens move directly from the Auth-only gateway
into the request-scoped publishable-key SSR client. Supabase owns cookie names,
chunking, rotation and expiry; the adapter enforces HttpOnly, SameSite=Lax, Path=/
and Secure in production. Public browsing remains static. The nav reads booleans
from `/api/auth/session` and rechecks on focus/visibility changes.

Confirmation and recovery emails display `{{ .Token }}` without action links.
A GET never verifies a code. No email, code, hash or session credential is included
in a destination. Recovery now uses email → server-verified code → password screens.
`POST /api/auth/verify-recovery` verifies the code and issues a recovery-only grant;
`POST /api/auth/reset-password` consumes that grant before password replacement and
global sign-out. Reset success is never reported if revocation fails. Normal logout uses
local scope. Supabase global logout revokes refresh sessions; already-issued access
JWTs can remain valid until expiry. A3 is responsible for immediate account
restriction and deletion lifecycle controls.

`AUTH_INTERNAL_SECRET` derives purpose-separated keys for HMAC rate-limit indexes,
recovery-grant indexes and verified-email bindings. Rate-limit records store
no raw email or IP. The private consume RPC locks both buckets and charges each bucket with
remaining capacity even when the other is exhausted. RLS grants no browser access;
only service_role can execute the SECURITY DEFINER RPC, with an empty search_path.
The RPC validates the exact policy tuple. Records older than the maximum one-hour
window are removed on subsequent consume calls; idle tables do not grow.

| Action | Account | Origin |
| --- | --- | --- |
| Login | 20 / 15 minutes | 30 / 5 minutes |
| Register | 3 / hour | 20 / hour |
| Resend confirmation | 3 / hour | 20 / hour |
| Request recovery | 3 / hour | 20 / hour |
| Confirm email OTP | 5 / 15 minutes | 20 / 15 minutes |
| Verify recovery OTP | 5 / 15 minutes | 20 / 15 minutes |

Requester-address handling assumes direct Vercel ingress and trusts only the
platform's `x-vercel-forwarded-for` header when `VERCEL=1`, validating a single IP.
It does not parse arbitrary forwarding chains. Non-Vercel development uses a stable
local bucket and omits IP forwarding. Other production deployments fail closed.
See [Vercel request headers](https://vercel.com/docs/headers/request-headers) and
[Supabase IP forwarding](https://supabase.com/docs/guides/auth/rate-limits).
Hosted forwarding requires a modern secret key and explicit dashboard enablement.

## Verified recovery authorization

Apply `supabase/migrations/20260915100000_recovery_grants.sql` before deploying the
new handlers. `auth_recovery_grants` has RLS and no direct table access for anon,
authenticated or service_role. Only service_role can invoke the two narrowly scoped
SECURITY DEFINER RPCs; both have an empty search_path. No profile permissions change.

The `ci-recovery-grant` cookie contains 32 random bytes encoded as base64url. It is
HttpOnly, SameSite=Lax, Secure in production, scoped to `/api/auth`, and expires in
10 minutes. It contains no email, OTP, password or Supabase token. It is not an SSR
student-session cookie and cannot authorize `/account` or ordinary application data.

The private record stores only a credential HMAC, verified user ID, email-binding
HMAC, creation time and expiry. No Supabase token, OTP, password or raw email is
persisted. The email binding prevents a stale tab for another account from using
a newer cookie. All instances share the strong AUTH_INTERNAL_SECRET.

Verification immediately revokes the temporary Supabase session with local-scope
admin sign-out before issuing a grant. Failure to revoke prevents grant issuance.
The password endpoint atomically consumes the grant using DELETE ... RETURNING,
checks expiry and email binding, then calls server-only admin updateUserById.
Supabase Auth's password-update transaction globally revokes that user's refresh
sessions. This behavior is verified against local GoTrue v2.192.0; repeat the real
revocation check against hosted Auth before rollout. No normal student session is
created during recovery. Existing access JWTs remain valid until their expiry.

OTP verification retains the existing PASSWORD_RESET_SUBMIT account/origin limits.
Each grant permits one password-update attempt; provider failure never restores it.
Issuing a newer grant replaces the prior unconsumed grant for that user.
Email change, resend and logout discard the cookie-backed grant. Consumption and
password-update failures clear the cookie and require a new code.

The migration requires pg_cron and schedules expiry cleanup every minute, independent
of recovery traffic. The cleanup function is owner-only; service_role can execute
only issue/consume and cannot read the table directly. Expiry is checked on every
consume even before cleanup runs. Enable and monitor the cron job when deploying.
The migration has not been applied to hosted Supabase.

## Verification commands

```sh
node --require ./lib/auth/test-loader.cjs --test lib/auth/*.test.ts lib/auth/*.test.cjs
supabase db reset
supabase test db
pnpm exec tsc --noEmit
pnpm build
git diff --check
pnpm audit --prod
```

The Node loader only replaces the server-only marker for isolated unit tests;
Next's production boundary remains enforced. No new dependencies are required.
Local email tests require restarting the Supabase stack after template/config changes.
Use matching local Site URLs in Supabase and the application's environment.
NEXT_PUBLIC values are fixed at build time when present during the build; configure
the production canonical Site URL before building, not only before starting Node.

## Human deployment configuration

Delivery target: `auth-interface` to `develop`. Do not target main.

Vercel requires `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
`AUTH_INTERNAL_SECRET` (strong, independently generated random secret),
`STUDENT_AUTH_ENABLED=false` initially, and
`NEXT_PUBLIC_SITE_URL=https://campusintell.com`.

Hosted Supabase requires Site URL `https://campusintell.com`, email confirmation
enabled, minimum password length 8, IP forwarding enabled for server Auth, and
reviewed production Auth rate limits. Deploy the rate-limit and recovery-grant migrations before
enabling auth. Copy the local OTP confirmation/recovery templates to hosted
Supabase: display the code without action links.
Do not restore an automatic verification link in either template.

Resend/SMTP: verify `auth.campusintell.com`, configure SPF, DKIM and DMARC, and use
`CampusIntell <no-reply@auth.campusintell.com>` as sender. Configure Resend SMTP
credentials inside Supabase; never put an SMTP password in a NEXT_PUBLIC variable.
Verify delivery under realistic volume. Keep request-body capture disabled in any
future application logging, error reporting or analytics integration.

Before rollout, resolve the production dependency audit findings and finish the
remaining Phase A account lifecycle, attempt-recording and analytics launch gates.
No production dashboard or deployment configuration is changed by A2.

## Local email delivery

Local Supabase captures authentication emails in its local email-testing inbox
(Mailpit/Inbucket); it does not deliver them to real external inboxes. Open the
local inbox URL reported by `supabase status` to read confirmation and recovery
codes. Return to the registration/login confirmation screen to enter the code.
If that in-memory flow was lost, start again from sign up or sign in.
This local setup does not change hosted Supabase or production SMTP delivery.
