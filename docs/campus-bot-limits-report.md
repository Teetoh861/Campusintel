# Campus Bot limits: full report

Implementation: 2026-11-03. Validation: 2026-11-04. Branch: `feat/campus-bot-limits`.
Original 2b baseline: `4986919`; review fixes: `25b52dc`; validated owner-decision commit: `0de367b`.
This report includes the subsequent owner decision that Early Access receives Standard limits during its free month.
It supersedes `campus-bot-limits-review-report.md`. The latest local SQL and race results below validate the revised
tier selector. Historical results remain separately labelled.

## Current behaviour

Limits come live from `private.campus_bot_tiers`; these are the repository defaults, not fixed application values.

| Active funding | Selected tier | Session tokens / 5 hours | Week tokens / 7 days |
| --- | --- | --- | --- |
| Early Access | Standard | 350,000 | 700,000 |
| Paid Standard | Standard | 350,000 | 700,000 |
| Paid Standard plus Early Access | Standard, Early Access funds the equal-tier tie | 350,000 | 700,000 |
| Paid Plus plus Early Access | Plus, paid plan funds | 700,000 | 1,400,000 |

Limits are never added together. Paid Plus retains its limits after Early Access ends. An active paid grant qualifies
the account for the paid platform reserve even when Early Access funds an equal Standard tier. Early Access alone
does not qualify for that reserve. Changing the selected live tier does not reset existing windows or erase usage.

Each delivered set costs `(read + 5 × written) × model weight`, using the provider's usage report; read includes input,
cache reads and cache writes. Model, caps and weights are copied at admission. Failures, timeouts, unusable and
abandoned results cost zero. There are at most ten undelivered tries per student per UTC day. The platform permits
500 admissions per UTC day, reserving the last 150 for accounts with active paid funding; daily zero stops everyone.

Session and week windows start at their first admitted request and keep their stored ends. Admission requires both
windows to cover the reservation estimate. The real input cap remains 60,000 characters; `read_tokens_max` is an
estimate. A rare overrun is delivered and charged, possibly leaving a window below zero. Refills give fresh windows
on the next admission. A set admitted before access expires or is revoked can finish and remains owner-readable.
A set already abandoned is discarded even if its reply arrives later, and is charged zero.

No Discovery Pass is offered after any paid grant, including refunded grants. Buying preserves an existing free-pass
exam. A set admitted before payment does not count toward that payment's refund. Plan use is recorded against the
verified session, allowed course and published item before theory feedback is returned. GST use never counts.

## Implementation and evidence locations

1. **Early Access Standard:** `supabase/migrations/20261103160000_early_access_standard_limits.sql:5` replaces
   `private.campus_bot_plan`. Its Early Access candidate uses `standard` (`:18`), joins live tier settings and retains
   the higher-tier ordering (`:25`). Equal-tier funding preference is preserved. The function remains a pure stable
   security definer with an empty search path, closed to API roles. Earlier committed migrations are left intact;
   the new migration runs after both 2b and the review fixes.
2. **Safe abandonment:** `supabase/migrations/20261103140000_campus_bot_review_fixes.sql:3` enforces
   `reservation_minutes >= 5`; `:17` releases abandoned request records at zero. `lib/ai-practice/lifetime.ts:4`
   defines the deadlines, `service.ts:75` bounds the provider, and `supabase-env.ts:169` / `:189` bound admission and
   settlement. Admission also rejects an unsafe reservation lifetime. The conservative budget is
   `15 + 2 × 120 + 30 = 285 seconds < 300 seconds`. Abandoned replies stay discarded.
3. **Final admission clock:** the review migration `:136`, `:187` and `:193` stamp reservation, generation creation/
   retention and new windows with the same final wall clock after lock waits, including a wait across midnight.
4. **Final platform policy:** the review migration `:73` reads policy under the platform mutex;
   `admin_set_ai_limits` (`:215`) takes that same mutex before changing policy. A queued start must see daily zero.
5. **One refill snapshot:** the review migration `:134` reads the latest applicable refill once; `:154` and `:155`
   pass it to both window lookups. A refill committed after that snapshot applies to the next admission.
6. **Theory disclosure:** the review migration `:245` keeps model answers and rubrics out of the general student
   `read_published_managed_content` call while returning prompts and feedback availability. Operator publication
   inspection retains its access. The service-only `reveal_theory_feedback` (`:291`) rechecks access and publication
   identity and calls `record_plan_use` (`:321`) atomically before returning feedback.
   `lib/theory-practice/published.ts:39` sends no feedback in initial page data; `submit.ts:19` uses the trusted reveal;
   `app/courses/[slug]/theory/page.tsx:57` uses availability to offer the same prompts. Existing student copy is kept.
7. **Input estimate and operations:** `docs/payments-operations.md:113`, “Campus Bot limits”, now documents Standard
   Early Access, paid Plus winning, the independent paid reserve, the reservation floor, actual input cap, allowed
   overrun, final policy check and frozen refill snapshot.

