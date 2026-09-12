<!-- lib/auth/README.md — A2 authentication architecture, verification and deployment handoff. -->
# Student authentication (A2)

Student auth is server-only and separate from the custom admin cookie. Only literal
`STUDENT_AUTH_ENABLED=true` enables it; keep it disabled until the remaining Phase A
launch gates are complete. Missing configuration is read lazily and fails closed.

The browser submits email/password/OTP in same-origin POST bodies. It never calls
Supabase Auth. Access and refresh tokens move directly from the Auth-only gateway
into the request-scoped publishable-key SSR client. Supabase owns cookie names,
chunking, rotation and expiry; the adapter enforces HttpOnly, SameSite=Lax, Path=/
and Secure in production. Public browsing remains static. The nav reads booleans
from `/api/auth/session` and rechecks on focus/visibility changes.

Confirmation and recovery emails display `{{ .Token }}`. Their buttons contain
only the site URL and `/confirm-email` or `/reset-password`. A GET never verifies
a code. No email, code, hash or session credential is included in a destination.
Recovery verifies the OTP and updates the password in one POST, then calls global
sign-out. Reset success is never reported if revocation fails. Normal logout uses
local scope. Supabase global logout revokes refresh sessions; already-issued access
JWTs can remain valid until expiry. A3 is responsible for immediate account
restriction and deletion lifecycle controls.

`AUTH_INTERNAL_SECRET` is used only for HMAC-SHA256 rate-limit identifiers, with
explicit action/account/origin domain separation. The database stores no raw email
or IP. The private consume RPC locks both buckets and charges each bucket with
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
| Recovery OTP / replace password | 5 / 15 minutes | 20 / 15 minutes |

Requester-address handling assumes direct Vercel ingress and trusts only the
platform's `x-vercel-forwarded-for` header when `VERCEL=1`, validating a single IP.
It does not parse arbitrary forwarding chains. Non-Vercel development uses a stable
local bucket and omits IP forwarding. Other production deployments fail closed.
See [Vercel request headers](https://vercel.com/docs/headers/request-headers) and
[Supabase IP forwarding](https://supabase.com/docs/guides/auth/rate-limits).
Hosted forwarding requires a modern secret key and explicit dashboard enablement.

## Verification commands

```sh
node --require ./lib/auth/test-loader.cjs --test lib/auth/security.test.ts
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
reviewed production Auth rate limits. Deploy the rate-limit migration before
enabling auth. Copy the local OTP confirmation/recovery templates to hosted
Supabase: display the code and use credential-free CampusIntell page links.
Do not restore an automatic verification link in either template.

Resend/SMTP: verify `auth.campusintell.com`, configure SPF, DKIM and DMARC, and use
`CampusIntell <no-reply@auth.campusintell.com>` as sender. Configure Resend SMTP
credentials inside Supabase; never put an SMTP password in a NEXT_PUBLIC variable.
Verify delivery under realistic volume. Keep request-body capture disabled in any
future application logging, error reporting or analytics integration.

Before rollout, resolve the production dependency audit findings and finish the
remaining Phase A account lifecycle, attempt-recording and analytics launch gates.
No production dashboard or deployment configuration is changed by A2.
