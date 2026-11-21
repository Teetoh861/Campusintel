-- supabase/migrations/20261025100000_server_run_practice.sql — Run ordinary CBT practice attempts on the server
-- (design: cbt-server-practice-design.md, owner decisions D1–D10 of 2026-10-24). Runs after
-- 20261023120000_discovery_eligibility.sql and changes no earlier migration. The Discovery Pass functions are untouched;
-- their pure sheet helpers (discovery_apply_changes, discovery_sources_with) and the valid-question rule
-- (discovery_cbt_pool) are reused as they are.
--   * The database draws each attempt's questions, pins their revisions, fixes the deadline from its own clock, keeps
--     the sheet saved before it, and grades it once. Nothing is accepted from the browser but the student's choices:
--     attempt size, duration and section order come from the application server's own configuration, bounded here.
--   * No student-callable path returns a course's question bank, with or without answers. read_published_managed_content
--     no longer returns CBT rows at all; published_cbt_summary returns only a count. Questions reach a student only
--     inside their own attempt (practice_* functions, service role only), and correct options and explanations only
--     once that attempt is graded.
--   * Saved answers of an attempt still open are never marked where a student can read them: new attempts write
--     marked answer rows only at grading, and answer rows of open legacy attempts are hidden from their owner.
--   * An attempt past its deadline is graded from the sheet saved in time on the student's next request, or by the
--     five-minute pg_cron sweep, whichever comes first.
--   * Legacy (browser-run) attempts: rows with no deadline. No new one can start. They never block or resume, and
--     never count towards a draw. An old tab may save and finish one only while it is less than legacy_window
--     (24 hours) old, and the stored score is computed here.
-- Every time decision reads clock_timestamp() once the locks are held, never now(): now() is the transaction start, so
-- a request that waited on a lock would otherwise still count as in time.

-- ---------------------------------------------------------------------------
-- Policy
-- ---------------------------------------------------------------------------
create table private.practice_policy (
  singleton boolean primary key default true check (singleton),
  -- Browser tab identities one attempt takes changes from (the sequence ledger is never evicted).
  attempt_tabs integer not null default 16 check (attempt_tabs between 1 and 1000),
  -- Overdue attempts the sweep grades per run.
  sweep_batch integer not null default 500 check (sweep_batch between 1 and 10000),
  -- How long after it started a legacy attempt may still be saved or finished by an old tab (D10).
  legacy_window interval not null default interval '24 hours'
    check (legacy_window between interval '0 seconds' and interval '7 days')
);
insert into private.practice_policy default values;
alter table private.practice_policy enable row level security;
revoke all on table private.practice_policy from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Attempt rows. A server-run attempt has a deadline; a legacy attempt has none and keeps exactly what it had.
-- ---------------------------------------------------------------------------
alter table public.quiz_attempts
  add column deadline_at timestamptz,
  add column duration_seconds integer,
  add column intent text,
  add column redo_of uuid,
  -- The live bank's valid question count when the attempt started (D4 is decided from it, never by course code).
  add column bank_size integer,
  -- The latest sheet saved before the deadline ({"<question_id>": option}), its revision and the per-tab ledger.
  add column saved_answers jsonb,
  add column saved_at timestamptz,
  add column saved_revision integer not null default 0,
  add column saved_sources jsonb not null default '{}'::jsonb,
  -- Correct answers, written once at grading (and by a legacy finish), never by the browser.
  add column score integer;

