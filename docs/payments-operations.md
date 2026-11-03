# Payments operations

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

`GET /api/payments/reconcile` (cron bearer) runs **once a day** (`0 3 * * *` in `vercel.json`). The Vercel free plan
fails deployments with any cron more frequent than daily. Until the upgrade, the webhook and the return page settle
almost every payment; the daily run catches the rest. There are no continuation runs.

**Vercel Pro upgrade step:** once the project is on Pro, change the schedule in `vercel.json` to `*/5 * * * *` (every
five minutes) and deploy. Nothing else changes: each run is bounded as below.

Due orders are claimed in batches of 50, open orders newest first (the most likely to have just been paid), then
everything else by due time, with atomic `FOR UPDATE SKIP LOCKED` claims and a 60-second lease. Cron and `reconcile-now` use the same claims: overlapping runs cannot check the same order. A completion must
carry the current, unexpired lease token. A lost, timed-out or unstarted check keeps its due time and becomes
claimable when its lease ends.

No new check starts after 40 seconds. Each database call has a three-second timeout; each Bachs verification read has
a four-second timeout, including reading the body. The run has a separate 55-second cancellation deadline, leaving
time before the route's 60-second limit. The operator's `reconcile-now` follows these same bounds.

Open orders are first due two minutes after creation and back off through 2, 5, 10 and 30 minutes, then hourly.
Orders beyond the 48-hour reconciliation window are checked once more, then expire. Ended orders back off up to
48 hours. A late check that becomes due is retained across day 14: it gets that final check, then stops. Completed check
results are recorded on the order. A failed check (Bachs unavailable, a timeout, a database error) is recorded too
(`last_check_result`) and retried after 5, then 15, then every 60 minutes, without advancing the normal schedule; the
order stays counted as overdue from when it first became due. A permanent refusal (a checkout Bachs doesn't know, or an
answer that can't be this order's) stops checks and lists the order under `checks_stopped_for_review`; check it in the
Bachs dashboard and use `payment-fulfil --provider-ref` if a payment exists, so late checks can finish.
`payments-health` reports `checks_overdue_6h`, the number of orders due (or failing) for more than six hours; investigate
a nonzero count rather than assuming the schedule drained the queue.

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
| `payments-health` | Orders pending over 30 minutes, orders needing support (mismatch, duplicate, unfulfilled, refund failed, any flag except `overpaid`), bank-transfer overpayments whose excess is not yet refunded (`overpaid_excess_due`), card overpayments to raise with Bachs (`card_excess_contact_bachs_support`: contact Bachs support), pending refunds, orders due or failing for more than 6 hours (`checks_overdue_6h`), orders whose checks stopped for review (`checks_stopped_for_review`), paid grants still unbound after 7 days. |
| `payment-verify --order <uuid> --actor --reason` | Asks Bachs now and fulfils if it confirms the payment. The normal fix. Asks Bachs. |
| `payment-fulfil --order <uuid> --provider-ref <checkout id> --actor --reason` | The same, for an order whose checkout id we never stored. Bachs must still confirm a payment whose checkout reference is this order. Asks Bachs. |
| `refund --order <uuid> --class standard\|our-fault\|duplicate\|excess --actor --reason [--requested-at <ISO>] [--payment <uuid>]` | Dry run: what the database would decide, with every count. Nothing changes. |
| `refund ... --request <uuid> --confirm` | Records the refund (a plan refund first revokes every grant of the order, in the same transaction), then refunds a card payment through Bachs with the request id as the idempotency key. Asks Bachs. A bank transfer is left for a manual settlement. |
| `refund ... --request <uuid> --confirm --manual-reference <transfer ref> --account-last4 <4 digits> --destination-confirmed` | Bank transfers only: the same, settled as a transfer you made from our bank to the account that paid. Refused for card payments, before anything is recorded. Re-running the same `--request` with these settles a refund recorded earlier. |
| `refund-retry --order <uuid> --actor --reason [--manual-reference <ref> --account-last4 <4 digits> --destination-confirmed]` | A pending refund: sends it again with the same key. A failed refund: records a new one for the same payment, class and request time, then refunds. Repeating it never refunds twice. Asks Bachs. |
| `open-sales --actor --reason` / `close-sales --actor --reason` | The sales switch. |
| `reconcile-now` | A bounded reconcile run now. Asks Bachs. |
| `campus-bot-model --model <name> --weight <n> --actor --reason` | A model's price weight (Haiku = 1). Pending owner approval. |
| `campus-bot-cap --step writing\|check [--read <n>] [--written <n>] --actor --reason` | Per-request token caps. Pending owner approval. |

`--requested-at` is when the student asked (default now). It must lie between the payment and now. The 48-hour window
is judged at that time; use is counted from the payment until the refund is processed, so use after asking counts.

There is no manual-evidence fulfilment, by decision: a plan is granted only on a payment Bachs confirms.
`payment-fulfil --manual-evidence` is refused.

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
5. A refund command that times out (operator writes allow 15 seconds) may still have been recorded, with access
   already ended. Run `payment-status --order <id>` first: if the refund is there and pending, run `refund-retry`; if
   it isn't, run the same `refund ... --request <same uuid> --confirm` again.

Our-fault (outage, wrong content, a billing error) and duplicate refunds are allowed at any time and never count
against the student's one standard refund.

**Overpayments.** A bank-transfer payment above the price is granted as usual and listed in `payments-health` under
`overpaid_excess_due` until the excess is refunded. Refund it with `refund --order <id> --class excess --request <uuid>
--confirm`, at any time: it returns only the amount above the price, never counts toward the student's one standard
refund, and changes no access. Send it by bank transfer to the account that paid, as in step 3 above.

**Card excess goes through Bachs support.** Cards are charged the exact server catalogue amount. If Bachs reports
a card excess, contact Bachs support; do not issue an `excess` refund. Both the command and database refuse it before
recording anything. This preserves the card's one Bachs refund for a standard or our-fault plan refund.

**Settle the excess first.** A bank-transfer plan refund is refused while an excess refund is pending or failed
(`excess-unsettled`), without recording a plan refund or revoking access. Settle a pending excess, or run
`refund-retry` on a failed excess and settle it, before requesting the plan refund. The plan refund then returns only
the payment less the settled excess. A plan refund attempted while the excess is pending can be re-run with the same
request id once the excess has settled; keep the student's original `--requested-at` for a standard refund.

**Duplicates.** Two payments for the same semester: the second order becomes `paid-duplicate` (no second grant) and
shows in `payments-health`. Refund it the same day with `refund --order <id> --class duplicate --request <uuid>
--confirm`. A second payment on the same order is flagged `extra-payment`; refund that payment the same way, adding
`--payment <payment id>` from `payment-status`.
