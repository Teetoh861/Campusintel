-- supabase/migrations/20261017100000_trial_entitlements.sql — Free tier, phone-OTP trial, Early Access and the
-- shared entitlement service (PRD v1.4 §4.5 and §4.9).
-- Full access is a time-bounded grant in public.entitlement_grants. Free courses (institutional_courses.is_free,
-- never courses.is_shared) stay readable to every live account. The gate is enforced here, inside the published
-- content read and the quiz-attempt start, so a direct API call with a student's own JWT is refused too.
-- AI allowance is derived from the same grants, so AI exhaustion never touches course access, and revoking or
-- expiring a grant ends its AI too. Early Access is granted automatically from the trusted list once the founder
-- activates the actual public launch; the planned launch date never starts a benefit.
-- Runs after 20261016140000_ai_practice_uploads.sql: it replaces that migration's admission, display and grant
-- issuing functions, retires its production allowance windows, and reuses private.ai_practice_session_user.

-- ---------------------------------------------------------------------------
-- Tunable policy (one row). Values marked PROVISIONAL await the owner's decision.
-- ---------------------------------------------------------------------------
create table private.entitlement_policy (
  singleton boolean primary key default true check (singleton),
  -- The intended launch (25 October 2026, 00:00 Lagos). Informational only: it never starts or ends a benefit.
  planned_launch_at timestamptz not null,
  -- The actual public launch, set once by the founder through admin_activate_public_launch(). While it is null
  -- no Early Access month starts, so a delayed launch costs list members nothing.
  actual_launch_at timestamptz,
  trial_days integer not null check (trial_days between 1 and 60),
  -- Each Early Access grant lasts this long from its own activation (one calendar month).
  early_access_duration interval not null
    check (early_access_duration between interval '1 day' and interval '1 year'),
  -- PROVISIONAL: eligible members are enrolled automatically until this many days after the actual launch.
  early_access_enrollment_days integer not null check (early_access_enrollment_days between 0 and 365),
  -- PROVISIONAL: whether an Early Access member may start the 7-day trial after their month ends.
  -- A trial can never be prepared or activated while Early Access is active, whatever this says.
  trial_after_early_access boolean not null,
  otp_ttl_seconds integer not null check (otp_ttl_seconds between 60 and 3600),
  otp_max_attempts integer not null check (otp_max_attempts between 1 and 10),
  otp_resend_seconds integer not null check (otp_resend_seconds between 0 and 3600),
  -- Rolling 24-hour limits. Delivered (or possibly delivered) codes count against the user and phone limits;
  -- provider-confirmed failures count only against their own, larger limit so a flaky SMS route never
  -- blocks a student permanently.
  otp_user_sends_per_day integer not null check (otp_user_sends_per_day between 1 and 50),
  otp_phone_sends_per_day integer not null check (otp_phone_sends_per_day between 1 and 50),
  otp_failed_sends_per_day integer not null check (otp_failed_sends_per_day between 1 and 100),
  -- PROVISIONAL platform-wide SMS spend guard per UTC day.
  otp_global_sends_per_day integer not null check (otp_global_sends_per_day between 0 and 1000000),
  -- Students are warned this many hours before a trial ends.
  expiry_notice_hours integer not null check (expiry_notice_hours between 1 and 168)
);
revoke all on table private.entitlement_policy from public, anon, authenticated, service_role;
insert into private.entitlement_policy values
  (true, '2026-10-25 00:00:00+01', null, 7, interval '1 month', 28, true, 600, 5, 60, 5, 5, 10, 2000, 48);

-- ---------------------------------------------------------------------------
-- Grants: every window of full access. Paid tiers later add rows with source 'paid'.
-- ---------------------------------------------------------------------------
create table public.entitlement_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source text not null check (source in ('trial', 'early_access', 'manual', 'paid')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  -- 'capped' grants ai_units for the whole window (not per day); 'uncapped' has no per-student AI cap but every
  -- global and per-day guard still applies; 'none' grants course access only.
  ai_terms text not null check (ai_terms in ('none', 'capped', 'uncapped')),
  ai_units integer check (ai_units between 0 and 1000),
  -- Non-personal provenance (challenge id, member id, future payment reference). Never a phone number.
  reference jsonb not null default '{}'::jsonb
    check (jsonb_typeof(reference) = 'object' and octet_length(reference::text) <= 2048),
  created_at timestamptz not null default now(),
  created_by text not null check (char_length(created_by) between 1 and 120),
  revoked_at timestamptz,
  revoked_by text check (char_length(revoked_by) between 1 and 120),
  revoke_reason text check (char_length(revoke_reason) between 1 and 500),
  constraint entitlement_grants_range_check check (ends_at > starts_at),
  constraint entitlement_grants_ai_check check ((ai_terms = 'capped') = (ai_units is not null)),
  constraint entitlement_grants_revoke_check check (
    (revoked_at is null) = (revoked_by is null) and (revoked_at is null) = (revoke_reason is null)),
  constraint entitlement_grants_terms_check check (
    (source = 'trial' and ai_terms = 'capped') or (source = 'early_access' and ai_terms = 'uncapped')
    or source in ('manual', 'paid'))
);
-- One trial and one Early Access grant per account, ever. A revoked grant still counts.
create unique index entitlement_grants_one_trial_idx on public.entitlement_grants (user_id) where source = 'trial';
create unique index entitlement_grants_one_early_access_idx on public.entitlement_grants (user_id)
  where source = 'early_access';
create index entitlement_grants_user_idx on public.entitlement_grants (user_id, ends_at desc);

-- A verified phone activates at most one trial. The row outlives account deletion with the account link cleared,
-- so deleting and re-registering cannot buy a second trial. Only a keyed hash is kept, never the number.
create table private.trial_phone_claims (
  phone_hash text primary key check (phone_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid unique references auth.users (id) on delete set null,
  grant_id uuid,
  claimed_at timestamptz not null default now()
);

-- One row per code sent. The code itself is never stored, only a keyed hash bound to the challenge id.
create table private.trial_otp_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  phone_hash text not null check (phone_hash ~ '^[0-9a-f]{64}$'),
  phone_hint text not null check (phone_hint ~ '^[0-9]{3}$'),
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  -- Lifecycle of the code. Only a pending code can be verified.
  status text not null default 'pending' check (status in ('pending', 'verified', 'superseded', 'expired', 'locked',
    'refused')),
  -- What the provider said. Kept apart from the lifecycle so a replaced code keeps its delivery outcome:
  -- only 'failed' (a positive rejection) is free; 'sending' (in flight or crashed) and 'unknown' count as sent.
  delivery text not null default 'sending' check (delivery in ('sending', 'sent', 'failed', 'unknown')),
  attempts integer not null default 0 check (attempts >= 0),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  settled_at timestamptz,
  constraint trial_otp_challenges_expiry_check check (expires_at > created_at)
);
create index trial_otp_challenges_user_idx on private.trial_otp_challenges (user_id, created_at desc);
create index trial_otp_challenges_phone_idx on private.trial_otp_challenges (phone_hash, created_at desc);
create index trial_otp_challenges_day_idx on private.trial_otp_challenges (created_at);

-- The trusted Early Access list. Rows come only from an operator import or manual addition, never from a student.
create table private.early_access_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email)) and char_length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  full_name text not null check (char_length(btrim(full_name)) between 1 and 200),
  phone_hash text check (phone_hash ~ '^[0-9a-f]{64}$'),
  -- When the person joined the list. Only pre-launch joins are eligible.
  joined_at timestamptz not null,
  source text not null check (source in ('import', 'manual')),
  batch text not null check (char_length(batch) between 1 and 120),
  added_at timestamptz not null default now(),
  added_by text not null check (char_length(added_by) between 1 and 120),
  -- Rows judged to be the same person point at one root; a group is claimable once.
  duplicate_of uuid references private.early_access_members (id) on delete restrict,
  excluded_at timestamptz,
  excluded_reason text check (char_length(excluded_reason) between 1 and 500),
  -- claimed_at survives account deletion, so the month cannot be claimed again with a new account.
  claimed_at timestamptz,
  claimed_by uuid unique references auth.users (id) on delete set null,
  constraint early_access_members_duplicate_check check (duplicate_of is distinct from id),
  constraint early_access_members_exclusion_check check ((excluded_at is null) = (excluded_reason is null)),
  constraint early_access_members_claim_check check (claimed_by is null or claimed_at is not null)
);
create index early_access_members_phone_idx on private.early_access_members (phone_hash);
create index early_access_members_group_idx on private.early_access_members (duplicate_of);

-- Append-only audit trail for disputes. No phone numbers, hints, codes or emails are written here.
create table private.entitlement_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  user_id uuid references auth.users (id) on delete set null,
  grant_id uuid,
  event text not null check (event ~ '^[a-z][a-z0-9_.-]{1,60}$'),
  actor text not null check (char_length(actor) between 1 and 120),
  detail jsonb not null default '{}'::jsonb
    check (jsonb_typeof(detail) = 'object' and octet_length(detail::text) <= 4096)
);
create index entitlement_events_user_idx on private.entitlement_events (user_id, occurred_at desc);

