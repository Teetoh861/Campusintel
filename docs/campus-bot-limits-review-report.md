# Campus Bot limits review fixes

Baseline: `feat/campus-bot-limits`, clean at `4986919`, 2026-11-03. The fixes are implemented. Targeted SQL and light
checks pass; the full SQL rerun, races and browser validation remain owed after the battery fell below 20%. No database
result below is claimed from unit tests.

## Changes

1. **Abandonment:** `20261103140000_campus_bot_review_fixes.sql:4` enforces a five-minute reservation floor and settles
   abandoned token requests at zero. Abandoned results remain discarded. `lib/ai-practice/lifetime.ts:4`,
   `service.ts:76` and `supabase-env.ts:157` bound admission, provider work and settlement, cancel transport, and refuse
   an unsafe reservation before calling the provider. The conservative budget is 15 + 2 x 120 + 30 = 285 seconds,
   strictly below 300 seconds.
2. **Admission clock:** the migration uses one final `v_now` for usage reservations, generation creation/retention and
   newly opened windows (`:136`, `:187`, `:193`). The SQL fixture no longer globally backdates payment/order timestamps to work around
   transaction-time reservations. The legacy Discovery follow-up read has one explicitly documented grant fixture.
3. **Platform stop:** admission reads policy after taking the platform lock (`:72`); `admin_set_ai_limits` takes that
   same lock before updating policy (`:224`). A queued start must see a committed daily limit of zero.
4. **Input estimate:** no input-cap code change. `docs/payments-operations.md`, “Campus Bot limits”, documents the
   real 60,000-character cap, `read_tokens_max` as a reservation estimate, and a rare overrun finishing below zero.
5. **Theory:** ordinary student `read_published_managed_content` calls return prompts and availability, without model
   answers or rubrics (`:245`). Operator publication inspection retains its existing access. The service-only
   `reveal_theory_feedback` (`:291`) rechecks course access and publication identity, then calls `record_plan_use`
   atomically before returning feedback. `lib/theory-practice/reveal.ts` validates that reply; `submit.ts` uses it.
   Course and theory prompts and existing student copy stay the same; initial theory page data carries no feedback.
6. **Refill snapshot:** admission reads the latest applicable refill once (`:134`) and supplies that epoch to both
   window lookups (`:154`). A refill committed after that snapshot applies to the next admission.

The numbered SQL locations refer to `supabase/migrations/20261103140000_campus_bot_review_fixes.sql`.

Both owner decisions are retained: an account with an active paid grant may use the paid reserve while Early Access
supplies the higher limits; a set admitted before payment stays out of that payment’s refund-use count. Both now have
SQL regressions. Early Access alone remains unpaid for the platform reserve.

## Checks

The targeted batches overlap; their test totals must not be added together.

| Check | Status | Evidence |
| --- | --- | --- |
| Touched AI, theory service, theory page and route tests | PASS | 56 tests, zero failures/skips; includes hard deadlines, unsafe reservations, refused/stale/foreign reveals, publication checks and private responses. |
| Final theory and managed-content projection tests | PASS | 26 tests, zero failures/skips; includes prompt-only rows offering practice without loading feedback. |
| Course and theory UI/client/route tests | PASS | 44 tests, zero failures/skips; existing prompts, labels, disclosure flow, drafts and route outcomes remain covered. |
| TypeScript | PASS | Node 22, `tsc --noEmit --incremental false`. |
| Race file/helper syntax | PASS | `node --check` for both files. |
| Diff whitespace | PASS | `git diff --check`. |
| Full application unit suite | BLOCKED | Shared slot was occupied until power was low; the battery then fell below 20%. |
| Fresh migration installation | PASS | All migrations, including `20261103140000`, applied on the isolated database. |
| `supabase/tests/campus_bot_limits.test.sql` | PASS | 150 assertions on the fresh isolated database, including all new SQL regressions. |
| `supabase/tests/server_run_practice.test.sql` | PASS | 162 assertions after replacing the superseded general-read answer expectation with explicit prompt-only/no-feedback assertions. |
| Full pgTAP suite on a fresh database | FAIL | Initial run passed 37 files, then stopped on the old answer expectation in file 38. That test was corrected and passes individually; the complete 42-file rerun remains owed at the low-power cutoff. |
| `lib/payments/campus-bot.database.test.cjs` | BLOCKED | All eight races remain unrun at the low-power cutoff. |
| `lib/courses/access-part-2.database.test.cjs` | BLOCKED | Not run before the low-power cutoff; run separately on the isolated database. |
| `lib/courses/access-readonly.database.test.cjs` | BLOCKED | Not run before the low-power cutoff; needs the isolated database/API status JSON; run separately. |
| `lib/payments/payments-server.database.test.cjs` | BLOCKED | Not run before the low-power cutoff; needs the isolated database/API; fake provider only; run separately. |
| Browser: theory “Submit and compare”, 375px | BLOCKED | Low power prevented the browser run; fixture is prepared, but no screenshots were captured or inspected. |
| Browser: theory “Submit and compare”, 1280px | BLOCKED | Low power prevented the browser run; fixture is prepared, but no screenshots were captured or inspected. |
| Full verifier | NOT RUN | Owner assigned this check to CI on the push; no local verifier and no push. |

