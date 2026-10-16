<!-- lib/ai-practice/README.md — AI upload-to-practice (PRD v1.4 §4.3): generation, student journey and operations. -->

# AI upload-to-practice

Students on a course with no verified CampusIntell content can upload their own
notes and get five personal, unverified practice questions. Nothing here reads
or writes official content, operator tools or official quiz attempts.

## Student journey

1. A course row whose content is honestly missing (read model:
   `getStudentCourseUnavailability(course) === 'missing'`) shows a secondary
   "Practise from your own notes · AI · Unverified" link when AI practice is
   available. It opens `/courses/ai-practice/[institutionalCourseId]`.
2. The page re-derives the student and course on the server. A course that
   has verified content redirects to it; AI practice never competes with it.
3. `reserve-upload` checks eligibility and the student's AI grant, reserves a
   document row and returns a signed Storage upload URL for
   `<user_id>/<document_id>`. The browser `PUT`s the file straight to Storage.
   Hosted functions cap request bodies at 4.5 MB, below the 5 MB limit, so
   files never pass through an application function.
4. `process-upload` downloads the file with the student's own session,
   checks the bytes match the declared type, extracts text (`extract.ts`),
   normalizes it (`source.ts`), stores the text on the document row and
   deletes the raw file.
5. `generate` reserves one allowance unit through the service-role ledger,
   which admits the request only against an existing, server-issued grant.
   It then calls the configured provider, validates the reply, and records the
   result. Only a delivered set consumes the unit; every failure releases it.
6. The student answers the five questions one at a time with immediate
   feedback, the explanation and the quote from their notes. The score stays
   in the browser and never reaches official attempts.

All three commands go to `POST /api/ai-practice`, which applies the existing
same-origin, body-size and account-continuity checks.

## Generation

| Setting | Value | Why |
| --- | --- | --- |
| Model | `claude-sonnet-5-5` (default) | Launch model; `claude-opus-5-5` stays selectable for evaluation |
| Questions per request | 5 | Product rule |
| Output tokens | 8,000 max | Five questions are about 1,200 tokens; the rest is thinking headroom at medium effort |
| Source text | 150 words to 60,000 characters | Below this questions are guesses; above it the request is refused, never truncated |
| Timeout | 90 s default, 10–120 s | Whole call including one SDK retry |
| Worst case per request | about $0.12 on Sonnet 5.5, $0.23 on Opus 5.5 | 18K input plus 8K output tokens |

There is no automatic provider or model fallback. Any provider other than
`anthropic` disables the feature. Claude refusals are flagged for review
instead of being retried on another model.

Every question is kept only when all of these hold:

- four distinct options, one key, an explanation and a topic label;
- a quote of at least 12 characters found verbatim in the cited passage;
- the keyed option shares a meaningful word with that passage;
- no wrong option of two or more meaningful words appears inside the quote;
- no "all/none of the above" option and no repeated question.

If fewer than three of five survive, the request fails without using allowance.

### Quality limitations

The checks catch fabricated quotes, unsupported keys and some ambiguous
distractors. They cannot prove a question is pedagogically good. They do not
judge whether distractors are plausible, whether the key is the *only* correct
answer in context, whether the student's notes are themselves correct, or
whether a quote is used out of context. Sets therefore stay labelled
"Personal · Unverified" everywhere and are never promoted automatically.

## Data, storage and retention

| Data | Where | Kept for | Removed by |
| --- | --- | --- | --- |
| Raw upload | Private bucket `ai-practice-uploads`, `<user_id>/<document_id>` | Minutes: deleted right after reading; unprocessed slots after 60 minutes | The request itself, then the cleanup sweep |
| Extracted text | `ai_practice_documents.source_text` | 7 days | `purge_expired_ai_practice()` |
| Question sets | `ai_practice_generations.question_set` | 30 days | `purge_expired_ai_practice()` |
| Usage ledger (tokens, cost, model, no content) | `ai_usage_events` | Life of the account | Account deletion cascade |
| AI grant | `ai_allowance_windows` | Life of the account | Account deletion cascade |

