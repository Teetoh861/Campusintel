-- supabase/migrations/20261026110000_practice_review_fixes.sql
-- Follow up PR #136 without rewriting its merged migration. Preserve its draw, grading, deadline, D7 and sweep rules.
-- 1. Revalidate the same live session after blocking locks, including replayed/existing starts.
-- 2. Enforce D10's 24-hour legacy cutoff inside the existing writer after its session/account/attempt locks.
-- 3. Confirm whole-bank briefing mode as well as count and duration before a fresh attempt can be created.
-- CREATE OR REPLACE retains the existing function grants. Only the changed start signature is dropped/regranted.

drop function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer);

create function public.practice_start(p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_intent text,
  p_redo_of uuid, p_size integer, p_seconds integer, p_sections jsonb, p_expected_size integer,
  p_expected_seconds integer, p_expected_whole_bank boolean)
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
begin
  if p_attempt_id is null or p_course_id is null or p_intent is null or p_intent not in ('new', 'redo')
      or (p_intent = 'redo') <> (p_redo_of is not null)
      or p_size is null or p_size not between 1 and 100 or p_seconds is null or p_seconds not between 300 and 10800
      or p_sections is null or jsonb_typeof(p_sections) <> 'array' or jsonb_array_length(p_sections) > 100
      or exists (select 1 from jsonb_array_elements(p_sections) s where jsonb_typeof(s) <> 'string')
      or p_expected_size is null or p_expected_seconds is null or p_expected_whole_bank is null then
    raise exception 'Invalid practice start' using errcode = '22023';
  end if;
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.close_overdue_practice(v_user);
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;


  -- A replayed start (lost response) returns what that start created, whatever has happened to it since.
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id;
  if v_attempt.id is not null then
    if v_attempt.user_id <> v_user or v_attempt.course_id <> p_course_id or v_attempt.deadline_at is null
        or v_attempt.intent <> p_intent or v_attempt.redo_of is distinct from p_redo_of then
      return jsonb_build_object('state', 'conflict');
    end if;
    return private.practice_answer(case when v_attempt.status = 'in_progress' then 'ready' else 'graded' end, v_attempt);
  end if;
  select * into v_attempt from public.quiz_attempts where user_id = v_user and course_id = p_course_id
    and status = 'in_progress' and deadline_at is not null;
  if v_attempt.id is not null then return private.practice_answer('in-progress', v_attempt); end if;

  if not exists (select 1 from public.courses where id = p_course_id) then
    return jsonb_build_object('state', 'invalid-course');
  end if;
  -- Publishing changes the item row: holding every CBT item of the course keeps the pool stable until the snapshot
  -- of revisions below commits.
  perform 1 from public.managed_content_items where course_id = p_course_id and kind = 'cbt_question' for share;
  -- Every lock is held. A fresh start is judged now, on the wall clock: the session must still be live and the course
  -- readable at this moment, not merely when the request began (a grant that ended while it waited starts nothing).
  v_now := clock_timestamp();
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if not private.practice_can_start(v_user, p_course_id, v_now) then
    return jsonb_build_object('state', 'locked');
  end if;
  select count(*)::integer into v_bank from private.practice_pool(p_course_id);
  if p_intent = 'new' then
    if v_bank = 0 then return jsonb_build_object('state', 'unavailable'); end if;
    v_size := least(p_size, v_bank);
  else
    select * into v_origin from public.quiz_attempts where id = p_redo_of and user_id = v_user
      and course_id = p_course_id and status <> 'in_progress';
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
  if v_size <> p_expected_size or p_seconds <> p_expected_seconds
      or (v_bank <= v_size) is distinct from p_expected_whole_bank then
    return jsonb_build_object('state', 'policy-changed', 'question_count', v_size, 'duration_seconds', p_seconds,
      'bank_size', v_bank);
  end if;

  insert into public.quiz_attempts (id, user_id, course_id, question_count, deadline_at, duration_seconds, intent,
      redo_of, bank_size)
    values (p_attempt_id, v_user, p_course_id, v_size, v_now + make_interval(secs => p_seconds), p_seconds, p_intent,
      p_redo_of, v_bank)
    returning * into v_attempt;
  if p_intent = 'new' then
    insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
      select v_attempt.id, d.question_id, d.ordinal, d.item_id, d.revision
      from private.practice_draw(v_user, p_course_id, v_attempt.id, v_size, p_sections) d;
  else
    insert into public.quiz_attempt_questions (attempt_id, question_id, ordinal, item_id, content_revision)
      select v_attempt.id, q.question_id, q.ordinal, q.item_id, q.content_revision
      from public.quiz_attempt_questions q where q.attempt_id = v_origin.id;
  end if;
  return private.practice_answer('ready', v_attempt);
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
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
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
  return jsonb_build_object('state', case when v_attempt.status = 'in_progress' then 'open' else 'graded' end,
    'now', clock_timestamp(), 'attempt', jsonb_build_object('id', v_attempt.id, 'status', v_attempt.status,
      'intent', v_attempt.intent, 'started_at', v_attempt.deadline_at - make_interval(secs => v_attempt.duration_seconds),
      'deadline_at', v_attempt.deadline_at, 'duration_seconds', v_attempt.duration_seconds,
      'question_count', v_attempt.question_count, 'bank_size', v_attempt.bank_size,
      'answered', (select count(*) from jsonb_object_keys(coalesce(v_attempt.saved_answers, '{}'::jsonb))),
      'score', v_attempt.score, 'finished_at', v_attempt.finished_at));
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
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
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
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.close_overdue_practice(v_user);
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id and user_id = v_user
    and deadline_at is not null for update;
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if v_attempt.id is null then return jsonb_build_object('state', 'not-found'); end if;
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
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.close_overdue_practice(v_user);
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id and user_id = v_user
    and deadline_at is not null for update;
  -- Locks may have waited past logout or expiry. D7 waives course access, never a live session.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  if v_attempt.id is null then return jsonb_build_object('state', 'not-found'); end if;
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

