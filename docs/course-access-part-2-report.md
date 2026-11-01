A2 delivery checkpoint, 1 November 2026. **Incomplete validation; not ready to merge.** Work stopped under the owner's below-20% power rule. Preflight was clean develop at `94dc1d45773d0bb37c0d1ceb4fcc3e1fdf497427`; branch `fix/access-part-2` was created there. Docker had no running containers. Only project `ci-access-own-a2-20261101` was used. Nothing was pushed or applied to a shared database.

Implemented boundaries by requested item:

| Item | Code | Behavior |
| --- | --- | --- |
| 1. Discovery | `supabase/migrations/20261101120000_course_access_part_2.sql:54`, `:88`, `:432` | Own current-semester list required for direct preview, titles, exam, activation selection, save, submission and result paths. Repository-only courses cannot qualify. Uses A1's prefix and protects preview rows before the scope decision. |
| 2. Free exam result | Same migration `:336`; `lib/entitlements/discovery-contract.ts:66`; `app/courses/[slug]/preview/[kind]/DiscoveryExam.tsx:386` | Completion and timeout project score metadata, empty questions and no saved sheet, selected answers, keys or explanations. Result screen shows the score and the owner's exact line. |
| 3. Claims and throwaway services | `lib/entitlements/claim-hash.ts:49`; migration `:351`, `:366`, `:432` | Canonical hashes precede old trim/lowercase hashes across retained signing keys. SQL accepts both forms per key, retains key commitments, and checks linked old accounts' canonical addresses. Maintained small domain list suppresses eligibility and activation through existing states. Activation limit also uses the canonical identity. |
| 4. AI | Migration `:70`, `:1023`, `:1310`; `app/courses/ai-practice/[courseId]/page.tsx:66` | Document/source RLS, Storage signing/read policies, extraction, settlement, admission, replay and generation settlement check course scope plus a current AI window. Previously stored generated sets remain owner-readable. Outside-list AI pages redirect to My Courses without new copy. |
| 5. History/review | Migration `:570`, `:879`, `:1007`, `:1418`; `lib/practice/server.ts:125`; `app/courses/[slug]/quiz/QuizClient.tsx:242`; `app/courses/[slug]/quiz/ScoreOnly.tsx:7` | Central attempt projection and pick reveal withhold material when access ends. Direct correctness rows use the same scope. Expired reviews retain scores; replay/resume and Continue hints cannot reopen material. Timely submissions still score pinned questions. Review opening and tab restoration refresh authorization. No scores/history are deleted. |
| 6. Bookmarks | `app/bookmarks/page.tsx:40`; `lib/courses/read-model.ts:587`, `:621` | Reuses A1's institutional material/count filtering and prevents the bookmark preload's repository-only material/count probe. Records stay intact. |

Verification evidence:

| Check | Status | Evidence / practical limit |
| --- | --- | --- |
| Preflight | PASS | Exact base, clean source, absent destination branch, empty `docker ps`; battery 32% initially. |
| Migration application | PASS | Applied to the disposable A2 database. This proves SQL definitions/policies install, not behavior or concurrency correctness. |
| Claim unit tests | PASS | 6 tests: key configuration/rotation, purpose separation, Gmail dots, tags on all domains, googlemail mapping, old trim/lowercase HMAC lookup with canonical new inserts. |
| API contract tests | PASS | `lib/practice/access-part-2.test.cjs`: 2 tests. Discovery score-only parses and rejects answer leakage; expired ordinary completion maps to retained score, empty questions and unavailable review. |
| TypeScript | PASS | `node --max-old-space-size=1024 node_modules/typescript/bin/tsc --noEmit`. Initial run found only stale generated `.next` validator imports for the removed quiz-bank route. Temporarily moving those two generated validators allowed a clean run; original files restored afterwards. |
| New pgTAP | BLOCKED | `supabase/tests/course_access_part_2.test.sql`. First run found invalid Early Access terms in a test fixture; corrected to uncapped. Retry failed to connect after Supabase's health failure removed the container. No behavioral assertions are claimed as passing. |
| New races | BLOCKED | `lib/courses/access-part-2.database.test.cjs` attempted serially on the named A2 container; container absent. No race is claimed as passing. |
| Full workflow verifier | NOT RUN | Below-20% power rule. |
| A1/practice race suites | NOT RUN | Below-20% power rule and failed local stack. Run each file separately. |
| Browser, 375px and 1280px | NOT RUN | Free-pass result, expired review, outside-list AI page all remain owed. Customer acceptance is not established by unit tests. |
| Whitespace | PASS | `git diff --check`. |
| Own stack cleanup/reset | PASS | `supabase stop --no-backup --workdir /private/tmp/campusintel-a2/stack`; no matching containers or volumes remain. Database discarded, not retained as a backup. |
| S1 integration | BLOCKED | #149 was still open at the final status check; `origin/develop` remained `94dc1d4`. Merge develop after S1 lands, resolve the integration, and compare migration timestamps again before merge. |

The new pgTAP file covers outside-list Discovery title/exam/save/submit refusals, all completed free-exam RPC projections, timeout, canonicalization/legacy claim matches, throwaway offer/activation, post-expiry ordinary score and replay, direct correctness RLS, and outside-list AI admission/extraction/generation/source/signing. The new race file covers queued Discovery correction, concurrent completed free-exam reads, alias activation contention, queued expiry with timely scoring, and queued AI source reads. These are written tests, not passing evidence.

Still owed: restore a healthy isolated stack; make the new pgTAP/races pass; add any missing cases for both lock orders, grant/calendar expiry while queued, revocation, AI allowance/settlement/delivery and prior-set retention, direct instant-pick reveals, restored reviews and bookmark material/count request suppression; update old Discovery/practice fixtures/assertions for the new result contracts; run the full existing database suites, full verifier, A1/practice races and browser acceptance; independently audit the changed lock paths; integrate S1 and recheck the migration timestamp. This checkpoint must not be treated as the requested completed high-risk delivery.

Compatibility limitation requiring follow-up: an old detached claim is an irreversible HMAC. Both the old form of the presented address and its new canonical form are checked, and linked old-account aliases match through verified Auth emails. A deleted old account's differently spelled alias cannot be reconstructed from its old HMAC alone. Resolve the transition policy before approving the abuse fix as complete.

Outside scope: public marketing/account-level plan wording from the A1 handoff remains unchanged; the stale generated quiz-bank route imports were pre-existing local artifacts. Supabase analytics health checks and a pg-delta connection timeout prevented a stable local stack. No other stack or process was stopped.
