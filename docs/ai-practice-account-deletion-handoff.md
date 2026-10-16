# AI practice ↔ Account deletion: integration handoff

Status: written from the AI branch (`feat/ai-practice-generation`) after Account PR #121
merged into `develop` (`e8ecc4d`), with the worktree fast-forwarded onto it. Account files
changed for the integration: `scripts/account-deletion/worker.cjs` (+ test),
`lib/account/deletion-policy.cjs` and `docs/account-deletion-operations.md`; the Account SQL
is unchanged. Nothing here has been applied to a hosted project or scheduler.

## 1. Facts this handoff relies on

| Fact | Evidence |
| --- | --- |
| Every AI row that references `auth.users` uses `on delete cascade` | `supabase/migrations/20261016140000_ai_practice_uploads.sql`. SQL test "account deletion cascades through every owned AI row". |
| AI uploads are stored at `ai-practice-uploads/<user_id>/<document_id>`, and Storage records the student as `owner_id` | Path constraint in the migration. On the local stack, a browser-style signed PUT produced `owner_id = owner = <user_id>`. |
| The Account worker refuses to purge a user who still owns Storage objects (`P0002`), then retries with backoff and escalates 24 h after the deadline | `20261016120000_account_deletion_worker.sql`, `run_account_deletion_jobs`. Reproduced with AI objects in the SQL test and in `storage-integration.cjs`. |
| The worker never deletes Storage metadata by SQL; Storage must be removed through the provider API | Same file, and `docs/account-deletion-operations.md`. Storage itself also blocks direct SQL deletes (`storage.protect_delete`). |
| `private.has_live_account_session()` now also requires that no deletion job exists | `20261016110000_account_deletion_access.sql` replaces it with `create or replace`, so the AI RLS policies bound to it inherit the restriction. |
| Scheduling and the worker lock the account row `FOR UPDATE`; service-role writers share-lock it and re-check | `schedule_student_deletion`, `run_account_deletion_jobs`, `write_quiz_attempt`. |
| Storage checks upload policy when a URL is signed, not when the file arrives | `storage-integration.cjs`: a URL signed before scheduling uploaded `200` after it. |

## 2. Admission after logout, scheduling or expiry

Every AI write is a service-role function given the verified session id.
`private.ai_practice_session_user(p_session_id)` derives the user from
`auth.sessions`, takes `auth.users … for share`, then re-checks the session (exists,
not expired, user confirmed and not banned) and that no deletion job exists. It returns
null otherwise, and the caller answers `signed-out`. This covers
`create_ai_practice_document`, `claim_ai_practice_extraction`,
`settle_ai_practice_document` and `begin_ai_practice_generation`.

- **Logout** deletes the session row, so nothing is admitted for it afterwards.
- **Expiry** (`not_after` passed) is refused the same way.
- **Scheduling** either waits for an in-flight admission to commit, or commits first; a
  queued admission then re-checks and is refused. Both orders are proven with real
  concurrent sessions in `lib/ai-practice/admission.database.test.cjs`, and a negative
  control (the helper without the lock and re-check) admitted a generation after
  scheduling.
- A generation already running when deletion is scheduled finishes as `failed`
  (`account-restricted`). No set is stored and nothing is charged.
- An extraction claimed before scheduling cannot settle after it.

## 3. Foreign keys

| Table | Column | References | On delete | Effect at Account purge |
| --- | --- | --- | --- | --- |
| `ai_practice_documents` | `user_id` | `auth.users` | cascade | Removed with the account |
| `ai_practice_documents` | `institutional_course_id` | `institutional_courses` | cascade | Not affected by account purge |
| `ai_practice_generations` | `user_id` | `auth.users` | cascade | Removed |
| `ai_practice_generations` | `document_id` | `ai_practice_documents` | set null | Removed anyway, through `user_id` |
| `ai_practice_generations` | `usage_event_id` | `ai_usage_events` | cascade | Removed |
| `ai_usage_events` | `user_id` | `auth.users` | cascade | Removed (spend history included) |
| `ai_allowance_windows` | `user_id` | `auth.users` | cascade | Removed (the AI grant) |

