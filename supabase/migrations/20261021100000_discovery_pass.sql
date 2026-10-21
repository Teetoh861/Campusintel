-- supabase/migrations/20261021100000_discovery_pass.sql — Replace the seven-day full-access trial with the Discovery
-- Pass (founder decisions, 2026-10-20). Runs after 20261017100000_trial_entitlements.sql and
-- 20261020100000_bua_300l_catalogue_correction.sql, and changes nothing in either.
-- The phone-OTP activation, its once-per-account and once-per-phone claims, Early Access and paid/manual grants are
-- kept as they are. What changes is what a newly issued 'trial' grant buys. Every trial grant now names its policy
-- (trial_policy). A grant issued before this migration is 'seven-day' and keeps exactly what it was issued: its own
-- end, full access and its AI allowance. A grant issued from now on is 'discovery': a restricted sampling entitlement,
-- never temporary full access:
--   * It lasts discovery_hours (72) from verified activation, measured on the database clock.
--   * Non-free courses stay locked (read_published_managed_content still raises CI403), so no course can ever be read
--     whole with a pass.
--   * One complete CBT exam of exactly discovery_cbt_questions (50) valid questions from one actively offered course
--     the student selects. It opens only when the whole of that course's own exam duration fits before the pass ends;
--     the database fixes the deadline then, and no answer is accepted after it. The answer key stays on the server
--     until the exam is graded.
--   * One complete study-guide topic, chosen by the student from one actively offered course. Every other topic stays
--     locked.
--   * AI: one accepted upload and one delivered set of exactly five valid questions, at most discovery_ai_attempts
--     provider attempts and discovery_ai_source_chars of extracted text.
--   * Nothing replenishes. There is no theory preview; it is not part of the approved pass.
-- Free courses never consume anything. Every decision reads now() inside the deciding transaction; no browser clock,
-- duration or balance is accepted anywhere.

-- ---------------------------------------------------------------------------
-- Policy. Initial limits; configurable, never a reset schedule.
-- ---------------------------------------------------------------------------
alter table private.entitlement_policy
  add column discovery_hours integer not null default 72 check (discovery_hours between 1 and 168),
  add column discovery_cbt_questions integer not null default 50 check (discovery_cbt_questions between 1 and 100),
  -- How long after the exam deadline an already graded result may still be replayed to a client whose response was
  -- lost, even just after the pass ends. It never extends answering time: nothing is accepted after the deadline.
  add column discovery_cbt_grace_seconds integer not null default 120
    check (discovery_cbt_grace_seconds between 0 and 600),
  -- Delivered AI sets for the whole pass. Only a delivered set consumes one; failures release it.
  add column discovery_ai_generations integer not null default 1 check (discovery_ai_generations between 0 and 5),
  -- Provider attempts for the whole pass, delivered or not, so failed generations cannot be retried without limit.
  add column discovery_ai_attempts integer not null default 3 check (discovery_ai_attempts between 1 and 10),
  -- Accepted (readable) uploads for the whole pass. An unreadable file is rejected before any AI call and does not
  -- count; the daily upload cap still bounds retries.
  add column discovery_ai_uploads integer not null default 1 check (discovery_ai_uploads between 1 and 10),
  -- Extracted text a Discovery upload may carry (about 3,000 words), bounding the cost of each attempt.
  add column discovery_ai_source_chars integer not null default 20000
    check (discovery_ai_source_chars between 2000 and 60000),
  add constraint entitlement_policy_discovery_ai_check check (discovery_ai_attempts >= discovery_ai_generations);
-- A 72-hour pass would otherwise show its "ends soon" notice for most of its life.
update private.entitlement_policy set expiry_notice_hours = 12;
comment on column private.entitlement_policy.trial_days is
  'Length of seven-day trials issued before 20261021100000_discovery_pass.sql. New grants last discovery_hours.';
comment on column private.ai_practice_policy.trial_units is
  'AI units of seven-day trials issued before 20261021100000_discovery_pass.sql. New grants get discovery_ai_generations.';

-- ---------------------------------------------------------------------------
-- Every trial grant names the policy it was issued under. Grants issued before this migration were seven-day full
-- access trials and keep exactly that: their end, their full access and their AI allowance are not touched. Only a
-- grant verify_trial_otp() issues from now on is a Discovery Pass.
-- ---------------------------------------------------------------------------
alter table public.entitlement_grants
  add column trial_policy text check (trial_policy in ('seven-day', 'discovery'));
-- discovery-pass:legacy-trial-backfill:start
with preserved as (
  update public.entitlement_grants set trial_policy = 'seven-day'
    where source = 'trial' and trial_policy is null
    returning id, user_id, ends_at, ai_units
)
insert into private.entitlement_events (user_id, grant_id, event, actor, detail)
  select user_id, id, 'trial.seven-day-preserved', 'migration:20261021100000',
    jsonb_build_object('ends_at', ends_at, 'ai_units', ai_units) from preserved;
