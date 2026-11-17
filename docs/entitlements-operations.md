# Free pass, free month (Early Access) and entitlement operations

Owner: founder/operations. Implements PRD v1.4 §4.5 and §4.9 as amended by the owner. On 2026-10-21 the Discovery Pass
became one click by a signed-in student and **collects no phone number**. On 2026-11-16 the pre-launch Early Access
list was retired: Early Access is now a **free month the student claims on the site** after launch
(`20261116120000_early_access_claim.sql`). Students see "Free month" and "Free pass"; "Early Access" and "Discovery
Pass" are our names only. The planned launch date in the policy is informational: it starts and ends nothing.
This is a deployment and runbook handoff, not evidence of hosted activation. No hosted migration, SMS send, Anthropic
call or deployment was made while building it.

## What students get

| Plan | How it starts | Courses | AI practice |
| --- | --- | --- | --- |
| Free (every account) | Registration and email confirmation | Courses with `institutional_courses.is_free` (GST111, GST102, GST112, GST212) | None |
| Discovery Pass (`source = 'trial'`, `trial_policy = 'discovery'`, since `20261021100000_discovery_pass.sql`) | One tap on Plan & Access by the signed-in student (`activate_discovery_pass`), once per account and once per confirmed email address (for 5 years); never for an account that has ever had Early Access or an address that has claimed a free month, and not while the free month claim is open. Offered only to students who are eligible, decided on the server before render. No phone number, SMS or code | **A restricted sample, never full access.** For `discovery_hours` (72) on database time: one CBT exam of exactly `discovery_cbt_questions` (50) valid questions from one actively offered course the student picks. It opens only if that course's whole CBT duration fits before the pass ends, and is never shortened. Answers are saved as the student goes; at the database deadline the exam closes and is marked from the last sheet saved in time. Nothing sent after the deadline is marked, and `discovery_cbt_grace_seconds` (120) only replays an already marked result. Plus one complete study-guide topic the student picks from one actively offered course. Every other topic stays locked. No theory preview. Nothing renews | One accepted upload (`discovery_ai_uploads`, 1, enforced when an upload becomes ready, however many were reserved; refused files cost nothing) of at most `discovery_ai_source_chars` (20,000) characters. Only that upload can use the pass. `discovery_ai_generations` (1) delivered set of exactly five valid questions; a short or malformed set is a failed attempt and is not charged. At most `discovery_ai_attempts` (3) provider attempts, failed ones included |
| Seven-day trial (`source = 'trial'`, `trial_policy = 'seven-day'`) | Issued before `20261021100000`; no new ones | Every course until its own original end | Its original allowance under the shared AI rules |
| Free month (Early Access, `source = 'early_access'`) | **Claimed by the student** on the site (`claim_early_access`) while the claim is open: from the actual launch until 10 days after it or the end of 30 November 2026 (Lagos), whichever comes first. Once per account and once per confirmed email address (for 5 years). Never with a current paid plan or a throwaway email domain, and only once the student's courses are confirmed | The student's courses for one calendar month from the claim (Lagos calendar). It sets their courses for the semester | Campus Bot at the Standard plan's limits (`20261103160000`) |
| Operator grant | `scripts/entitlements/ops.cjs grant` | Every course for the stated days | None (course access only) |

Free is the institutional `is_free` flag, never `courses.is_shared`. Login stays email and password. Running out of
AI units never closes courses. Revoking or expiring any grant ends its course access **and** its AI at once.

## Discovery Pass activation: one click, one per account

A signed-in, eligible student taps **Start my Discovery Pass** on Plan & Access and confirms: "Start your 72-hour
Discovery Pass now? It can be used only once." (**Start now** / **Not now**; the hours come from the database). The
route verifies the session and page continuity, applies the request limit, and calls
`activate_discovery_pass(session_id, claim_hashes)` with the service role. The database, under the same per-account
lock the free month claim and previews take:

- refuses an account that already has a trial grant of any kind, active, ended or revoked (`already-activated`, a
  harmless replay for a double tap or a lost response);
