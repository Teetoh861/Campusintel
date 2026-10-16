-- supabase/migrations/20261016140000_ai_practice_uploads.sql — Personal AI practice uploads, sets and AI allowance.
-- Everything here is personal and unverified. Nothing reads or writes managed (official) content.
-- Students only read their own rows through RLS. Every write is a service-role function called by the trusted
-- server route, which passes the verified session id; identity is derived from it here, never from the client.
-- Runs after the Account lifecycle migrations (20261016100000-20261016130000): it relies on
-- private.account_deletion_jobs and on the lifecycle-aware private.has_live_account_session().

-- ---------------------------------------------------------------------------
-- Tunable policy (one row). Values are launch defaults pending owner decisions.
-- ---------------------------------------------------------------------------
create table private.ai_practice_policy (
  singleton boolean primary key default true check (singleton),
  -- Fixed total of AI units per trial grant, shared by every AI feature (PRD 4.5). Not a daily reset.
  -- PROVISIONAL: 10 is a placeholder pending the owner's product decision, not an approved limit.
  trial_units integer not null check (trial_units between 0 and 1000),
  trial_days integer not null check (trial_days between 1 and 60),
  -- Platform-wide spend guard: generations started per UTC day across all students.
  global_daily_generations integer not null check (global_daily_generations between 0 and 1000000),
  -- A running generation older than this is treated as abandoned and releases its reservation.
  reservation_minutes integer not null check (reservation_minutes between 1 and 60),
  uploads_per_day integer not null check (uploads_per_day between 0 and 1000),
  source_retention_days integer not null check (source_retention_days between 1 and 90),
  set_retention_days integer not null check (set_retention_days between 1 and 365),
  -- A reserved upload slot that never received a file expires after this many minutes.
  upload_window_minutes integer not null check (upload_window_minutes between 5 and 1440),
  -- An extraction claim older than this is treated as crashed and may be taken over.
  -- It must outlast download, the 20-second extraction deadline and settlement.
  extraction_lease_seconds integer not null check (extraction_lease_seconds between 30 and 900)
);
revoke all on table private.ai_practice_policy from public, anon, authenticated, service_role;
insert into private.ai_practice_policy values (true, 10, 7, 500, 5, 20, 7, 30, 60, 120);

-- ---------------------------------------------------------------------------
-- Uploaded documents. The raw file lives in Storage only until extraction;
-- the extracted text is kept for regeneration until the source retention ends.
-- ---------------------------------------------------------------------------
create table public.ai_practice_documents (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  institutional_course_id uuid not null references public.institutional_courses (id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  media_type text not null check (media_type in ('application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain')),
  declared_bytes integer not null check (declared_bytes between 1 and 5242880),
  status text not null default 'awaiting_upload' check (status in ('awaiting_upload', 'ready', 'rejected')),
  rejection_reason text check (rejection_reason in ('missing-upload', 'too-large', 'unsupported-type',
    'corrupt', 'encrypted', 'empty', 'too-short', 'too-much-text')),
  source_text text check (char_length(source_text) <= 400000),
  source_sha256 text check (source_sha256 ~ '^[0-9a-f]{64}$'),
  word_count integer check (word_count >= 0),
  upload_removed_at timestamptz,
  -- Extraction lease: exactly one caller reads and settles the upload at a time.
  extraction_claim uuid,
  extraction_claimed_until timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint ai_practice_documents_path_check check (storage_path = user_id::text || '/' || id::text),
  constraint ai_practice_documents_ready_check check (
    (status = 'ready') = (source_text is not null and source_sha256 is not null and word_count is not null)),
  constraint ai_practice_documents_rejection_check check ((status = 'rejected') = (rejection_reason is not null)),
  constraint ai_practice_documents_claim_check check ((extraction_claim is null) = (extraction_claimed_until is null))
);
create index ai_practice_documents_user_idx on public.ai_practice_documents (user_id, created_at desc);
create index ai_practice_documents_expiry_idx on public.ai_practice_documents (expires_at);
create index ai_practice_documents_course_idx on public.ai_practice_documents (institutional_course_id);

-- ---------------------------------------------------------------------------
-- Shared AI usage ledger: one row per AI request of any feature. A reservation
-- becomes consumed only when the feature succeeds; failures release it.
-- ---------------------------------------------------------------------------
create table public.ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  feature text not null check (feature in ('upload_practice')),
  state text not null default 'reserved' check (state in ('reserved', 'consumed', 'released')),
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  provider text check (char_length(provider) <= 40),
  model text check (char_length(model) <= 80),
  input_tokens integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  cache_read_input_tokens integer check (cache_read_input_tokens >= 0),
  cache_creation_input_tokens integer check (cache_creation_input_tokens >= 0),
  cost_usd numeric(12, 6) check (cost_usd >= 0),
  duration_ms integer check (duration_ms >= 0),
  constraint ai_usage_events_settled_check check ((state = 'reserved') = (settled_at is null))
);
create index ai_usage_events_user_idx on public.ai_usage_events (user_id, reserved_at);
create index ai_usage_events_day_idx on public.ai_usage_events (reserved_at);

