-- supabase/migrations/20261102100000_payments.sql — Payments, part 1: the database (docs/payments-design.md 9c484d2,
-- with the owner's part 1 changes). Plus and pro plans, each by Semester or Session, are paid grants on the A1 course
-- path; nothing else opens a course. Campus Bot budgets are tokens per tier. Provider ids: 'bachs' and 'fake'. Money is kobo integers; the adapter converts Bachs' decimal strings.
-- The database never calls a provider: every grant follows a provider-verified success reported by the service role.
-- Lock order: A1's write prefix (lock_course_access_scope), then the order row, then payment/refund rows and keys.
-- Every decision reads the wall clock once after the last lock; nothing waits after it. Calendar writers are unchanged
-- and take no account lock. A2 functions (fix/access-part-2) are not defined or replaced here; part 2 adds: no free pass
-- after a paid plan, AI and Campus Bot funded by paid plans, mark_plan_use calls from the read paths, and the identity
-- hash (with A2's email canonicalisation) passed to refunds.

-- ---------------------------------------------------------------------------
-- Settings. Values are copied onto orders and grants; changing them never touches existing rows.
-- ---------------------------------------------------------------------------
-- Campus Bot budgets by tier, in Haiku-equivalent tokens from the provider's exact token report for each request:
-- (read + written_token_weight x written) x the model's price_weight (campus_bot_models); failed tries count nothing.
-- Two limits: a session window from the student's first request, and a week from the first request of that week.
-- A set starts only when enough of both limits is left for it, and a started set always finishes (it may end a
-- limit below zero; nothing is cut off mid-set). Enforcement and team resets (everyone, one student) come in part 2.
-- PROVISIONAL: the numbers await owner approval.
create table private.campus_bot_tiers (
  tier text primary key check (tier in ('plus', 'pro')),
  session_hours integer not null check (session_hours between 1 and 48),
  session_tokens integer not null check (session_tokens between 0 and 100000000),
  week_days integer not null check (week_days between 1 and 31),
  week_tokens integer not null check (week_tokens between 0 and 100000000),
  written_token_weight integer not null check (written_token_weight between 1 and 100),
  updated_at timestamptz not null default now(),
  updated_by text not null check (char_length(updated_by) between 1 and 120)
);
insert into private.campus_bot_tiers values
  ('plus', 5, 350000, 7, 700000, 5, now(), 'migration:20261102100000'),
  ('pro', 5, 700000, 7, 1400000, 5, now(), 'migration:20261102100000');

-- Model weights by price, Haiku = 1. PROVISIONAL.
create table private.campus_bot_models (
  model text primary key check (model ~ '^[a-z][a-z0-9-]{0,39}$'),
  price_weight integer not null check (price_weight between 1 and 1000),
  updated_at timestamptz not null default now(),
  updated_by text not null check (char_length(updated_by) between 1 and 120)
);
insert into private.campus_bot_models values
  ('haiku', 1, now(), 'migration:20261102100000'),
  ('sonnet', 20, now(), 'migration:20261102100000');

-- Provider token caps per request, by step: writing (the answer) and check. The check step and the
-- calculation-course flag come in part 2. PROVISIONAL.
create table private.campus_bot_request_caps (
  step text primary key check (step in ('writing', 'check')),
  read_tokens_max integer not null check (read_tokens_max between 1 and 1000000),
  written_tokens_max integer not null check (written_tokens_max between 1 and 1000000),
  updated_at timestamptz not null default now(),
  updated_by text not null check (char_length(updated_by) between 1 and 120)
);
insert into private.campus_bot_request_caps values
  ('writing', 20000, 8000, now(), 'migration:20261102100000'),
  ('check', 3000, 1500, now(), 'migration:20261102100000');

-- Tier and billing period are separate: four plans. PROVISIONAL prices await owner approval.
create table private.plan_catalogue (
  plan_key text primary key check (plan_key in ('plus_semester', 'plus_session', 'pro_semester', 'pro_session')),
  tier text not null references private.campus_bot_tiers (tier) on delete restrict,
  period text not null check (period in ('semester', 'session')),
  price_kobo integer not null check (price_kobo between 100 and 100000000),
  currency text not null default 'NGN' check (currency = 'NGN'),
  -- AI practice sets per semester (design §5). Session plans get them per half.
  ai_sets_per_term integer not null check (ai_sets_per_term between 0 and 1000),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null check (char_length(updated_by) between 1 and 120),
  constraint plan_catalogue_key_check check (plan_key = tier || '_' || period)
);
insert into private.plan_catalogue (plan_key, tier, period, price_kobo, ai_sets_per_term, updated_by) values
  ('plus_semester', 'plus', 'semester', 400000, 10, 'migration:20261102100000'),
  ('plus_session', 'plus', 'session', 700000, 10, 'migration:20261102100000'),
  ('pro_semester', 'pro', 'semester', 600000, 10, 'migration:20261102100000'),
  ('pro_session', 'pro', 'session', 1100000, 10, 'migration:20261102100000');

create table private.payment_policy (
  singleton boolean primary key default true check (singleton),
  -- The launch switch: closed until an operator opens sales. Part 2 exposes it to the copy as plans_on_sale.
  sales_open boolean not null default false,
  checkout_minutes integer not null default 60 check (checkout_minutes between 5 and 1440),
  -- The current semester is not sold this close to the department's end.
  sales_close_days integer not null default 3 check (sales_close_days between 0 and 60),
  -- Stored grant end = the semester's end + this slack; every reader caps at the department's semester end.
  grant_slack_days integer not null default 90 check (grant_slack_days between 0 and 365),
  -- Catch-up: open orders are checked until this age, then expire; expired ones get a daily late check.
  reconcile_hours integer not null default 48 check (reconcile_hours between 1 and 720),
  late_check_days integer not null default 14 check (late_check_days between 0 and 90),
  -- Standard refunds: the window from paid confirmation, the per-identity limit, and what counts as used. A use above
  -- an allowance blocks a standard refund; free (GST) courses never count.
  refund_window_hours integer not null default 48 check (refund_window_hours between 0 and 720),
  refunds_per_student integer not null default 1 check (refunds_per_student between 0 and 10),
  refund_campus_bot_replies_allowed integer not null default 0 check (refund_campus_bot_replies_allowed between 0 and 1000),
  refund_exams_allowed integer not null default 0 check (refund_exams_allowed between 0 and 1000),
  refund_practice_answers_allowed integer not null default 10 check (refund_practice_answers_allowed between 0 and 10000),
  refund_notes_topics_allowed integer not null default 3 check (refund_notes_topics_allowed between 0 and 1000),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration:20261102100000' check (char_length(updated_by) between 1 and 120)
);
insert into private.payment_policy default values;

-- ---------------------------------------------------------------------------
-- Orders. Our order id is the provider checkout reference (unique for good on Bachs' side): one checkout per order.
-- ---------------------------------------------------------------------------
-- A same-site path: one leading "/", no "//", no "\", no scheme, no control or space characters, at most 200.
create function private.payment_return_path_ok(p_path text) returns boolean
language sql immutable set search_path = '' as $$
  select p_path is null or (char_length(p_path) between 1 and 200 and left(p_path, 1) = '/'
    and position('//' in p_path) = 0 and position(E'\\' in p_path) = 0 and p_path !~ '^[^?#]*:'
    and p_path !~ '[[:cntrl:][:space:]]');
$$;

create table private.payment_orders (
  id uuid primary key default gen_random_uuid(),
  -- Financial records outlive the account; deletion clears the link.
  user_id uuid references auth.users (id) on delete set null,
  request_id uuid not null unique,
  plan_key text not null references private.plan_catalogue (plan_key) on delete restrict,
  tier text not null check (tier in ('plus', 'pro')),
  period text not null check (period in ('semester', 'session')),
  amount_kobo integer not null check (amount_kobo > 0),
  currency text not null check (currency = 'NGN'),
  ai_sets integer not null check (ai_sets between 0 and 1000),
  campus_bot_session_tokens integer not null check (campus_bot_session_tokens between 0 and 100000000),
  campus_bot_week_tokens integer not null check (campus_bot_week_tokens between 0 and 100000000),
  -- The semester being bought (term key) and, for a Session plan, the Second Semester's key in the same session.
  term_id uuid not null references private.academic_terms (id) on delete restrict,
  term_session_label text not null,
  term_period_id uuid not null references public.academic_periods (id) on delete restrict,
  second_period_id uuid references public.academic_periods (id) on delete restrict,
  department_id uuid not null references public.departments (id) on delete restrict,
  profile_revision bigint not null,
  provider text not null check (provider in ('bachs', 'fake')),
  return_path text check (private.payment_return_path_ok(return_path)),
  status text not null default 'created' check (status in ('created', 'pending', 'paid', 'failed', 'cancelled',
    'expired', 'amount-mismatch', 'paid-duplicate', 'unfulfilled', 'refund-pending', 'refunded', 'refund-failed')),
  -- Support flags; a paid order is never refused for these.
  flags text[] not null default '{}' check (flags <@ array['selection-changed', 'overpaid', 'account-deletion',
    'extra-payment', 'account-deleted', 'term-ended']),
  expires_at timestamptz not null,
  checkout_id text check (char_length(checkout_id) between 1 and 128),
  checkout_url text check (char_length(checkout_url) <= 2048 and checkout_url ~ '^https://'),
  checkout_expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint payment_orders_session_check check ((period = 'session') = (second_period_id is not null)
    and plan_key = tier || '_' || period),
  constraint payment_orders_checkout_check check ((checkout_id is null) = (checkout_url is null)
    and (checkout_id is null) = (checkout_expires_at is null)),
  constraint payment_orders_pending_check check (status <> 'pending' or checkout_id is not null),
  constraint payment_orders_paid_check check ((paid_at is not null) = (status in ('paid', 'amount-mismatch',
    'paid-duplicate', 'unfulfilled', 'refund-pending', 'refunded', 'refund-failed')))
);
create index payment_orders_user_idx on private.payment_orders (user_id, created_at desc);
create index payment_orders_open_idx on private.payment_orders (status, created_at)
  where status in ('created', 'pending', 'failed', 'cancelled', 'expired');
create unique index payment_orders_checkout_idx on private.payment_orders (provider, checkout_id)
  where checkout_id is not null;

-- ---------------------------------------------------------------------------
-- Events: append-only, amounts, references and states only. Never an email, card or bank detail.
-- ---------------------------------------------------------------------------
create function private.payment_detail_ok(p_detail jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(p_detail) = 'object' and octet_length(p_detail::text) <= 2048
    and not exists (select 1 from jsonb_each(p_detail) d where d.key not in ('state', 'from', 'to', 'outcome',
      'amount_kobo', 'expected_kobo', 'currency', 'provider_status', 'method', 'source', 'checkout_id', 'payment_id',
      'refund_id', 'refund_class', 'provider_refund_id', 'manual', 'request_id', 'grant_id', 'plan', 'part',
      'term_id', 'flag', 'reason_code', 'expires_at', 'event_type')
      or jsonb_typeof(d.value) not in ('string', 'number', 'boolean', 'null'))
    -- References are opaque ids. No email address anywhere, and no card, account or bank-session number (13+ digits)
    -- in any other field.
    and position('@' in p_detail::text) = 0
    and not exists (select 1 from jsonb_each_text(p_detail) d where d.value is not null and (case when d.key in
      ('checkout_id', 'payment_id', 'refund_id', 'provider_refund_id', 'request_id', 'grant_id', 'term_id')
      then d.value !~ '^[A-Za-z0-9_.:-]{1,128}$' else d.value ~ '[0-9]{13,}' end));
$$;

create table private.payment_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  order_id uuid references private.payment_orders (id) on delete restrict,
  provider text check (provider in ('bachs', 'fake')),
  provider_event_id text check (provider_event_id ~ '^[A-Za-z0-9_.:-]{1,200}$'),
  event text not null check (event ~ '^[a-z][a-z0-9_.-]{1,60}$'),
  actor text not null check (char_length(actor) between 1 and 120),
  body_hash text check (body_hash ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb check (private.payment_detail_ok(detail)),
  constraint payment_events_provider_event_check check (provider_event_id is null or provider is not null)
);
create unique index payment_events_delivery_idx on private.payment_events (provider, provider_event_id)
  where provider_event_id is not null;
create index payment_events_order_idx on private.payment_events (order_id, id);

create function private.payment_events_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Payment events are append-only' using errcode = '42501';
end;
$$;
create trigger payment_events_append_only before update or delete on private.payment_events
  for each row execute function private.payment_events_append_only();

create function private.log_payment_event(p_order_id uuid, p_event text, p_actor text,
  p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into private.payment_events (order_id, event, actor, detail)
    values (p_order_id, p_event, p_actor, jsonb_strip_nulls(coalesce(p_detail, '{}'::jsonb)));
$$;

-- ---------------------------------------------------------------------------
-- Verified provider payments. One grant-producing payment per order, and one row per provider payment, for good.
-- outcome: fulfilled (grants written), amount-mismatch (less, or another currency), paid-duplicate (the semester was
-- already paid by another order), unfulfilled (no account, or the semester had ended), extra-payment (a second
-- payment on an order that already has one). Only 'fulfilled' produces grants.
-- ---------------------------------------------------------------------------
create table private.payment_fulfilments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references private.payment_orders (id) on delete restrict,
  provider text not null check (provider in ('bachs', 'fake')),
  provider_payment_id text not null check (provider_payment_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  provider_status text not null check (provider_status in ('succeeded', 'accepted', 'overpaid')),
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  method text not null check (method in ('card', 'bank_transfer')),
  provider_paid_at timestamptz,
  source text not null check (source in ('webhook', 'return', 'reconcile', 'operator')),
  actor text not null check (char_length(actor) between 1 and 120),
  outcome text not null check (outcome in ('fulfilled', 'amount-mismatch', 'paid-duplicate', 'unfulfilled',
    'extra-payment')),
  -- The answer given the first time, returned unchanged to every replay.
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint payment_fulfilments_payment_unique unique (provider, provider_payment_id)
);
create unique index payment_fulfilments_one_per_order on private.payment_fulfilments (order_id)
  where outcome <> 'extra-payment';

-- ---------------------------------------------------------------------------
-- Refunds: one per payment, never split (a failed refund does not count). Recorded, with every grant revoked, before
-- any money moves. Bachs cannot refund bank transfers, so any refund may be settled as manual with our bank reference.
-- ---------------------------------------------------------------------------
create table private.payment_refunds (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references private.payment_fulfilments (id) on delete restrict,
  order_id uuid not null references private.payment_orders (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  -- Keyed hashes of the student identity (one per active key); they outlive the account.
  identity_hashes text[] not null check (cardinality(identity_hashes) between 1 and 4
    and array_position(identity_hashes, null) is null),
  refund_class text not null check (refund_class in ('standard', 'our-fault', 'duplicate')),
  amount_kobo bigint not null check (amount_kobo > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  request_id uuid not null unique,
  requested_at timestamptz not null,
  actor text not null check (char_length(btrim(actor)) between 1 and 120),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'refunded', 'failed')),
  provider_refund_id text check (provider_refund_id ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  manual_reference text check (char_length(btrim(manual_reference)) between 1 and 128),
  settled_by text check (char_length(settled_by) between 1 and 120),
  settled_at timestamptz,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint payment_refunds_settled_check check ((status = 'pending') = (settled_at is null)
    and (status = 'pending') = (settled_by is null)),
  constraint payment_refunds_refunded_check check (status <> 'refunded'
    or provider_refund_id is not null or manual_reference is not null)
);
create unique index payment_refunds_one_per_payment on private.payment_refunds (payment_id) where status <> 'failed';
create index payment_refunds_user_idx on private.payment_refunds (user_id) where refund_class = 'standard';
create index payment_refunds_identity_idx on private.payment_refunds using gin (identity_hashes);

-- ---------------------------------------------------------------------------
-- Plan use the server sees and the attempt tables cannot show: notes topics opened, theory answers revealed, Campus
-- Bot replies delivered. Insert-only, once per order, kind, course and reference (a notes page without topics is one).
-- ---------------------------------------------------------------------------
create table private.plan_use_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references private.payment_orders (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('notes-topic', 'theory-reveal', 'campus-bot-reply')),
  course_id uuid references public.courses (id) on delete restrict,
  ref text not null check (char_length(ref) between 1 and 200),
  occurred_at timestamptz not null
);
create unique index plan_use_events_once on private.plan_use_events
  (order_id, kind, coalesce(course_id, '00000000-0000-0000-0000-000000000000'::uuid), ref);
create trigger plan_use_events_append_only before update or delete on private.plan_use_events
  for each row execute function private.payment_events_append_only();

alter table private.campus_bot_tiers enable row level security;
alter table private.campus_bot_models enable row level security;
alter table private.campus_bot_request_caps enable row level security;
alter table private.plan_catalogue enable row level security;
alter table private.payment_policy enable row level security;
alter table private.payment_orders enable row level security;
alter table private.payment_events enable row level security;
alter table private.payment_fulfilments enable row level security;
alter table private.payment_refunds enable row level security;
alter table private.plan_use_events enable row level security;
-- Deny by default: no API role reads or writes any payment table. Students read their own order through
-- get_my_payment_order() only.
revoke all on table private.campus_bot_tiers, private.campus_bot_models, private.campus_bot_request_caps, private.plan_catalogue, private.payment_policy, private.payment_orders, private.payment_events,
  private.payment_fulfilments, private.payment_refunds, private.plan_use_events
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Paid grants and AI funding.
-- ---------------------------------------------------------------------------
alter table public.entitlement_grants
  add column paid_plan text,
  add column plan_part smallint,
  add column order_id uuid references private.payment_orders (id) on delete restrict,
  add column term_session_label text,
  add column term_period_id uuid references public.academic_periods (id) on delete restrict,
  add column campus_bot_tier text,
  add column campus_bot_session_tokens integer,
  add column campus_bot_week_tokens integer,
  -- A row without an order (a legacy or test 'paid' row) keeps A1's anchor binding and none of these columns.
  add constraint entitlement_grants_paid_order_check check (
    (paid_plan is null and plan_part is null and order_id is null and term_session_label is null
      and term_period_id is null and campus_bot_tier is null and campus_bot_session_tokens is null
      and campus_bot_week_tokens is null)
    or (source = 'paid' and order_id is not null and term_session_label is not null and term_period_id is not null
      and ai_terms = 'capped' and campus_bot_tier in ('plus', 'pro') and paid_plan like campus_bot_tier || '\_%'
      and campus_bot_session_tokens between 0 and 100000000 and campus_bot_week_tokens between 0 and 100000000
      and ((paid_plan in ('plus_semester', 'pro_semester') and plan_part = 1)
        or (paid_plan in ('plus_session', 'pro_session') and plan_part in (1, 2)))));
create unique index entitlement_grants_order_part_idx on public.entitlement_grants (order_id, plan_part)
  where order_id is not null;
comment on column public.entitlement_grants.term_session_label is
  'Paid plans bind to this session and term_period_id (the term key), never to a time anchor.';

alter table public.ai_usage_events drop constraint ai_usage_events_funding_source_check;
alter table public.ai_usage_events add constraint ai_usage_events_funding_source_check
  check (funding_source in ('trial', 'early_access', 'test', 'paid'));

-- The end a reader shows and course access uses: the stored end capped at the bound department's semester end. Null
-- while a paid grant waits for its semester to be entered.
create function private.grant_effective_end(p_grant public.entitlement_grants) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when p_grant.course_term_id is null
    then case when p_grant.order_id is null then p_grant.ends_at end
    else (select least(p_grant.ends_at, e.ends_at) from private.academic_term_ends(p_grant.course_department_id) e
      where e.term_id = p_grant.course_term_id) end;
$$;

-- A1's binding, with one branch: a paid plan binds by its term key. A missing semester stays pending until a later
-- read or operator command binds it through the same path; an entered semester is never swapped for another.
create or replace function private.bind_full_course_grant() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_department uuid;
begin
  if new.source = 'trial' and new.trial_policy = 'discovery' then return new; end if;
  perform private.lock_course_access_scope(new.user_id);
  select department_id into v_department from public.profiles where id = new.user_id;
  new.course_department_id := v_department;
  new.course_term_id := null;
  if v_department is not null and new.term_session_label is not null then
    select t.id into new.course_term_id from private.academic_terms t
      where t.session_label = new.term_session_label and t.academic_period_id = new.term_period_id;
  elsif v_department is not null then
    select term_id into new.course_term_id
      from private.access_term_at(v_department, greatest(new.created_at, new.starts_at));
  end if;
  perform private.log_entitlement_event(new.user_id, new.id, 'course.grant-bound', 'system:grant',
    jsonb_build_object('term_id', new.course_term_id, 'department_id', v_department));
  return new;
end;
$$;

create or replace function private.pending_course_grant_bindings(p_user uuid, p_at timestamptz)
returns table (grant_id uuid, term_id uuid, department_id uuid)
language sql stable security definer set search_path = '' as $$
  select g.id, target.term_id,
    case when g.course_term_id is null or target.term_id = current_term.term_id
      then p.department_id else g.course_department_id end
  from public.entitlement_grants g join public.profiles p on p.id = g.user_id
  left join lateral private.access_term_at(p.department_id, p_at) current_term on true
  left join lateral private.access_term_at(p.department_id, greatest(g.created_at, g.starts_at)) issued
    on g.term_session_label is null
  left join lateral (select t.id as term_id from private.academic_terms t
    where t.session_label = g.term_session_label and t.academic_period_id = g.term_period_id) keyed
    on g.term_session_label is not null
  cross join lateral (select coalesce(g.course_term_id,
    case when g.term_session_label is null then issued.term_id else keyed.term_id end) as term_id) target
  where g.user_id = p_user and (g.source <> 'trial' or g.trial_policy = 'seven-day')
    and p.department_id is not null
    and (target.term_id is distinct from g.course_term_id
      or (target.term_id = current_term.term_id and p.department_id is distinct from g.course_department_id));
$$;

-- ---------------------------------------------------------------------------
-- Student: their own order, through the live session only. Internal states are folded into what the student sees.
-- ---------------------------------------------------------------------------
create function public.get_my_payment_order(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); o private.payment_orders; g1 public.entitlement_grants; g2 public.entitlement_grants;
begin
  if v_user is null or not private.has_live_account_session() then
    raise exception 'Account session required' using errcode = '42501';
  end if;
  select * into o from private.payment_orders where id = p_order_id and user_id = v_user;
  -- Another student's order and an unknown id look the same.
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  select * into g1 from public.entitlement_grants where order_id = o.id and plan_part = 1 and revoked_at is null;
  select * into g2 from public.entitlement_grants where order_id = o.id and plan_part = 2 and revoked_at is null;
  return jsonb_build_object('state', case
      when o.status in ('created', 'pending', 'amount-mismatch', 'unfulfilled') then 'confirming'
      when o.status in ('cancelled', 'expired') then 'cancelled'
      when o.status in ('refund-pending', 'refund-failed') then 'refund-pending'
      else o.status end,
    'order_id', o.id, 'plan', o.plan_key, 'tier', o.tier, 'period', o.period, 'amount_kobo', o.amount_kobo, 'currency', o.currency,
    'return_path', o.return_path, 'created_at', o.created_at, 'expires_at', o.expires_at, 'paid_at', o.paid_at,
    'ends_at', case when g1.id is not null then private.grant_effective_end(g1) end,
    'second_starts_at', g2.starts_at,
    'second_ends_at', case when g2.id is not null then private.grant_effective_end(g2) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Order creation (service role; identity from the verified session id). Courses must be confirmed for the semester
-- being bought, at the revision the confirm screen showed. A double tap with the same request id returns the same
-- order; another request reuses the open order for the same plan, semester and selection while its checkout is valid.
-- ---------------------------------------------------------------------------
create function public.create_payment_order(p_session_id uuid, p_plan text, p_expected_profile_revision bigint,
  p_request_id uuid, p_return_path text, p_provider text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_now timestamptz;
  v_policy private.payment_policy;
  v_plan private.plan_catalogue;
  v_bot private.campus_bot_tiers;
  v_profile public.profiles;
  v_scope jsonb;
  v_term private.academic_terms;
  v_second uuid;
  o private.payment_orders;
begin
  if p_plan is null or p_plan not in ('plus_semester', 'plus_session', 'pro_semester', 'pro_session')
      or p_expected_profile_revision is null
      or p_request_id is null or p_provider is null or p_provider not in ('bachs', 'fake') then
    raise exception 'Invalid payment order' using errcode = '22023';
  end if;
  if not private.payment_return_path_ok(p_return_path) then
    raise exception 'Invalid return path' using errcode = '22023';
  end if;
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform private.lock_course_access_scope(v_user);
  perform pg_advisory_xact_lock(hashtextextended('payment-request:' || p_request_id::text, 0));
  -- Every lock is held: decide on the wall clock now.
  v_now := clock_timestamp();
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  select * into o from private.payment_orders where request_id = p_request_id;
  if o.id is not null then
    if o.user_id is distinct from v_user or o.plan_key <> p_plan or o.provider <> p_provider
        or o.return_path is distinct from p_return_path then
      return jsonb_build_object('state', 'request-conflict');
    end if;
    return jsonb_build_object('state', 'existing', 'order', private.payment_order_summary(o));
  end if;
  if exists (select 1 from private.account_deletion_jobs where user_id = v_user) then
    return jsonb_build_object('state', 'account-restricted');
  end if;
  select * into strict v_policy from private.payment_policy;
  select * into v_plan from private.plan_catalogue where plan_key = p_plan;
  select * into v_bot from private.campus_bot_tiers where tier = v_plan.tier;
  if not v_policy.sales_open then return jsonb_build_object('state', 'sales-closed'); end if;
  if not v_plan.active then return jsonb_build_object('state', 'plan-unavailable'); end if;
  v_scope := private.current_course_scope(v_user, v_now);
  if v_scope->>'state' = 'missing-calendar' then return jsonb_build_object('state', 'sales-closed'); end if;
  if v_scope->>'state' <> 'ready' then return jsonb_build_object('state', 'needs-selection'); end if;
  select * into v_profile from public.profiles where id = v_user;
  if v_profile.revision <> p_expected_profile_revision then
    return jsonb_build_object('state', 'selection-changed', 'revision', v_profile.revision);
  end if;
  if (v_scope->>'ends_at')::timestamptz - make_interval(days => v_policy.sales_close_days) <= v_now then
    return jsonb_build_object('state', 'sales-closed');
  end if;
  select * into v_term from private.academic_terms where id = (v_scope->>'term_id')::uuid;
  if v_plan.period = 'session' then
    if not exists (select 1 from public.academic_periods where id = v_term.academic_period_id
        and key = 'first-semester') then
      return jsonb_build_object('state', 'plan-unavailable');
    end if;
    select id into v_second from public.academic_periods where key = 'second-semester';
    if v_second is null then return jsonb_build_object('state', 'plan-unavailable'); end if;
  end if;
  if exists (select 1 from public.entitlement_grants g where g.user_id = v_user and g.order_id is not null
      and g.revoked_at is null and g.term_session_label = v_term.session_label
      and g.term_period_id in (v_term.academic_period_id, v_second)) then
    return jsonb_build_object('state', 'already-paid');
  end if;
  select * into o from private.payment_orders where user_id = v_user and plan_key = p_plan and term_id = v_term.id
      and provider = p_provider and profile_revision = v_profile.revision and return_path is not distinct from p_return_path
      and ((status = 'created' and expires_at > v_now) or (status = 'pending' and checkout_expires_at > v_now))
    order by created_at desc limit 1;
  if o.id is not null then return jsonb_build_object('state', 'existing', 'order', private.payment_order_summary(o)); end if;

  insert into private.payment_orders (user_id, request_id, plan_key, tier, period, amount_kobo, currency, ai_sets,
      campus_bot_session_tokens, campus_bot_week_tokens, term_id, term_session_label, term_period_id, second_period_id, department_id, profile_revision, provider,
      return_path, expires_at, created_at, updated_at)
    values (v_user, p_request_id, p_plan, v_plan.tier, v_plan.period, v_plan.price_kobo, v_plan.currency,
      v_plan.ai_sets_per_term, v_bot.session_tokens, v_bot.week_tokens, v_term.id, v_term.session_label, v_term.academic_period_id, v_second,
      v_profile.department_id, v_profile.revision, p_provider, p_return_path,
      v_now + make_interval(mins => v_policy.checkout_minutes), v_now, v_now)
    returning * into o;
  perform private.log_payment_event(o.id, 'order.created', 'system:checkout', jsonb_build_object('plan', o.plan_key,
    'amount_kobo', o.amount_kobo, 'currency', o.currency, 'term_id', o.term_id, 'expires_at', o.expires_at,
    'request_id', o.request_id));
  return jsonb_build_object('state', 'created', 'order', private.payment_order_summary(o));
end;
$$;

-- What the server needs to start or resume the provider checkout. No personal data.
create function private.payment_order_summary(o private.payment_orders) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', o.id, 'status', o.status, 'plan', o.plan_key, 'amount_kobo', o.amount_kobo,
    'currency', o.currency, 'provider', o.provider, 'expires_at', o.expires_at, 'checkout_id', o.checkout_id,
    'checkout_url', o.checkout_url, 'checkout_expires_at', o.checkout_expires_at, 'return_path', o.return_path);
$$;

-- The checkout the provider created for this order (service role). Idempotent for the same checkout id.
create function public.attach_payment_checkout(p_order_id uuid, p_provider text, p_checkout_id text,
  p_checkout_url text, p_checkout_expires_at timestamptz) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_now timestamptz; o private.payment_orders;
begin
  if p_order_id is null or p_checkout_id is null or char_length(p_checkout_id) not between 1 and 128
      or p_checkout_url is null or char_length(p_checkout_url) > 2048 or p_checkout_url !~ '^https://'
      or p_checkout_expires_at is null then
    raise exception 'Invalid checkout' using errcode = '22023';
  end if;
  select user_id into v_user from private.payment_orders where id = p_order_id;
  if v_user is not null then perform private.lock_course_access_scope(v_user); end if;
  select * into o from private.payment_orders where id = p_order_id for update;
  v_now := clock_timestamp();
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if o.provider is distinct from p_provider then return jsonb_build_object('state', 'provider-mismatch'); end if;
  if o.checkout_id is not null then
    return jsonb_build_object('state', case when o.checkout_id = p_checkout_id then 'unchanged' else 'conflict' end,
      'order', private.payment_order_summary(o));
  end if;
  if o.status <> 'created' then return jsonb_build_object('state', 'already-final', 'order', private.payment_order_summary(o)); end if;
  update private.payment_orders set status = 'pending', checkout_id = p_checkout_id, checkout_url = p_checkout_url,
      checkout_expires_at = p_checkout_expires_at, updated_at = v_now
    where id = o.id returning * into o;
  perform private.log_payment_event(o.id, 'order.checkout-attached', 'system:checkout',
    jsonb_build_object('from', 'created', 'to', 'pending', 'checkout_id', p_checkout_id,
      'expires_at', p_checkout_expires_at));
  return jsonb_build_object('state', 'pending', 'order', private.payment_order_summary(o));
end;
$$;

-- A signed provider delivery, recorded once (service role). A replay answers 'duplicate'. The order may be unknown.
create function public.record_payment_event(p_provider text, p_provider_event_id text, p_event_type text,
  p_order_id uuid, p_body_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if p_provider is null or p_provider not in ('bachs', 'fake') or p_provider_event_id is null
      or p_provider_event_id !~ '^[A-Za-z0-9_.:-]{1,200}$' or p_event_type is null
      or p_event_type !~ '^[a-z][a-z0-9_.]{1,60}$' or (p_body_hash is not null and p_body_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'Invalid provider event' using errcode = '22023';
  end if;
  if p_order_id is not null and not exists (select 1 from private.payment_orders where id = p_order_id) then
    p_order_id := null;
  end if;
  insert into private.payment_events (order_id, provider, provider_event_id, event, actor, body_hash, detail)
    values (p_order_id, p_provider, p_provider_event_id, 'provider.delivery', 'system:webhook', p_body_hash,
      jsonb_build_object('event_type', p_event_type))
    on conflict (provider, provider_event_id) where provider_event_id is not null do nothing
    returning id into v_id;
  return jsonb_build_object('state', case when v_id is null then 'duplicate' else 'recorded' end,
    'order_id', p_order_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Fulfilment (service role).
-- ---------------------------------------------------------------------------
create function public.fulfil_payment(p_order_id uuid, p_provider text, p_provider_payment_id text,
  p_provider_status text, p_amount_kobo bigint, p_currency text, p_method text, p_provider_paid_at timestamptz,
  p_source text, p_actor text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_now timestamptz;
  o private.payment_orders;
  f private.payment_fulfilments;
  v_policy private.payment_policy;
  v_profile public.profiles;
  v_department uuid;
  v_term private.academic_terms;
  v_term_end timestamptz;
  v_second private.academic_terms;
  v_second_end timestamptz;
  v_outcome text;
  v_reason text;
  v_flags text[] := '{}';
  v_part1 public.entitlement_grants;
  v_part2 public.entitlement_grants;
  v_result jsonb;
begin
  if p_order_id is null or p_provider is null or p_provider not in ('bachs', 'fake') or p_provider_payment_id is null
      or p_provider_payment_id !~ '^[A-Za-z0-9_.:-]{1,128}$' or p_provider_status is null
      or p_provider_status not in ('succeeded', 'accepted', 'overpaid') or p_amount_kobo is null or p_amount_kobo <= 0
      or p_currency is null or p_currency !~ '^[A-Z]{3}$' or p_method is null or p_method not in ('card', 'bank_transfer')
      or p_source is null or p_source not in ('webhook', 'return', 'reconcile', 'operator')
      or p_actor is null or char_length(btrim(p_actor)) not between 1 and 120 then
    raise exception 'Only a provider-verified card or bank-transfer success can be fulfilled' using errcode = '22023';
  end if;
  select user_id into v_user from private.payment_orders where id = p_order_id;
  if v_user is not null then perform private.lock_course_access_scope(v_user); end if;
  select * into o from private.payment_orders where id = p_order_id for update;
  perform pg_advisory_xact_lock(hashtextextended('payment-provider:' || p_provider || ':' || p_provider_payment_id, 0));
  -- Every lock is held: the outcome is decided on this clock, and nothing below waits.
  v_now := clock_timestamp();
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if o.provider <> p_provider then return jsonb_build_object('state', 'provider-mismatch'); end if;

  -- A replay from any source (webhook, return page, catch-up, operator) returns the first answer unchanged.
  select * into f from private.payment_fulfilments where provider = p_provider and provider_payment_id = p_provider_payment_id;
  if f.id is not null then
    if f.order_id <> o.id then return jsonb_build_object('state', 'payment-conflict'); end if;
    return f.result;
  end if;

  v_outcome := 'fulfilled';
  if exists (select 1 from private.payment_fulfilments where order_id = o.id and outcome <> 'extra-payment') then
    v_outcome := 'extra-payment';
  elsif p_currency <> o.currency or p_amount_kobo < o.amount_kobo then
    v_outcome := 'amount-mismatch';
  elsif o.user_id is null then
    v_outcome := 'unfulfilled'; v_reason := 'account-deleted';
  end if;
  if v_outcome = 'fulfilled' then
    select * into strict v_policy from private.payment_policy;
    select * into v_profile from public.profiles where id = o.user_id;
    v_department := coalesce(v_profile.department_id, o.department_id);
    select * into v_term from private.academic_terms where id = o.term_id;
    select ends_at into v_term_end from private.academic_term_ends(v_department) where term_id = o.term_id;
    if v_term_end <= v_now then
      v_outcome := 'unfulfilled'; v_reason := 'term-ended';
    elsif exists (select 1 from public.entitlement_grants g where g.user_id = o.user_id and g.order_id is not null
        and g.order_id <> o.id and g.revoked_at is null and g.term_session_label = o.term_session_label
        and g.term_period_id in (o.term_period_id, o.second_period_id)) then
      v_outcome := 'paid-duplicate';
    end if;
  end if;

  if v_outcome = 'fulfilled' then
    if p_amount_kobo > o.amount_kobo then v_flags := v_flags || 'overpaid'::text; end if;
    if v_profile.revision is distinct from o.profile_revision or v_profile.department_id is distinct from o.department_id then
      v_flags := v_flags || 'selection-changed'::text;
    end if;
    if exists (select 1 from private.account_deletion_jobs where user_id = o.user_id) then
      v_flags := v_flags || 'account-deletion'::text;
    end if;
    insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, reference,
        created_by, paid_plan, plan_part, order_id, term_session_label, term_period_id, campus_bot_tier,
        campus_bot_session_tokens, campus_bot_week_tokens)
      values (o.user_id, 'paid', v_now, greatest(private.academic_day_end(v_term.last_day), v_term_end)
          + make_interval(days => v_policy.grant_slack_days), 'capped', o.ai_sets,
        jsonb_build_object('order_id', o.id), 'system:payment', o.plan_key, 1, o.id, o.term_session_label,
        o.term_period_id, o.tier, o.campus_bot_session_tokens, o.campus_bot_week_tokens)
      returning * into v_part1;
    if o.period = 'session' then
      -- The second half starts where the first ends for this department and binds only to the Second Semester of the
      -- same session (pending until the team enters it). It opens nothing before it starts.
      select * into v_second from private.academic_terms
        where session_label = o.term_session_label and academic_period_id = o.second_period_id;
      select ends_at into v_second_end from private.academic_term_ends(v_department) where term_id = v_second.id;
      insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, reference,
          created_by, paid_plan, plan_part, order_id, term_session_label, term_period_id, campus_bot_tier,
        campus_bot_session_tokens, campus_bot_week_tokens)
        values (o.user_id, 'paid', v_term_end, case when v_second.id is null then v_term_end + interval '12 months'
            else greatest(private.academic_day_end(v_second.last_day), v_second_end)
              + make_interval(days => v_policy.grant_slack_days) end, 'capped', o.ai_sets,
          jsonb_build_object('order_id', o.id), 'system:payment', o.plan_key, 2, o.id, o.term_session_label,
          o.second_period_id, o.tier, o.campus_bot_session_tokens, o.campus_bot_week_tokens)
        returning * into v_part2;
    end if;
    perform private.log_entitlement_event(o.user_id, v_part1.id, 'payment.granted', 'system:payment',
      jsonb_build_object('order_id', o.id, 'plan', o.plan_key, 'part', 1));
    if v_part2.id is not null then
      perform private.log_entitlement_event(o.user_id, v_part2.id, 'payment.granted', 'system:payment',
        jsonb_build_object('order_id', o.id, 'plan', o.plan_key, 'part', 2));
    end if;
  end if;

  v_result := jsonb_build_object('state', 'recorded', 'order_id', o.id, 'outcome', v_outcome,
    'order_status', case v_outcome when 'fulfilled' then 'paid' when 'extra-payment' then o.status else v_outcome end,
    'grant_ids', to_jsonb(array_remove(array[v_part1.id, v_part2.id], null)),
    'flags', to_jsonb(v_flags || case when v_reason is null then '{}'::text[] else array[v_reason] end));
  insert into private.payment_fulfilments (order_id, provider, provider_payment_id, provider_status, amount_kobo,
      currency, method, provider_paid_at, source, actor, outcome, result, created_at)
    values (o.id, p_provider, p_provider_payment_id, p_provider_status, p_amount_kobo, p_currency, p_method,
      p_provider_paid_at, p_source, p_actor, v_outcome, v_result, v_now)
    returning * into f;
  if v_outcome = 'extra-payment' then
    update private.payment_orders set flags = array(select distinct unnest(flags || 'extra-payment'::text) order by 1),
        updated_at = v_now where id = o.id;
  else
    update private.payment_orders set status = v_result->>'order_status', paid_at = v_now, updated_at = v_now,
        flags = array(select distinct unnest(flags || v_flags || case when v_reason is null then '{}'::text[]
          else array[v_reason] end) order by 1)
      where id = o.id;
  end if;
  perform private.log_payment_event(o.id, 'payment.' || v_outcome, 'system:' || p_source, jsonb_build_object(
    'from', o.status, 'to', v_result->>'order_status', 'payment_id', p_provider_payment_id,
    'provider_status', p_provider_status, 'amount_kobo', p_amount_kobo, 'expected_kobo', o.amount_kobo,
    'currency', p_currency, 'method', p_method, 'source', p_source, 'reason_code', v_reason));
  return v_result;
end;
$$;
comment on function public.fulfil_payment(uuid, text, text, text, bigint, text, text, timestamptz, text, text) is
  'Service role only. The database cannot call Bachs: the caller must report a payment it has just verified with the provider (retrieved by API, never from webhook fields alone) whose status is succeeded, accepted or overpaid. Grants only when the amount covers the order in its currency; one grant set per order and per provider payment, and every replay returns the first answer.';

-- A provider-verified ending without payment (service role). Never overrides a payment; an expired, cancelled or
-- failed order can still be fulfilled by a late success.
create function public.record_payment_outcome(p_order_id uuid, p_outcome text, p_provider_status text, p_source text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_now timestamptz; o private.payment_orders;
begin
  if p_order_id is null or p_outcome is null or p_outcome not in ('failed', 'cancelled', 'expired')
      or (p_provider_status is not null and p_provider_status !~ '^[a-z_]{1,40}$')
      or p_source is null or p_source not in ('webhook', 'return', 'reconcile', 'operator') then
    raise exception 'Invalid payment outcome' using errcode = '22023';
  end if;
  select user_id into v_user from private.payment_orders where id = p_order_id;
  if v_user is not null then perform private.lock_course_access_scope(v_user); end if;
  select * into o from private.payment_orders where id = p_order_id for update;
  v_now := clock_timestamp();
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if o.status not in ('created', 'pending') then
    return jsonb_build_object('state', 'already-final', 'order_status', o.status);
  end if;
  if p_outcome = 'expired' and coalesce(o.checkout_expires_at, o.expires_at) > v_now then
    return jsonb_build_object('state', 'not-expired', 'order_status', o.status);
  end if;
  update private.payment_orders set status = p_outcome, updated_at = v_now where id = o.id;
  perform private.log_payment_event(o.id, 'order.' || p_outcome, 'system:' || p_source,
    jsonb_build_object('from', o.status, 'to', p_outcome, 'provider_status', p_provider_status, 'source', p_source));
  return jsonb_build_object('state', 'recorded', 'order_status', p_outcome);
end;
$$;

-- Orders the catch-up job asks the provider about (service role): open ones, those due to expire, and late checks.
create function public.payment_orders_to_check(p_limit integer) returns table (order_id uuid, provider text,
  checkout_id text, status text, created_at timestamptz, action text)
language sql stable security definer set search_path = '' as $$
  select o.id, o.provider, o.checkout_id, o.status, o.created_at,
    case when o.status in ('created', 'pending') and o.created_at > clock_timestamp() - make_interval(hours => p.reconcile_hours)
      then 'check' when o.status in ('created', 'pending') then 'expire' else 'late-check' end
  from private.payment_orders o cross join private.payment_policy p
  where p_limit between 1 and 500
    and ((o.status in ('created', 'pending') and o.created_at <= clock_timestamp() - interval '2 minutes')
      or (o.status in ('failed', 'cancelled', 'expired')
        and o.created_at > clock_timestamp() - make_interval(days => p.late_check_days)))
  order by o.created_at, o.id
  limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Plan use. Private: part 2's definer read paths (notes, theory reveal, Campus Bot delivery) call it after an allowed
-- read. Free courses are never recorded. One row per order, kind, course and reference.
-- ---------------------------------------------------------------------------
create function private.payment_course_is_free(p_course uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_course is not null and exists (select 1 from public.institutional_courses
    where repository_course_id = p_course and is_free);
$$;

create function private.mark_plan_use(p_user uuid, p_kind text, p_course_id uuid, p_ref text,
  p_at timestamptz default clock_timestamp()) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if p_user is null or p_kind is null or p_kind not in ('notes-topic', 'theory-reveal', 'campus-bot-reply')
      or p_ref is null or char_length(p_ref) not between 1 and 200 or p_at is null then
    raise exception 'Invalid plan use' using errcode = '22023';
  end if;
  if private.payment_course_is_free(p_course_id) then return 0; end if;
  insert into private.plan_use_events (order_id, user_id, kind, course_id, ref, occurred_at)
    select distinct g.order_id, p_user, p_kind, p_course_id, p_ref, p_at from public.entitlement_grants g
    where g.user_id = p_user and g.order_id is not null and g.revoked_at is null and g.starts_at <= p_at
      and coalesce(private.grant_effective_end(g), g.starts_at) > p_at
    on conflict do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds. Standard: within the window, judged at the time the student asked, with no use above the allowances after
-- payment, and within the per-identity limit. Our-fault and duplicate: any time, any use, never counted.
-- ---------------------------------------------------------------------------
create function private.refund_assessment(p_order private.payment_orders, p_payment private.payment_fulfilments,
  p_identity_hashes text[], p_requested_at timestamptz) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_policy private.payment_policy;
  v_paid timestamptz := p_order.paid_at;
  v_bot integer := 0; v_exams integer := 0; v_answers integer := 0; v_reveals integer := 0; v_topics integer := 0;
  v_used integer;
  v_reasons text[] := '{}';
  v_classes text[];
begin
  select * into strict v_policy from private.payment_policy;
  if p_payment.outcome = 'fulfilled' then
    v_classes := array['standard', 'our-fault'];
    select count(*) filter (where kind = 'campus-bot-reply'), count(*) filter (where kind = 'theory-reveal'),
        count(distinct coalesce(course_id::text, '') || ':' || ref) filter (where kind = 'notes-topic')
      into v_bot, v_reveals, v_topics
      from private.plan_use_events u
      where u.order_id = p_order.id and u.occurred_at >= v_paid and u.occurred_at <= p_requested_at
        and not private.payment_course_is_free(u.course_id);
    select count(*) into v_exams from public.quiz_attempts q
      where q.user_id = p_order.user_id and q.mode = 'exam' and q.created_at >= v_paid
        and q.created_at <= p_requested_at and not private.payment_course_is_free(q.course_id);
    select count(*) into v_answers from public.quiz_attempt_answers a join public.quiz_attempts q on q.id = a.attempt_id
      where q.user_id = p_order.user_id and q.mode is distinct from 'exam' and a.answered_at >= v_paid
        and a.answered_at <= p_requested_at and not private.payment_course_is_free(q.course_id);
    v_answers := v_answers + v_reveals;
    if p_requested_at > v_paid + make_interval(hours => v_policy.refund_window_hours) then
      v_reasons := v_reasons || 'window'::text;
    end if;
    if v_bot > v_policy.refund_campus_bot_replies_allowed then v_reasons := v_reasons || 'campus-bot'::text; end if;
    if v_exams > v_policy.refund_exams_allowed then v_reasons := v_reasons || 'exam'::text; end if;
    if v_answers > v_policy.refund_practice_answers_allowed then v_reasons := v_reasons || 'practice'::text; end if;
    if v_topics > v_policy.refund_notes_topics_allowed then v_reasons := v_reasons || 'notes'::text; end if;
  else
    v_classes := array['our-fault', 'duplicate'];
    v_reasons := array['no-plan'];
  end if;
  select count(*) into v_used from private.payment_refunds r
    where r.refund_class = 'standard' and r.status <> 'failed'
      and ((p_order.user_id is not null and r.user_id = p_order.user_id) or r.identity_hashes && p_identity_hashes);
  if p_payment.outcome = 'fulfilled' and v_used >= v_policy.refunds_per_student then
    v_reasons := v_reasons || 'limit'::text;
  end if;
  return jsonb_build_object('classes_allowed', to_jsonb(v_classes),
    'standard_allowed', cardinality(v_reasons) = 0, 'standard_refused', to_jsonb(v_reasons),
    'requested_at', p_requested_at, 'window_ends_at', v_paid + make_interval(hours => v_policy.refund_window_hours),
    'counts', jsonb_build_object('campus_bot_replies', v_bot, 'exams_started', v_exams, 'practice_answers', v_answers,
      'notes_topics', v_topics),
    'allowed', jsonb_build_object('campus_bot_replies', v_policy.refund_campus_bot_replies_allowed,
      'exams_started', v_policy.refund_exams_allowed, 'practice_answers', v_policy.refund_practice_answers_allowed,
      'notes_topics', v_policy.refund_notes_topics_allowed),
    'refunds_used', v_used, 'refund_limit', v_policy.refunds_per_student,
    'amount_kobo', p_payment.amount_kobo, 'currency', p_payment.currency, 'method', p_payment.method);
end;
$$;

create function private.refund_identity_ok(p_hashes text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_hashes is not null and cardinality(p_hashes) between 1 and 4 and array_position(p_hashes, null) is null
    and not exists (select 1 from unnest(p_hashes) h where h !~ '^[0-9a-f]{64}$');
$$;

-- Read-only (service role): what a refund of this order would be, and why a standard one is refused.
create function public.refund_eligibility(p_order_id uuid, p_identity_hashes text[] default null,
  p_requested_at timestamptz default now(), p_payment_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare o private.payment_orders; f private.payment_fulfilments; r private.payment_refunds;
begin
  if p_order_id is null or p_requested_at is null
      or (p_identity_hashes is not null and not private.refund_identity_ok(p_identity_hashes)) then
    raise exception 'Invalid refund question' using errcode = '22023';
  end if;
  select * into o from private.payment_orders where id = p_order_id;
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  select * into f from private.payment_fulfilments where order_id = o.id
    and (case when p_payment_id is null then outcome <> 'extra-payment' else id = p_payment_id end);
  if f.id is null then return jsonb_build_object('state', 'not-paid', 'order_status', o.status); end if;
  if p_requested_at < f.created_at or p_requested_at > clock_timestamp() then
    raise exception 'The request time must be between payment and now' using errcode = '22023';
  end if;
  select * into r from private.payment_refunds where payment_id = f.id and status <> 'failed';
  return private.refund_assessment(o, f, coalesce(p_identity_hashes, '{}'), p_requested_at)
    || jsonb_build_object('state', case when r.id is null then 'refundable' else 'already-refunding' end,
      'order_status', o.status, 'payment_id', f.id, 'refund_id', r.id);
end;
$$;

-- The team's refund command (service role). In one transaction, before any money moves: every grant of the order is
-- revoked and the refund recorded. The same request id returns the same record. The adapter then refunds with the
-- request id as its idempotency key, or the team records a manual refund (record_refund_result).
create function public.refund_order(p_order_id uuid, p_class text, p_request_id uuid, p_identity_hashes text[],
  p_actor text, p_reason text, p_requested_at timestamptz default now(), p_payment_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_now timestamptz;
  o private.payment_orders;
  f private.payment_fulfilments;
  r private.payment_refunds;
  v_hash text;
  v_assessment jsonb;
  v_revoked uuid[];
  v_result jsonb;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_order_id is null or p_class is null or p_class not in ('standard', 'our-fault', 'duplicate')
      or p_request_id is null or p_requested_at is null or not private.refund_identity_ok(p_identity_hashes) then
    raise exception 'Invalid refund' using errcode = '22023';
  end if;
  select user_id into v_user from private.payment_orders where id = p_order_id;
  if v_user is not null then perform private.lock_course_access_scope(v_user); end if;
  select * into o from private.payment_orders where id = p_order_id for update;
  select * into f from private.payment_fulfilments where order_id = p_order_id
    and (case when p_payment_id is null then outcome <> 'extra-payment' else id = p_payment_id end) for update;
  perform 1 from public.entitlement_grants where order_id = p_order_id order by id for update;
  for v_hash in select distinct h from unnest(p_identity_hashes) h order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('refund-identity:' || v_hash, 0));
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('refund-request:' || p_request_id::text, 0));
  -- Every lock is held: decide now, and nothing below waits.
  v_now := clock_timestamp();
  select * into r from private.payment_refunds where request_id = p_request_id;
  if r.id is not null then
    if r.order_id is distinct from p_order_id or r.refund_class <> p_class
        or (p_payment_id is not null and r.payment_id <> p_payment_id) then
      return jsonb_build_object('state', 'request-conflict');
    end if;
    return r.result || jsonb_build_object('refund_status', r.status);
  end if;
  if o.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if f.id is null then return jsonb_build_object('state', 'not-paid', 'order_status', o.status); end if;
  if p_requested_at < f.created_at or p_requested_at > v_now then
    raise exception 'The request time must be between payment and now' using errcode = '22023';
  end if;
  select * into r from private.payment_refunds where payment_id = f.id and status <> 'failed';
  if r.id is not null then return jsonb_build_object('state', 'already-refunding', 'refund_id', r.id); end if;
  v_assessment := private.refund_assessment(o, f, p_identity_hashes, p_requested_at);
  if not (v_assessment->'classes_allowed') ? p_class then
    return jsonb_build_object('state', 'class-not-allowed', 'assessment', v_assessment);
  end if;
  if p_class = 'standard' and not (v_assessment->>'standard_allowed')::boolean then
    return jsonb_build_object('state', 'refused', 'assessment', v_assessment);
  end if;

  if f.outcome = 'fulfilled' then
    with revoked as (
      update public.entitlement_grants set revoked_at = v_now, revoked_by = left('refund:' || btrim(p_actor), 120),
          revoke_reason = btrim(p_reason)
        where order_id = o.id and revoked_at is null returning id)
    select coalesce(array_agg(id order by id), '{}') into v_revoked from revoked;
  else
    v_revoked := '{}';
  end if;
  insert into private.payment_refunds (payment_id, order_id, user_id, identity_hashes, refund_class, amount_kobo,
      currency, request_id, requested_at, actor, reason, result, created_at)
    values (f.id, o.id, o.user_id, p_identity_hashes, p_class, f.amount_kobo, f.currency, p_request_id,
      p_requested_at, btrim(p_actor), btrim(p_reason), '{}'::jsonb, v_now)
    returning * into r;
  v_result := jsonb_build_object('state', 'refund-pending', 'refund_id', r.id, 'order_id', o.id, 'payment_id', f.id,
    'refund_class', p_class, 'amount_kobo', f.amount_kobo, 'currency', f.currency, 'method', f.method,
    'provider', f.provider, 'provider_payment_id', f.provider_payment_id, 'idempotency_key', p_request_id,
    'revoked_grant_ids', to_jsonb(v_revoked));
  update private.payment_refunds set result = v_result where id = r.id;
  perform private.log_entitlement_event(o.user_id, revoked_id, 'payment.refund-revoked',
      left('refund:' || btrim(p_actor), 120), jsonb_build_object('order_id', o.id, 'refund_id', r.id))
    from unnest(v_revoked) revoked_id;
  if f.outcome <> 'extra-payment' then
    update private.payment_orders set status = 'refund-pending', updated_at = v_now where id = o.id;
  end if;
  perform private.log_payment_event(o.id, 'refund.requested', left('operator:' || btrim(p_actor), 120),
    jsonb_build_object('from', o.status, 'to', case when f.outcome = 'extra-payment' then o.status else 'refund-pending' end,
      'refund_id', r.id, 'refund_class', p_class, 'amount_kobo', f.amount_kobo, 'currency', f.currency,
      'payment_id', f.provider_payment_id, 'request_id', p_request_id));
  return v_result;
end;
$$;

-- The refund's outcome (service role): the provider's answer, or a manual refund with our bank reference. Final.
create function public.record_refund_result(p_refund_id uuid, p_outcome text, p_provider_refund_id text,
  p_manual_reference text, p_actor text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_order uuid; v_now timestamptz; o private.payment_orders; r private.payment_refunds;
  f private.payment_fulfilments;
begin
  if p_refund_id is null or p_outcome is null or p_outcome not in ('refunded', 'failed')
      or (p_provider_refund_id is not null and p_provider_refund_id !~ '^[A-Za-z0-9_.:-]{1,128}$')
      or (p_manual_reference is not null and char_length(btrim(p_manual_reference)) not between 1 and 128)
      or (p_outcome = 'refunded' and p_provider_refund_id is null and p_manual_reference is null)
      or p_actor is null or char_length(btrim(p_actor)) not between 1 and 120 then
    raise exception 'Invalid refund result' using errcode = '22023';
  end if;
  select order_id, user_id into v_order, v_user from private.payment_refunds where id = p_refund_id;
  if v_user is not null then perform private.lock_course_access_scope(v_user); end if;
  select * into o from private.payment_orders where id = v_order for update;
  select * into r from private.payment_refunds where id = p_refund_id for update;
  v_now := clock_timestamp();
  if r.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if r.status <> 'pending' then
    return jsonb_build_object('state', case when r.status = p_outcome
        and r.provider_refund_id is not distinct from p_provider_refund_id
        and r.manual_reference is not distinct from btrim(p_manual_reference) then 'unchanged' else 'already-final' end,
      'refund_status', r.status);
  end if;
  update private.payment_refunds set status = p_outcome, provider_refund_id = p_provider_refund_id,
      manual_reference = btrim(p_manual_reference), settled_at = v_now, settled_by = btrim(p_actor)
    where id = r.id;
  select * into f from private.payment_fulfilments where id = r.payment_id;
  if f.outcome <> 'extra-payment' then
    update private.payment_orders set status = case p_outcome when 'refunded' then 'refunded' else 'refund-failed' end,
        updated_at = v_now where id = o.id;
  end if;
  perform private.log_payment_event(o.id, 'refund.' || p_outcome, left('operator:' || btrim(p_actor), 120),
    jsonb_build_object('from', o.status, 'refund_id', r.id, 'provider_refund_id', p_provider_refund_id,
      'manual', p_manual_reference is not null));
  return jsonb_build_object('state', 'recorded', 'refund_status', p_outcome);
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator settings and status (service role). Settings audits name the actor and reason in entitlement_events.
-- ---------------------------------------------------------------------------
create function public.admin_set_sales_open(p_open boolean, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before boolean;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_open is null then raise exception 'Open or closed required' using errcode = '22023'; end if;
  select sales_open into v_before from private.payment_policy for update;
  if v_before = p_open then return jsonb_build_object('state', 'unchanged', 'sales_open', p_open); end if;
  update private.payment_policy set sales_open = p_open, updated_at = now(), updated_by = left('operator:' || p_actor, 120);
  perform private.log_entitlement_event(null, null, case when p_open then 'payment.sales-opened' else 'payment.sales-closed' end,
    left('operator:' || p_actor, 120), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('state', 'changed', 'sales_open', p_open);
end;
$$;

create function public.admin_set_plan(p_plan text, p_price_kobo integer, p_ai_sets integer, p_active boolean,
  p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before private.plan_catalogue; v_after private.plan_catalogue;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into v_before from private.plan_catalogue where plan_key = p_plan for update;
  if v_before.plan_key is null then return jsonb_build_object('state', 'not-found'); end if;
  update private.plan_catalogue set price_kobo = coalesce(p_price_kobo, price_kobo),
      ai_sets_per_term = coalesce(p_ai_sets, ai_sets_per_term),
      active = coalesce(p_active, active), updated_at = now(), updated_by = left('operator:' || p_actor, 120)
    where plan_key = p_plan returning * into v_after;
  perform private.log_entitlement_event(null, null, 'payment.plan-changed', left('operator:' || p_actor, 120),
    jsonb_build_object('reason', p_reason, 'plan', p_plan, 'before', to_jsonb(v_before) - 'updated_by',
      'after', to_jsonb(v_after) - 'updated_by'));
  return jsonb_build_object('state', 'changed', 'plan', to_jsonb(v_after) - 'updated_by');
end;
$$;

create function public.admin_set_campus_bot_tier(p_tier text, p_session_hours integer, p_session_tokens integer,
  p_week_days integer, p_week_tokens integer, p_written_token_weight integer, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before private.campus_bot_tiers; v_after private.campus_bot_tiers;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into v_before from private.campus_bot_tiers where tier = p_tier for update;
  if v_before.tier is null then return jsonb_build_object('state', 'not-found'); end if;
  update private.campus_bot_tiers set session_hours = coalesce(p_session_hours, session_hours),
      session_tokens = coalesce(p_session_tokens, session_tokens), week_days = coalesce(p_week_days, week_days),
      week_tokens = coalesce(p_week_tokens, week_tokens),
      written_token_weight = coalesce(p_written_token_weight, written_token_weight),
      updated_at = now(), updated_by = left('operator:' || p_actor, 120)
    where tier = p_tier returning * into v_after;
  perform private.log_entitlement_event(null, null, 'payment.campus-bot-tier-changed', left('operator:' || p_actor, 120),
    jsonb_build_object('reason', p_reason, 'tier', p_tier, 'before', to_jsonb(v_before) - 'updated_by',
      'after', to_jsonb(v_after) - 'updated_by'));
  return jsonb_build_object('state', 'changed', 'tier', to_jsonb(v_after) - 'updated_by');
end;
$$;

create function public.admin_set_campus_bot_model(p_model text, p_price_weight integer, p_actor text, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before private.campus_bot_models; v_after private.campus_bot_models;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into v_before from private.campus_bot_models where model = p_model for update;
  if v_before.model is null then return jsonb_build_object('state', 'not-found'); end if;
  update private.campus_bot_models set price_weight = coalesce(p_price_weight, price_weight),
      updated_at = now(), updated_by = left('operator:' || p_actor, 120)
    where model = p_model returning * into v_after;
  perform private.log_entitlement_event(null, null, 'payment.campus-bot-model-changed', left('operator:' || p_actor, 120),
    jsonb_build_object('reason', p_reason, 'model', p_model, 'before', to_jsonb(v_before) - 'updated_by',
      'after', to_jsonb(v_after) - 'updated_by'));
  return jsonb_build_object('state', 'changed', 'model', to_jsonb(v_after) - 'updated_by');
end;
$$;

create function public.admin_set_campus_bot_request_cap(p_step text, p_read_tokens_max integer,
  p_written_tokens_max integer, p_actor text, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_before private.campus_bot_request_caps; v_after private.campus_bot_request_caps;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into v_before from private.campus_bot_request_caps where step = p_step for update;
  if v_before.step is null then return jsonb_build_object('state', 'not-found'); end if;
  update private.campus_bot_request_caps set read_tokens_max = coalesce(p_read_tokens_max, read_tokens_max),
      written_tokens_max = coalesce(p_written_tokens_max, written_tokens_max),
      updated_at = now(), updated_by = left('operator:' || p_actor, 120)
    where step = p_step returning * into v_after;
  perform private.log_entitlement_event(null, null, 'payment.campus-bot-cap-changed', left('operator:' || p_actor, 120),
    jsonb_build_object('reason', p_reason, 'step', p_step, 'before', to_jsonb(v_before) - 'updated_by',
      'after', to_jsonb(v_after) - 'updated_by'));
  return jsonb_build_object('state', 'changed', 'cap', to_jsonb(v_after) - 'updated_by');
end;
$$;

create function public.admin_payment_status(p_user_id uuid, p_order_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'policy', (select to_jsonb(p) from private.payment_policy p),
    'catalogue', (select jsonb_agg(to_jsonb(c) order by c.plan_key) from private.plan_catalogue c),
    'campus_bot_tiers', (select jsonb_agg(to_jsonb(t) order by t.tier) from private.campus_bot_tiers t),
    'campus_bot_models', (select jsonb_agg(to_jsonb(m) order by m.model) from private.campus_bot_models m),
    'campus_bot_request_caps', (select jsonb_agg(to_jsonb(c) order by c.step) from private.campus_bot_request_caps c),
    'orders', coalesce((select jsonb_agg(to_jsonb(o) - 'checkout_url' || jsonb_build_object(
        'payments', (select coalesce(jsonb_agg(to_jsonb(f) - 'result' order by f.created_at), '[]'::jsonb)
          from private.payment_fulfilments f where f.order_id = o.id),
        'refunds', (select coalesce(jsonb_agg(to_jsonb(r) - 'identity_hashes' - 'result' order by r.created_at), '[]'::jsonb)
          from private.payment_refunds r where r.order_id = o.id),
        'grants', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'part', g.plan_part, 'starts_at', g.starts_at,
            'effective_end', private.grant_effective_end(g), 'term_id', g.course_term_id, 'revoked_at', g.revoked_at)
            order by g.plan_part), '[]'::jsonb) from public.entitlement_grants g where g.order_id = o.id),
        'events', (select coalesce(jsonb_agg(to_jsonb(e) - 'body_hash' order by e.id), '[]'::jsonb)
          from private.payment_events e where e.order_id = o.id)) order by o.created_at)
      from private.payment_orders o
      where (p_order_id is not null and o.id = p_order_id) or (p_order_id is null and o.user_id = p_user_id)),
      '[]'::jsonb));
$$;

create function public.admin_payments_health() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pending_over_30_min', (select count(*) from private.payment_orders where status in ('created', 'pending')
      and created_at < clock_timestamp() - interval '30 minutes'),
    'needs_support', coalesce((select jsonb_agg(jsonb_build_object('order_id', id, 'status', status, 'flags', flags)
      order by created_at) from private.payment_orders where status in ('amount-mismatch', 'paid-duplicate',
        'unfulfilled', 'refund-failed') or cardinality(flags) > 0), '[]'::jsonb),
    'refunds_pending', (select count(*) from private.payment_refunds where status = 'pending'),
    'paid_grants_unbound', coalesce((select jsonb_agg(jsonb_build_object('order_id', order_id, 'grant_id', id,
      'part', plan_part, 'starts_at', starts_at)) from public.entitlement_grants where order_id is not null
      and revoked_at is null and course_term_id is null and starts_at < clock_timestamp() - interval '7 days'), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Students: get_my_payment_order only. Everything else is service role or private.
-- ---------------------------------------------------------------------------
revoke all on function private.payment_return_path_ok(text), private.payment_detail_ok(jsonb),
  private.payment_events_append_only(), private.log_payment_event(uuid, text, text, jsonb),
  private.grant_effective_end(public.entitlement_grants), private.payment_order_summary(private.payment_orders),
  private.payment_course_is_free(uuid), private.mark_plan_use(uuid, text, uuid, text, timestamptz),
  private.refund_assessment(private.payment_orders, private.payment_fulfilments, text[], timestamptz),
  private.refund_identity_ok(text[]),
  public.get_my_payment_order(uuid), public.create_payment_order(uuid, text, bigint, uuid, text, text),
  public.attach_payment_checkout(uuid, text, text, text, timestamptz),
  public.record_payment_event(text, text, text, uuid, text),
  public.fulfil_payment(uuid, text, text, text, bigint, text, text, timestamptz, text, text),
  public.record_payment_outcome(uuid, text, text, text), public.payment_orders_to_check(integer),
  public.refund_eligibility(uuid, text[], timestamptz, uuid),
  public.refund_order(uuid, text, uuid, text[], text, text, timestamptz, uuid),
  public.record_refund_result(uuid, text, text, text, text),
  public.admin_set_sales_open(boolean, text, text), public.admin_set_plan(text, integer, integer, boolean, text, text),
  public.admin_set_campus_bot_tier(text, integer, integer, integer, integer, integer, text, text),
  public.admin_set_campus_bot_model(text, integer, text, text),
  public.admin_set_campus_bot_request_cap(text, integer, integer, text, text),
  public.admin_payment_status(uuid, uuid), public.admin_payments_health()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_payment_order(uuid) to authenticated;
grant execute on function public.create_payment_order(uuid, text, bigint, uuid, text, text),
  public.attach_payment_checkout(uuid, text, text, text, timestamptz),
  public.record_payment_event(text, text, text, uuid, text),
  public.fulfil_payment(uuid, text, text, text, bigint, text, text, timestamptz, text, text),
  public.record_payment_outcome(uuid, text, text, text), public.payment_orders_to_check(integer),
  public.refund_eligibility(uuid, text[], timestamptz, uuid),
  public.refund_order(uuid, text, uuid, text[], text, text, timestamptz, uuid),
  public.record_refund_result(uuid, text, text, text, text),
  public.admin_set_sales_open(boolean, text, text), public.admin_set_plan(text, integer, integer, boolean, text, text),
  public.admin_set_campus_bot_tier(text, integer, integer, integer, integer, integer, text, text),
  public.admin_set_campus_bot_model(text, integer, text, text),
  public.admin_set_campus_bot_request_cap(text, integer, integer, text, text),
  public.admin_payment_status(uuid, uuid), public.admin_payments_health()
  to service_role;

comment on function public.get_my_payment_order(uuid) is
  'The signed-in student''s own order, as they see it (confirming, paid, failed, cancelled, paid-duplicate, refund-pending, refunded). Anything else is not-found.';
comment on function public.create_payment_order(uuid, text, bigint, uuid, text, text) is
  'Service role. Creates (or returns) the order for the verified session''s student: sales open, courses confirmed at the shown revision, the semester not closing and not already paid. Price and allowances are copied from the catalogue.';
comment on function public.refund_order(uuid, text, uuid, text[], text, text, timestamptz, uuid) is
  'Service role. Revokes every grant of the order and records the refund in one transaction, before any money moves. Standard: judged at p_requested_at; our-fault and duplicate: any time, never counted.';
