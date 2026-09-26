<!-- lib/auth/VERIFICATION.md — Executed A2 checks, file inventory and remaining release blockers. -->
# A2 verification — 2026-09-12

Branch: auth-interface. Base: develop at 517c1791583a5cb388875ca618c7a749af7c238b.
The initial working tree was clean. No staging, commits, pushes or branch changes occurred.

## Executed checks

- Installed Supabase 2.116.0 types support email/token verification with both email and recovery types.
- Installed SSR 0.12.7 cookie setAll supplies cache headers; adapters preserve these and cookie metadata.
- Clean `supabase db reset`: passed on the minimal local Auth/database/REST/Mailpit stack.
- `supabase test db`: 59 passed (25 rate-limit tests; original 34 profile tests unchanged).
- Node security tests: 4 passed, covering redirect attacks, rollout parsing, request bounds,
  input normalization and production cookie flags. Runner is documented in README.md.
- Real local functional sequence: 37 checks passed, including confirmation/recovery OTPs,
  replay rejection, enumeration-safe responses, one profile only after confirmation,
  student/null/null/null defaults, cookie flags, refresh rotation/cache headers, and local logout.
- An actual old refresh token from another session was rejected after successful password reset;
  old password failed, new password succeeded. Existing login alone could not reset a password.
- A student session could not authorize /admin. Production regression with ephemeral local admin
  fixtures passed custom admin login, protected rendering, signed-out rejection and logout.
- Production rollout-disabled regression passed all seven auth pages and seven POST endpoints,
  with Supabase configuration deliberately absent. Session status returned only two booleans.
- Signed-out production HTTP checks passed /, /courses, /courses/business-statistics,
  /courses/business-statistics/quiz, /bookmarks, /materials, /tutors, /contact and /admin.
  No full quiz was played and no quiz logic was changed.
- All 13 original page/handler entries remained in the production route manifest.
  Existing public pages remained static/SSG; only auth pages/endpoints add dynamic behavior.
- Chrome checks covered seven auth routes at 375, 768 and 1280 pixels: no horizontal overflow,
  associated labels, 50px inputs and buttons at least 44px high. Signed-out /account redirected.
- Browser interaction checks passed password reveal, keyboard focus, mobile drawer destinations,
  disabled/loading submit, duplicate-submit prevention, long error wrapping, signed-in account,
  two-tab session sharing and reconciliation after logout. The 900px header breakpoint fit.
- Browser JavaScript could not read the student session cookie. Both browser storage areas were empty.
- Mobile registration was also visually inspected. These checks are not a full screen-reader/WCAG audit.
- Isolated production execution captured stdout/stderr in memory and compared against the submitted
  passwords and confirmation/recovery codes: none appeared. No credential-bearing logs were written.
- No token_hash flow or /auth/confirm route exists. Email buttons contain neither email nor code.
  Fetching the confirmation page did not confirm the account; only the code POST did.
- Static searches found no legacy Supabase key name in application code, no server secret names in
  client chunks/components, no browser Supabase Auth methods, no new raw HTML injection,
  and no student profile UPDATE or auth imports in course/question content.
- TypeScript and production build passed. `git diff --check` passed. Lint was not used as a gate.

## Verification corrections and environment limits

An initial pgTAP attempt ran before reset completed and was discarded; the final successful run
followed a completed reset. Full local Supabase startup failed health checks in unrelated
analytics/storage/realtime/Studio/metadata services. A minimal stack excluding those services
started successfully; both reset and pgTAP then completed. That minimal stack remains available.
The initial running Auth container had stale email templates; restarting loaded the OTP templates.

Early browser harness attempts attached to the wrong target or timed out and were discarded.
The final runs used an isolated profile/port and verified the actual application paths.
A forced-refresh test initially used a zero expiry, which the installed library treats as absent;
a nonzero expired timestamp triggered real rotation and passed. Production log verification
initially used the wrong Origin; using the build's canonical origin passed all functional checks.

Hosted Vercel ingress, Supabase settings, SMTP delivery and hosted logs were not inspected or changed.
The production-mode forwarding test simulated the trusted Vercel header locally; deployment still
assumes direct Vercel ingress. Configure NEXT_PUBLIC_SITE_URL before the production build.

## Files

Existing modified files: .env.example, proxy.ts, components/chrome/Nav.tsx,
lib/supabase/client.ts, lib/supabase/server.ts, supabase/config.toml.
No protected admin, quiz, bookmark, content, global-design or CSP file was modified.

New files:

- `app/account/page.tsx`
- `app/api/auth/confirm-email/route.ts`
- `app/api/auth/forgot-password/route.ts`
- `app/api/auth/login/route.ts`
- `app/api/auth/logout/route.ts`
- `app/api/auth/register/route.ts`
- `app/api/auth/resend-confirmation/route.ts`
- `app/api/auth/reset-password/route.ts`
- `app/api/auth/session/route.ts`
- `app/confirm-email/ConfirmEmailForm.tsx`
- `app/confirm-email/page.tsx`
- `app/forgot-password/page.tsx`
- `app/login/LoginForm.tsx`
- `app/login/page.tsx`
- `app/register/RegisterForm.tsx`
- `app/register/page.tsx`
- `app/resend-confirmation/page.tsx`
- `app/reset-password/ResetPasswordForm.tsx`
- `app/reset-password/page.tsx`
- `components/auth/AuthNotice.tsx`
- `components/auth/AuthShell.tsx`
- `components/auth/EmailForm.tsx`
- `components/auth/LogoutButton.tsx`
- `components/auth/PasswordField.tsx`
- `components/auth/useAuthSubmit.ts`
- `components/chrome/FormField.tsx`
- `lib/auth/README.md`
- `lib/auth/config.ts`
- `lib/auth/constants.ts`
- `lib/auth/cookies.ts`
- `lib/auth/rate-limit.ts`
- `lib/auth/redirect.ts`
- `lib/auth/request.ts`
- `lib/auth/response.ts`
- `lib/auth/schemas.ts`
- `lib/auth/security.test.ts`
- `lib/auth/test-loader.cjs`
- `lib/supabase/auth-gateway.ts`
- `lib/supabase/proxy.ts`
- `supabase/migrations/20260912090000_auth_rate_limits.sql`
- `supabase/templates/confirmation.html`
- `supabase/templates/recovery.html`
- `supabase/tests/auth_rate_limits.test.sql`
- `lib/auth/VERIFICATION.md`

