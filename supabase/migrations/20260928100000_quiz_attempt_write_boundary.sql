-- A server-only capability, not a student RPC. The server supplies canonical
-- quiz metadata only after live Auth validation. Ownership comes from the
-- actual Auth session, never a user_id argument or the service_role identity.
-- Storage columns, table grants and owner-only read policies stay unchanged.
create function public.write_quiz_attempt(
  p_session_id uuid,
  p_attempt_id uuid,
  p_course_id uuid,
  p_question_count integer,
  p_operation text,
  p_expected_revision integer,
  p_status text,
  p_answers jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_not_after timestamptz;
  v_attempt public.quiz_attempts%rowtype;
  v_now timestamptz;
begin
  -- Holding this row until commit serializes a write with session deletion.
  -- A revoked/deleted session or an expired time-boxed session cannot write.
  select s.user_id, s.not_after into v_user_id, v_not_after
  from auth.sessions s
  join auth.users u on u.id = s.user_id
  where s.id = p_session_id
    and (s.not_after is null or s.not_after > pg_catalog.clock_timestamp())
    and u.email_confirmed_at is not null
    and (u.banned_until is null or u.banned_until <= pg_catalog.clock_timestamp())
  for share of s, u;
  if not found then return jsonb_build_object('status', 'signed-out'); end if;

  if p_attempt_id is null or p_course_id is null
    or p_question_count is null or p_question_count <= 0
    or p_operation is null or p_operation not in ('start', 'record', 'finish')
    or p_status is null or p_status not in ('in_progress', 'submitted', 'timed_out')
    or p_answers is null or jsonb_typeof(p_answers) <> 'array'
  then raise exception using errcode = '22023', message = 'Invalid attempt write'; end if;
  if jsonb_array_length(p_answers) > p_question_count
    or (p_operation = 'start' and (p_expected_revision is not null
      or p_status <> 'in_progress' or p_answers <> '[]'::jsonb))
    or (p_operation <> 'start' and (p_expected_revision is null
      or p_expected_revision < 0 or p_expected_revision >= 2147483647))
    or (p_operation = 'record' and (p_status <> 'in_progress' or p_answers = '[]'::jsonb))
    or (p_operation = 'finish' and p_status = 'in_progress')
  then raise exception using errcode = '22023', message = 'Invalid attempt write'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_answers) a
    where jsonb_typeof(a) <> 'object'
      or a - array['question_id', 'ordinal', 'option_index', 'is_correct', 'section_label'] <> '{}'::jsonb
      or jsonb_typeof(a->'question_id') is distinct from 'string'
      or jsonb_typeof(a->'ordinal') is distinct from 'number'
      or jsonb_typeof(a->'option_index') is distinct from 'number'
      or jsonb_typeof(a->'is_correct') is distinct from 'boolean'
      or jsonb_typeof(a->'section_label') is distinct from 'string'
  ) or exists (
    select 1 from jsonb_to_recordset(p_answers) as a(
      question_id uuid, ordinal integer, option_index integer,
      is_correct boolean, section_label text
    ) where a.ordinal < 0 or a.ordinal >= p_question_count or a.option_index < 0
      or a.section_label = ''
  ) or (
    select count(*) <> count(distinct a.question_id) or count(*) <> count(distinct a.ordinal)
    from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer)
  ) then raise exception using errcode = '22023', message = 'Invalid attempt answers'; end if;

  if p_operation = 'start' then
    insert into public.quiz_attempts (id, user_id, course_id, question_count)
    values (p_attempt_id, v_user_id, p_course_id, p_question_count)
    on conflict (id) do nothing;
  end if;

  -- Concurrent requests observe the latest committed revision under this lock.
  select * into v_attempt from public.quiz_attempts
  where id = p_attempt_id for update;
  -- A time-boxed session can expire while waiting for the attempt lock. Raise
  -- rather than return so even a delayed start INSERT is rolled back.
  if v_not_after is not null and v_not_after <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '28000', message = 'Session expired';
  end if;
  if not found or v_attempt.user_id <> v_user_id then
    return jsonb_build_object('status', 'not-found');
  end if;
  if v_attempt.course_id <> p_course_id or v_attempt.question_count <> p_question_count then
    return jsonb_build_object('status', 'conflict');
  end if;

  if p_operation <> 'start' then
    -- A question's established position cannot be reassigned by another patch.
    if exists (
      select 1 from jsonb_to_recordset(p_answers) as a(question_id uuid, ordinal integer)
      join public.quiz_attempt_answers stored on stored.attempt_id = p_attempt_id
        and (stored.question_id = a.question_id or stored.ordinal = a.ordinal)
      where stored.question_id <> a.question_id or stored.ordinal <> a.ordinal
    ) then raise exception using errcode = '22023', message = 'Invalid attempt answers'; end if;

    -- An immediately repeated equivalent request is a read-only acknowledgement.
    -- No payload hash or extra receipt table is needed: compare the durable patch.
    if v_attempt.revision = p_expected_revision + 1 and v_attempt.status = p_status
      and not exists (
        select 1 from jsonb_to_recordset(p_answers) as a(
          question_id uuid, ordinal integer, option_index integer,
          is_correct boolean, section_label text
        ) left join public.quiz_attempt_answers stored
          on stored.attempt_id = p_attempt_id and stored.question_id = a.question_id
        where stored.question_id is null
          or stored.ordinal is distinct from a.ordinal
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
      -- Capture acceptance after the attempt lock, for both new selections and changes.
      v_now := pg_catalog.clock_timestamp();
      insert into public.quiz_attempt_answers as stored
        (attempt_id, question_id, ordinal, option_index, is_correct, section_label, answered_at)
      select p_attempt_id, a.question_id, a.ordinal, a.option_index, a.is_correct, a.section_label, v_now
      from jsonb_to_recordset(p_answers) as a(
        question_id uuid, ordinal integer, option_index integer,
        is_correct boolean, section_label text
      )
      on conflict (attempt_id, question_id) do update
      set option_index = excluded.option_index, is_correct = excluded.is_correct,
          section_label = excluded.section_label, answered_at = v_now
      where stored.option_index is distinct from excluded.option_index
        or stored.is_correct is distinct from excluded.is_correct
        or stored.section_label is distinct from excluded.section_label;

      update public.quiz_attempts
      set revision = revision + 1, status = p_status,
          finished_at = case when p_status = 'in_progress' then null else v_now end
      where id = p_attempt_id
      returning * into v_attempt;
    end if;
  end if;

  return jsonb_build_object('status', 'saved', 'attempt', jsonb_build_object(
    'id', v_attempt.id, 'revision', v_attempt.revision,
    'status', v_attempt.status, 'questionCount', v_attempt.question_count
  ));
end;
$$;

-- Browser roles cannot call this function with invented canonical metadata.
-- service_role receives EXECUTE only; it still has no direct table access.
revoke all on function public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb)
  to service_role;

comment on function public.write_quiz_attempt(uuid,uuid,uuid,integer,text,integer,text,jsonb) is
  'Server-only canonical quiz writes. Identity resolves from a live auth.sessions row; '
  'revision-checked patches and terminal retries are atomic. No user_id argument.';