-- discovery-pass:legacy-trial-backfill:end
alter table public.entitlement_grants
  add constraint entitlement_grants_trial_policy_source_check check ((source = 'trial') = (trial_policy is not null));
comment on column public.entitlement_grants.trial_policy is
  'Trial grants only. seven-day: issued before 20261021100000, full access for its own window. discovery: the Discovery Pass.';

-- ---------------------------------------------------------------------------
-- Full access excludes the Discovery Pass. Every existing gate (published content read, quiz-attempt start, theory
-- feedback, course read model) goes through this function, so they all close at once for a pass, while a seven-day
-- trial issued earlier keeps full access until its own end.
-- ---------------------------------------------------------------------------
create or replace function private.has_full_access(p_user_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.entitlement_grants
    where user_id = p_user_id and (source <> 'trial' or trial_policy = 'seven-day') and revoked_at is null
      and starts_at <= now() and ends_at > now());
$$;

create function private.is_discovery_grant(p_grant_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.entitlement_grants
    where id = p_grant_id and source = 'trial' and trial_policy = 'discovery');
$$;

-- A repository course is offered when an institutional course that owns it applies to at least one active department,
-- level and semester, the same rule the student catalogue uses (lib/courses/read-model.ts hasActiveCourseOffering).
-- Retired identities and their history stay intact; they are just not offered.
create function private.course_has_active_offering(p_course_id uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.institutional_courses course
    join public.course_applicability a on a.institutional_course_id = course.id
    join public.departments d on d.id = a.department_id and d.is_active
    join public.academic_levels l on l.id = a.academic_level_id and l.is_active
    join public.academic_periods p on p.id = a.academic_period_id and p.is_active
    where course.repository_course_id = p_course_id);
$$;

-- ---------------------------------------------------------------------------
-- Previews. One row per pass and kind, pinned to one course (and, for the study guide, one topic) at the first open
-- and frozen there, so a refresh, a network retry, another device or a later republish shows the same material and
-- never a wider slice.
-- ---------------------------------------------------------------------------
create table private.discovery_previews (
  grant_id uuid not null references public.entitlement_grants (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('cbt', 'study_guide')),
  course_id uuid not null references public.courses (id) on delete restrict,
  -- The exact material shown. For CBT this includes the answer key, which only grading reveals.
  content jsonb not null check (jsonb_typeof(content) = 'array' and jsonb_array_length(content) between 1 and 100
    and octet_length(content::text) <= 1048576),
  -- CBT only: fixed by the database when the exam opens, never later than the pass end.
  deadline_at timestamptz,
  -- CBT only: the latest answer sheet saved before the deadline. If time runs out, this is what is marked.
  saved_answers jsonb check (saved_answers is null or jsonb_typeof(saved_answers) = 'object'),
  saved_at timestamptz,
  answers jsonb check (answers is null or jsonb_typeof(answers) = 'object'),
  score integer check (score >= 0),
  -- The exam closed at its deadline before the student submitted it.
  timed_out boolean not null default false,
  claimed_at timestamptz not null default now(),
  submitted_at timestamptz,
  primary key (grant_id, kind),
  constraint discovery_previews_deadline_check check ((kind = 'cbt') = (deadline_at is not null)),
  constraint discovery_previews_saved_check check ((saved_answers is null) = (saved_at is null)
    and (kind = 'cbt' or saved_answers is null)),
  constraint discovery_previews_submit_check check (
    (submitted_at is null) = (answers is null) and (answers is null) = (score is null)
    and (kind = 'cbt' or submitted_at is null) and (submitted_at is not null or not timed_out))
);
create index discovery_previews_user_idx on private.discovery_previews (user_id);
alter table private.discovery_previews enable row level security;
revoke all on table private.discovery_previews from public, anon, authenticated, service_role;