alter table public.quiz_attempts
  add constraint quiz_attempts_redo_of_fkey foreign key (redo_of)
    references public.quiz_attempts (id) on delete set null,
  add constraint quiz_attempts_server_run_check check (
    (deadline_at is null) = (duration_seconds is null) and (deadline_at is null) = (intent is null)
    and (deadline_at is null) = (bank_size is null)),
  add constraint quiz_attempts_duration_check check (duration_seconds is null or duration_seconds between 300 and 10800),
  add constraint quiz_attempts_intent_check check (intent is null or intent in ('new', 'redo')),
  add constraint quiz_attempts_redo_check check (redo_of is null or (intent = 'redo' and redo_of <> id)),
  add constraint quiz_attempts_deadline_check check (deadline_at is null or deadline_at > created_at),
  add constraint quiz_attempts_bank_size_check check (bank_size is null or bank_size >= question_count),
  add constraint quiz_attempts_saved_check check (
    (saved_answers is null) = (saved_at is null) and (saved_answers is null) = (saved_revision = 0)
    and (saved_answers is null or (jsonb_typeof(saved_answers) = 'object' and deadline_at is not null))
    and jsonb_typeof(saved_sources) = 'object' and saved_revision >= 0),
  add constraint quiz_attempts_score_check check (
    (score is null or (score between 0 and question_count and status <> 'in_progress'))
    and (deadline_at is null or (status = 'in_progress') = (score is null))),
  add constraint quiz_attempts_finish_deadline_check check (
    deadline_at is null or status = 'in_progress'
    or (status = 'timed_out' and finished_at = deadline_at)
    or (status = 'submitted' and finished_at <= deadline_at));

-- One open server-run attempt per student and course. Legacy rows (no deadline) are outside it, so stuck legacy
-- attempts, duplicates included, never block a new attempt and never break this index.
create unique index quiz_attempts_one_open_practice_idx on public.quiz_attempts (user_id, course_id)
  where status = 'in_progress' and deadline_at is not null;
create index quiz_attempts_open_deadline_idx on public.quiz_attempts (deadline_at)
  where status = 'in_progress' and deadline_at is not null;
create index quiz_attempts_redo_of_idx on public.quiz_attempts (redo_of) where redo_of is not null;

comment on column public.quiz_attempts.deadline_at is
  'Server-run practice only: fixed by the database at start. Null marks a legacy browser-run attempt.';

-- Owners see marked answer rows only once their attempt is finished, so an open attempt is never an answer oracle.
alter policy "Quiz answers are selectable by their attempt owner" on public.quiz_attempt_answers
  using ((select private.has_live_account_session()) and exists (
    select 1 from public.quiz_attempts
    where quiz_attempts.id = quiz_attempt_answers.attempt_id
      and quiz_attempts.user_id = (select auth.uid())
      and quiz_attempts.status <> 'in_progress'
  ));