- refuses while Early Access is active (`early-access-active`) and, from `20261023120000_discovery_eligibility.sql`,
  for any account that has ever had Early Access (`trial-not-offered`): an `early_access` grant in any state (active,
  ended or revoked). From `20261116120000_early_access_claim.sql` it also refuses every account while the free month
  claim is open (`trial-not-offered`), so the two are never offered together, and the retired list bars nobody.
  `trial_after_early_access` is retired: pinned to false and no longer read;
- refuses a confirmed email address that has started a pass or claimed a free month on any account, including one
  since deleted, within the claim retention period (`already-claimed`; see "Email claims" below);
- refuses once the platform-wide guard for the UTC day is reached (`capacity`), when the owner has set one;
- otherwise writes the grant with start and end from its own clock (`discovery_hours`), the fixed AI allowance
  (`discovery_ai_generations`), the claim row and the `discovery.activated` audit event, all in one transaction.

Every refusal for this account (`already-claimed`, `trial-not-offered`, `early-access-active`) shows the student
exactly: "Discovery Pass isn't available on this account. Free GST courses are still open to you." No email, period
or Early Access wording is shown as a reason. The database still sends `retention_months` and the
`early-access-active` state for application instances built before this change; the current application never shows
either.

### Eligibility before render

Pages never offer a pass the database would refuse. `lib/entitlements/server.ts` (`readEntitlementForVerifiedStudent`)
calls `discovery_pass_eligibility(session_id, claim_hashes)` with the service role whenever the plan says a pass could
still be started. It applies the activation rules above (trial grant, Early Access history, key configuration, live
email claim) without a lock, a write or key registration, and answers only `{eligible}`. A student who is not eligible
sees normal free GST access: no offer on Plan & Access, the dashboard, My Courses, course, preview or AI practice
pages, and no explanation. Missing `ENTITLEMENT_CLAIM_HASH_KEYS`, a session that cannot be verified, an error or a
malformed answer all count as not eligible (fail closed). Activation stays authoritative.

