# Payments design: Semester and Session plans

Design only, read-only review. No app code, migration, commit or push. Risk: CRITICAL (money and access).
Baseline: `develop` 94dc1d4 (A1 merged; A2 `fix/access-part-2` in progress, not merged). Written 1 November 2026.
Target: students can pay on launch day, **Saturday 7 November 2026**. §8 says what fits before then.

Sources read: PRD v1.4 §4.5 (and §5 payment security, §7 open questions), `20261017100000_trial_entitlements.sql`,
`20261021100000_discovery_pass.sql`, `20261023120000_discovery_eligibility.sql`, `20261026100000_course_selection_lock.sql`,
`20261029100000_own_course_access.sql` (A1), `docs/entitlements-operations.md`, `docs/course-access-operations.md`,
`app/access/page.tsx`, `lib/entitlements/presentation.ts`, `components/student/LockedCourseNotice.tsx`,
`lib/ai-practice/{contract,pricing}.ts`, `docs/student-design-foundation.md`, the A2 checkpoint report and its
`lib/practice/result-copy.ts`, and the designer's `CampusIntell Course Flow Design 4.zip` (found in `~/Downloads` as
"CampusIntell Course Flow Design 4.zip"; EST to confirm it is the intended file).

**Designer alignment.** Version 4 of the course flow has no payment frames yet. It has one placeholder, "Subscribe
screen – Destination – Phone" (marked "Designed in Task 2"), and states that every lock on the course page (topics,
Exam mode, Theory) and "Subscribe" on the free-questions-used screen lead there. The student-facing word throughout is
**Subscribe**. §2.3 uses the designer's brief as the screen list: Plan & Access (current access, two plans, Pay);
Confirm courses; Confirming, Confirmed, Didn't go through, Still confirming; Subscribed; Free-pass exam result (score
only). Every state in this design maps onto one of those frames (§2.3, mapping table). Re-check against the Task 2
frames when they arrive.

One mismatch to raise with the designer: v4 shows "You've used your 10 free questions in this course." No free-question
allowance per course exists in the backend (free access today is GST courses plus the Discovery Pass). Either that
screen is dropped, or it needs its own design and build. It is not part of this payments work.

PRD note: v1.4 names Paystack. The owner's provider is BACH. Everything below goes through a provider adapter, so the
PRD's rules (card, transfer and USSD on a hosted page; no card data on our side) carry over unchanged.

---

## 0. What already exists and what this design relies on

| Fact in the code | Consequence for payments |
| --- | --- |
| `entitlement_grants.source` already allows `'paid'`; `ai_terms` may be `none`, `capped` or `uncapped` for paid rows (`entitlement_grants_terms_check`) | A paid plan is a grant row. No new access path. |
| A1 trigger `bind_full_course_grant` binds every full grant to one calendar term and the student's department, using `greatest(created_at, starts_at)` as the anchor. A missing calendar leaves it pending, and binding later uses the same anchor | The Semester plan works with A1 as it stands. The second half of a Session plan needs an explicit term key (§1.3), because an anchor-based binding can land in the wrong term if the first semester is extended after payment. |
| `course_access_decision` grants a non-free course only if it is on the confirmed list (or a team addition) and there is an active full grant bound to the current term and department | A paid plan covers exactly "your own courses this semester". Nothing else. |
| `course_selection_state_for` locks the selection once any unrevoked grant has started after confirmation | Paying locks the courses. The confirm screen must say so before the student pays. |
| `admin_add_student_course` takes a request UUID, documented as "the future fulfillment hook" for paid single courses | Carry-over purchases (after launch) reuse it: one paid order line → one idempotent addition. Refund → `admin_revoke_student_course`. |
| `ai_usage_events.funding_source` allows only `trial`, `early_access`, `test` | Needs `'paid'` added (and `manual` if manual grants ever get AI). |
| `private.effective_ai_window`: uncapped beats capped, then later end | During an Early Access month, AI is funded by Early Access first; paid units are untouched. |
| `ai_units` is limited to 0–1000 | Fine for the proposed limit. |
| A2 (not merged): after a plan ends, scores stay; reopening past answers needs an active plan; timely submissions of pinned questions still score | "Plan ending mid-exam" relies on A2. Payments must not ship before A2 merges. |
| `ACCESS_SOURCE_LABEL.paid = 'Paid plan'`; Plan & Access says "every course until …" | Out of date for A1. Paid plans need their own names and "your courses until …" wording. |
| No `payments` code, no webhook route, no provider SDK | Everything in §2–§4 is new. |

---

## 1. Plans and grants

### 1.1 Catalogue (a setting, not code)

New `private.plan_catalogue` (service-role only):

| plan_key | Student name | Price (kobo) | Terms covered | AI sets per term | Sold while |
| --- | --- | --- | --- | --- | --- |
| `semester` | Semester plan | 400000 (₦4,000) | the term being bought | 10 (§5) | §1.5 |
| `session` | Session plan | 700000 (₦7,000) | First and Second Semester of one session | 10 per term | only while the term being bought is a First Semester |

Prices are stored in kobo as integers, with `currency = 'NGN'`, `active`, `effective_from`. The server reads the price
when it creates an order and copies it onto the order. A price change never touches orders that already exist.

### 1.2 Which grant each payment creates

One payment = one order = one fulfilment. Fulfilment writes, in one transaction:

| Plan | Grants | `starts_at` | `ends_at` (stored) | Effective end | `ai_terms` / `ai_units` |
| --- | --- | --- | --- | --- | --- |
| Semester | 1 × `source='paid'`, `paid_plan='semester'` | fulfilment clock | term base end + 90 days (slack) | `least(ends_at, department's term end)`, which is the term end including any department extension | `capped` / 10 |
| Session, first half | 1 × `paid_plan='session'`, `plan_part=1` | fulfilment clock | as above | First Semester end for the department | `capped` / 10 |
| Session, second half | 1 × `paid_plan='session'`, `plan_part=2` | the first half's effective end at fulfilment (the break belongs to the next semester, matching `course_selection_state_for`) | `starts_at` + 7 months | Second Semester end for the department | `capped` / 10 |

