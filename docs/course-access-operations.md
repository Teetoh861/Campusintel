# Semester course access — part 1

Full plans (`early_access`, `manual`, `paid`, legacy seven-day trial) cover free courses and the student's confirmed department/level/semester list, plus explicitly added courses. Discovery and AI permissions are separate and are not changed by this migration.

`20261029100000_own_course_access.sql` retains all recorded grant dates and history. Each full grant binds once to a calendar term using its original issuance/start window. Effective access ends at the earlier of its recorded end and its bound department's semester end. An old grant cannot cover or lock the next semester. Missing selection or calendar denies non-free access. Current holders lose outside-list access immediately when the migration is applied.

`get_my_course_access` is a bounded, live-session-owned projection. It is an admission hint for the reader; published material, bank counts, fresh ordinary practice and Redo each enforce `private.course_access_decision` again in the database. An applicability match requires all three saved profile IDs. Free courses and current database operators retain their exceptions.

## Team-added course

Use the existing service-configured operator tool. Get the current term and profile revision first; `--course` takes an institutional course UUID, not a repository UUID. Actor and reason are required for mutations.

```sh
node scripts/entitlements/ops.cjs selection-status --user <student-uuid>
node scripts/entitlements/ops.cjs course-status --user <student-uuid>
node scripts/entitlements/ops.cjs course-add --user <student-uuid> --course <institutional-course-uuid> --term <term-uuid> --expected-profile-revision <revision> --request <request-uuid> --actor <operator-name> --reason <reason>
node scripts/entitlements/ops.cjs course-revoke --user <student-uuid> --addition <addition-uuid> --expected-revision <revision> --actor <operator-name> --reason <reason>
```

An addition requires an active full plan for the same term. Pending grants are bound first; without a qualifying plan the command returns `needs-plan` and records no addition. It ends no later than the student's current semester and its stored end; grant expiry/revocation also closes it. It never changes the student's list, issues a full plan or rolls into a new semester. An identical request key returns the same record and its current revocation state (`revoked` with `revoked_at` after revocation); conflicting reuse is refused. Revoke retains the record and audit. To re-add a revoked course, use a new request key and reason.

The request UUID is the future fulfillment hook. A later trusted payment service must verify the exact student, institutional course, term and paid order line before invoking this operation idempotently. Refunds must revoke that addition. No payment integration is included here.

## Lock order