Students read only their own documents and sets through RLS, and only with a
live, unscheduled account session (`private.has_live_account_session()`, as
for every account table). Students have **no** write path of their own: every
function that reserves a slot, claims or settles an extraction, starts or
finishes a generation, issues a grant or purges data is executable by
`service_role` only. The route passes the verified session id and the database
derives the student from `auth.sessions` itself
(`private.ai_practice_session_user`), so a student holding their own JWT can
neither reserve, fabricate an extraction result, nor forge or erase usage.
Storage RLS lets a student sign an upload only for the exact path of their own
live slot, inside the 60-minute upload window and before extraction has
claimed it, and read or delete only their own folder. The bucket itself
enforces 5 MB and the three permitted media types.

Storage checks its policy when the upload URL is **signed**, not when the file
arrives. A URL signed before logout or deletion scheduling can therefore still
deliver a file afterwards. Such a file never reaches extraction (the claim and
settlement re-check the session) and is removed by the cleanup sweep.

Extraction is leased. `claim_ai_practice_extraction` is one atomic conditional
update: of any number of concurrent requests for an upload, one gets the claim
and the rest are told `busy`. Only the claim holder can settle. A claim expires
after `extraction_lease_seconds` (120), so a crashed request is taken over by
the next one, and the crashed holder can then no longer settle.

### Parser isolation

PDF and DOCX files are parsed in `extract-parser.cjs`, a fresh child Node
process per file, never on the request thread. `parser-process.ts` gives it
no environment variables and a 160 MB V8 heap (`--max-old-space-size`). It
SIGKILLs the process at 20 seconds wall clock, or once its resident memory
passes 320 MB (sampled every 20 ms from `/proc` on Linux, or with `ps` on
other systems). At most two parsers run per server process, up to eight more
wait up to 10 seconds, and the rest get `unavailable`, which releases the
claim without judging the file. A timeout reads as `corrupt` and a memory
kill as `too-much-text`. Word XML is read by `word-xml.cjs`, a single forward
scan that refuses malformed XML.

Containment fails closed. A memory sample that errors for a live process, or
does not finish within 2 seconds, kills the parser and answers `unavailable`
(outcome `unmonitored`). A process counts as gone only on its `exit` or
`close`, or when the kernel answers ESRCH; a missing `/proc` entry alone does
not, since `/proc` may be unmounted or hidden. On Linux sampling spawns
nothing. Elsewhere each sample is one `ps`, tracked like the parser: at most
one per parse, SIGTERM at 2 seconds, then SIGKILL until it dies.

An answer waits for the parser and its `ps` to die. `child-supervision.ts`
signals them without ever throwing (`ChildProcess.kill` throws on ENOSYS and
EINVAL), with its `error` listeners in place before any signal. If either is
still alive 2 seconds after the parse ended, the request gets `unavailable`
(outcome `uncontained`), but the slot stays held and SIGKILL is retried every
250 ms until both die. So live parsers and samplers never exceed the pool. A
spawn without a pid never started and is answered at once.

Worker threads were rejected: a heap-exhausting PDF in a worker with
`resourceLimits` aborted the whole server process. The parser files are
loaded at run time, outside the bundle, so `next.config.mjs` lists them in
`outputFileTracingIncludes`. Hostile fixtures live in
`fixtures/adversarial-documents.cjs`.

## AI entitlement (server-issued grants)

AI generation **consumes** a grant; it never creates one. PRD v1.4 requires a
one-time phone-OTP activation for the seven-day trial (PRD 4.5), so first AI
use must not start a trial.

- A grant is one row in `ai_allowance_windows` with a `source`: `trial`,
  `early_access` or `test`. It is created only by
  `issue_ai_allowance_grant(user_id, source, units, days)`, which only
  `service_role` can execute. No student request path calls it.
