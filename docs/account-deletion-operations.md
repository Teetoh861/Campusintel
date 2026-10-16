# Account deletion operations

Owner: founder/operations. Launch target: 25 October 2026.
All four deletion policies in the implementation request are approved; no further
student-report, operator-history, retention-policy or monitoring-owner approval is pending.
This document is a deployment/runbook handoff, not evidence of hosted activation.

## Application and database behaviour

The Account workspace uses the existing Student App page band, semantic colours,
responsive surfaces, profile selection and logout components. No separate Account
design artifact was present in the implementation checkout; visual acceptance
against any separately held reference remains a reviewer check.

Scheduling requires a same-origin bounded JSON POST, the exact session that rendered
the form, explicit confirmation and the current password verified by Supabase Auth.
The proof session is never transferred to the browser. A service-only RPC verifies
both sessions belong to the same live confirmed student, locks the account, records
the database clock and sets the deadline to **720 hours later**. It removes every
Auth session, refresh token and outstanding application recovery grant atomically.
The browser moves to a fresh empty cookie namespace. Repeating a request preserves
the original job/deadline; it never extends the grace period.

Proof cleanup covers provider-envelope validation failures as well as identity,
claims and RPC failures. A validated successful schedule already revoked every
session in its database transaction, so it does not issue a second Auth revocation.
Other outcomes attempt to revoke any returned temporary access token. A cleanup
exception emits only `Account deletion proof-session cleanup failed`; investigate
that fixed diagnostic in restricted server monitoring without logging the token or
provider response. Cleanup failure does not replace the actual RPC outcome or
primary validation/transport error. An invalid or lost RPC response still fails
closed; it is not evidence that scheduling did or did not commit.

A later login before the deadline creates a restricted session and routes to
`/account/deletion`. Login, rendering and reading lifecycle state never cancel.
**Yes, keep my account** posts an owner/session/request-bound cancellation;
**No, continue with deletion** uses ordinary current-session logout and preserves
the request. Before expiry, password recovery can replace a password but cannot
cancel deletion or authorize ordinary Student App access.

Server identity helpers, account-data RLS, catalogue restrictions, managed-content
and question-report RPCs, and the service-only quiz writer enforce the restriction.
Ordinary writes queued behind scheduling recheck after acquiring the account lock.
Proxy routing is presentation assistance; SQL is the authorization boundary.
After the deadline, cancellation, Auth session insertion/update, password replacement
and recovery-grant issue/consumption are denied independently of the worker.
For an account already expired when login starts, the Auth session trigger rejects
session creation before the application can read an authenticated lifecycle. The
login form therefore shows the generic unavailable message for that provider
database failure. It must not promise a specific expired-login message. The
specific expiry response remains reachable if the deadline passes between session
creation and the application's lifecycle read, and on the deletion page for a
retained live session. Do not weaken the Auth trigger, inspect raw provider text,
or add an unauthenticated privileged account lookup to improve this copy. Confirm
the actual hosted error envelope during release acceptance; keep unknown errors
generic and never transfer a rejected session to browser cookies.

Identity-entry pages route scheduled/expired live identities directly to the
deletion decision page, including when proxy routing is unavailable. Sending them
through the ordinary dashboard would loop between its access guard and login.
In-flight operations authorized before a lifecycle change can finish before that
change takes its account lock; no system can retract data already delivered.

## Purge scope and integrity

The worker deletes the student's reports, including their free-text notes and
attempt links, before deleting Auth. No question-report evidence is retained:
free-text deidentification is not assumed. Cascades remove that student's profile,
bookmarks, import receipts, attempts, answers and pinned attempt snapshots.
Other students' historical attempts, question UUIDs, managed revisions and
publications remain intact.

Current operators and former actors with managed-content/review/create-intent or
question-review history are excluded at scheduling and checked again at purge.
A governed account discovered after scheduling stays pending and raises an error;
its identity/content audit history is never deleted by ordinary student purge.

Owned Storage buckets/objects block deletion for a provider-aware operations
procedure. Unknown/incompatible Storage schema also fails closed. The worker does
not delete Storage metadata or pretend that doing so removes provider files.
Deleting `auth.users` is a database operation, not a claim that provider logs,
mail records, backups, archives or third-party records have disappeared.

## Governed/operator promotion after scheduling

Before a privileged promotion or adding governed authorship/review history, check
for a pending deletion request using the restricted operations connection. Defer
the promotion while a request is pending. Promotion is never consent to cancel
deletion, and the worker rechecks governed status under the profile lock.

If a scheduled account nevertheless becomes governed, use this procedure:

1. Triage the `P0001` job error using restricted diagnostics; that SQLSTATE can
   represent other raised exceptions too. Record the current user ID, request ID,
   original deadline, attempt/retry state and reason in the restricted case register.
   A trusted operations connection can read the row and call
   `private.is_governed_account(user_id)`; do not expose that capability through a
   public RPC or copy audit content into alerts. Check the current role and the
   managed-content/review/create-intent/question-review references covered by that
   helper. A role demotion alone does not remove historical governance.
