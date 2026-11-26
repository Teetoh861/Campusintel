# Free pass, free access (Early Access) and entitlement operations

Owner: founder/operations. Implements PRD v1.4 §4.5 and §4.9 as amended by the owner. On 2026-10-21 the Discovery Pass
became one click by a signed-in student and **collects no phone number**. On 2026-11-16 the pre-launch Early Access
list was retired: Early Access became a grant the student claims on the site after launch
(`20261116120000_early_access_claim.sql`). On 2026-11-25 it became **free access until the end of 30 December 2026
(Lagos)**: claimed on the site from the launch, and every claim ends then (`20261126100000_free_until_30_december.sql`).
Students see "Free until 30 December" as its name, "free access" in a sentence, and "Free pass"; "Early Access" and
"Discovery Pass" are our names only. The planned launch date in the policy is informational: it starts and ends nothing.
This is a deployment and runbook handoff, not evidence of hosted activation. No hosted migration, SMS send, Anthropic
call or deployment was made while building it.

## What students get

| Plan | How it starts | Courses | AI practice |
| --- | --- | --- | --- |
| Free (every account) | Registration and email confirmation | Courses with `institutional_courses.is_free` (GST111, GST102, GST112, GST212) | None |
| Discovery Pass (`source = 'trial'`, `trial_policy = 'discovery'`, since `20261021100000_discovery_pass.sql`) | One tap on Plan & Access by the signed-in student (`activate_discovery_pass`), once per account and once per confirmed email address (for 5 years); never for an account that has ever had Early Access or an address that has claimed free access, and not while free access can be claimed (from the launch until the end of 30 December 2026, Lagos). Offered only to students who are eligible, decided on the server before render. No phone number, SMS or code | **A restricted sample, never full access.** For `discovery_hours` (72) on database time: one CBT exam of exactly `discovery_cbt_questions` (50) valid questions from one actively offered course the student picks. It opens only if that course's whole CBT duration fits before the pass ends, and is never shortened. Answers are saved as the student goes; at the database deadline the exam closes and is marked from the last sheet saved in time. Nothing sent after the deadline is marked, and `discovery_cbt_grace_seconds` (120) only replays an already marked result. Plus one complete study-guide topic the student picks from one actively offered course. Every other topic stays locked. No theory preview. Nothing renews | One accepted upload (`discovery_ai_uploads`, 1, enforced when an upload becomes ready, however many were reserved; refused files cost nothing) of at most `discovery_ai_source_chars` (20,000) characters. Only that upload can use the pass. `discovery_ai_generations` (1) delivered set of exactly five valid questions; a short or malformed set is a failed attempt and is not charged. At most `discovery_ai_attempts` (3) provider attempts, failed ones included |
| Seven-day trial (`source = 'trial'`, `trial_policy = 'seven-day'`) | Issued before `20261021100000`; no new ones | Every course until its own original end | Its original allowance under the shared AI rules |
| Free access, "Free until 30 December" (Early Access, `source = 'early_access'`) | **Claimed by the student** on the site (`claim_early_access`) while the claim is open: from the actual launch until the end of 30 December 2026 (Lagos). Once per account and once per confirmed email address (for 5 years). Never with a current paid plan or a throwaway email domain, and only once the student's courses are confirmed | The student's courses from the claim until the end of 30 December 2026 (Lagos): the same end for every claim, so an earlier claim gets more days. Claims made before `20261126100000` keep their one-calendar-month end. It sets their courses for the semester | Campus Bot at the Standard plan's limits (`20261103160000`), until the same end |
| Operator grant | `scripts/entitlements/ops.cjs grant` | Every course for the stated days | None (course access only) |

Free is the institutional `is_free` flag, never `courses.is_shared`. Login stays email and password. Running out of
AI units never closes courses. Revoking or expiring any grant ends its course access **and** its AI at once.

## Discovery Pass activation: one click, one per account