New grant columns (all null for non-paid rows, enforced by check): `paid_plan`, `plan_part`, `order_id`
(FK to `private.payment_orders`), `term_key` (`session_label` + `academic_period_id`). A unique index on
`(order_id, plan_part)` makes a second grant for the same order impossible at the database level.

Why the slack: A1 caps access at the department's term end. Storing the base end would cut off students whose
department gets an extension. The stored `ends_at` is never shown. Every reader shows the effective end. Add one
`private.grant_effective_end(grant)` and use it in `get_my_entitlement` so the page never shows the slack date.

### 1.3 The Session plan as two semester plans

- **Binding by term key, not anchor.** Paid grants bind to `term_key` from the order. `bind_full_course_grant` and
  `pending_course_grant_bindings` get one branch: for `source='paid'`, resolve the term by
  `(session_label, academic_period_id)` and bind only to that term. Otherwise the A1 anchor rule applies unchanged.
  Reason: if the First Semester is extended for the student's department after payment, an anchor at the old end
  falls inside the First Semester and would bind the second half to the wrong term.
- **Second Semester already in the calendar at payment:** the second grant binds at insert. It does not lock the
  selection or open anything until it starts (`starts_at <= now`).
- **Second Semester not in the calendar yet (the launch case):** the second grant is inserted with `term_key` and
  `course_term_id = null`. It stays pending. When the team runs `term-set` for 2026/2027 Second Semester, the next
  read or operator command binds it through the existing A1 path (`bind_pending_course_grants`). No new sweep is
  needed. Do **not** bind inside `admin_set_academic_term`: calendar writers must not take account or profile locks
  (A1 lock order).
- **Never-entered or wrongly entered term:** a pending second half never opens anything. `ops.cjs payments-health`
  (§3.4) lists paid grants still pending 7 days after their `starts_at`, so support sees them before the student does.
- **At the Second Semester:** the student's selection becomes `reselect` (A1). They confirm Second Semester courses,
  which binds the second grant's department and locks the selection. Until then, department courses show
  "Confirm my courses" (existing `needs-selection` notice) with copy that names the plan (§2.4).
- **No rollover.** Unused AI sets in the first half don't carry over. Each half has its own 10.

### 1.4 Interaction with Early Access and the Discovery Pass

| Student has, when paying | Rule | Why |
| --- | --- | --- |
| Active Early Access month | Allowed. The plan starts at once. Course access is the same either way (both cover the same term). AI comes from Early Access first (uncapped wins), so the paid 10 sets are untouched until the month ends. The confirm screen shows one line: "Your Early Access month continues until {date}. Your plan then keeps your courses open until {term end}." | Starting at the Early Access end would add a second start date for no access benefit. |
| Active Discovery Pass | Allowed. The pass keeps running. Its open exam keeps its own database deadline, and its usage is unchanged. | The pass is a sample. It never extends full access. |
| A paid plan, ever | No Discovery Pass is offered afterwards. Add "has or had a paid grant" to `discovery_pass_eligibility` and `activate_discovery_pass` as `trial-not-offered` (owner question Q7). | A preview has no purpose after buying, and it avoids confusing plan states. |
| Already-paid term | No checkout. See "already paid" (§2.3). | Prevents duplicates before they happen. |

### 1.5 Course selection lock: confirm before paying

Order creation (server) requires, under the A1 write prefix (`lock_course_access_scope`):

1. `current_course_scope(user, now).state = 'ready'`, meaning the courses are confirmed for the term being bought.
   Otherwise the response is `needs-selection`, and the UI sends the student to confirm their courses first.
2. The `expected_profile_revision` sent by the confirm screen matches. Otherwise the answer is `selection-changed`
   and the confirm screen reloads with the current list.
3. The term has at least `sales_close_days` (setting, default 3, owner question Q4) left for the student's department.
   Otherwise the current-semester plan is not sold. A Semester plan for the next term is offered only once that term
   is in the calendar. A Session plan is offered only while the term is a First Semester.
4. No unrevoked paid grant for this `term_key` (`already-paid`), and no account deletion scheduled.

The order stores `term_key`, `department_id`, `profile_revision` and the price.

Between checkout and confirmation, the selection is still open (no grant has started). If the student changes it in
another tab, fulfilment **still grants** (money was taken). The grant binds to the current selection, and an
`order.selection-changed` audit event flags the order for support. We never refuse a paid fulfilment because of a
selection change.

---

## 2. Flow and states

### 2.1 Sequence

```
Plan & Access ─ choose plan ─▶ Confirm screen (/access/checkout?plan=semester)
   │  server: course list, dates, price from catalogue; nothing is created yet
   ▼  "Pay ₦4,000"  (POST /api/payments/checkout {plan, expected_profile_revision, request_id})
Server: create_payment_order (checks §1.5) → adapter.createCheckout(order) → 303 to hosted page
   ▼  student pays (card / transfer / USSD) on the provider's hosted page
Provider ─ redirect ─▶ /access/checkout/return?order=<order uuid>
   │  page ignores every provider query parameter (status=success means nothing)
   │  server: read our order; if pending, call adapter.verify(order) once (rate-limited)
   ▼  client polls GET /api/payments/orders/<id> (2 s, backing off to 10 s, for up to 2 min)
Provider ─ webhook ─▶ /api/payments/webhooks/<provider>   (in parallel, any time, any number of times)
   └─ verify signature → store event → adapter.verify → fulfil_payment (one grant set per order)
```

