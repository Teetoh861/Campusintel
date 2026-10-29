-- supabase/migrations/20261029120000_instant_feedback_practice.sql — Instant feedback practice (practice plan §C,
-- approved 2026-10-29). Runs after 20261027100000_home_practice_progress.sql and changes no earlier migration.
--   * A server-run attempt now has a mode: 'exam' (every attempt so far: timed, graded once at the end) or 'instant'.
--     Legacy browser-run attempts (no deadline) have none.
--   * An instant attempt is drawn exactly like an exam (the same pool, practice_draw tiers and section order) and is
--     started through the same practice_start, under the same access rule (practice_can_start, unchanged), the same
--     one-open-attempt-per-course index and the same replay rule. It has no brief to confirm.
--   * practice_pick records one answer, marked, the moment it is chosen, and locks it: the same choice again returns
--     the stored result unchanged, a different one is refused with the original. Only then do that question's correct
--     option and explanation leave the database. A question not yet picked never carries either.
--   * The attempt closes when its last question is picked, or at its deadline (the server's 3 hours; never shown) by
--     the student's next request or the five-minute sweep. Closing an instant attempt only counts the rows its picks
--     wrote (practice_finish_instant); it never inserts, so the sweep cannot fail on them or roll its batch back.
--   * Exam saves and submissions refuse an instant attempt; exam attempts behave exactly as before.
--   * Home's summary counts picks as practised straight away, and an instant attempt's last score is correct out of
--     answered.

-- ---------------------------------------------------------------------------
-- The mode. Existing server-run rows are exams; their updated_at is left as it was.
-- ---------------------------------------------------------------------------
alter table public.quiz_attempts add column mode text;
alter table public.quiz_attempts disable trigger quiz_attempts_set_updated_at;
update public.quiz_attempts set mode = 'exam' where deadline_at is not null;
alter table public.quiz_attempts enable trigger quiz_attempts_set_updated_at;
alter table public.quiz_attempts
  add constraint quiz_attempts_mode_check check (
    (deadline_at is null) = (mode is null) and (mode is null or mode in ('exam', 'instant'))
    -- Redo is an exam action; an instant attempt is always a fresh draw.
    and (mode is distinct from 'instant' or (intent = 'new' and redo_of is null)));

comment on column public.quiz_attempts.mode is
  'Server-run practice only: exam (graded at the end) or instant (each answer marked and locked as it is picked).';

-- ---------------------------------------------------------------------------
-- What a student sees of an open instant attempt: the pinned questions, and for each one already picked only, the
-- choice, the correct option and the explanation (null when the question has none).
-- ---------------------------------------------------------------------------
create function private.practice_explanation(p_payload jsonb) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(to_jsonb(nullif(btrim(p_payload ->> 'explanation'), '')), 'null'::jsonb);
$$;

create function private.practice_instant_questions(p_attempt_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('question_id', q.question_id, 'prompt', r.payload -> 'prompt',
      'options', r.payload -> 'options',
      'section', to_jsonb(coalesce(nullif(r.payload ->> 'section', ''), 'General')))
    || case when a.question_id is not null then jsonb_build_object('selected', a.option_index,
      'correct_option', r.payload -> 'correctOption', 'explanation', private.practice_explanation(r.payload))
      else '{}'::jsonb end
    order by q.ordinal), '[]'::jsonb)
  from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  left join public.quiz_attempt_answers a on a.attempt_id = q.attempt_id and a.question_id = q.question_id
  where q.attempt_id = p_attempt_id;
$$;

create or replace function private.practice_view(p_attempt public.quiz_attempts) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p_attempt.id, 'course_id', p_attempt.course_id, 'mode', p_attempt.mode,
    'intent', p_attempt.intent, 'redo_of', p_attempt.redo_of, 'status', p_attempt.status,
    'started_at', p_attempt.deadline_at - make_interval(secs => p_attempt.duration_seconds),
    'deadline_at', p_attempt.deadline_at, 'duration_seconds', p_attempt.duration_seconds,
    'question_count', p_attempt.question_count, 'bank_size', p_attempt.bank_size,
    'questions', case when p_attempt.mode = 'instant' and p_attempt.status = 'in_progress'
      then private.practice_instant_questions(p_attempt.id)
      else private.practice_questions(p_attempt.id, p_attempt.status <> 'in_progress') end,
    'saved', case when p_attempt.status = 'in_progress' then jsonb_build_object('revision', p_attempt.saved_revision,
      'answers', coalesce(p_attempt.saved_answers, '{}'::jsonb)) end,
    'result', case when p_attempt.status <> 'in_progress' then jsonb_build_object('score', p_attempt.score,
      'total', p_attempt.question_count, 'timed_out', p_attempt.status = 'timed_out',
      'finished_at', p_attempt.finished_at) end);
