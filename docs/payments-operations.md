# Payments operations

Every ops command requires `--project test` or `--project production`. The URL must be exactly
`https://znwluaiylogqapansuht.supabase.co` for test or `https://ckhkrognfftrqsjtablr.supabase.co` for
production. A missing or mismatched target is refused before reading the key or sending a request; local URLs
are refused. Every result names the project. Examples below use production unless they explicitly name test.

How plan payments run, how to set them up, and what support does when something goes wrong. The database rules are
in `supabase/migrations/20261102190000_payments.sql` (part 1); the server and Bachs connection are in `lib/payments/`
and `app/api/payments/` (part 2a). Screens come in part 3; Campus Bot enforcement in part 2b.

## How a payment flows

1. The confirm screen posts a form to `POST /api/payments/checkout` with a plan key, the profile revision it showed,
   a request id and a return path. The server never reads an amount from the client.
2. `create_payment_order` checks the session, sales, the course selection and the semester, and copies the price and
   allowances onto the order. The server then creates a Bachs checkout for that order (our order id is the checkout
   reference and the idempotency key) and answers `303` to Bachs' hosted page. A double tap gets the same order and
   link.
3. Bachs sends the student back to `/access/checkout/return?order=<id>`. The page ignores every Bachs query parameter
   and reads `GET /api/payments/orders/<id>`, which answers from our database only and, while the order is still
   confirming, asks Bachs at most once per order per 10 seconds.
4. Bachs posts signed events to `POST /api/payments/webhooks/bachs`. The server checks the signature, stores the
   event once, asks Bachs for the checkout again, and fulfils.
5. Whatever the source (webhook, return page, reconcile, operator), a grant needs a Bachs-verified payment that is
   `succeeded`, `accepted` or `overpaid` on a completed checkout for this order, with the amount and currency
   checked against the order. Part 1's unique keys make every replay, retry or race produce one fulfilment.

Less than the order is `amount-mismatch` (no grant). More is granted and flagged `overpaid`. A bank-transfer excess
is refunded separately; a reported card excess goes through Bachs support (see Overpayments). Card and bank transfer are the only payment methods offered.

## Setup

Environment variables (names only; set values in the hosting dashboard, never in git or chat):

| Name | What |
| --- | --- |
| `BACHS_API_KEY` | `sk_sandbox_…` for the sandbox, `sk_live_…` for real money. A live key is allowed only with `VERCEL_ENV=production` and the live Supabase URL (`ckhkrognfftrqsjtablr`). Production builds for the test site, previews and local builds sell nothing with a live key; only the internal log records why. |
| `BACHS_WEBHOOK_SECRET` | The signing secret of the Bachs webhook endpoint. |
| `BACHS_WEBHOOK_SECRET_PREVIOUS` | The previous secret, only while a rotation overlaps. Remove it afterwards. |
| `CRON_SECRET` | Bearer secret for `GET /api/payments/reconcile`, at least 32 random bytes (`openssl rand -hex 32`). Shared with the AI practice cleanup. |
| `ENTITLEMENT_CLAIM_HASH_KEYS` | Already set for the Discovery Pass. Refund commands use it for the refund identity hash. |
| `PAYMENTS_PROVIDER` | Local development and tests only: `fake`. Refused anywhere that is not a verified local environment. |

Without a valid key and at least one webhook secret, nothing is sold (the checkout answers "unavailable").

In the Bachs Developer Portal:

1. Add a webhook endpoint `https://campusintell.com/api/payments/webhooks/bachs` subscribed to `checkout.completed`,
   `checkout.expired`, `collection.succeeded`, `collection.failed`, `collection.underpaid`, `refund.created`,
   `refund.paid` and `refund.failed`. Copy its signing secret into `BACHS_WEBHOOK_SECRET`.
2. Check that the account has the `NGN_CARD` and `NGN_BANK_TRANSFER` corridors (Supported payment methods).
3. Rotating the secret: rotate in Bachs (the old secret keeps signing for 24 hours), put the new value in
   `BACHS_WEBHOOK_SECRET` and the old one in `BACHS_WEBHOOK_SECRET_PREVIOUS`, deploy, then remove the previous one
   after the overlap.