alter table public.entitlement_grants enable row level security;
alter table private.trial_phone_claims enable row level security;
alter table private.trial_otp_challenges enable row level security;
alter table private.early_access_members enable row level security;
alter table private.entitlement_events enable row level security;
-- No table privilege for any API role: students read their state through get_my_entitlement() only.
revoke all on table public.entitlement_grants, private.trial_phone_claims, private.trial_otp_challenges,
  private.early_access_members, private.entitlement_events from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Access decisions (private; evaluated inside security-definer callers).
-- ---------------------------------------------------------------------------
create function private.log_entitlement_event(p_user_id uuid, p_grant_id uuid, p_event text, p_actor text,
  p_detail jsonb default '{}'::jsonb) returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.entitlement_events (user_id, grant_id, event, actor, detail)
    values (p_user_id, p_grant_id, p_event, p_actor, coalesce(p_detail, '{}'::jsonb));
$$;

create function private.has_full_access(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.entitlement_grants
    where user_id = p_user_id and revoked_at is null and starts_at <= now() and ends_at > now());
$$;

-- Free is a property of the institutional course. A repository course no institutional course owns is not free.
create function private.can_read_course_content(p_user_id uuid, p_course_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    exists (select 1 from public.institutional_courses where repository_course_id = p_course_id and is_free)
    or exists (select 1 from public.profiles where id = p_user_id and role = 'operator')
    or private.has_full_access(p_user_id));
$$;

-- The published-content read every Course Detail, Theory and CBT surface goes through. Unchanged except for the
-- entitlement gate: a locked course raises CI403 before any payload is selected.
create or replace function public.read_published_managed_content(p_course_id uuid)
returns table (
  item_id uuid, course_id uuid, kind text, question_id uuid, source_key text,
  parent_item_id uuid, revision integer, payload jsonb
)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  v_user := private.require_live_account();
  if p_course_id is null then
    raise exception using errcode = '22023', message = 'Course identity required';
  end if;
  if not private.can_read_course_content(v_user, p_course_id) then
    raise exception using errcode = 'CI403', message = 'Course access requires an active plan';
  end if;
  return query
    select i.id, i.course_id, i.kind, i.question_id, i.source_key,
           i.parent_item_id, i.published_revision, r.payload
    from public.managed_content_items i
    join public.managed_content_revisions r
      on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = p_course_id and i.published_revision is not null
      and (i.parent_item_id is null or exists (
        select 1 from public.managed_content_items parent
        where parent.id = i.parent_item_id
          and parent.published_revision = i.published_parent_revision
      ))
    order by i.created_at, i.id;
end;
$$;

