A2 follow-up, 2 November 2026. **CI and the requested local checks are complete.** This follow-up started clean on pushed `fix/access-part-2` at `654d69a`. Its repository changes are the instant-feedback test window and this report; production code, migrations, student copy and question banks are unchanged. No push, merge, rebase, deployment, hosted-database operation or AI/payment-provider call was performed.

The required CI-first commands were run: `gh run list --branch fix/access-part-2 --limit 3`, then `gh run view 41448497377 --log-failed`. Latest run [41448497377](https://github.com/Teetoh861/Campusintel/actions/runs/41448497377) is successful on `654d69aa659397dc2e35c285637c427c0753f39d`; `--log-failed` returned no failures. Its log confirms 1,088 application passes (179 opt-in skips), 41 workflow passes, TypeScript, production build, whitespace and database PASS. The result was read again before delivery. CI refers to the published head; this follow-up remains local.

The Mac started at 53%. A2 initially waited for Payments to stop. Two later simultaneous starts were resolved by cancelling/stopping only A2 and discarding its disposable volumes. After Docker stayed empty, A2 started alone; the owner confirmed Claude would run nothing while A2's stack was up. Timings were not taken during the overlapping starts. Checks ran above 20%; there was no wait for charging.

The original branch started at `94dc1d4`. Published `654d69a` already contains the merge of develop `4539e4f`, without a rebase. Develop was still `4539e4f` when checked for this comparison. Its latest migration is `20261029163000_student_request_context.sql`, before A2's `20261101120000_course_access_part_2.sql`. No migration rename or additional merge was needed.

The start comparison used the exact develop migration chain, then A2, on the same isolated stack and Mac. Each scenario had one excluded warmup and five measured service-role calls with equivalent students/grants. Materialized CTEs bracketed `practice_start` with the database clock; Docker wall time also includes client/psql startup. Each call returned `ready` with the full 1,800-second timer; replacement calls closed the prior instant run. A2's median overhead is about 2–5 ms, with slightly lower Docker wall medians. No production speed fix was warranted.

| Version | Scenario | Database median, ms (range) | Docker call median, ms |
| --- | --- | --- | --- |
| develop `4539e4f` | Fresh exam | 41.100 (37.232–41.506) | 164.326 |
| A2 `654d69a` | Fresh exam | 43.038 (42.161–59.199) | 163.356 |
| develop `4539e4f` | Replaces instant run | 38.465 (36.341–42.460) | 159.356 |
| A2 `654d69a` | Replaces instant run | 43.201 (39.443–44.201) | 155.531 |

The owner reported load around 120 during the first instant-feedback failure, alongside Claude's full verifier. An unchanged quiet retry also failed its live-at-queue precondition (Auth-lock case, 9 passed/1 failed). Consequently, the condition for leaving the test unchanged was not met. The two-second window began before a database lookup, Docker holder startup and queue observation; it could expire before the assertion sampled the waiting request.

The fix is at `lib/quiz-attempts/instant-feedback.database.test.cjs:25` and `:319`: a named ten-second plan window, within the existing 20-second holder bound. The assertions at `:327` and `:329` still prove the plan is live once queued and actually expires before the held lock is released. No-start, preserved-run/score and full-timer assertions are unchanged. The same changed file was then run three times, separately, with no further edits:

| Instant-feedback run | Status | Tests | Elapsed |
| --- | --- | --- | --- |
| 1 | PASS | 10 passed, 0 failed, 0 skipped | 281.455 s |
| 2 | PASS | 10 passed, 0 failed, 0 skipped | 186.759 s |
| 3 | PASS | 10 passed, 0 failed, 0 skipped | 221.585 s |

These runs exercise all nine start-lock classes with session expiry, plan expiry and unchanged access. They retain the proof that expiry happens during a real lock wait, rather than accepting a plan that was already expired when the operation queued. The initial failures remain recorded; they have not been reclassified as outside A2.

| A2 item | Code | Behavior and verification |
| --- | --- | --- |
| 1. Discovery course scope | `supabase/migrations/20261101120000_course_access_part_2.sql:58`, `:96`, `:438` | Preview/title/exam, activation selection, save, submit and results require the current-semester own list; repository-only courses cannot qualify. Discovery/A2 SQL and the A2 correction race prove outside-list refusal. GST's existing free path remains. |
| 2. Free-pass exam result | Migration `:342`; `lib/entitlements/discovery-contract.ts:66`; `app/courses/[slug]/preview/[kind]/DiscoveryExam.tsx:386` | Completion, timeout and replay return score metadata, empty questions and no saved sheet, correct options or explanations. Strict contract tests reject leaked fields; SQL and concurrent preview/save/submit replays verify every read. Browser/API checks show 3/50 and the exact owner line, with no question review. |
| 3. Claim abuse | `lib/entitlements/claim-hash.ts:49`; migration `:357`, `:372`, `:438` | Tags are stripped everywhere; Gmail dots are removed and googlemail maps to gmail. New claims store canonical hashes; lookups include old/new forms and retained keys. SQL/unit tests cover aliases, old claims and throwaway suppression; the activation race proves one alias claim wins. Accepted detached-tester limitation is recorded below. |
| 4. AI documents and retained sets | Migration `:74`, `:1048`, `:1342`, `:1573`; `app/courses/ai-practice/[courseId]/page.tsx:65` | Scope plus a current AI allowance guard admission, signing, object insertion, source RLS, extraction, generation, replays and completion. SQL/A2 races cover source refusal and all five stages. Previously generated owner sets remain readable. Both browser widths open a retained set after course correction, with uploads absent; an outside-list course with no retained set redirects to My Courses. |
| 5. Scores/history/review | Migration `:574`, `:593`, `:903`, `:1031`, `:1449`; `app/courses/[slug]/quiz/QuizClient.tsx:242`, `:308`; `app/courses/[slug]/quiz/ScoreOnly.tsx:7` | Non-free past answers and instant reveals require current access; scores/history remain. Direct correctness rows still require a finished attempt. SQL/practice/A2 races prove timely submission and scoring after plan expiry, gated replays/resumes and score-only reviews. Browser checks cover direct expired review, persisted-page events, actual freeze/focus restoration and browser Back. |
| 6. Bookmarks | `app/bookmarks/page.tsx:40`; `lib/courses/read-model.ts:561`, `:587` | A1 scope filtering suppresses outside-list material/count requests, and bookmark preload skips repository-only probes. Reader/page regressions and A2 SQL/races prove suppression while records survive correction. |

The Storage INSERT trigger rechecks a reserved slot's verified session, current scope and AI window even when a previously signed URL is used later. It follows A1's shared read opening, then path/resource locks, then fresh checks. The reserved session is not an Auth FK, avoiding a late FK wait. Old pending slots without a reservation session fail closed; stored sources and generated sets remain. The final read/write openings and AI completion/resource order were reviewed; lock-matrix and A2 races passed.

| Check | Status | Evidence / scope |
| --- | --- | --- |
| Published PR #150 CI | PASS | Run `41448497377`, exact published `654d69a`; no current failed steps. |
| Full verifier: `node scripts/dev-workflow/cli.cjs verify` | PASS | Explicit own-stack CLI configuration, Node 22: 1,095 application passes, 178 opt-in skips; 41 workflow passes; TypeScript, production build, whitespace and SQL passed. Completed before the subsequent CJS-only timer change; that file was then exercised in three complete live race runs. Production code and the browser-tested build are unchanged. |
| Full SQL on a fresh isolated database | PASS | All 40 files, 2,810 assertions. Includes Discovery/aliases/throwaway services, actual correctness RLS, timely scoring after expiry, AI source/storage refusal and retained sets, GST, Early Access, legacy grants and bookmarks. |
| Touched unit/UI regressions | PASS | Previous checkpoint: 78 passes, including alias/old HMAC lookup, free-result leakage rejection, score-only API mapping, review-opening revalidation and bookmark request suppression. The full verifier also passed application tests. |
| A1 races, one file at a time | PASS | `access-scope` 7, `access-review` 18, `access-profile-deletion` 9: scope correction, read/write prefix, binding, revocation, deletion and fresh-clock behavior. |
| Practice server-run, final rerun | PASS | 8 tests, one file: authoritative starts, saves/submissions, concurrency and scoring. |
| Practice review, final rerun | PASS | 15 tests, separate file: replays, expiry, queued operations and review projection. |
| Instant-feedback, final three runs | PASS | 10/10 each; independent logs/times above. Concurrent picks/starts, unchanged receipts, overdue runs and all start-lock expiry checks remain covered. |
| A2 races, final rerun | PASS | 16 tests, separate file: Discovery correction and score-only reads, alias contention, throwaway changes, post-expiry scoring, AI source/all five stages, retained sets, instant reveal, bookmarks and Storage insertion waits. |
| Real signed-URL integration | PASS | 1 November checkpoint, same production code: own-list PUT 200; after correction, signing/download refused and an already signed PUT refused with HTTP 400. Reproducible with `scripts/ai-practice/course-access-integration.cjs` and explicit loopback settings; no provider called. |
| Browser: 375px and 1280px | PASS | Seven cases per width, 14 captures: free result, expired review, outside AI, retained set, persisted-page review, actual frozen-tab/focus restoration and browser Back. All final captures inspected; no horizontal overflow, loading skeleton or new refusal copy. |
| Browser/API answer boundary | PASS | Free score 3/50, expired score 2/5 and restored score 1/5; fresh responses have no question review/correctness/explanation fields. Retained personal practice is readable as its owner. |
| Real BFCache entry | NOT RUN | Chromium reported `bfcache:false` on Back. Back's fresh-document path passed; the persisted-pageshow handler and actual in-memory freeze/resume/native-focus path were both exercised against live APIs. No BFCache hit is claimed. |
| Managed-content parity generator | NOT RUN | Verifier marked it inapplicable: no managed-content source/artifact changed. The full SQL suite's repository parity tests passed. |
| Whitespace | PASS | `git diff --check`. |
| Own services/database cleanup | PASS | Own application stopped; owned Chromium closed; own Supabase stopped with `--no-backup`. No A2 containers or database/Storage volumes remain. Payments resumed afterward and was untouched. |

Browser diagnosis: the old retained-set click was attempted before the runner established a hydrated handler and settled page. The corrected runner waits for the handler, loaded fonts and stable rendering, uses the production build, and tracks only the current document's relevant requests. A global request set had also caused an irrelevant network-idle timeout during the initial 1280px sequence; old-document requests and background prefetches are excluded now. The native-focus probe initially required a hidden document, which is unnecessary for a visible, unfocused browser window; it now verifies focus transfer directly, freezes the actual review, expires the plan, resumes and restores focus. All final runs passed. No product defect was reproduced in retained-set opening, and no app change or new student-facing refusal was made. The precise old development-refresh timing was not isolated.

Free-pass and expired-review screens show the score and the exact line: "Answers and explanations are included with full access."

Earlier failed CI run `41305365387` is historical; its fixes were already present in `654d69a` and are now confirmed by successful CI:

| Earlier failure | Cause and existing fix | Regression evidence |
| --- | --- | --- |
| Four bookmark page cases | The A2 reader adapter bypassed the existing mocked reader contract. Preserve the central reader and pass its repository-probe suppression option. | `app/bookmarks/bookmarks-page.test.cjs:84`; `lib/courses/read-model.test.cjs:1008`; current CI/application PASS. |
| Instant-result UI fixture | A graded fixture omitted the new `reviewAvailable` flag. Mark review-bearing fixtures explicitly and test revalidation before opening a past review. | `app/courses/[slug]/quiz/practice-messages.test.cjs:185`, `:278`; current CI PASS. |
| Discovery result fixture | The old completed fixture still expected per-question review. Use score-only fixtures and reject answer-bearing responses. | `lib/entitlements/discovery.test.cjs:78`; `lib/practice/access-part-2.test.cjs:10`; current CI PASS. |
| SQL exit 1 | Local reproduction found stale course-selection/review/time fixtures and correctness/session projection issues. Fixtures now use own-list/current-term selections and the owner policy; finished-attempt RLS and fresh clocks were corrected. | Eight touched SQL suites previously passed 1,045 assertions; fresh full SQL now passes 40 files/2,810 assertions and CI SQL passes. |

The first local verifier attempt returned database exit 1 while all other gates passed; its database stderr was not retained by the verifier. The independent full SQL run and complete verifier rerun with explicit Docker access both passed. A later develop-to-A2 migration command applied SQL successfully but returned exit 1 on PostHog shutdown timeout; the migration catalog and installed-function hash confirmed A2, and its benchmarks/races/browser checks passed. An optional local CLI metadata-export helper also stalled during startup; only that A2-labelled helper was stopped. These are tool-runner issues, not an unreported SQL test failure or a product speed fix.

Evidence is under `/private/tmp/campusintel-a2/`: `ci-654d69a.log`, `verify.log`, `verify-sandbox-20261102.log`, `pgtap-all-20261102.log`, `benchmark-develop.json`, `benchmark-A2.json` and their metadata files, `race-summary-steady-run1-20261102.json` through `run3`, `race-summary-remaining-20261102.json`, per-file logs, `browser-20261102.log`, `browser-results.json`, fourteen PNGs and `cleanup-20261102.log`. Browser accounts were disposable confirmed local students with realistic saved selections. No hosted account/database was used.

Accepted compatibility limitation (owner decision): old detached claims are irreversible HMACs. Old/new forms of the presented address are checked and linked account aliases match, but a deleted old account's differently spelled alias cannot be reconstructed. This is accepted because pre-change claims belong to test-site testers and production starts with no claims. No transition work is owed for that limitation.

No requested A2 checks remain owed. BFCache-specific entry was not used by Chromium, as distinguished above from the passed restoration checks. Outside this follow-up, public marketing/account-level plan wording remains unchanged; no unrelated product failure was found. No stress rerun at load 120 is claimed. The local follow-up commit uses `test: steady the instant-feedback race under A2`, without trailers or a push.