The CSP allows forms to redirect to `https://checkout.bachs.io` and nowhere else. Bachs' docs show that origin for
hosted checkouts; if the sandbox hands out a different checkout origin, the checkout is refused rather than
redirected, and the CSP entry needs the owner's decision.

Before opening sales in production, move the project to Vercel Pro and switch reconciliation to every five minutes
(see Reconcile schedule below).

Opening sales: `open-sales --project production` below. Sales stay closed until then.

## Reconcile schedule

`GET /api/payments/reconcile` (cron bearer) runs **once a day** (`0 3 * * *` in `vercel.json`) until the project moves
to Vercel Pro. The free plan, which the test site runs on, rejects any cron more frequent than daily. The webhook and
the return page settle almost every payment; the run catches the rest. There are no continuation runs; each run is
bounded as below.

**Production setup, before sales open:** once the project is on Vercel Pro, change the schedule in `vercel.json` to
`*/5 * * * *` (every five minutes) and deploy. Nothing else changes.

Due orders are claimed in batches of 50. Ten slots of every batch go to the due checks that have waited longest (since
their due time, or since their first failed check while they back off), so new orders can never starve an overdue
check. The other 40 go to open orders newest first (the most likely to have just been paid), then everything else by
due time, with atomic `FOR UPDATE SKIP LOCKED` claims and a 60-second lease. Cron and `reconcile-now --project production` use the same claims: overlapping runs cannot check the same order. A completion must
carry the current, unexpired lease token. A lost, timed-out or unstarted check keeps its due time and becomes
claimable when its lease ends.

No new check starts after 40 seconds. Each database call has a three-second timeout; each Bachs verification read has
a four-second timeout, including reading the body. The run has a separate 55-second cancellation deadline, leaving
time before the route's 60-second limit. The operator's `reconcile-now --project production` follows these same bounds.

Open orders are first due two minutes after creation and back off through 2, 5, 10 and 30 minutes, then hourly.
Orders beyond the 48-hour reconciliation window are checked once more, then expire. Ended orders back off up to
48 hours. A late check that becomes due is retained across day 14: it gets that final check, then stops. Completed check
results are recorded on the order. A failed check (Bachs unavailable, a timeout, a database error) is recorded too
(`last_check_result`) and retried after 5, then 15, then every 60 minutes, without advancing the normal schedule; the
order stays counted as overdue from when it first became due. A permanent refusal (a checkout Bachs doesn't know, or an
answer that can't be this order's) stops checks and lists the order under `checks_stopped_for_review`; check it in the
Bachs dashboard and use `payment-fulfil --project production --provider-ref` if a payment exists, so late checks can finish.
`payments-health --project production` reports `checks_overdue_6h`, the number of orders due (or failing) for more than six hours; investigate
a nonzero count rather than assuming the schedule drained the queue.

## Operator commands

