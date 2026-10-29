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

An addition can be recorded before the plan is issued, but opens material only with an active full plan for the same term. It ends no later than the student's current semester and its stored end; grant expiry/revocation also closes it. It never changes the student's list, issues a full plan or rolls into a new semester. An identical request key returns the same record; conflicting reuse is refused. Revoke retains the record and audit. To re-add a revoked course, use a new request key and reason.

The request UUID is the future fulfillment hook. A later trusted payment service must verify the exact student, institutional course, term and paid order line before invoking this operation idempotently. Refunds must revoke that addition. No payment integration is included here.

## Lock order

Policy when needed → sorted Auth accounts → sorted entitlement-account advisory locks → sorted profiles → shared academic calendar → feature locks → resources. Decisions use a fresh wall clock after waits. Direct profile updates enter holding the profile row; their triggers never acquire entitlement-account or practice-account advisory locks. Early Access enrollment on an Auth confirmation uses nonwaiting profile locks and defers on contention. Calendar writers take their exclusive calendar lock without later account/profile locks.

Full-plan operator corrections retain the semester and lock; an attempted transfer to another semester is refused. Current-term department corrections update grant calendar scope with an audit and retain original grant dates.

## Test-site rollout

Apply and verify the migration before deploying the reader/pages. Confirm the test site's actual calendar and selection data, then verify an existing full holder's own/shared/free course, outside course and audited addition. The app fails closed if the projection is unavailable. Keep the old records; do not restore global course access as a rollout workaround. No hosted rollout is performed by this change.

## Part 2 handoff

Discovery's direct preview/title/exam RPCs, activation and save/submit/result scope still need term/list enforcement. The UI hides outside-list offers and redirects outside-list preview pages, but that is not their database boundary.

AI document admission, signing/storage/extraction, generation/replays/delivery and generated-set RLS still need institutional-course scope. Existing local sets cannot be recalled.

Existing ordinary attempt/replayed-start/resume/review responses and legacy completion retain today's behavior, including D7 review after expiry. The owner decision for part 2 is fixed: after a plan ends, students keep scores and history, but reopening past answers requires an active plan. Apply that rule to existing attempts, replayed starts, resume/review responses and direct correctness-bearing reads, including history/Continue links and restored reviews. Preserve timely pinned-answer submission and score-only completion; course-list removal and revocation must not provide another material-read path. Bookmark records remain, while this reader stops requesting outside-list published material/counts. Public marketing examples and account-level plan wording also need their separate policy review.