-- A published CBT question the exam screen can show and the server can mark: a prompt, two to eight non-empty
-- options, and a correct option among them. Section and explanation are optional text.
create function private.discovery_cbt_question_valid(p_payload jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_payload) = 'object'
    and jsonb_typeof(p_payload -> 'prompt') = 'string' and btrim(p_payload ->> 'prompt') <> ''
    and jsonb_typeof(p_payload -> 'options') = 'array' and jsonb_array_length(p_payload -> 'options') between 2 and 8
    and not exists (select 1 from jsonb_array_elements(p_payload -> 'options') o
      where jsonb_typeof(o) <> 'string' or btrim(o #>> '{}') = '')
    and jsonb_typeof(p_payload -> 'correctOption') = 'number' and (p_payload ->> 'correctOption') ~ '^[0-9]$'
    and (p_payload ->> 'correctOption')::integer < jsonb_array_length(p_payload -> 'options')
    and coalesce(jsonb_typeof(p_payload -> 'section'), 'null') in ('string', 'null')
    and coalesce(jsonb_typeof(p_payload -> 'explanation'), 'null') in ('string', 'null'), false);
$$;

-- The course's published, valid CBT questions: the only pool an exam is drawn from.
create function private.discovery_cbt_pool(p_course_id uuid)
returns table (item_id uuid, revision integer, payload jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.published_revision, r.payload
  from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  where i.course_id = p_course_id and i.kind = 'cbt_question' and i.published_revision is not null
    and private.discovery_cbt_question_valid(r.payload);
$$;

-- The material one preview pins, chosen on the server from the course's published revisions. Empty when the course
-- cannot offer it whole (fewer than discovery_cbt_questions valid questions, or the chosen topic is not one of its
-- published topics), in which case nothing is claimed.
create function private.discovery_preview_content(p_course_id uuid, p_kind text, p_item_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy private.entitlement_policy;
  v_content jsonb;
begin
  select * into strict v_policy from private.entitlement_policy;
  if p_kind = 'cbt' then
    -- A random exam from the whole valid bank, like a real attempt, and never a partial one.
    with picked as (
      select pool.item_id, pool.revision, pool.payload, random() as position
      from private.discovery_cbt_pool(p_course_id) pool
      order by position limit v_policy.discovery_cbt_questions
    )
    select coalesce(jsonb_agg(jsonb_build_object('item_id', item_id, 'revision', revision,
        'prompt', payload -> 'prompt', 'options', payload -> 'options',
        'section', coalesce(nullif(payload -> 'section', 'null'::jsonb), to_jsonb('General'::text)),
        'correct_option', payload -> 'correctOption',
        'explanation', coalesce(payload -> 'explanation', 'null'::jsonb)) order by position), '[]'::jsonb)
      into v_content from picked;
    if jsonb_array_length(v_content) <> v_policy.discovery_cbt_questions then return '[]'::jsonb; end if;
  elsif p_kind = 'study_guide' then
    -- The one topic the student chose, complete and exactly as published.
    select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'revision', i.published_revision,
        'note', r.payload)), '[]'::jsonb)
      into v_content
      from public.managed_content_items i
      join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
      where i.id = p_item_id and i.course_id = p_course_id and i.kind = 'note' and i.published_revision is not null;
  else
    raise exception 'Unknown preview kind' using errcode = '22023';
  end if;
  return v_content;
end;
$$;

-- Topic titles of a course, so the student can choose which one to open. Titles only, never a body.
create function private.discovery_topic_titles(p_course_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'title', r.payload ->> 'title')
      order by i.created_at, i.id), '[]'::jsonb)
  from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  where i.course_id = p_course_id and i.kind = 'note' and i.published_revision is not null;
$$;

-- What the student may see of a pinned preview. An exam shows no answer key until it has been graded.
create function private.discovery_preview_view(p_preview private.discovery_previews) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_preview.kind = 'cbt' then jsonb_build_object('kind', 'cbt',
      'deadline_at', p_preview.deadline_at,
      'questions', (select jsonb_agg(jsonb_build_object('item_id', q -> 'item_id', 'prompt', q -> 'prompt',
          'options', q -> 'options', 'section', q -> 'section') order by position)
        from jsonb_array_elements(p_preview.content) with ordinality as t(q, position)),
      'result', case when p_preview.submitted_at is null then null else jsonb_build_object(
        'score', p_preview.score, 'total', jsonb_array_length(p_preview.content), 'timed_out', p_preview.timed_out,
        'answers', (select jsonb_agg(jsonb_build_object('item_id', q -> 'item_id',
            'selected', p_preview.answers -> (q ->> 'item_id'), 'correct_option', q -> 'correct_option',
            'explanation', q -> 'explanation') order by position)
          from jsonb_array_elements(p_preview.content) with ordinality as t(q, position))) end)
    else jsonb_build_object('kind', p_preview.kind, 'items', p_preview.content) end;
$$;

