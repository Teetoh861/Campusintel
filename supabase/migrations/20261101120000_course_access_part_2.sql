-- A2: own current-semester courses at every Discovery, AI and answer boundary.
-- Lock prefix is A1's: Auth -> entitlement account -> profile -> calendar -> feature -> resources.
-- Scores, snapshots, grants and bookmark records are retained.

create or replace function private.course_session_user(p_session uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select s.user_id from auth.sessions s join auth.users u on u.id=s.user_id
  where s.id=p_session and (s.not_after is null or s.not_after>clock_timestamp())
    and u.email_confirmed_at is not null and (u.banned_until is null or u.banned_until<=clock_timestamp())
    and not exists(select 1 from private.account_deletion_jobs j where j.user_id=s.user_id);
$$;


create or replace function private.open_course_access_read(p_user uuid, p_session uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_bind boolean; v_shared boolean; v_key bigint := hashtextextended('entitlement-account:' || p_user::text, 0);
begin
  if p_user is null or private.course_session_user(p_session) is distinct from p_user then
    raise exception 'Account session required' using errcode = '42501';
  end if;
  -- A caller can make multiple reads in one transaction. Remember the actual lock, including when calendar
  -- repair or the launch clock makes binding/enrollment possible only after its first shared read.
  select exists (select 1 from pg_catalog.pg_locks where locktype = 'advisory' and pid = pg_backend_pid()
    and mode = 'ShareLock' and classid = ((v_key >> 32) & 4294967295)::oid
    and objid = (v_key & 4294967295)::oid and objsubid = 1) into v_shared;
  select exists (select 1 from private.pending_course_grant_bindings(p_user, clock_timestamp())) into v_bind;
  v_bind := v_bind and not v_shared;
  -- Reconciliation may issue a grant and must finish its policy/account prefix before the read opening.
  if not v_shared and private.early_access_status(p_user)->>'status' = 'eligible' then
    perform private.reconcile_early_access(p_user, 'system:course-read');
  end if;
  -- Decide BEFORE any account lock. Never upgrade a shared lock: simultaneous upgrades would deadlock.
  perform 1 from auth.users where id = p_user for share;
  if v_bind then
    perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || p_user::text, 0));
  else
    perform pg_advisory_xact_lock_shared(hashtextextended('entitlement-account:' || p_user::text, 0));
  end if;
  perform 1 from public.profiles where id = p_user for share;
  perform pg_advisory_xact_lock_shared(hashtextextended('academic-calendar', 0));
  if v_bind then perform private.bind_pending_course_grants(p_user); end if;
  -- A grant appearing unbound on the shared path does not qualify in course_access_decision. A later read binds it.
end;
$$;

