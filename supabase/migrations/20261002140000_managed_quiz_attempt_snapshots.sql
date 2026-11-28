-- supabase/migrations/20261002140000_managed_quiz_attempt_snapshots.sql
-- Pin each attempt's selected managed question revisions for canonical scoring.

create table public.quiz_attempt_questions (
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  question_id uuid not null,
  ordinal integer not null check (ordinal >= 0),
  item_id uuid not null,
  content_revision integer not null check (content_revision > 0),
  primary key (attempt_id, question_id),
  unique (attempt_id, ordinal),
  foreign key (item_id, content_revision)
    references public.managed_content_revisions(item_id, revision) on update restrict on delete restrict
);

alter table public.quiz_attempt_questions enable row level security;
revoke all on table public.quiz_attempt_questions from public, anon, authenticated, service_role;
grant select on table public.quiz_attempt_questions to authenticated;
create policy "Attempt questions are selectable by their attempt owner"
  on public.quiz_attempt_questions for select to authenticated
  using (exists (
    select 1 from public.quiz_attempts a
    where a.id = quiz_attempt_questions.attempt_id and a.user_id = (select auth.uid())
  ));

comment on table public.quiz_attempt_questions is
  'Immutable selected question identities and managed revisions for each quiz attempt. Answer keys stay in managed revisions.';

create or replace function public.write_quiz_attempt(
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

comment on function public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb) is
  'Server-only attempt writes. Start pins published managed revisions; later patches score from that immutable snapshot.';