2. Preserve the Auth identity, pending job and all governed references. The worker
   rolls back the account purge and retries; retain its monitoring/escalation until
   operations resolves the case. Never delete the job, extend/reset its deadline,
   demote solely to pass purge, null historical actor fields, disable triggers or
   force-delete Auth to clear the alert. An expired account stays inaccessible even
   while the worker cannot purge it.
3. Before the original deadline, the authenticated account holder can explicitly
   choose **Yes, keep my account** through the existing session/request-bound
   cancellation flow. Operations must not infer that choice from the promotion.
   Verify that cancellation removed the current job before allowing governed work
   or closing the pending deletion case, and reconcile any prepared provider action.
4. After expiry, there is no supported restoration or operator cancellation path.
   Escalate to founder/operations for a separately reviewed governed-account
   procedure under the already approved operator-history and actual retention
   obligations. Review the FK/audit graph and distinguish removable student data
   from required governed identity/history before authorizing any manual action.
   Keep the pending identity restricted and the case open while that procedure is
   prepared. If operational access is needed, use the normal process for a separate
   authorized operator identity; never reactivate the expired identity.
5. Recheck the current job/request/deadline under the same account lock order
   (lifecycle advisory lock, Auth row, job row, then profile row) immediately before
   any separately reviewed database action. Record its approved scope and observed
   results, reconcile the provider/backup register, and verify that history and
   unrelated student/content data remain intact. A worker failure alone is not
   completed deletion or a closed retention case.

This procedure adds no retention period or provider erasure guarantee and does not
authorize a hosted database mutation. The ordinary student worker intentionally
has no override for governed accounts.

## Migrations and rollout prerequisites

Apply these, in order, only through the owner's normal reviewed deployment process:

1. `20261016100000_account_deletion_lifecycle.sql`: private pending jobs,
   live lifecycle read, service-only scheduling and authorized cancellation.
2. `20261016110000_account_deletion_access.sql`: lifecycle restrictions, Auth
   expiry triggers, recovery restrictions and private canonical quiz implementation.
3. `20261016120000_account_deletion_worker.sql`: idempotent bounded worker,
   monitoring, heartbeat, retries and overdue markers. **No cron job is installed.**
4. `20261016130000_account_deletion_rate_limit.sql`: deletion-specific atomic
   account/origin rate policy, five account attempts per 15 minutes.

Before deploying the application, verify all prior migrations through the expected
base are present. These changes reference managed Supabase Auth tables, so check
the hosted Auth version, table columns/foreign keys and trigger execution privileges
in staging. In particular verify `auth.sessions`, `auth.refresh_tokens`,
`auth.users.encrypted_password`, Storage `owner`/`owner_id`, and Auth-admin paths
for login/refresh/recovery. Supabase cautions that managed schema details other
than primary keys can change. [Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)

Use the existing server-only `SUPABASE_SECRET_KEY`, publishable project settings,
`AUTH_INTERNAL_SECRET` and canonical origin configuration. Never put a privileged
key in browser configuration. Deploy migrations before the app: missing lifecycle
RPCs fail closed. This patch has not applied hosted migrations or changed a hosted
Auth setting, deployed the app, or activated any deletion schedule.
Rollout order is migrations, provisioned/tested worker and alerts, then application
deployment exposing the deletion form.

## Worker, monitoring and escalation

`node scripts/account-deletion/worker.cjs --status` is read-only monitoring.
`--run` requires the separate `ACCOUNT_DELETION_WORKER_ENABLED=true` setting and
invokes only `run_account_deletion_jobs`, with a batch of 25. The database accepts
at most 100 per call. Supply configuration through the scheduler's secret store,
not CLI arguments or committed files. No HTTP worker route is exposed.

Configure a worker invocation every 15 minutes and an independently scheduled
status probe every 15 minutes. Both commands have a 30-second HTTP timeout.
Provision a separate dead-man alert if neither command reports within one hour;
a monitor that never runs cannot alert on its own. Do not enable student deletion
in the hosted app until this monitoring and the procedure below are verified.

| Signal | Required founder/operations action |
| --- | --- |
| Exit 0 | Record successful invocation, heartbeat, pending/due counts. |
| Exit 1 | Investigate failed invocation, invalid configuration/response, failed jobs or stale worker heartbeat. |
| Exit 2 | **Escalate immediately**: a job is still pending at least 24 hours past its deadline, or this run first discovered an overdue job, including one it completed late. |
| `P0001` job error | Governed operator/history discovered, or another raised database exception. Inspect only restricted diagnostics; preserve audit history. |
| `P0002` job error | Owned provider Storage needs operations handling. |
| Other SQLSTATE | Investigate schema, FK, permission, availability or transaction failures. |

Record the actual alert destination, primary owner, backup contact and a staging
acknowledgment in the release record. A nonzero exit is an integration signal;
this repository cannot deliver a page/email without that configured destination.
No messages were sent or external alert integration activated during implementation.