-- ---------------------------------------------------------------------------
-- The pool. The one definition of the questions a course offers for practice: published, valid (discovery_cbt_pool)
-- and identified. The start draws from it, the summary counts it, and Redo checks against it.
-- ---------------------------------------------------------------------------
create function private.practice_pool(p_course_id uuid)
returns table (item_id uuid, question_id uuid, revision integer, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select pool.item_id, i.question_id, pool.revision, pool.payload
  from private.discovery_cbt_pool(p_course_id) pool
  join public.managed_content_items i on i.id = pool.item_id
  where i.question_id is not null;
$$;

-- Whether a fresh attempt may start at p_at: the rule of private.can_read_course_content (a free course, an operator,
-- or full access as private.has_full_access defines it), judged at the given wall-clock moment instead of the
-- transaction start, so a grant that ends while a start waits on a lock admits nothing.
create function private.practice_can_start(p_user_id uuid, p_course_id uuid, p_at timestamptz) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and p_at is not null and (
    exists (select 1 from public.institutional_courses where repository_course_id = p_course_id and is_free)
    or exists (select 1 from public.profiles where id = p_user_id and role = 'operator')
    or exists (select 1 from public.entitlement_grants where user_id = p_user_id
      and (source <> 'trial' or trial_policy = 'seven-day') and revoked_at is null
      and starts_at <= p_at and ends_at > p_at));
$$;

-- ---------------------------------------------------------------------------
-- Student reads. The published-content read keeps every family except CBT questions; the summary gives their count.
-- ---------------------------------------------------------------------------
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
      -- CBT questions reach a student only inside their own practice attempt.
      and i.kind <> 'cbt_question'
      and (i.parent_item_id is null or exists (
        select 1 from public.managed_content_items parent
        where parent.id = i.parent_item_id
          and parent.published_revision = i.published_parent_revision
      ))
    order by i.created_at, i.id;
end;
$$;

comment on function public.read_published_managed_content(uuid) is
  'Authenticated published-only read boundary for a repository course UUID. Drafts, review history and CBT questions '
  'are never returned (see published_cbt_summary). Non-free courses require an active entitlement grant (CI403).';

-- How many questions each listed course offers for practice: the size of practice_pool, never a question. Same
-- boundary as the content read: a live account session, and CI403 when any listed course is not readable.
create function public.published_cbt_summary(p_course_ids uuid[])
returns table (course_id uuid, bank_size integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_course uuid;
begin
  v_user := private.require_live_account();
  if p_course_ids is null or cardinality(p_course_ids) not between 1 and 200
      or array_position(p_course_ids, null) is not null then
    raise exception using errcode = '22023', message = 'Course identities required';
  end if;
  foreach v_course in array p_course_ids loop
    if not private.can_read_course_content(v_user, v_course) then
      raise exception using errcode = 'CI403', message = 'Course access requires an active plan';
    end if;
  end loop;
  return query
    select listed.id, (select count(*)::integer from private.practice_pool(listed.id))
    from (select distinct unnest(p_course_ids) as id) listed
    order by listed.id;
end;
$$;

comment on function public.published_cbt_summary(uuid[]) is
  'Practice bank size per readable course: the count of private.practice_pool, which the practice start draws from. '
  'Counts only; no question, option or answer. CI403 when any listed course is not readable.';

-- ---------------------------------------------------------------------------
-- Drawing (D3): questions this student has never been given in this course first, then questions outside the previous
-- attempt, then the rest, each tier at random. Presented grouped by the server's section order, at random within a
-- section. A bank no larger than the attempt is drawn whole, in a new order (D4).
-- ---------------------------------------------------------------------------
-- Only this student's server-run attempts on the course count (legacy browser-run attempts are ignored; Discovery
-- exams are not attempts). p_attempt_id is the attempt being drawn for: never its own "previous attempt". Attempts are
-- ordered by the moment they started on the database clock.
create function private.practice_draw(p_user_id uuid, p_course_id uuid, p_attempt_id uuid, p_size integer,
  p_sections jsonb)
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
  ), picked as (
    select * from ranked order by tier, shuffle limit p_size
  )
  select picked.question_id, picked.item_id, picked.revision,
    (row_number() over (order by coalesce((select s.position from jsonb_array_elements_text(p_sections)
        with ordinality as s(name, position) where s.name = picked.section order by s.position limit 1),
      2147483647), picked.shuffle) - 1)::integer
  from picked;
$$;

-- ---------------------------------------------------------------------------
-- What a student may see of their own attempt. Open: the pinned prompts, options and sections, and the saved sheet.
-- Graded: also each question's managed identity (for reports), the choice marked, the correct option and explanation.
-- ---------------------------------------------------------------------------
create function private.practice_questions(p_attempt_id uuid, p_graded boolean) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('question_id', q.question_id, 'prompt', r.payload -> 'prompt',
      'options', r.payload -> 'options',
      'section', to_jsonb(coalesce(nullif(r.payload ->> 'section', ''), 'General')))
    || case when p_graded then jsonb_build_object('item_id', q.item_id, 'revision', q.content_revision,
      'selected', a.option_index, 'correct_option', r.payload -> 'correctOption',
      'explanation', coalesce(r.payload -> 'explanation', 'null'::jsonb)) else '{}'::jsonb end
    order by q.ordinal), '[]'::jsonb)
  from public.quiz_attempt_questions q
  join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
  left join public.quiz_attempt_answers a on a.attempt_id = q.attempt_id and a.question_id = q.question_id
  where q.attempt_id = p_attempt_id;
$$;