-- Every key must be a pinned question and every value one of its options; unanswered questions are allowed.
create function private.discovery_answers_valid(p_content jsonb, p_answers jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (select 1 from jsonb_each(p_answers) a
    where not exists (select 1 from jsonb_array_elements(p_content) q
      where q ->> 'item_id' = a.key and jsonb_typeof(a.value) = 'number'
        and a.value::text ~ '^[0-9]+$' and (a.value::text)::integer < jsonb_array_length(q -> 'options')));
$$;

create function private.discovery_exam_score(p_content jsonb, p_answers jsonb) returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer from jsonb_array_elements(p_content) q
    where p_answers -> (q ->> 'item_id') = q -> 'correct_option';
$$;

-- An exam still unsubmitted when its deadline passes is closed and marked from the last sheet saved before the
-- deadline. Run under the account lock before any exam is shown, saved or graded, so nothing sent after the deadline
-- can ever be marked.
create function private.close_overdue_discovery_exam(p_grant_id uuid) returns void
language sql
security definer
set search_path = ''
as $$
  with closed as (
    update private.discovery_previews p
      set answers = coalesce(p.saved_answers, '{}'::jsonb),
          score = private.discovery_exam_score(p.content, coalesce(p.saved_answers, '{}'::jsonb)),
          submitted_at = p.deadline_at, timed_out = true
      where p.grant_id = p_grant_id and p.kind = 'cbt' and p.submitted_at is null and now() > p.deadline_at
      returning p.user_id, p.grant_id, p.course_id, p.score, jsonb_array_length(p.content) as total
  )
  insert into private.entitlement_events (user_id, grant_id, event, actor, detail)
    select user_id, grant_id, 'discovery.exam-timed-out', 'system:deadline',
      jsonb_build_object('course_id', course_id, 'score', score, 'total', total) from closed;
$$;

-- ---------------------------------------------------------------------------
-- Preview open (service role; identity from the verified session id). p_claim false only reads; p_claim true pins one
-- if this pass has not used that kind yet. Serialized per account, so concurrent opens on two courses pin exactly one;
-- replays of the same open return the same preview.
-- p_item_id is the chosen topic (study guide only). p_exam_seconds is the course's own CBT duration from the server's
-- quiz configuration (CBT only; required to open, optional on a read); the browser never supplies it. The database
-- bounds it and opens the exam only when the whole duration fits before the pass ends.
-- ---------------------------------------------------------------------------
create function public.discovery_preview(p_session_id uuid, p_course_id uuid, p_kind text, p_claim boolean,
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
begin
  if p_course_id is null or p_claim is null or p_kind is null or p_kind not in ('cbt', 'study_guide')
      or (p_exam_seconds is not null and (p_kind <> 'cbt' or p_exam_seconds not between 300 and 10800))
      or (p_claim and p_kind = 'cbt' and p_exam_seconds is null)
      or (p_claim and p_kind = 'study_guide' and p_item_id is null) then
    raise exception 'Invalid preview request' using errcode = '22023';
  end if;
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  -- Same per-account lock as trial activation and Early Access enrollment.
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user_id::text, 0));
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
  if v_grant.trial_policy <> 'discovery' or v_grant.revoked_at is not null or v_grant.ends_at <= now()
      or v_grant.starts_at > now() then
    return jsonb_build_object('state', 'expired');
  end if;
  if not private.course_has_active_offering(p_course_id) then
    return jsonb_build_object('state', 'not-offered');
  end if;

  perform private.close_overdue_discovery_exam(v_grant.id);
  select * into v_preview from private.discovery_previews where grant_id = v_grant.id and kind = p_kind;
  if v_preview.grant_id is not null and v_preview.course_id <> p_course_id then
    return jsonb_build_object('state', 'used-elsewhere', 'now', now(), 'ends_at', v_grant.ends_at,
      'content_key', (select content_key from public.courses where id = v_preview.course_id));
  end if;
  if v_preview.grant_id is null then
    if p_kind = 'cbt' and (select count(*) from private.discovery_cbt_pool(p_course_id))
        < v_policy.discovery_cbt_questions then
      return jsonb_build_object('state', 'nothing-to-preview');
    end if;
    -- The exam runs for the course's whole duration or not at all: it is never shortened to fit the pass.
    if p_kind = 'cbt' and p_exam_seconds is not null
        and now() + make_interval(secs => p_exam_seconds) > v_grant.ends_at then
      return jsonb_build_object('state', 'not-enough-time', 'now', now(), 'ends_at', v_grant.ends_at);
    end if;
    if not p_claim then
      return jsonb_build_object('state', 'available', 'now', now(), 'ends_at', v_grant.ends_at,
        'topics', case when p_kind = 'study_guide' then private.discovery_topic_titles(p_course_id) end);
    end if;
    v_content := private.discovery_preview_content(p_course_id, p_kind, p_item_id);
    if jsonb_array_length(v_content) = 0 then return jsonb_build_object('state', 'nothing-to-preview'); end if;
    insert into private.discovery_previews (grant_id, user_id, kind, course_id, content, deadline_at)
      values (v_grant.id, v_user_id, p_kind, p_course_id, v_content, case when p_kind = 'cbt'
        then now() + make_interval(secs => p_exam_seconds) end)
      returning * into v_preview;
    perform private.log_entitlement_event(v_user_id, v_grant.id, 'discovery.preview-opened', 'student',
      jsonb_build_object('kind', p_kind, 'course_id', p_course_id, 'items', jsonb_array_length(v_content)));
  end if;
  return jsonb_build_object('state', 'ready', 'now', now(), 'ends_at', v_grant.ends_at,
    'preview', private.discovery_preview_view(v_preview));
end;
$$;

-- The pass and the open exam a save or submission acts on, after closing it if its deadline has passed. Null grant:
-- the state to return instead.
create function private.discovery_exam_for(p_user_id uuid, p_course_id uuid,
  out o_state text, out o_grant public.entitlement_grants, out o_preview private.discovery_previews)