Retries start after one minute, double up to one hour and continue until success;
there is no automatic abandonment. Each account purge is a subtransaction: a late
failure rolls back earlier report deletion and all cascades for that account.
Only SQLSTATE and attempt/timing information enter the pending job, never raw
exception messages. Workers use the same advisory/account/job lock order as
scheduling/cancellation; concurrent workers skip claims. Interrupted transactions
roll back and can be retried. Successful purge or cancellation removes the job;
there is no retained per-student purge receipt in application tables. Worker health
retains only the last invocation time.

## Third-party, backup and legally required retention procedure

Hosted contracts/plans, actual provider logs and deletion APIs have **not** been
inspected or executed for this change. The sources below describe provider products,
not proof of this installation's obligations or a guarantee of erasure by day 30.

Before the first hosted request, founder/operations must establish a restricted
deletion case register and record the minimum identifiers needed for provider
requests and safe backup restore. This register is personal data, not anonymous
evidence; restrict access and set its lifetime from the *verified actual* backup,
archive and legal obligations. Never copy passwords, codes, tokens or report notes.
The automated application purge does not create this external register for you.

| System observed in repository | Required actual-provider procedure |
| --- | --- |
| Supabase Auth/database | Inventory Auth audit-log payloads, platform logs, replicas/exports and any account-linked provider records that do not cascade from Auth. Record current plan, agreement and support-confirmed deletion/retention behaviour. Submit the supported individual-data request where applicable; capture acknowledgment and unresolved limits. |
| Application anti-abuse events | Existing purpose-separated email/origin HMAC buckets have no Auth-user foreign key and do not cascade. They are pseudonymous, not claimed anonymous. The existing limiter prunes entries older than its one-hour window when another limiter operation runs; verify actual cleanup/retention in the operations inventory rather than promising immediate erasure. |
| Supabase Storage | Confirm whether any student-owned buckets/objects actually exist. If blocked, inventory both ownership columns and use the supported Storage API/owner-approved reassignment procedure; verify underlying objects, then allow a retry. Do not delete metadata with SQL. [User deletion restrictions](https://supabase.com/docs/guides/auth/managing-user-data) |
| Supabase backups/PITR and operator copies | Record configured plan/window, PITR, downloaded dumps, test copies and external archive destinations. Database backup and Storage-object coverage differ; inventory each. Record when each copy expires or what supported provider process applies. Do not promise selective erasure from immutable backups. [Database backups](https://supabase.com/docs/guides/platform/backups) |
| Resend SMTP | The repository names Resend for hosted transactional email. Verify the actual connected account/plan and agreement, identify recipient email/content, delivery, suppression, complaint and security records, and request deletion or document the verified obligation/limit. The published plan policy is not evidence of this deployed account's setting. [Resend security](https://resend.com/security), [Resend DPA](https://resend.com/legal/dpa) |
| Vercel hosting/analytics and any configured log sinks | Inventory actual deployment/access/error logs, analytics, support exports and connected processors. Confirm plan-specific controls and signed obligations, then use their supported deletion/support procedure. Record unverified destinations as unresolved. [Vercel security overview](https://vercel.com/docs/security) |
| Any legally required record | Obtain the applicable documented obligation from the responsible owner/adviser; record authority, purpose, minimum fields, access restriction and review/expiry date. Segregate required records from live student access. Do not invent a statutory period or retain an entire account by default. |

Operations must reconcile this register before ordinary purge becomes due, follow
up provider acknowledgments, and distinguish **application purge completed** from
**provider/retention case closed**. Completion of the database job is not evidence
that external processors have fulfilled their part.

Inventory and prepare during the grace period; defer irreversible provider removal
until the deadline and recheck the current request ID/deadline immediately before
acting. A missing job with an existing active identity can mean cancellation; do
not send a stale external deletion request. A replacement job has a new deadline.
If application purge already removed the identity, use the restricted case register
and observed completion evidence to continue the applicable provider procedure.
Record cancellation promptly so external work cannot defeat an authorized Yes.

Never restore a backup directly into public traffic. Reconcile the external case
register with the backup's timestamp, replay subsequent deletion requests and
cancellations, and remove completed/expired identities before enabling Auth or
Student App access. A backup predating a request may contain no lifecycle job at
all. Verify this restore procedure in an isolated environment; neither this patch
nor a provider backup can establish it automatically.

## Release gates

Staging must repeat the current-password, multi-device, retained-JWT/direct-RPC,
mandatory decision, exact-expiry, rollback/retry, operator-history and concurrent
worker tests against the actual hosted provider version. Verify alerts with a
controlled overdue fixture and verify a missed-heartbeat alert. Use disposable
accounts and remove only owned fixtures.

Remaining operational gates are hosted schema/provider verification, independent
security review, Account visual acceptance, actual provider-retention inventory and
case/restore procedures, and scheduler/alert activation with an observed acknowledgment.
No owner deletion policy remains undecided. No hosted operation is authorized by
this implementation runbook alone.
