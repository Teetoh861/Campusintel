# Payments operations

How plan payments run, how to set them up, and what support does when something goes wrong. The database rules are
in `supabase/migrations/20261102100000_payments.sql` (part 1); the server and Bachs connection are in `lib/payments/`
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

Less than the order is `amount-mismatch` (no grant). More is granted and flagged `overpaid`, and the amount above the
price is refunded (see Overpayments). Card and bank transfer are the only payment methods offered.

## Setup

Environment variables (names only; set values in the hosting dashboard, never in git or chat):

| Name | What |
| --- | --- |
| `BACHS_API_KEY` | `sk_sandbox_…` for the sandbox, `sk_live_…` for real money. A live key is used only by a production build (`NODE_ENV=production`). |
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

Opening sales: `open-sales` below. Sales stay closed until then.

## Reconcile schedule

`GET /api/payments/reconcile` (cron bearer) checks the orders that are due, in batches of 50, until none are due or
its 50-second budget runs out: open orders older than 2 minutes (newest first), orders past the 48-hour window (asked
once more, then expired), and the late check of orders that ended without payment in the last 14 days (a bank transfer
can settle late, and a late success is still fulfilled). Every check is recorded on the order, unsuccessful ones too
(`last_check_result`), with the next time it is due: open orders after 2, 5, 10 and 30 minutes, then hourly; ended
orders back off from 1 hour, doubling to 48 hours, until day 14. An order overdue by a day goes to the front of the
queue, so however many orders there are, none waits more than a day past its due time plus one run.

- **Now (Vercel free plan): once a day**, `0 3 * * *` in `vercel.json`. The free plan fails deployments with any
  cron more frequent than daily. Until the upgrade, the webhook and the return page settle almost every payment;
  the daily run catches the rest.
- **After the Pro upgrade: every 5 minutes.** Change `vercel.json` to two entries: `*/5 * * * *` on
  `/api/payments/reconcile?late=0`, and keep `0 3 * * *` on `/api/payments/reconcile` for the daily late check.
  Confirm in Vercel's cron docs that the path may carry a query string; if not, add a second route instead.

`reconcile-now` runs the same checks on demand (up to 20 batches).

## Operator commands

All in `scripts/entitlements/ops.cjs`, with `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SECRET_KEY` set. Every change
needs `--actor <name> --reason <text>` and is audited by the database. Nothing prints an email, card or bank detail.
Commands that ask Bachs reuse the server code and run with the TypeScript loader, with `BACHS_API_KEY` set (and
`NODE_ENV=production` for a live key):

```
node -r ./lib/auth/test-loader.cjs scripts/entitlements/ops.cjs <command> ...
```

| Command | Does |
| --- | --- |
| `payment-status --order <uuid>` or `--user <uuid>` | Orders, events, payments, refunds and grants. |
| `payments-health` | Orders pending over 30 minutes, orders needing support (mismatch, duplicate, unfulfilled, refund failed, any flag except `overpaid`), overpaid orders whose excess is not yet refunded (`overpaid_excess_due`), pending refunds, paid grants still unbound after 7 days. |
| `payment-verify --order <uuid> --actor --reason` | Asks Bachs now and fulfils if it confirms the payment. The normal fix. Asks Bachs. |
| `payment-fulfil --order <uuid> --provider-ref <checkout id> --actor --reason` | The same, for an order whose checkout id we never stored. Bachs must still confirm a payment whose checkout reference is this order. Asks Bachs. |
| `refund --order <uuid> --class standard\|our-fault\|duplicate\|excess --actor --reason [--requested-at <ISO>] [--payment <uuid>]` | Dry run: what the database would decide, with every count. Nothing changes. |
| `refund ... --request <uuid> --confirm` | Records the refund (a plan refund first revokes every grant of the order, in the same transaction), then refunds a card payment through Bachs with the request id as the idempotency key. Asks Bachs. A bank transfer is left for a manual settlement. |
| `refund ... --request <uuid> --confirm --manual-reference <transfer ref> --account-last4 <4 digits> --destination-confirmed` | Bank transfers only: the same, settled as a transfer you made from our bank to the account that paid. Refused for card payments, before anything is recorded. Re-running the same `--request` with these settles a refund recorded earlier. |
| `refund-retry --order <uuid> --actor --reason [--manual-reference <ref> --account-last4 <4 digits> --destination-confirmed]` | A pending refund: sends it again with the same key. A failed refund: records a new one for the same payment, class and request time, then refunds. Repeating it never refunds twice. Asks Bachs. |
| `open-sales --actor --reason` / `close-sales --actor --reason` | The sales switch. |
| `reconcile-now` | One reconcile batch now. Asks Bachs. |
| `campus-bot-model --model <name> --weight <n> --actor --reason` | A model's price weight (Haiku = 1). Pending owner approval. |
| `campus-bot-cap --step writing\|check [--read <n>] [--written <n>] --actor --reason` | Per-request token caps. Pending owner approval. |
| `campus-bot-writer --model <name> --actor --reason` | The model that writes Campus Bot sets (Haiku at launch). Each request records the model and weights it is charged at, so a change applies to new sets only. |
| `campus-bot-refill --user <uuid> --actor --reason` | Gives one student fresh Campus Bot limits: new session and week windows start at their next request. Nothing is deleted. |
| `campus-bot-refill --everyone --confirm --actor --reason` | The same for every student. |
| `ai-limits [--daily <n>] [--paid-reserve <n>] [--undelivered-per-day <n>] --actor --reason` | The platform's AI sets per UTC day (500 at launch; raise it as paying students grow), how many of them only paying students may use (150), and each student's undelivered tries per day (10). Unnamed settings stay as they are. |