- **No card data.** The hosted page collects everything. We store the provider reference, amount, currency, channel
  (card/transfer/USSD) and timestamps only. No card number, last four digits, bank account or BVN.
- **The server sets the amount.** The checkout request carries a plan key, never an amount. Fulfilment compares the
  provider-verified amount and currency with the order. If they differ, the order goes to `amount-mismatch`: no grant,
  and support is alerted.
- **Idempotent start.** `request_id` (a client UUID per confirm-screen mount) plus "one open order per user, plan and
  term" means a double tap or a retry reuses the same order and the same checkout link while it is still valid
  (`checkout_minutes`, default 30). An expired link makes a new order.
- **Customer email to the provider:** most hosted checkouts require one for the receipt. Send the confirmed account
  email only, nothing else (NDPR minimisation). Confirm with BACH (§8).

### 2.2 Order states (internal)

`created` → `pending` (checkout link issued) → one of:

| State | Meaning | Student sees |
| --- | --- | --- |
| `paid` | Provider-verified success, grants written | Paid |
| `failed` | Provider-verified decline or error | Failed |
| `cancelled` | Student left the hosted page, provider says abandoned/cancelled | Cancelled |
| `expired` | No result by checkout expiry plus the reconciliation window (48 h) | Cancelled (same copy) |
| `amount-mismatch` | Verified payment does not match the order | Pending until support resolves it (never "paid") |
| `paid-duplicate` | A second successful payment for a term already paid | Already paid, refund note |
| `refund-pending` / `refunded` / `refund-failed` | §4 | Refund lines on Plan & Access |

Transitions happen only in definer functions. `paid` is terminal for fulfilment. A late `failed` event after `paid` is
recorded and ignored. Every transition writes `private.payment_events` (append-only, actor, detail without personal data).

### 2.3 Screens and copy

Design system: `PageBand`, `student-surface` / `student-surface-raised`, `Notice` (info/error), `btnNavy` primary and
`btnGhost` secondary, 44px touch targets, 16px phone gutter, Lagos dates through `formatAccessDate` / `formatSemesterDay`.
Lucide icons only (`CreditCard`, `Clock`, `CircleCheck`, `CircleAlert`). No emoji, no drawn SVG. Copy uses the
student's own term and dates, never internal terms (grant, order state, webhook, BACH API).

**Mapping to the designer's frames** (brief items in bold). Six frames cover every state. Cancelled and already paid
need no frames of their own:

| Frame | Shown for (internal states) | Section |
| --- | --- | --- |
| **Plan & Access: current access, two plans, Pay** | no paid plan for this term; also the "Subscribe" destination of every course lock; refund lines | A, D |
| **Confirm courses** | before checkout; `needs-selection` / `selection-changed` answers return here | B |
| **Confirming** | `created`, `pending` while polling (first 2 min); `amount-mismatch` (never shown as paid) | C |
| **Still confirming** | `pending` after polling stops | C |
| **Confirmed** | `paid`, first view after checkout | C |
| **Didn't go through** | `failed`; also `cancelled` / `expired` with a one-line variant (designer to confirm, Q18) | C |
| **Subscribed** | Plan & Access and the return page for an already-paid term, including a `paid-duplicate` with the refund line | C, D |
| **Free-pass exam result, score only** | Discovery exam result (A2): score and one line, no answers | G |

**A. Plan & Access: current access, two plans, Pay** (plans shown only when no active paid plan covers the current
term, the selection is ready and sales are open). Current access comes first (D), then two compact rows, not cards
with feature lists:

> **Choose a plan**
> **Semester plan · ₦4,000**
> Your First Semester courses until Mon 8 Mar 2027, with 10 AI practice sets.
> [Pay ₦4,000]
>
> **Session plan · ₦7,000**
> First and Second Semester 2026/2027, with 10 AI practice sets each semester.
> [Pay ₦7,000]

"Pay" opens Confirm courses (B), never the hosted page directly: the student always sees their course list first.
>
> GST courses stay free.

Selection not confirmed: the section is replaced by "Confirm your courses for this semester to choose a plan."
with [Confirm my courses]. Sales closed near term end: "Plans for {next semester} open when its dates are announced."
(no button).

**B. Confirm courses** `/access/checkout?plan=semester` (raised surface, one column, `student-form-width`):

> **Semester plan · ₦4,000**
> **Your courses** · Business Administration, 200 Level, First Semester
> BUA 201, BUA 203, BUA 205 and 6 more  [Show all]
> Open until Mon 8 Mar 2027 (Lagos). Includes 10 AI practice sets.
> Your courses are set for the semester once you pay. [Change my courses] *(only while the selection is open)*
> *(Early Access only)* Your Early Access month continues until {date}. Your plan then keeps your courses open until {term end}.
>
> [Pay ₦4,000]
> You'll pay on our payment partner's secure page. We never see your card details.
> Refunds: within 24 hours if you haven't used the plan yet. [Refund policy]

Session variant, dates line: "First Semester: open until Mon 8 Mar 2027. Second Semester: opens when it resumes. We'll
show the date once it's announced." (or the date, if the term is in the calendar).

**C. Return page** `/access/checkout/return?order=…`. It renders our order state only.