-- A new attempt pins (and later reveals) published questions, so starting one needs course access. An attempt
-- already started may still be recorded and finished after access ends: in-progress work completes gracefully.
create or replace function public.write_quiz_attempt(
  p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_question_count integer,
  p_operation text, p_expected_revision integer, p_status text, p_answers jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select user_id into v_user from auth.sessions where id = p_session_id;
  if v_user is null then return jsonb_build_object('status', 'signed-out'); end if;
  perform 1 from auth.users where id = v_user for share;
  if not found or exists (select 1 from private.account_deletion_jobs where user_id = v_user) then
    return jsonb_build_object('status', 'signed-out');
  end if;
  if p_operation = 'start' and p_course_id is not null
      and not exists (select 1 from public.quiz_attempts where id = p_attempt_id and user_id = v_user)
      and not private.can_read_course_content(v_user, p_course_id) then
    return jsonb_build_object('status', 'locked');
  end if;
  return private.write_quiz_attempt(p_session_id, p_attempt_id, p_course_id, p_question_count,
    p_operation, p_expected_revision, p_status, p_answers);
end;
$$;

-- ---------------------------------------------------------------------------
-- AI allowance derived from grants. The window that admits a request is the best currently active one among the
-- student's entitlement grants with AI terms and any server-issued ai_allowance_windows row (test or legacy).
-- Uncapped beats capped; then the later end. Future windows admit nothing. Usage is counted from the chosen
-- window's start, so a trial taken after Early Access starts with its full allowance.
-- ---------------------------------------------------------------------------
-- Which entitlement funded each AI use, fixed once at admission. Revoking, expiring or restoring a grant later never
-- moves a past generation onto another allowance: an Early Access generation stays Early Access history even if Early
-- Access is revoked, and a trial is charged only for what it funded. Rows written before this migration carry none.
alter table public.ai_usage_events
  add column funding_source text check (funding_source in ('trial', 'early_access', 'test')),
  add column funding_grant_id uuid,
  add constraint ai_usage_events_funding_check check (
    (funding_grant_id is not null) = (funding_source is not null and funding_source <> 'test'));
create index ai_usage_events_funding_idx on public.ai_usage_events (funding_grant_id) where funding_grant_id is not null;

create function private.effective_ai_window(p_user_id uuid, p_sources text[])
returns table (source text, grant_id uuid, starts_at timestamptz, ends_at timestamptz, total_units integer, active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  -- Production AI (trial, Early Access) exists only through a current, unrevoked entitlement grant. The
  -- ai_allowance_windows table holds loopback-only test grants and nothing else.
  with candidates as (
    select w.source, null::uuid as grant_id, w.starts_at, w.ends_at, w.total_units from public.ai_allowance_windows w
      where w.user_id = p_user_id and w.source = 'test' and 'test' = any (p_sources)
    union all
    select g.source, g.id, g.starts_at, g.ends_at, case when g.ai_terms = 'capped' then g.ai_units end
      from public.entitlement_grants g
      where g.user_id = p_user_id and g.revoked_at is null and g.ai_terms <> 'none' and g.source = any (p_sources)
  )
  select c.source, c.grant_id, c.starts_at, c.ends_at, c.total_units, c.starts_at <= now() and c.ends_at > now()
  from candidates c
  where c.starts_at <= now()
  order by (c.ends_at > now()) desc, (c.total_units is null) desc, c.ends_at desc
  limit 1;
$$;

create function private.ai_units_used(p_user_id uuid, p_grant_id uuid, p_since timestamptz) returns integer
language sql
stable
security definer
set search_path = ''
as $$
  -- A grant's own funded uses (consumed, or reserved and still live). A test window counts test-funded uses since it
  -- started. Nothing is inferred from time windows, so later revocation or expiry of another grant changes nothing.
  select count(*)::integer from public.ai_usage_events event, private.ai_practice_policy policy
    where event.user_id = p_user_id
      and case when p_grant_id is not null then event.funding_grant_id = p_grant_id
        else event.funding_source = 'test' and event.reserved_at >= p_since end
      and (event.state = 'consumed' or (event.state = 'reserved'
        and event.reserved_at > now() - make_interval(mins => policy.reservation_minutes)));
$$;

create or replace function private.ai_allowance_admission(p_user_id uuid, p_accepted_sources text[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window record;
  v_used integer;
begin
  if coalesce(cardinality(p_accepted_sources), 0) = 0
      or not p_accepted_sources <@ array['trial', 'early_access', 'test'] then
    raise exception 'Invalid accepted grant sources' using errcode = '22023';
  end if;
  select * into v_window from private.effective_ai_window(p_user_id, p_accepted_sources);
  if not found then return jsonb_build_object('state', 'not-entitled'); end if;
  if not v_window.active then
    return jsonb_build_object('state', 'allowance-expired', 'total', v_window.total_units, 'ends_at', v_window.ends_at);
  end if;
  v_used := private.ai_units_used(p_user_id, v_window.grant_id, v_window.starts_at);
  if v_window.total_units is not null and v_used >= v_window.total_units then
    return jsonb_build_object('state', 'allowance-exhausted', 'total', v_window.total_units, 'used', v_used,
      'ends_at', v_window.ends_at);
  end if;
  -- source and grant_id name the funding grant; admission records them on the reservation.
  return jsonb_build_object('state', 'active', 'total', v_window.total_units, 'used', v_used,
    'ends_at', v_window.ends_at, 'source', v_window.source, 'grant_id', v_window.grant_id);
end;
$$;

-- Generation admission from 20261016140000_ai_practice_uploads.sql, unchanged except that the reservation records which
-- grant funds it.
create or replace function public.begin_ai_practice_generation(
  p_session_id uuid, p_request_id uuid, p_document_id uuid, p_accepted_sources text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.ai_practice_policy;
  v_allowance jsonb;
  v_existing public.ai_practice_generations;
  v_document public.ai_practice_documents;
  v_today integer;
  v_event_id uuid;
  v_generation_id uuid;
begin
  if p_request_id is null or p_document_id is null
      or coalesce(cardinality(p_accepted_sources), 0) = 0
      or not p_accepted_sources <@ array['trial', 'early_access', 'test'] then
    raise exception 'Invalid generation request' using errcode = '22023';
  end if;
  -- Admission holds the account share lock until commit, so scheduling, logout and purge cannot interleave.
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  -- One student's admissions are serialized; replays and concurrent clicks see a consistent ledger.
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user_id::text, 0));
  -- Crashed requests are closed before the replay check, so replaying one reports its failure instead of
  -- reporting it as running forever.
  perform private.release_abandoned_ai_generations(v_user_id, v_policy.reservation_minutes);

  select * into v_existing from public.ai_practice_generations
    where user_id = v_user_id and request_id = p_request_id;
  if found then
    if v_existing.document_id is distinct from p_document_id then
      return jsonb_build_object('state', 'request-conflict');
    end if;
    return jsonb_build_object('state', 'existing', 'generation_id', v_existing.id, 'status', v_existing.status);
  end if;

  -- Fail closed: only a grant from a source this deployment trusts admits a request. Nothing here issues one.
  v_allowance := private.ai_allowance_admission(v_user_id, p_accepted_sources);
  if v_allowance ->> 'state' = 'not-entitled' then return v_allowance; end if;

  select * into v_document from public.ai_practice_documents
    where id = p_document_id and user_id = v_user_id;
  if not found or v_document.status <> 'ready' or v_document.expires_at <= now() then
    return jsonb_build_object('state', 'document-unavailable');
  end if;

  if exists (select 1 from public.ai_practice_generations where user_id = v_user_id and status = 'running') then
    return jsonb_build_object('state', 'busy');
  end if;
  if v_allowance ->> 'state' <> 'active' then return v_allowance; end if;

  perform pg_advisory_xact_lock(hashtextextended('ai-practice-global-day', 0));
  select count(*) into v_today from public.ai_usage_events
    where reserved_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if v_today >= v_policy.global_daily_generations then
    return jsonb_build_object('state', 'capacity');
  end if;

  -- The reservation records the grant that funds it (unchanged from 20261016140000 apart from these two columns).
  insert into public.ai_usage_events (user_id, feature, funding_source, funding_grant_id)
    values (v_user_id, 'upload_practice', v_allowance ->> 'source', (v_allowance ->> 'grant_id')::uuid)
    returning id into v_event_id;
  insert into public.ai_practice_generations (user_id, request_id, document_id, institutional_course_id,
    usage_event_id, expires_at)
  values (v_user_id, p_request_id, p_document_id, v_document.institutional_course_id, v_event_id,
    now() + make_interval(days => v_policy.set_retention_days))
  returning id into v_generation_id;
  return jsonb_build_object('state', 'started', 'generation_id', v_generation_id,
    'total', (v_allowance ->> 'total')::integer, 'used', (v_allowance ->> 'used')::integer + 1,
    'ends_at', v_allowance -> 'ends_at');
end;
$$;

-- Display only. 'total' is null for an uncapped (Early Access) window.
create or replace function public.get_my_ai_allowance() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_window record;
begin
  if v_user_id is null or not private.has_live_account_session() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into v_window from private.effective_ai_window(v_user_id, array['trial', 'early_access', 'test']);
  if not found then
    return jsonb_build_object('state', 'not-entitled', 'total', 0, 'used', 0);
  end if;
  return jsonb_build_object('state', case when v_window.active then 'active' else 'expired' end,
    'source', v_window.source, 'total', v_window.total_units,
    'used', private.ai_units_used(v_user_id, v_window.grant_id, v_window.starts_at), 'ends_at', v_window.ends_at);
end;
$$;

-- Legacy production windows. Before this migration only issue_ai_allowance_grant() could create a trial or Early
-- Access window, with no phone verification or trusted list behind it. They are retired here, audited, and the
-- table is restricted to loopback test grants so no window can outlive or bypass an entitlement grant.
create function private.retire_legacy_ai_windows(p_actor text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with retired as (
    delete from public.ai_allowance_windows where source <> 'test'
    returning user_id, source, starts_at, ends_at, total_units
  )
  insert into private.entitlement_events (user_id, event, actor, detail)
    select user_id, 'legacy.ai-window-retired', p_actor,
      jsonb_build_object('source', source, 'starts_at', starts_at, 'ends_at', ends_at, 'total_units', total_units)
    from retired;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function private.retire_legacy_ai_windows(text) from public, anon, authenticated, service_role;
select private.retire_legacy_ai_windows('migration:20261017100000');
alter table public.ai_allowance_windows drop constraint ai_allowance_windows_source_check;
alter table public.ai_allowance_windows add constraint ai_allowance_windows_source_check check (source = 'test');

-- Only controlled test grants are issued here now. Trial and Early Access AI come from entitlement grants.
create or replace function public.issue_ai_allowance_grant(
  p_user_id uuid, p_source text, p_units integer default null, p_days integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window public.ai_allowance_windows;
begin
  if p_user_id is null or p_source is distinct from 'test' then
    raise exception 'Only test AI grants are issued directly' using errcode = '22023';
  end if;
  if p_units is null or p_days is null or p_units not between 0 and 1000 or p_days not between 1 and 365 then
    raise exception 'Invalid AI allowance grant terms' using errcode = '22023';
  end if;
  insert into public.ai_allowance_windows (user_id, source, starts_at, ends_at, total_units)
    values (p_user_id, p_source, now(), now() + make_interval(days => p_days), p_units)
    on conflict (user_id) do nothing
    returning * into v_window;
  if found then
    return jsonb_build_object('state', 'issued', 'source', v_window.source, 'total', v_window.total_units,
      'ends_at', v_window.ends_at);
  end if;
  select * into strict v_window from public.ai_allowance_windows where user_id = p_user_id;
  return jsonb_build_object('state', 'existing', 'source', v_window.source, 'total', v_window.total_units,
    'ends_at', v_window.ends_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Student summary (read only).
-- ---------------------------------------------------------------------------
create function public.get_my_entitlement() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_policy private.entitlement_policy;
  v_access public.entitlement_grants;
  v_trial public.entitlement_grants;
  v_early_grant public.entitlement_grants;
  v_early jsonb;
  v_trial_status text;
  v_challenge private.trial_otp_challenges;
  v_otp jsonb := null;
begin
  if v_user_id is null or not private.has_live_account_session() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  -- Self-heal: an eligible member whose grant was missed (a failed confirmation trigger, say) is enrolled on the
  -- first plan read. Idempotent: an existing grant is never reset or extended.
  v_early := private.early_access_status(v_user_id);
  if v_early->>'status' = 'eligible' then
    perform private.reconcile_early_access(v_user_id, 'system:plan-read');
    v_early := private.early_access_status(v_user_id);
  end if;
  select * into strict v_policy from private.entitlement_policy;
  select * into v_access from public.entitlement_grants
    where user_id = v_user_id and revoked_at is null and starts_at <= now() and ends_at > now()
    order by ends_at desc limit 1;
  select * into v_trial from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  select * into v_early_grant from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;

  v_trial_status := case
    when v_trial.id is not null then
      case when v_trial.revoked_at is null and v_trial.ends_at > now() then 'active' else 'ended' end
    when v_early_grant.id is not null and v_early_grant.ends_at > now() then
      case when v_policy.trial_after_early_access then 'after-early-access' else 'not-offered' end
    when v_early_grant.id is not null and not v_policy.trial_after_early_access then 'not-offered'
    else 'available' end;

  if v_trial_status = 'available' then
    select * into v_challenge from private.trial_otp_challenges
      where user_id = v_user_id and status = 'pending' and expires_at > now()
      order by created_at desc limit 1;
    if v_challenge.id is not null then
      v_otp := jsonb_build_object('challenge_id', v_challenge.id, 'phone_hint', v_challenge.phone_hint,
        'expires_at', v_challenge.expires_at,
        'delivery', case when v_challenge.delivery = 'failed' then 'failed' else 'sent' end,
        'resend_at', case when v_challenge.delivery = 'failed' then v_challenge.created_at
          else v_challenge.created_at + make_interval(secs => v_policy.otp_resend_seconds) end);
    end if;
  end if;

  return jsonb_build_object(
    'now', now(),
    'planned_launch_at', v_policy.planned_launch_at,
    'actual_launch_at', v_policy.actual_launch_at,
    'trial_days', v_policy.trial_days,
    'expiry_notice_hours', v_policy.expiry_notice_hours,
    'tier', case when v_access.id is null then 'free' else 'full' end,
    'access', case when v_access.id is null then null
      else jsonb_build_object('source', v_access.source, 'ends_at', v_access.ends_at) end,
    'trial', jsonb_build_object('status', v_trial_status, 'starts_at', v_trial.starts_at, 'ends_at', v_trial.ends_at,
      'available_from', case when v_trial_status = 'after-early-access' then v_early_grant.ends_at end),
    'early_access', jsonb_build_object(
      'status', case when v_early->>'status' = 'eligible' then 'pending' else v_early->>'status' end,
      'starts_at', v_early->'starts_at', 'ends_at', v_early->'ends_at',
      'enrollment_closes_at', case when v_policy.actual_launch_at is null then null
        else v_policy.actual_launch_at + make_interval(days => v_policy.early_access_enrollment_days) end),
    'otp', v_otp);
end;
$$;

-- ---------------------------------------------------------------------------
-- Trial activation (service role; identity from the verified session id, as for AI practice).
-- Lock order everywhere: account row share lock, then the per-account advisory lock, then the per-phone one.
-- ---------------------------------------------------------------------------
create function public.prepare_trial_otp(
  p_session_id uuid, p_challenge_id uuid, p_phone_hash text, p_phone_hint text, p_code_hash text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
  v_last private.trial_otp_challenges;
  v_early public.entitlement_grants;
  v_retry timestamptz;
  v_count integer;
begin
  if p_challenge_id is null or p_phone_hash is null or p_phone_hash !~ '^[0-9a-f]{64}$'
      or p_phone_hint is null or p_phone_hint !~ '^[0-9]{3}$'
      or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid trial code request' using errcode = '22023';
  end if;
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.entitlement_policy;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('entitlement-phone:' || p_phone_hash, 0));

  if exists (select 1 from public.entitlement_grants where user_id = v_user_id and source = 'trial') then
    return jsonb_build_object('state', 'already-activated');
  end if;
  -- Conservative overlap rule: no trial while Early Access is active, so neither the trial nor its AI allowance is
  -- spent during the free month. The same account lock serializes this with Early Access enrollment.
  select * into v_early from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;
  -- Not ended is enough: an enrollment that won the account lock may carry a start a moment after this
  -- transaction's now(), and must still block.
  if v_early.id is not null and v_early.ends_at > now() then
    return jsonb_build_object('state', 'early-access-active', 'available_from', v_early.ends_at);
  end if;
  if v_early.id is not null and not v_policy.trial_after_early_access then
    return jsonb_build_object('state', 'trial-not-offered');
  end if;
  -- Refuse before spending an SMS on a number that can never activate.
  if exists (select 1 from private.trial_phone_claims where phone_hash = p_phone_hash) then
    perform private.log_entitlement_event(v_user_id, null, 'trial.phone-refused', 'student', '{}'::jsonb);
    return jsonb_build_object('state', 'phone-already-used');
  end if;

  select * into v_last from private.trial_otp_challenges where user_id = v_user_id
    order by created_at desc limit 1;
  if v_last.id is not null and v_last.status = 'pending' and v_last.delivery <> 'failed'
      and v_last.created_at + make_interval(secs => v_policy.otp_resend_seconds) > now() then
    return jsonb_build_object('state', 'cooldown',
      'retry_at', v_last.created_at + make_interval(secs => v_policy.otp_resend_seconds));
  end if;

  select count(*) into v_count from private.trial_otp_challenges
    where user_id = v_user_id and delivery <> 'failed' and created_at > now() - interval '1 day';
  if v_count >= v_policy.otp_user_sends_per_day then
    select min(created_at) + interval '1 day' into v_retry from (select created_at from private.trial_otp_challenges
      where user_id = v_user_id and delivery <> 'failed' and created_at > now() - interval '1 day'
      order by created_at desc limit v_policy.otp_user_sends_per_day) recent;
    return jsonb_build_object('state', 'rate-limited', 'retry_at', v_retry);
  end if;
  select count(*) into v_count from private.trial_otp_challenges
    where user_id = v_user_id and delivery = 'failed' and created_at > now() - interval '1 day';
  if v_count >= v_policy.otp_failed_sends_per_day then
    return jsonb_build_object('state', 'rate-limited', 'retry_at', now() + interval '1 hour');
  end if;
  -- Across every account, so one number cannot be flooded with codes.
  select count(*) into v_count from private.trial_otp_challenges
    where phone_hash = p_phone_hash and delivery <> 'failed' and created_at > now() - interval '1 day';
  if v_count >= v_policy.otp_phone_sends_per_day then
    return jsonb_build_object('state', 'rate-limited', 'retry_at', now() + interval '1 hour');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-otp-global-day', 0));
  select count(*) into v_count from private.trial_otp_challenges
    where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if v_count >= v_policy.otp_global_sends_per_day then
    return jsonb_build_object('state', 'capacity');
  end if;

  -- A new code replaces every earlier one, so an older code can never be replayed.
  update private.trial_otp_challenges set status = 'superseded', settled_at = now()
    where user_id = v_user_id and status = 'pending';
  insert into private.trial_otp_challenges (id, user_id, phone_hash, phone_hint, code_hash, expires_at)
    values (p_challenge_id, v_user_id, p_phone_hash, p_phone_hint, p_code_hash,
      now() + make_interval(secs => v_policy.otp_ttl_seconds));
  return jsonb_build_object('state', 'ready', 'user_id', v_user_id,
    'expires_at', now() + make_interval(secs => v_policy.otp_ttl_seconds),
    'resend_at', now() + make_interval(secs => v_policy.otp_resend_seconds));
end;
$$;

-- Record the provider's answer. Needs no live session: a logout during the send must still settle the row.
create function public.record_trial_otp_delivery(p_user_id uuid, p_challenge_id uuid, p_delivery text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_delivery is null or p_delivery not in ('sent', 'failed', 'unknown') then
    raise exception 'Invalid delivery outcome' using errcode = '22023';
  end if;
  update private.trial_otp_challenges set delivery = p_delivery
    where id = p_challenge_id and user_id = p_user_id and delivery = 'sending';
  if not found then return false; end if;
  perform private.log_entitlement_event(p_user_id, null,
    case when p_delivery = 'failed' then 'trial.code-failed' else 'trial.code-sent' end, 'system',
    jsonb_build_object('challenge_id', p_challenge_id, 'delivery', p_delivery));
  return true;
end;
$$;

create function public.verify_trial_otp(p_session_id uuid, p_challenge_id uuid, p_code_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
  v_ai_units integer;
  v_challenge private.trial_otp_challenges;
  v_grant public.entitlement_grants;
  v_early public.entitlement_grants;
begin
  if p_challenge_id is null or p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid trial code' using errcode = '22023';
  end if;
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.entitlement_policy;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user_id::text, 0));

  -- Checked before the code, so a refused attempt never counts. Conservative overlap rule: no trial while Early Access is active, so neither the trial nor its AI allowance is
  -- spent during the free month. The same account lock serializes this with Early Access enrollment.
  select * into v_early from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;
  -- Not ended is enough: an enrollment that won the account lock may carry a start a moment after this
  -- transaction's now(), and must still block.
  if v_early.id is not null and v_early.ends_at > now() then
    return jsonb_build_object('state', 'early-access-active', 'available_from', v_early.ends_at);
  end if;
  if v_early.id is not null and not v_policy.trial_after_early_access then
    return jsonb_build_object('state', 'trial-not-offered');
  end if;

  select * into v_challenge from private.trial_otp_challenges
    where id = p_challenge_id and user_id = v_user_id for update;
  if not found then return jsonb_build_object('state', 'invalid'); end if;
  -- Replays of a used, replaced or locked code are refused without counting another attempt.
  if v_challenge.status = 'verified' then return jsonb_build_object('state', 'already-used'); end if;
  if v_challenge.status in ('superseded', 'refused') then return jsonb_build_object('state', 'superseded'); end if;
  if v_challenge.status = 'locked' then return jsonb_build_object('state', 'too-many-attempts'); end if;
  if v_challenge.status = 'expired' or v_challenge.expires_at <= now() then
    update private.trial_otp_challenges set status = 'expired', settled_at = coalesce(settled_at, now())
      where id = v_challenge.id;
    return jsonb_build_object('state', 'expired');
  end if;

  update private.trial_otp_challenges set attempts = attempts + 1 where id = v_challenge.id
    returning * into v_challenge;
  if v_challenge.code_hash <> p_code_hash then
    if v_challenge.attempts >= v_policy.otp_max_attempts then
      update private.trial_otp_challenges set status = 'locked', settled_at = now() where id = v_challenge.id;
      perform private.log_entitlement_event(v_user_id, null, 'trial.code-locked', 'student',
        jsonb_build_object('challenge_id', v_challenge.id));
      return jsonb_build_object('state', 'too-many-attempts');
    end if;
    return jsonb_build_object('state', 'incorrect', 'attempts_left', v_policy.otp_max_attempts - v_challenge.attempts);
  end if;

  -- A correct code. The phone lock serializes every account racing to activate with the same number.
  perform pg_advisory_xact_lock(hashtextextended('entitlement-phone:' || v_challenge.phone_hash, 0));
  if exists (select 1 from public.entitlement_grants where user_id = v_user_id and source = 'trial') then
    update private.trial_otp_challenges set status = 'refused', settled_at = now() where id = v_challenge.id;
    return jsonb_build_object('state', 'already-activated');
  end if;
  if exists (select 1 from private.trial_phone_claims where phone_hash = v_challenge.phone_hash) then
    update private.trial_otp_challenges set status = 'refused', settled_at = now() where id = v_challenge.id;
    perform private.log_entitlement_event(v_user_id, null, 'trial.phone-refused', 'student',
      jsonb_build_object('challenge_id', v_challenge.id));
    return jsonb_build_object('state', 'phone-already-used');
  end if;

  -- The AI allowance is fixed at activation; later policy edits never change a running trial.
  select trial_units into strict v_ai_units from private.ai_practice_policy;
  insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, ai_units, reference, created_by)
    values (v_user_id, 'trial', now(), now() + make_interval(days => v_policy.trial_days), 'capped', v_ai_units,
      jsonb_build_object('challenge_id', v_challenge.id), 'student')
    returning * into v_grant;
  insert into private.trial_phone_claims (phone_hash, user_id, grant_id)
    values (v_challenge.phone_hash, v_user_id, v_grant.id);
  update private.trial_otp_challenges set status = 'verified', settled_at = now() where id = v_challenge.id;
  update private.trial_otp_challenges set status = 'superseded', settled_at = now()
    where user_id = v_user_id and id <> v_challenge.id and status = 'pending';
  perform private.log_entitlement_event(v_user_id, v_grant.id, 'trial.activated', 'student',
    jsonb_build_object('ends_at', v_grant.ends_at, 'ai_units', v_ai_units));
  return jsonb_build_object('state', 'activated', 'ends_at', v_grant.ends_at, 'ai_units', v_ai_units);
end;
$$;

-- ---------------------------------------------------------------------------
-- Early Access (PRD 4.9), automatic. Eligibility is membership of the trusted list matched to the account's
-- confirmed email. The grant is made exactly once: for existing accounts when the founder activates the actual
-- public launch, and afterwards (inside the enrollment window) when an eligible account is confirmed, changes
-- email, is imported or corrected on the list, or reads its plan. No claim, no phone code, no AI cap.
-- ---------------------------------------------------------------------------
create function private.early_access_status(p_user_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.entitlement_policy;
  v_grant public.entitlement_grants;
  v_email text;
  v_member private.early_access_members;
  v_root uuid;
begin
  select * into strict v_policy from private.entitlement_policy;
  select * into v_grant from public.entitlement_grants where user_id = p_user_id and source = 'early_access';
  if v_grant.id is not null then
    return jsonb_build_object('status', case when v_grant.revoked_at is not null or v_grant.ends_at <= now() then 'ended'
      else 'active' end, 'grant_id', v_grant.id, 'starts_at', v_grant.starts_at, 'ends_at', v_grant.ends_at);
  end if;
  -- Only a confirmed email proves list membership; an unconfirmed or self-declared address never does.
  select lower(btrim(email)) into v_email from auth.users where id = p_user_id and email_confirmed_at is not null;
  if v_email is not null then
    select * into v_member from private.early_access_members where email = v_email;
  end if;
  if v_member.id is null then return jsonb_build_object('status', 'not-listed'); end if;
  v_root := coalesce(v_member.duplicate_of, v_member.id);
  -- Excluded, already used (possibly by a since-deleted account), joined after launch, or another identity in the
  -- same duplicate group already enrolled.
  if v_member.excluded_at is not null or v_member.claimed_at is not null
      or (v_policy.actual_launch_at is not null and v_member.joined_at >= v_policy.actual_launch_at)
      or exists (select 1 from private.early_access_members other
        where coalesce(other.duplicate_of, other.id) = v_root and other.claimed_at is not null) then
    return jsonb_build_object('status', 'unavailable', 'member_id', v_member.id);
  end if;
  -- The planned date is never substituted: without an actual launch nothing starts.
  if v_policy.actual_launch_at is null or v_policy.actual_launch_at > now() then
    return jsonb_build_object('status', 'awaiting-launch', 'member_id', v_member.id);
  end if;
  if now() > v_policy.actual_launch_at + make_interval(days => v_policy.early_access_enrollment_days) then
    return jsonb_build_object('status', 'enrollment-closed', 'member_id', v_member.id);
  end if;
  return jsonb_build_object('status', 'eligible', 'member_id', v_member.id, 'root', v_root);
end;
$$;

-- Lock hierarchy for every Early Access path (reconciliation, import, member changes, grant restore, launch, sweeps,
-- confirmation). A transaction only ever acquires locks further down this list than any it already holds:
--   1. policy row (share; launch activation holds it for update);
--   2. account rows, then account advisory locks, all in ascending account id, all before anything below. A sweep
--      therefore locks every account it will reconcile before reconciling any;
--   3. import identity advisory locks: email, then phone;
--   4. the regroup lock: exclusive for the only operations that move members between groups (mark-duplicate,
--      clear-duplicate), shared for everything else that locks groups. Group roots cannot move while it is held, so
--      a group lock never has to be followed by another, unexpected one;
--   5. duplicate-group advisory locks, in ascending root id;
--   6. member rows, then grant rows.
-- With one total order no cycle can form. The single exception is the confirmation trigger, which enters holding its own
-- account row (Auth just updated it) and continues from the policy row: only launch activation holds the policy row
-- exclusively, and it skips account rows held by an in-flight confirmation instead of waiting for them; that
-- confirmation then enrolls itself once the launch commits.

-- Account rows, then account advisory locks, for every account with this email (confirmed or not), so a confirmation or
-- email change racing an operator change waits for it, or it for them. Returns the accounts locked: an account that
-- becomes visible later (a new signup or an email change) is not covered and must not be locked further down.
create function private.lock_early_access_accounts(p_email text) returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account uuid;
  v_locked uuid[] := '{}';
begin
  for v_account in select id from auth.users where lower(btrim(email)) = p_email order by id for share loop
    perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_account::text, 0));
    v_locked := v_locked || v_account;
  end loop;
  return v_locked;
end;
$$;

-- Lock the duplicate groups the given members currently belong to (plus any extra roots), lowest id first, and return
-- once a re-read shows no member has moved: a member's group only changes under its current group lock.
create function private.lock_early_access_groups(p_emails text[], p_extra_roots uuid[] default '{}',
  p_regroup boolean default false) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_root uuid;
begin
  -- Level 4: only regrouping takes this exclusively, so the roots read next cannot change until this transaction ends.
  if p_regroup then
    perform pg_advisory_xact_lock(hashtextextended('entitlement-early-access-regroup', 0));
  else
    perform pg_advisory_xact_lock_shared(hashtextextended('entitlement-early-access-regroup', 0));
  end if;
  -- Level 5: every group involved, lowest root first.
  for v_root in select distinct root from (
      select coalesce(duplicate_of, id) as root from private.early_access_members where email = any (p_emails)
      union select unnest(p_extra_roots)) roots where root is not null order by root loop
    perform pg_advisory_xact_lock(hashtextextended('entitlement-early-access:' || v_root::text, 0));
  end loop;
end;
$$;

-- Enroll one account if, and only if, it is eligible now. Exactly-once: the account lock, the duplicate-group lock,
-- a re-decision under both, and the unique indexes. The month runs from this activation for one calendar month.
create function private.reconcile_early_access(p_user_id uuid, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status jsonb;
  v_policy private.entitlement_policy;
  v_grant public.entitlement_grants;
begin
  -- Lock-free answer for states a launch cannot change.
  v_status := private.early_access_status(p_user_id);
  if v_status->>'status' in ('not-listed', 'active', 'ended') then return v_status; end if;
  -- Waits for an in-flight launch activation, then sees its committed launch time.
  select * into strict v_policy from private.entitlement_policy for share;
  perform 1 from auth.users where id = p_user_id and email_confirmed_at is not null for share;
  if not found then return jsonb_build_object('status', 'not-listed'); end if;
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    return jsonb_build_object('status', 'account-restricted');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || p_user_id::text, 0));
  -- Level 4 (shared): no member can change group from here on, so the root read below is final.
  perform pg_advisory_xact_lock_shared(hashtextextended('entitlement-early-access-regroup', 0));
  v_status := private.early_access_status(p_user_id);
  if v_status->>'status' <> 'eligible' then return v_status; end if;
  -- Level 5: the group, then decide again under it (a reconciliation or import may have just enrolled the group).
  perform pg_advisory_xact_lock(hashtextextended('entitlement-early-access:' || (v_status->>'root'), 0));
  v_status := private.early_access_status(p_user_id);
  if v_status->>'status' <> 'eligible' then return v_status; end if;

  insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, reference, created_by)
    values (p_user_id, 'early_access', now(), now() + v_policy.early_access_duration, 'uncapped',
      jsonb_build_object('member_id', v_status->>'member_id'), p_actor)
    returning * into v_grant;
  update private.early_access_members set claimed_at = now(), claimed_by = p_user_id
    where id = (v_status->>'member_id')::uuid;
  perform private.log_entitlement_event(p_user_id, v_grant.id, 'early-access.granted', p_actor,
    jsonb_build_object('member_id', v_status->>'member_id', 'ends_at', v_grant.ends_at));
  return jsonb_build_object('status', 'granted', 'grant_id', v_grant.id, 'starts_at', v_grant.starts_at,
    'ends_at', v_grant.ends_at);
end;
$$;

-- The accounts a sweep can still enroll: confirmed, on an unused and included list row joined before the actual launch,
-- in a group nobody has used, not scheduled for deletion and not already enrolled, while the window is open. Sweep
-- batches and the remaining count share this one predicate, so accounts reconciliation would refuse can neither fill
-- a batch ahead of eligible ones nor keep "remaining" above zero once nothing enrollable is left.
create function private.early_access_sweep_candidates()
returns table (account_id uuid, joined_at timestamptz, added_at timestamptz, member_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select account.id, member.joined_at, member.added_at, member.id
  from private.entitlement_policy policy
  join private.early_access_members member on member.joined_at < policy.actual_launch_at
  join auth.users account on lower(btrim(account.email)) = member.email and account.email_confirmed_at is not null
  where policy.actual_launch_at <= now()
    and now() <= policy.actual_launch_at + make_interval(days => policy.early_access_enrollment_days)
    and member.excluded_at is null and member.claimed_at is null
    and not exists (select 1 from private.early_access_members other
      where coalesce(other.duplicate_of, other.id) = coalesce(member.duplicate_of, member.id) and other.claimed_at is not null)
    and not exists (select 1 from private.account_deletion_jobs job where job.user_id = account.id)
    and not exists (select 1 from public.entitlement_grants grant_row
      where grant_row.user_id = account.id and grant_row.source = 'early_access')
$$;

-- Enrollable accounts, earliest join first so a duplicate group's earliest identity wins. An account row locked by an
-- in-flight confirmation is skipped rather than waited for: that transaction's own trigger enrolls it once the launch
-- commits, and waiting here could deadlock with it. It is reported as deferred so the operator tool sweeps again.
create function private.reconcile_all_early_access(p_actor text, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch uuid[];
  v_locked uuid[] := '{}';
  v_user uuid;
  v_granted integer := 0;
  v_remaining integer;
begin
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'Invalid sweep batch size' using errcode = '22023';
  end if;
  select coalesce(array_agg(account_id order by joined_at, added_at, member_id), '{}') into v_batch from (
    select * from private.early_access_sweep_candidates() order by joined_at, added_at, member_id limit p_limit) batch;
  -- Phase 1 (level 2): every account this batch will touch, in ascending id, before any group lock. An account row
  -- held by an in-flight confirmation is skipped: its own trigger enrolls it, and waiting could invert the order.
  for v_user in select unnest(v_batch) order by 1 loop
    perform 1 from auth.users where id = v_user for share skip locked;
    if found then
      perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user::text, 0));
      v_locked := v_locked || v_user;
    end if;
  end loop;
  -- Phase 2 (levels 4-6): reconcile in join order. Every account lock reconciliation asks for is already held, so a
  -- group lock is never followed by an account lock.
  foreach v_user in array v_batch loop
    if v_user = any (v_locked) and private.reconcile_early_access(v_user, p_actor)->>'status' = 'granted' then
      v_granted := v_granted + 1;
    end if;
  end loop;
  select count(*) into v_remaining from private.early_access_sweep_candidates();
  return jsonb_build_object('granted', v_granted, 'remaining', v_remaining,
    'deferred', cardinality(v_batch) - cardinality(v_locked));
end;
$$;

-- A confirmed (or newly re-confirmed) email is reconciled at once. Auth must never fail because of this: an error
-- is recorded and the next plan read reconciles again.
create function private.reconcile_early_access_on_confirmation() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state text;
begin
  if new.email_confirmed_at is not null and (tg_op = 'INSERT' or old.email_confirmed_at is null
      or old.email is distinct from new.email) then
    begin
      perform private.reconcile_early_access(new.id, 'system:confirmation');
    exception when others then
      get stacked diagnostics v_state = returned_sqlstate;
      perform private.log_entitlement_event(new.id, null, 'early-access.reconcile-failed', 'system:confirmation',
        jsonb_build_object('sqlstate', v_state));
    end;
  end if;
  return null;
end;
$$;
create trigger early_access_reconcile_on_confirmation after insert or update of email_confirmed_at, email on auth.users
  for each row execute function private.reconcile_early_access_on_confirmation();

-- The founder's one-time switch. Records the actual launch, then enrolls every eligible confirmed account in the
-- same transaction: their months start now, never at the planned date.
create function public.admin_activate_public_launch(p_actor text, p_reason text, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.entitlement_policy;
  v_sweep jsonb;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into strict v_policy from private.entitlement_policy for update;
  if v_policy.actual_launch_at is not null then
    return jsonb_build_object('state', 'already-launched', 'actual_launch_at', v_policy.actual_launch_at);
  end if;
  update private.entitlement_policy set actual_launch_at = now();
  perform private.log_entitlement_event(null, null, 'operator.public-launch', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'actual_launch_at', now(), 'planned_launch_at', v_policy.planned_launch_at));
  -- The first batch is enrolled now; the operator tool keeps sweeping until nothing remains, and every eligible
  -- account also enrolls itself on its next plan read. Batches keep each transaction's lock set bounded.
  v_sweep := private.reconcile_all_early_access('operator:' || p_actor, p_limit);
  return jsonb_build_object('state', 'launched', 'actual_launch_at', now(), 'granted', v_sweep->'granted',
    'remaining', v_sweep->'remaining', 'deferred', v_sweep->'deferred');
end;
$$;

-- Recovery sweep (idempotent): enrolls anyone eligible who is not yet enrolled.
create function public.admin_reconcile_early_access(p_actor text, p_reason text, p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sweep jsonb;
begin
  perform private.require_operator_note(p_actor, p_reason);
  -- Level 1 first, as everywhere.
  perform 1 from private.entitlement_policy for share;
  v_sweep := private.reconcile_all_early_access('operator:' || p_actor, p_limit);
  perform private.log_entitlement_event(null, null, 'operator.early-access-reconcile', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'granted', v_sweep->'granted', 'remaining', v_sweep->'remaining',
      'deferred', v_sweep->'deferred'));
  return jsonb_build_object('state', 'reconciled', 'granted', v_sweep->'granted', 'remaining', v_sweep->'remaining',
    'deferred', v_sweep->'deferred');
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator recovery (service role, through scripts/entitlements/ops.cjs). Every change names an actor and a
-- reason and is written to the audit trail in the same transaction.
-- ---------------------------------------------------------------------------
create function private.require_operator_note(p_actor text, p_reason text) returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_actor is null or char_length(btrim(p_actor)) not between 1 and 120
      or p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'An operator name and a reason are required' using errcode = '22023';
  end if;
end;
$$;

create function public.admin_entitlement_status(p_user_id uuid) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'full_access', private.has_full_access(p_user_id),
    'grants', coalesce((select jsonb_agg(jsonb_build_object('id', g.id, 'source', g.source, 'starts_at', g.starts_at,
      'ends_at', g.ends_at, 'ai_terms', g.ai_terms, 'ai_units', g.ai_units, 'revoked_at', g.revoked_at,
      'revoke_reason', g.revoke_reason, 'created_by', g.created_by) order by g.created_at)
      from public.entitlement_grants g where g.user_id = p_user_id), '[]'::jsonb),
    'trial_phone_claimed', exists (select 1 from private.trial_phone_claims where user_id = p_user_id),
    'otp_challenges', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status,
      'attempts', c.attempts, 'created_at', c.created_at) order by c.created_at desc)
      from (select * from private.trial_otp_challenges where user_id = p_user_id
        order by created_at desc limit 20) c), '[]'::jsonb),
    'ai_allowance', private.ai_allowance_admission(p_user_id, array['trial', 'early_access']),
    'early_access', private.early_access_status(p_user_id),
    'events', coalesce((select jsonb_agg(jsonb_build_object('at', e.occurred_at, 'event', e.event, 'actor', e.actor,
      'grant_id', e.grant_id, 'detail', e.detail) order by e.occurred_at desc)
      from (select * from private.entitlement_events where user_id = p_user_id
        order by occurred_at desc limit 50) e), '[]'::jsonb));