`--requested-at` is when the student asked (default now). It must lie between the payment and now. The 48-hour window
is judged at that time; use is counted from the payment until the refund is processed, so use after asking counts.

There is no manual-evidence fulfilment, by decision: a plan is granted only on a payment Bachs confirms.
`payment-fulfil --manual-evidence` is refused.

## Campus Bot limits

Paid plans and Early Access fund Campus Bot sets by tokens, not by a number of sets. A paid plan funds only during the
semester it is bound to (never in the slack after it, and a Session plan's second half only in the Second Semester).
Early Access members get Plus limits during their free month. When a student has both, the higher limits apply; they
are never added. A Discovery Pass keeps its one set, and an older seven-day trial its sets. An account with an active
paid grant can use the paid platform reserve even when Early Access supplies the higher limits; Early Access alone
is unpaid for that reserve.

- **Limits**: a session (5 hours from the student's first request) and a week (7 days from the first request of that
  week), per tier in `campus_bot_tiers`. Changing a tier applies to everyone at once; a reset time a student has
  already seen never moves.
- **Cost**: tokens from the provider's own report, every prompt token as read plus 5 x every written token, times the
  model's weight (Haiku = 1). Only a delivered set is charged; failures, timeouts, flagged or unusable results cost
  nothing. A set starts only if both limits cover its worst case (60,000 for Haiku), and a started set always finishes,
  even if that takes a limit below zero. The hard source cap is 60,000 characters; `read_tokens_max` is the
  reservation estimate, not an input-token rejection limit. A rare overrun is delivered and charged from the actual
  usage report, and can leave a window below zero.
- **Platform**: 500 sets a day across all students, of which the last 150 are kept for paying students; each student
  may have 10 undelivered tries a day (`ai-limits` changes all three).
- **Support**: a student out of tokens can be refilled with `campus-bot-refill --user <uuid>`; it starts fresh windows
  at their next request and deletes nothing. Each admission reads the latest applicable refill once and uses that
  same snapshot for both windows; a refill committed afterwards applies to the next admission. A set that finishes
  after the student's access ended is kept and charged.

Admission and `ai-limits` updates take the same platform lock; an admission re-reads the policy after acquiring it,
so a queued start observes a committed daily stop. Every admission timestamp (usage reservation, generation and any
new windows) uses the final wall clock after lock waits, including waits across UTC midnight.

**Abandonment.** The database enforces `reservation_minutes >= 5`. The server bounds admission to 15 seconds,
the provider call (including its retry) to at most 120 seconds, and settlement to 30 seconds. The reservation exceeds
even admission plus two maximum provider calls plus settlement: 15 + 2 x 120 + 30 = 285 seconds < 300 seconds.
Transport cancellation and a server deadline both apply, and the server refuses an admission response with an unsafe
reservation lifetime before calling the provider. Keep this inequality when changing any timeout or adding a check step.
An abandoned result is still discarded and charged 0, including a reply arriving after abandonment; its reservation
and token-request row are released at 0. A live server finishes or times out before abandonment can run.

## Plan use for refunds

The standard refund rules count use from the payment until the refund is processed. Exams started and practice answers
come from the attempt tables. The rest is recorded as it happens, once per order, course and item: a notes topic the
student opens, a theory answer revealed (recorded before
the answer is shown; if it cannot be recorded, the answer is not shown), and a Campus Bot set delivered. GST courses
are never counted. `refund` dry runs show every count. Ordinary student published-content reads return theory
prompts and feedback availability, with no model answers or rubrics. The theory route gets feedback through the
service-only `reveal_theory_feedback` RPC, which rechecks the published revision and course access and records
`record_plan_use` in the same transaction before returning any answer. A set requested before a payment does not
count toward that payment's refund, even if delivered after the payment.

A notes topic counts as opened only once it has been on screen for 30 seconds in one visit to the course page. On
screen means 60% of the note in view, or the note filling at least 60% of the screen (so long topics on a phone count
too). The time adds up while the student stays on the page, and nothing counts while the tab is hidden. Scrolling past a topic never counts. Each topic is sent at most once per visit (one background request, which
the page does not wait for) and recorded at most once per order.

## Support playbook

**Paid but no plan.** Run `payment-status --user <uuid>`.

- Order `pending` or `created`: run `payment-verify --order <id>`. If Bachs confirms, the plan appears at once.
- Bachs still says open: the payment has not reached Bachs (bank transfers can take a while). The daily reconcile
  and the late check pick it up for 14 days; tell the student it is being confirmed.
- Bachs cannot confirm the payment at all: wait for Bachs, or ask Bachs support to trace it, then fulfil by checkout
  id (`payment-verify`, or `payment-fulfil --provider-ref <checkout id>`). Never grant a plan from a screenshot, a
  receipt image or a bank transfer alert.
- Order shows no checkout id but the student has a Bachs receipt: find the checkout in the Bachs dashboard and run
  `payment-fulfil --order <id> --provider-ref <checkout id>`.
- `amount-mismatch`: the student paid less than the price, or in another currency. No plan was granted. Refund the
  payment (`refund ... --class our-fault` if we caused it, otherwise agree the next step with the student).
- `unfulfilled`: paid after the semester ended or after the account was deleted. Refund it (`our-fault`).

**Refunds.**

When a student asks for a refund, reply with: "We've received your refund request and are looking at it now. Please
don't use your plan while we process it: using it before the refund is processed can mean it no longer qualifies."
Then record when they asked; that time is the `--requested-at` below.

1. Dry run first: `refund --order <id> --class standard --actor <you> --reason "<ticket>" --requested-at <when the
   student asked>`. It shows the window, each use count (Campus Bot replies, exams, practice answers and theory
   reveals, notes topics) against its allowance, and the standard refunds already used by this person.
2. If allowed, run it again with `--request <new uuid> --confirm`. Access ends immediately, before the money moves.
3. Card payments are refunded through Bachs only; the refund settles when Bachs reports it (`refund.paid`). Bank
   transfers cannot be refunded through Bachs. Open the payment in the Bachs dashboard and note the sender's account.
   Send the money from our bank to that same account, and nowhere else. Then re-run the same command with
   `--manual-reference <our transfer reference> --account-last4 <last four digits of that account>
   --destination-confirmed`. We keep only the reference and the last four digits.
4. A refund Bachs refuses shows as `refund-failed` in `payments-health`; fix the cause and run `refund-retry`.

Our-fault (outage, wrong content, a billing error) and duplicate refunds are allowed at any time and never count
against the student's one standard refund.

**Overpayments.** A payment above the price is granted as usual and listed in `payments-health` under
`overpaid_excess_due` until the excess is refunded. Refund it with `refund --order <id> --class excess --request <uuid>
--confirm`, at any time: it returns only the amount above the price, never counts toward the student's one standard
refund, and changes no access. It goes back to the account that paid, by bank transfer as in step 3 above; a later plan
refund of a bank transfer returns the rest. Cards are charged the exact amount; if a card payment is ever overpaid,
refund the excess through Bachs support, not with this command.

**Duplicates.** Two payments for the same semester: the second order becomes `paid-duplicate` (no second grant) and
shows in `payments-health`. Refund it the same day with `refund --order <id> --class duplicate --request <uuid>
--confirm`. A second payment on the same order is flagged `extra-payment`; refund that payment the same way, adding
`--payment <payment id>` from `payment-status`.
