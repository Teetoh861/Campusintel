-- supabase/migrations/20261029150000_practice_by_topic.sql — Practice by topic (owner's task of 29 Oct). Runs after
-- 20261029120000_instant_feedback_practice.sql and changes no earlier migration.
--   * A topic is a question's section label. A course's topics are the distinct labels on its practice pool, ordered by
--     the course's configured section list, then by first appearance (publication order). Unlabelled questions and the
--     catch-all labels ("Exam Practice", "Practice Examination", "Master Question Bank") are no topic: they stay in
--     Exam mode only.
--   * An instant attempt now names its topic and is drawn only from it: up to its size, in practice_draw's tiers
--     (never given first). A topic outside the course's pool is refused, and nothing starts. Exam starts are unchanged.
--   * published_cbt_topics: each topic's question count, behind the boundary of published_cbt_summary.
--   * practice_topic_progress: per topic, the questions practised and the last instant score on it.
--   * practice_can_start is unchanged.

-- ---------------------------------------------------------------------------
-- The topic of an instant attempt. Exams and instant attempts from before topics have none.
-- ---------------------------------------------------------------------------
alter table public.quiz_attempts add column topic text;
alter table public.quiz_attempts
  add constraint quiz_attempts_topic_check check (topic is null
    or (mode = 'instant' and topic = btrim(topic) and char_length(topic) between 1 and 200));

comment on column public.quiz_attempts.topic is
  'Instant feedback only: the topic (question section label) the attempt was drawn from.';

-- A question's topic: its trimmed section label, or null when it has none or the label is a catch-all.
create function private.practice_topic_of(p_payload jsonb) returns text
language sql
immutable
set search_path = ''
as $$
  select case when lower(t.label) in ('exam practice', 'practice examination', 'master question bank') then null
    else t.label end
  from (select nullif(btrim(p_payload ->> 'section'), '') as label) t;
$$;

-- The course's topics in order, with the size of each. p_sections is the course's configured section list.
create function private.practice_topics(p_course_id uuid, p_sections jsonb)
returns table (topic text, ordinal integer, bank_size integer)
language sql
stable
security definer
set search_path = ''
as $$
  with labelled as (
    select private.practice_topic_of(pool.payload) as topic,
      row_number() over (order by i.created_at, i.id) as appearance
    from private.practice_pool(p_course_id) pool
    join public.managed_content_items i on i.id = pool.item_id
  ), topics as (
    select labelled.topic, min(labelled.appearance) as appearance, count(*)::integer as bank_size
    from labelled where labelled.topic is not null group by labelled.topic
  )
  select topics.topic, (row_number() over (order by coalesce((select min(s.position)
      from jsonb_array_elements_text(p_sections) with ordinality as s(name, position)
      where btrim(s.name) = topics.topic), 2147483647), topics.appearance))::integer, topics.bank_size
  from topics
  order by 2;
$$;

-- ---------------------------------------------------------------------------
-- Drawing. practice_draw's tiers and section order over the whole pool (p_topic null) or one topic's questions. The
-- tiers still look at every server-run attempt on the course, so a question given in any mode counts as seen.
-- ---------------------------------------------------------------------------
create function private.practice_draw_from(p_user_id uuid, p_course_id uuid, p_attempt_id uuid, p_size integer,
  p_sections jsonb, p_topic text)
returns table (question_id uuid, item_id uuid, revision integer, ordinal integer)
language sql
volatile
security definer
set search_path = ''
as $$
  with given as (
    select distinct q.question_id from public.quiz_attempt_questions q
    join public.quiz_attempts a on a.id = q.attempt_id
    where a.user_id = p_user_id and a.course_id = p_course_id and a.deadline_at is not null
  ), previous as (
    select q.question_id from public.quiz_attempt_questions q
    where q.attempt_id = (select a.id from public.quiz_attempts a
      where a.user_id = p_user_id and a.course_id = p_course_id and a.deadline_at is not null
        and a.id <> p_attempt_id
      order by a.deadline_at - make_interval(secs => a.duration_seconds) desc, a.id desc
      limit 1)
  ), ranked as (
    select pool.question_id, pool.item_id, pool.revision,
      coalesce(nullif(pool.payload ->> 'section', ''), 'General') as section,
      case when pool.question_id not in (select given.question_id from given) then 0
        when pool.question_id not in (select previous.question_id from previous) then 1 else 2 end as tier,
      random() as shuffle
    from private.practice_pool(p_course_id) pool
    where p_topic is null or private.practice_topic_of(pool.payload) = p_topic
  ), picked as (
    select * from ranked order by tier, shuffle limit p_size
  )
  select picked.question_id, picked.item_id, picked.revision,
    (row_number() over (order by coalesce((select s.position from jsonb_array_elements_text(p_sections)
        with ordinality as s(name, position) where s.name = picked.section order by s.position limit 1),
      2147483647), picked.shuffle) - 1)::integer
  from picked;
$$;

create or replace function private.practice_draw(p_user_id uuid, p_course_id uuid, p_attempt_id uuid, p_size integer,
  p_sections jsonb)
returns table (question_id uuid, item_id uuid, revision integer, ordinal integer)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.practice_draw_from(p_user_id, p_course_id, p_attempt_id, p_size, p_sections, null);
$$;

-- An attempt as its student sees it now names its topic (null for an exam).
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
-- Start: the 20261029120000 start with a topic. An instant start must name one, an exam start never does. The topic
-- is judged with every lock held, like access: one outside the course's pool (or a catch-all label) starts nothing.
-- An instant attempt's bank_size is its topic's size.
-- ---------------------------------------------------------------------------
drop function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer, boolean,
  text);

