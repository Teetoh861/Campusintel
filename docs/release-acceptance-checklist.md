<!-- docs/release-acceptance-checklist.md — The single canonical CampusIntell release checklist from develop acceptance to production smoke testing. -->
# CampusIntell release acceptance checklist

This is the one release checklist. Every promotion of `develop` to `main` uses a copy
of this document as its release record. It orders the release gates and says what
evidence each gate needs; it does not replace the technical procedures it cites.

Authoritative procedures stay where they are:

- [Development workflow](development-workflow.md): worktree start, verifier, review
  package, PR into `develop`, cleanup.
- [Transactional email release readiness](transactional-email-release.md): approved
  email identity, application/Supabase/Resend/DNS configuration owners, hosted template
  contract, the automated and manual email matrices, and the Reply-To gate.
- [Student authentication (A2)](../lib/auth/README.md): auth architecture, recovery
  grants, rate-limit policy, migrations and cron requirements, verification commands.
- [Security policy](../SECURITY.md): supported version (latest deployed `main`),
  reporting channels and scope.
- [Agent guidelines](../AGENTS.md): review focus areas and severity rubric, including the
  expected security headers.

If this checklist and one of those documents disagree, the cited document wins and this
checklist must be corrected.

## How to use this checklist

1. Copy this file into the release record (an issue, PR description or private release
   folder). Do not edit the canonical file to record a release.
2. Fill the release header, then work the gates in order. Gates 1 to 6 run against the
   `develop` commit under test. Gate 7 is the promotion decision. Gate 8 runs only after
   `main` has been updated.
3. Every gate and every row records the fields below. A gate without a recorded status
   is not done.

### Release header

| Field | Value |
| --- | --- |
| Release name/date | |
| Tested `develop` commit SHA (full) | |
| Previous production `main` SHA | |
| Release manager | |
| Owner approver | |
| Staging application origin | |
| Staging Supabase project ref | |
| Production application origin | `https://campusintell.com` |
| Production Supabase project ref | |

### Gate record fields

Every gate records all six fields. Rows within a gate may share a gate-level entry when
the environment and commit are identical; otherwise record them per row.

| Field | What to record |
| --- | --- |
| Tested commit SHA | The full SHA the check ran against. For hosted checks, the SHA of the deployment, not the local branch. |
| Environment | `local`, `staging` or `production`, plus the exact application origin and Supabase project ref where applicable. |
| Evidence | Where the proof lives: verifier summary, sanitized screenshots, header dumps, private delivery IDs, provider event references. Never OTP bodies, codes, tokens, passwords, cookies, secrets or raw recipient lists. |
| Status | `PASS`, `FAIL`, `BLOCKED` or `SKIP` (see definitions). |
| Reviewer | Who executed and reviewed the check. |
| Approval | Who accepted the gate result and when; the owner for gates 7 and 8. |

### Status definitions

| Status | Meaning |
| --- | --- |
| `PASS` | The check ran against the tested commit in the stated environment and every required result was observed. |
| `FAIL` | The check ran and a required result was not observed. A `FAIL` blocks promotion until fixed and re-run, or explicitly waived by the owner in gate 7 with the reason recorded. |
| `BLOCKED` | The check could not run: missing access, missing service, unavailable inbox or provider, unsupported feature. `BLOCKED` is never recorded as `PASS` and never as `SKIP`. It blocks promotion until resolved or waived by the owner in gate 7. |
| `SKIP` | Legitimate only when the check is not applicable to this release and the reason is one of: the cited document's own scope rule (for example an optional verifier check whose paths did not change), a documented scope condition that the feature the row tests is not implemented on the tested commit (recorded as `SKIP (not applicable: <condition>)`), or a recorded owner decision. Unchanged hosted configuration is not a `SKIP` reason; it is handled by carried-forward evidence below. Lack of time, access or evidence is `BLOCKED`, not `SKIP`. |

### Evidence rules