create or replace function private.write_quiz_attempt(
  p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_question_count integer,
  p_operation text, p_expected_revision integer, p_status text, p_answers jsonb
)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid;
  v_not_after timestamptz;
  v_attempt public.quiz_attempts%rowtype;
  v_selected record;
  v_item public.managed_content_items%rowtype;
  v_payload jsonb;
  v_answer jsonb;
  v_canonical jsonb := '[]'::jsonb;
  v_now timestamptz;
begin
  select s.user_id, s.not_after into v_user_id, v_not_after
  from auth.sessions s join auth.users u on u.id = s.user_id
  where s.id = p_session_id
    and (s.not_after is null or s.not_after > pg_catalog.clock_timestamp())
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= pg_catalog.clock_timestamp())
  for share of s, u;
  if not found then return jsonb_build_object('status', 'signed-out'); end if;

  if p_attempt_id is null or p_course_id is null or p_question_count is null
    or p_operation is null or p_operation not in ('start', 'record', 'finish')
    or p_status is null or p_status not in ('in_progress', 'submitted', 'timed_out')
    or p_answers is null or jsonb_typeof(p_answers) <> 'array'
    or jsonb_array_length(p_answers) > 100
    or (p_operation = 'start' and (p_question_count <= 0 or p_question_count <> jsonb_array_length(p_answers)
      or p_expected_revision is not null or p_status <> 'in_progress'))
    or (p_operation <> 'start' and (p_question_count <> 0 or p_expected_revision is null
      or p_expected_revision < 0 or p_expected_revision >= 2147483647))
    or (p_operation = 'record' and (p_status <> 'in_progress' or p_answers = '[]'::jsonb))
    or (p_operation = 'finish' and p_status = 'in_progress')
  then raise exception using errcode = '22023', message = 'Invalid attempt write'; end if;

  if p_operation = 'start' then
    if exists (
      select 1 from jsonb_array_elements(p_answers) a
      where jsonb_typeof(a) <> 'object'
        or a - array['question_id', 'ordinal', 'content_revision'] <> '{}'::jsonb
        or jsonb_typeof(a->'question_id') is distinct from 'string'
        or jsonb_typeof(a->'ordinal') is distinct from 'number'
        or jsonb_typeof(a->'content_revision') is distinct from 'number'
    ) or exists (
      select 1 from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer, content_revision integer)
      where a.question_id is null or a.ordinal < 0 or a.ordinal >= p_question_count or a.content_revision <= 0
    ) or (
      select count(*) <> count(distinct a.question_id) or count(*) <> count(distinct a.ordinal)
      from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer)
    ) then raise exception using errcode = '22023', message = 'Invalid attempt questions'; end if;
  else
    if exists (
      select 1 from jsonb_array_elements(p_answers) a
      where jsonb_typeof(a) <> 'object'
        or a - array['question_id', 'ordinal', 'option_index'] <> '{}'::jsonb
        or jsonb_typeof(a->'question_id') is distinct from 'string'
        or jsonb_typeof(a->'ordinal') is distinct from 'number'
        or jsonb_typeof(a->'option_index') is distinct from 'number'
    ) or exists (
      select 1 from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer, option_index integer)
      where a.question_id is null or a.ordinal < 0 or a.option_index < 0
    ) or (
      select count(*) <> count(distinct a.question_id) or count(*) <> count(distinct a.ordinal)
      from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer)
    ) then raise exception using errcode = '22023', message = 'Invalid attempt answers'; end if;
  end if;

  select * into v_attempt from public.quiz_attempts where id = p_attempt_id for update;
  if v_not_after is not null and v_not_after <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '28000', message = 'Session expired';
  end if;
  if found and v_attempt.user_id <> v_user_id then return jsonb_build_object('status', 'not-found'); end if;
  if found and v_attempt.course_id <> p_course_id then return jsonb_build_object('status', 'conflict'); end if;
  -- The public cutover wrapper's early check cannot decide a write that waited for this row.
  -- Preserve the existing locks; judge D10 here, after all waits, on the database wall clock.
  if p_operation <> 'start' and v_attempt.id is not null and v_attempt.deadline_at is null
      and v_attempt.created_at <= clock_timestamp() - (select legacy_window from private.practice_policy) then
    return jsonb_build_object('status', 'finalized');
  end if;

  if p_operation = 'start' then
    if found then
      if v_attempt.question_count <> p_question_count or (
        select count(*) from public.quiz_attempt_questions q where q.attempt_id = p_attempt_id
      ) <> p_question_count or exists (
        select 1 from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer, content_revision integer)
        left join public.quiz_attempt_questions q on q.attempt_id = p_attempt_id and q.question_id = a.question_id
        where q.question_id is null or q.ordinal <> a.ordinal or q.content_revision <> a.content_revision
      ) then return jsonb_build_object('status', 'conflict'); end if;
    else
      -- Publication changes update the item row. The share lock keeps each
      -- selected publication stable until the snapshot commits.
      for v_selected in
        select * from jsonb_to_recordset(p_answers)
          as a(question_id uuid, ordinal integer, content_revision integer)
      loop
        select * into v_item from public.managed_content_items i
        where i.question_id = v_selected.question_id and i.course_id = p_course_id
          and i.kind = 'cbt_question' and i.published_revision = v_selected.content_revision
        for share;
        if not found then return jsonb_build_object('status', 'conflict'); end if;
        select r.payload into v_payload from public.managed_content_revisions r
        where r.item_id = v_item.id and r.revision = v_selected.content_revision;
        if not found or jsonb_typeof(v_payload->'options') <> 'array'
          or jsonb_array_length(v_payload->'options') < 2
          or jsonb_typeof(v_payload->'correctOption') <> 'number'
          or (v_payload->>'correctOption') !~ '^[0-9]+$'
          or (v_payload->>'correctOption')::integer >= jsonb_array_length(v_payload->'options')
        then raise exception using errcode = '22023', message = 'Invalid managed question'; end if;
      end loop;
      insert into public.quiz_attempts(id, user_id, course_id, question_count)
      values (p_attempt_id, v_user_id, p_course_id, p_question_count)
      on conflict (id) do nothing;
      select * into v_attempt from public.quiz_attempts where id = p_attempt_id for update;
      if v_attempt.user_id <> v_user_id then return jsonb_build_object('status', 'not-found'); end if;
      if v_attempt.course_id <> p_course_id or v_attempt.question_count <> p_question_count then
        return jsonb_build_object('status', 'conflict');
      end if;
      if not exists (select 1 from public.quiz_attempt_questions where attempt_id = p_attempt_id) then
        insert into public.quiz_attempt_questions(attempt_id, question_id, ordinal, item_id, content_revision)
        select p_attempt_id, a.question_id, a.ordinal, i.id, a.content_revision
        from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer, content_revision integer)
        join public.managed_content_items i on i.question_id = a.question_id and i.course_id = p_course_id;
      elsif exists (
        select 1 from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer, content_revision integer)
        left join public.quiz_attempt_questions q on q.attempt_id = p_attempt_id and q.question_id = a.question_id
        where q.question_id is null or q.ordinal <> a.ordinal or q.content_revision <> a.content_revision
      ) then return jsonb_build_object('status', 'conflict'); end if;
    end if;
  else
    if not found then return jsonb_build_object('status', 'not-found'); end if;
    if (select count(*) from public.quiz_attempt_questions q where q.attempt_id = p_attempt_id)
      <> v_attempt.question_count or jsonb_array_length(p_answers) > v_attempt.question_count
    then return jsonb_build_object('status', 'conflict'); end if;
    for v_answer in select value from jsonb_array_elements(p_answers)
    loop
      select r.payload into v_payload
      from public.quiz_attempt_questions q
      join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
      where q.attempt_id = p_attempt_id and q.question_id = (v_answer->>'question_id')::uuid
        and q.ordinal = (v_answer->>'ordinal')::integer;
      if not found or (v_answer->>'option_index')::integer >= jsonb_array_length(v_payload->'options') then
        raise exception using errcode = '22023', message = 'Question is not in this attempt';
      end if;
      v_canonical := v_canonical || jsonb_build_array(jsonb_build_object(
        'question_id', v_answer->>'question_id', 'ordinal', (v_answer->>'ordinal')::integer,
        'option_index', (v_answer->>'option_index')::integer,
        'is_correct', (v_answer->>'option_index')::integer = (v_payload->>'correctOption')::integer,
        'section_label', coalesce(nullif(v_payload->>'section', ''), 'General')
      ));
    end loop;

    if exists (
      select 1 from jsonb_to_recordset(v_canonical) as a(question_id uuid, ordinal integer)
      join public.quiz_attempt_answers stored on stored.attempt_id = p_attempt_id
        and (stored.question_id = a.question_id or stored.ordinal = a.ordinal)
      where stored.question_id <> a.question_id or stored.ordinal <> a.ordinal
    ) then raise exception using errcode = '22023', message = 'Invalid attempt answers'; end if;

    if v_attempt.revision = p_expected_revision + 1 and v_attempt.status = p_status
      and not exists (
        select 1 from jsonb_to_recordset(v_canonical) as a(
          question_id uuid, ordinal integer, option_index integer, is_correct boolean, section_label text
        ) left join public.quiz_attempt_answers stored
          on stored.attempt_id = p_attempt_id and stored.question_id = a.question_id
        where stored.question_id is null or stored.ordinal is distinct from a.ordinal
          or stored.option_index is distinct from a.option_index
          or stored.is_correct is distinct from a.is_correct
          or stored.section_label is distinct from a.section_label
      ) then
      null;
    elsif v_attempt.status <> 'in_progress' then
      return jsonb_build_object('status', 'finalized');
    elsif v_attempt.revision <> p_expected_revision then
      return jsonb_build_object('status', 'conflict');
    else
      v_now := pg_catalog.clock_timestamp();
      insert into public.quiz_attempt_answers as stored
        (attempt_id, question_id, ordinal, option_index, is_correct, section_label, answered_at)
      select p_attempt_id, a.question_id, a.ordinal, a.option_index, a.is_correct, a.section_label, v_now
      from jsonb_to_recordset(v_canonical) as a(
        question_id uuid, ordinal integer, option_index integer, is_correct boolean, section_label text
      )
      on conflict (attempt_id, question_id) do update
      set option_index = excluded.option_index, is_correct = excluded.is_correct,
          section_label = excluded.section_label, answered_at = v_now
      where stored.option_index is distinct from excluded.option_index
        or stored.is_correct is distinct from excluded.is_correct
        or stored.section_label is distinct from excluded.section_label;

      update public.quiz_attempts set revision = revision + 1, status = p_status,
        finished_at = case when p_status = 'in_progress' then null else v_now end
      where id = p_attempt_id returning * into v_attempt;
    end if;
  end if;

  return jsonb_build_object('status', 'saved', 'attempt', jsonb_build_object(
    'id', v_attempt.id, 'revision', v_attempt.revision,
    'status', v_attempt.status, 'questionCount', v_attempt.question_count
  ));
end;
$$;

revoke all on function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer, boolean)
  to service_role;