| Frame (state) | Title | Body | Actions |
| --- | --- | --- | --- |
| Confirming (pending, first 2 min, polling) | Confirming your payment | This usually takes a few seconds. You can leave this page. Your plan appears on Plan & Access once it's confirmed. | (spinner with `role="status"`), [Back to Plan & Access] |
| Still confirming (pending after polling stops) | We're still confirming your payment | Bank transfers can take a few minutes. We'll add your plan as soon as your payment is confirmed. You won't be charged twice for this checkout. | [Check again] [Back to Plan & Access]; after 30 min also "Paid but still waiting? [Message us]" |
| Confirmed (paid) | You're subscribed | Your Semester plan keeps your courses open until Mon 8 Mar 2027. | [Go to my courses] |
| Confirmed (paid, Session) | You're subscribed | Your Session plan keeps your First Semester courses open until Mon 8 Mar 2027. Second Semester opens when it resumes. | [Go to my courses] |
| Didn't go through (failed) | Your payment didn't go through | No plan was added. If money left your account, message us with the time you paid and we'll sort it out. | [Try again] [Message us] |
| Didn't go through (cancelled / expired) | Payment not completed | You left checkout before paying. No plan was added. | [Try again] |
| Subscribed (already paid) | You're already subscribed | Your Semester plan covers your courses until Mon 8 Mar 2027. | [Go to my courses] |
| Subscribed (paid-duplicate) | You're already subscribed | We received two payments for this plan. We'll refund the extra one. You don't need to do anything. | [Go to my courses] |
| (none: not your order / unknown) | We couldn't find that payment | Check Plan & Access for your current plan. | [Plan & Access] |

"Paid" copy appears only when our database says `paid`. The client never infers it from the provider redirect, a
timer or a cached response. The status endpoint is `no-store` and owner-scoped.

**D. Plan & Access, current access / Subscribed** (replaces "Paid plan · every course until …"):

> **Subscribed · Semester plan** · your First Semester courses until Mon 8 Mar 2027.
> *(Session)* **Session plan** · First Semester until Mon 8 Mar 2027. Second Semester: opens when it resumes.
> *(refund pending)* Your refund of ₦4,000 is being processed. Your plan has ended.
> *(refunded)* Refunded on {date}. Your plan has ended. GST courses stay free.

**E. Second Semester, Session holder, not yet confirmed** (notice on Home and locked courses): title "Confirm your
Second Semester courses", body "Your Session plan covers them.", action [Confirm my courses].

**F. Plan ending soon** (existing `access-ending` notice, wording updated): "Your Semester plan ends {date}.
Department courses lock after that. GST courses stay free." Session first half: no ending notice when the second half
is already bound.

**G. Free-pass exam result, score only** (A2, `DiscoveryExam.tsx` and `ScoreOnly.tsx`): the score as the title
("34 of 50 correct") and one line, no answers, keys or explanations. A2 uses the owner-approved line
`ANSWERS_ACCESS_LINE` = "Answers and explanations are included with full access." When sales open it becomes "Answers
and explanations are included when you subscribe." with a [Subscribe] action to Plan & Access (§6). The same frame
serves an ordinary attempt whose plan ended or was refunded mid-exam: timely answers are scored, and the review stays
closed until the student has an active plan.

### 2.4 Return-path security

- `order` in the URL is our UUID. The page and the status API answer only for the order's own live session user.
  Anyone else gets "We couldn't find that payment" (no existence leak).
- The return route makes at most one provider verify call per order per 10 s (shared limiter). The webhook and the
  reconciliation job remain the main sources of truth.
- CSP: the checkout POST answers with a 303 to the provider's domain. Chrome enforces `form-action` on redirects, so
  add the provider's checkout origin to `form-action`, and nothing else, once known.

---

## 3. Webhooks, reconciliation and duplicates

### 3.1 Provider adapter

`lib/payments/provider.ts`, server-only (`import 'server-only'`), provider-neutral like `lib/ai-practice/provider.ts`:

```ts
interface PaymentProvider {
  readonly id: 'bach' | 'fake'
  createCheckout(input: { orderId: string; amountKobo: number; currency: 'NGN'; email: string;
    returnUrl: string; expiresAt: string }): Promise<{ checkoutUrl: string; providerReference: string }>
  verifyWebhook(rawBody: string, headers: Headers): VerifiedEvent | { rejected: 'signature' | 'timestamp' | 'malformed' }
  getTransaction(ref: { orderId: string; providerReference?: string }): Promise<ProviderTransaction>
  refund?(input: { providerTransactionId: string; amountKobo: number; idempotencyKey: string }): Promise<RefundResult>
}
type ProviderTransaction = { status: 'success' | 'failed' | 'abandoned' | 'pending' | 'not-found' | 'reversed';
  providerTransactionId: string | null; amountKobo: number | null; currency: string | null;
  channel: 'card' | 'transfer' | 'ussd' | 'other' | null; paidAt: string | null }
```

`refund` is optional. If BACH has no refund API, refunds are recorded as manual (§4.3). A `fake` provider
(HMAC-SHA256 with a test secret) is built now for tests and local runs. It is refused outside a verified local
environment, like `AI_PRACTICE_ACCEPT_TEST_GRANTS`.

### 3.2 Webhook handler

`app/api/payments/webhooks/[provider]/route.ts`, Node runtime, no cookies, no session:

1. Read `await request.text()` (raw body, ≤ 64 KB; larger → 413). Never parse before verifying.
2. `adapter.verifyWebhook` → constant-time HMAC compare against `PAYMENTS_WEBHOOK_SECRET` (server-only env var, never
   `NEXT_PUBLIC_`). Check the timestamp tolerance if BACH sends one (5 min). Support two secrets during rotation. If
   BACH publishes source IPs, check them too. Bad signature → 401 and a rate-limited log line without the body.
3. `record_payment_event(provider, provider_event_id, type, order_id, body_hash)`: unique on
   `(provider, provider_event_id)`. A replay returns `duplicate` → 200 immediately.
