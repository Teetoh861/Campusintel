# Trial, Early Access and entitlement operations

Owner: founder/operations. Intended launch: 25 October 2026 (a target, not the Early Access start).
Implements PRD v1.4 §4.5 and §4.9, as amended by the founder on 2026-10-21: the Discovery Pass is activated with one
click by a signed-in student and **collects no phone number**. This is a deployment and runbook handoff, not evidence of
hosted activation. No hosted migration, SMS send, Anthropic call or deployment was made while building it.

## What students get

| Plan | How it starts | Courses | AI practice |
| --- | --- | --- | --- |
| Free (every account) | Registration and email confirmation | Courses with `institutional_courses.is_free` (GST111, GST102, GST112, GST212) | None |
| Discovery Pass (`source = 'trial'`, `trial_policy = 'discovery'`, since `20261021100000_discovery_pass.sql`) | One tap on Plan & Access by the signed-in student (`activate_discovery_pass`), once per account and once per confirmed email address (for 5 years); never for an account that has ever had Early Access. Offered only to students who are eligible, decided on the server before render. No phone number, SMS or code | **A restricted sample, never full access.** For `discovery_hours` (72) on database time: one CBT exam of exactly `discovery_cbt_questions` (50) valid questions from one actively offered course the student picks. It opens only if that course's whole CBT duration fits before the pass ends, and is never shortened. Answers are saved as the student goes; at the database deadline the exam closes and is marked from the last sheet saved in time. Nothing sent after the deadline is marked, and `discovery_cbt_grace_seconds` (120) only replays an already marked result. Plus one complete study-guide topic the student picks from one actively offered course. Every other topic stays locked. No theory preview. Nothing renews | One accepted upload (`discovery_ai_uploads`, 1, enforced when an upload becomes ready, however many were reserved; refused files cost nothing) of at most `discovery_ai_source_chars` (20,000) characters. Only that upload can use the pass. `discovery_ai_generations` (1) delivered set of exactly five valid questions; a short or malformed set is a failed attempt and is not charged. At most `discovery_ai_attempts` (3) provider attempts, failed ones included |
| Seven-day trial (`source = 'trial'`, `trial_policy = 'seven-day'`) | Issued before `20261021100000`; no new ones | Every course until its own original end | Its original allowance under the shared AI rules |
| Early Access | **Automatic**, once the founder activates the actual public launch | Every course for one calendar month from the student's own enrollment | No per-student cap; global and per-day guards still apply |
| Operator grant | `scripts/entitlements/ops.cjs grant` | Every course for the stated days | None (course access only) |

Free is the institutional `is_free` flag, never `courses.is_shared`. Login stays email and password. Running out of
AI units never closes courses. Revoking or expiring any grant ends its course access **and** its AI at once.

## Discovery Pass activation: one click, one per account

A signed-in, eligible student taps **Start my Discovery Pass** on Plan & Access and confirms: "Start your 72-hour
Discovery Pass now? It can be used only once." (**Start now** / **Not now**; the hours come from the database). The
route verifies the session and page continuity, applies the request limit, and calls
`activate_discovery_pass(session_id, claim_hashes)` with the service role. The database, under the same per-account
lock Early Access enrollment and previews take:

- refuses an account that already has a trial grant of any kind, active, ended or revoked (`already-activated`, a
  harmless replay for a double tap or a lost response);
- refuses while Early Access is active (`early-access-active`) and, from `20261023120000_discovery_eligibility.sql`,
  for any account that has ever had Early Access (`trial-not-offered`): an `early_access` grant in any state (active,
  ended or revoked), or a claimed list entry for the account's confirmed, normalised email, which covers an account
  deleted and registered again. `trial_after_early_access` is retired: pinned to false and no longer read;
- refuses a confirmed email address that has started a pass on any account, including one since deleted, within the
  claim retention period (`already-claimed`; see "Email claims" below);
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
`ops.cjs purge-claims` does the same at once. Changing the policy value later affects new claims only. No hosted database ever held the earlier unkeyed shape of this
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

## Early Access: automatic, from the actual launch

`private.entitlement_policy` holds `planned_launch_at` (informational: 25 October 2026) and `actual_launch_at`
(null until the founder activates launch). **The planned date never starts a benefit.** While `actual_launch_at` is
null, list members see "starts automatically when CampusIntell launches publicly" and no date; a delayed launch
costs them nothing.

When the platform actually goes public:

```
node scripts/entitlements/ops.cjs activate-launch --confirm-public-launch --actor <founder> --reason "public launch"
```

This records `actual_launch_at = now()` once (repeating it changes nothing) and enrolls eligible confirmed accounts
in bounded batches of 200, earliest join first, repeating until none remain. Each account's calendar month starts when
its batch commits (seconds apart at most); any account not yet reached also enrolls itself on its next plan read. After launch, an eligible
account is enrolled automatically, with its own full month starting then, when:

- its email is confirmed (or changed to a listed address and confirmed), through a trigger on `auth.users`;
- an operator imports or re-includes its list entry;
- it reads its plan (`get_my_entitlement()` self-heals anything a trigger missed);
- an operator runs `reconcile-early-access` (an idempotent recovery sweep).

Eligibility is the trusted list only, matched to the account's **confirmed** email (case-insensitive): a typed or
unconfirmed address proves nothing. Each list entry, and each duplicate group (same phone at import, or grouped by an
operator), enrolls once. An existing grant is never reset or extended by logins, imports, sweeps or repeat
reconciliation. Enrollment closes `early_access_enrollment_days` after the actual launch (**28, approved by the owner on 23 October
2026**: the 28-day window is for claiming after launch, and the list itself closes at launch, as `early_access_status()`
already enforces for members who join on or after the actual launch). The PROVISIONAL marking in
`20261017100000_trial_entitlements.sql` is a SQL source comment, not a database `COMMENT`, so that migration is left
untouched and the approval is recorded here. No phone code and no per-student AI cap apply during the month.

Concurrency: every Early Access path takes locks in one total order: policy row; account rows and account locks
(ascending, all before anything below, so a sweep locks every account of its batch first); import identity locks
(email, then phone); a regroup lock (exclusive for mark/clear-duplicate, shared otherwise, so group membership cannot
change under anyone holding a group lock); duplicate-group locks (ascending); member rows, then grant rows. Simultaneous
imports of one email or one phone form one group and grant one month, and no combination of these paths can deadlock.

### One month per identity when duplicates are merged

Marking members as duplicates can join two groups that were each already enrolled. In the same transaction the group
keeps one **canonical** grant, the earliest-starting unrevoked Early Access grant (lowest grant id on a tie), which is
the month the person actually began first. Every other unrevoked Early Access grant in the merged group is revoked
(`revoked_by = system:duplicate-merge`), never deleted: the audit trail names the canonical grant, and AI the duplicate
funded stays attributed to it. Nothing is restarted or extended. The canonical grant counts even after it has ended:
the identity has had its one lifetime month.

Separating identities again (`clear-duplicate`) never restores a revoked month by itself. If the people really are
different, restore the grant explicitly with `change-grant --action restore`; a restore is refused
(`duplicate-identity`) while the grant's group already holds another unrevoked Early Access grant. Policy point for the
owner: if the earliest grant had been revoked by an operator (for example after a dispute), it is no longer a
candidate and the earliest *unrevoked* grant becomes canonical. Launch activation holds the policy row for update and skips account rows locked by an
in-flight confirmation; that confirmation's trigger then waits for the launch to commit and enrolls itself. Both
orders are covered by `lib/entitlements/activation.database.test.cjs`.

### Importing the list

```
node scripts/entitlements/ops.cjs import-early-access --file list.csv --batch google-form-2026-10 --actor <name> --dry-run
node scripts/entitlements/ops.cjs import-early-access --file list.csv --batch google-form-2026-10 --actor <name>
```

CSV header: `email,full_name,phone,joined_at`. `phone` may be empty; when present it is hashed locally with
`ENTITLEMENT_PHONE_HASH_KEY` and a phone already on the list puts the row in that member's duplicate group.
`joined_at` must not be in the future and, after launch, must be before the actual launch (pre-launch signups only).
The whole file is validated before any row is written; existing emails are never overwritten. Prior WhatsApp
contacts are imported the same way. An import after launch enrolls a matching confirmed account immediately.
Review `early-access-report` (same-name rows are reported, never blocked); use
`member --action mark-duplicate|clear-duplicate|exclude|include`. Excluding or grouping never removes a grant
already made; revoke it explicitly with `change-grant`.

## Pass and Early Access never overlap