language plpgsql
security definer
set search_path = ''
as $$
begin
  select * into o_grant from public.entitlement_grants
    where user_id = p_user_id and source = 'trial' and trial_policy = 'discovery';
  if o_grant.id is null then o_state := 'no-pass'; return; end if;
  if o_grant.revoked_at is not null or o_grant.starts_at > now() then o_state := 'expired'; return; end if;
  if not private.course_has_active_offering(p_course_id) then o_state := 'not-offered'; return; end if;
  perform private.close_overdue_discovery_exam(o_grant.id);
  select * into o_preview from private.discovery_previews
    where grant_id = o_grant.id and kind = 'cbt' and course_id = p_course_id for update;
  if o_preview.grant_id is null then o_state := 'not-opened'; return; end if;
  -- A graded exam (submitted, or closed at its deadline) is replayed while the pass lasts, and for the network grace
  -- after its deadline. Everything else after the pass ends fails closed.
  if o_preview.submitted_at is not null and o_grant.ends_at <= now()
      and now() > o_preview.deadline_at + make_interval(secs =>
        (select discovery_cbt_grace_seconds from private.entitlement_policy)) then
    o_state := 'expired'; return;
  end if;
  o_state := 'ok';
end;
$$;

-- Save the answer sheet while the exam is open, so time running out marks what the student had chosen. Nothing is
-- saved after the deadline: by then close_overdue_discovery_exam has already marked the exam.
create function public.save_discovery_cbt(p_session_id uuid, p_course_id uuid, p_answers jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_exam record;
begin
  if p_course_id is null or p_answers is null or jsonb_typeof(p_answers) <> 'object'
      or octet_length(p_answers::text) > 8192 then
    raise exception 'Invalid exam answers' using errcode = '22023';
  end if;
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user_id::text, 0));
  select * into v_exam from private.discovery_exam_for(v_user_id, p_course_id);
  if v_exam.o_state <> 'ok' then return jsonb_build_object('state', v_exam.o_state); end if;
  if (v_exam.o_preview).submitted_at is null then
    if not private.discovery_answers_valid((v_exam.o_preview).content, p_answers) then
      raise exception 'Invalid exam answers' using errcode = '22023';
    end if;
    update private.discovery_previews set saved_answers = p_answers, saved_at = now()
      where grant_id = (v_exam.o_preview).grant_id and kind = 'cbt';
    return jsonb_build_object('state', 'saved', 'now', now());
  end if;
  return jsonb_build_object('state', 'ready', 'now', now(), 'ends_at', (v_exam.o_grant).ends_at,
    'preview', private.discovery_preview_view(v_exam.o_preview));
end;
$$;