-- One server-issued AI grant per account. AI use never creates one: it is issued only through
-- issue_ai_allowance_grant() by trusted server code (phone-OTP trial activation, Early Access, or a
-- controlled test). With no grant, generation is refused.
create table public.ai_allowance_windows (
  user_id uuid primary key references auth.users (id) on delete cascade,
  source text not null check (source in ('trial', 'early_access', 'test')),
  granted_at timestamptz not null default now(),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total_units integer not null check (total_units >= 0),
  constraint ai_allowance_windows_range_check check (ends_at > starts_at)
);

-- ---------------------------------------------------------------------------
-- Generation jobs and the personal question sets they produce.
-- ---------------------------------------------------------------------------
create table public.ai_practice_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  request_id uuid not null,
  document_id uuid references public.ai_practice_documents (id) on delete set null,
  institutional_course_id uuid not null references public.institutional_courses (id) on delete cascade,
  usage_event_id uuid not null unique references public.ai_usage_events (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'generated', 'insufficient_source',
    'flagged_for_review', 'failed')),
  outcome_reason text check (char_length(outcome_reason) <= 40),
  question_set jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  constraint ai_practice_generations_request_key unique (user_id, request_id),
  constraint ai_practice_generations_set_check check ((status = 'generated') = (question_set is not null)),
  constraint ai_practice_generations_completion_check check ((status = 'running') = (completed_at is null))
);
-- At most one generation in flight per student.
create unique index ai_practice_generations_single_flight_idx
  on public.ai_practice_generations (user_id) where status = 'running';
create index ai_practice_generations_user_idx on public.ai_practice_generations (user_id, created_at desc);
create index ai_practice_generations_expiry_idx on public.ai_practice_generations (expires_at);
create index ai_practice_generations_document_idx on public.ai_practice_generations (document_id);
create index ai_practice_generations_course_idx on public.ai_practice_generations (institutional_course_id);

-- ---------------------------------------------------------------------------
-- RLS: owners read their own rows through a live, unscheduled account session
-- (private.has_live_account_session, as amended by 20261016110000_account_deletion_access.sql).
-- Students have no write privilege on any table and no execute privilege on any writing function.
-- ---------------------------------------------------------------------------
alter table public.ai_practice_documents enable row level security;
alter table public.ai_usage_events enable row level security;
alter table public.ai_allowance_windows enable row level security;
alter table public.ai_practice_generations enable row level security;

revoke all on table public.ai_practice_documents, public.ai_usage_events, public.ai_allowance_windows,
  public.ai_practice_generations from public, anon, authenticated, service_role;
grant select on table public.ai_practice_documents, public.ai_practice_generations to authenticated;

create policy "Students read their own AI practice documents"
  on public.ai_practice_documents for select to authenticated
  using ((select auth.uid()) = user_id and (select private.has_live_account_session()));
create policy "Students read their own AI practice generations"
  on public.ai_practice_generations for select to authenticated
  using ((select auth.uid()) = user_id and (select private.has_live_account_session()));