A signed-in, eligible student taps **Get your free pass** on Plan & Access and confirms in "Your free pass": what it
gives, "It lasts 3 days from now.", "Each student can have one free pass." and the courses line (**Start your free
pass** / **Not now**; the days come from the database's `discovery_hours`). The route verifies the session and page continuity, applies the request limit, and calls
`activate_discovery_pass(session_id, claim_hashes)` with the service role. The database, under the same per-account
lock the free access claim and previews take:

- refuses an account that already has a trial grant of any kind, active, ended or revoked (`already-activated`, a
  harmless replay for a double tap or a lost response);
- refuses while Early Access is active (`early-access-active`) and, from `20261023120000_discovery_eligibility.sql`,
  for any account that has ever had Early Access (`trial-not-offered`): an `early_access` grant in any state (active,
  ended or revoked). From `20261116120000_early_access_claim.sql` it also refuses every account while free access
  can be claimed (`trial-not-offered`), so the two are never offered together, and the retired list bars nobody.
  `trial_after_early_access` is retired: pinned to false and no longer read;
- refuses a confirmed email address that has started a pass or claimed free access on any account, including one
  since deleted, within the claim retention period (`already-claimed`; see "Email claims" below);
- refuses once the platform-wide guard for the UTC day is reached (`capacity`), when the owner has set one;
- otherwise writes the grant with start and end from its own clock (`discovery_hours`), the fixed AI allowance
  (`discovery_ai_generations`), the claim row and the `discovery.activated` audit event, all in one transaction.

Every refusal for this account (`already-claimed`, `trial-not-offered`, `early-access-active`) shows the student
exactly: "A free pass isn’t available on this account. Free GST courses are still open to you." No email, period
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

Free access is offered the same way. When the plan says a claim could be open for this account (a launch is recorded,
the close it reports in `early_access.enrollment_closes_at` has not passed by the database's own clock, no Early Access
grant and no paid plan), the same server read calls `early_access_claim_eligibility(session_id, claim_hashes)`. It
applies the claim's rules without a lock, a write or key registration, and answers `{eligible}` and, when eligible,
`ends_at` and `closes_at`. Since `20261126100000` the plan's `enrollment_closes_at` and both of these are the stored
close: the instant the claim closes and every claim ends. Pages print it as the last day it covers ("Free until 30
December"); the end is the exclusive Lagos midnight after that day, so no page names 31 December. The claim writes its
start on its own clock. Every failure counts as not eligible, and the student is shown nothing.

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
`ops.cjs purge-claims` does the same at once. `private.early_access_claims` is the same record for free access: the
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

## Early Access (free access until 30 December): claimed on the site

Owner decisions of 16 November 2026, replacing PRD 4.9's pre-launch list (`20261116120000_early_access_claim.sql`),
and of 25 November 2026, making it free access until the end of 30 December
(`20261126100000_free_until_30_december.sql`). There is no list: nothing is granted at sign-up, at email confirmation
or by a page read, and no operator command enrols anyone.

**Who can claim.** A signed-in student, when all of these hold at the moment of the claim:

- the account's email is confirmed, and the account is not banned or scheduled for deletion;
- the claim is open (below);
- the account has never had an Early Access grant, in any state (one per account, ever);
- the account has no current paid plan. A refunded plan is revoked and does not count; the second half of a Session
  plan and a plan waiting for its semester do;
- the address is not on a throwaway email domain (the free pass's own check, `discovery_email_allowed`);
- the student's courses are confirmed for the current semester;
- no account has claimed free access with the same confirmed address in the last 5 years.

A student who has used a free pass can still claim. A student who cannot claim is shown no offer and no reason.

**When the claim is open.** `private.entitlement_policy` holds `actual_launch_at` (null until the founder activates
launch) and `early_access_claim_cutoff` (**the end of 30 December 2026, Africa/Lagos**: `2026-12-31 00:00:00+01`, which
is `2026-12-30T23:00:00Z`). The claim opens at the actual launch and closes at the cutoff, and every claim ends at that
same instant. The close is stored with the launch (`early_access_claim_closes_at`, 20261116130000) and every check
reads the stored value. Since `20261126100000` it follows the cutoff: the trigger `entitlement_policy_fix_claim_close`
sets it to the cutoff on every update of the policy row once a launch is recorded (null before), so a write to the
close alone is undone. No command changes the cutoff; only a migration or direct SQL on the cutoff moves the end. The
landing page's FAQ carries the same instant (`FREE_ACCESS_ENDS_AT` in `lib/landing/content.ts`): change both together.
`early_access_enrollment_days` (10) and `early_access_duration` (`1 mon`) are retired: they stay in the table, and no
claim, launch, report or plan-read rule reads them.

**What the student gets.** One `entitlement_grants` row with `source = 'early_access'`: their courses from the claim
until the end of 30 December 2026 (Lagos), Campus Bot at the Standard plan's limits until then, and their courses set
for the semester, as with any plan. An earlier claim gets more days. A claim late on 30 December gets hours, and it
still sets the courses for the semester and uses the account's and the address's one claim: claims stay open to the
very end (owner decision, 25 November 2026). `claim_early_access` writes the start from the database clock and the end
from the stored close. Nothing a browser sends is a time. Claims made under the old rule, before `20261126100000`, keep
their one-calendar-month ends (owner decision, 25 November 2026); only the test site can have any.

**Where it is offered.** Only where the eligibility read says this student can claim now. Every day shown is the
database's end, printed as the last day it covers, never a fixed date: a one-month claim made under the old rule reads
"Free until 18 December", for example.

| Where | What the student sees |
| --- | --- |
| Dashboard, one card at the top | "Free until 30 December", "Full access to your courses and Campus Bot." and **Get free access** |
| Plan & Access, the first plan card | "Free until 30 December", ₦0, the same line and button |
| Checkout, one line above Pay | "You can get free access until 30 December instead." and the button; paying stays possible |
| A locked course and Campus Bot, in place of the free pass | "Included free until 30 December." / "Campus Bot is included free until 30 December." and the button |
| The confirmation every button opens | "Free until 30 December", what it gives, "Starts now", "You can’t change your department, level or semester until the semester ends." and **Start free access** / **Not now** |
| After the claim | "Free until 30 December" on the Dashboard and Plan & Access; "Your free access continues until Wed, 30 Dec 2026." on checkout |
| The last 12 hours (`expiry_notice_hours`), Dashboard and My Courses | "Your free access ends at midnight tonight." "After that, only GST courses stay free." and **View your plan**. A one-month claim reads "Your free access ends {its date and time}." |
| Once it has ended | "Your free access has ended." on Plan & Access |
| A claim that starts nothing | "Free access isn’t available on this account." (this account or address cannot claim), "This offer has ended." (the claim has closed) or "Couldn’t start your free access. Try again." (anything else) |

The public landing page's FAQ answers "Can I try it before paying?" with "Yes. GST courses are always free, and until
30 December you can get free access to all your courses." until the end of 30 December, and with "Yes. GST courses are
free, and a free pass lets you try your department courses." after it (owner decisions, 25 and 26 November 2026). The
page is static and cannot see the launch: the answer is picked when the page is built and again on the visitor's device,
by date only. Before the live launch nobody can claim yet (the free pass is what a new student gets then), so production
gets the release that first carries this page on launch day, immediately before the migration and `activate-launch`
(below; owner decision, 26 November 2026: a release rule, not a build-time launch switch). A build made after the end of 30 December carries the free pass answer in its HTML; until then, a visitor
whose device clock is behind, or who has JavaScript off, still reads the free access answer, so redeploy production
once after the end of 30 December.

### Launch

```
node scripts/entitlements/ops.cjs early-access-report
node scripts/entitlements/ops.cjs activate-launch --confirm-public-launch --actor <founder> --reason "public launch"
```

`early-access-report` is read-only. It shows `claim_cutoff` (the end), `claim_closes_at` (the stored close: null before
launch, then the same instant) and `claim_open`. Before launch, `if_launched_now` says what a launch now would decide:
`claim_would_close_at` (the cutoff) and `claim_would_open` (false once the cutoff has passed, when a launch is refused).
Since `20261126100000` it has no `claim_days`. `months` counts the grants (claimed, running, ended, revoked; the key
keeps its old name) and `address_records` the live address records. `retired_list_rows` counts what is left in the old
list table, which nothing reads. Instants print as the database returns them: the end reads
`2026-12-30T23:00:00+00:00`.

`activate-launch` records `actual_launch_at` once, from the database clock, and opens the claim until the cutoff. It
enrols nobody and cannot be undone. It stores the close and prints the launch time and the close in Lagos time:
`claim_closes` reads "Thu, 31 Dec 2026, 00:00 (Lagos)", the first instant after 30 December. It is refused, and
**records nothing**, only once the cutoff has passed ("launch NOT recorded: free access could be claimed only until …,
which has passed"): a launch then would open nothing. A database without `20261126100000` still closes the claim 10
days after launch or at the end of 30 November, so it refuses every launch after the end of 20 November (Lagos); the
tool then says to apply `supabase/migrations/20261126100000_free_until_30_december.sql` first.
`--allow-short-claim-window` is retired: the tool refuses it by name and sends nothing. Running it again after launch
changes nothing and prints the recorded times. The database also keeps the old signature,
`admin_activate_public_launch(actor, reason, limit)`, for callers built before the claim: it ignores the limit and never
allows a launch after the cutoff. The script always calls the three-argument form with `p_allow_short_window` false.

`configure-early-access --planned-launch <ISO>` records the planned launch date, which is informational.
`--enrollment-days` is retired by `20261126100000`: the tool refuses it by name and sends nothing, and otherwise sends
no days. (The database still stores days an older tool sends before launch and refuses a change to them after it,
`claim-window-fixed`; nothing reads them.) No command changes the cutoff or the stored close. `import-early-access`,
`member` and `reconcile-early-access` are retired: the tool refuses them, points here and sends nothing.

### Applying `20261126100000_free_until_30_december.sql`

The test site has a recorded launch, and its stored close is the old rule's (10 days after launch, or the end of 30
November). The migration replaces the trigger function first and then moves the cutoff, so the stored close follows
it. It is one transaction, and it aborts whole unless the stored close then equals the new cutoff (or stays null before
a launch). It writes no grant and no audit event: the report taken before and after is the record.

1. Deploy the app with this change first (the develop build on the test site, `main` on production). It reads a
   one-month end correctly; the old app on the new database would name 31 December and one month. On production this
   is the launch-day release, followed straight away by steps 2-5 and `activate-launch`: its landing page promises free
   access, which nobody can claim before the launch. On the test site, apply the migration right after the develop
   deploy.
2. `early-access-report`: note `actual_launch_at`, `claim_closes_at` and `months`. Production must show no launch and
   `months.claimed` 0; if it shows a launch or any claim, stop and ask the owner. On the test site, also count the
   grants from the retired list: `select count(*) from public.entitlement_grants where source = 'early_access' and
   reference ? 'member_id';`. Their addresses were never written to `private.early_access_claims`, so once the window
   reopens another account with the same address can still claim (test site only; it cannot be backfilled without
   `ENTITLEMENT_CLAIM_HASH_KEYS`).
3. `supabase migration list` against the project. Stop if a remote version is missing locally, or if a pending local
   file sorts before the newest remote version. Never use `--include-all`.
4. `supabase db push`, at a quiet moment. The cutoff update waits for claims in flight: they finish under the old rule,
   with a one-month end, and claims after the commit end at the new close.
5. `early-access-report` again: on the test site `claim_cutoff` and `claim_closes_at` are both
   `2026-12-30T23:00:00+00:00`, `claim_open` is true, and `actual_launch_at` and `months` are unchanged.

On the test site the claim is then open from the recorded launch until the end of 30 December, so a window that had
already closed reopens (owner decision, 25 November 2026) and the offer comes back for eligible students. The free pass
is hidden again until then from every account without free access; passes already running continue. Grants already
claimed keep their ends. `activate-launch` answers `already-launched` with the new `claim_closes_at`.

Production has no launch, so step 5 reads `claim_closes_at` null and `if_launched_now` with `claim_would_close_at`
`2026-12-30T23:00:00+00:00` and `claim_would_open` true. Production must have the migration before `activate-launch`,
which then runs without any flag; afterwards `claim_closes_at` is `2026-12-30T23:00:00+00:00`.

### One per account and per address

The grant table's unique index allows one Early Access grant per account, in any state. `private.early_access_claims`
holds one row per confirmed address that claimed, kept without the account link after the account is deleted ("Email
claims" above). It is a second table because the pass record holds one row per address, and a student who used a pass
may still claim free access. A repeat address is refused and audited as `early-access.claim-refused`; the student sees
"Free access isn’t available on this account."

A double tap, a second tab or a lost response is a replay: `claim_early_access` answers `already-claimed` with the
grant's own end, and the student sees their free access. Revoking it (`change-grant --action revoke`) does not let the
account or the address claim again. `change-grant --action extend` moves its end as for any grant; the rule that every
claim ends at the end of 30 December covers what students claim, not an end date an operator sets by hand.

### Concurrency

`claim_early_access` takes its locks in one order: the policy row (share; launch and policy changes hold it for update
and take nothing after it); the account, as every course-access write does (Auth row share, per-account advisory lock,
profile row share, calendar lock shared); the claim-keys lock; the lock of this address's hash; then its two inserts.
The claim locks are taken in the order `activate_discovery_pass` takes them, and no path that holds a claim lock goes
on to take the policy row or an account lock. Every decision is made on `clock_timestamp()` after the last lock is
held, so a claim that waited for a launch, or arrived in the window's last second, is judged at the time it runs.
`lib/entitlements/early-access-claim.database.test.cjs` covers repeated taps, several accounts on one address, 50
accounts claiming together (every grant ends at the stored close), a claim racing launch (it ends at the close the
launch stored), a claim racing a move of the end (it waits for the move, then ends at the new end), a claim fifteen
days after launch (the 10-day window is gone), the closing instant, payment in both orders, a pass beside a claim and
deletion in both orders.

### What the old list left behind

`private.early_access_members` and its events are kept, unread (names and emails collected before 16 November 2026;
see "Owner decisions required before production"). An Early Access grant issued from the list, where a database holds
one, keeps its dates and counts as that account's one claim. Application builds from before this change keep working
against the new database: `get_my_entitlement()` keeps its shape, and its `early_access.status` is now only
`not-listed` (no grant), `active` or `ended`. Since `20261126100000` its `early_access.enrollment_closes_at` is the
stored close, no longer the launch plus the days.

## Pass and free access never overlap

A student whose free access is active cannot start a pass (`early-access-active`), and since
`20261023120000_discovery_eligibility.sql` neither can any account that has ever had Early Access (`trial-not-offered`;
owner decision, 23 October 2026). Since `20261116120000_early_access_claim.sql` no pass is offered or started while
free access can be claimed, and an address that claimed free access cannot start a pass on a new account. The pass
returns when the claim closes, at the end of 30 December 2026 (Lagos), for accounts that never had free access. The
checks run under the same account lock as the claim, so a race cannot start a pass during free access, and nothing is
consumed: no claim is written. A pass that was already running when free access began (for example one started before
the launch) continues, and AI used during free access never counts against its fixed allowance.

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
| See an account's grants, pass claim, free access, AI allowance and history | `status --user <uuid>` |
| Remove expired email claims / see which claim key versions are still referenced | `purge-claims` / `claim-keys` |
| Activation outage or support compensation | `grant --user <uuid> --days <n>` (course access, no AI) |
| Extend, revoke or restore a grant (revoking ends its AI at once) | `change-grant --grant <uuid> --action extend --until <ISO>` / `revoke` / `restore` |
| Generations disputed during a trial | `change-grant --grant <uuid> --action set-ai-units --units <n>` |
| A student says they could not claim free access | `status --user <uuid>` for the account, `early-access-report` for the claim window. The team never starts free access for a student; compensate with `grant --user <uuid> --days <n>` (course access, no AI) |
| One person claimed on two accounts with different addresses | `change-grant --grant <uuid> --action revoke` on the later grant |
| Record the planned launch date (informational) | `configure-early-access --planned-launch <ISO>` (`--enrollment-days` and `--trial-after-early-access` are retired and refused; no command moves the end of free access) |

The tool needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` (an `sb_secret_` key over HTTPS when hosted). A
student who believes a pass or free access claim is wrong (for example an address they never controlled) is handled with `grant`, never by freeing the claim.

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

A deletion-scheduled account cannot start a pass or claim free access. Purging an account removes its grants (and so
its AI) and its previews. The keyed pass claim and the keyed free access claim (each for its retention period, 5 years
from the day it was made), any historical phone hash and the audit rows are kept without the account link, so deleting
and re-registering the same address cannot start a second pass or claim free access again within that period. The
deletion form tells students: "We keep a note that this email has used its free pass or free access." It does not state
the period.

## Owner decisions required before production

1. Discovery Pass limits are initial values in `private.entitlement_policy` (`discovery_*` columns). `trial_days` and
   `ai_practice_policy.trial_units` describe only the seven-day trials issued before the pass, which keep their end,
   full access and AI allowance (audited as `trial.seven-day-preserved`). `get_my_entitlement()` still returns
   `trial_days` (the pass length in whole days) beside `trial_hours`, so older application instances keep working
   during a rollout.
2. Free access: claimed from the actual launch until the end of 30 December 2026 (Lagos), and every claim ends then,
   so an earlier claim gets more days; students see "Free until 30 December" (**decided 25 November 2026**,
   `20261126100000_free_until_30_december.sql`). With it: claims stay open to the very end of 30 December; claims made
   under the old rule keep their one-month ends; the migration may reopen a claim window that had closed (the test
   site); the landing FAQ offers free access until 30 December and the free pass after it; the Campus Bot notice stays
   as it is. It replaced a claim window of **10 days** after the actual launch, closing no later than the end of 30
   November 2026 (Lagos), with one calendar month from each claim, so that every month ended within 2026 (decided 16
   November 2026, `20261116120000_early_access_claim.sql`; 14 days was the policy from 5 November 2026, and 28 days
   before that). A launch after 20 November then gave a shorter window, and `activate-launch` asked for
   `--allow-short-claim-window`, now retired.
3. Trial after Early Access: **decided 23 October 2026**, never (`trial_after_early_access` retired, kept false).
4. Retention and deletion: keyed pass claims and keyed free access claims expire 5 years after they were made
   (**decided 23 October and 16 November 2026**). Historical phone hashes, the retired list's data (names, emails,
   phone hashes) and de-identified audit rows are currently kept indefinitely. Needed: a retention period for them,
   whether to delete the retired list, and privacy-notice wording.
5. Whether to set the platform-wide daily activation guard (`discovery_activations_per_day`, off by default) and
   whether the per-account request limit (5 per 15 minutes) and the per-address notice threshold (60) suit launch day.
6. The moment to run `activate-launch`, which is irreversible and opens the free access claim. Production needs
   `20261126100000` first (see "Applying `20261126100000_free_until_30_december.sql`"), and the release that first
   carries the landing FAQ's free access answer goes out the same day, just before it.

## Payments

Paid plans are not implemented (no Paystack). A future payment confirmation should insert an `entitlement_grants`
row with `source = 'paid'` and a non-personal reference through a new service-role function, and choose its AI
terms. The read path, course gate and same-session updates need no change.

## Not yet in place

- An email reminder before the pass ends. Students see an in-app notice for the last 12 hours and for 14 days after
  the pass ends.
- Upgrade prompts to a paid plan, since no paid plan exists yet.
- Analytics: `trial_activated` is recorded. A free access claim is recorded in the audit trail
  (`early-access.claimed`); no analytics event is emitted from the database.

## Tester access (test site only, removable)

`20261125200000_owner_tester_access.sql` lets a named account test the whole platform on the test site without a plan.
While it is on, the account can save any department, level and semester itself (the running-semester rule does not
apply to it). Every course of that selection opens. Campus Bot works with no session, week or free pass limits, up to
a daily cap (3,000,000 tokens per UTC day by default, the same token measure as the plan limits). It shows "Full
access" until the end date, offers no plans, and pauses the free pass and free month offers. Platform limits, the
per-student limits and the feature switches still apply. Nothing is a grant, an order or plan use.

It works only where both of these hold:
- the database holds the test-site row, which is inserted by hand, once, in the **test** project's SQL editor and
  never by a function, migration or seed;
- the app's Supabase URL is the test project (`znwluaiylogqapansuht`) or a local stack (127.0.0.1 or localhost).

The tester commands refuse every other project before anything is sent. The database refuses without the row.

Switch the test site on (test project SQL editor only):

```sql
insert into private.tester_site (project_ref, enabled_by, reason)
  values ('znwluaiylogqapansuht', '<your name>', '<why>');
insert into private.entitlement_events (user_id, grant_id, event, actor, detail)
  values (null, null, 'operator.tester-site-enabled', 'operator:<your name>', jsonb_build_object('reason', '<why>'));
```

Kill switch, which stops every tester effect at once: `delete from private.tester_site where singleton;`

| Situation | Command |
| --- | --- |
| Add a tester (7 days by default, at most 30) | `tester-grant --user <uuid> [--days <n>] [--daily-cap <tokens>] --actor <name> --reason <text>` |
| Extend: the same command, which renews to `<days>` from now | `tester-grant --user <uuid> --days <n> --actor <name> --reason <text>` |
| Check the setting, the testers, their ends and today's use | `tester-status [--user <uuid>]` |
| Revoke | `tester-revoke --user <uuid> --actor <name> --reason <text>` |

Every change is audited in `private.entitlement_events` (`operator.tester-granted`, `-renewed`, `-revoked`,
`-refused`).

`tester-grant` refuses:
- an account scheduled for deletion (`account-restricted`);
- an operator account (`operator-account`);
- any account with a payment order or a paid grant (`payment-records`);
- any account with an unrevoked grant (`has-grants`, listing them);
- a fourth active tester (`too-many-testers`).

Tester access also steps aside by itself the moment the account gets a grant or a payment order. A single order,
even an abandoned one, ends it on that account for good. Use a fresh account. Test payments on a different account.

Before removal: revoke every tester and wait until `tester-status` shows nothing in flight. Then apply the removal
migration, which restores each function named in the header of `20261125200000` and drops what it created, and
remove the code: `lib/tester/`, the `tester` values in `lib/courses/access.ts`, `lib/entitlements/contract.ts`,
`presentation.ts` and `server.ts`, `lib/ai-practice` (`upload-contract.ts`, `entitlement.ts`, `supabase-env.ts`,
`quiz-pass.ts`, `topic-set-server.ts`), `lib/campus-bot/server.ts`, `app/profile-selection/page.tsx`,
`scripts/entitlements/tester.cjs` and its line in `ops.cjs`, the tests, and this section.
