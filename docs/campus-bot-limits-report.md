# Campus Bot limits: full report

2026-11-03. Branch: `feat/campus-bot-limits`. Original 2b baseline: `4986919`; review fixes: `25b52dc`.
This report includes the subsequent owner decision that Early Access receives Standard limits during its free month.
It supersedes `campus-bot-limits-review-report.md`. Earlier SQL results do not validate the revised tier selector.

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
database and are removed in cleanup; production has no override. These races remain unrun.

## Checks on this follow-up

Preflight found a clean worktree at `25b52dc`, no Docker containers and no matching heavy-check processes. Power was
11%, later falling to 1%, so the standing low-power rule permitted only light checks and a commit. Charging was not
waited on and no stack was started in this follow-up.

| Check | Status | Evidence / remaining work |
| --- | --- | --- |
| TypeScript | PASS | Node 22, `tsc --noEmit --incremental false`. |
| Campus Bot usage-reader unit tests | PASS | 3 tests, zero failures/skips; these check response parsing, not SQL tier selection. |
| Diff whitespace | PASS | `git diff --check`, including the staged new files before commit. |
| New Standard-tier migration installation | BLOCKED | Not applied: no stack started below 20%. |
| Updated `campus_bot_limits.test.sql` | BLOCKED | Revised Standard/mixed-plan assertions have not been executed. |
| Full 42-file pgTAP suite on a fresh database | BLOCKED | Full rerun still owed after the earlier corrected expectation and the new tier migration. |
| Full application unit suite | BLOCKED | Still owed under the exclusive heavy-check/power rules. |
| `lib/payments/campus-bot.database.test.cjs` | BLOCKED | All eight races remain owed, one file at a time. |
| `lib/courses/access-part-2.database.test.cjs` | BLOCKED | Still owed on the isolated stack, separately. |
| `lib/courses/access-readonly.database.test.cjs` | BLOCKED | Still owed; needs the isolated stack's local API status JSON. |
| `lib/payments/payments-server.database.test.cjs` | BLOCKED | Still owed against the isolated local API, fake provider only. |
| Theory “Submit and compare”, 375px | BLOCKED | No real browser run or inspected screenshots yet. |
| Theory “Submit and compare”, 1280px | BLOCKED | No real browser run or inspected screenshots yet. |
| Full verifier | NOT RUN | Assigned to CI on the owner's push; no local verifier or push. |

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
afterwards. No browser was launched for this work and no screenshots have been captured or inspected.

## Owed execution order

At 20% or more, first check `ps` and `docker ps` and use the shared heavy-check slot alone. Run the full application
unit suite and the full pgTAP suite on a fresh isolated database including `20261103160000`. Run the 2b race file,
both named A2 files, and the payments server database test separately. Complete theory submission at 375px and
1280px after loading settles and inspect the screenshots; the prepared fixture also checks the real student RPC,
the committed theory-use marker, and that the draft stays in the browser. Stop/discard only this work's stack.
The full verifier remains assigned to CI.

## Existing observation outside these fixes

`private.has_full_access` compares grant bounds with transaction `now()`
(`supabase/migrations/20261021100000_discovery_pass.sql:91`); `discovery_preview` calls it after its lock wait
(`20261103100000_campus_bot_limits.sql:620`). A grant starting or expiring during that wait can leave this Discovery
full-access decision stale. The single-transaction fixture exposed the start-time case; its explicit grant fixture
represents a separate follow-up HTTP read. The queued race was not run. A follow-up should use the final wall clock
for this decision under the existing opening and add start/expiry races. This helper was not changed in this round.

No hosted database, AI/payment provider, SMS/email service or official question-bank source was touched. There was
no push, merge or deployment. The changes are a follow-up on `25b52dc`, with the requested commit message and no trailers.