$$;

-- ---------------------------------------------------------------------------
-- Closing. An instant attempt's answer rows were written at each pick: closing only counts them. Grading an exam is
-- unchanged; practice_grade hands an instant attempt to the instant finish instead of inserting over its picks.
-- ---------------------------------------------------------------------------
create function private.practice_finish_instant(p_attempt_id uuid, p_status text, p_finished_at timestamptz)
returns public.quiz_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
begin
  if p_status not in ('submitted', 'timed_out') then
    raise exception 'Invalid grading' using errcode = '22023';
  end if;
  update public.quiz_attempts set status = p_status, finished_at = p_finished_at,
      score = (select count(*)::integer from public.quiz_attempt_answers
        where attempt_id = p_attempt_id and is_correct)
    where id = p_attempt_id and status = 'in_progress' and mode = 'instant'
    returning * into v_attempt;
  if v_attempt.id is null then raise exception 'Attempt is not open' using errcode = '55000'; end if;
  return v_attempt;
end;
$$;

create or replace function private.practice_grade(p_attempt_id uuid, p_sheet jsonb, p_status text,
  p_finished_at timestamptz)
returns public.quiz_attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.quiz_attempts;
begin
  if p_status not in ('submitted', 'timed_out') then
    raise exception 'Invalid grading' using errcode = '22023';
  end if;
  if exists (select 1 from public.quiz_attempts where id = p_attempt_id and mode = 'instant') then
    return private.practice_finish_instant(p_attempt_id, p_status, p_finished_at);
  end if;
  insert into public.quiz_attempt_answers
    (attempt_id, question_id, ordinal, option_index, is_correct, section_label, answered_at)
  select q.attempt_id, q.question_id, q.ordinal, (p_sheet ->> q.question_id::text)::integer,
    (p_sheet -> q.question_id::text) = (r.payload -> 'correctOption'),
    coalesce(nullif(r.payload ->> 'section', ''), 'General'), coalesce(a.saved_at, p_finished_at)
  from public.quiz_attempt_questions q
  join public.quiz_attempts a on a.id = q.attempt_id
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  where q.attempt_id = p_attempt_id and p_sheet ? q.question_id::text;
  update public.quiz_attempts set status = p_status, finished_at = p_finished_at,
      score = (select count(*)::integer from public.quiz_attempt_answers
        where attempt_id = p_attempt_id and is_correct)
    where id = p_attempt_id and status = 'in_progress' and deadline_at is not null
    returning * into v_attempt;
  if v_attempt.id is null then raise exception 'Attempt is not open' using errcode = '55000'; end if;
  return v_attempt;
end;
$$;

-- Both closers branch on mode: an exam is graded from the sheet saved in time, an instant attempt from its picks.
create or replace function private.close_overdue_practice(p_user_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_closed integer := 0;
begin
  for v_row in select id, mode, saved_answers, deadline_at from public.quiz_attempts
      where user_id = p_user_id and status = 'in_progress' and deadline_at is not null
        and deadline_at <= clock_timestamp()
      order by id for update
  loop
    if v_row.mode = 'instant' then
      perform private.practice_finish_instant(v_row.id, 'timed_out', v_row.deadline_at);
    else
      perform private.practice_grade(v_row.id, coalesce(v_row.saved_answers, '{}'::jsonb), 'timed_out',
        v_row.deadline_at);
    end if;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

create or replace function private.close_overdue_practice_all() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_closed integer := 0;
begin
  for v_row in select id, mode, saved_answers, deadline_at from public.quiz_attempts
      where status = 'in_progress' and deadline_at is not null and deadline_at <= clock_timestamp()
      order by deadline_at, id limit (select sweep_batch from private.practice_policy)
      for update skip locked
  loop
    if v_row.mode = 'instant' then
      perform private.practice_finish_instant(v_row.id, 'timed_out', v_row.deadline_at);
    else
      perform private.practice_grade(v_row.id, coalesce(v_row.saved_answers, '{}'::jsonb), 'timed_out',
        v_row.deadline_at);
    end if;
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Start: the 20261026110000 start with a mode. p_mode defaults to 'exam', so a caller that names no mode starts
-- exactly what it started before. An instant start has no brief: its p_expected_* are null and never compared.
-- ---------------------------------------------------------------------------
drop function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer, boolean);