create or replace function private.open_course_access_read(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_user is distinct from auth.uid() then raise exception 'Account session required' using errcode='42501'; end if;
  perform private.open_course_access_read(p_user,(auth.jwt()->>'session_id')::uuid);
end;
$$;

create or replace function private.course_on_current_list(p_user uuid,p_course uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.current_course_scope(p_user,p_at)->>'state'='ready' and exists(
    select 1 from public.profiles p join public.course_applicability a
      on a.department_id=p.department_id and a.academic_level_id=p.academic_level_id
      and a.academic_period_id=p.academic_period_id
    join public.departments d on d.id=a.department_id and d.is_active
    join public.academic_levels l on l.id=a.academic_level_id and l.is_active
    join public.academic_periods t on t.id=a.academic_period_id and t.is_active
    where p.id=p_user and a.institutional_course_id=p_course);
$$;
create or replace function private.discovery_course_allowed(p_user uuid,p_repository uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.institutional_courses c where c.repository_course_id=p_repository
    and private.course_on_current_list(p_user,c.id,p_at));
$$;
create or replace function private.ai_course_allowed(p_user uuid,p_course uuid,p_at timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select (private.course_on_current_list(p_user,p_course,p_at) or exists(
      select 1 from private.course_access_decision(p_user,p_course,p_at) a where a.allowed and a.team_added))
    and exists(select 1 from private.effective_ai_window(p_user,array['trial','early_access','test']) w
      where w.starts_at<=p_at and w.ends_at>p_at);
$$;
create or replace function private.open_course_session_write(p_session uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.course_session_user(p_session);
begin
  if u is null then return null; end if;
  perform private.lock_course_access_scope(u);
  return u;
end;
$$;


create or replace function public.discovery_preview(p_session_id uuid, p_course_id uuid, p_kind text, p_claim boolean,
  p_item_id uuid default null, p_exam_seconds integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
  v_grant public.entitlement_grants;
  v_preview private.discovery_previews;
  v_content jsonb;
  v_now timestamptz;
begin
  if p_course_id is null or p_claim is null or p_kind is null or p_kind not in ('cbt', 'study_guide')
      or (p_exam_seconds is not null and (p_kind <> 'cbt' or p_exam_seconds not between 300 and 10800))
      or (p_claim and p_kind = 'cbt' and p_exam_seconds is null)
      or (p_claim and p_kind = 'study_guide' and p_item_id is null) then
    raise exception 'Invalid preview request' using errcode = '22023';
  end if;
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  -- Same per-account lock as trial activation and Early Access enrollment. The clock is read only once it is held.
  perform private.bind_pending_course_grants(v_user_id);
  perform 1 from private.discovery_previews where user_id=v_user_id for update;
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out');
  end if;
  if not private.discovery_course_allowed(v_user_id,p_course_id,clock_timestamp()) then
    return jsonb_build_object('state','not-offered');
  end if;
  v_now := clock_timestamp();
  select * into strict v_policy from private.entitlement_policy;
  if not exists (select 1 from public.courses where id = p_course_id) then
    return jsonb_build_object('state', 'invalid-course');
  end if;
  -- A free course or a full plan reads the course itself; nothing is ever spent on it.
  if exists (select 1 from public.institutional_courses where repository_course_id = p_course_id and is_free) then
    return jsonb_build_object('state', 'free-course');
  end if;
  if private.has_full_access(v_user_id)
      or exists (select 1 from public.profiles where id = v_user_id and role = 'operator') then
    return jsonb_build_object('state', 'full-access');
  end if;
  select * into v_grant from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  if v_grant.id is null then return jsonb_build_object('state', 'no-pass'); end if;
  -- Fail closed the instant the pass ends or is revoked, whatever was opened before. A seven-day trial that has
  -- ended was this account's one trial, so it never becomes a pass.
  if v_grant.trial_policy <> 'discovery' or v_grant.revoked_at is not null or v_grant.ends_at <= v_now
      or v_grant.starts_at > v_now then
    return jsonb_build_object('state', 'expired');
  end if;
  if not private.course_has_active_offering(p_course_id) then
    return jsonb_build_object('state', 'not-offered');
  end if;

  perform private.close_overdue_discovery_exam(v_grant.id);
  select * into v_preview from private.discovery_previews where grant_id = v_grant.id and kind = p_kind;
  if v_preview.grant_id is not null and v_preview.course_id <> p_course_id then
    return jsonb_build_object('state', 'used-elsewhere', 'now', v_now, 'ends_at', v_grant.ends_at,
      'content_key', (select content_key from public.courses where id = v_preview.course_id));
  end if;
  if v_preview.grant_id is null then
    if p_kind = 'cbt' and (select count(*) from private.discovery_cbt_pool(p_course_id))
        < v_policy.discovery_cbt_questions then
      return jsonb_build_object('state', 'nothing-to-preview');
    end if;
    -- The exam runs for the course's whole duration or not at all: it is never shortened to fit the pass.
    if p_kind = 'cbt' and p_exam_seconds is not null
        and v_now + make_interval(secs => p_exam_seconds) > v_grant.ends_at then
      return jsonb_build_object('state', 'not-enough-time', 'now', v_now, 'ends_at', v_grant.ends_at);
    end if;
    if not p_claim then
      return jsonb_build_object('state', 'available', 'now', v_now, 'ends_at', v_grant.ends_at,
        'topics', case when p_kind = 'study_guide' then private.discovery_topic_titles(p_course_id) end);
    end if;
    v_content := private.discovery_preview_content(p_course_id, p_kind, p_item_id);
    if jsonb_array_length(v_content) = 0 then return jsonb_build_object('state', 'nothing-to-preview'); end if;
    insert into private.discovery_previews (grant_id, user_id, kind, course_id, content, deadline_at)
      values (v_grant.id, v_user_id, p_kind, p_course_id, v_content, case when p_kind = 'cbt'
        then v_now + make_interval(secs => p_exam_seconds) end)
      returning * into v_preview;
    perform private.log_entitlement_event(v_user_id, v_grant.id, 'discovery.preview-opened', 'student',
      jsonb_build_object('kind', p_kind, 'course_id', p_course_id, 'items', jsonb_array_length(v_content)));
  end if;
  return jsonb_build_object('state', 'ready', 'now', v_now, 'ends_at', v_grant.ends_at,
    'preview', private.discovery_preview_view(v_preview));
end;
$$;

create or replace function public.save_discovery_cbt(p_session_id uuid, p_course_id uuid, p_tab uuid, p_sequence integer,
  p_base_revision integer, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_exam record;
  v_preview private.discovery_previews;
  v_merge record;
  v_grant_id uuid;
begin
  if p_course_id is null or p_tab is null or p_changes is null or jsonb_typeof(p_changes) <> 'object'
      or octet_length(p_changes::text) > 8192 or p_sequence is null or p_sequence not between 0 and 1000000
      or p_base_revision is null or p_base_revision not between 0 and 1000000 then
    raise exception 'Invalid exam answers' using errcode = '22023';
  end if;
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform private.bind_pending_course_grants(v_user_id);
  perform 1 from private.discovery_previews where user_id=v_user_id for update;
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out');
  end if;
  if not private.discovery_course_allowed(v_user_id,p_course_id,clock_timestamp()) then
    return jsonb_build_object('state','not-offered');
  end if;
  select * into v_exam from private.discovery_exam_for(v_user_id, p_course_id);
  if v_exam.o_state <> 'ok' then return jsonb_build_object('state', v_exam.o_state); end if;
  v_preview := v_exam.o_preview;
  if v_preview.submitted_at is not null then
    return jsonb_build_object('state', 'ready', 'now', clock_timestamp(), 'ends_at', (v_exam.o_grant).ends_at,
      'preview', private.discovery_preview_view(v_preview));
  end if;
  select * into v_merge from private.discovery_reconcile_sheet(v_preview, p_tab, p_sequence, p_base_revision, p_changes);
  if v_merge.o_refusal is not null then
    return private.discovery_sheet_answer(v_merge.o_refusal, v_preview);
  end if;
  if not v_merge.o_apply then
    return private.discovery_sheet_answer(case when p_changes <> '{}'::jsonb
      and p_sequence < coalesce((v_preview.saved_sources -> p_tab::text ->> 'seq')::integer, 0) then 'stale'
      else 'saved' end, v_preview);
  end if;
  v_grant_id := v_preview.grant_id;
  -- The deadline is re-read from the wall clock in the write itself: the last check before the changes are accepted.
  update private.discovery_previews set saved_answers = v_merge.o_sheet, saved_at = clock_timestamp(),
      saved_revision = saved_revision + 1,
      saved_sources = private.discovery_sources_with(saved_sources, p_tab, p_sequence, clock_timestamp())
    where grant_id = v_grant_id and kind = 'cbt' and submitted_at is null and deadline_at > clock_timestamp()
    returning * into v_preview;
  if found then return private.discovery_sheet_answer('saved', v_preview); end if;
  -- The deadline passed between the check above and the write: the exam closes now, from the sheet saved in time.
  perform private.close_overdue_discovery_exam(v_grant_id);
  select * into v_preview from private.discovery_previews where grant_id = v_grant_id and kind = 'cbt';
  return jsonb_build_object('state', 'ready', 'now', clock_timestamp(), 'ends_at', (v_exam.o_grant).ends_at,
    'preview', private.discovery_preview_view(v_preview));
end;
$$;

create or replace function public.submit_discovery_cbt(p_session_id uuid, p_course_id uuid, p_tab uuid, p_sequence integer,
  p_base_revision integer, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_exam record;
  v_preview private.discovery_previews;
  v_merge record;
  v_score integer;
  v_grant_id uuid;
begin
  if p_course_id is null or p_tab is null or p_changes is null or jsonb_typeof(p_changes) <> 'object'
      or octet_length(p_changes::text) > 8192 or p_sequence is null or p_sequence not between 0 and 1000000
      or p_base_revision is null or p_base_revision not between 0 and 1000000 then
    raise exception 'Invalid exam answers' using errcode = '22023';
  end if;
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform private.bind_pending_course_grants(v_user_id);
  perform 1 from private.discovery_previews where user_id=v_user_id for update;
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out');
  end if;
  if not private.discovery_course_allowed(v_user_id,p_course_id,clock_timestamp()) then
    return jsonb_build_object('state','not-offered');
  end if;
  select * into v_exam from private.discovery_exam_for(v_user_id, p_course_id);
  if v_exam.o_state <> 'ok' then return jsonb_build_object('state', v_exam.o_state); end if;
  v_preview := v_exam.o_preview;
  -- Still unsubmitted here means the deadline has not passed (and so neither has the pass end).
  if v_preview.submitted_at is null then
    select * into v_merge from private.discovery_reconcile_sheet(v_preview, p_tab, p_sequence, p_base_revision, p_changes);
    if v_merge.o_refusal is not null then
      -- A tab identity the exam cannot take changes from: the exam stays open for an existing tab to submit, or for
      -- this one to submit with nothing pending.
      return private.discovery_sheet_answer(v_merge.o_refusal, v_preview);
    end if;
    v_score := private.discovery_exam_score(v_preview.content, v_merge.o_sheet);
    v_grant_id := v_preview.grant_id;
    update private.discovery_previews set
        saved_answers = case when v_merge.o_apply then v_merge.o_sheet else saved_answers end,
        saved_at = case when v_merge.o_apply then clock_timestamp() else saved_at end,
        saved_revision = saved_revision + case when v_merge.o_apply then 1 else 0 end,
        saved_sources = case when v_merge.o_apply
          then private.discovery_sources_with(saved_sources, p_tab, p_sequence, clock_timestamp()) else saved_sources end,
        answers = v_merge.o_sheet, score = v_score, submitted_at = clock_timestamp()
      where grant_id = v_grant_id and kind = 'cbt' and submitted_at is null and deadline_at > clock_timestamp()
      returning * into v_preview;
    if found then
      perform private.log_entitlement_event(v_user_id, v_grant_id, 'discovery.exam-submitted', 'student',
        jsonb_build_object('course_id', p_course_id, 'score', v_score, 'total', jsonb_array_length(v_preview.content),
          'pending_applied', v_merge.o_apply));
    else
      -- The deadline passed between the check and the grading: the exam closes from the sheet saved in time.
      perform private.close_overdue_discovery_exam(v_grant_id);
      select * into v_preview from private.discovery_previews where grant_id = v_grant_id and kind = 'cbt';
    end if;
  end if;
  return jsonb_build_object('state', 'ready', 'now', clock_timestamp(), 'ends_at', (v_exam.o_grant).ends_at,
    'preview', private.discovery_preview_view(v_preview));
end;
$$;

create or replace function private.discovery_exam_for(p_user_id uuid, p_course_id uuid,
  out o_state text, out o_grant public.entitlement_grants, out o_preview private.discovery_previews)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  select * into o_grant from public.entitlement_grants
    where user_id = p_user_id and source = 'trial' and trial_policy = 'discovery';
  if o_grant.id is null then o_state := 'no-pass'; return; end if;
  if o_grant.revoked_at is not null or o_grant.starts_at > v_now then o_state := 'expired'; return; end if;
  if not private.discovery_course_allowed(p_user_id,p_course_id,v_now) then o_state := 'not-offered'; return; end if;
  perform private.close_overdue_discovery_exam(o_grant.id);
  select * into o_preview from private.discovery_previews
    where grant_id = o_grant.id and kind = 'cbt' and course_id = p_course_id for update;
  if o_preview.grant_id is null then o_state := 'not-opened'; return; end if;
  -- A graded exam (submitted, or closed at its deadline) is replayed while the pass lasts, and for the network grace
  -- after its deadline. Everything else after the pass ends fails closed.
  if o_preview.submitted_at is not null and o_grant.ends_at <= v_now
      and v_now > o_preview.deadline_at + make_interval(secs =>
        (select discovery_cbt_grace_seconds from private.entitlement_policy)) then
    o_state := 'expired'; return;
  end if;
  o_state := 'ok';
end;
$$;

create or replace function private.discovery_preview_view(p_preview private.discovery_previews) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_preview.kind='cbt' then jsonb_build_object('kind','cbt','deadline_at',p_preview.deadline_at,
    'questions',case when p_preview.submitted_at is not null then '[]'::jsonb else
      (select jsonb_agg(jsonb_build_object('item_id',q->'item_id','prompt',q->'prompt',
        'options',q->'options','section',q->'section') order by pos)
       from jsonb_array_elements(p_preview.content) with ordinality t(q,pos)) end,
    'saved',case when p_preview.submitted_at is null then jsonb_build_object('revision',p_preview.saved_revision,
      'answers',coalesce(p_preview.saved_answers,'{}'::jsonb)) end,
    'result',case when p_preview.submitted_at is not null then jsonb_build_object('score',p_preview.score,
      'total',jsonb_array_length(p_preview.content),'timed_out',p_preview.timed_out) end)
    else jsonb_build_object('kind',p_preview.kind,'items',p_preview.content) end;
$$;

-- Small maintained list; accounts on these domains have the existing ineligible state and no offer.
create or replace function private.discovery_email_allowed(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists(select 1 from auth.users u where u.id=p_user and
    split_part(lower(u.email),'@',2) = any(array['10minutemail.com','10minutemail.net','guerrillamail.com',
      'guerrillamail.net','guerrillamail.org','sharklasers.com','grr.la','mailinator.com','maildrop.cc',
      'temp-mail.org','tempmail.com','yopmail.com','yopmail.fr','getnada.com','dispostable.com','trashmail.com']))
$$;
create or replace function private.canonical_claim_email(p_email text) returns text
language sql immutable set search_path = '' as $$
  select (case when split_part(lower(btrim(p_email)),'@',2) in ('gmail.com','googlemail.com')
    then replace(split_part(split_part(lower(btrim(p_email)),'@',1),'+',1),'.','')
    else split_part(split_part(lower(btrim(p_email)),'@',1),'+',1) end) || '@' ||
    case when split_part(lower(btrim(p_email)),'@',2)='googlemail.com' then 'gmail.com'
      else split_part(lower(btrim(p_email)),'@',2) end;
$$;
create or replace function private.discovery_claim_matches(p_user uuid,p_hashes jsonb) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from private.discovery_pass_claims c where c.expires_at>clock_timestamp() and (
    exists(select 1 from jsonb_array_elements(p_hashes) h where c.claim_hash=h->>'hash'
      and c.key_version=(h->>'version')::integer)
    or exists(select 1 from auth.users old_user join auth.users cu on cu.id=p_user
      where old_user.id=c.user_id and private.canonical_claim_email(old_user.email)=
        private.canonical_claim_email(cu.email))));
$$;


create or replace function private.discovery_claim_hashes_valid(p_hashes jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_hashes) = 'array' and jsonb_array_length(p_hashes) between 1 and 16
    and not exists (select 1 from jsonb_array_elements(p_hashes) h
      where jsonb_typeof(h) <> 'object' or (select count(*) from jsonb_object_keys(h)) <> 3
        or not (h ? 'version' and h ? 'hash' and h ? 'check')
        or jsonb_typeof(h -> 'version') <> 'number'
        or (h ->> 'version') !~ '^[0-9]{1,4}$' or (h ->> 'version')::integer not between 1 and 1000
        or jsonb_typeof(h -> 'hash') <> 'string' or (h ->> 'hash') !~ '^[0-9a-f]{64}$'
        or jsonb_typeof(h -> 'check') <> 'string' or (h ->> 'check') !~ '^[0-9a-f]{64}$')
    and (select count(distinct (h->>'version',h->>'hash'))=count(*) from jsonb_array_elements(p_hashes) h)
    and not exists(select 1 from jsonb_array_elements(p_hashes) h group by h->>'version'
      having count(distinct h->>'check')<>1 or count(*)>2)
    and (select count(distinct h->>'version')<=8 from jsonb_array_elements(p_hashes) h), false);
$$;

create or replace function private.discovery_claim_keys_check(p_hashes jsonb) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_versions integer[];
begin
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim-keys', 0));
  -- (b) A registered version presented with another check value: the secret under it was replaced.
  select array_agg(k.key_version order by k.key_version) into v_versions
    from private.discovery_claim_keys k
    join jsonb_array_elements(p_hashes) h on k.key_version = (h ->> 'version')::integer
    where k.key_check <> h ->> 'check';
  if v_versions is not null then
    perform private.log_entitlement_event(null, null, 'discovery.claim-key-rejected', 'system:claim-keys',
      jsonb_build_object('reason', 'replaced', 'versions', to_jsonb(v_versions)));
    return 'claim-key-replaced';
  end if;
  -- (a) A version unexpired claims were written under that the configuration no longer carries.
  select array_agg(distinct c.key_version order by c.key_version) into v_versions
    from private.discovery_pass_claims c
    where c.expires_at > now()
      and not exists (select 1 from jsonb_array_elements(p_hashes) h where (h ->> 'version')::integer = c.key_version);
  if v_versions is not null then
    perform private.log_entitlement_event(null, null, 'discovery.claim-key-rejected', 'system:claim-keys',
      jsonb_build_object('reason', 'missing', 'versions', to_jsonb(v_versions)));
    return 'claim-key-missing';
  end if;
  insert into private.discovery_claim_keys (key_version, key_check)
    select distinct (h ->> 'version')::integer, h ->> 'check' from jsonb_array_elements(p_hashes) h
    on conflict (key_version) do update set last_seen_at = now();
  return null;
end;
$$;

create or replace function public.activate_discovery_pass(p_session_id uuid, p_claim_hashes jsonb,
  p_expected_profile_revision bigint) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
  v_claim_hash text;
  v_key_version integer;
  v_existing public.entitlement_grants;
  v_early public.entitlement_grants;
  v_grant public.entitlement_grants;
  v_today integer;
  v_key_state text;
  v_revision bigint;
begin
  if not private.discovery_claim_hashes_valid(p_claim_hashes) then
    raise exception 'Invalid activation request' using errcode = '22023';
  end if;
  -- Only a live, confirmed account that is not scheduled for deletion.
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.entitlement_policy;
  perform private.bind_pending_course_grants(v_user_id);
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim-keys',0));
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim:' || (p_claim_hashes->0->>'hash'),0));
  perform pg_advisory_xact_lock(hashtextextended('discovery-activation-global-day',0));
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out'); end if;
  if not private.discovery_email_allowed(v_user_id)
    or private.current_course_scope(v_user_id,clock_timestamp())->>'state'<>'ready' then
    return jsonb_build_object('state','trial-not-offered'); end if;
  -- Nothing is decided on a key configuration that cannot verify every unexpired claim: fail closed, audited.
  v_key_state := private.discovery_claim_keys_check(p_claim_hashes);
  if v_key_state is not null then return jsonb_build_object('state', v_key_state); end if;

  select * into v_existing from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  if v_existing.id is not null then
    return jsonb_build_object('state', 'already-activated', 'ends_at', v_existing.ends_at);
  end if;
  -- No pass while Early Access is active, so neither is spent during the free month. Not ended is enough: an
  -- enrollment that won the account lock may carry a start a moment after this transaction's clock_timestamp().
  select * into v_early from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;
  if v_early.id is not null and v_early.ends_at > clock_timestamp() then
    return jsonb_build_object('state', 'early-access-active', 'available_from', v_early.ends_at);
  end if;
  -- Nor afterwards, nor for a listed address: any Early Access ever on this account, or a list place for this confirmed
  -- email that is not excluded (owner decisions, 23 Oct 2026). Enrollment, imports and member changes take the account
  -- lock held here, so the answer cannot change before this transaction commits.
  if private.discovery_early_access_bars(v_user_id) then
    return jsonb_build_object('state', 'trial-not-offered');
  end if;
  -- D7: the selection the student saw. Held until commit, so it is the selection this pass locks.
  if p_expected_profile_revision is not null then
    select revision into v_revision from public.profiles where id = v_user_id for share;
    if v_revision is distinct from p_expected_profile_revision then
      return jsonb_build_object('state', 'selection-changed');
    end if;
  end if;

  -- The confirmed address claims at most one pass per retention period, even across deleted accounts. Expired claims
  -- no longer count (they are purged by purge_discovery_pass_claims()).
  v_claim_hash := p_claim_hashes -> 0 ->> 'hash';
  v_key_version := (p_claim_hashes -> 0 ->> 'version')::integer;
  perform pg_advisory_xact_lock(hashtextextended('discovery-claim:' || v_claim_hash, 0));
  if private.discovery_claim_matches(v_user_id,p_claim_hashes) then
    perform private.log_entitlement_event(v_user_id, null, 'discovery.claim-refused', 'student', '{}'::jsonb);
    return jsonb_build_object('state', 'already-claimed',
      'retention_months', round(extract(epoch from v_policy.discovery_claim_retention) / 2629800)::integer);
  end if;

  if v_policy.discovery_activations_per_day is not null then
    perform pg_advisory_xact_lock(hashtextextended('discovery-activation-global-day', 0));
    select count(*) into v_today from public.entitlement_grants
      where source = 'trial' and trial_policy = 'discovery'
        and created_at >= date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc';
    if v_today >= v_policy.discovery_activations_per_day then
      return jsonb_build_object('state', 'capacity');
    end if;
  end if;

  -- Start and end both come from this transaction's clock: exactly discovery_hours from activation. The AI allowance
  -- is fixed here; later policy edits never change a running pass.
  insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units,
      created_by)
    values (v_user_id, 'trial', 'discovery', clock_timestamp(), clock_timestamp() + make_interval(hours => v_policy.discovery_hours), 'capped',
      v_policy.discovery_ai_generations, 'student')
    returning * into v_grant;
  -- An expired claim of the same address (not yet purged) is replaced by the new one.
  insert into private.discovery_pass_claims (claim_hash, key_version, user_id, grant_id, expires_at)
    values (v_claim_hash, v_key_version, v_user_id, v_grant.id, clock_timestamp() + v_policy.discovery_claim_retention)
    on conflict (claim_hash) do update set key_version = excluded.key_version, user_id = excluded.user_id,
      grant_id = excluded.grant_id, claimed_at = clock_timestamp(), expires_at = excluded.expires_at;
  perform private.log_entitlement_event(v_user_id, v_grant.id, 'discovery.activated', 'student',
    jsonb_build_object('ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units, 'policy', 'discovery',
      'profile_revision', p_expected_profile_revision));
  return jsonb_build_object('state', 'activated', 'ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units);
end;
$$;

create or replace function public.discovery_pass_eligibility(p_session_id uuid, p_claim_hashes jsonb) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_now timestamptz := clock_timestamp();
begin
  if p_session_id is null or not private.discovery_claim_hashes_valid(p_claim_hashes) then
    return jsonb_build_object('eligible', false);
  end if;
  -- The conditions of ai_practice_session_user(), without its account row lock: a page read never waits on Auth.
  select s.user_id into v_user_id from auth.sessions s join auth.users u on u.id = s.user_id
    where s.id = p_session_id and (s.not_after is null or s.not_after > v_now) and u.email_confirmed_at is not null
      and (u.banned_until is null or u.banned_until <= v_now)
      and not exists (select 1 from private.account_deletion_jobs j where j.user_id = s.user_id);
  if v_user_id is null then return jsonb_build_object('eligible', false); end if;
  return jsonb_build_object('eligible',
    not exists (select 1 from public.entitlement_grants where user_id = v_user_id and source = 'trial')
    and private.discovery_email_allowed(v_user_id)
    and private.current_course_scope(v_user_id,v_now)->>'state'='ready'
    and not private.discovery_early_access_bars(v_user_id)
    and private.discovery_claim_keys_sound(p_claim_hashes)
    and not private.discovery_claim_matches(v_user_id,p_claim_hashes));
end;
$$;

create or replace function private.attempt_material_allowed(p_attempt public.quiz_attempts) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.practice_can_start(p_attempt.user_id,p_attempt.course_id,clock_timestamp());
$$;


create or replace function private.practice_view(p_attempt public.quiz_attempts) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p_attempt.id, 'course_id', p_attempt.course_id, 'mode', p_attempt.mode,
    'topic', p_attempt.topic,
    'intent', p_attempt.intent, 'redo_of', p_attempt.redo_of, 'status', p_attempt.status,
    'started_at', p_attempt.deadline_at - make_interval(secs => p_attempt.duration_seconds),
    'deadline_at', p_attempt.deadline_at, 'duration_seconds', p_attempt.duration_seconds,
    'question_count', p_attempt.question_count, 'bank_size', p_attempt.bank_size,
    'questions', case when not private.attempt_material_allowed(p_attempt) then '[]'::jsonb when p_attempt.mode = 'instant' then private.practice_instant_questions(p_attempt.id)
      else private.practice_questions(p_attempt.id, p_attempt.status <> 'in_progress') end,
    'saved', case when p_attempt.status = 'in_progress' then jsonb_build_object('revision', p_attempt.saved_revision,
      'answers', coalesce(p_attempt.saved_answers, '{}'::jsonb)) end,
    'result', case when p_attempt.status <> 'in_progress' then jsonb_build_object('score', p_attempt.score,
      'total', p_attempt.question_count, 'timed_out', p_attempt.status = 'timed_out',
      'finished_at', p_attempt.finished_at) end) || case when p_attempt.status<>'in_progress'
      then jsonb_build_object('review_available',private.attempt_material_allowed(p_attempt)) else '{}'::jsonb end;
$$;

create or replace function private.practice_answer(p_state text, p_attempt public.quiz_attempts) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_attempt.status='in_progress' and not private.attempt_material_allowed(p_attempt)
    then jsonb_build_object('state','locked') else jsonb_build_object('state', p_state, 'now', clock_timestamp(), 'attempt', private.practice_view(p_attempt)) end;
$$;

create or replace function private.practice_pick_answer(p_state text, p_attempt public.quiz_attempts,
  p_answer public.quiz_attempt_answers, p_payload jsonb) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when not private.attempt_material_allowed(p_attempt) then
    private.practice_answer(case when p_attempt.status='in_progress' then 'locked' else 'graded' end,p_attempt)
    else jsonb_build_object('state', p_state, 'now', clock_timestamp(),
    'pick', jsonb_build_object('question_id', p_answer.question_id, 'selected', p_answer.option_index,
      'correct_option', p_payload -> 'correctOption', 'is_correct', p_answer.is_correct,
      'explanation', private.practice_explanation(p_payload)),
    'attempt', private.practice_view(p_attempt)) end;
$$;

create or replace function public.practice_start(p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_intent text,
  p_redo_of uuid, p_size integer, p_seconds integer, p_sections jsonb, p_expected_size integer,
  p_expected_seconds integer, p_expected_whole_bank boolean, p_mode text default 'exam', p_topic text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_now timestamptz;
  v_attempt public.quiz_attempts;
  v_origin public.quiz_attempts;
  v_bank integer;
  v_size integer;
  v_switch uuid;
  v_closing public.quiz_attempts;
begin
  if p_attempt_id is null or p_course_id is null or p_intent is null or p_intent not in ('new', 'redo')
      or (p_intent = 'redo') <> (p_redo_of is not null)
      or p_size is null or p_size not between 1 and 100 or p_seconds is null or p_seconds not between 300 and 10800
      or p_sections is null or jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) > 100
      or exists (select 1 from jsonb_array_elements(p_sections) s where jsonb_typeof(s) <> 'string')
      or p_mode is null or p_mode not in ('exam', 'instant')
      or (p_mode = 'exam' and (p_expected_size is null or p_expected_seconds is null or p_expected_whole_bank is null
        or p_topic is not null))
      or (p_mode = 'instant' and (p_intent <> 'new' or p_expected_size is not null or p_expected_seconds is not null
        or p_expected_whole_bank is not null or p_topic is null or p_topic <> btrim(p_topic)
        or char_length(p_topic) not between 1 and 200)) then
    raise exception 'Invalid practice start' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform private.close_overdue_practice(v_user);
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;

  -- A replayed start (lost response) returns what that start created, whatever has happened to it since.
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id;
  if v_attempt.id is not null then
    if v_attempt.user_id <> v_user or v_attempt.course_id <> p_course_id or v_attempt.deadline_at is null
        or v_attempt.mode <> p_mode or v_attempt.topic is distinct from p_topic or v_attempt.intent <> p_intent
        or v_attempt.redo_of is distinct from p_redo_of then
      return jsonb_build_object('state', 'conflict');
    end if;
    return private.practice_answer(case when v_attempt.status = 'in_progress' then 'ready' else 'graded' end, v_attempt);
  end if;
  -- One open attempt per course. An open exam blocks practice (exam-open) and is returned to resume; an open instant run
  -- of the same topic is returned to finish. An exam start, or an instant start on another topic, closes an open instant
  -- run below, once this start is certain to go ahead. Any other start is returned the open attempt, as before.
  select * into v_attempt from public.quiz_attempts where user_id = v_user and course_id = p_course_id
    and status = 'in_progress' and deadline_at is not null;
  if v_attempt.id is not null then
    if v_attempt.mode = 'exam' and p_mode = 'instant' then return private.practice_answer('exam-open', v_attempt); end if;
    if not (v_attempt.mode = 'instant' and (p_mode = 'exam' or v_attempt.topic is distinct from p_topic)) then
      return private.practice_answer('in-progress', v_attempt);
    end if;
    v_switch := v_attempt.id;
  end if;

  if not exists (select 1 from public.courses where id = p_course_id) then
    return jsonb_build_object('state', 'invalid-course');
  end if;
  -- Publishing changes the item row: holding every CBT item of the course keeps the pool stable until the snapshot
  -- of revisions below commits.
  perform 1 from public.managed_content_items where course_id = p_course_id and kind = 'cbt_question' for share;
  -- The run this start would replace is the last lock: the sweep may hold it, so it is taken before the checks below,
  -- and read again here because it may have closed while this start waited.
  if v_switch is not null then
    select * into v_closing from public.quiz_attempts where id = v_switch for update;
  end if;
  -- Every lock is held. A fresh start is judged now, on the wall clock: the session must still be live and the course
  -- readable at this moment, not merely when the request began (a grant that ended while it waited starts nothing).
  v_now := clock_timestamp();
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if not private.practice_can_start(v_user, p_course_id, v_now) then
    return jsonb_build_object('state', 'locked');
  end if;
  if p_mode = 'instant' then
    select count(*)::integer into v_bank from private.practice_pool(p_course_id) pool
      where private.practice_topic_of(pool.payload) = p_topic;
    if v_bank = 0 then return jsonb_build_object('state', 'unknown-topic'); end if;
  else
    select count(*)::integer into v_bank from private.practice_pool(p_course_id);
  end if;
  if p_intent = 'new' then
    if v_bank = 0 then return jsonb_build_object('state', 'unavailable'); end if;
    v_size := least(p_size, v_bank);
  else
    select * into v_origin from public.quiz_attempts where id = p_redo_of and user_id = v_user
      and course_id = p_course_id and status <> 'in_progress' and mode = 'exam';
    if v_origin.id is null then return jsonb_build_object('state', 'not-found'); end if;
    -- Redo repeats exactly what was shown: every question still offered at the revision the student saw.
    if (select count(*) from public.quiz_attempt_questions where attempt_id = v_origin.id) <> v_origin.question_count
        or exists (select 1 from public.quiz_attempt_questions q where q.attempt_id = v_origin.id
          and not exists (select 1 from private.practice_pool(p_course_id) pool where pool.question_id = q.question_id
            and pool.item_id = q.item_id and pool.revision = q.content_revision)) then
      return jsonb_build_object('state', 'questions-changed');
    end if;
    v_size := v_origin.question_count;
  end if;
  if p_mode = 'exam' and (v_size <> p_expected_size or p_seconds <> p_expected_seconds
      or (v_bank <= v_size) is distinct from p_expected_whole_bank) then
    return jsonb_build_object('state', 'policy-changed', 'question_count', v_size, 'duration_seconds', p_seconds,
      'bank_size', v_bank);
  end if;

  -- Switching topics, or to the exam: the open run closes now, keeping its picks and their score, and the new one starts.
  -- One that reached its deadline while this start waited times out at that deadline, as close_overdue_practice would
  -- close it; one the sweep has already closed is left as it is.
  if v_closing.status = 'in_progress' then
    if v_closing.deadline_at <= v_now then
      perform private.practice_finish_instant(v_switch, 'timed_out', v_closing.deadline_at);
    else
      perform private.practice_finish_instant(v_switch, 'submitted', v_now);
    end if;
  end if;
  insert into public.quiz_attempts (id, user_id, course_id, question_count, deadline_at, duration_seconds, intent,
      redo_of, bank_size, mode, topic)
    values (p_attempt_id, v_user, p_course_id, v_size, v_now + make_interval(secs => p_seconds), p_seconds, p_intent,
      p_redo_of, v_bank, p_mode, p_topic)
    returning * into v_attempt;
  if p_intent = 'new' then
    insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
      select v_attempt.id, d.question_id, d.ordinal, d.item_id, d.revision
      from private.practice_draw_from(v_user, p_course_id, v_attempt.id, v_size, p_sections, p_topic) d;
  else
    insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
      select v_attempt.id, q.question_id, q.ordinal, q.item_id, q.content_revision
      from public.quiz_attempt_questions q where q.attempt_id = v_origin.id;
  end if;
  return private.practice_answer('ready', v_attempt);
end;
$$;

create or replace function public.practice_attempt(p_session_id uuid, p_attempt_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_attempt public.quiz_attempts;
begin
  if p_attempt_id is null then raise exception 'Invalid practice request' using errcode = '22023'; end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform private.close_overdue_practice(v_user);
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id and user_id = v_user
    and deadline_at is not null;
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if v_attempt.id is null then return jsonb_build_object('state', 'not-found'); end if;
  return private.practice_answer(case when v_attempt.status = 'in_progress' then 'ready' else 'graded' end, v_attempt);
end;
$$;

create or replace function public.practice_state(p_session_id uuid, p_course_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_attempt public.quiz_attempts;
begin
  if p_course_id is null then raise exception 'Invalid practice request' using errcode = '22023'; end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform private.close_overdue_practice(v_user);
  select * into v_attempt from public.quiz_attempts where user_id = v_user and course_id = p_course_id
    and status = 'in_progress' and deadline_at is not null;
  if v_attempt.id is null then
    select * into v_attempt from public.quiz_attempts where user_id = v_user and course_id = p_course_id
      and status <> 'in_progress' and deadline_at is not null order by finished_at desc, id desc limit 1;
  end if;
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if v_attempt.id is null then return jsonb_build_object('state', 'none', 'now', clock_timestamp()); end if;
  if v_attempt.status='in_progress' and not private.attempt_material_allowed(v_attempt) then
    return jsonb_build_object('state','none','now',clock_timestamp()); end if;
  return jsonb_build_object('state', case when v_attempt.status = 'in_progress' then 'open' else 'graded' end,
    'now', clock_timestamp(), 'attempt', jsonb_build_object('id', v_attempt.id, 'mode', v_attempt.mode,
      'status', v_attempt.status, 'intent', v_attempt.intent,
      'started_at', v_attempt.deadline_at - make_interval(secs => v_attempt.duration_seconds),
      'deadline_at', v_attempt.deadline_at, 'duration_seconds', v_attempt.duration_seconds,
      'question_count', v_attempt.question_count, 'bank_size', v_attempt.bank_size,
      'answered', (select count(*) from jsonb_object_keys(coalesce(v_attempt.saved_answers, '{}'::jsonb))),
      'score', v_attempt.score, 'finished_at', v_attempt.finished_at));
end;
$$;

create or replace function public.practice_save(p_session_id uuid, p_attempt_id uuid, p_tab uuid, p_sequence integer,
  p_base_revision integer, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_attempt public.quiz_attempts;
  v_merge record;
  v_now timestamptz;
begin
  if p_attempt_id is null or p_tab is null or p_changes is null or jsonb_typeof(p_changes) <> 'object'
      or octet_length(p_changes::text) > 8192 or p_sequence is null or p_sequence not between 0 and 1000000
      or p_base_revision is null or p_base_revision not between 0 and 1000000 then
    raise exception 'Invalid practice answers' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform private.close_overdue_practice(v_user);
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id and user_id = v_user
    and deadline_at is not null for update;
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if v_attempt.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if v_attempt.mode <> 'exam' then raise exception 'Invalid practice answers' using errcode = '22023'; end if;
  if v_attempt.status <> 'in_progress' then return private.practice_answer('graded', v_attempt); end if;
  -- Every lock is held: this reading of the wall clock is the one the save is judged by.
  v_now := clock_timestamp();
  if v_attempt.deadline_at <= v_now then
    v_attempt := private.practice_grade(v_attempt.id, coalesce(v_attempt.saved_answers, '{}'::jsonb), 'timed_out',
      v_attempt.deadline_at);
    return private.practice_answer('graded', v_attempt);
  end if;
  select * into v_merge from private.practice_reconcile(v_attempt, p_tab, p_sequence, p_base_revision, p_changes);
  if v_merge.o_refusal is not null then return private.practice_sheet_answer(v_merge.o_refusal, v_attempt); end if;
  if not v_merge.o_apply then
    return private.practice_sheet_answer(case when p_changes <> '{}'::jsonb
      and p_sequence < coalesce((v_attempt.saved_sources -> p_tab::text ->> 'seq')::integer, 0) then 'stale'
      else 'saved' end, v_attempt);
  end if;
  update public.quiz_attempts set saved_answers = v_merge.o_sheet, saved_at = v_now,
      saved_revision = saved_revision + 1,
      saved_sources = private.discovery_sources_with(saved_sources, p_tab, p_sequence, v_now)
    where id = v_attempt.id
    returning * into v_attempt;
  return private.practice_sheet_answer('saved', v_attempt);
end;
$$;

create or replace function public.practice_submit(p_session_id uuid, p_attempt_id uuid, p_tab uuid, p_sequence integer,
  p_base_revision integer, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_attempt public.quiz_attempts;
  v_merge record;
  v_now timestamptz;
begin
  if p_attempt_id is null or p_tab is null or p_changes is null or jsonb_typeof(p_changes) <> 'object'
      or octet_length(p_changes::text) > 8192 or p_sequence is null or p_sequence not between 0 and 1000000
      or p_base_revision is null or p_base_revision not between 0 and 1000000 then
    raise exception 'Invalid practice answers' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform private.close_overdue_practice(v_user);
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id and user_id = v_user
    and deadline_at is not null for update;
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if v_attempt.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if v_attempt.mode <> 'exam' then raise exception 'Invalid practice answers' using errcode = '22023'; end if;
  if v_attempt.status <> 'in_progress' then return private.practice_answer('graded', v_attempt); end if;
  v_now := clock_timestamp();
  if v_attempt.deadline_at <= v_now then
    v_attempt := private.practice_grade(v_attempt.id, coalesce(v_attempt.saved_answers, '{}'::jsonb), 'timed_out',
      v_attempt.deadline_at);
    return private.practice_answer('graded', v_attempt);
  end if;
  select * into v_merge from private.practice_reconcile(v_attempt, p_tab, p_sequence, p_base_revision, p_changes);
  if v_merge.o_refusal is not null then
    -- A tab identity the attempt cannot take changes from: it stays open for an existing tab to submit, or for this
    -- one to submit with nothing pending.
    return private.practice_sheet_answer(v_merge.o_refusal, v_attempt);
  end if;
  if v_merge.o_apply then
    update public.quiz_attempts set saved_answers = v_merge.o_sheet, saved_at = v_now,
        saved_revision = saved_revision + 1,
        saved_sources = private.discovery_sources_with(saved_sources, p_tab, p_sequence, v_now)
      where id = v_attempt.id;
  end if;
  v_attempt := private.practice_grade(v_attempt.id, v_merge.o_sheet, 'submitted', v_now);
  return private.practice_answer('graded', v_attempt);
end;
$$;

create or replace function public.practice_pick(p_session_id uuid, p_attempt_id uuid, p_question_id uuid, p_option integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_attempt public.quiz_attempts;
  v_question record;
  v_answer public.quiz_attempt_answers;
  v_now timestamptz;
begin
  if p_attempt_id is null or p_question_id is null or p_option is null or p_option not between 0 and 7 then
    raise exception 'Invalid practice pick' using errcode = '22023';
  end if;
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform private.close_overdue_practice(v_user);
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id and user_id = v_user
    and deadline_at is not null for update;
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if v_attempt.id is null then return jsonb_build_object('state', 'not-found'); end if;
  if not private.attempt_material_allowed(v_attempt) then
    return private.practice_answer('graded',v_attempt); end if;
  if v_attempt.mode <> 'instant' then raise exception 'Invalid practice pick' using errcode = '22023'; end if;
  select q.question_id, q.ordinal, r.payload into v_question
    from public.quiz_attempt_questions q
    join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
    where q.attempt_id = v_attempt.id and q.question_id = p_question_id;
  if v_question.question_id is null or p_option >= jsonb_array_length(v_question.payload -> 'options') then
    raise exception 'Invalid practice pick' using errcode = '22023';
  end if;

  select * into v_answer from public.quiz_attempt_answers
    where attempt_id = v_attempt.id and question_id = p_question_id;
  if v_answer.attempt_id is not null then
    return private.practice_pick_answer(case when v_answer.option_index = p_option then 'picked' else 'answer-locked' end,
      v_attempt, v_answer, v_question.payload);
  end if;
  if v_attempt.status <> 'in_progress' then return private.practice_answer('graded', v_attempt); end if;
  -- Every lock is held: this reading of the wall clock is the one the pick is judged by.
  v_now := clock_timestamp();
  if v_attempt.deadline_at <= v_now then
    v_attempt := private.practice_finish_instant(v_attempt.id, 'timed_out', v_attempt.deadline_at);
    return private.practice_answer('graded', v_attempt);
  end if;

  insert into public.quiz_attempt_answers
    (attempt_id, question_id, ordinal, option_index, is_correct, section_label, answered_at)
  values (v_attempt.id, p_question_id, v_question.ordinal, p_option,
    to_jsonb(p_option) = (v_question.payload -> 'correctOption'),
    coalesce(nullif(v_question.payload ->> 'section', ''), 'General'), v_now)
  returning * into v_answer;
  update public.quiz_attempts set saved_answers = coalesce(saved_answers, '{}'::jsonb)
        || jsonb_build_object(p_question_id::text, p_option),
      saved_at = v_now, saved_revision = saved_revision + 1
    where id = v_attempt.id
    returning * into v_attempt;
  -- The last question picked closes the attempt.
  if (select count(*) from public.quiz_attempt_answers where attempt_id = v_attempt.id) = v_attempt.question_count then
    v_attempt := private.practice_finish_instant(v_attempt.id, 'submitted', v_now);
  end if;
  return private.practice_pick_answer('picked', v_attempt, v_answer, v_question.payload);
end;
$$;

-- Direct correctness reads cannot bypass the service projections. History and score rows stay readable.
create or replace function private.can_read_attempt_answers(p_attempt uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid(); a public.quiz_attempts;
begin
  if u is null then return false; end if;
  perform private.open_course_access_read(u);
  perform private.require_course_access_account();
  select * into a from public.quiz_attempts where id=p_attempt and user_id=u;
  return a.id is not null and private.attempt_material_allowed(a);
end;
$$;
drop policy "Quiz answers are selectable by their attempt owner" on public.quiz_attempt_answers;
create policy "Quiz answers are selectable by their attempt owner" on public.quiz_attempt_answers
  for select to authenticated using(private.can_read_attempt_answers(attempt_id));


create or replace function private.can_read_ai_course(p_course uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare u uuid:=auth.uid();
begin
  if u is null then return false; end if;
  perform private.open_course_access_read(u);
  perform private.require_course_access_account();
  return private.ai_course_allowed(u,p_course,clock_timestamp());
end;
$$;
drop policy "Students read their own AI practice documents" on public.ai_practice_documents;
create policy "Students read their own AI practice documents" on public.ai_practice_documents
  for select to authenticated using((select auth.uid())=user_id and private.can_read_ai_course(institutional_course_id));
drop policy "Students read their own AI practice generations" on public.ai_practice_generations;
create policy "Students read their own AI practice generations" on public.ai_practice_generations
  for select to authenticated using((select auth.uid())=user_id and (select private.has_live_account_session())
    and (status='generated' or private.can_read_ai_course(institutional_course_id)));
drop policy "AI practice uploads: owner reads" on storage.objects;
create policy "AI practice uploads: owner reads" on storage.objects for select to authenticated
  using(bucket_id='ai-practice-uploads' and exists(select 1 from public.ai_practice_documents d
    where d.storage_path=name and d.user_id=(select auth.uid())));


create or replace function private.ai_practice_upload_is_open(p_name text) returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.ai_practice_documents document, private.ai_practice_policy policy
    where document.storage_path = p_name
      and document.user_id = auth.uid()
      and private.can_read_ai_course(document.institutional_course_id)
      and document.status = 'awaiting_upload'
      and document.upload_removed_at is null
      and document.extraction_claim is null
      and document.expires_at > clock_timestamp()
      and document.created_at > clock_timestamp() - make_interval(mins => policy.upload_window_minutes));
$$;

create or replace function public.create_ai_practice_document(
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
  v_discovery_uploads integer;
  v_allowance jsonb;
  v_grant_id uuid;
  v_id uuid := gen_random_uuid();
  v_today integer;
begin
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('status', 'signed-out'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  if not exists (select 1 from public.institutional_courses where id = p_institutional_course_id) then
    return jsonb_build_object('status', 'invalid-course');
  end if;
  perform private.bind_pending_course_grants(v_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-upload:' || v_user_id::text,0));
  perform 1 from public.institutional_courses where id=p_institutional_course_id for key share;
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('status','signed-out'); end if;
  if not private.ai_course_allowed(v_user_id,p_institutional_course_id,clock_timestamp()) then
    return jsonb_build_object('status','not-entitled'); end if;
  v_allowance := private.ai_allowance_admission(v_user_id, p_accepted_sources);
  if v_allowance ->> 'state' <> 'active' then return jsonb_build_object('status', v_allowance ->> 'state'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-upload:' || v_user_id::text, 0));
  select count(*) into v_today from public.ai_practice_documents
    where user_id = v_user_id and created_at > clock_timestamp() - interval '1 day';
  if v_today >= v_policy.uploads_per_day then return jsonb_build_object('status', 'upload-limit'); end if;
  if v_allowance ->> 'source' = 'trial' and private.is_discovery_grant((v_allowance ->> 'grant_id')::uuid) then
    v_grant_id := (v_allowance ->> 'grant_id')::uuid;
    select discovery_ai_uploads into strict v_discovery_uploads from private.entitlement_policy;
    if (select count(*) from private.discovery_ai_uploads where grant_id = v_grant_id) >= v_discovery_uploads then
      return jsonb_build_object('status', 'pass-upload-limit');
    end if;
  end if;
  insert into public.ai_practice_documents (id, user_id, institutional_course_id, storage_path, file_name,
    media_type, declared_bytes, expires_at, discovery_grant_id)
  values (v_id, v_user_id, p_institutional_course_id, v_user_id::text || '/' || v_id::text, p_file_name,
    p_media_type, p_declared_bytes, clock_timestamp() + make_interval(days => v_policy.source_retention_days), v_grant_id);
  return jsonb_build_object('status', 'created', 'document_id', v_id,
    'storage_path', v_user_id::text || '/' || v_id::text);
end;
$$;

create or replace function public.claim_ai_practice_extraction(p_session_id uuid, p_document_id uuid) returns jsonb
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
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform private.bind_pending_course_grants(v_user_id);
  select * into v_document from public.ai_practice_documents where id=p_document_id and user_id=v_user_id for update;
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out'); end if;
  if v_document.id is null or not private.ai_course_allowed(v_user_id,v_document.institutional_course_id,clock_timestamp()) then
    return jsonb_build_object('state','not-found'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  update public.ai_practice_documents
    set extraction_claim = v_claim,
        extraction_claimed_until = clock_timestamp() + make_interval(secs => v_policy.extraction_lease_seconds)
    where id = p_document_id and user_id = v_user_id and status = 'awaiting_upload' and expires_at > clock_timestamp()
      and (extraction_claim is null or extraction_claimed_until <= clock_timestamp());
  if found then return jsonb_build_object('state', 'claimed', 'claim_id', v_claim); end if;
  select * into v_document from public.ai_practice_documents where id = p_document_id and user_id = v_user_id;
  if not found or v_document.expires_at <= clock_timestamp() then return jsonb_build_object('state', 'not-found'); end if;
  if v_document.status <> 'awaiting_upload' then return jsonb_build_object('state', 'settled'); end if;
  return jsonb_build_object('state', 'busy');
end;
$$;

create or replace function public.settle_ai_practice_document(
  p_session_id uuid, p_document_id uuid, p_claim_id uuid, p_rejection_reason text, p_source_text text,
  p_source_sha256 text, p_word_count integer
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
  v_grant_id uuid;
  v_document public.ai_practice_documents;
  v_reason text := p_rejection_reason;
  v_text text := p_source_text;
begin
  if p_claim_id is null or (p_rejection_reason is null) = (p_source_text is null) then
    raise exception 'Exactly one of rejection or source text is required' using errcode = '22023';
  end if;
  if p_source_text is not null and (p_word_count is null
      or p_source_sha256 is distinct from encode(sha256(convert_to(p_source_text, 'UTF8')), 'hex')) then
    raise exception 'Source digest does not match the text' using errcode = '22023';
  end if;
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return false; end if;
  perform private.bind_pending_course_grants(v_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-upload:' || v_user_id::text,0));
  select * into v_document from public.ai_practice_documents where id=p_document_id and user_id=v_user_id for update;
  if private.course_session_user(p_session_id) is distinct from v_user_id or v_document.id is null
    or not private.ai_course_allowed(v_user_id,v_document.institutional_course_id,clock_timestamp()) then return false; end if;
  select discovery_grant_id into v_grant_id from public.ai_practice_documents
    where id = p_document_id and user_id = v_user_id;
  if v_text is not null and v_grant_id is not null then
    select * into strict v_policy from private.entitlement_policy;
    if char_length(v_text) > v_policy.discovery_ai_source_chars then
      v_reason := 'too-much-text';
      v_text := null;
    elsif (select count(*) from private.discovery_ai_uploads where grant_id = v_grant_id)
        >= v_policy.discovery_ai_uploads then
      v_reason := 'pass-upload-limit';
      v_text := null;
    end if;
  end if;
  update public.ai_practice_documents
    set status = case when v_reason is null then 'ready' else 'rejected' end,
        rejection_reason = v_reason, source_text = v_text,
        source_sha256 = case when v_reason is null then p_source_sha256 end,
        word_count = case when v_reason is null then p_word_count end,
        extraction_claim = null, extraction_claimed_until = null
    where id = p_document_id and user_id = v_user_id and status = 'awaiting_upload' and expires_at > clock_timestamp()
      and extraction_claim = p_claim_id;
  if not found then return false; end if;
  if v_reason is null and v_grant_id is not null then
    insert into private.discovery_ai_uploads (document_id, grant_id) values (p_document_id, v_grant_id);
  end if;
  return v_reason is not distinct from p_rejection_reason;
end;
$$;

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
  v_grant_id uuid;
  v_attempts integer;
  v_today integer;
  v_event_id uuid;
  v_generation_id uuid;
begin
  if p_request_id is null or p_document_id is null
      or coalesce(cardinality(p_accepted_sources), 0) = 0
      or not p_accepted_sources <@ array['trial', 'early_access', 'test'] then
    raise exception 'Invalid generation request' using errcode = '22023';
  end if;
  v_user_id := private.open_course_session_write(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user_id::text, 0));
  perform private.bind_pending_course_grants(v_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-global-day',0));
  perform 1 from public.ai_practice_generations where user_id=v_user_id for update;
  select * into v_document from public.ai_practice_documents where id=p_document_id and user_id=v_user_id for share;
  if private.course_session_user(p_session_id) is distinct from v_user_id then
    return jsonb_build_object('state','signed-out'); end if;
  -- A previously delivered set is the owner's even after access ends; no source is reopened on this path.
  select * into v_existing from public.ai_practice_generations where user_id=v_user_id and request_id=p_request_id;
  if v_existing.id is not null and v_existing.document_id=p_document_id and v_existing.status='generated' then
    return jsonb_build_object('state','existing','generation_id',v_existing.id,'status',v_existing.status); end if;
  if v_document.id is null or not private.ai_course_allowed(v_user_id,v_document.institutional_course_id,clock_timestamp()) then
    return jsonb_build_object('state','not-entitled'); end if;
  perform private.release_abandoned_ai_generations(v_user_id, v_policy.reservation_minutes);

  select * into v_existing from public.ai_practice_generations
    where user_id = v_user_id and request_id = p_request_id;
  if found then
    if v_existing.document_id is distinct from p_document_id then
      return jsonb_build_object('state', 'request-conflict');
    end if;
    return jsonb_build_object('state', 'existing', 'generation_id', v_existing.id, 'status', v_existing.status);
  end if;

  v_allowance := private.ai_allowance_admission(v_user_id, p_accepted_sources);
  if v_allowance ->> 'state' = 'not-entitled' then return v_allowance; end if;

  select * into v_document from public.ai_practice_documents
    where id = p_document_id and user_id = v_user_id;
  if not found or v_document.status <> 'ready' or v_document.expires_at <= clock_timestamp() then
    return jsonb_build_object('state', 'document-unavailable');
  end if;

  if exists (select 1 from public.ai_practice_generations where user_id = v_user_id and status = 'running') then
    return jsonb_build_object('state', 'busy');
  end if;
  if v_allowance ->> 'state' <> 'active' then return v_allowance; end if;

  if v_allowance ->> 'source' = 'trial' and private.is_discovery_grant((v_allowance ->> 'grant_id')::uuid) then
    v_grant_id := (v_allowance ->> 'grant_id')::uuid;
    if v_document.discovery_grant_id is distinct from v_grant_id
        or not exists (select 1 from private.discovery_ai_uploads
          where grant_id = v_grant_id and document_id = v_document.id)
        or char_length(v_document.source_text)
          > (select discovery_ai_source_chars from private.entitlement_policy) then
      return jsonb_build_object('state', 'document-unavailable');
    end if;
    select count(*) into v_attempts from public.ai_usage_events where funding_grant_id = v_grant_id;
    if v_attempts >= (select discovery_ai_attempts from private.entitlement_policy) then
      return jsonb_build_object('state', 'allowance-exhausted', 'total', v_allowance -> 'total',
        'used', v_allowance -> 'used', 'ends_at', v_allowance -> 'ends_at');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai-practice-global-day', 0));
  select count(*) into v_today from public.ai_usage_events
    where reserved_at >= date_trunc('day', clock_timestamp() at time zone 'utc') at time zone 'utc';
  if v_today >= v_policy.global_daily_generations then
    return jsonb_build_object('state', 'capacity');
  end if;

  insert into public.ai_usage_events (user_id, feature, funding_source, funding_grant_id)
    values (v_user_id, 'upload_practice', v_allowance ->> 'source', (v_allowance ->> 'grant_id')::uuid)
    returning id into v_event_id;
  insert into public.ai_practice_generations (user_id, request_id, document_id, institutional_course_id,
    usage_event_id, expires_at)
  values (v_user_id, p_request_id, p_document_id, v_document.institutional_course_id, v_event_id,
    clock_timestamp() + make_interval(days => v_policy.set_retention_days))
  returning id into v_generation_id;
  return jsonb_build_object('state', 'started', 'generation_id', v_generation_id,
    'total', (v_allowance ->> 'total')::integer, 'used', (v_allowance ->> 'used')::integer + 1,
    'ends_at', v_allowance -> 'ends_at');
end;
$$;

create or replace function public.finish_ai_practice_generation(
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
  perform private.lock_course_access_scope(p_user_id);
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || p_user_id::text,0));
  perform private.bind_pending_course_grants(p_user_id);
  perform 1 from public.ai_usage_events where id=(select usage_event_id from public.ai_practice_generations
    where id=p_generation_id and user_id=p_user_id) for update;
  select * into v_generation from public.ai_practice_generations
    where id = p_generation_id and user_id = p_user_id for update;
  if not found then return jsonb_build_object('state', 'not-found'); end if;
  if v_generation.status <> 'running' then
    return jsonb_build_object('state', 'already-finished', 'status', v_generation.status);
  end if;
  if not private.ai_course_allowed(p_user_id,v_generation.institutional_course_id,clock_timestamp()) then
    v_status:='failed'; v_reason:='account-restricted'; v_set:=null;
  end if;
  -- A set finished after deletion was scheduled can never be shown, so it is neither stored nor charged.
  if exists (select 1 from private.account_deletion_jobs where user_id = p_user_id) then
    v_status := 'failed';
    v_reason := 'account-restricted';
    v_set := null;
  end if;
  -- A Discovery Pass has one set to give: it is never spent on a partial or malformed one.
  if v_status = 'generated' and not private.discovery_ai_set_complete(v_set) and exists (
      select 1 from public.ai_usage_events event
      where event.id = v_generation.usage_event_id and private.is_discovery_grant(event.funding_grant_id)) then
    v_status := 'failed';
    v_reason := 'incomplete-set';
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

create or replace function private.effective_ai_window(p_user_id uuid, p_sources text[])
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
  select c.source, c.grant_id, c.starts_at, c.ends_at, c.total_units, c.starts_at <= clock_timestamp() and c.ends_at > clock_timestamp()
  from candidates c
  where c.starts_at <= clock_timestamp()
  order by (c.ends_at > clock_timestamp()) desc, (c.total_units is null) desc, c.ends_at desc
  limit 1;
$$;

revoke all on function private.course_session_user(uuid),private.open_course_access_read(uuid,uuid),
  private.course_on_current_list(uuid,uuid,timestamptz),private.discovery_course_allowed(uuid,uuid,timestamptz),
  private.ai_course_allowed(uuid,uuid,timestamptz),private.open_course_session_write(uuid),
  private.discovery_email_allowed(uuid),private.canonical_claim_email(text),private.discovery_claim_matches(uuid,jsonb),
  private.attempt_material_allowed(public.quiz_attempts),private.can_read_attempt_answers(uuid),private.can_read_ai_course(uuid)
  from public,anon,authenticated,service_role;
grant execute on function private.can_read_attempt_answers(uuid),private.can_read_ai_course(uuid) to authenticated;


create or replace function public.practice_progress(p_session_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  v_user := private.open_course_session_write(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.bind_pending_course_grants(v_user);
  perform private.close_overdue_practice(v_user);
  -- Locks may have waited past logout or expiry: only a live session reads its progress.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  return jsonb_build_object('state', 'ok', 'now', clock_timestamp(),
    -- The open attempt closest to its deadline (one per course at most).
    'open', (select jsonb_build_object('course_id', a.course_id, 'content_key', c.content_key,
        'deadline_at', a.deadline_at, 'mode', a.mode)
      from public.quiz_attempts a join public.courses c on c.id = a.course_id
      where private.attempt_material_allowed(a) and a.user_id = v_user and a.status = 'in_progress' and a.deadline_at is not null
      order by a.deadline_at, a.id limit 1),
    'latest', (select jsonb_build_object('course_id', a.course_id, 'content_key', c.content_key)
      from public.quiz_attempts a join public.courses c on c.id = a.course_id
      where private.attempt_material_allowed(a) and a.user_id = v_user and a.status <> 'in_progress' and a.deadline_at is not null
      order by a.finished_at desc, a.id desc limit 1),
    'courses', coalesce((select jsonb_agg(jsonb_build_object('course_id', marked.course_id,
        'practised', (select count(distinct q.question_id)::integer
          from public.quiz_attempt_answers q join public.quiz_attempts a on a.id = q.attempt_id
          where a.user_id = v_user and a.course_id = marked.course_id and a.deadline_at is not null
            and (a.status <> 'in_progress' or a.mode = 'instant')
            and q.question_id in (select pool.question_id from private.practice_pool(marked.course_id) pool)),
        'score', graded.score, 'total', graded.total) order by marked.course_id)
      from (select distinct a.course_id from public.quiz_attempts a
        where a.user_id = v_user and a.deadline_at is not null and (a.status <> 'in_progress'
          or (a.mode = 'instant' and exists (select 1 from public.quiz_attempt_answers s where s.attempt_id = a.id))))
        marked
      left join lateral (select g.score, case when g.mode = 'instant'
            then (select count(*)::integer from public.quiz_attempt_answers s where s.attempt_id = g.id)
            else g.question_count end as total
          from public.quiz_attempts g
          where g.user_id = v_user and g.course_id = marked.course_id and g.deadline_at is not null
            and g.status <> 'in_progress'
            and (g.mode = 'exam' or exists (select 1 from public.quiz_attempt_answers s where s.attempt_id = g.id))
          order by g.finished_at desc, g.id desc limit 1) graded on true), '[]'::jsonb));
end;
$$;