The shortened review-migration locations above refer to
`supabase/migrations/20261103140000_campus_bot_review_fixes.sql`. The tier-only follow-up introduces no new lock,
table, write in a read helper, or shared-to-exclusive upgrade. Previously generated sets, scores and history stay intact.

## Updated tests

`supabase/tests/campus_bot_limits.test.sql:209` now expects Standard Early Access and covers:

- Early Access alone receiving 350,000 session / 700,000 week tokens, with live Standard setting changes reflected;
- paid Standard plus Early Access retaining one Standard allowance, and the usage reader showing that allowance;
- paid Plus outranking Early Access while it is active, the usage reader showing Plus, and Plus surviving its expiry;
- paid-reserve admission while equal-tier Early Access funds the request (`:274`);
- Early Access admission and charging against Standard: an allowed 361,500-token overrun leaves the 350,000-token
  session at -11,500 and refuses the next start (`:376`), which would not exhaust a Plus session.

The same SQL file retains the review regressions for matching admission timestamps, the safe reservation floor,
zero-charge discarded abandonment for all funding types, pre-payment refund-use exclusion, direct student RPCs
without theory answers, publication/access refusals, deduplicated markers, marker-failure rollback and privileges.

`lib/payments/campus-bot.database.test.cjs` retains five original races and three review races: queued midnight
admissions for the last platform slot, a queued daily-zero change, and a refill committed between the two window
lookups. These use observed lock queues. Test-only admission clones add a clock or gate solely in the guarded local
database and are removed in cleanup; production has no override. All eight races passed in the current run.

## Check results on 2026-11-04

Preflight confirmed `feat/campus-bot-limits` exactly at
`0de367bc9db0638684d86c051d788f7ce682512c`, with a clean worktree. `ps` and `docker ps` showed no other heavy check or
stack. During read-only CI inspection the battery rose above the standing 20% threshold; it was at 29% before this
work's isolated stack was started. No charging wait or below-threshold override was needed.

The isolated project was `ci-access-own-bot-review-20261103`, with database
`supabase_db_ci-access-own-bot-review-20261103` and local API `http://127.0.0.1:56951`. The database was fresh and all
migrations through `20261103160000` applied. No CLI update was performed. Database files ran sequentially; race and
server files ran one at a time. No default or hosted database was used.

Counts overlap: the 156 targeted Campus Bot assertions are included in the 3,262 full-suite assertions. CI's skipped
opt-in tests are not reported as passes; the requested database files were explicitly enabled locally.

| Check | Status | Counts and evidence |
| --- | --- | --- |
| Branch / commit / clean worktree preflight | PASS | 3/3 required conditions at `0de367b`. |
| Fresh migration installation | PASS | 1 isolated installation, including the Standard-tier migration. |
| Updated `campus_bot_limits.test.sql` | PASS | 156 assertions; 0 failures. Early Access Standard, live tier changes, paid Plus overriding Early Access, reserve eligibility, overrun/exhaustion and all review regressions passed. |
| Full pgTAP suite | PASS | 42 files, 3,262 assertions, 0 failures; includes the previously unrun final four files and the corrected practice expectation. |
| `lib/payments/campus-bot.database.test.cjs` | PASS | 8/8 tests; 0 failures/skips. Includes midnight, daily zero and between-lookups refill races. |
| `lib/courses/access-part-2.database.test.cjs` | PASS | 16/16 tests; 0 failures/skips. |
| `lib/courses/access-readonly.database.test.cjs` | PASS | 1/1 real read-only API regression; 0 failures/skips. |
| `lib/payments/payments-server.database.test.cjs` | PASS | 11/11 tests; 0 failures/skips; in-memory fake provider and isolated local API only. |
| Theory “Submit and compare”, 375px | BLOCKED | 0/1 completed flows after 5 diagnostic attempts. Focus plus CDP `Input.insertText` puts text in the textarea, but the live character count remains zero; submission could not be validated. |
| Theory “Submit and compare”, 1280px | NOT RUN | 0/1 flows attempted after the shared theory interaction blocker; stopped as instructed. |
| Screenshot inspection | PASS | 1 captured 375px failure screenshot inspected. No successful comparison or 1280px screenshots are claimed. |
| Isolated stack shutdown | PASS | 1/1 stack stopped with `--no-backup`; database discarded; `docker ps` empty afterwards. Local app and test browser also stopped. |
| Application unit suite, CI | PASS | 1,180 passed, 0 failed, 198 skipped on exact commit `0de367b`. |
| Workflow tests, CI | PASS | 41 passed, 0 failed, 0 skipped on the same commit. |
| TypeScript, CI | PASS | 1/1 gate. |
| Production build, CI | PASS | 1/1 gate. |
| SQL verification, CI | PASS | 1/1 gate; local assertion counts are recorded above. |
| Full verifier, CI | PASS | 1/1 completed successful run on exact commit `0de367b`. |
| Full verifier, local | NOT RUN | 0 runs; assigned to CI. |
| Local full application unit rerun | NOT RUN | 0 runs; the exact-commit CI result supplies the unit verification. |
| Results diff whitespace | PASS | `git diff --check` before committing the results. |