-- Grade the exam once, on the server, from the pinned answer key, and only up to its deadline. A replay returns the
-- first grading unchanged, so a lost response never costs the exam and a second submission can never improve the
-- score. A sheet that arrives after the deadline is never marked: the exam has already closed with the last sheet
-- saved in time, and that committed result is what is returned.
create function public.submit_discovery_cbt(p_session_id uuid, p_course_id uuid, p_answers jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_exam record;
  v_preview private.discovery_previews;
  v_score integer;
begin
  if p_course_id is null or p_answers is null or jsonb_typeof(p_answers) <> 'object'
      or octet_length(p_answers::text) > 8192 then
    raise exception 'Invalid exam answers' using errcode = '22023';
  end if;
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  perform pg_advisory_xact_lock(hashtextextended('entitlement-account:' || v_user_id::text, 0));
  select * into v_exam from private.discovery_exam_for(v_user_id, p_course_id);
  if v_exam.o_state <> 'ok' then return jsonb_build_object('state', v_exam.o_state); end if;
  v_preview := v_exam.o_preview;
  -- Still unsubmitted here means the deadline has not passed (and so neither has the pass end).
  if v_preview.submitted_at is null then
    if not private.discovery_answers_valid(v_preview.content, p_answers) then
      raise exception 'Invalid exam answers' using errcode = '22023';
    end if;
    v_score := private.discovery_exam_score(v_preview.content, p_answers);
    update private.discovery_previews set answers = p_answers, score = v_score, submitted_at = now()
      where grant_id = v_preview.grant_id and kind = 'cbt'
      returning * into v_preview;
    perform private.log_entitlement_event(v_user_id, v_preview.grant_id, 'discovery.exam-submitted', 'student',
      jsonb_build_object('course_id', p_course_id, 'score', v_score, 'total', jsonb_array_length(v_preview.content)));
  end if;
  return jsonb_build_object('state', 'ready', 'now', now(), 'ends_at', (v_exam.o_grant).ends_at,
    'preview', private.discovery_preview_view(v_preview));
end;
$$;

-- ---------------------------------------------------------------------------
-- Activation. Unchanged from 20261017100000 except the length (discovery_hours), the AI allowance
-- (discovery_ai_generations) and the explicit 'discovery' policy, all fixed at activation from the database clock.
-- ---------------------------------------------------------------------------
create or replace function public.verify_trial_otp(p_session_id uuid, p_challenge_id uuid, p_code_hash text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_policy private.entitlement_policy;
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

  -- Checked before the code, so a refused attempt never counts. No pass while Early Access is active.
  select * into v_early from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;
  if v_early.id is not null and v_early.ends_at > now() then
    return jsonb_build_object('state', 'early-access-active', 'available_from', v_early.ends_at);
  end if;
  if v_early.id is not null and not v_policy.trial_after_early_access then
    return jsonb_build_object('state', 'trial-not-offered');
  end if;

  select * into v_challenge from private.trial_otp_challenges
    where id = p_challenge_id and user_id = v_user_id for update;
  if not found then return jsonb_build_object('state', 'invalid'); end if;
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

  -- Start and end both come from this transaction's clock: exactly discovery_hours after verification.
  insert into public.entitlement_grants (user_id, source, trial_policy, starts_at, ends_at, ai_terms, ai_units,
      reference, created_by)
    values (v_user_id, 'trial', 'discovery', now(), now() + make_interval(hours => v_policy.discovery_hours), 'capped',
      v_policy.discovery_ai_generations, jsonb_build_object('challenge_id', v_challenge.id), 'student')
    returning * into v_grant;
  insert into private.trial_phone_claims (phone_hash, user_id, grant_id)
    values (v_challenge.phone_hash, v_user_id, v_grant.id);
  update private.trial_otp_challenges set status = 'verified', settled_at = now() where id = v_challenge.id;
  update private.trial_otp_challenges set status = 'superseded', settled_at = now()
    where user_id = v_user_id and id <> v_challenge.id and status = 'pending';
  perform private.log_entitlement_event(v_user_id, v_grant.id, 'trial.activated', 'student',
    jsonb_build_object('ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units, 'policy', 'discovery'));
  return jsonb_build_object('state', 'activated', 'ends_at', v_grant.ends_at, 'ai_units', v_grant.ai_units);
end;
$$;

-- ---------------------------------------------------------------------------
-- Student summary. As in 20261017100000, except that a Discovery Pass is never the full tier, the trial names its
-- policy, and the pass's limits and pinned previews are reported so pages can show what is left without reading any
-- content. Every field the 20261017100000 shape had is still returned with the same meaning (trial_days is the pass
-- length in whole days, rounded up), so application instances built before this migration keep parsing it during a
-- rollout.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_entitlement() returns jsonb
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
  v_early := private.early_access_status(v_user_id);
  if v_early->>'status' = 'eligible' then
    perform private.reconcile_early_access(v_user_id, 'system:plan-read');
    v_early := private.early_access_status(v_user_id);
  end if;
  select * into strict v_policy from private.entitlement_policy;
  -- The same grants private.has_full_access() counts: a seven-day trial is full access, a Discovery Pass is not.
  select * into v_access from public.entitlement_grants
    where user_id = v_user_id and (source <> 'trial' or trial_policy = 'seven-day') and revoked_at is null
      and starts_at <= now() and ends_at > now()
    order by ends_at desc limit 1;
  select * into v_trial from public.entitlement_grants where user_id = v_user_id and source = 'trial';
  select * into v_early_grant from public.entitlement_grants
    where user_id = v_user_id and source = 'early_access' and revoked_at is null;

  v_trial_status := case
    when v_trial.id is not null then
      case when v_trial.revoked_at is null and v_trial.starts_at <= now() and v_trial.ends_at > now()
        then 'active' else 'ended' end
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
    'trial_hours', v_policy.discovery_hours,
    'trial_days', ceil(v_policy.discovery_hours / 24.0)::integer,
    'expiry_notice_hours', v_policy.expiry_notice_hours,
    'tier', case when v_access.id is null then 'free' else 'full' end,
    'access', case when v_access.id is null then null
      else jsonb_build_object('source', v_access.source, 'ends_at', v_access.ends_at) end,
    'trial', jsonb_build_object('status', v_trial_status, 'policy', v_trial.trial_policy,
      'starts_at', v_trial.starts_at, 'ends_at', v_trial.ends_at,
      'available_from', case when v_trial_status = 'after-early-access' then v_early_grant.ends_at end),
    'discovery', jsonb_build_object(
      'cbt_questions', v_policy.discovery_cbt_questions,
      'ai_sets', coalesce(case when v_trial.trial_policy = 'discovery' then v_trial.ai_units end,
        v_policy.discovery_ai_generations),
      'previews', coalesce((select jsonb_agg(jsonb_build_object('kind', p.kind, 'content_key', c.content_key,
          'submitted', p.submitted_at is not null) order by p.kind)
        from private.discovery_previews p join public.courses c on c.id = p.course_id
        where p.grant_id = v_trial.id), '[]'::jsonb)),
    'early_access', jsonb_build_object(
      'status', case when v_early->>'status' = 'eligible' then 'pending' else v_early->>'status' end,
      'starts_at', v_early->'starts_at', 'ends_at', v_early->'ends_at',
      'enrollment_closes_at', case when v_policy.actual_launch_at is null then null
        else v_policy.actual_launch_at + make_interval(days => v_policy.early_access_enrollment_days) end),
    'otp', v_otp);
end;
$$;

-- ---------------------------------------------------------------------------
-- AI on a Discovery Pass. A document records the pass whose limits apply to it when it is reserved; a seven-day trial
-- keeps the shared AI rules it was issued with.
-- ---------------------------------------------------------------------------
alter table public.ai_practice_documents
  add column discovery_grant_id uuid references public.entitlement_grants (id) on delete set null;
create index ai_practice_documents_discovery_idx on public.ai_practice_documents (discovery_grant_id)
  where discovery_grant_id is not null;
-- A Discovery upload refused because the pass's accepted upload is already used. It is rejected, so it costs nothing.
alter table public.ai_practice_documents drop constraint ai_practice_documents_rejection_reason_check;
alter table public.ai_practice_documents add constraint ai_practice_documents_rejection_reason_check
  check (rejection_reason in ('missing-upload', 'too-large', 'unsupported-type', 'corrupt', 'encrypted', 'empty',
    'too-short', 'too-much-text', 'pass-upload-limit'));

-- Each upload a pass accepted, recorded at the moment it became ready. The row outlives the document's retention, so
-- removing an accepted file never frees another upload, and only documents recorded here can use the pass's AI.
create table private.discovery_ai_uploads (
  document_id uuid primary key,
  grant_id uuid not null references public.entitlement_grants (id) on delete cascade,
  accepted_at timestamptz not null default now()
);
create index discovery_ai_uploads_grant_idx on private.discovery_ai_uploads (grant_id);
alter table private.discovery_ai_uploads enable row level security;
revoke all on table private.discovery_ai_uploads from public, anon, authenticated, service_role;

-- As in 20261016140000, plus the Discovery accepted-upload limit ('pass-upload-limit', never renewed). This is an
-- early answer only: several slots may be reserved, and settle_ai_practice_document enforces the limit atomically.
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
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('status', 'signed-out'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  if not exists (select 1 from public.institutional_courses where id = p_institutional_course_id) then
    return jsonb_build_object('status', 'invalid-course');
  end if;
  v_allowance := private.ai_allowance_admission(v_user_id, p_accepted_sources);
  if v_allowance ->> 'state' <> 'active' then return jsonb_build_object('status', v_allowance ->> 'state'); end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-upload:' || v_user_id::text, 0));
  select count(*) into v_today from public.ai_practice_documents
    where user_id = v_user_id and created_at > now() - interval '1 day';
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
    p_media_type, p_declared_bytes, now() + make_interval(days => v_policy.source_retention_days), v_grant_id);
  return jsonb_build_object('status', 'created', 'document_id', v_id,
    'storage_path', v_user_id::text || '/' || v_id::text);
end;
$$;

-- As in 20261016140000, except for a Discovery upload. Acceptances of one pass are serialized, so of any number of
-- reserved uploads at most discovery_ai_uploads ever become ready; the rest are settled 'pass-upload-limit'. Text over
-- discovery_ai_source_chars is settled 'too-much-text'. Either way the function then returns false, so the caller
-- re-reads the stored outcome instead of trusting its own.
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
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return false; end if;
  select discovery_grant_id into v_grant_id from public.ai_practice_documents
    where id = p_document_id and user_id = v_user_id;
  if v_text is not null and v_grant_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('discovery-ai-uploads:' || v_grant_id::text, 0));
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
    where id = p_document_id and user_id = v_user_id and status = 'awaiting_upload' and expires_at > now()
      and extraction_claim = p_claim_id;
  if not found then return false; end if;
  if v_reason is null and v_grant_id is not null then
    insert into private.discovery_ai_uploads (document_id, grant_id) values (p_document_id, v_grant_id);
  end if;
  return v_reason is not distinct from p_rejection_reason;
end;
$$;

-- As in 20261017100000, plus the Discovery rules: the document must be an upload this pass accepted, within its text
-- limit (so no older or Early Access upload can be spent on the pass), and every provider attempt the pass funds
-- counts, delivered or not, so a student keeps the allowance through a failure but cannot retry without limit.
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
  v_user_id := private.ai_practice_session_user(p_session_id);
  if v_user_id is null then return jsonb_build_object('state', 'signed-out'); end if;
  select * into strict v_policy from private.ai_practice_policy;
  perform pg_advisory_xact_lock(hashtextextended('ai-practice-generation:' || v_user_id::text, 0));
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
  if not found or v_document.status <> 'ready' or v_document.expires_at <= now() then
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
    where reserved_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if v_today >= v_policy.global_daily_generations then
    return jsonb_build_object('state', 'capacity');
  end if;

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

-- The one set a Discovery Pass delivers: exactly five questions, each in the stored shape the student view reads back
-- (lib/ai-practice/stored-set.ts, AI_PRACTICE_LIMITS), so a set that is consumed can always be shown.
create function private.discovery_ai_set_complete(p_set jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_set -> 'questions') = 'array' and jsonb_array_length(p_set -> 'questions') = 5
    and (select count(distinct q ->> 'id') from jsonb_array_elements(p_set -> 'questions') q) = 5
    and not exists (select 1 from jsonb_array_elements(p_set -> 'questions') q where not coalesce(
      jsonb_typeof(q) = 'object' and (q ->> 'id') ~ '^ai_[0-9a-f]{24}$'
      and jsonb_typeof(q -> 'prompt') = 'string' and btrim(q ->> 'prompt') <> '' and char_length(q ->> 'prompt') <= 600
      and jsonb_typeof(q -> 'options') = 'array' and jsonb_array_length(q -> 'options') = 4
      and not exists (select 1 from jsonb_array_elements(q -> 'options') o where not coalesce(jsonb_typeof(o) = 'string'
        and btrim(o #>> '{}') <> '' and char_length(o #>> '{}') <= 240, false))
      and jsonb_typeof(q -> 'correctOption') = 'number' and (q ->> 'correctOption') in ('0', '1', '2', '3')
      and jsonb_typeof(q -> 'explanation') = 'string' and btrim(q ->> 'explanation') <> ''
        and char_length(q ->> 'explanation') <= 1200
      and jsonb_typeof(q -> 'section') = 'string' and btrim(q ->> 'section') <> '' and char_length(q ->> 'section') <= 120
      and jsonb_typeof(q -> 'grounding') = 'object'
      and (q -> 'grounding' ->> 'documentId') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and (q -> 'grounding' ->> 'sourceSha256') ~ '^[0-9a-f]{64}$'
      and (q -> 'grounding' ->> 'passageId') ~ '^P[1-9][0-9]*$'
      and jsonb_typeof(q -> 'grounding' -> 'passageStart') = 'number' and (q -> 'grounding' ->> 'passageStart') ~ '^[0-9]+$'
      and jsonb_typeof(q -> 'grounding' -> 'passageEnd') = 'number' and (q -> 'grounding' ->> 'passageEnd') ~ '^[0-9]+$'
      and jsonb_typeof(q -> 'grounding' -> 'quote') = 'string' and btrim(q -> 'grounding' ->> 'quote') <> ''
        and char_length(q -> 'grounding' ->> 'quote') <= 400, false))
    and jsonb_typeof(p_set -> 'source') = 'object' and jsonb_typeof(p_set -> 'source' -> 'fileName') = 'string'
    and btrim(p_set -> 'source' ->> 'fileName') <> '' and char_length(p_set -> 'source' ->> 'fileName') <= 255, false);
$$;

-- As in 20261016140000, except that a set a Discovery Pass funds is delivered only when it is complete: anything short
-- of five valid questions is recorded as a failed attempt, which releases the reservation (the set is not spent) and
-- still counts toward discovery_ai_attempts.
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

-- Display only, as in 20261017100000, plus the Discovery text limit so the page can say how much to upload.
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
    'used', private.ai_units_used(v_user_id, v_window.grant_id, v_window.starts_at), 'ends_at', v_window.ends_at,
    'source_char_limit', case when private.is_discovery_grant(v_window.grant_id)
      then (select discovery_ai_source_chars from private.entitlement_policy) end);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges. Previews are written only by the service role with a verified session id.
-- ---------------------------------------------------------------------------
revoke all on function private.is_discovery_grant(uuid), private.course_has_active_offering(uuid),
  private.discovery_cbt_question_valid(jsonb), private.discovery_cbt_pool(uuid),
  private.discovery_preview_content(uuid, text, uuid), private.discovery_topic_titles(uuid),
  private.discovery_preview_view(private.discovery_previews), private.discovery_answers_valid(jsonb, jsonb),
  private.discovery_exam_score(jsonb, jsonb), private.close_overdue_discovery_exam(uuid),
  private.discovery_exam_for(uuid, uuid), private.discovery_ai_set_complete(jsonb),
  public.discovery_preview(uuid, uuid, text, boolean, uuid, integer), public.save_discovery_cbt(uuid, uuid, jsonb),
  public.submit_discovery_cbt(uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.discovery_preview(uuid, uuid, text, boolean, uuid, integer),
  public.save_discovery_cbt(uuid, uuid, jsonb), public.submit_discovery_cbt(uuid, uuid, jsonb) to service_role;

comment on table public.entitlement_grants is
  'Windows of access. Early Access, operator, future paid grants and seven-day trials issued before 20261021100000 are full access; a discovery trial grant is the Discovery Pass (one exam, one topic and a small AI allowance, never full access). Free courses never need one.';
comment on table private.discovery_previews is
  'One pinned preview per Discovery Pass and kind (one timed CBT exam, one complete study-guide topic). Never replenished.';
comment on table private.discovery_ai_uploads is
  'Uploads a Discovery Pass accepted (at most discovery_ai_uploads). Only these documents can use the pass''s AI.';