4. **Re-verify with the provider** (`getTransaction`). Never grant from webhook body fields alone.
5. `fulfil_payment(order_id, provider_txn_id, amount_kobo, currency, channel, paid_at, source)` (definer, service role):
   - takes A1's write prefix for the order's user (`lock_course_access_scope`), then the order row `FOR UPDATE`;
   - `unique (provider, provider_txn_id)` on `private.payment_fulfilments` and `unique (order_id)`: one fulfilment per
     provider transaction and one per order, whatever replays, return-page verifies, reconciliation runs or operator
     overrides arrive, in any order;
   - amount/currency mismatch → `amount-mismatch`, no grant;
   - term already paid by another order → `paid-duplicate`, no grant, refund queued (§3.5);
   - otherwise inserts the grant(s) (§1.2), sets `paid`, writes `payment.fulfilled` and `course.grant-bound` events;
   - returns the same result on every replay.
6. 200 on `fulfilled`, `duplicate` or `already-final`. 5xx only for transient database or provider errors, so the
   provider retries.

### 3.3 Late or missing webhooks: reconciliation

- **Return page:** one verify on arrival (above). This covers most "webhook late" cases while the student is watching.
- **Cron** (Vercel cron or pg_cron calling a service route, every 5 min): orders `pending` older than 2 min and younger
  than 48 h → `getTransaction` → `fulfil_payment` / `failed` / `cancelled`. Bounded batches (50), oldest first,
  provider rate limit respected. Orders older than 48 h with no result → `expired`. Expired orders are still checked
  once a day for 14 days (`late-check`), because a transfer can settle late, and a late success is still fulfilled.