-- ---------------------------------------------------------------------------
-- Service-role identity. Mirrors public.write_quiz_attempt (20261016110000_account_deletion_access.sql):
-- the user comes from the server-verified session row, then the account row is share-locked (scheduling
-- and the deletion worker lock it FOR UPDATE), and the session and lifecycle are re-checked after the wait.
-- A logged-out, expired, revoked or deletion-scheduled session yields null.
-- ---------------------------------------------------------------------------
create function private.ai_practice_session_user(p_session_id uuid) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_now timestamptz;
begin
  if p_session_id is null then return null; end if;
  select user_id into v_user_id from auth.sessions where id = p_session_id;
  if v_user_id is null then return null; end if;
  perform 1 from auth.users where id = v_user_id for share;
  v_now := clock_timestamp();
  if not exists (select 1 from auth.sessions s join auth.users u on u.id = s.user_id
      where s.id = p_session_id and s.user_id = v_user_id
        and (s.not_after is null or s.not_after > v_now) and u.email_confirmed_at is not null
        and (u.banned_until is null or u.banned_until <= v_now))
    or exists (select 1 from private.account_deletion_jobs where user_id = v_user_id) then
    return null;
  end if;
  return v_user_id;
end;
$$;

-- The student's grant as admission sees it: only sources this deployment accepts count. Never issues one.
create function private.ai_allowance_admission(p_user_id uuid, p_accepted_sources text[]) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.ai_practice_policy;
  v_window public.ai_allowance_windows;
  v_used integer;
begin
  if coalesce(cardinality(p_accepted_sources), 0) = 0
      or not p_accepted_sources <@ array['trial', 'early_access', 'test'] then
    raise exception 'Invalid accepted grant sources' using errcode = '22023';
  end if;
  select * into strict v_policy from private.ai_practice_policy;
  select * into v_window from public.ai_allowance_windows where user_id = p_user_id;
  if not found or not (v_window.source = any (p_accepted_sources)) then
    return jsonb_build_object('state', 'not-entitled');
  end if;
  if now() >= v_window.ends_at then
    return jsonb_build_object('state', 'allowance-expired', 'total', v_window.total_units, 'ends_at', v_window.ends_at);
  end if;
  select count(*) into v_used from public.ai_usage_events
    where user_id = p_user_id and reserved_at >= v_window.starts_at
      and (state = 'consumed' or (state = 'reserved'
        and reserved_at > now() - make_interval(mins => v_policy.reservation_minutes)));
  if v_used >= v_window.total_units then
    return jsonb_build_object('state', 'allowance-exhausted', 'total', v_window.total_units, 'used', v_used,
      'ends_at', v_window.ends_at);
  end if;
  return jsonb_build_object('state', 'active', 'total', v_window.total_units, 'used', v_used,
    'ends_at', v_window.ends_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Private Storage bucket. Size and type limits are enforced by Storage itself.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ai-practice-uploads', 'ai-practice-uploads', false, 5242880, array['application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Whether the calling student may write this object now: the exact path of their own reserved slot, inside
-- the upload window and before extraction has claimed it. Storage evaluates this when a URL is signed.
create function private.ai_practice_upload_is_open(p_name text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ai_practice_documents document, private.ai_practice_policy policy
    where document.storage_path = p_name
      and document.user_id = auth.uid()
      and document.status = 'awaiting_upload'
      and document.upload_removed_at is null
      and document.extraction_claim is null
      and document.expires_at > now()
      and document.created_at > now() - make_interval(mins => policy.upload_window_minutes));
$$;

create policy "AI practice uploads: reserved owner writes"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ai-practice-uploads' and (select private.has_live_account_session())
    and private.ai_practice_upload_is_open(name));
create policy "AI practice uploads: owner reads"
  on storage.objects for select to authenticated
  using (bucket_id = 'ai-practice-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.has_live_account_session()));
create policy "AI practice uploads: owner deletes"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ai-practice-uploads' and (storage.foldername(name))[1] = (select auth.uid())::text
    and (select private.has_live_account_session()));