create function public.practice_start(p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_intent text,
  p_redo_of uuid, p_size integer, p_seconds integer, p_sections jsonb, p_expected_size integer,
  p_expected_seconds integer, p_expected_whole_bank boolean, p_mode text default 'exam')
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
      or p_mode is null or p_mode not in ('exam', 'instant')
      or (p_mode = 'exam' and (p_expected_size is null or p_expected_seconds is null or p_expected_whole_bank is null))
      or (p_mode = 'instant' and (p_intent <> 'new' or p_expected_size is not null or p_expected_seconds is not null
        or p_expected_whole_bank is not null)) then
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
        or v_attempt.mode <> p_mode or v_attempt.intent <> p_intent or v_attempt.redo_of is distinct from p_redo_of then
      return jsonb_build_object('state', 'conflict');
    end if;
    return private.practice_answer(case when v_attempt.status = 'in_progress' then 'ready' else 'graded' end, v_attempt);
  end if;
  -- One open attempt per course, whatever its mode: the open one is returned for the student to finish.
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

  insert into public.quiz_attempts (id, user_id, course_id, question_count, deadline_at, duration_seconds, intent,
      redo_of, bank_size, mode)
    values (p_attempt_id, v_user, p_course_id, v_size, v_now + make_interval(secs => p_seconds), p_seconds, p_intent,
      p_redo_of, v_bank, p_mode)
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

-- ---------------------------------------------------------------------------
-- The pick. Same lock order as every practice request: the student's practice lock, overdue attempts closed, then the
-- attempt row. A question already picked answers from its stored row, open or closed, so a double tap, a second tab
-- or a lost response always gets the first result; nothing new is recorded once the attempt has closed.
-- ---------------------------------------------------------------------------
create function private.practice_pick_answer(p_state text, p_attempt public.quiz_attempts,
  p_answer public.quiz_attempt_answers, p_payload jsonb) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('state', p_state, 'now', clock_timestamp(),
    'pick', jsonb_build_object('question_id', p_answer.question_id, 'selected', p_answer.option_index,
      'correct_option', p_payload -> 'correctOption', 'is_correct', p_answer.is_correct,
      'explanation', private.practice_explanation(p_payload)),
    'attempt', private.practice_view(p_attempt));
$$;

create function public.practice_pick(p_session_id uuid, p_attempt_id uuid, p_question_id uuid, p_option integer)
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

-- ---------------------------------------------------------------------------
-- Reads and exam writes. practice_state names the mode; exam saves and submissions refuse an instant attempt (its
-- answers are recorded only by practice_pick).
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Home's summary. Picks count as practised the moment they are made (an open exam attempt still adds nothing: it has
-- no answer rows until graded). The last score is the latest finished attempt's: an exam's correct out of its
-- questions, as before; an instant attempt's correct out of the questions answered (one closed with no pick has no
-- score and is passed over). A course practised only in an open instant attempt has no last score yet.
-- ---------------------------------------------------------------------------
create or replace function public.practice_progress(p_session_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
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
      where a.user_id = v_user and a.status = 'in_progress' and a.deadline_at is not null
      order by a.deadline_at, a.id limit 1),
    'latest', (select jsonb_build_object('course_id', a.course_id, 'content_key', c.content_key)
      from public.quiz_attempts a join public.courses c on c.id = a.course_id
      where a.user_id = v_user and a.status <> 'in_progress' and a.deadline_at is not null
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

comment on function public.practice_progress(uuid) is
  'Home''s practice summary for the verified session: the open attempt closest to its deadline (with its mode), the '
  'course last graded, and per course the questions answered (graded attempts and instant picks, still in the pool) '
  'and the last score (null until one exists). Server-run attempts only; grades overdue attempts first. Counts and '
  'scores only. Service role only.';

-- ---------------------------------------------------------------------------
-- Privileges. CREATE OR REPLACE keeps existing grants; new functions are locked down here.
-- ---------------------------------------------------------------------------
revoke all on function private.practice_explanation(jsonb), private.practice_instant_questions(uuid),
  private.practice_finish_instant(uuid, text, timestamptz),
  private.practice_pick_answer(text, public.quiz_attempts, public.quiz_attempt_answers, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer,
    boolean, text), public.practice_pick(uuid, uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer,
    boolean, text), public.practice_pick(uuid, uuid, uuid, integer)
  to service_role;