Policy when needed → sorted Auth accounts → sorted entitlement-account advisory locks → sorted profiles → shared academic calendar → feature locks → resources. Decisions use a fresh wall clock after waits. Direct profile updates enter holding the profile row; their lifecycle check takes no Auth lock, and their triggers never acquire entitlement-account or practice-account advisory locks or bind grants. Binding and its entitlement-event Auth FK wait until the next read or operator command, under the ordered prefix. Selection audit takes Auth KEY SHARE NOWAIT to protect its existing FK; contention becomes CI409 (the profile API's normal retry message), never a raw lock error or an account wait. Scheduling and purge lock the profile before changing its lifecycle, so a queued save rechecks the committed session restriction. Early Access enrollment on an Auth confirmation uses nonwaiting profile locks and defers on contention. Calendar writers take their exclusive calendar lock without later account/profile locks.

Read opening: `auth.uid` → `open_course_access_read` (lock-free live-session check and binding precheck; eligible Early Access reconciliation before the lock prefix) → Auth SHARE → entitlement-account SHARED when no binding is needed, otherwise EXCLUSIVE → profile SHARE → calendar SHARED → `bind_pending_course_grants` only on the exclusive path → `require_course_access_account` → fresh-clock `course_access_decision`. An unbound grant found on the shared path does not count; reads never upgrade their account lock.

Write opening: `lock_course_access_scope` → Auth SHARE → entitlement-account EXCLUSIVE → profile protection → calendar SHARED → feature lock where needed → `bind_pending_course_grants` → resource rows → fresh-clock session/access decision. `practice_start` keeps its practice-account feature lock before binding and CBT item locks. Operator selection correction uses profile UPDATE protection in the same order and explicitly binds after updating the selection. The direct profile-update exception above remains in force.

Early Access callers: text-account locking is used by import; array-account locking is used by member changes and Early Access grant restore. Both wait on profiles before group/member/grant locks. Direct saves never wait on Auth or account advisory locks, including when deletion is queued behind the caller's Auth SHARE; selection-audit protection uses NOWAIT and a handled retry refusal. Array Auth NOWAIT contention is caught as `deferred` by both callers. Confirmation reconciliation uses profile NOWAIT and returns `deferred`; sweeps skip held profiles and complete deferred enrollment. No operator caller exposes raw 55P03.

A stale selection with an unlocked list asks the student to confirm their courses. A locked semester mismatch goes through the existing audited `admin_change_course_selection` correction to the current semester; students cannot correct it themselves. Student first picks, changes and rollover confirmations reject a different running semester with CI422 and a concise form error. An unchanged open selection with no rollover can save a new name without a semester check or a new confirmation. Calendar data stays private.

Full-plan operator corrections retain the semester and lock; an attempted transfer to another semester is refused. Current-term department corrections update grant calendar scope with an audit and retain original grant dates.

## Local verification

Run the three A1 database suites serially on an explicitly selected disposable stack:

```sh
ACCESS_SCOPE_DB_TEST=1 ACCESS_SCOPE_DB_CONTAINER="supabase_db_ci-access-own-<project>" node --test --test-concurrency=1 lib/courses/access-profile-deletion.database.test.cjs lib/courses/access-review.database.test.cjs lib/courses/access-scope.database.test.cjs
```

The populated upgrade proof uses `ACCESS_SCOPE_UPGRADE_DB_TEST=1` and `ACCESS_SCOPE_UPGRADE_DB_CONTAINER` with the same isolated-container naming rule, against the predecessor schema before A1. It rolls back the real amended migration and its fixtures. The callback used to insert that SQL preserves PostgreSQL dollar quoting.

Round 2 local evidence (2026-10-30): TypeScript, 89 reader/profile/form unit tests, 790 SQL assertions, all 30 database races and the 23-assertion populated upgrade proof passed. Races cover both practice/save orders, fresh-clock expiry, shared readers, grant binding, revoke/add idempotency, Early Access contention, schedule/purge against profile saves (including pending grants), and import with deletion queued behind it. Purge must report zero failures; a swallowed deadlock is a failure too. The caller enforces power preflight; selected touched tests remain runnable below 20%.

Still owed after battery fell below 20%: two-account browser checks at 375 and 1280px for own-course access, the outside-course notice and row, and rollover with selection open and locked. These are NOT RUN; automated coverage does not approve the customer experience.

## Test-site rollout

Apply and verify the migration before deploying the reader/pages. Confirm the test site's actual calendar and selection data, then verify an existing full holder's own/shared/free course, outside course and audited addition. The app fails closed if the projection is unavailable. Keep the old records; do not restore global course access as a rollout workaround. No hosted rollout is performed by this change.

## Part 2 handoff

Discovery's direct preview/title/exam RPCs, activation and save/submit/result scope still need term/list enforcement. The UI hides outside-list offers and redirects outside-list preview pages, but that is not their database boundary.

AI document admission, signing/storage/extraction, generation/replays/delivery and generated-set RLS still need institutional-course scope. Existing local sets cannot be recalled.

Existing ordinary attempt/replayed-start/resume/review responses and legacy completion retain today's behavior, including D7 review after expiry. The owner decision for part 2 is fixed: after a plan ends, students keep scores and history, but reopening past answers requires an active plan. Apply that rule to existing attempts, replayed starts, resume/review responses and direct correctness-bearing reads, including history/Continue links and restored reviews. Preserve timely pinned-answer submission and score-only completion; course-list removal and revocation must not provide another material-read path. Bookmark records remain, while this reader stops requesting outside-list published material/counts. Public marketing examples and account-level plan wording also need their separate policy review.