-- ---------------------------------------------------------------------------
-- Document lifecycle (service role; identity from the verified session).
-- ---------------------------------------------------------------------------
create function public.create_ai_practice_document(
  p_session_id uuid, p_institutional_course_id uuid, p_file_name text, p_media_type text, p_declared_bytes integer,
  p_accepted_sources text[]
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.ai_practice_policy;
  v_allowance jsonb;
  v_id uuid := gen_random_uuid();
  v_today integer;
begin
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('status', 'signed-out'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  if not exists (select 1 from public.institutional_courses where id = p_institutional_course_id) then
    return jsonb_build_object('status', 'invalid-course');
  end if;
  -- No slot is reserved that could never be generated from.
  v_allowance := private.ai_allowance_admission(v_user_id, p_accepted_sources);
  if v_allowance ->> 'state' <> 'active' then return jsonb_build_object('status', v_allowance ->> 'state'); end if;
  -- Serialize one student's reservations so the daily count cannot be raced.
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-upload:' || v_user_id::text, 0));
  select count(*) into v_today from public.ai_practice_documents
    where user_id = v_user_id and created_at > now() - interval '1 day';
  if v_today >= v_policy.uploads_per_day then return jsonb_build_object('status', 'upload-limit'); end if;
  insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name,
    media_type, declared_bytes, expires_at)
  values (v_id, v_user_id, p_institutional_course_id, v_user_id::text || '/' || v_id::text, p_file_name,
    p_media_type, p_declared_bytes, now() + make_interval(days => v_policy.source_retention_days));
  return jsonb_build_object('status', 'created', 'document_id', v_id,
    'storage_path', v_user_id::text || '/' || v_id::text);
end;
$$;

-- Claim the upload for extraction. One atomic conditional update is the claim: concurrent callers serialize
-- on the row and only the first matches; the rest see a live lease and are told the document is busy.
-- An expired lease (a crashed extraction) is taken over with a fresh claim id.
create function public.claim_ai_practice_extraction(p_session_id uuid, p_document_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.ai_practice_policy;
  v_document public.ai_practice_documents;
  v_claim uuid := gen_random_uuid();
begin
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  update public.ai_practice_documents
    set extraction_claim = v_claim,
        extraction_claimed_until = clock_timestamp() + make_interval(secs => v_policy.extraction_lease_seconds)
    where id = p_document_id and user_id = v_user_id and status = 'awaiting_upload' and expires_at > now()
      and (extraction_claim is null or extraction_claimed_until <= clock_timestamp());
  if found then return jsonb_build_object('state', 'claimed', 'claim_id', v_claim); end if;
  select * into v_document from public.ai_practice_documents where id = p_document_id and user_id = v_user_id;
  if not found or v_document.expires_at <= now() then return jsonb_build_object('state', 'not-found'); end if;
  if v_document.status <> 'awaiting_upload' then return jsonb_build_object('state', 'settled'); end if;
  return jsonb_build_object('state', 'busy');
end;
$$;

-- Record extraction exactly once, only by the holder of the current claim. The stored digest must be the
-- digest of the stored text, so a caller cannot pair text with someone else's hash.
create function public.settle_ai_practice_document(
  p_session_id uuid, p_document_id uuid, p_claim_id uuid, p_rejection_reason text, p_source_text text,
  p_source_sha256 text, p_word_count integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if p_claim_id is null or (p_rejection_reason is null) = (p_source_text is null) then
    raise exception 'Exactly one of rejection or source text is required' using errcode = '22023';
  end if;
  if p_source_text is not null and (p_word_count is null
      or p_source_sha256 is distinct from encode(sha256(convert_to(p_source_text, 'UTF8')), 'hex')) then
    raise exception 'Source digest does not match the text' using errcode = '22023';
  end if;
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return false; end if;
  update public.ai_practice_documents
    set status = case when p_rejection_reason is null then 'ready' else 'rejected' end,
        rejection_reason = p_rejection_reason, source_text = p_source_text,
        source_sha256 = case when p_rejection_reason is null then p_source_sha256 end,
        word_count = case when p_rejection_reason is null then p_word_count end,
        extraction_claim = null, extraction_claimed_until = null
    where id = p_document_id and user_id = v_user_id and status = 'awaiting_upload' and expires_at > now()
      and extraction_claim = p_claim_id;
  return found;
end;
$$;

-- Give up a claim early (download outage, unexpected error) so a retry need not wait for the lease.
-- Needs no live session: a logout mid-extraction must still be able to let go.
create function public.release_ai_practice_extraction(p_user_id uuid, p_document_id uuid, p_claim_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_practice_documents set extraction_claim = null, extraction_claimed_until = null
    where id = p_document_id and user_id = p_user_id and extraction_claim = p_claim_id;
  return found;
end;
$$;

create function public.note_ai_practice_upload_removed(p_user_id uuid, p_document_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.ai_practice_documents set upload_removed_at = now()
    where id = p_document_id and user_id = p_user_id and upload_removed_at is null;
  return found;
end;
$$;

-- Remaining allowance for display (student-callable, read only). Never issues a grant.
create function public.get_my_ai_allowance() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_policy private.ai_practice_policy;
  v_window public.ai_allowance_windows;
  v_used integer;
begin
  if v_user_id is null or not private.has_live_account_session() then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  select * into strict v_policy from private.ai_practice_policy;
  select * into v_window from public.ai_allowance_windows where user_id = v_user_id;
  if not found then
    return jsonb_build_object('state', 'not-entitled', 'total', 0, 'used', 0);
  end if;
  select count(*) into v_used from public.ai_usage_events
    where user_id = v_user_id and reserved_at >= v_window.starts_at
      and (state = 'consumed' or (state = 'reserved'
        and reserved_at > now() - make_interval(mins => v_policy.reservation_minutes)));
  return jsonb_build_object('state', case when now() >= v_window.ends_at then 'expired' else 'active' end,
    'source', v_window.source, 'total', v_window.total_units, 'used', v_used, 'ends_at', v_window.ends_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Trusted grant issuance (service role). No student request path calls this. The trial grant is the
-- shared fixed allowance from policy; Early Access and test grants state their own terms.
-- ---------------------------------------------------------------------------
create function public.issue_ai_allowance_grant(
  p_user_id uuid, p_source text, p_units integer default null, p_days integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.ai_practice_policy;
  v_units integer;
  v_days integer;
  v_window public.ai_allowance_windows;
begin
  if p_user_id is null or p_source is null or p_source not in ('trial', 'early_access', 'test')
      or (p_source = 'trial' and (p_units is not null or p_days is not null)) then
    raise exception 'Invalid AI allowance grant' using errcode = '22023';
  end if;
  select * into strict v_policy from private.ai_practice_policy;
  v_units := case when p_source = 'trial' then v_policy.trial_units else p_units end;
  v_days := case when p_source = 'trial' then v_policy.trial_days else p_days end;
  if v_units is null or v_days is null or v_units not between 0 and 1000 or v_days not between 1 and 365 then
    raise exception 'Invalid AI allowance grant terms' using errcode = '22023';
  end if;
  insert into public.ai_allowance_windows (user_id, source, starts_at, ends_at, total_units)
    values (p_user_id, p_source, now(), now() + make_interval(days => v_days), v_units)
    on conflict (user_id) do nothing
    returning * into v_window;
  if found then
    return jsonb_build_object('state', 'issued', 'source', v_window.source, 'total', v_window.total_units,
      'ends_at', v_window.ends_at);
  end if;
  -- One grant per account and re-issuing is a no-op. Upgrading or extending a grant (for example a
  -- trial becoming Early Access) is an open product decision and deliberately not implemented here.
  select * into strict v_window from public.ai_allowance_windows where user_id = p_user_id;
  return jsonb_build_object('state', 'existing', 'source', v_window.source, 'total', v_window.total_units,
    'ends_at', v_window.ends_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Service-role accounting. Students cannot call these.
-- ---------------------------------------------------------------------------
create function private.release_abandoned_ai_generations(p_user_id uuid, p_minutes integer) returns void
language sql
set search_path = ''
as $$
  with abandoned as (
    update public.ai_practice_generations
      set status = 'failed', outcome_reason = 'abandoned', completed_at = now()
      where status = 'running' and created_at <= now() - make_interval(mins => p_minutes)
        and (p_user_id is null or user_id = p_user_id)
      returning usage_event_id
  )
  update public.ai_usage_events set state = 'released', settled_at = now()
    where id in (select usage_event_id from abandoned) and state = 'reserved';
$$;
revoke all on function private.release_abandoned_ai_generations(uuid, integer) from public, anon, authenticated, service_role;

create function public.begin_ai_practice_generation(
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

  insert into public.ai_usage_events (user_id, feature) values (v_user_id, 'upload_practice')
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

create function public.finish_ai_practice_generation(
  p_user_id uuid, p_generation_id uuid, p_status text, p_outcome_reason text, p_question_set jsonb, p_usage jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_generation public.ai_practice_generations;
  v_count integer;
  v_status text := p_status;
  v_reason text := p_outcome_reason;
  v_set jsonb := p_question_set;
begin
  if p_status not in ('generated', 'insufficient_source', 'flagged_for_review', 'failed')
      or (p_status = 'generated') <> (p_question_set is not null)
      or (p_usage is not null and jsonb_typeof(p_usage) <> 'object') then
    raise exception 'Invalid generation result' using errcode = '22023';
  end if;
  if p_question_set is not null then
    -- The stored format is personal and unverified by construction; anything else is refused.
    v_count := case when jsonb_typeof(p_question_set -> 'questions') = 'array'
      then jsonb_array_length(p_question_set -> 'questions') else 0 end;
    if jsonb_typeof(p_question_set) <> 'object' or p_question_set ->> 'formatVersion' <> '1'
        or p_question_set ->> 'origin' <> 'ai-generated' or p_question_set ->> 'visibility' <> 'personal'
        or p_question_set ->> 'verification' <> 'unverified' or v_count not between 1 and 5
        or octet_length(p_question_set::text) > 65536 then
      raise exception 'Invalid question set' using errcode = '22023';
    end if;
  end if;
  -- Account row first, in the same order as scheduling and the deletion worker.
  perform 1 from auth.users where id = p_user_id for share;
  select * into v_generation from public.ai_practice_generations
    where id = p_generation_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  if v_generation.status <> 'running' then
    return jsonb_build_object('state', 'already-finished', 'status', v_generation.status);
  end if;
  -- A set finished after deletion was scheduled can never be shown, so it is neither stored nor charged.
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    v_status := 'failed';
    v_reason := 'account-restricted';
    v_set := null;
  end if;
  update public.ai_practice_generations
    set status = v_status, outcome_reason = v_reason, question_set = v_set, completed_at = now()
    where id = p_generation_id;
  -- Only a delivered set consumes allowance; every other outcome releases the reservation.
  update public.ai_usage_events
    set state = case when v_status = 'generated' then 'consumed' else 'released' end, settled_at = now(),
        provider = p_usage ->> 'provider', model = p_usage ->> 'model',
        input_tokens = (p_usage ->> 'inputTokens')::integer, output_tokens = (p_usage ->> 'outputTokens')::integer,
        cache_read_input_tokens = (p_usage ->> 'cacheReadInputTokens')::integer,
        cache_creation_input_tokens = (p_usage ->> 'cacheCreationInputTokens')::integer,
        cost_usd = (p_usage ->> 'estimatedCostUsd')::numeric, duration_ms = (p_usage ->> 'durationMs')::integer
    where id = v_generation.usage_event_id and state = 'reserved';
  return jsonb_build_object('state', 'finished', 'status', v_status);
end;
$$;

-- ---------------------------------------------------------------------------
-- Retention and Account-purge support (service role).
-- ---------------------------------------------------------------------------
-- Storage objects that should no longer exist: anything that is not the live, unclaimed-or-claimed slot of an
-- account with no deletion job and still inside the upload window. That covers settled and expired uploads,
-- late signed uploads and orphans with no row. Objects of a deletion-scheduled account are flagged because
-- they make run_account_deletion_jobs fail closed with P0002 until removed through the Storage API.
create function private.ai_practice_removable_uploads()
returns table (name text, blocks_account_purge boolean, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select object.name,
    exists (select 1 from private.account_deletion_jobs job
      where job.user_id::text = object.owner_id or job.user_id = object.owner
        or job.user_id::text = (storage.foldername(object.name))[1]),
    object.created_at
  from storage.objects object
  where object.bucket_id = 'ai-practice-uploads'
    and not exists (
      select 1 from public.ai_practice_documents document, private.ai_practice_policy policy
      where document.storage_path = object.name and document.status = 'awaiting_upload'
        and document.expires_at > now()
        and document.created_at > now() - make_interval(mins => policy.upload_window_minutes)
        and not exists (select 1 from private.account_deletion_jobs job
          where job.user_id = document.user_id or job.user_id::text = object.owner_id or job.user_id = object.owner));
$$;
revoke all on function private.ai_practice_removable_uploads() from public, anon, authenticated, service_role;

-- Objects that block an Account purge come first, so a bounded sweep clears them before anything else.
create function public.list_ai_practice_uploads_to_remove(p_limit integer) returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select removable.name from private.ai_practice_removable_uploads() removable
  order by removable.blocks_account_purge desc, removable.created_at, removable.name
  limit greatest(1, least(p_limit, 1000));
$$;

-- The Account deletion worker's pre-step: only objects that block a purge, oldest first, and how many remain.
-- Names are paths (user and document ids), never file contents.
create function public.list_ai_practice_purge_blockers(p_limit integer) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with blockers as (select removable.name, removable.created_at from private.ai_practice_removable_uploads() removable
    where removable.blocks_account_purge)
  select jsonb_build_object('remaining', (select count(*) from blockers),
    'names', coalesce((select jsonb_agg(batch.name order by batch.created_at, batch.name) from (
      select blockers.name, blockers.created_at from blockers order by blockers.created_at, blockers.name
      limit greatest(1, least(p_limit, 1000))) batch), '[]'::jsonb));
$$;

-- Delete expired personal data. A document row is never deleted while its Storage object still exists,
-- so an unfinished sweep can always find and remove the file later. Returns what was done and what remains.
create function public.purge_expired_ai_practice() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.ai_practice_policy;
  v_sets integer;
  v_documents integer;
  v_unfilled integer;
  v_retained integer;
  v_outstanding integer;
  v_blocking integer;
begin
  select * into strict v_policy from private.ai_practice_policy;
  perform private.release_abandoned_ai_generations(null, v_policy.reservation_minutes);
  delete from public.ai_practice_generations where expires_at <= now() and status <> 'running';
  get diagnostics v_sets = row_count;
  -- Reserved slots that never received a file become rejected so they stop holding a path.
  update public.ai_practice_documents set status = 'rejected', rejection_reason = 'missing-upload',
      extraction_claim = null, extraction_claimed_until = null
    where status = 'awaiting_upload'
      and created_at <= now() - make_interval(mins => v_policy.upload_window_minutes);
  get diagnostics v_unfilled = row_count;
  delete from public.ai_practice_documents document
    where document.expires_at <= now() and not exists (select 1 from storage.objects object
      where object.bucket_id = 'ai-practice-uploads' and object.name = document.storage_path);
  get diagnostics v_documents = row_count;
  select count(*) into v_retained from public.ai_practice_documents where expires_at <= now();
  select count(*), count(*) filter (where blocks_account_purge) into v_outstanding, v_blocking
    from private.ai_practice_removable_uploads();
  return jsonb_build_object('deleted_sets', v_sets, 'deleted_documents', v_documents,
    'expired_upload_slots', v_unfilled, 'retained_documents', v_retained,
    'outstanding_uploads', v_outstanding, 'purge_blocking_uploads', v_blocking);
end;
$$;

revoke all on function private.ai_practice_session_user(uuid), private.ai_allowance_admission(uuid, text[]),
  private.ai_practice_upload_is_open(text),
  public.create_ai_practice_document(uuid, uuid, text, text, integer, text[]),
  public.claim_ai_practice_extraction(uuid, uuid),
  public.settle_ai_practice_document(uuid, uuid, uuid, text, text, text, integer),
  public.release_ai_practice_extraction(uuid, uuid, uuid),
  public.note_ai_practice_upload_removed(uuid, uuid), public.get_my_ai_allowance(),
  public.begin_ai_practice_generation(uuid, uuid, uuid, text[]),
  public.finish_ai_practice_generation(uuid, uuid, text, text, jsonb, jsonb),
  public.list_ai_practice_uploads_to_remove(integer), public.list_ai_practice_purge_blockers(integer),
  public.purge_expired_ai_practice(), public.issue_ai_allowance_grant(uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
-- Students: read their allowance, and the Storage insert policy's slot check. Nothing that writes.
grant execute on function public.get_my_ai_allowance(), private.ai_practice_upload_is_open(text) to authenticated;
grant execute on function public.create_ai_practice_document(uuid, uuid, text, text, integer, text[]),
  public.claim_ai_practice_extraction(uuid, uuid),
  public.settle_ai_practice_document(uuid, uuid, uuid, text, text, text, integer),
  public.release_ai_practice_extraction(uuid, uuid, uuid),
  public.note_ai_practice_upload_removed(uuid, uuid),
  public.begin_ai_practice_generation(uuid, uuid, uuid, text[]),
  public.finish_ai_practice_generation(uuid, uuid, text, text, jsonb, jsonb),
  public.list_ai_practice_uploads_to_remove(integer), public.list_ai_practice_purge_blockers(integer),
  public.purge_expired_ai_practice(), public.issue_ai_allowance_grant(uuid, text, integer, integer) to service_role;