A student whose Early Access is active cannot start a pass (`early-access-active`), and since
`20261023120000_discovery_eligibility.sql` neither can any account that has ever had Early Access (`trial-not-offered`;
owner decision, 23 October 2026). The checks run under the same account lock as enrollment, so a race cannot start a
pass during Early Access, and nothing is consumed: no claim is written. A pass that was already running when Early
Access began (for example a pre-launch pass) continues, and AI used during Early Access never counts against its fixed
allowance.

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
`ENTITLEMENT_SMS_PROVIDER` / `TERMII_*` setting exists or is read anywhere. `ENTITLEMENT_PHONE_HASH_KEY` remains only
for the operator tool's Early Access list import (phone column), which never touches the pass.
`private.trial_phone_claims` is kept read-only as the record of seven-day trials activated by phone before the change;
nothing writes it.

## Disputes and recovery

Every change requires `--actor` and `--reason` and is written to `private.entitlement_events` in the same
transaction. The audit trail never contains phone numbers, email addresses or codes.

| Situation | Command |
| --- | --- |
| See an account's grants, pass claim, Early Access status, AI allowance and history | `status --user <uuid>` |
| Remove expired email claims / see which claim key versions are still referenced | `purge-claims` / `claim-keys` |
| Activation outage or support compensation | `grant --user <uuid> --days <n>` (course access, no AI) |
| Extend, revoke or restore a grant (revoking ends its AI at once) | `change-grant --grant <uuid> --action extend --until <ISO>` / `revoke` / `restore` |
| Generations disputed during a trial | `change-grant --grant <uuid> --action set-ai-units --units <n>` |
| Someone eligible was not enrolled | `reconcile-early-access` (bounded batches until nothing remains) |
| Two enrolled accounts are the same person | `member --email <later> --action mark-duplicate --of <earlier>` (keeps the canonical month, revokes the other) |
| Change the enrollment window or planned date | `configure-early-access [--enrollment-days n] [--planned-launch ISO]` (`--trial-after-early-access` is retired and refused) |

The tool needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (an `sb_secret_` key over HTTPS when hosted) and,
for list imports with a phone column, `ENTITLEMENT_PHONE_HASH_KEY`. A student who believes a pass claim is wrong (for
example an address they never controlled) is handled with `grant`, never by freeing the claim.

## Account deletion

A deletion-scheduled account cannot start a pass or be enrolled in Early Access. Purging an account removes its
grants (and so its AI) and its previews. The keyed pass claim (for its retention period), the used Early Access entry,
any historical phone hash and the audit rows are kept without the account link, so deleting and re-registering the same
address cannot start a second pass within the retention period (5 years from activation), or a second month. The
deletion form tells students that a protected record is kept; it does not state the period.

## Owner decisions required before production

1. Discovery Pass limits are initial values in `private.entitlement_policy` (`discovery_*` columns). `trial_days` and
   `ai_practice_policy.trial_units` describe only the seven-day trials issued before the pass, which keep their end,
   full access and AI allowance (audited as `trial.seven-day-preserved`). `get_my_entitlement()` still returns
   `trial_days` (the pass length in whole days) beside `trial_hours`, so older application instances keep working
   during a rollout.
2. Early Access enrollment window: **decided 23 October 2026**, 28 days after the actual launch for claiming; the list
   closes at launch.
3. Trial after Early Access: **decided 23 October 2026**, never (`trial_after_early_access` retired, kept false).
4. Retention and deletion: keyed pass claims expire 5 years after activation (**decided 23 October 2026**). Historical
   phone hashes, imported list data (names, emails, phone hashes), used list entries and de-identified audit rows are
   currently kept indefinitely. A retention period and privacy-notice wording are needed.
5. Whether to set the platform-wide daily activation guard (`discovery_activations_per_day`, off by default) and
   whether the per-account request limit (5 per 15 minutes) and the per-address notice threshold (60) suit launch day.
6. The moment to run `activate-launch`, which is irreversible.

## Payments

Paid plans are not implemented (no Paystack). A future payment confirmation should insert an `entitlement_grants`
row with `source = 'paid'` and a non-personal reference through a new service-role function, and choose its AI
terms. The read path, course gate and same-session updates need no change.

## Not yet in place

- An email reminder before the pass ends. Students see an in-app notice for the last 12 hours and for 14 days after
  the pass ends.
- Upgrade prompts to a paid plan, since no paid plan exists yet.
- Analytics: `trial_activated` is recorded. Early Access enrollment is recorded in the audit trail
  (`early-access.granted`); no analytics event is emitted from the database.