## Production dependency audit — release blocker

`pnpm audit --prod` completed against the registry and returned 53 findings:
2 critical, 26 high, 21 moderate, 4 low. No dependencies were changed in A2.
The high/critical findings reported by the registry are listed below. Applicability
has not been independently assessed; they must not be silently dismissed or shipped.

| Severity | Package | Advisory |
| --- | --- | --- |
| high | picomatch | [Picomatch has a ReDoS vulnerability via extglob quantifiers ](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) |
| high | picomatch | [Picomatch has a ReDoS vulnerability via extglob quantifiers ](https://github.com/advisories/GHSA-c2c7-rcm5-vvqj) |
| high | lodash | [lodash vulnerable to Code Injection via `_.template` imports key names ](https://github.com/advisories/GHSA-r5fr-rjxr-66jc) |
| high | next | [Next.js has a Denial of Service with Server Components ](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3) |
| high | next | [Next.js Vulnerable to Denial of Service with Server Components ](https://github.com/advisories/GHSA-8h8q-6873-q5fj) |
| high | next | [Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes - Incomplete Fix Follow-Up ](https://github.com/advisories/GHSA-26hh-7cqf-hhc6) |
| high | next | [Next.js vulnerable to Denial of Service via connection exhaustion in applications using Cache Components ](https://github.com/advisories/GHSA-mg66-mrh9-m8jx) |
| high | next | [Next.js vulnerable to server-side request forgery in applications using WebSocket upgrades ](https://github.com/advisories/GHSA-c4j6-fc7j-m34r) |
| high | next | [Next.js has a Middleware / Proxy bypass through dynamic route parameter injection ](https://github.com/advisories/GHSA-492v-c6pp-mqqv) |
| high | next | [Next.js has a Middleware / Proxy bypass in App Router applications via segment-prefetch routes ](https://github.com/advisories/GHSA-267c-6grr-h53f) |
| high | next | [Next.js has a Middleware / Proxy bypass in Pages Router applications using i18n ](https://github.com/advisories/GHSA-36qx-fr4f-26g5) |
| high | sharp | [sharp inherited vulnerabilities in libvips: CVE-2026-33327, CVE-2026-33328, CVE-2026-35590, CVE-2026-35591 ](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) |
| high | next | [Next.js: Middleware / Proxy bypass in App Router applications using Turbopack and single locale ](https://github.com/advisories/GHSA-6gpp-xcg3-4w24) |
| high | next | [Next.js: Denial of Service in App Router using Server Actions ](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) |
| high | next | [Next.js: Server-Side Request Forgery in Server Actions on custom servers ](https://github.com/advisories/GHSA-89xv-2m56-2m9x) |
| high | next | [Next.js: Server-Side Request Forgery in rewrites via attacker-controlled destination hostname ](https://github.com/advisories/GHSA-p9j2-gv94-2wf4) |
| high | postcss | [PostCSS: Arbitrary file read and information disclosure via attacker-controlled sourceMappingURL in CSS comments ](https://github.com/advisories/GHSA-6g55-p6wh-862q) |
| high | nanoid | [nanoid: non-secure generators can loop indefinitely with negative size ](https://github.com/advisories/GHSA-28wg-ghj8-5hjv) |
| high | nanoid | [nanoid: custom generators can loop indefinitely when size is zero ](https://github.com/advisories/GHSA-2v37-7h3g-55p8) |
| high | postcss | [PostCSS: Path Traversal in Previous Source Map Auto-Loading (sourceMappingURL) leads to Arbitrary .map File Disclosure ](https://github.com/advisories/GHSA-r28c-9q8g-f849) |
| high | browserslist | [Browserslist: Unbounded memory growth (no cache eviction) via distinct query results, leading to eventual OOM ](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) |
| high | browserslist | [Browserslist: Uncaught crash / prototype write via untrusted browserslist-stats.json custom stats (normalizeStats) ](https://github.com/advisories/GHSA-73wf-gq98-2v4g) |
| high | nanoid | [nanoid: Integer Overflow or Wraparound ](https://github.com/advisories/GHSA-xwg4-73v4-xw9w) |
| critical | next | [Next.js: Unauthenticated Remote Code Execution on windows-hosted servers ](https://github.com/advisories/GHSA-p293-qw3h-jr36) |
| high | sharp | [sharp: Vulnerabilities in libheif: GHSA-g89c-p67h-r497 and GHSA-2jg2-4ch7-h545 ](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c) |
| critical | next | [Next.js: Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used ](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4) |

See README.md for the full manual Vercel, Supabase and Resend/SMTP configuration checklist. Keep student auth disabled.