create function private.practice_view(p_attempt public.quiz_attempts) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', p_attempt.id, 'course_id', p_attempt.course_id, 'intent', p_attempt.intent,
    'redo_of', p_attempt.redo_of, 'status', p_attempt.status,
    'started_at', p_attempt.deadline_at - make_interval(secs => p_attempt.duration_seconds),
    'deadline_at', p_attempt.deadline_at, 'duration_seconds', p_attempt.duration_seconds,
    'question_count', p_attempt.question_count, 'bank_size', p_attempt.bank_size,
    'questions', private.practice_questions(p_attempt.id, p_attempt.status <> 'in_progress'),
    'saved', case when p_attempt.status = 'in_progress' then jsonb_build_object('revision', p_attempt.saved_revision,
      'answers', coalesce(p_attempt.saved_answers, '{}'::jsonb)) end,
    'result', case when p_attempt.status <> 'in_progress' then jsonb_build_object('score', p_attempt.score,
      'total', p_attempt.question_count, 'timed_out', p_attempt.status = 'timed_out',
      'finished_at', p_attempt.finished_at) end);
$$;

create function private.practice_answer(p_state text, p_attempt public.quiz_attempts) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('state', p_state, 'now', clock_timestamp(), 'attempt', private.practice_view(p_attempt));
$$;

-- ---------------------------------------------------------------------------
-- Grading, once. The caller holds the row lock and has seen the attempt open. Marked answer rows are written here and
-- nowhere else for a server-run attempt, so a second grading fails on their primary key instead of counting twice.
-- ---------------------------------------------------------------------------
create function private.practice_grade(p_attempt_id uuid, p_sheet jsonb, p_status text, p_finished_at timestamptz)
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