create function public.practice_start(p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_intent text,
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
        or v_attempt.mode <> p_mode or v_attempt.topic is distinct from p_topic or v_attempt.intent <> p_intent
        or v_attempt.redo_of is distinct from p_redo_of then
      return jsonb_build_object('state', 'conflict');
    end if;
    return private.practice_answer(case when v_attempt.status = 'in_progress' then 'ready' else 'graded' end, v_attempt);
  end if;
  -- One open attempt per course, whatever its mode or topic: the open one is returned for the student to finish.
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

-- ---------------------------------------------------------------------------
-- The course page's topic list: each topic's question count, never a question. Same boundary as
-- published_cbt_summary: a live account session, and CI403 when the course is not readable.
-- ---------------------------------------------------------------------------
create function public.published_cbt_topics(p_course_id uuid, p_sections jsonb)
returns table (ordinal integer, topic text, bank_size integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  v_user := private.require_live_account();
  if p_course_id is null or p_sections is null or jsonb_typeof(p_sections) <> 'array'
      or jsonb_array_length(p_sections) > 100
      or exists (select 1 from jsonb_array_elements(p_sections) s where jsonb_typeof(s) <> 'string') then
    raise exception using errcode = '22023', message = 'Course identity required';
  end if;
  if not private.can_read_course_content(v_user, p_course_id) then
    raise exception using errcode = 'CI403', message = 'Course access requires an active plan';
  end if;
  return query
    select t.ordinal, t.topic, t.bank_size from private.practice_topics(p_course_id, p_sections) t order by t.ordinal;
end;
$$;

comment on function public.published_cbt_topics(uuid, jsonb) is
  'The practice topics of a readable course in order (configured sections first, then publication order), with each '
  'topic''s question count from private.practice_pool. Counts only; no question, option or answer. CI403 when the '
  'course is not readable.';

-- ---------------------------------------------------------------------------
-- The student's progress per topic: questions practised (graded attempts and instant picks, any mode, still in the
-- topic), and the last score of the latest finished instant attempt on that topic with at least one pick (correct out
-- of answered). Only topics with either are listed. Grades overdue attempts first, like practice_progress.
-- ---------------------------------------------------------------------------
create function public.practice_topic_progress(p_session_id uuid, p_course_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if p_course_id is null then raise exception 'Invalid practice request' using errcode = '22023'; end if;
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.close_overdue_practice(v_user);
  -- Locks may have waited past logout or expiry: only a live session reads its progress.
  if private.ai_practice_session_user(p_session_id) is distinct from v_user then
    return jsonb_build_object('state', 'signed-out');
  end if;
  return jsonb_build_object('state', 'ok', 'topics', coalesce((
    with pool as (
      select pool.question_id, private.practice_topic_of(pool.payload) as topic
      from private.practice_pool(p_course_id) pool
    ), answered as (
      select distinct q.question_id from public.quiz_attempt_answers q
      join public.quiz_attempts a on a.id = q.attempt_id
      where a.user_id = v_user and a.course_id = p_course_id and a.deadline_at is not null
        and (a.status <> 'in_progress' or a.mode = 'instant')
    ), practised as (
      select pool.topic, count(*)::integer as practised from pool join answered using (question_id)
      where pool.topic is not null group by pool.topic
    ), latest as (
      select distinct on (g.topic) g.topic, g.score,
        (select count(*)::integer from public.quiz_attempt_answers s where s.attempt_id = g.id) as total
      from public.quiz_attempts g
      where g.user_id = v_user and g.course_id = p_course_id and g.mode = 'instant' and g.topic is not null
        and g.status <> 'in_progress'
        and exists (select 1 from public.quiz_attempt_answers s where s.attempt_id = g.id)
      order by g.topic, g.finished_at desc, g.id desc
    )
    select jsonb_agg(jsonb_build_object('topic', coalesce(practised.topic, latest.topic),
        'practised', coalesce(practised.practised, 0), 'score', latest.score, 'total', latest.total)
      order by coalesce(practised.topic, latest.topic))
    from practised full join latest on latest.topic = practised.topic), '[]'::jsonb));
end;
$$;

comment on function public.practice_topic_progress(uuid, uuid) is
  'Per topic of one course, for the verified session: questions practised (still in the topic) and the last instant '
  'score on it (null until one exists). Counts and scores only. Service role only.';

-- ---------------------------------------------------------------------------
-- Privileges. CREATE OR REPLACE keeps existing grants; new functions are locked down here.
-- ---------------------------------------------------------------------------
revoke all on function private.practice_topic_of(jsonb), private.practice_topics(uuid, jsonb),
  private.practice_draw_from(uuid, uuid, uuid, integer, jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer,
    boolean, text, text), public.practice_topic_progress(uuid, uuid), public.published_cbt_topics(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer,
    boolean, text, text), public.practice_topic_progress(uuid, uuid)
  to service_role;
grant execute on function public.published_cbt_topics(uuid, jsonb) to authenticated;