- **Daily settlement check** (once BACH's settlement/report API is known): every provider success in the last 3 days
  has a fulfilment, and every fulfilment has a provider success. Differences go to `payments-health`.

### 3.4 Support override: "paid but no access"

`scripts/entitlements/ops.cjs`, same conventions (`--actor`, `--reason`, audit in the same transaction):

| Command | Does |
| --- | --- |
| `payment-status --user <uuid>` / `--order <uuid>` / `--provider-ref <ref>` | Orders, events, fulfilment, grants, refund state. No email or card data printed. |
| `payment-verify --order <uuid>` | Asks the provider now and runs `fulfil_payment` if it says success. This is the normal fix. |
| `payment-fulfil --order <uuid> --provider-ref <ref> --actor --reason` | Same, for a payment the provider confirms under a reference we didn't record (for example a transfer to the wrong session). Still provider-verified. |
| `payment-fulfil --order <uuid> --manual-evidence <note> --actor --reason --confirm` | Last resort when the provider can't be reached but the student shows proof. Writes a fulfilment with `source='manual-override'`, grants normally, and flags it in `payments-health` until a provider transaction is linked (`payment-link`). Not linked within 7 days → review. |
| `payments-health` | Pending > 30 min, amount mismatches, duplicates awaiting refund, unlinked overrides, paid grants still unbound 7 days after start, refund failures. |

All of these are idempotent through the same unique keys, so an override that races a late webhook still produces one
grant set.

### 3.5 Duplicate payments

- **Prevented:** one open order per user, plan and term, reused; no checkout while the term is paid; the confirm
  screen re-reads state on mount.
- **Still possible:** two tabs with two different plans, a transfer that settles after a card payment, or a provider
  double charge. The second success becomes `paid-duplicate`. It needs a full refund that does not count against the
  student's one refund (fault class `duplicate`). Default: flagged in `payments-health`, and an operator runs the
  refund the same day (Q8). Automatic once the BACH refund API has been proven in the sandbox.
- Semester bought, then Session bought for the same term: `paid-duplicate` on the term overlap. Upgrades are not
  sold at launch (Q12).

---

## 4. Refunds

### 4.1 Proposed rule (settings in `private.payment_policy`)

| Setting | Default | Meaning |
| --- | --- | --- |
| `refund_window_hours` | 24 | Standard refund window from `paid` confirmation |
| `refunds_per_student` | 1 | Standard refunds per student, ever |
| `refund_identity` | account + confirmed-email HMAC | Reuses `ENTITLEMENT_CLAIM_HASH_KEYS` (as Discovery claims do), so deleting and re-registering doesn't reset the limit |

| Class | Conditions | Counts toward the 1? |
| --- | --- | --- |
| `standard` | within the window **and** the plan is unused (§4.2) | yes |
| `our-fault` | any time; operator records the fault (outage, wrong content, wrong course list set by us, billing error) | no (Q2) |
| `duplicate` | `paid-duplicate` orders | no |

Session plan: one order, refunded whole (both grants revoked). No partial refunds outside `our-fault` (Q9).

### 4.2 How "used" is checked

"Used" = any of these, by this student, at or after the order's `paid_at`, on a **non-free** course:

| Signal | Source | Exists today? |
| --- | --- | --- |
| Studied a department course | new `private.plan_first_use (user_id, order_id, kind, first_at)`, one row per kind, written by `mark_plan_use` when the server successfully reads published material of a non-free course for this user | **No**, needs adding. The server read path calls it after an allowed read. Insert-only, `on conflict do nothing`, not called on every read once marked (the server checks the entitlement summary flag first). |
| Practised / took an exam | `public.quiz_attempts` (`created_at >= paid_at`, course not free), any intent | Yes |
| AI practice | `ai_usage_events` with `funding_grant_id` in the order's grants, or any admitted generation after `paid_at` | Yes (after `funding_source` gains `paid`) |
| Campus Bot | `ai_usage_events.feature = 'campus-bot'` | Not built. Its admission must write `ai_usage_events` like AI practice. Make this a requirement of the Campus Bot design. |

Use during an overlapping Early Access month counts as use (simplest to explain: "after you paid"). This is stated
on the confirm screen for Early Access students (refund line).

`refund_eligibility(order_id)` returns `{eligible, class_allowed[], used_kinds[], window_ends_at, refunds_used}`
without writing anything, so support can read it before acting.

### 4.3 The team's refund command

```
node scripts/entitlements/ops.cjs refund --order <uuid> --class standard|our-fault|duplicate \
  --request <uuid> --actor <name> --reason <text> [--confirm]
```

Without `--confirm` it is a dry run that prints eligibility. With it, `refund_order` (definer, A1 write prefix, then
the order row):

1. Refuses: not `paid`/`paid-duplicate`, already refunding, `standard` outside the window, `standard` with any use
   (lists the kinds), `standard` over the per-student limit. A replay of the same `--request` returns the same record.
2. Revokes every grant of the order (`revoked_by = 'operator:<actor>'`, `revoke_reason`), and any future paid course
   addition of the order through `admin_revoke_student_course`. Revoking ends course access and AI at once (existing
   rule), and a revoked grant no longer locks the selection.
3. Writes `private.payment_refunds` (order, class, amount = full order amount, identity hash, request key, actor,
   reason) and `payment.refund-requested`. Sets `refund-pending`. Commit.
4. Outside the transaction, `adapter.refund` with the request key as idempotency key → `refunded`, or `refund-failed`
   (shown in `payments-health`, retried with `refund-retry --order`). Without a refund API: `--manual-reference <bank
   ref>` records a refund made in BACH's dashboard and sets `refunded`.

Access is revoked before money moves, so a refund cannot be followed by more use. An in-progress exam at revocation
follows A2: timely pinned answers still score, review needs an active plan.

---

## 5. AI limit per plan

Interpretation of "strong": a firm, fixed allowance per semester that cannot be exceeded, not a soft fair-use line.
Units are the existing AI question sets (5 questions each), shared by every AI feature, including Campus Bot when built.
Failed or truncated generations cost the student nothing (existing rule), but they cost us, so a 25% overhead is added.

Cost per set (Sonnet 5.5: $2 / M input, $10 / M output):

- **Worst case:** 15,000 source tokens + 3,000 prompt = 18,000 in ($0.036) + 8,000 out ($0.080) = **$0.116**
  (`worstCaseCostUsd`, matching the "about $0.12" ceiling).
- **Typical (assumption):** about 8,000 in ($0.016) + about 3,000 out ($0.030) = **about $0.046**. Measure from
  `ai_usage_events.cost_usd` after the first week and replace this number.

At an **assumed ₦1,600 per US dollar** (replace with the day's rate; costs scale linearly), per semester, with the 25%
overhead, and before provider fees:

| Sets per semester | Worst case | % of ₦4,000 | Typical (all sets used) | % of ₦4,000 | % of ₦3,500 (Session, per semester) worst / typical |
| --- | --- | --- | --- | --- | --- |
| 5 | $0.73 · ₦1,160 | 29% | $0.29 · ₦460 | 12% | 33% / 13% |
| 8 | $1.16 · ₦1,860 | 46% | $0.46 · ₦740 | 18% | 53% / 21% |
| **10 (recommended)** | **$1.45 · ₦2,320** | **58%** | **$0.58 · ₦920** | **23%** | **66% / 26%** |
| 15 | $2.18 · ₦3,480 | 87% | $0.86 · ₦1,380 | 35% | 99% / 39% |
| 20 | $2.90 · ₦4,640 | 116% | $1.15 · ₦1,840 | 46% | 133% / 53% |

**Recommendation: 10 sets per semester** (50 questions; Session = 10 + 10, no rollover), plus the existing per-day
upload limit. Worst case stays under the price even on a Session plan. Typical full use costs about a quarter of the
price, and most students won't use all 10. If the owner wants a stricter worst case, use 8 (46%). Keep the platform
guard `global_daily_generations` (500/day, worst case about $58 or ₦93k a day) and review it after the first week.

Implementation: grant `ai_terms='capped'`, `ai_units` from the catalogue at fulfilment (a setting), Plan & Access shows
"7 of 10 AI practice sets left this semester."

---

## 6. The copy switch at launch

One server flag decides the wording: `private.payment_policy.sales_open` (exposed through `get_my_entitlement` as
`plans_on_sale`). Opening sales and switching copy is then one atomic, auditable operator action
(`ops.cjs open-sales --confirm --actor --reason`). Centralise the strings in `lib/entitlements/presentation.ts`. Today
they are spread across files.

| Where | Today | When sales open |
| --- | --- | --- |
| `components/student/LockedCourseNotice.tsx:48` | Included with full access | Included when you subscribe |
| `components/student/LockedCourseNotice.tsx:53` | Department courses open fully with Early Access. | Department courses open when you subscribe. |
| `components/student/LockedCourseNotice.tsx:50` | See how to unlock | Subscribe (the designer's lock action; goes to Plan & Access) |
| `components/student/study-families.ts:22` | Included with full access. | Included when you subscribe. |
| `app/courses/[slug]/preview/[kind]/page.tsx:159–160` | Included with full access · Department courses open fully with Early Access. GST courses stay free. | Included when you subscribe · Department courses open when you subscribe. GST courses stay free. |
| `app/courses/[slug]/preview/[kind]/page.tsx:189` | …come with full access. | …are included when you subscribe. |
| `app/courses/[slug]/preview/[kind]/DiscoveryExam.tsx:393` | …comes with full access. | …is included when you subscribe. |
| `app/courses/ai-practice/[courseId]/journey.ts:67` | AI practice opens with Early Access. | AI practice is included when you subscribe. |
| `app/access/page.tsx:32` (lede) | Department courses open fully with Early Access. | Department courses open when you subscribe. |
| `app/access/page.tsx:129` | Department courses open fully with Early Access. … | replaced by the "Choose a plan" section (§2.3 A) |
| `app/access/page.tsx` `AiSection` | …comes with a Discovery Pass or Early Access. | …is included when you subscribe. |
| `lib/practice/result-copy.ts` `ANSWERS_ACCESS_LINE` (A2, not yet on develop; used by `DiscoveryExam.tsx` and `ScoreOnly.tsx`) | Answers and explanations are included with full access. | Answers and explanations are included when you subscribe. |
| `lib/entitlements/presentation.ts` `ACCESS_SOURCE_LABEL.paid` | Paid plan | Semester plan / Session plan (from `paid_plan`) |

Not changed: an active Early Access student's own plan lines ("Active until …"). Their notices say "subscribe" only
in the last `expiry_notice_hours`. The A2 working tree also edits `DiscoveryExam.tsx`; take these lines after A2 merges.
Landing (`lib/landing/content.ts`) has no full-access wording today. Add pricing there only when the owner approves
public prices.

---

## 7. Test matrix

All on the `fake` provider (deterministic signatures and transaction answers), pgTAP for database rules, CJS race
suites (one file at a time, per the existing rule), and browser checks at 375px and 1280px with two accounts.

| # | Case | Expect |
| --- | --- | --- |
| 1 | Success: card, webhook before return | Return page shows Confirmed on first poll; 1 grant (Semester) or 2 (Session); selection locked; AI 10/10 |
| 2 | Success: return before webhook | Return verify fulfils; webhook later → `duplicate`, no second grant |
| 3 | Decline | `failed`; no grant; "didn't go through" copy; retry creates a new order |
| 4 | Abandon / cancel on hosted page | `cancelled`; no grant; selection still open |
| 5 | Timeout: provider `pending`, then success after 10 min (transfer) | "still confirming" copy; cron fulfils; Plan & Access shows the plan without signing out |
| 6 | Timeout: no answer for 48 h, success on day 3 | `expired` then `late-check` fulfils |
| 7 | Webhook replayed ×5, concurrently | 1 fulfilment, 1 grant set, 5 event rows |
| 8 | Webhook bad signature / bad timestamp / 1 MB body | 401 / 401 / 413; nothing written except a rate-limited log |
| 9 | Webhook amount ≠ order (₦40 instead of ₦4,000) | `amount-mismatch`; no grant; health flag |
| 10 | Duplicate: two tabs pay the same plan | second `paid-duplicate`; refund queued; copy "we'll refund the extra one" |
| 11 | Duplicate: double tap on Pay | same order and same checkout link |
| 12 | Already paid: open checkout for a paid term | no order; Subscribed frame, "You're already subscribed" |
| 13 | Selection not confirmed / changed in another tab | `needs-selection` / `selection-changed` before checkout; change after checkout → grant still issued + audit flag |
| 14 | Session, Second Semester in calendar | second grant bound at insert, inactive until start; no lock until start |
| 15 | Session, Second Semester missing | second grant pending; `term-set` later; next read binds to that term only |
| 16 | Session, First Semester extended after payment | second grant still binds to Second Semester (term key), starts are seamless |
| 17 | Session, Second Semester starts | needs-selection notice naming the plan; confirming opens courses and locks |
| 18 | Paying during Early Access | plan starts; AI funded by Early Access until it ends, then paid 10 |
| 19 | Paying during an active Discovery Pass | pass exam unaffected; full access opens |
| 20 | Discovery Pass after any paid grant | not offered; activation `trial-not-offered` |
| 21 | Refund standard, unused, at 23 h | grants revoked, provider refund called once, `refunded`; access gone at once |
| 22 | Refund standard after studying / practising / AI / exam (each) | refused, `used_kinds` lists it |
| 23 | Refund at 25 h | standard refused; `our-fault` allowed |
| 24 | Second standard refund (same account, then same email after re-registration) | refused |
| 25 | Refund replayed with same `--request`; provider refund fails | one refund; `refund-failed` → `refund-retry` succeeds once |
| 26 | Plan ends mid-exam (semester end) | timely pinned answers score; review needs an active plan (A2); no cut-off mid-question |
| 27 | Plan revoked mid-exam (refund) | same as 26 |
| 28 | Plan ends mid-AI generation | admitted generation completes and is charged to the plan that admitted it |
| 29 | Order created 2 days before term end (`sales_close_days`=3) | current plan not sold; correct "opens when dates are announced" copy |
| 30 | Operator override with manual evidence, then real webhook | one grant set; override linked; health clear |
| 31 | Return page with another user's order / forged `status=success` | "couldn't find that payment" / ignored |
| 32 | Account deletion scheduled | no checkout; pending webhook still fulfils (money taken) and is flagged for refund |
| 33 | Copy switch | every row in §6 flips together when `sales_open` flips; Early Access holder's own lines unchanged |

---

## 8. Build plan

Prerequisites: A2 merged (review-after-end rule), S1 merged, and the release gates in `development-workflow.md`.

### Launch day, 7 November: what fits

Today is Sunday 1 November, so there are five working days. The full build below (about 8–10 days, plus 2–3 for the
BACH adapter) does not fit. A **launch cut** of about 5 days can, but only if the gates below are met:

| In the launch cut | Deferred to the week after launch |
| --- | --- |
| Migration: catalogue, policy, orders, events, fulfilments, refunds, `plan_first_use`, term-key binding, `funding_source` + `paid`, effective end | Automatic provider refunds (record refunds made in the BACH dashboard with `--manual-reference` instead) |
| `fulfil_payment` with both unique keys, `create_payment_order`, `refund_order`, `refund_eligibility` | Automatic duplicate refunds (operator refunds the same day, as Q8 recommends anyway) |
| Adapter, `fake` provider, BACH adapter, webhook, status, checkout and 5-minute reconciliation routes (including the 14-day late check) | Daily settlement check |
| Frames A–D and G, the copy switch, `open-sales` | Receipt email (Q15), extra analytics beyond the four events |
| `ops.cjs` `payment-status`, `payment-verify`, `payment-fulfil`, `refund`, `payments-health` | Upgrade path (Q12) |
| pgTAP for every rule plus the replay/return/cron/override race; §7 rows 1–13, 21–27, 31 in the BACH sandbox | Remaining §7 rows run in the first week |

Gates for selling on 7 November:
1. BACH sandbox keys, webhook signing scheme and verify API by **Tuesday 3 November**.
2. A2 merged by Wednesday 4 November.
3. The hosted migration rehearsed on the test site, plus one real ₦4,000 live payment and refund made by the team
   before `open-sales`.

If any gate slips, launch on 7 November with `plans_on_sale = false`: the current Early Access and full-access copy
stays, and sales open when ready (Q19). Early Access members get their free month at launch anyway, so a few days'
delay in selling costs little. A manual "pay by transfer and we grant it" stopgap is not recommended: it puts money
outside the one-grant-per-transaction guarantees this design depends on.

### Full build (no BACH details needed), about 8–10 dev days

1. Migration: `plan_catalogue`, `payment_policy`, `payment_orders`, `payment_events`, `payment_fulfilments`,
   `payment_refunds`, `plan_first_use`; grant columns (`paid_plan`, `plan_part`, `order_id`, `term_key`) and the term-key
   binding branch; `funding_source` + `paid`; `grant_effective_end`; definer functions `create_payment_order`,
   `record_payment_event`, `fulfil_payment`, `refund_eligibility`, `refund_order`, `mark_plan_use`; Discovery
   eligibility excludes paid accounts; `get_my_entitlement` exposes paid plan, effective end and `plans_on_sale`. Full
   pgTAP suite plus races (replay storm, return vs webhook vs cron vs override, refund vs read, Session binding vs `term-set`).
2. `lib/payments/` adapter interface, `fake` provider, webhook route, status route, checkout route, reconciliation route.
3. Screens §2.3 A–G behind `plans_on_sale = false`, the copy switch §6, and Plan & Access current-plan wording.
4. `ops.cjs` commands §3.4 and §4.3, `open-sales`, and docs in `docs/payments-operations.md`.
5. Analytics events: `plan_checkout_started`, `plan_paid`, `plan_failed`, `plan_refunded` (PRD §5).

### Waits for BACH

| Needed from BACH | Used for |
| --- | --- |
| Sandbox and live keys, account verification status | `createCheckout`, `getTransaction` |
| Hosted checkout API: amount units, reference field, expiry, return URL rules, required customer fields | §2.1 |
| Webhook signing scheme (algorithm, header, timestamp, secret rotation), event names, retry schedule, source IPs | §3.2 |
| Transaction-verify endpoint and statuses (incl. transfer `pending`, reversals) | §3.3 |
| Refund API (or dashboard-only), refund timeline, partial-refund support | §4.3 and the refund copy |
| Settlement or report API | daily settlement check |
| Fees (card / transfer / USSD) | margin in §5 |
| Checkout origin(s) | CSP `form-action` |
| Receipt emails: does BACH send them? | whether we send our own |

Then: real adapter (about 2–3 days), sandbox end-to-end run of the §7 matrix, hosted rollout (migration first,
`plans_on_sale` still off), owner acceptance on a phone, then `open-sales`.

---

## 9. Owner questions (each with a recommendation)

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Refund window: 24 hours from confirmation? | Yes, as the `refund_window_hours` setting. |
| Q2 | Do our-fault and duplicate refunds use up the student's one refund? | No. Only standard refunds count. |
| Q3 | Paying during Early Access: start at once, or when the month ends? | At once. Same course access, AI comes from Early Access first, one start date to explain. |
| Q4 | Stop selling the current semester how close to its end? | 3 days before the department's last day (exam weeks are when students buy), with the end date shown on the confirm screen. |
| Q5 | Sell the Session plan only during the First Semester (and the break before it)? | Yes. In the Second Semester, only the Semester plan. |
| Q6 | AI limit? | 10 sets per semester (Session: 10 + 10, no rollover). 8 if the worst case must stay under half the price. |
| Q7 | Offer a Discovery Pass to someone who has had a paid plan? | No. |
| Q8 | Duplicate payments: refund automatically or after an operator check? | Operator refund the same day at launch. Automatic after the BACH refund API is proven in the sandbox. |
| Q9 | Partial refund of a Session plan's Second Semester? | No, except our-fault. |
| Q10 | Does "studying" count as use the moment a department study page opens? | Yes: the first successful read of department material after paying. It's simple and checkable. |
| Q11 | Who may run a manual-evidence override, and is a second person needed? | Any operator, with a mandatory reason. Daily `payments-health` review. Add a second approver if overrides exceed a handful a week. |
| Q12 | Upgrade from Semester to Session at launch? | No. Later, as "add Second Semester" at the difference (₦3,000). |
| Q13 | Price changes: honour existing orders at their price? | Yes. The price is copied onto the order. |
| Q14 | Show the BACH name on the confirm screen? | Yes, once confirmed: "You'll pay on BACH's secure page." |
| Q15 | Send our own receipt email? | Yes, through the existing transactional email (plan, amount, dates, refund policy link), unless BACH's receipt already covers it. |
| Q16 | Account scheduled for deletion pays through an old checkout link | Fulfil (money taken), then auto-flag for a duplicate-class refund. |
| Q17 | Refund policy page wording and where it lives | A short section on Plan & Access ("Refund policy" disclosure) plus the Terms. Legal review before launch. |
| Q18 | Cancelled checkout: own frame, or a variant of Didn't go through? (for the designer) | A variant: same frame, title "Payment not completed", [Try again]. No new frame. |
| Q19 | If BACH details or A2 miss their dates: launch with sales closed, or delay launch? | Launch on 7 November with sales closed and open them when the gates pass. No manual-transfer stopgap. |
| Q20 | The v4 "You've used your 10 free questions in this course" screen has no backend allowance behind it. Keep it? | Drop it for launch. The locks' Subscribe action already leads to Plan & Access. Design a free sample later if wanted. |