- `begin_ai_practice_generation` receives the sources the server accepts and
  returns `not-entitled` when there is no grant or it comes from another source.
  `reserve-upload` refuses the same way, so no upload slot is created that could
  never be used. Students see "AI practice needs an active trial".
- Accepted sources (`entitlement.ts`): `trial` and `early_access` always;
  `test` only when `AI_PRACTICE_ACCEPT_TEST_GRANTS=true` **and** the process is a
  positively verified local environment: `NODE_ENV` is `development` or `test`
  (every `next build`/`next start` is `production`, on any host),
  `NEXT_PUBLIC_SUPABASE_URL` is a loopback address, and `VERCEL_ENV` is unset or
  `development`. Anything missing or unrecognised rejects. Local end-to-end runs
  that need a test grant therefore use `next dev`, not `next start`.
- **Nothing in this branch issues trial or Early Access grants.** Until the shared
  entitlement service and OTP activation exist, every production request is
  refused (fail closed). Locally, issue a test grant with
  `scripts/ai-practice/grant-test-allowance.cjs`, which refuses non-local URLs.
- The trial grant is the shared fixed allowance from `private.ai_practice_policy`
  (`trial_units` over `trial_days`), shared by every AI feature through
  `ai_usage_events.feature`. It is a fixed total, not a daily reset. Callers
  cannot override trial terms. Early Access and test grants must state theirs.
- **The 10-unit trial cap is PROVISIONAL**, a placeholder rather than an approved
  product limit. Change it without a deploy:
  `update private.ai_practice_policy set trial_units = <approved value>;`
  Existing grants keep the total they were issued with.
- There is one grant per account. Re-issuing returns `existing` and never resets
  or replaces it. Whether Early Access should upgrade a trial grant is an open
  owner decision and is not implemented.

Integration for the entitlement/OTP owner: after a verified OTP activation, call
`issue_ai_allowance_grant(<user>, 'trial')` with the service role, once. Early
Access calls it with `'early_access'` and explicit units and days.

Other server-side controls: one generation in flight per student, 20 uploads
per student per rolling day, a platform-wide cap of 500 generations per UTC
day, and abandoned reservations released after 5 minutes. The release runs
before the replay check, so replaying a crashed request reports it as failed
instead of "busy" forever.

Idempotency: the browser keeps one request id per document and reuses it for
every retry until the server reports an outcome it recorded for that id
(`generated`, `generation-failed`, `insufficient-source`, `flagged-for-review`).
A lost response, a transport error, an outage or `busy` keeps the id, so the
retry replays the committed result instead of generating and charging again.

Account lifecycle: reservation, claim, settlement and admission all take the
account row `FOR SHARE` and re-check the session and deletion job after the
wait, the same contract as `write_quiz_attempt`. Scheduling and the deletion
worker take that row `FOR UPDATE`, so an admission either commits before
scheduling (which then waits for it) or sees the schedule and is refused. A
generation that finishes after scheduling is recorded as failed
(`account-restricted`), stores no set and is not charged.

## Provider data handling (assumptions to confirm)

- The provider receives the course code and title, and the extracted text of
  the student's upload. It never receives student identity, email or ids.
- The integration assumes Anthropic's commercial API terms: API inputs and
  outputs are not used for model training, and are retained only for a
  limited period for safety monitoring. The owner should confirm the current
  retention period and DPA terms in the Anthropic Console before launch, and
  decide whether a zero-data-retention agreement is needed.
- Students may upload notes containing personal data. The upload page states
  that text is kept for 7 days; the privacy notice should also name Anthropic
  as a processor of uploaded study material.

## Operations

Required before enabling in any hosted environment:

1. **Migration.** Apply `supabase/migrations/20261016140000_ai_practice_uploads.sql`
   after the Account migrations (`20261016100000`–`20261016130000`), which it
   depends on. It creates the tables, functions, Storage policies and the
   private bucket. The Storage service must be enabled on the project.