$$;

create function public.admin_grant_access(p_user_id uuid, p_days integer, p_actor text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.entitlement_grants;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_days is null or p_days not between 1 and 366 then
    raise exception 'Invalid grant length' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id for share;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, reference, created_by)
    values (p_user_id, 'manual', now(), now() + make_interval(days => p_days), 'none',
      jsonb_build_object('reason', p_reason), 'operator:' || p_actor)
    returning * into v_grant;
  perform private.log_entitlement_event(p_user_id, v_grant.id, 'operator.granted', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'days', p_days));
  return jsonb_build_object('state', 'granted', 'grant_id', v_grant.id, 'ends_at', v_grant.ends_at);
end;
$$;

create function public.admin_change_grant(p_grant_id uuid, p_action text, p_ends_at timestamptz, p_ai_units integer,
  p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grant public.entitlement_grants;
  v_member_email text;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_action is null or p_action not in ('extend', 'revoke', 'restore', 'set-ai-units') then
    raise exception 'Invalid grant change' using errcode = '22023';
  end if;
  -- Restoring Early Access could recreate a second month for one identity, so it takes the Early Access locks in
  -- hierarchy order before the grant row: policy, the member's accounts, the shared regroup lock and the group.
  select reference->>'member_id' into v_member_email from public.entitlement_grants
    where id = p_grant_id and source = 'early_access';
  if p_action = 'restore' and v_member_email is not null then
    select email into v_member_email from private.early_access_members where id::text = v_member_email;
    perform 1 from private.entitlement_policy for share;
    if v_member_email is not null then
      perform private.lock_early_access_accounts(v_member_email);
      perform private.lock_early_access_groups(array[v_member_email]);
    end if;
  end if;
  select * into v_grant from public.entitlement_grants where id = p_grant_id for update;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  if p_action = 'extend' then
    if p_ends_at is null or p_ends_at <= v_grant.starts_at or p_ends_at > now() + interval '366 days' then
      raise exception 'Invalid grant end' using errcode = '22023';
    end if;
    update public.entitlement_grants set ends_at = p_ends_at where id = p_grant_id;
  elsif p_action = 'revoke' then
    update public.entitlement_grants set revoked_at = now(), revoked_by = 'operator:' || p_actor,
      revoke_reason = p_reason where id = p_grant_id and revoked_at is null;
  elsif p_action = 'restore' then
    if v_grant.source = 'early_access' and v_grant.revoked_at is not null and exists (
        select 1 from public.entitlement_grants other
        join private.early_access_members other_member on other_member.id::text = other.reference->>'member_id'
        join private.early_access_members this_member on this_member.id::text = v_grant.reference->>'member_id'
        where other.source = 'early_access' and other.revoked_at is null and other.id <> v_grant.id
          and coalesce(other_member.duplicate_of, other_member.id) = coalesce(this_member.duplicate_of, this_member.id)) then
      -- The identity already has its Early Access month on another grant.
      return jsonb_build_object('state', 'duplicate-identity');
    end if;
    update public.entitlement_grants set revoked_at = null, revoked_by = null, revoke_reason = null
      where id = p_grant_id;
  else
    if v_grant.ai_terms <> 'capped' or p_ai_units is null or p_ai_units not between 0 and 1000 then
      raise exception 'Only a capped grant takes an AI allowance' using errcode = '22023';
    end if;
    update public.entitlement_grants set ai_units = p_ai_units where id = p_grant_id;
  end if;
  perform private.log_entitlement_event(v_grant.user_id, p_grant_id, 'operator.' || p_action, 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'previous_ends_at', v_grant.ends_at, 'ends_at', p_ends_at,
      'previous_ai_units', v_grant.ai_units, 'ai_units', p_ai_units));
  return jsonb_build_object('state', 'changed');