No AI foreign key blocks `delete from auth.users`. Only Storage objects can block the purge.

## 4. Storage that can block a purge

1. The delete after extraction failed (best effort).
2. The student uploaded but never triggered processing.
3. **Late signed upload:** a URL signed before logout or scheduling is used after it.
   Storage accepts it, so this cannot be refused in the database.
4. **Account-owned orphan:** an object whose document row no longer exists.

`private.ai_practice_removable_uploads()` treats every object as removable unless it is
the live slot of an account **without** a deletion job, inside the 60-minute upload
window. Objects of a scheduled account (matched by `owner_id`, `owner` or folder) are
always removable and are flagged `blocks_account_purge`.
`list_ai_practice_uploads_to_remove` returns those first, so a bounded sweep clears purge
blockers before anything else. `purge_expired_ai_practice` reports
`purge_blocking_uploads` and `outstanding_uploads` honestly. It never deletes an expired
document row while its object remains.

## 5. Required order before an Account purge

1. **Schedule** (Account, unchanged). Sessions are revoked and the job is written. From
   then on every AI admission refuses the account.
2. **AI sweep** (required, before every worker run): `runAiPracticeCleanup(serviceClient)`
   from `lib/ai-practice/cleanup.ts`, or `GET /api/ai-practice/cleanup` with
   `Authorization: Bearer $CRON_SECRET`. It removes objects through the Storage API,
   bounded to 20 × 100 per run. `200` means nothing is left. `202` means
   `complete: false` (batch limit hit or files remain), so run it again. `503` means a step
   failed.
3. **Worker** (Account, unchanged): `run_account_deletion_jobs`. If any AI object is still
   present it fails closed with `P0002`, rolls the whole account back and retries with
   backoff. That is the intended safety net for a late upload that lands between steps 2
   and 3: the next sweep removes it and the next worker retry completes.

Never clear `P0002` by deleting `storage.objects` rows in SQL. That orphans the provider file.

**Integrated:** `scripts/account-deletion/worker.cjs --run` now performs step 2 for
purge blockers itself. It lists only objects of deletion-scheduled accounts
(`list_ai_practice_purge_blockers`), removes them through the Storage API in bounded
batches, re-reads the remaining count, and then always runs the purge. A failed sweep,
or any remaining object, makes the run exit 1. Output carries counts only. The hourly
cleanup route still handles general retention.

## 6. Evidence

- `supabase/tests/ai_practice_uploads.test.sql`: scheduled account refused for reserve,
  claim, settle and admit; in-flight generation closed without charge; worker `P0002` with
  a late-upload object and an orphan, rows intact; sweep listing puts blockers first; after
  removal the worker completes and leaves zero AI rows; another student is untouched.
- `scripts/ai-practice/storage-integration.cjs` (real Storage, real `worker.cjs`): late signed
  upload after scheduling (`200`), orphaned file, worker with Storage removal failing → exit 1,
  `P0002`, rows intact; retried worker removes all three objects through the API, purge
  completes, zero AI rows; a repeat run is a no-op.
- `scripts/account-deletion/worker.test.cjs`: sweep-before-purge order, bounded batches,
  no completion claimed while objects remain, Storage failure still purges fail-closed,
  malformed listing never reaches Storage, counts-only output.
- `lib/ai-practice/admission.database.test.cjs`: lock ordering with real concurrent sessions.

## 7. Git integration

Done with owner authorization on 2026-10-16: the AI worktree was fast-forwarded from
`0dc79cd` to `origin/develop` `e8ecc4d` (`git merge --ff-only`). Beforehand there were no
path collisions between the 58 upstream paths and the 56 AI paths, and a checksummed
backup plus a review package were written. Afterwards the tracked patch was
byte-identical and all 49 untracked files were unchanged. Nothing is staged or committed.
The verifier now runs against the worktree's own `supabase/`.