## Database coverage

`campus_bot_limits.test.sql` passed checks for matching admission timestamps, the minimum safe reservation, discarded/zero-charge
abandoned sets for all funding types, the paid-plus-Early-Access reserve decision, and pre-payment use excluded from
refund assessment. It also checks prompt-only direct student RPC reads, availability metadata, allowed/stale/outside-list/
signed-out/expired theory reveals, deduplicated markers, rollback when the marker fails, and service-only privileges.

The 2b race file retains its original five races and adds the following unrun regressions:

- queued old-day transactions competing for the next UTC day’s last slot;
- a queued admission behind `admin_set_ai_limits(... daily 0 ...)` on the platform lock;
- a refill committed between the session and week window lookups, followed by the next admission opening both fresh
  windows.

The midnight/refill races clone the installed admission body only inside the guarded local test database and add a
test clock or a gate after the first window lookup. Production has no clock override or test gate. Tests wait for
observed database lock queues, then release them explicitly. The temporary functions are dropped in cleanup.

## Shared-machine state and remaining work

Before starting heavy checks, `ps` and `docker ps` initially showed no other heavy run or stack. Claude’s
`CampusintelPayScreens` stack appeared while this stack was starting. Only this work’s stack was stopped, with
`supabase stop --no-backup`. Claude’s stack was not touched. Focused units and TypeScript ran while the heavy-check
slot remained occupied by Claude’s browser/verifier/stack.

The slot finally became free with battery at 26%. A fresh isolated stack then applied every migration. The Campus Bot
SQL test passed 150 assertions after correcting test fixtures: explicit wall-clock refund requests instead of the
transaction-start default, a `seven-day` legacy trial policy, and a valid expired grant range. A legacy Discovery
fixture simulates the separate post-payment HTTP read; see the observation below. The full SQL run passed its first
37 files, then hit one superseded practice-content expectation. The corrected practice SQL file passed 162 assertions.
The remaining four files were not reached: `student_bookmarks`, `student_first_name`, `student_request_context`,
and `trial_entitlements`.

At 19%, heavy work stopped under the power rule. The touched SQL test was completed, and this work’s stack was
stopped with `--no-backup` again. `docker ps` was empty afterwards; the isolated database was discarded. No browser
was launched and no screenshots were captured or inspected. Charging was not waited on.

Still owed when the shared slot is free and power is at least 20%:

1. Full application unit suite, then the complete 42-file pgTAP suite on a fresh isolated database.
2. `campus-bot.database.test.cjs`, `access-part-2.database.test.cjs` and `access-readonly.database.test.cjs`, one file
   at a time. The read-only file needs that isolated stack’s API status JSON.
3. `payments-server.database.test.cjs` against the same local API, fake provider only.
4. Real theory “Submit and compare” at 375px and 1280px, with screenshots inspected. The prepared local fixture also
   checks a real student RPC with no answers, an atomic refund-use marker, and that the draft never leaves the browser.

The full verifier belongs to CI on the owner’s push. No push was made here.

## Existing observation outside these fixes

`private.has_full_access` still compares grant bounds with transaction `now()`
(`supabase/migrations/20261021100000_discovery_pass.sql:91`), and the 2b `discovery_preview` calls it after its lock wait
(`20261103100000_campus_bot_limits.sql:620`). A grant starting or expiring during that wait can leave this Discovery
full-access decision stale. The single-transaction fixture exposed the start-time case; it now documents the separate
follow-up HTTP read it represents. The concurrent queued case was not run. Suggested follow-up: pass the final wall
clock into this specific decision under its existing opening, with start/expiry race coverage. This legacy helper and
the Discovery function were not changed in this round.

No hosted database, AI/payment provider, email/SMS service or official question-bank source was touched. No other
agent’s stack was stopped. No outside-scope production fix was added.