end;
$$;

-- Free a phone for another trial, for example when a number was used without its owner's consent.
create function public.admin_release_trial_phone(p_phone_hash text, p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim private.trial_phone_claims;
begin
  perform private.require_operator_note(p_actor, p_reason);
  delete from private.trial_phone_claims where phone_hash = p_phone_hash returning * into v_claim;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  perform private.log_entitlement_event(v_claim.user_id, v_claim.grant_id, 'operator.phone-released',
    'operator:' || p_actor, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('state', 'released');
end;
$$;

-- Add one list member from a trusted source. Existing emails are never overwritten. A phone already on the list
-- marks the new row as a duplicate of that member's group, so one person cannot claim twice.
create function public.admin_add_early_access_member(p_email text, p_full_name text, p_phone_hash text,
  p_joined_at timestamptz, p_source text, p_batch text, p_actor text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.entitlement_policy;
  v_email text := lower(btrim(p_email));
  v_root uuid;
  v_root_email text;
  v_id uuid;
  v_account uuid;
  v_locked uuid[];
  v_enrolled jsonb := null;
begin
  perform private.require_operator_note(p_actor, coalesce(p_batch, ''));
  -- Lock order: policy row, account rows and locks, identity locks (email, then phone), group lock, member rows.
  select * into strict v_policy from private.entitlement_policy for share;
  -- Only people who joined before the actual public launch belong on the list. A later import of a pre-launch
  -- signup is fine; a join dated in the future is not.
  if p_joined_at is null or p_joined_at > now()
      or (v_policy.actual_launch_at is not null and p_joined_at >= v_policy.actual_launch_at) then
    return jsonb_build_object('state', 'joined-after-launch');
  end if;
  v_locked := private.lock_early_access_accounts(v_email);
  -- Concurrent imports of one email or one phone serialize here and decide again under the lock.
  perform pg_advisory_xact_lock(hashtextextended('entitlement-early-access-email:' || v_email, 0));
  if p_phone_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('entitlement-early-access-phone:' || p_phone_hash, 0));
  end if;
  if exists (select 1 from private.early_access_members where email = v_email) then
    return jsonb_build_object('state', 'existing');
  end if;
  -- A phone already on the list puts this row in that member's group: one person, one month.
  if p_phone_hash is not null then
    select email into v_root_email from private.early_access_members
      where phone_hash = p_phone_hash order by joined_at, added_at, id limit 1;
    if v_root_email is not null then
      perform private.lock_early_access_groups(array[v_root_email]);
      select coalesce(duplicate_of, id) into strict v_root from private.early_access_members where email = v_root_email;
    end if;
  end if;
  insert into private.early_access_members (email, full_name, phone_hash, joined_at, source, batch, added_by,
    duplicate_of)
    values (v_email, btrim(p_full_name), p_phone_hash, p_joined_at, p_source, p_batch, 'operator:' || p_actor, v_root)
    on conflict (email) do nothing
    returning id into v_id;
  if v_id is null then return jsonb_build_object('state', 'existing'); end if;
  -- A confirmed account with this email is enrolled now (after launch, inside the window); the month starts today.
  -- Only an account locked above: one that became visible after that (signed up or changed email meanwhile) would be
  -- locked after the identity locks, inverting the order against a concurrent import that locked it first. It is
  -- deferred to a fresh transaction instead (the operator tool's follow-up sweep, or the account's next plan read).
  select id into v_account from auth.users where lower(btrim(email)) = v_email and email_confirmed_at is not null;
  if v_account is not null and v_account = any (v_locked) then
    v_enrolled := private.reconcile_early_access(v_account, 'operator:' || p_actor);
  elsif v_account is not null then
    v_enrolled := jsonb_build_object('status', 'deferred');
  end if;
  return jsonb_build_object('state', case when v_root is null then 'added' else 'added-duplicate' end, 'id', v_id,
    'enrollment', v_enrolled->>'status');
end;
$$;

-- One lifetime Early Access month per identity group. The canonical grant is the group's earliest-starting unrevoked
-- Early Access grant (then lowest grant id): the month the identity actually began first. Every other unrevoked
-- Early Access grant in the group is revoked here, never deleted: its history and the AI it funded stay attributed to
-- it. Nothing is restarted or extended. Caller holds the regroup lock and the group's lock.
create function private.resolve_early_access_duplicates(p_root uuid, p_actor text, p_reason text) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_canonical uuid;
  v_duplicate public.entitlement_grants;
  v_revoked integer := 0;
begin
  select grant_row.id into v_canonical from public.entitlement_grants grant_row
    join private.early_access_members member on member.id::text = grant_row.reference->>'member_id'
    where grant_row.source = 'early_access' and grant_row.revoked_at is null
      and coalesce(member.duplicate_of, member.id) = p_root
    order by grant_row.starts_at, grant_row.id limit 1;
  if v_canonical is null then return 0; end if;
  for v_duplicate in select grant_row.* from public.entitlement_grants grant_row
      join private.early_access_members member on member.id::text = grant_row.reference->>'member_id'
      where grant_row.source = 'early_access' and grant_row.revoked_at is null and grant_row.id <> v_canonical
        and coalesce(member.duplicate_of, member.id) = p_root
      order by grant_row.id for update of grant_row loop
    update public.entitlement_grants set revoked_at = now(), revoked_by = 'system:duplicate-merge',
      revoke_reason = 'Duplicate identity: Early Access continues on grant ' || v_canonical::text
      where id = v_duplicate.id;
    perform private.log_entitlement_event(v_duplicate.user_id, v_duplicate.id, 'early-access.duplicate-revoked', p_actor,
      jsonb_build_object('canonical_grant_id', v_canonical, 'group_root', p_root, 'reason', p_reason,
        'starts_at', v_duplicate.starts_at, 'ends_at', v_duplicate.ends_at));
    v_revoked := v_revoked + 1;
  end loop;
  return v_revoked;
end;
$$;

create function public.admin_change_early_access_member(p_email text, p_action text, p_other_email text,
  p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_other_email text := lower(btrim(p_other_email));
  v_member private.early_access_members;
  v_other private.early_access_members;
  v_account uuid;
  v_locked uuid[];
  v_enrolled jsonb := null;
  v_revoked integer := 0;
begin
  perform private.require_operator_note(p_actor, p_reason);
  if p_action is null or p_action not in ('exclude', 'include', 'mark-duplicate', 'clear-duplicate') then
    raise exception 'Invalid member change' using errcode = '22023';
  end if;
  if not exists (select 1 from private.early_access_members where email = v_email) then
    return jsonb_build_object('state', 'not-found');
  end if;
  -- Levels 1-2: policy row, then this member's accounts.
  perform 1 from private.entitlement_policy for share;
  v_locked := private.lock_early_access_accounts(v_email);
  -- Levels 4-5: regrouping takes the regroup lock exclusively, then every group involved in ascending order. Clearing
  -- makes the member its own root, so that group is locked too.
  if p_action = 'mark-duplicate' then
    perform private.lock_early_access_groups(array[v_email, v_other_email], '{}', true);
  else
    perform private.lock_early_access_groups(array[v_email],
      array[(select id from private.early_access_members where email = v_email)], p_action = 'clear-duplicate');
  end if;
  -- Level 6: member rows.
  select * into strict v_member from private.early_access_members where email = v_email for update;
  if p_action = 'exclude' then
    update private.early_access_members set excluded_at = now(), excluded_reason = p_reason where id = v_member.id;
  elsif p_action = 'include' then
    update private.early_access_members set excluded_at = null, excluded_reason = null where id = v_member.id;
  elsif p_action = 'clear-duplicate' then
    -- Separating identities never restores a grant revoked by an earlier merge: that needs an explicit operator restore.
    update private.early_access_members set duplicate_of = null where id = v_member.id;
  else
    select * into v_other from private.early_access_members where email = v_other_email;
    if not found or v_other.id = v_member.id then return jsonb_build_object('state', 'not-found'); end if;
    -- Already one group (including marking a member as a duplicate of one of its own duplicates): nothing to change.
    if coalesce(v_other.duplicate_of, v_other.id) = coalesce(v_member.duplicate_of, v_member.id) then
      return jsonb_build_object('state', 'already-grouped');
    end if;
    -- Groups stay one level deep: everything points at a root.
    update private.early_access_members set duplicate_of = coalesce(v_other.duplicate_of, v_other.id)
      where id = v_member.id or duplicate_of = v_member.id;
    -- One identity, one Early Access month: in the same transaction, keep the canonical grant and end the others.
    v_revoked := private.resolve_early_access_duplicates(coalesce(v_other.duplicate_of, v_other.id),
      'operator:' || p_actor, p_reason);
  end if;
  perform private.log_entitlement_event(v_member.claimed_by, null, 'operator.early-access-' || p_action,
    'operator:' || p_actor, jsonb_build_object('member_id', v_member.id, 'reason', p_reason,
      'duplicate_grants_revoked', v_revoked));
  -- Excluding never removes a grant already made (revoke it explicitly); making a member eligible again enrolls their
  -- account at once, under the locks already held. As for imports, only an account locked above: one that became
  -- visible later would be locked after the group locks, so it is deferred to a fresh transaction (the operator tool's
  -- follow-up sweep, or the account's next plan read).
  if p_action in ('include', 'clear-duplicate') then
    select id into v_account from auth.users where lower(btrim(email)) = v_email and email_confirmed_at is not null;
    if v_account is not null and v_account = any (v_locked) then
      v_enrolled := private.reconcile_early_access(v_account, 'operator:' || p_actor);
    elsif v_account is not null then
      v_enrolled := jsonb_build_object('status', 'deferred');
    end if;
  end if;
  return jsonb_build_object('state', 'changed', 'enrollment', v_enrolled->>'status', 'duplicate_grants_revoked', v_revoked);
end;
$$;

-- Counts and possible duplicates for operator review. Same-name rows are only reported, never blocked.
create function public.admin_early_access_report() returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'members', (select count(*) from private.early_access_members),
    'excluded', (select count(*) from private.early_access_members where excluded_at is not null),
    'claimed', (select count(*) from private.early_access_members where claimed_at is not null),
    'duplicate_rows', (select count(*) from private.early_access_members where duplicate_of is not null),
    'same_name_groups', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'emails', emails))
      from (select lower(btrim(full_name)) as name, jsonb_agg(email order by email) as emails
        from private.early_access_members group by lower(btrim(full_name)) having count(*) > 1
        order by 1 limit 200) groups), '[]'::jsonb));