All in `scripts/entitlements/ops.cjs`, with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` set. Every change
needs `--actor <name> --reason <text>` and is audited by the database. Nothing prints an email, card or bank detail.
Commands that ask Bachs reuse the server code and run with the TypeScript loader, with `BACHS_API_KEY` set (and
`VERCEL_ENV=production` and the live Supabase URL for a live key):

```
node -r ./lib/auth/test-loader.cjs scripts/entitlements/ops.cjs <command> --project production ...
```

| Command | Does |
| --- | --- |
| `payment-status --project production --order <uuid>` or `--user <uuid>` | Orders, events, payments, refunds and grants. |
| `payments-health --project production` | Orders pending over 30 minutes, orders needing support (mismatch, duplicate, unfulfilled, refund failed, any flag except `overpaid`), bank-transfer overpayments whose excess is not yet refunded (`overpaid_excess_due`), card overpayments to raise with Bachs (`card_excess_contact_bachs_support`: contact Bachs support; a payment already refunded in full is not listed), pending refunds, orders due or failing for more than 6 hours (`checks_overdue_6h`), orders whose checks stopped for review (`checks_stopped_for_review`), paid grants still unbound after 7 days. |
| `payment-verify --project production --order <uuid> --actor --reason` | Asks Bachs now and fulfils if it confirms the payment. The normal fix. Asks Bachs. |
| `payment-fulfil --project production --order <uuid> --provider-ref <checkout id> --actor --reason` | The same, for an order whose checkout id we never stored. Bachs must still confirm a payment whose checkout reference is this order. Asks Bachs. |
| `refund --project production --order <uuid> --class standard\|our-fault\|duplicate\|excess --actor --reason [--requested-at <ISO>] [--payment <uuid>]` | Dry run: what the database would decide, with every count. Nothing changes. |
| `refund --project production ... --request <uuid> --confirm` | Records the refund (a plan refund first revokes every grant of the order, in the same transaction), then refunds a card payment through Bachs with the request id as the idempotency key. Asks Bachs. A bank transfer is left for a manual settlement. |
| `refund --project production ... --request <uuid> --confirm --manual-reference <transfer ref> --account-last4 <4 digits> --destination-confirmed` | Bank transfers only: the same, settled as a transfer you made from our bank to the account that paid. Refused for card payments, before anything is recorded. Re-running the same `--request` with these settles a refund recorded earlier. |
| `refund-retry --project production --order <uuid> --actor --reason [--manual-reference <ref> --account-last4 <4 digits> --destination-confirmed]` | A pending refund: sends it again with the same key. A failed refund: records a new one for the same payment, class and request time, then refunds. Repeating it never refunds twice. Asks Bachs. |
| `open-sales --project production --actor --reason` / `close-sales --project production --actor --reason` | The sales switch. |
| `reconcile-now --project production` | A bounded reconcile run now. Asks Bachs. |
| `campus-bot-model --project production --model <name> --weight <n> --actor --reason` | A model's price weight (Haiku = 1). Pending owner approval. |
| `campus-bot-cap --project production --step writing\|check\|explain\|explain-check\|chat [--read <n>] [--written <n>] --actor --reason` | Per-request token caps. Pending owner approval. `explain`, `explain-check` and `chat` are Explain, its check and Ask Campus Bot ([Campus Bot Explain and Ask](campus-bot-explain-ask.md)). |
| `campus-bot-writer --project production --model <name> --actor --reason` | The model that writes Campus Bot sets (Haiku at launch). Each request records the model and weights it is charged at, so a change applies to new sets only. |
| `campus-bot-refill --project production --user <uuid> --actor --reason` | Gives one student fresh Campus Bot limits: new session and week windows start at their next request. Nothing is deleted. |
| `campus-bot-refill --project production --everyone --confirm --actor --reason` | The same for every student. |
| `ai-limits --project production [--daily <n>] [--paid-reserve <n>] [--undelivered-per-day <n>] --actor --reason` | The platform's newly written Campus Bot sets per UTC day, uploads and topic quizzes together (2,000 from `20261117110000`; raise it as paying students grow), how many of them only paying students may use (150), and each student's undelivered tries per day (10). Unnamed settings stay as they are. |
| `campus-bot-feature --project production --feature explain\|ask\|topic-sets --state on\|off --actor --reason` | Switches Explain, Ask Campus Bot or topic sets on or off for every student. All three are off until the human review signs off ([Campus Bot Explain and Ask](campus-bot-explain-ask.md)). |
| `campus-bot-reply-limits --project production [--pass-explanations <n>] [--pass-messages <n>] [--daily-explanations <n>] [--daily-messages <n>] [--undelivered-per-day <n>] --actor --reason` | A free pass's explanations (5) and messages (10), the platform's explanations (3,000) and messages (10,000) per UTC day, and each student's undelivered replies per day (20). |
| `campus-bot-checker --project production --model <name> --actor --reason` | The model that checks explanations on calculation courses (Sonnet at launch), charged at the writer's weight. |
| `campus-bot-set-checker --project production --model <name> --actor --reason` | The model that checks a "Quiz me on this topic" set on a calculation course (Sonnet at launch). Explain's checker is set separately (`campus-bot-checker --project production`). |
| `campus-bot-course --project production --course <course key> --calculation on\|off --actor --reason` | Puts a course on or off the calculation list. Putting it on removes its explanations that were never checked. |
| `campus-bot-clear-explanations --project production --course <course key> --confirm --actor --reason` | Removes every saved explanation of a course; each is written again the next time a student asks for it. |
| `campus-bot-status --project production` | Explain and Ask settings, caps, models, the calculation list, today's requests and what is saved. |
| `campus-bot-explanations --project production --course <course key> [--limit <n>]` | Saved explanations of a course with their questions, newest first, for review. |

`--requested-at` is when the student asked (default now). It must lie between the payment and now. The 48-hour window
is judged at that time; use is counted from the payment until the refund is processed, so use after asking counts.

There is no manual-evidence fulfilment, by decision: a plan is granted only on a payment Bachs confirms.
`payment-fulfil --project production --manual-evidence` is refused.

## Campus Bot limits

Paid plans and Early Access fund Campus Bot sets by tokens, not by a number of sets. A paid plan funds only during the
semester it is bound to (never in the slack after it, and a Session plan's second half only in the Second Semester).
A student with free access (Early Access, claimed on the site) gets Standard limits. With a paid plan, the higher limits apply and are
never added together: paid Plus wins over Early Access Standard; equal Standard tiers keep Early Access funding.
An account with an active paid grant can use the paid platform reserve even when Early Access funds the request.
Early Access alone is unpaid for that reserve. A Discovery Pass keeps its one set, and an older seven-day trial its sets.

- **Limits**: a session (5 hours from the student's first request) and a week (7 days from the first request of that
  week), per tier in `campus_bot_tiers`. Changing a tier applies to everyone at once; a reset time a student has
  already seen never moves.
- **Cost**: tokens from the provider's own report, every prompt token as read plus 5 x every written token, times the
  model's weight (Haiku = 1). Only a delivered set is charged; failures, timeouts, flagged or unusable results cost
  nothing. A set starts only if both limits cover its worst case (60,000 for Haiku), and a started set always finishes,
  even if that takes a limit below zero. The hard source cap is 60,000 characters; `read_tokens_max` is the
  reservation estimate, not an input-token rejection limit. A rare overrun is delivered and charged from the actual
  usage report, and can leave a window below zero.
- **Platform**: 2,000 newly written sets a day across all students (uploads and topic quizzes together), of which the
  last 150 are kept for paying students; each student may have 10 undelivered tries a day (`ai-limits --project production` changes all
  three).
- **Support**: a student out of tokens can be refilled with `campus-bot-refill --project production --user <uuid>`; it starts fresh windows
  at their next request and deletes nothing. Each admission reads the latest applicable refill once and uses that
  same snapshot for both windows; a refill committed afterwards applies to the next admission. A set that finishes
  after the student's access ended is kept and charged.

Admission and `ai-limits --project production` updates take the same platform lock; an admission re-reads the policy after acquiring it,
so a queued start observes a committed daily stop. Every admission timestamp (usage reservation, generation and any
new windows) uses the final wall clock after lock waits, including waits across UTC midnight.

**Abandonment.** The database enforces `reservation_minutes >= 5`. The server bounds admission to 15 seconds,
the provider call (including its retry) to at most 120 seconds, and settlement to 30 seconds. The reservation exceeds
even admission plus two maximum provider calls plus settlement: 15 + 2 x 120 + 30 = 285 seconds < 300 seconds.
Transport cancellation and a server deadline both apply, and the server refuses an admission response with an unsafe
reservation lifetime before calling the provider. Keep this inequality when changing any timeout or adding a check step.
An abandoned result is still discarded and charged 0, including a reply arriving after abandonment; its reservation
and token-request row are released at 0. A live server finishes or times out before abandonment can run.

## Quiz me on this topic

"Quiz me on this topic" writes a new set of five questions from one notes topic: from the topic's Campus Bot area on
its notes page, or on the free pass page for the topic a pass pinned (`20261117110000_campus_bot_topic_sets.sql`).
A quiz is a Campus Bot set in every other way: the same limits, settlement and refund rule as a set from an upload.

- **Switch**: off until the human review signs off: `campus-bot-feature --project production --feature topic-sets --state on|off`. While it
  is off, no new quiz is admitted; a quiz already written still opens on its own page.
- **Who**: a student who can read the topic now (their own courses on a plan or free access, GST courses for
  anyone), or the topic a current free pass pinned. Funding is the plan's session and week windows, or the free pass's
  one set (uploads and quizzes together; its 20,000-character upload limit does not apply). Notes under 150 words
  offer no quiz.
- **Model and charge**: the writing model (`campus-bot-writer --project production`, Haiku) for every funding, at the `writing` step's caps
  (20,000 read / 8,000 written). On a calculation course (`campus-bot-course --project production --calculation on`) the set's checking model
  (`campus-bot-set-checker --project production`, Sonnet) confirms each question at the `check` step's caps (10,000 read / 3,000 written); a
  question it does not confirm is removed, and fewer than three left is no set. Each call's whole prompt stays within
  its read cap: a long topic is sent from its start as far as fits (the set records the passages it was written from),
  and a check's cited passages are shortened from their ends; a set that cannot be checked within its cap is not
  shown. The check is charged at the writer's weight (owner decision). A quiz reserves 60,000 tokens, or 85,000 with
  the check, and is charged from the provider's reports only when delivered, never past what was reserved. A
  delivered quiz on a paid course is plan use, as a set is.
- **Delivery**: a set is delivered only if the student can still read the topic (or their pass still pins it) and the
  grant that funds it is still current; otherwise it is not stored, nothing is charged and its reservation is
  released. A retry of a request is answered only after every check a new quiz passes. There is no exam block (owner
  decision).
- **Repeats**: the student's last ten questions on the topic go with the request, and a repeat is never kept.
- **Records**: `ai_usage_events.feature = 'topic_practice'`; `ai_practice_generations.source_kind = 'notes-topic'` with
  the topic's item and revision; `campus_bot_requests` rows `writing` and, on a calculation course, `check`.

## Plan use for refunds

The standard refund rules count use from the payment until the refund is processed. Exams started and practice answers
come from the attempt tables. The rest is recorded as it happens, once per order, course and item: a notes topic the
student opens, a theory answer revealed (recorded before
the answer is shown; if it cannot be recorded, the answer is not shown), a Campus Bot set delivered (kind
`campus-bot-reply`) and a Campus Bot reply delivered: an Explain explanation or a notes-chat reply (kind
`campus-bot-message`). Sets and replies are counted apart. A set is a delivered question set (from an upload or Quiz me
on this topic) or a delivered set of flashcards from the notes chat (once per request). Sets are `campus_bot_sets` against
`refund_campus_bot_replies_allowed` (0: one set ends the standard refund; reason `campus-bot`). Replies are
`campus_bot_messages` against `refund_campus_bot_messages_allowed` (10: the 11th ends it; reason
`campus-bot-messages`). A chat reply is recorded once per request and an explanation once per explanation shown, so a
retry, a reread or a saved explanation shown again never counts twice. GST courses
are never counted. `refund --project production` dry runs show every count. Ordinary student published-content reads return theory
prompts and feedback availability, with no model answers or rubrics. The theory route gets feedback through the
service-only `reveal_theory_feedback` RPC, which rechecks the published revision and course access and records
`record_plan_use` in the same transaction before returning any answer. A set or reply requested before a payment does
not count toward that payment's refund, even if delivered after the payment.

A notes topic counts as opened only once it has been on screen for 30 seconds in one visit to the course page. On
screen means 60% of the note in view, or the note filling at least 60% of the screen (so long topics on a phone count
too). The time adds up while the student stays on the page, and nothing counts while the tab is hidden. Scrolling past a topic never counts. Each topic is sent at most once per visit (one background request, which
the page does not wait for) and recorded at most once per order.

## Support playbook

**Paid but no plan.** Run `payment-status --project production --user <uuid>`.

- Order `pending` or `created`: run `payment-verify --project production --order <id>`. If Bachs confirms, the plan appears at once.
- Bachs still says open: the payment has not reached Bachs (bank transfers can take a while). The daily reconcile
  and the late check pick it up for 14 days; tell the student it is being confirmed.
- Bachs cannot confirm the payment at all: wait for Bachs, or ask Bachs support to trace it, then fulfil by checkout
  id (`payment-verify --project production`, or `payment-fulfil --project production --provider-ref <checkout id>`). Never grant a plan from a screenshot, a
  receipt image or a bank transfer alert.
- Order shows no checkout id but the student has a Bachs receipt: find the checkout in the Bachs dashboard and run
  `payment-fulfil --project production --order <id> --provider-ref <checkout id>`.
- `amount-mismatch`: the student paid less than the price, or in another currency. No plan was granted. Always
  refund the payment in full with `refund --project production ... --class our-fault`, as the Payment terms promise. The class refunds the
  whole amount and does not count towards the student's refund limit.
- `unfulfilled`: paid after the semester ended or after the account was deleted. Refund it (`our-fault`).

**Refunds.**

When a student asks for a refund, reply with: "We've received your refund request and are looking at it now. Please
don't use your plan while we process it: using it before the refund is processed can mean it no longer qualifies."
Then record when they asked; that time is the `--requested-at` below.

1. Dry run first: `refund --project production --order <id> --class standard --actor <you> --reason "<ticket>" --requested-at <when the
   student asked>`. It shows the window, each use count against its allowance (`counts` and `allowed`: Campus Bot sets
   as `campus_bot_sets`, Campus Bot replies as `campus_bot_messages`, `exams_started`, `practice_answers` with theory
   reveals, `notes_topics`), and the standard refunds already used by this person.
2. If allowed, run it again with `--request <new uuid> --confirm`. Access ends immediately, before the money moves.
3. Card payments are refunded through Bachs only; the refund settles when Bachs reports it (`refund.paid`). Bank
   transfers cannot be refunded through Bachs. Open the payment in the Bachs dashboard and note the sender's account.
   Send the money from our bank to that same account, and nowhere else. Then re-run the same command with
   `--manual-reference <our transfer reference> --account-last4 <last four digits of that account>
   --destination-confirmed`. We keep only the reference and the last four digits.
4. A refund Bachs refuses shows as `refund-failed` in `payments-health --project production`; fix the cause and run `refund-retry --project production`.
5. A refund command that times out (operator writes allow 15 seconds) may still have been recorded, with access
   already ended. Run `payment-status --project production --order <id>` first: if the refund is there and pending, run `refund-retry --project production`; if
   it isn't, run the same `refund --project production ... --request <same uuid> --confirm` again.

Our-fault (outage, wrong content, a billing error) and duplicate refunds are allowed at any time and never count
against the student's one standard refund.

**Overpayments.** A bank-transfer payment above the price is granted as usual and listed in `payments-health --project production` under
`overpaid_excess_due` until the excess is refunded. Refund it with `refund --project production --order <id> --class excess --request <uuid>
--confirm`, at any time: it returns only the amount above the price, never counts toward the student's one standard
refund, and changes no access. Send it by bank transfer to the account that paid, as in step 3 above.

**Card excess goes through Bachs support.** Cards are charged the exact server catalogue amount. If Bachs reports
a card excess, contact Bachs support; do not issue an `excess` refund. Both the command and database refuse it before
recording anything. This preserves the card's one Bachs refund for a standard or our-fault plan refund.

**Settle the excess first.** A bank-transfer plan refund is refused while an excess refund is pending or failed
(`excess-unsettled`), without recording a plan refund or revoking access. Settle a pending excess, or run
`refund-retry --project production` on a failed excess and settle it, before requesting the plan refund. The plan refund then returns only
the payment less the settled excess. A plan refund attempted while the excess is pending can be re-run with the same
request id once the excess has settled; keep the student's original `--requested-at` for a standard refund.

**Duplicates.** Two payments for the same semester: the second order becomes `paid-duplicate` (no second grant) and
shows in `payments-health --project production`. Refund it the same day with `refund --project production --order <id> --class duplicate --request <uuid>
--confirm`. A second payment on the same order is flagged `extra-payment`; refund that payment the same way, adding
`--payment <payment id>` from `payment-status --project production`.