CI evidence: [PR mechanical verification, run 41691698621](https://github.com/Teetoh861/Campusintel/actions/runs/41691698621),
completed successfully on 2026-11-03 for the exact validated source commit. Its log confirms the application/workflow
counts, TypeScript, production build and SQL gates. No new hosted workflow was triggered here.

### Browser blocker and inspection

The local browser fixture uses a real confirmed test account with a paid Standard order on the isolated database and
the student's own Financial Accounting I course. A real student RPC read returned prompts/availability with no model
answers or rubrics. AI generation was disabled, external payment/AI credentials were cleared, and no external provider
was called. Before the interaction, the fixture confirmed no theory-use marker existed for its new order.

The first GUI attempt stayed on loading; later GUI diagnostics showed a hidden tab. Headless Chromium, an explicitly
active page and explicit opening of the first question rendered the prompt and answer form. Waiting for private React
properties was removed in favour of checking actual user behaviour. The final attempt focused the textarea and typed
with CDP `Input.insertText`, without assigning its value. The draft appeared, but the visible character count remained
`0 / 20000 characters`, so a working client submission could not be established. No successful feedback reveal,
browser-created use marker or draft-privacy submission result is claimed.

The inspected screenshot at `/private/tmp/campusintel-bot-review/browser/failure.png` shows the focused, populated
textarea, unchanged zero count and visible “Submit and compare” button at 375px. The page shows the student's course
context and question without exposing feedback. The precise client hydration/event cause remains unresolved; it is
not labelled as a confirmed application-code defect. The local development log also reported a font-download fallback;
no causal relationship to the interaction failure was established.

After the owner's instruction to mark theory BLOCKED if CDP typing still failed, further theory retries stopped.
The 1280px flow was not attempted. The isolated stack was stopped first, then the local app server; the temporary
browser had already exited in its cleanup. Battery was above 20% at shutdown. The only generated tracked-file change,
Next's appended `AGENTS.md` block, was restored to its exact preflight content after stopping the server.

### Changes and commits for this check round

All completed SQL, race and server checks passed without application or test-code changes. There is no
`fix: campus bot limits check failures` commit because no application-code fix was made. Browser harness diagnostics
were confined to `/private/tmp`; the repository change in this round is this results report only. The results commit
uses `docs: campus bot limits check results`, on top of `0de367b`, with no attribution trailer, amend, rebase or push.

## Earlier results at 25b52dc

These results predate the Standard decision and are historical evidence only:

- **PASS:** fresh migration installation through `20261103140000` and 150 Campus Bot pgTAP assertions.
- **PASS:** 162 practice SQL assertions after replacing the old general-read model-answer expectation with explicit
  prompt-only/no-feedback checks in `supabase/tests/server_run_practice.test.sql:151`.
- **PASS:** focused unit/UI batches of 56, 26 and 44 tests, all without failures/skips. The batches overlap and must
  not be added together. They cover deadlines, unsafe reservations, private/stale/foreign theory replies, prompt-only
  projection, publication checks, existing course labels/drafts and private route outcomes.
- **FAIL:** the initial full SQL attempt passed 37 files and stopped in file 38 on the superseded answer expectation.
  That test was corrected and passed individually; the complete rerun was not performed before the 19% cutoff.
  `student_bookmarks`, `student_first_name`, `student_request_context` and `trial_entitlements` were not reached.

The earlier shared slot was occupied by Claude's stack/browser/verifier until battery reached 26%. Only this work's
isolated stack was ever stopped. It was stopped with `--no-backup` and its database discarded; Docker was empty
afterwards. No browser was launched during that earlier low-power run. The current run's inspected failure screenshot and
remaining browser limitation are recorded above.

## Still owed

Only the theory browser validation remains unresolved: complete “Submit and compare” at 375px, then 1280px, after the
client interaction issue is resolved, and inspect the successful screenshots. The 1280px flow has not been attempted.
The database, race and server checks listed above are complete, and the exact-commit full verifier passed in CI.
The owner explicitly deferred further theory investigation once focusing and CDP typing still failed; no feature was
added or changed to work around it.

## Existing observation outside these fixes

`private.has_full_access` compares grant bounds with transaction `now()`
(`supabase/migrations/20261021100000_discovery_pass.sql:91`); `discovery_preview` calls it after its lock wait
(`20261103100000_campus_bot_limits.sql:620`). A grant starting or expiring during that wait can leave this Discovery
full-access decision stale. The single-transaction fixture exposed the start-time case; its explicit grant fixture
represents a separate follow-up HTTP read. The queued race was not run. A follow-up should use the final wall clock
for this decision under the existing opening and add start/expiry races. This helper was not changed in this round.

No hosted database, AI/payment provider, SMS/email service or official question-bank source was touched. There was
no push, merge or deployment. The validation results are recorded in a documentation-only follow-up on `0de367b`, with the requested commit
message and no trailers.