-- An attempt still open when its deadline passes is graded from the last sheet saved before it, as of the deadline.
-- Per student: run under that student's practice lock before anything of theirs is shown, saved or graded.
create function private.close_overdue_practice(p_user_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_closed integer := 0;
begin
  for v_row in select id, saved_answers, deadline_at from public.quiz_attempts
      where user_id = p_user_id and status = 'in_progress' and deadline_at is not null
        and deadline_at <= clock_timestamp()
      order by id for update
  loop
    perform private.practice_grade(v_row.id, coalesce(v_row.saved_answers, '{}'::jsonb), 'timed_out', v_row.deadline_at);
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

-- The sweep, for students who never come back. It never waits: a row a student request holds is skipped and that
-- request grades it. Rows are re-checked under their lock, so a row graded meanwhile is not graded again.
create function private.close_overdue_practice_all() returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_closed integer := 0;
begin
  for v_row in select id, saved_answers, deadline_at from public.quiz_attempts
      where status = 'in_progress' and deadline_at is not null and deadline_at <= clock_timestamp()
      order by deadline_at, id limit (select sweep_batch from private.practice_policy)
      for update skip locked
  loop
    perform private.practice_grade(v_row.id, coalesce(v_row.saved_answers, '{}'::jsonb), 'timed_out', v_row.deadline_at);
    v_closed := v_closed + 1;
  end loop;
  return v_closed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Saving. The Discovery Pass rule, over a practice attempt: one tab's changed questions laid over the sheet the
-- database holds, in that tab's sequence order only. Every key a pinned question, every value one of its options.
-- Practice cannot clear a choice, so null is refused.
-- ---------------------------------------------------------------------------
create function private.practice_changes_valid(p_attempt_id uuid, p_changes jsonb) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_typeof(p_changes) = 'object' and not exists (select 1 from jsonb_each(p_changes) c
    where not exists (select 1 from public.quiz_attempt_questions q
      join public.managed_content_revisions r on r.item_id = q.item_id and r.revision = q.content_revision
      where q.attempt_id = p_attempt_id and q.question_id::text = c.key and jsonb_typeof(c.value) = 'number'
        and c.value::text ~ '^[0-9]{1,2}$' and (c.value::text)::integer < jsonb_array_length(r.payload -> 'options')));
$$;

create function private.practice_reconcile(p_attempt public.quiz_attempts, p_tab uuid, p_sequence integer,
  p_base_revision integer, p_changes jsonb, out o_apply boolean, out o_sheet jsonb, out o_refusal text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_known boolean := p_attempt.saved_sources ? p_tab::text;
  v_applied integer := coalesce((p_attempt.saved_sources -> p_tab::text ->> 'seq')::integer, 0);
begin
  if not private.practice_changes_valid(p_attempt.id, p_changes) or p_base_revision > p_attempt.saved_revision then
    raise exception 'Invalid practice answers' using errcode = '22023';
  end if;
  o_apply := p_sequence > v_applied and p_changes <> '{}'::jsonb;
  o_refusal := null;
  if o_apply and not v_known and (select count(*) from jsonb_object_keys(p_attempt.saved_sources))
      >= (select attempt_tabs from private.practice_policy) then
    o_apply := false;
    o_refusal := 'too-many-tabs';
  end if;
  o_sheet := case when o_apply then private.discovery_apply_changes(p_attempt.saved_answers, p_changes)
    else coalesce(p_attempt.saved_answers, '{}'::jsonb) end;
end;
$$;

create function private.practice_sheet_answer(p_state text, p_attempt public.quiz_attempts) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('state', p_state, 'now', clock_timestamp(), 'deadline_at', p_attempt.deadline_at,
    'revision', p_attempt.saved_revision, 'answers', coalesce(p_attempt.saved_answers, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Service-role entry points. Identity comes from the verified session id (live, confirmed, not banned, no deletion
-- job); one advisory lock per student serializes their practice requests; overdue attempts close first.
-- ---------------------------------------------------------------------------

-- Start, or replay a start. p_size, p_seconds and p_sections are the application server's configuration; the
-- p_expected_* values are the brief the student confirmed. When they differ from what would start, nothing is created
-- and policy-changed says what would (the student is asked again). An open attempt on the course is returned instead
-- of a new one. Starting needs course access; everything after it does not (an attempt started may always finish).
create function public.practice_start(p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_intent text,
  p_redo_of uuid, p_size integer, p_seconds integer, p_sections jsonb, p_expected_size integer,
  p_expected_seconds integer)
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
      or p_expected_size is null or p_expected_seconds is null then
    raise exception 'Invalid practice start' using errcode = '22023';
  end if;
  v_user := private.ai_practice_session_user(p_session_id);
  if v_user is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('practice-account:' || v_user::text, 0));
  perform private.close_overdue_practice(v_user);

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
  if v_size <> p_expected_size or p_seconds <> p_expected_seconds then
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

-- The practice page's state for a course: the open attempt to resume, or else the student's most recent graded attempt
-- (one the deadline has just closed, or one whose submission response was lost), as a summary; none otherwise. No
-- course access needed (D7).
create function public.practice_state(p_session_id uuid, p_course_id uuid) returns jsonb
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

-- One of the student's own server-run attempts: the open view to resume, or the graded result and review. No course
-- access needed: an attempt started may finish, and its review stays the student's (D7).
create function public.practice_attempt(p_session_id uuid, p_attempt_id uuid) returns jsonb
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
  if v_attempt.id is null then return jsonb_build_object('state', 'not-found'); end if;
  return private.practice_answer(case when v_attempt.status = 'in_progress' then 'ready' else 'graded' end, v_attempt);
end;
$$;

-- Save one tab's changed questions while the attempt is open. A request with no changes (a sync) only reads the
-- clock, the deadline and the sheet. Nothing is saved at or after the deadline: the attempt is graded instead, from
-- the sheet saved in time, and the graded answer is returned.
create function public.practice_save(p_session_id uuid, p_attempt_id uuid, p_tab uuid, p_sequence integer,
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

-- Grade the attempt once, from the sheet the database holds with this tab's pending changes laid over it when they
-- are still in time. A replay returns the first grading unchanged; at or after the deadline the attempt is graded
-- from the sheet saved in time and this request's changes are not counted.
create function public.practice_submit(p_session_id uuid, p_attempt_id uuid, p_tab uuid, p_sequence integer,
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

-- ---------------------------------------------------------------------------
-- Legacy writes (hard cutover, D10). The wrapper keeps its identity, deletion and access gates and refuses every
-- old-style start. A server-run attempt is never reachable through it. A legacy attempt may be saved or finished only while it is younger than
-- legacy_window, and its stored score is computed here from the marked rows the private implementation wrote.
-- ---------------------------------------------------------------------------
create or replace function public.write_quiz_attempt(
  p_session_id uuid, p_attempt_id uuid, p_course_id uuid, p_question_count integer,
  p_operation text, p_expected_revision integer, p_status text, p_answers jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_attempt public.quiz_attempts;
  v_result jsonb;
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
  -- Hard cutover: practice attempts start on the server (practice_start). An old-style start, with its browser-chosen
  -- selection, is refused whatever it names; nothing is pinned.
  if p_operation = 'start' then
    if private.ai_practice_session_user(p_session_id) is null then return jsonb_build_object('status', 'signed-out'); end if;
    return jsonb_build_object('status', 'conflict');
  end if;
  select * into v_attempt from public.quiz_attempts where id = p_attempt_id and user_id = v_user;
  if v_attempt.id is not null and v_attempt.deadline_at is not null then
    return jsonb_build_object('status', 'not-found');
  end if;
  if v_attempt.id is not null
      and v_attempt.created_at <= clock_timestamp() - (select legacy_window from private.practice_policy) then
    return jsonb_build_object('status', 'finalized');
  end if;
  v_result := private.write_quiz_attempt(p_session_id, p_attempt_id, p_course_id, p_question_count,
    p_operation, p_expected_revision, p_status, p_answers);
  if p_operation = 'finish' and v_result ->> 'status' = 'saved' then
    update public.quiz_attempts a set score = (select count(*)::integer from public.quiz_attempt_answers s
        where s.attempt_id = a.id and s.is_correct)
      where a.id = p_attempt_id and a.status <> 'in_progress' and a.deadline_at is null;
  end if;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Entry points are the application server's (service role); students reach them only through it. The
-- summary is the one student-callable addition. Helpers are callable by no API role.
-- ---------------------------------------------------------------------------
revoke all on function private.practice_pool(uuid), private.practice_can_start(uuid, uuid, timestamptz),
  private.practice_draw(uuid, uuid, uuid, integer, jsonb),
  private.practice_questions(uuid, boolean), private.practice_view(public.quiz_attempts),
  private.practice_answer(text, public.quiz_attempts), private.practice_grade(uuid, jsonb, text, timestamptz),
  private.close_overdue_practice(uuid), private.close_overdue_practice_all(),
  private.practice_changes_valid(uuid, jsonb),
  private.practice_reconcile(public.quiz_attempts, uuid, integer, integer, jsonb),
  private.practice_sheet_answer(text, public.quiz_attempts)
  from public, anon, authenticated, service_role;
revoke all on function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer),
  public.practice_state(uuid, uuid), public.practice_attempt(uuid, uuid),
  public.practice_save(uuid, uuid, uuid, integer, integer, jsonb),
  public.practice_submit(uuid, uuid, uuid, integer, integer, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.practice_start(uuid, uuid, uuid, text, uuid, integer, integer, jsonb, integer, integer),
  public.practice_state(uuid, uuid), public.practice_attempt(uuid, uuid),
  public.practice_save(uuid, uuid, uuid, integer, integer, jsonb),
  public.practice_submit(uuid, uuid, uuid, integer, integer, jsonb)
  to service_role;
revoke all on function public.published_cbt_summary(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.published_cbt_summary(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- The sweep: every five minutes, as the job owner (pg_cron is installed by 20261023120000_discovery_eligibility.sql).
-- ---------------------------------------------------------------------------
select cron.schedule('campusintell-practice-close-overdue', '*/5 * * * *',
  'select private.close_overdue_practice_all()');