$$;

create function public.admin_configure_early_access(p_planned_launch_at timestamptz, p_enrollment_days integer,
  p_trial_after_early_access boolean, p_actor text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.entitlement_policy;
begin
  perform private.require_operator_note(p_actor, p_reason);
  select * into strict v_policy from private.entitlement_policy for update;
  -- The actual launch is never set here: only admin_activate_public_launch() records it, once.
  update private.entitlement_policy set planned_launch_at = coalesce(p_planned_launch_at, planned_launch_at),
    early_access_enrollment_days = coalesce(p_enrollment_days, early_access_enrollment_days),
    trial_after_early_access = coalesce(p_trial_after_early_access, trial_after_early_access);
  perform private.log_entitlement_event(null, null, 'operator.early-access-policy', 'operator:' || p_actor,
    jsonb_build_object('reason', p_reason, 'planned_launch_at', p_planned_launch_at,
      'enrollment_days', p_enrollment_days, 'trial_after_early_access', p_trial_after_early_access,
      'previous_enrollment_days', v_policy.early_access_enrollment_days,
      'previous_trial_after_early_access', v_policy.trial_after_early_access));
  return jsonb_build_object('state', 'changed');
end;
$$;

-- Settled codes are kept 30 days for dispute handling, then removed.
create function public.purge_trial_otp_challenges() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from private.trial_otp_challenges where created_at < now() - interval '30 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Students: their own summary and the existing reads. Everything that writes is service-role only.
-- ---------------------------------------------------------------------------
revoke all on function private.log_entitlement_event(uuid, uuid, text, text, jsonb),
  private.has_full_access(uuid), private.can_read_course_content(uuid, uuid),
  private.effective_ai_window(uuid, text[]), private.ai_units_used(uuid, uuid, timestamptz),
  private.require_operator_note(text, text), private.early_access_status(uuid),
  private.reconcile_early_access(uuid, text), private.reconcile_all_early_access(text, integer),
  private.early_access_sweep_candidates(), private.lock_early_access_accounts(text), private.lock_early_access_groups(text[], uuid[], boolean),
  private.resolve_early_access_duplicates(uuid, text, text),
  private.reconcile_early_access_on_confirmation(),
  public.get_my_entitlement(),
  public.prepare_trial_otp(uuid, uuid, text, text, text), public.record_trial_otp_delivery(uuid, uuid, text),
  public.verify_trial_otp(uuid, uuid, text),
  public.admin_entitlement_status(uuid), public.admin_grant_access(uuid, integer, text, text),
  public.admin_change_grant(uuid, text, timestamptz, integer, text, text),
  public.admin_release_trial_phone(text, text, text),
  public.admin_add_early_access_member(text, text, text, timestamptz, text, text, text),
  public.admin_change_early_access_member(text, text, text, text, text),
  public.admin_early_access_report(), public.admin_configure_early_access(timestamptz, integer, boolean, text, text),
  public.admin_activate_public_launch(text, text, integer), public.admin_reconcile_early_access(text, text, integer),
  public.purge_trial_otp_challenges()
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_entitlement() to authenticated;
grant execute on function public.prepare_trial_otp(uuid, uuid, text, text, text),
  public.record_trial_otp_delivery(uuid, uuid, text), public.verify_trial_otp(uuid, uuid, text),
  public.admin_entitlement_status(uuid), public.admin_grant_access(uuid, integer, text, text),
  public.admin_change_grant(uuid, text, timestamptz, integer, text, text),
  public.admin_release_trial_phone(text, text, text),
  public.admin_add_early_access_member(text, text, text, timestamptz, text, text, text),
  public.admin_change_early_access_member(text, text, text, text, text),
  public.admin_early_access_report(), public.admin_configure_early_access(timestamptz, integer, boolean, text, text),
  public.admin_activate_public_launch(text, text, integer), public.admin_reconcile_early_access(text, text, integer),
  public.purge_trial_otp_challenges() to service_role;

comment on table public.entitlement_grants is
  'Windows of full access (trial, Early Access, operator, future paid). Free courses never need one.';
comment on function public.read_published_managed_content(uuid) is
  'Authenticated published-only read boundary for a repository course UUID. Drafts and review history are never returned. Non-free courses require an active entitlement grant (CI403).';