The free month is offered the same way. When the plan says a claim could be open for this account (a launch is
recorded, the window the database reported has not passed by the database's own clock, no Early Access grant and no
paid plan), the same server read calls `early_access_claim_eligibility(session_id, claim_hashes)`. It applies the
claim's rules without a lock, a write or key registration, and answers `{eligible}` and, when eligible, `ends_at`: the
instant a month claimed at that read would end. The confirmation shows that day ("Starts now and ends on 16
December"); the month's real start and end are written by the claim on its own clock. Every failure counts as not
eligible, and the student is shown nothing.

**What this does not guarantee.** Without phone verification there is no per-person identity: one person with several
confirmed email addresses can start several accounts and several passes. The database enforces one pass per account
and one per confirmed email; the application never claims one pass per person, and support should not either. The
protections are deliberately proportionate: no NIN, BVN, device fingerprint or phone number is collected.

### Abuse limits

| Limit | Where | Default |
| --- | --- | --- |
| Activation requests per account | `consume_discovery_activation_limit`, applied by the API route (account bucket keyed by the confirmed email, address bucket by the trusted requester address, both as HMACs) | 5 per 15 minutes, a hard limit |
| Activation requests per requester address | same function, **monitoring only, never a barrier**: campus Wi-Fi puts a whole lecture hall behind one address. The address bucket counts only requests the account bucket admitted (so one noisy account adds at most its own five), and crossing the notice threshold writes one `discovery.origin-notice` audit row (bucket prefix and counts, no address) | notice at 60 admitted requests per 15 minutes |
| Passes per account, ever | `entitlement_grants_one_trial_idx` | 1 |
| Passes per confirmed email address within the claim retention period | `private.discovery_pass_claims` | 1 per 5 years from activation (approved 23 October 2026) |
| Activations per UTC day, platform-wide | `private.entitlement_policy.discovery_activations_per_day` | **off** (null). Set only with the founder's approval; it bounds how fast a farm of confirmed accounts could sample the banks, never what one student may do |
| Registration | existing `REGISTER` limit and email confirmation | 3 per account per hour, 20 per address per hour |

Everything a pass can spend (one exam, one topic, one accepted upload, one delivered set, three provider attempts) is
unchanged and listed above.

Shared campus addresses: nobody is refused by address. On launch day watch `private.entitlement_events` for
`discovery.origin-notice`: a lecture hall activating behind one NAT address is expected and needs no action; a run of
notices from one address with no matching registrations is worth a look at the grants created in that window
(`status`, `change-grant --action revoke`). The figures live in `lib/entitlements/server.ts` (`ACTIVATION_LIMIT`) and
`consume_discovery_activation_limit` together; the database refuses any other values.

### Email claims

`private.discovery_pass_claims` holds, per address that started a pass, an HMAC-SHA256 of the normalized address
(trimmed, lower-cased) under a purpose string, keyed with a server secret the database never sees, plus the key
version and an expiry. It never holds the address, and nothing in the database can turn a row back into one.

| Variable (server only) | Value |
| --- | --- |
| `ENTITLEMENT_CLAIM_HASH_KEYS` | `<version>:<secret>[,<version>:<secret>…]`, current key first; each secret at least 32 characters (`openssl rand -base64 32`), versions distinct integers 1–1000, at most 8 keys. Missing or malformed: activation is `unavailable` (fail closed) |

Rotation: prepend a new version (`3:<new>,2:<old>`). New claims are written under version 3; lookups try every listed
version, so claims under version 2 keep blocking their addresses. Drop version 2 from the list only when
`ops.cjs claim-keys` shows no live claim under it (at the latest 24 months after the rotation).

The database checks the configuration on every activation and **fails closed** (`claim-key-missing`,
`claim-key-replaced`, shown to the student as "not available right now", logged by the server and audited as
`discovery.claim-key-rejected`) rather than quietly re-opening claimed addresses:

- each configured key sends a check value (the HMAC of a fixed purpose string under that key, never the secret), and
  the first activation that presents a version registers it in `private.discovery_claim_keys`;
- a registered version presented with a different check is a replaced secret: refused. A compromised key is retired
  by adding a **new version** and keeping the old one listed until its claims expire; a version is never re-used;
- a version that unexpired claims were written under but the configuration no longer carries is refused, so a key
  dropped early stops activation instead of making those claims unmatchable. Put it back; nothing was reset.

`ops.cjs claim-keys` reports `live` (versions unexpired claims still reference, with counts and the last expiry) and
`registered` (versions the ledger has been written with). No key, hash or check value is ever printed.

Retention (owner decision, 23 October 2026): each claim expires `discovery_claim_retention` (**5 years**) after the
pass was activated, and survives account deletion. `20261023120000_discovery_eligibility.sql` re-dated every live claim
to `claimed_at + 5 years`; an already expired claim is not revived. An expired claim blocks nothing even before it is
removed. pg_cron purges expired rows daily (job `campusintell-discovery-claim-purge`, 03:17 UTC), and
`ops.cjs purge-claims` does the same at once. `private.early_access_claims` is the same record for the free month: the
same hash, keys, 5-year retention and purge, one row per address that claimed. The key checks, `claim-keys` and the
purge count both tables. Changing the policy value later affects new claims only. No hosted database ever held the earlier unkeyed shape of this
table, so there are no rows to migrate; the migration is edited in place before its first hosted run.

### Exam answers are saved as each tab's changed questions

Every browser tab of an open exam names itself (a fresh id per mount, never shared) and numbers its own changes. A
save sends only the questions that tab changed since the sheet it last received from the database, with that sheet's
revision and the tab's change sequence; `save_discovery_cbt` lays those changes over the sheet it holds, under the
account lock and the row lock, advances the sheet's revision by one, records the tab's sequence, and answers with the
whole sheet that now stands, its revision and the deadline. A question a tab never touched therefore always keeps
whatever another tab saved, and two tabs cannot overwrite each other's answers. A question changed on two tabs takes
the change that reaches the database last; every tab then shows the sheet the database returned. Requests of one tab
are applied in sequence order only: one delayed on the network behind a newer request of the same tab is answered
`stale` and changes nothing, and a retry of an applied request is acknowledged without a second write. The page
normally keeps one save in flight, but newer changes overtake a slow request inside the last 15 seconds, after 5
seconds of waiting, and whenever the page is left or the exam submitted; sequence order makes the overtaking safe. A
failed save is retried with bounded backoff (2 s doubling to 15 s, 8 times) without waiting for another change, and
"All answers saved" is shown only once the server confirmed this tab's latest change. A reload lays only the tab's
unconfirmed changes over the database's sheet.

`submit_discovery_cbt` takes the same delta and applies the same rule: the tab's pending changes still in time are
laid over the sheet the database holds in the grading write itself, and the sheet that results is graded. A tab with
nothing pending grades the database's sheet, never the stale copy it happens to hold, so an answer saved from another
tab is always marked; the audit row says whether pending changes were applied. The first grading is immutable and a
replay returns it unchanged. The database decides every cutoff on its wall clock at the write (`clock_timestamp()`,
re-read after the account lock and in the update itself), never on the transaction's start time, so a request that
queued across the deadline cannot land late answers; a change the server did not receive in time is reported as
possibly not saved, never as saved. An exam remembers the sequence of at most `discovery_exam_tabs` tabs (64); the one
seen least recently is dropped.

### The exam clock on the device is conservative, and the database deadline is the only authority

Whether a tap may still change an answer is decided by `lib/entitlements/exam-clock.ts`, never by the device's wall
clock. On mount the page asks the server for a fresh reading (`sync-exam`: the database clock, the deadline and the
sheet that stands), charges the whole round trip as elapsed, and from then on measures time on the monotonic clock,
so the cutoff on the device is never later than the real deadline. Until that exchange lands, and again whenever the
page comes back into view or the wall clock drifts from the monotonic one (the device may have slept), answers are
disabled and the exchange is repeated with bounded backoff. The clock is read at the moment of each tap, not from the
once-a-second countdown, and a refused tap changes nothing on screen. The database still refuses anything after its
deadline regardless.

## Early Access (the free month): claimed on the site

Owner decisions of 16 November 2026, replacing PRD 4.9's pre-launch list (`20261116120000_early_access_claim.sql`).
There is no list: nothing is granted at sign-up, at email confirmation or by a page read, and no operator command
enrols anyone.

**Who can claim.** A signed-in student, when all of these hold at the moment of the claim:

- the account's email is confirmed, and the account is not banned or scheduled for deletion;
- the claim is open (below);
- the account has never had an Early Access grant, in any state (one per account, ever);
- the account has no current paid plan. A refunded plan is revoked and does not count; the second half of a Session
  plan and a plan waiting for its semester do;
- the address is not on a throwaway email domain (the free pass's own check, `discovery_email_allowed`);
- the student's courses are confirmed for the current semester;
- no account has claimed a month with the same confirmed address in the last 5 years.

A student who has used a free pass can still claim. A student who cannot claim is shown no offer and no reason.

**When the claim is open.** `private.entitlement_policy` holds `actual_launch_at` (null until the founder activates
launch), `early_access_enrollment_days` (**10**) and `early_access_claim_cutoff` (**1 December 2026 00:00
Africa/Lagos**, the end of 30 November). The claim opens at the actual launch and closes at whichever comes first: 10
days after launch, or the cutoff. That instant is stored with the launch (`early_access_claim_closes_at`,
20261117120000) and every check reads it: changing the days or the cutoff afterwards moves nothing. A month that starts before the cutoff ends within 2026. The full 10 days need a
launch by the end of 20 November 2026 (Lagos).

**What the student gets.** One `entitlement_grants` row with `source = 'early_access'`: their courses from the claim
until the same time one calendar month later on the Lagos calendar, Campus Bot at the Standard plan's limits, and their
courses set for the semester, as with any plan. Start and end are written by `claim_early_access` from the database
clock. Nothing a browser sends is a time.

**Where it is offered.** Only where the eligibility read says this student can claim now: one card at the top of the
Dashboard, the first plan card on Plan & Access ("Free month", ₦0), one line above Pay on checkout, and in place of the
free pass on a locked course and on Campus Bot. Each opens the same confirmation, which names the day the month would
end. After the claim, the Dashboard and Plan & Access show "Free month · Ends {day}".

### Launch

```
node scripts/entitlements/ops.cjs early-access-report
node scripts/entitlements/ops.cjs activate-launch --confirm-public-launch --actor <founder> --reason "public launch"
```

`early-access-report` is read-only. Before launch, `if_launched_now` says when the claim would close and whether the
window would be the full 10 days. After launch it says when the claim closes and whether it is open now, with counts of
months (claimed, running, ended, revoked) and of address records. `retired_list_rows` counts what is left in the old
list table, which nothing reads.

`activate-launch` records `actual_launch_at` once, from the database clock, and opens the claim. It enrols nobody and
cannot be undone. It prints the launch time and the time the claim closes, in Lagos time, and stores that closing instant. If launching now would give
a window shorter than the configured days (the cutoff comes first), it **records nothing** and says by when launch
would have given the full window. To launch anyway, repeat it with `--allow-short-claim-window`. Running it again
after launch changes nothing and prints the recorded times. The database also keeps the old signature,
`admin_activate_public_launch(actor, reason, limit)`, for callers built before the claim: it ignores the limit and never
allows a short window. The script always calls the three-argument form with `p_allow_short_window` set.

`configure-early-access --enrollment-days <n>` sets how long after launch a month can be claimed. It can be changed
only before launch: `activate-launch` stores the instant the claim closes, and after that a change to the days is refused
(`claim-window-fixed`, nothing changed) and the stored instant does not move, so the claim cannot reopen. `import-early-access`, `member` and `reconcile-early-access` are retired: the tool
refuses them, points here and sends nothing.

### One per account and per address

The grant table's unique index allows one Early Access grant per account, in any state. `private.early_access_claims`
holds one row per confirmed address that claimed, kept without the account link after the account is deleted ("Email
claims" above). It is a second table because the pass record holds one row per address, and a student who used a pass
may still claim a month. A repeat address is refused and audited as `early-access.claim-refused`; the student sees
"A free month isn’t available on this account."

A double tap, a second tab or a lost response is a replay: `claim_early_access` answers `already-claimed` with the
month's end, and the student sees their month. Revoking a month (`change-grant --action revoke`) does not let the
account or the address claim again. `change-grant --action extend` moves a month's end as for any grant; the rule that
every month ends within 2026 covers what students claim, not an end date an operator sets by hand.

### Concurrency

`claim_early_access` takes its locks in one order: the policy row (share; launch and policy changes hold it for update
and take nothing after it); the account, as every course-access write does (Auth row share, per-account advisory lock,
profile row share, calendar lock shared); the claim-keys lock; the lock of this address's hash; then its two inserts.
The claim locks are taken in the order `activate_discovery_pass` takes them, and no path that holds a claim lock goes
on to take the policy row or an account lock. Every decision is made on `clock_timestamp()` after the last lock is
held, so a claim that waited for a launch, or arrived in the window's last second, is judged at the time it runs.
`lib/entitlements/early-access-claim.database.test.cjs` covers repeated taps, several accounts on one address, 50
accounts claiming together, a claim racing launch, the closing instant, payment in both orders, a pass beside a claim
and deletion in both orders.

### What the old list left behind

`private.early_access_members` and its events are kept, unread (names and emails collected before 16 November 2026;
see "Owner decisions required before production"). An Early Access grant issued from the list, where a database holds
one, keeps its dates and counts as that account's one month. Application builds from before this change keep working
against the new database: `get_my_entitlement()` is unchanged, and its `early_access.status` is now only `not-listed`
(no month), `active` or `ended`.

## Pass and free month never overlap

A student whose free month is active cannot start a pass (`early-access-active`), and since
`20261023120000_discovery_eligibility.sql` neither can any account that has ever had Early Access (`trial-not-offered`;
owner decision, 23 October 2026). Since `20261116120000_early_access_claim.sql` no pass is offered or started while the
free month claim is open, and an address that claimed a month cannot start a pass on a new account. The pass returns
when the claim closes, for accounts that never had Early Access. The checks run under the same account lock as the
claim, so a race cannot start a pass during a free month, and nothing is consumed: no claim is written. A pass that
was already running when the month began (for example a pre-launch pass) continues, and AI used during the month never
counts against its fixed allowance.

## AI follows the entitlement

Trial and Early Access AI exist only through a current, unrevoked `entitlement_grants` row.
`public.ai_allowance_windows` now accepts `source = 'test'` only: the migration retires any trial or Early Access
window issued before it (each recorded as `legacy.ai-window-retired` in the audit trail), and
`issue_ai_allowance_grant` issues test grants only. Test grants count only in a verified local environment with
`AI_PRACTICE_ACCEPT_TEST_GRANTS=true` (unchanged).

Each AI use records the grant that funded it (`ai_usage_events.funding_source`, `funding_grant_id`) when it is admitted,
and a capped allowance counts only its own funded uses. Revoking, expiring or restoring a grant later never moves past
generations between allowances: sets generated under Early Access are never charged to a trial, and a trial's own sets
are never refunded by restoring Early Access. Failed generations are released and charge nothing.

## No SMS provider

The phone-code activation of `20261017100000_trial_entitlements.sql` is retired by `20261021100000_discovery_pass.sql`:
its functions, its challenge table and its `otp_*` policy are dropped, and no SMS provider, Termii account, sender ID or
`ENTITLEMENT_SMS_PROVIDER` / `TERMII_*` setting exists or is read anywhere. `ENTITLEMENT_PHONE_HASH_KEY` is no longer
read by anything (the list import stopped collecting phone numbers on 26 October 2026); keep the key until the owner
decides what happens to the stored phone hashes it produced.
`private.trial_phone_claims` is kept read-only as the record of seven-day trials activated by phone before the change;
nothing writes it.

## Disputes and recovery

Every change requires `--actor` and `--reason` and is written to `private.entitlement_events` in the same
transaction. The audit trail never contains phone numbers, email addresses or codes.

| Situation | Command |
| --- | --- |
| See an account's grants, pass claim, free month, AI allowance and history | `status --user <uuid>` |
| Remove expired email claims / see which claim key versions are still referenced | `purge-claims` / `claim-keys` |
| Activation outage or support compensation | `grant --user <uuid> --days <n>` (course access, no AI) |
| Extend, revoke or restore a grant (revoking ends its AI at once) | `change-grant --grant <uuid> --action extend --until <ISO>` / `revoke` / `restore` |
| Generations disputed during a trial | `change-grant --grant <uuid> --action set-ai-units --units <n>` |
| A student says they could not claim their free month | `status --user <uuid>` for the account, `early-access-report` for the claim window. The team never starts a month for a student; compensate with `grant --user <uuid> --days <n>` (course access, no AI) |
| One person claimed on two accounts with different addresses | `change-grant --grant <uuid> --action revoke` on the later month |
| Change how long after launch a month can be claimed, or the planned date | `configure-early-access [--enrollment-days n] [--planned-launch ISO]` (the 30 November cutoff still applies; `--trial-after-early-access` is retired and refused) |

The tool needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (an `sb_secret_` key over HTTPS when hosted). A
student who believes a pass or free month claim is wrong (for example an address they never controlled) is handled with `grant`, never by freeing the claim.

## Courses are set for the semester

From `20261026100000_course_selection_lock.sql`, a student's department, level and semester are locked once any plan
has started since they were saved: a Discovery Pass, a seven-day trial, Early Access, a manual grant or a paid plan. An
ended pass still locks until the semester ends; a revoked grant does not lock. The database refuses every other change
with `CI423`, whoever sends it (the app, a direct API call or a service-role script); saving a name never unlocks. A
student who picks for the first time while Early Access runs is locked by that first pick. At the semester end the lock
lifts by itself. If no semester after today has been entered, locks stay on.

| Situation | Command |
| --- | --- |
| See a student's courses, lock state, reason, semester end and history | `selection-status --user <uuid>` |
| Change a student's courses on request (they stay locked) | `selection-change --user <uuid> --department <key> --level <key> --semester <key> --expected-revision <n>` |
| Set a combination that has no courses yet | the same, with `--allow-empty` |
| See the semesters, extensions and calendar history | `calendar` |
| Enter or move a semester's resumption date (only before it resumes) | `term-set --session 2026/2027 --semester first-semester --resumes-on 2026-11-09` |
| Delay one department's end, or every department's | `term-extend --session 2026/2027 --semester first-semester --department <key>\|all --last-day <YYYY-MM-DD>` |

- Every command except the two reads needs `--actor` and `--reason`, and is recorded in `private.course_selection_events`.
- `--expected-revision` is the `revision` shown by `selection-status`. If the student saved in between, the command
  answers `conflict`; read the status again.
- A semester ends exactly four months after its resumption date, at 00:00 Lagos (resuming 9 Nov 2026, the last day is
  8 Mar 2027). The migration enters 2026/2027 First Semester with the default resumption date of Mon 9 Nov 2026; move
  it with `term-set` until that day.
- `term-extend` takes the department's new last day. Giving the semester's own last day removes the extension. It is
  refused (`ended`) once that department's semester has ended, and nothing changes; handle a late request for one
  student with `selection-change`. Semesters may not overlap, and a department's end may not pass the next semester's.
- Before restoring a revoked grant (`change-grant --action restore`), check the student's courses with
  `selection-status`: a restored grant sets whatever courses the student has at that moment.
- A selection change touches no grant, preview or practice attempt. If a pass was spent on the wrong courses because of
  a team mistake, compensate with `grant` separately.

## Account deletion

A deletion-scheduled account cannot start a pass or claim a free month. Purging an account removes its grants (and so
its AI) and its previews. The keyed pass claim and the keyed free month claim (each for its retention period, 5 years
from the day it was made), any historical phone hash and the audit rows are kept without the account link, so deleting
and re-registering the same address cannot start a second pass or a second month within that period. The deletion form
tells students: "We keep a note that this email has used its free pass or free month." It does not state the period.

## Owner decisions required before production

1. Discovery Pass limits are initial values in `private.entitlement_policy` (`discovery_*` columns). `trial_days` and
   `ai_practice_policy.trial_units` describe only the seven-day trials issued before the pass, which keep their end,
   full access and AI allowance (audited as `trial.seven-day-preserved`). `get_my_entitlement()` still returns
   `trial_days` (the pass length in whole days) beside `trial_hours`, so older application instances keep working
   during a rollout.
2. Free month claim window: **10 days** after the actual launch, closing no later than the end of 30 November 2026
   (Lagos) so that every month ends within 2026 (**decided 16 November 2026**, `20261116120000_early_access_claim.sql`;
   14 days was the policy from 5 November 2026, and 28 days before that). A launch after 20 November gives a shorter
   window, and `activate-launch` then asks for `--allow-short-claim-window`.
3. Trial after Early Access: **decided 23 October 2026**, never (`trial_after_early_access` retired, kept false).
4. Retention and deletion: keyed pass claims and keyed free month claims expire 5 years after they were made
   (**decided 23 October and 16 November 2026**). Historical phone hashes, the retired list's data (names, emails,
   phone hashes) and de-identified audit rows are currently kept indefinitely. Needed: a retention period for them,
   whether to delete the retired list, and privacy-notice wording.
5. Whether to set the platform-wide daily activation guard (`discovery_activations_per_day`, off by default) and
   whether the per-account request limit (5 per 15 minutes) and the per-address notice threshold (60) suit launch day.
6. The moment to run `activate-launch`, which is irreversible and opens the free month claim.

## Payments

Paid plans are not implemented (no Paystack). A future payment confirmation should insert an `entitlement_grants`
row with `source = 'paid'` and a non-personal reference through a new service-role function, and choose its AI
terms. The read path, course gate and same-session updates need no change.

## Not yet in place

- An email reminder before the pass ends. Students see an in-app notice for the last 12 hours and for 14 days after
  the pass ends.
- Upgrade prompts to a paid plan, since no paid plan exists yet.
- Analytics: `trial_activated` is recorded. A claimed free month is recorded in the audit trail
  (`early-access.claimed`); no analytics event is emitted from the database.