2. **Environment (server-only).** See [Environment variables](#environment-variables).
   Set values in the hosting provider's encrypted settings, never in committed files.
3. **Content Security Policy.** `next.config.mjs` adds the Supabase origin to
   `connect-src` at build time so the browser can upload to Storage.
4. **Cleanup schedule.** Call `GET /api/ai-practice/cleanup` with
   `Authorization: Bearer $CRON_SECRET` at least hourly, for example with a
   Vercel Cron entry. Each run removes stale upload objects first (objects of
   deletion-scheduled accounts before anything else), then purges expired
   documents and sets. An expired document is never purged while its object
   still exists. The response is `200` when nothing is left, `202` when the run
   hit its 20 × 100 batch limit or kept rows whose files remain
   (`complete: false`, with `outstanding_uploads`, `retained_documents` and
   `purge_blocking_uploads`), and `503` on any failure. If cleanup does not run,
   raw uploads and expired rows are not deleted on time.
5. **Account deletion.** Database rows cascade from `auth.users`. Storage
   objects do not, and the Account deletion worker fails closed (`P0002`) while
   the user still owns any. `worker.cjs --run` removes those AI uploads through
   the Storage API first and exits 1 if any remain. See
   [`docs/ai-practice-account-deletion-handoff.md`](../../docs/ai-practice-account-deletion-handoff.md).
6. **Grants.** Production stays fail-closed until the entitlement service issues
   grants (see [AI entitlement](#ai-entitlement-server-issued-grants)).
7. **Monitoring.** Every provider failure logs one private line:
   `ai-practice: provider failure code=<class> status=<http> type=<error type> request_id=<id> transport=<code>`.
   It carries no key, vendor message, prompt or student data. The student only
   sees a plain outage, timeout or rate-limit message. Spend is in
   `ai_usage_events.cost_usd`.

### Environment variables

These are documented here rather than in `.env.example`, which the review
workflow treats as a protected path. All of them are server-only. Never prefix
them with `NEXT_PUBLIC_`, and never commit a value.

| Variable | Required | Meaning |
| --- | --- | --- |
| `AI_PRACTICE_ENABLED` | yes | Only the literal `true` turns the journey and generation on. Default off. |
| `AI_PRACTICE_PROVIDER` | no | `anthropic` (default) is the only implemented provider. Any other value disables the feature; there is no fallback vendor. |
| `AI_PRACTICE_ANTHROPIC_MODEL` | no | Must be listed in `pricing.ts`. Default `claude-sonnet-5-5`; `claude-opus-5-5` for evaluation. |
| `AI_PRACTICE_TIMEOUT_MS` | no | Whole-call deadline, clamped to 10000–120000. Default 90000. |
| `ANTHROPIC_API_KEY` | yes | Anthropic API key. |
| `SUPABASE_SECRET_KEY` | yes | Already used by auth rate limits; also signs the service-role allowance ledger and cleanup calls. |
| `CRON_SECRET` | yes | Bearer secret for `GET /api/ai-practice/cleanup`, at least 32 random bytes (for example `openssl rand -hex 32`). |
| `AI_PRACTICE_ACCEPT_TEST_GRANTS` | no | `true` honours `test` grants only in a verified local environment (see [AI entitlement](#ai-entitlement-server-issued-grants)); it has no effect on any production build. Leave unset everywhere but local development. |

The Anthropic SDK also reads `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` on
its own. Leave both unset in hosted environments. `scripts/ai-practice/diagnose.cjs`
reports whether either is present.

### Diagnosing provider failures without spending

`node -r ./lib/auth/test-loader.cjs scripts/ai-practice/diagnose.cjs` runs
offline. It checks the configuration status, the key's shape (length, prefix
family, whitespace, quoting; never the value), SDK-affecting variables, the SDK
version, and makes a TLS handshake to `api.anthropic.com` that sends no
credential. `--probe-model` adds one Models API lookup of the configured model.
That lookup is not a generation and is not billed, but it does use the key, so
run it only with the owner's approval. A non-standard key prefix is reported as
a fact, not as proof that the key is invalid.

| Class | Typical cause | Operator action |
| --- | --- | --- |
| `authentication` (401) | Key revoked, mistyped or not an API key | Create or replace the key in the Console |
| `permission` (403) | Key's workspace or org cannot use the API or model | Check workspace permissions |
| `billing` | No credit or billing not set up | Add credit / billing in the Console |
| `unsupported-model` (404) | Model id not served to this key | Check the model id and account access |
| `invalid-request` (400/422) | Request shape rejected | Check the SDK version and the request; file a bug |
| `rate-limited` (429), `overloaded` (529), `server-error` (5xx) | Provider-side pressure | Retry later; check status page and rate limits |
| `transport` | DNS, TLS, proxy or network failure (`transport=ENOTFOUND` etc.) | Check egress, proxy and sandbox network |
| `timeout` | Deadline exceeded | Check latency; raise `AI_PRACTICE_TIMEOUT_MS` within bounds |
| `internal` | Local failure before any provider response | Check server logs and file a bug |

### Hosted requirements still open

- Apply the migration through the normal reviewed process, after the Account
  migrations. It also creates the private bucket, and needs the Storage service
  enabled.
- Private Storage bucket with Storage RLS (created by the migration). Verify on
  the hosted project that it is private, with the 5 MB limit and three MIME types.
- Server-only secrets as listed above, in encrypted hosting settings.
- Schedule the cleanup route at least hourly (no cron entry is committed).
- Entitlement service and OTP trial activation issuing grants. Until then,
  production fails closed.
- Provider privacy: confirm Anthropic's retention and DPA terms (and whether
  zero-data-retention is needed), and name Anthropic in the privacy notice.
- Genuine model-quality evaluation: the fixture and mock runs prove plumbing
  only. A bounded live evaluation over real course notes, with human review of
  every question, is still required, and needs the owner's approval for any
  billable call.

## Tests

```bash
# Unit and journey tests (mocked provider, fake storage)
node -r ./lib/auth/test-loader.cjs scripts/dev-workflow/run-tests.cjs lib/ai-practice/*.test.cjs \
  'app/courses/ai-practice/[courseId]/journey.test.cjs' 'app/courses/ai-practice/[courseId]/disclaimer.test.cjs' \
  components/student/student-course-row-ai.test.cjs
# SQL: ownership, direct-call abuse, leases, allowance, Account lifecycle and purge, retention, Storage policy
supabase test db --local
# Real concurrent sessions: 8 parallel claims and admissions, and the scheduling lock race (local stack)
AI_PRACTICE_DB_TEST=1 AI_PRACTICE_DB_CONTAINER=supabase_db_<project> \
  node -r ./lib/auth/test-loader.cjs scripts/dev-workflow/run-tests.cjs lib/ai-practice/admission.database.test.cjs
# Real Storage limits, policies, late signed uploads and the Account worker against a LOCAL stack with Storage
AI_IT_URL=http://127.0.0.1:54321 AI_IT_PUBLISHABLE_KEY=… AI_IT_SECRET_KEY=… AI_IT_DB_CONTAINER=supabase_db_<project> \
  node -r ./lib/auth/test-loader.cjs scripts/ai-practice/storage-integration.cjs
# Generation demo: mock by default; --live reads .env.local and makes one bounded, BILLABLE request
# (only with the owner's explicit approval)
node -r ./lib/auth/test-loader.cjs scripts/ai-practice/demo.cjs [--live --out result.json]
# Offline provider diagnosis (no billable request)
node -r ./lib/auth/test-loader.cjs scripts/ai-practice/diagnose.cjs
```