- Follow the evidence and cleanup rules in
  [transactional email release readiness](transactional-email-release.md#repeatable-release-verification):
  disposable accounts, controlled mailboxes, cleanup afterward, no real student accounts,
  nothing secret in the record.
- Staging and production use their own Supabase project, credentials and evidence. Never
  copy local or staging secrets into production or into the release record.
- Repository tests send no external email and prove no hosted configuration. Provider
  acceptance, synthetic timestamps and SMTP acceptance are not inbox receipt.
- Historical audit records under `lib/auth/` are history, not current status. They are
  never evidence for a current gate.

### Carried-forward evidence

Configuration-only rows may reuse a prior release's verification instead of repeating the
full check, under all of these conditions:

- The row inspects configuration rather than behaviour: gate 3 rows 3.1 to 3.5, gate 4
  rows 4.1 to 4.4, and gate 6 rows 6.3, 6.4 and 6.6.
- The current hosted setting or DNS record is re-read on the day and matches a fingerprint
  recorded with the cited prior `PASS` on the same environment (a sanitized comparison of
  the setting values, or the dated DNS lookup output; never exported credentials).
- The record states `PASS (carried forward from <record>, fingerprint verified <date>)`,
  the date of the re-read, and the reviewer who approved the carry-forward.

Carried-forward evidence never replaces: hosted end-to-end tests (gate 2), real received
mail and its headers (3.6, 3.7, 4.5, 4.6), the real mailbox and failure matrix (gate 5),
production smoke tests (8B), or the production email matrix (8B.4), which can be reduced
only through the owner-approved subset recorded in 6.5a. Those rows need fresh evidence
on the tested deployment every release.

---

## Gate 1: Integrated Student App acceptance on develop before main

Purpose: prove the integrated Student App on the tested `develop` commit, including the
browser checks that the Bookmarks migration (PR #119) explicitly deferred to this gate.

Environment: `local`, from a clean worktree created with the workflow `start` command
from the tested commit, with `pnpm install --frozen-lockfile` run in that worktree.

### 1A: Repository verification

| # | Check | Required result |
| --- | --- | --- |
| 1A.1 | Worktree base equals the tested commit | `git rev-parse HEAD` matches the release header SHA; `git status --short` is empty. |
| 1A.2 | Full verifier with every optional check forced: `node scripts/dev-workflow/cli.cjs verify --db --content` with a local Supabase stack started first and stopped afterward | Application tests, workflow tests, TypeScript, production build, whitespace, SQL tests and managed-content parity all pass. The verifier's path-based auto-skip is for feature PRs; a release run forces both optional checks. A missing local service is `BLOCKED`, not `SKIP`. |
| 1A.3 | Auth isolated suites: `node --require ./lib/auth/test-loader.cjs --test lib/auth/*.test.ts lib/auth/*.test.cjs` | Pass. |
| 1A.4 | `pnpm audit --prod` | No unreviewed advisory at High or Critical severity; record any accepted advisory with the owner decision. |
| 1A.5 | Security configuration review of `next.config.mjs` against the headers expected in [Agent guidelines](../AGENTS.md) | CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Permissions-Policy present; `ignoreBuildErrors` is `false`. |

### 1B: Deferred Bookmarks browser matrix

Run against the real hydrated `/bookmarks` route (not the static harness alone) with a
signed-in account on local Supabase, or the hydrated client harness with the bookmark
API and session endpoint stubbed as the migration review did. Record which. Use a
fixture of at least 23 bookmarks including one very long title, one repository-only
course and one temporarily unavailable course so that refill, clamp and multi-page
pagination are exercised.

Behaviour rows (F1 and F2 are the independently reviewed fixes named in PR #119:
F1 pending removal with navigation and focus restoration, F2 disabled peer toggles).

| # | Check | Required result |
| --- | --- | --- |
| 1B.1 | F1 pending removal with successful navigation | Activating a row's toggle keeps the row rendered, pressed and busy until the store confirms. On confirmation the row drops, the count line updates, the page refills from the following items, and focus lands on the next toggle (the previous toggle when nothing follows). Removing the only item on the last page clamps to the previous page and focuses its last toggle. Paging during a pending write returns to the logical next bookmark page after confirmation. The shared "removed" feedback appears. |
| 1B.2 | F1 failure and focus restoration | With the remove request failing (for example a 503 on the bookmark write while the session check stays healthy), the row stays, the toggle stays pressed, focus remains on that same toggle, the shared failure copy appears, nothing is removed from confirmed state and nothing is written to anonymous device storage. A second confirmed store update during a pending write still focuses a stable neighbour. |
| 1B.2a | F1 failure after pending pagination | Run with 11 and with 21 bookmarks, as the repository regression does: start removal of the second bookmark on page one; while the request is pending, navigate to the last page (the original toggle unmounts, the count does not change optimistically, no mutation focus is applied); then make the removal request fail. Required result: the pager returns to page one, the bookmark is still present and the count is unchanged, the shared failure feedback appears, focus lands on the newly mounted toggle for that same bookmark (a new element, not the unmounted original), that toggle is enabled, and every toggle is pressed, not busy and not disabled. Run the same sequence with a confirmed removal and verify the next bookmark's toggle receives focus and the count drops by one. |
| 1B.3 | F2 disabled peer toggles | While one removal is pending every other toggle is disabled and repeated activation of the pending toggle is ignored. If focus was on a peer toggle, it moves to the initiating toggle before the peer is disabled, so focus is never lost to `body`. Peers re-enable after the write settles. |
| 1B.4 | Final bookmark removal and EmptyState | Removing the last bookmark leaves the success feedback mounted, renders the shared `EmptyState` with its heading receiving focus, removes the count line, and offers real "Browse Courses" and "My Courses" destinations. |
| 1B.5 | 10 items per page and ordering | Exactly ten logical bookmarks per page at every viewport width; the count shows the whole set, not the page. Rows follow bookmark snapshot order, deduplicated, never re-sorted. In account mode keys are content keys; in signed-out local mode legacy device keys resolve by slug or code. |
| 1B.6 | Pagination below 1200px | Previous/Next controls plus the live "Page x of y" position text; page-number list hidden. Disabled Previous/Next at the bounds remain real buttons. Changing page focuses the count head and scrolls it into view; smooth scrolling becomes instant under reduced motion. |
| 1B.7 | Pagination at and above 1200px | Centered page numbers visible, position text hidden, current page marked `aria-current="page"`, bounded number list with gaps for more than seven pages, at least 44px control width. Same focus and scroll behaviour as 1B.6. |

Viewport rows. Run every behaviour row above at 390×844 and 1280×800, and run the layout
checks below at all five sizes. Record one sanitized screenshot per size per state
(loading, populated multi-page, failure feedback, empty).

| # | Viewport | Required result |
| --- | --- | --- |
| 1B.8 | 390×844 | Phone composition: 56px header, 16px gutter, single-column register bounded at 760px, no horizontal scroll, every control at least 44px high, compact pagination. |
| 1B.9 | 390×667 | Same as 1B.8 on the short phone height; feedback and pagination remain reachable without clipping. |
| 1B.10 | 834×1194 | Tablet composition: 64px header with direct Courses and Bookmarks links, 24px gutter, compact pagination (below 1200px). |
| 1B.11 | 1280×800 | Desktop composition: 72px header, 32px gutter, numbered pagination (at or above 1200px). |
| 1B.12 | 1440×900 | Wide desktop: 32px gutter (40px applies only from 1600px), `app-container` bounded at 1280px, numbered pagination. |

Quality rows.

| # | Check | Required result |
| --- | --- | --- |
| 1B.13 | Accessibility | Full keyboard path through rows, toggles and pagination. Each row is a course link and a sibling toggle, two independent targets, nothing nested. Toggles are named "Bookmark {title}" with `aria-pressed`. Visible focus ring on keyboard focus (a restored focus after a mouse click correctly shows no ring). Feedback carries status or alert semantics; the pagination position is a polite live region; the register is labelled "Bookmarked courses". Motion stops under reduced motion. |
| 1B.14 | Long titles | The long-title fixture wraps inside the row without overflow at all five viewports; the toggle name still contains the full title; repository-only rows show the shared label and no code. |
| 1B.15 | Hydration | No hydration mismatch or React warnings in the console. Loading state shows the shared message and a ten-row single-column skeleton, then the data. A failed session check shows the "Bookmarks temporarily unavailable" notice with a working "Try again". |
| 1B.16 | Locked-design fidelity | Lede, loading message, count line, density, spacing and colour roles match the approved Student App design reference and [student design foundation](student-design-foundation.md); no Bookmarks-local palette or copy. |

### 1C: Integrated Student App regression

The earlier migrations (All Courses PR #116, Course Detail PR #117, Practice PR #118)
were verified individually. Run a short integrated pass at 390×844 and 1280×800 on the
tested commit.

| # | Check | Required result |
| --- | --- | --- |
| 1C.1 | Signed-out and signed-in navigation | Phone drawer, tablet links and desktop navigation reach Courses, Bookmarks, Practice and Account; Escape returns drawer focus to its toggle. |
| 1C.2 | All Courses | Search, applicability filters and pagination work; one result per institutional course. |
| 1C.3 | Course Detail | Approved responsive layout; bookmark toggle on the course page updates the shared store and the Bookmarks page without reload. |
| 1C.4 | Practice | Start, answer, submit and review one attempt; timer and question navigator work at both sizes. |
| 1C.5 | Cross-page bookmark state | A bookmark added on Course Detail appears on Bookmarks in snapshot order; anonymous device bookmarks are imported into the account after sign-in without duplicates, and account state is never copied back into device storage. |

### 1D: View-only official course materials

Product rule: students read official CampusIntell materials on-platform. Official source
files are not offered for download, and the application offers no print, export or
save-as-PDF action for them. This limits distribution of the original files; it does not
prevent ordinary browser printing, screenshots, copying or transcription of what is
displayed, none of which can be guaranteed prevented, and no row below may be recorded as
proving that they are.

"Official material" means content CampusIntell publishes as its own: course notes, theory
questions, past questions and any file-backed material served through a reading surface.
It excludes a student's personal uploads, AI-assisted uploads and external references,
which this rule does not govern.

Access rule in force: a protected learning surface renders only for a live, verified
student session with a completed academic selection (department, level and semester),
enforced server-side by the shared student access gate. Institutional applicability and
the selected department, level and semester shape what is presented and which notices
appear; they are academic context, not paid-access entitlements, and no row below may
require denying a signed-in student official material on the basis of that selection.
Plan-based entitlement is not implemented on the current codebase; entitlement-specific
checks are recorded as `SKIP (not applicable: plan entitlement not implemented on <SHA>)`
until a release ships it, never as an unexplained `PASS`.

Run at 390×844 and 1280×800 on the tested commit; run 1D.5 at all five viewports from
1B. Where the tested commit serves no file-backed official material yet, record 1D.1 and
1D.2 against the existing reading surfaces (Course Detail notes, theory questions and the
Materials request pages) and note that no file store exists.

| # | Check | Required result |
| --- | --- | --- |
| 1D.1 | No download, print, export or save-as-PDF action | No student-facing download link, button or `download` attribute, and no in-app print, export, "save as PDF", "open original" or "save" action for official material on Course Detail, notes, theory, Materials or any reading surface, including action menus and keyboard shortcuts the application itself registers. No response for official material carries `Content-Disposition: attachment`. Unrendered legacy resource entries in the course data (file size and download counts) stay unrendered or are removed; no row renders them. The browser's own print, screenshot and copy functions are outside this row and are not claimed to be blocked. |
| 1D.2 | No permanent public original-file URLs | No official source file under `public/`, in a public storage bucket, behind a long-lived signed URL, or exposed as an original-file URL in HTML, API responses, network traffic or client bundles. Any file-backed read is server-mediated, bound to the current session, and time-limited; record the mechanism and its expiry. |
| 1D.3 | Authentication on protected reads | Every protected official-material read crosses the student access gate server-side (route handler or server component, never a client-only check): live verified session and completed academic selection. Institutional applicability and course availability change presentation and notices only, as the course read model does today. Any material table or bucket denies anonymous access through row-level security or equivalent. |
| 1D.3a | Plan entitlement on protected reads | Applies only once plan-based entitlement ships. Then: a signed-in student without the required plan is denied the entitled material server-side with no content body, and the denial is not based on department, level, semester or applicability. Until then record `SKIP (not applicable: plan entitlement not implemented on <SHA>)`. |
| 1D.4 | Signed-out and unauthorised direct access denied | A direct request to a protected reading route or material endpoint without a session is redirected to login with a safe internal return path, or answered 401/403, and the response carries no official material content. A signed-in student whose academic selection is incomplete is redirected to profile selection without material content. A revoked session is treated as signed out. Protected reading pages are `noindex`. |
| 1D.5 | Accessible and responsive in-platform reading | At all five viewports the reading surface reflows without horizontal scroll, keeps 44px controls and the gutter rhythm from [student design foundation](student-design-foundation.md), exposes headings and landmarks, is fully keyboard reachable with visible focus, remains readable at 200% text zoom, and stops motion under reduced motion. |
| 1D.6 | Separation from personal uploads and external references | Official material is labelled as CampusIntell's and is stored, served and presented separately from students' personal or AI-assisted uploads and from external references. No personal upload or external link is presented as official, and no official file is routed through a personal upload path. The private material request and share email handoffs remain separate and never return official files. |

Gate 1 record: tested SHA, environment, evidence, status, reviewer, approval.

---

## Gate 2: Hosted staging end-to-end

Purpose: prove the tested commit on hosted staging with the staging Supabase project,
before any email-specific gates.

Environment: `staging` (exact approved staging application origin and staging Supabase
project ref from the release header).

| # | Check | Required result |
| --- | --- | --- |
| 2.1 | Deployment identity | The staging deployment is built from the tested commit SHA; record the deployment URL/ID. |
| 2.2 | Application variables | Every variable in the application deployment list of [transactional email release readiness](transactional-email-release.md#application-deployment) is set for staging; `NEXT_PUBLIC_SITE_URL` equals the exact staging origin and was present at build time; secrets have no `NEXT_PUBLIC_` names; `STUDENT_AUTH_ENABLED` state recorded. |
| 2.3 | Database ledger | Every migration under `supabase/migrations/` on the tested commit is applied to the staging project; the recovery-expiry cron job is enabled and running. Record the latest applied migration name. |
| 2.4 | Security headers | Response headers on `/` and `/api/auth/session` match `next.config.mjs` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy; `/api/*` returns `Referrer-Policy: no-referrer`). |
| 2.5 | Public pages | Home, Contact and a 404 render signed-out with the staging canonical origin in metadata and no student session cookie set. |
| 2.5a | Protected Student App routes, signed out | All Courses, Course Detail, Bookmarks, Materials and Practice: a signed-out direct request is redirected to login with a safe internal `next` for that route, the redirect response carries no course, note, theory, quiz or bookmark content, and the routes are `noindex`. A signed-in student with an incomplete academic selection is redirected to profile selection. |
| 2.5b | Protected Student App routes, authenticated | After sign-in with a completed selection the same routes render for that student: All Courses lists the catalogue, Course Detail shows the course's published sections and notices, and the content a signed-out request could not see is now present. |
| 2.6 | Signup and confirmation journey | Controlled new recipient: neutral initiation, no session before verification, correct code establishes the HttpOnly session and follows the profile gate. Run the signup rows of the [manual application matrix](transactional-email-release.md#manual-application-and-mailbox-matrix). |
| 2.7 | Recovery journey | Run the recovery initiation, verification, password replacement and session revocation rows of the same matrix. Repeat the hosted global revocation check required by [Student authentication](../lib/auth/README.md#verified-recovery-authorization). |
| 2.8 | Origin and limits | A POST to an auth endpoint from a non-canonical origin is rejected; recipient-independent application limits return 429; Auth IP forwarding is enabled so server requests are not bucketed on one provider IP. |
| 2.9 | Bookmarks on hosted data | Signed in on staging: add, list across two pages, remove, final removal to `EmptyState`; anonymous device bookmarks import into the account after sign-in without duplicates. |
| 2.10 | Practice on hosted data | One attempt recorded and reviewable; question report submits. |
| 2.11 | Logout and revoked session | Logout clears the SSR cookies; a retained revoked-session JWT is denied on account-owned routes. |
| 2.12 | Cleanup | Test users and attempts removed or recorded as retained controlled accounts; no real student data touched. |
| 2.13 | Official materials on hosted data | For one official material per reading surface on staging: a signed-out direct request is denied as in 1D.4 with no material content in the response; a signed-in student with an incomplete academic selection is redirected to profile selection; a signed-in student with a completed selection reads it in-platform at 390×844 and 1280×800 with no in-app download, print, export or save-as-PDF action; response headers carry no `Content-Disposition: attachment`; the page, its network traffic and its bundles expose no public original-file URL; any server-mediated file URL expires as recorded in 1D.2. Plan-entitlement denial is `SKIP (not applicable)` until implemented, as in 1D.3a. |

Gate 2 record: tested SHA (deployment), environment, evidence, status, reviewer, approval.

---

## Gate 3: Hosted transactional email and provider acceptance

Purpose: confirm the staging Supabase Auth and Resend configuration matches the approved
contract. The contract and settings are defined in
[transactional email release readiness](transactional-email-release.md); this gate only
records that each item was verified.

Environment: `staging` Supabase project and the staging Resend credential scope.

| # | Check | Required result |
| --- | --- | --- |
| 3.1 | Custom SMTP | Supabase Auth uses custom SMTP `smtp.resend.com`, port 465 (TLS), username `resend`, this environment's private credential; the built-in mail service is not relied on. Verified by inspection without exporting credentials. |
| 3.2 | Approved identity | Sender name `CampusIntell`, From `no-reply@auth.campusintell.com`; auth mail separate from marketing; click and open tracking disabled for auth messages. |
| 3.3 | Hosted templates | Confirm sign up and Reset password subjects and bodies match `supabase/templates/confirmation.html` and `recovery.html`; bodies show `{{ .Token }}` as text with no link, no `{{ .TokenHash }}` and no `{{ .ConfirmationURL }}`. A default-template fallback is `FAIL`. |
| 3.4 | Auth policy | Email confirmation enabled; minimum password length 8; numeric OTP length and expiry recorded and compatible with the app's numeric, maximum-32-character input; Site URL equals the staging origin; no broad redirect wildcards added. |
| 3.5 | Quotas and limits | Project send quota, recipient cooldown, verification limits and direct Auth API limits reviewed and recorded as a production-appropriate policy, not the local test settings. |
| 3.6 | Reply-To gate | A real received confirmation and a real received recovery message carry `Reply-To: hello@campusintell.com` through the native Supabase/Resend SMTP path. If the path cannot set the header, record `BLOCKED` and obtain the approved solution before launch; do not change From, add an SDK or switch providers silently. |
| 3.7 | Provider records | SMTP-sent messages appear in Resend email records with sent/delivered status; delivery IDs recorded privately; alert ownership for failed, bounced, complained and suppressed events named. |

Gate 3 record: tested SHA (deployment the mail was triggered from), environment,
evidence, status, reviewer, approval.

---

## Gate 4: DNS and email authentication

Purpose: confirm the sending domain and authentication records for the environment under
test. Record values come from Resend and existing DNS, never from this document.

Environment: the DNS zone for `campusintell.com` and the Resend domain record for
`auth.campusintell.com`. Staging and production share the zone; record which Resend
credential scope was verified.

| # | Check | Required result |
| --- | --- | --- |
| 4.1 | Domain verification | `auth.campusintell.com` shows verified in Resend for the credential scope in use. |
| 4.2 | SPF, DKIM, return-path | The exact records Resend issued are present; existing DNS was checked first; no duplicate SPF records; no invented selectors or values. |
| 4.3 | DMARC | An aligned DMARC policy with reporting exists for the From domain, appropriate to existing legitimate mail sources; enforcement tightened only after headers validate. |
| 4.4 | Receiving mail preserved | Existing MX and receiving records for `campusintell.com` are unchanged; `hello@campusintell.com` still receives mail. |
| 4.5 | Authentication-Results | On a real received confirmation and recovery message: SPF pass, DKIM pass, DMARC alignment and pass with the approved From domain. Record the return-path and DKIM signing domain privately. |
| 4.6 | Support inbox ownership | `hello@campusintell.com` has a named monitoring owner; an actual reply to an auth message reaches it. Material requests to `campusintell@gmail.com` remain separate. |

Gate 4 record: tested SHA (if a deployment triggered the test mail), environment,
evidence, status, reviewer, approval.

---

## Gate 5: Real mailbox delivery and failure matrix

Purpose: observe real delivery and real failure behaviour in controlled inboxes. The row
definitions and required evidence are the
[manual provider/delivery matrix](transactional-email-release.md#manual-providerdelivery-matrix);
record a status per row here.

Environment: `staging`. Procedure note from the hosted audits: after any OTP send that
needs manual inbox input, stop, obtain the code, and run nothing else until it arrives,
so expiry is never mistaken for a failure.

| # | Row | Status fields |
| --- | --- | --- |
| 5.1 | Real inboxes: confirmation and recovery arrive in at least two controlled inboxes on different providers; delay and spam placement recorded; newly configured provider tested, not historical mail. | |
| 5.2 | Identity and replies: approved From display/address and exact Reply-To observed; a reply reaches the monitored support inbox. | |
| 5.3 | Authentication: `Authentication-Results` inspected (cross-reference gate 4.5). | |
| 5.4 | Delayed delivery: delay event observed and later receipt or failure recorded; a code older than its expiry fails. | |
| 5.5 | Provider rejection: private Auth/provider failure correlated with the neutral public initiation; code verification stays secure; operators can recognise and resolve the fault. | |
| 5.6 | Bounce, complaint and suppression: observed through Resend event-test recipients; the operational alert and recovery procedure verified, not a fabricated delivery result. | |
| 5.7 | Capacity and separation: sender quotas and cooldown reviewed against expected release volume; staging credentials cannot exercise production authority. | |
| 5.8 | Application matrix on real mail: signup, signup repetition, confirmation resend, recovery initiation, recovery verification, password replacement, session revocation and continuation rows of the [manual application matrix](transactional-email-release.md#manual-application-and-mailbox-matrix) executed end to end with real codes. | |
| 5.9 | Cleanup: owned test users and data removed or recorded; no OTP body, password, token or cookie in the record. | |

Gate 5 record: tested SHA (deployment), environment, evidence, status, reviewer, approval.

---

## Gate 6: Production-readiness and reconciliation

Purpose: confirm production configuration is reconciled with the tested commit before
promotion, without changing production behaviour yet. Read-only inspection unless an
approved operations step is recorded.

Environment: `production` configuration (Vercel production environment, production
Supabase project, production Resend credential scope).

| # | Check | Required result |
| --- | --- | --- |
| 6.1 | Application variables | Every variable in the application deployment list is set for production with production values; `NEXT_PUBLIC_SITE_URL` is `https://campusintell.com`; `AUTH_INTERNAL_SECRET` and `SUPABASE_SECRET_KEY` are distinct from staging; no secret under a `NEXT_PUBLIC_` name; `STUDENT_AUTH_ENABLED` planned value recorded and enabled only after the production gates pass. |
| 6.2 | Database ledger | Every migration on the tested commit is applied to the production project, or the exact list still to apply is recorded with the approved operations step and order. Recovery-expiry cron job enabled. Hosted ledger state is recorded from the project, not inferred from the repository. |
| 6.3 | Supabase Auth configuration | Gate 3 items 3.1 to 3.5 reconciled on the production project with the production Resend credential, without exporting credentials. Any difference from staging is listed and approved. |
| 6.4 | Resend and DNS | Gate 4 reconciled for the production credential scope; domain verified; records present; DMARC policy recorded. |
| 6.5 | Reply-To and support inbox | Gate 3.6 and 4.6 outcomes carried over; a `BLOCKED` Reply-To gate blocks launch of student auth. |
| 6.5a | Production email matrix scope | Record, before promotion, whether gate 8 will run the full production email matrix (the default required by [transactional email release readiness](transactional-email-release.md#repeatable-release-verification)) or an owner-approved production subset. A subset is valid only when the owner records it here with every omitted gate 5 row listed as `SKIP (owner decision)` and the reason; rows 8B.5 and 8B.6 can never be omitted. |
| 6.6 | Rate-limit policy | Production quotas, cooldown and Auth API limits match the policy reviewed in 3.5 and the table in [Student authentication](../lib/auth/README.md); IP forwarding enabled. |
| 6.7 | Dependency and security posture | `pnpm audit --prod` from gate 1A.4 accepted; no open Critical or High finding under the [severity rubric](../AGENTS.md#severity-rubric); `SECURITY.md` contact channels still valid. |
| 6.8 | Monitoring and ownership | Owners named for: Vercel deployment, Supabase Auth logs and server diagnostics (bounded outcome events only), Resend events, support inbox. Where each will be watched after promotion. |
| 6.9 | Rollback plan | Written and approved before promotion: (a) application rollback by redeploying or promoting the previous production deployment (previous `main` SHA in the release header); (b) `STUDENT_AUTH_ENABLED=false` redeploy as the auth kill switch; (c) for each migration applied since the previous production release, whether a reviewed reversal exists or it is accepted as forward-only, and confirmation that the previous build is compatible with the current schema; (d) who can execute each step and the decision criteria from gate 8. |
| 6.10 | Test data and evidence hygiene | No staging test accounts or local secrets in production; release record contains no secrets, codes, tokens or raw recipient lists. |

Gate 6 record: tested SHA, environment, evidence, status, reviewer, approval.

---

## Gate 7: Final develop-to-main approval

Purpose: the promotion decision. Nothing below changes production.

| # | Check | Required result |
| --- | --- | --- |
| 7.1 | Gate roll-up | Gates 1 to 6 each have a recorded status. Every row is `PASS` or legitimate `SKIP`. Any `FAIL` or `BLOCKED` is listed here with the owner's explicit written waiver and the follow-up owner and date; without a waiver the release stops. |
| 7.1a | Waiver limit for student auth | A general release waiver promotes code only. It never authorises `STUDENT_AUTH_ENABLED=true` in any environment while a transactional-email gate required by [transactional email release readiness](transactional-email-release.md) is `FAIL` or `BLOCKED`: gate 3 (SMTP, identity, templates, OTP policy, quotas, Reply-To), gate 4 (DNS and authentication), gate 5 (real mailbox and failure matrix) or their production reconciliation in 6.3 to 6.5a. Student auth stays disabled until those gates pass on the target environment. |
| 7.2 | Commit identity | `origin/develop` HEAD equals the tested commit SHA. If `develop` moved after testing, record the new SHA and re-run every gate whose inputs changed; a documentation-only change may be accepted with the owner's recorded decision. |
| 7.3 | Pull request | A PR from `develop` into `main` exists, references this release record, and its CI is green. `main` is never force-pushed. |
| 7.4 | Owner approval | The repository owner (@Teetoh861) approves the PR and this record; approval names the SHA being promoted. |
| 7.5 | Merge | Merge performed by a human; record the resulting `main` merge commit SHA and time. |

Gate 7 record: promoted SHA, `main` merge SHA, environment `n/a`, evidence (PR link),
status, reviewer, approval.

---

## Gate 8: Post-promotion production deployment and smoke testing

Purpose: verify the production deployment that resulted from the merge to `main`. This
gate starts only after gate 7.5 records the merge SHA.

Production email scope: [transactional email release readiness](transactional-email-release.md#repeatable-release-verification)
requires the same matrix to run for production in a separately authorised gate. By default
8B therefore repeats gate 5 against production (the provider/delivery rows and the
application rows, with production controlled recipients and the production Resend
credential scope). Only an owner-approved production subset recorded in 6.5a may reduce
that run, and never below rows 8B.5 and 8B.6. Every omitted row is recorded as
`SKIP (owner decision)`, not left blank.

Environment: `production` (`https://campusintell.com`, production Supabase project).

### 8A: Deployment

| # | Check | Required result |
| --- | --- | --- |
| 8A.1 | Deployment identity | The production deployment is built from the `main` merge SHA from gate 7.5; record the deployment URL/ID and time. |
| 8A.2 | Pending operations steps | Any migration or hosted configuration step recorded in 6.2 to 6.4 as still to apply has now been applied in the approved order, by the named operator, and recorded. |
| 8A.3 | Variables at build | `NEXT_PUBLIC_SITE_URL` was `https://campusintell.com` at build time; `STUDENT_AUTH_ENABLED` holds its approved value. |

### 8B: Smoke tests

| # | Check | Required result |
| --- | --- | --- |
| 8B.1 | Public pages | Home, Contact and a 404 render signed-out with `https://campusintell.com` as the canonical origin in metadata and no student session cookie set. |
| 8B.1a | Protected routes, signed out | All Courses, one Course Detail, Bookmarks, Materials and Practice: a signed-out direct request is redirected to login with a safe internal `next`, the response carries no protected learning content, and the routes are `noindex`. |
| 8B.1b | Protected routes, authenticated | After the controlled signup in 8B.5 completes its academic selection, All Courses and that Course Detail render for the controlled account with their published content present. |
| 8B.2 | Security headers | Same expectations as gate 2.4 on the production origin, including HSTS and the `/api/*` referrer policy. |
| 8B.3 | Session endpoint | `/api/auth/session` returns the expected enabled/signedIn booleans for a signed-out visitor; `/bookmarks` redirects signed-out visitors to login. |
| 8B.4 | Production email matrix | Run the gate 5 rows against production as scoped in 6.5a: full matrix by default, or the recorded owner-approved subset with each omitted row marked `SKIP (owner decision)`. Same evidence rules as gate 5; production credentials and recipients only. |
| 8B.5 | Controlled signup (never omitted) | One controlled recipient: neutral initiation, real confirmation mail received with the rendered code and no link, Reply-To present, correct code establishes a session; `Authentication-Results` pass. |
| 8B.6 | Controlled recovery (never omitted) | One controlled recovery: code received, recovery grant only, password replaced, old sessions revoked, old password fails. |
| 8B.7 | Bookmarks and Practice | Signed in: bookmark add/list/remove including the `EmptyState`; one Practice attempt recorded. |
| 8B.8 | Official materials | Repeat gate 2.13 on production: signed-out and unauthorised direct access denied, signed-in reading renders in-platform, no attachment disposition, no public original-file URL reachable. |
| 8B.9 | Logout | SSR cookies cleared; account routes deny the revoked session. |
| 8B.10 | Provider and logs | Judge every 8B.4 to 8B.6 message by the stage its test is designed to reach, using the event lifecycle named in [transactional email release readiness](transactional-email-release.md#resend-and-dns) (sent, delivered, delayed, failed, bounced, complained, suppressed) as the contract. Successful delivery (real inboxes, identity and replies, delayed delivery, controlled signup and recovery): provider acceptance, a delivered event, real inbox receipt, the recorded delivery delay and passing `Authentication-Results`. Provider rejection: when the provider refuses the message at submission, the neutral public initiation response plus a bounded private diagnostic (failed or exception) and no provider record expected; when the provider accepted the message and then rejected it, the matching failed event. Transport failure before provider acceptance: the neutral public response and the application's transport diagnostic only; no provider event is required because none can exist. Bounce: provider acceptance followed by a bounced event and no inbox receipt. Complaint: delivery legitimately precedes the complaint; the test passes when the delivered-then-complained sequence and the complaint event are confirmed for the test recipient. Suppression: the provider's documented outcome for a suppressed recipient (refused at submission or recorded as suppressed) with no delivery. Bounce, complaint and suppression events are asynchronous and are read from the provider's records, never expected in the synchronous send-time diagnostic. A negative test is never `FAIL` solely because delivery occurred earlier in its valid lifecycle; it is `FAIL` when its expected terminal outcome or event is absent. Outside these planned negatives, Supabase Auth logs and server diagnostics show no unexpected failed, exception or limited outcomes. |
| 8B.11 | Cleanup | Controlled production test accounts removed or recorded as retained; nothing secret in the record. |

### 8C: Watch window and rollback decision

| # | Check | Required result |
| --- | --- | --- |
| 8C.1 | Watch window | Owners from 6.8 watch deployment errors, Auth outcomes, Resend events and the support inbox for the agreed window (record its length). |
| 8C.2 | Rollback criteria | Rollback is executed if any of: a smoke row above fails and cannot be fixed forward within the window; confirmation or recovery mail is not arriving for controlled recipients; auth sessions are created or retained incorrectly; a Critical or High security finding appears. |
| 8C.3 | Rollback execution (if triggered) | Execute the plan from 6.9: promote or redeploy the previous production deployment, or set `STUDENT_AUTH_ENABLED=false` and redeploy, as the criteria dictate. Record what was executed, by whom, when, and re-run 8B.1 to 8B.3 against the rolled-back deployment. |
| 8C.4 | Close-out | Release record completed with the final status of every gate, the production deployment ID, the watch-window outcome, any rollback, and open follow-ups with owners. |

Gate 8 record: deployed `main` SHA, environment, evidence, status, reviewer, approval.

---

## Appendix: gate record template

Copy one block per gate (or per row where environments differ).

```text
Gate:            <number and title>
Tested SHA:      <full commit SHA, or deployment SHA for hosted checks>
Environment:     <local | staging | production>, <origin>, <Supabase project ref>
Evidence:        <location of sanitized evidence>
Status:          <PASS | PASS (carried forward from <record>, fingerprint verified <date>, approved by <reviewer>) | FAIL | BLOCKED | SKIP (reason: scope rule | not applicable: <condition> | owner decision)>
Reviewer:        <name, date>
Approval:        <name, date>
```
