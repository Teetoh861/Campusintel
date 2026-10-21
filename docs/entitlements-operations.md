# Trial, Early Access and entitlement operations

Owner: founder/operations. Intended launch: 25 October 2026 (a target, not the Early Access start).
Implements PRD v1.4 §4.5 and §4.9. This is a deployment and runbook handoff, not evidence of hosted activation. No
hosted migration, SMS send, Anthropic call or deployment was made while building it.

## What students get

| Plan | How it starts | Courses | AI practice |
| --- | --- | --- | --- |
| Free (every account) | Registration and email confirmation | Courses with `institutional_courses.is_free` (GST111, GST102, GST112, GST212) | None |
| Discovery Pass (`source = 'trial'`, `trial_policy = 'discovery'`, since `20261021100000_discovery_pass.sql`) | One-time phone code, once per account and per phone; never while Early Access is active | **A restricted sample, never full access.** For `discovery_hours` (72) on database time: one CBT exam of exactly `discovery_cbt_questions` (50) valid questions from one actively offered course the student picks. It opens only if that course's whole CBT duration fits before the pass ends, and is never shortened. Answers are saved as the student goes; at the database deadline the exam closes and is marked from the last sheet saved in time. Nothing sent after the deadline is marked, and `discovery_cbt_grace_seconds` (120) only replays an already marked result. Plus one complete study-guide topic the student picks from one actively offered course. Every other topic stays locked. No theory preview. Nothing renews | One accepted upload (`discovery_ai_uploads`, 1, enforced when an upload becomes ready, however many were reserved; refused files cost nothing) of at most `discovery_ai_source_chars` (20,000) characters. Only that upload can use the pass. `discovery_ai_generations` (1) delivered set of exactly five valid questions; a short or malformed set is a failed attempt and is not charged. At most `discovery_ai_attempts` (3) provider attempts, failed ones included |
| Seven-day trial (`source = 'trial'`, `trial_policy = 'seven-day'`) | Issued before `20261021100000`; no new ones | Every course until its own original end | Its original allowance under the shared AI rules |
| Early Access | **Automatic**, once the founder activates the actual public launch | Every course for one calendar month from the student's own enrollment | No per-student cap; global and per-day guards still apply |
| Operator grant | `scripts/entitlements/ops.cjs grant` | Every course for the stated days | None (course access only) |

Free is the institutional `is_free` flag, never `courses.is_shared`. Login stays email and password. Running out of
AI units never closes courses. Revoking or expiring any grant ends its course access **and** its AI at once.

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
reconciliation. Enrollment closes `early_access_enrollment_days` after the actual launch (**28, provisional**). No
phone code and no per-student AI cap apply during the month.

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

## Trial and Early Access never overlap

A student whose Early Access is active cannot prepare or verify a trial code (`early-access-active`, with the date
the trial opens). The check runs under the same account lock as enrollment, before any SMS or code attempt, so a race
cannot start a trial during Early Access, and nothing is consumed: no trial eligibility, code attempt or phone claim.
After Early Access ends the student may start a Discovery Pass with its full 72 hours, if
`trial_after_early_access` is true (**provisional**). AI used during Early Access never counts against a later
trial's fixed allowance. A trial that was already running when Early Access began (for example a pre-launch trial)
continues.

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

## SMS: Termii (approved)

Trial activation **fails closed** until every setting below is present and valid. GST, Early Access and operator
grants do not depend on SMS.

| Variable (server only) | Value |
| --- | --- |
| `ENTITLEMENT_SMS_PROVIDER` | `termii` |
| `TERMII_API_KEY` | The account API key (16–256 of `A-Z a-z 0-9 _ . -`) |
| `TERMII_BASE_URL` | The account-specific base URL from the Termii dashboard; must be `https://` on `termii.com` or a subdomain, no path, port or credentials |
| `TERMII_SENDER_ID` | The **approved** alphanumeric sender ID, 3–11 characters |
| `ENTITLEMENT_PHONE_HASH_KEY` | At least 32 random bytes (`openssl rand -base64 32`); set once per environment and never rotate casually, or every phone looks unused |

Requests are `POST {base}/api/sms/send` with `to` in international format without `+` (`2348031234567`),
`type: plain`, `channel: dnd` (transactional OTP route), `redirect: error`, and an 8-second provider deadline inside
the 10-second request deadline. Classification:

- `sent`: a 2xx response with a `message_id` and no contrary `code`.
- `failed`: a definite refusal (4xx other than 408). The student may retry at once; it does not count against the
  per-account or per-phone limits, only against its own failed-send cap.
- `unknown`: timeouts, network errors, 5xx, 408, redirects and unreadable or oversized 2xx bodies. Counted as sent
  for every abuse limit, because the message may have gone out.

The adapter logs nothing; operator diagnostics carry only the failure class. Before hosted activation: the Termii
account must be funded, the sender ID approved for the DND route, and the owner must approve the first live send.
`local-outbox` remains available for verified local development only.

## Abuse limits (all in `private.entitlement_policy`)

| Limit | Default |
| --- | --- |
| Code lifetime | 10 minutes |
| Wrong attempts per code | 5, then the code is locked |
| Resend cooldown | 60 seconds (none after a definite provider refusal) |
| Delivered or possibly delivered codes per account per 24 h | 5 |
| Delivered or possibly delivered codes per phone per 24 h, across accounts | 5 |
| Definitely refused sends per account per 24 h | 10 |
| Codes per UTC day, platform-wide | 2000 (**provisional** SMS spend guard) |

## Disputes and recovery

Every change requires `--actor` and `--reason` and is written to `private.entitlement_events` in the same
transaction. The audit trail never contains phone numbers, codes or emails.

| Situation | Command |
| --- | --- |
| See an account's grants, Early Access status, codes, AI allowance and history | `status --user <uuid>` |
| SMS outage or support compensation | `grant --user <uuid> --days <n>` (course access, no AI) |
| Extend, revoke or restore a grant (revoking ends its AI at once) | `change-grant --grant <uuid> --action extend --until <ISO>` / `revoke` / `restore` |
| Generations disputed during a trial | `change-grant --grant <uuid> --action set-ai-units --units <n>` |
| A number was used without its owner's consent, or reassigned | `release-phone --phone <number>` |
| Someone eligible was not enrolled | `reconcile-early-access` (bounded batches until nothing remains) |
| Two enrolled accounts are the same person | `member --email <later> --action mark-duplicate --of <earlier>` (keeps the canonical month, revokes the other) |
| Change the enrollment window, planned date or post-Early-Access trial rule | `configure-early-access [--enrollment-days n] [--planned-launch ISO] [--trial-after-early-access true\|false]` |
| Remove old codes (kept 30 days for disputes) | `purge-otp` |

The tool needs `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY` (an `sb_secret_` key over HTTPS when hosted) and,
for phone commands, `ENTITLEMENT_PHONE_HASH_KEY`.

## Account deletion

A deletion-scheduled account cannot request or verify a code or be enrolled in Early Access. Purging an account
removes its grants (and so its AI) and its codes. The keyed phone hash, the used Early Access entry and audit rows
are kept without the account link, so deleting and re-registering cannot start a second trial or a second month.
The deletion form tells students this.

## Owner decisions required before production

1. Discovery Pass limits are initial values in `private.entitlement_policy` (`discovery_*` columns). `trial_days` and
   `ai_practice_policy.trial_units` describe only the seven-day trials issued before the pass, which keep their end,
   full access and AI allowance (audited as `trial.seven-day-preserved`). `get_my_entitlement()` still returns
   `trial_days` (the pass length in whole days) beside `trial_hours`, so older application instances keep working
   during a rollout.
2. Early Access enrollment window: 28 days after the actual launch is provisional (`configure-early-access`).
3. Trial after Early Access: currently allowed once Early Access ends (`trial_after_early_access`).
4. Retention and deletion: the keyed phone hash, imported list data (names, emails, phone hashes), used list entries
   and de-identified audit rows are currently kept indefinitely; challenges are purged after 30 days. A retention
   period and privacy-notice wording are needed.
5. Termii: account funding, approved sender ID on the DND route, and approval of the first live send.
6. The moment to run `activate-launch`, which is irreversible.

## Payments

Paid plans are not implemented (no Paystack). A future payment confirmation should insert an `entitlement_grants`
row with `source = 'paid'` and a non-personal reference through a new service-role function, and choose its AI
terms. The read path, course gate and same-session updates need no change.

## Not yet in place

- An SMS or email reminder before trial expiry. Students see an in-app notice for the last 48 hours and for 14 days
  after the trial ends.
- Upgrade prompts to a paid plan, since no paid plan exists yet.
- Analytics: `trial_activated` is recorded. Early Access enrollment is recorded in the audit trail
  (`early-access.granted`); no analytics event is emitted from the database.
