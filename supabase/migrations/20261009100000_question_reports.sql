-- Question reports observe immutable content; they never change content or attempts.
create table public.question_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on update restrict on delete restrict,
  item_id uuid not null references public.managed_content_items(id) on update restrict on delete restrict,
  content_revision integer not null check (content_revision > 0),
  kind text not null check (kind in ('cbt_question', 'theory_question')),
  question_id uuid references public.managed_content_items(question_id) on update restrict on delete restrict,
  attempt_id uuid references public.quiz_attempts(id) on update restrict on delete restrict,
  note text check (note is null or length(note) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_by uuid references auth.users(id) on update restrict on delete restrict,
  reviewed_at timestamptz,
  constraint question_reports_once_per_revision unique (reporter_id, item_id, content_revision),
  foreign key (item_id, course_id) references public.managed_content_items(id, course_id)
    on update restrict on delete restrict,
  foreign key (item_id, content_revision) references public.managed_content_revisions(item_id, revision)
    on update restrict on delete restrict,
  constraint question_reports_kind_identity check (
    (kind = 'cbt_question' and question_id is not null)
    or (kind = 'theory_question' and question_id is null and attempt_id is null)
  ),
  constraint question_reports_disposition check (
    (status = 'open' and reviewed_by is null and reviewed_at is null)
    or (status in ('resolved', 'dismissed') and reviewed_by is not null
      and reviewed_at is not null and reviewed_at >= created_at)
  )
);

create index question_reports_queue on public.question_reports(status, created_at, id);
create index question_reports_course on public.question_reports(course_id, kind);
create index question_reports_reporter_time on public.question_reports(reporter_id, created_at);
alter table public.question_reports enable row level security;
-- All API access goes through the live-account/operator functions below.
revoke all on table public.question_reports from public, anon, authenticated, service_role;

create function public.submit_question_report(
  p_course_id uuid, p_item_id uuid, p_content_revision integer,
  p_question_id uuid default null, p_attempt_id uuid default null, p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_account();
  v_item public.managed_content_items%rowtype;
  v_report_id uuid;
  v_note text;
  v_not_after timestamptz;
  -- Small rolling cap, serialized per account. Duplicates do not consume it.
  v_hourly_limit constant integer := 20;
begin
  if p_course_id is null or p_item_id is null or p_content_revision is null
    or p_content_revision <= 0 or length(p_note) > 1000 then
    raise exception using errcode = '22023', message = 'Invalid question report';
  end if;
  -- Match ECMAScript trim's whitespace set, including Unicode whitespace.
  v_note := nullif(btrim(p_note, E' \t\n\r\f' || pg_catalog.chr(11) ||
    U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'), '');

  select * into v_item from public.managed_content_items
  where id = p_item_id and course_id = p_course_id;
  if not found or v_item.kind not in ('cbt_question', 'theory_question')
    or (v_item.kind = 'cbt_question' and p_question_id is distinct from v_item.question_id)
    or (v_item.kind = 'theory_question' and (p_question_id is not null or p_attempt_id is not null))
    or not exists (
      select 1 from public.managed_content_revisions r
      where r.item_id = p_item_id and r.revision = p_content_revision
    ) or not exists (
      select 1 from public.managed_content_publications p
      where p.item_id = p_item_id and p.revision = p_content_revision and p.action = 'publish'
    ) then
    raise exception using errcode = '22023', message = 'Invalid question report';
  end if;

  if p_attempt_id is not null and not exists (
    select 1 from public.quiz_attempts a
    join public.quiz_attempt_questions q on q.attempt_id = a.id
    where a.id = p_attempt_id and a.user_id = v_actor and a.course_id = p_course_id
      and q.item_id = p_item_id and q.question_id = p_question_id
      and q.content_revision = p_content_revision
  ) then
    raise exception using errcode = '22023', message = 'Invalid question report';
  end if;

  -- Use the existing auth limiter's advisory-lock pattern, without changing its schema.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('question-report:' || v_actor::text, 0));
  -- Check expiry after any wait and hold the live session through acceptance.
  select s.not_after into v_not_after from auth.sessions s
  where s.id = (auth.jwt()->>'session_id')::uuid and s.user_id = v_actor
    and (s.not_after is null or s.not_after > pg_catalog.clock_timestamp())
  for share;
  if not found or (v_not_after is not null and v_not_after <= pg_catalog.clock_timestamp()) then
    raise exception using errcode = '42501', message = 'Account session required';
  end if;

  select id into v_report_id from public.question_reports
  where reporter_id = v_actor and item_id = p_item_id and content_revision = p_content_revision;
  if found then
    return jsonb_build_object('status', 'already-reported', 'reportId', v_report_id);
  end if;
  if (select count(*) from public.question_reports where reporter_id = v_actor
    and created_at > pg_catalog.clock_timestamp() - interval '1 hour') >= v_hourly_limit then
    return jsonb_build_object('status', 'limited');
  end if;

  insert into public.question_reports
    (reporter_id, course_id, item_id, content_revision, kind, question_id, attempt_id, note)
  values (v_actor, p_course_id, p_item_id, p_content_revision, v_item.kind,
    case when v_item.kind = 'cbt_question' then v_item.question_id else null end, p_attempt_id, v_note)
  returning id into v_report_id;
  return jsonb_build_object('status', 'reported', 'reportId', v_report_id);
end;
$$;

-- Bounded pagination; no reporter ID, profile fields, or question/answer payloads.
create function public.list_question_reports(
  p_status text default null, p_course_id uuid default null,
  p_limit integer default 100, p_offset integer default 0
)
returns table (
  report_id uuid, status text, course_id uuid, course_content_key text,
  kind text, item_id uuid, content_revision integer, question_id uuid,
  attempt_id uuid, note text, created_at timestamptz, reviewed_at timestamptz
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_live_operator();
  if (p_status is not null and p_status not in ('open', 'resolved', 'dismissed'))
    or p_limit is null or p_limit < 1 or p_limit > 500 or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'Invalid report query';
  end if;
  return query select r.id, r.status, r.course_id, c.content_key, r.kind,
    r.item_id, r.content_revision, r.question_id, r.attempt_id, r.note, r.created_at, r.reviewed_at
  from public.question_reports r join public.courses c on c.id = r.course_id
  where (p_status is null or r.status = p_status) and (p_course_id is null or r.course_id = p_course_id)
  order by r.created_at, r.id limit p_limit offset p_offset;
end;
$$;

create function public.disposition_question_report(p_report_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_report public.question_reports%rowtype;
  v_not_after timestamptz;
begin
  if p_report_id is null or p_status is null or p_status not in ('resolved', 'dismissed') then
    raise exception using errcode = '22023', message = 'Invalid report disposition';
  end if;
  select * into v_report from public.question_reports where id = p_report_id for update;
  if not found then return jsonb_build_object('status', 'not-found'); end if;
  perform private.require_live_operator();
  select s.not_after into v_not_after from auth.sessions s
  where s.id = (auth.jwt()->>'session_id')::uuid and s.user_id = v_actor
    and (s.not_after is null or s.not_after > pg_catalog.clock_timestamp()) for share;
  if not found or (v_not_after is not null and v_not_after <= pg_catalog.clock_timestamp()) then
    raise exception using errcode = '42501', message = 'Operator authorization required';
  end if;
  if v_report.status <> 'open' then
    return jsonb_build_object('status', case when v_report.status = p_status then 'unchanged' else 'conflict' end);
  end if;
  update public.question_reports set status = p_status, reviewed_by = v_actor,
    reviewed_at = pg_catalog.clock_timestamp() where id = p_report_id;
  return jsonb_build_object('status', 'updated');
end;
$$;

-- All-time counts, optionally scoped to one repository course, from one statement snapshot.
-- Includes terminal reports and all durable starts (including unfinished attempts).
create function public.question_report_metrics(p_course_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.require_live_operator();
  select jsonb_build_object(
    'cbtReportCount', r.cbt, 'theoryReportCount', r.theory, 'attemptCount', a.total,
    'cbtReportsPer1000Attempts', 1000::numeric * r.cbt / nullif(a.total, 0)
  ) into v_result
  from (select count(*) filter (where kind = 'cbt_question') cbt,
    count(*) filter (where kind = 'theory_question') theory
    from public.question_reports where p_course_id is null or course_id = p_course_id) r
  cross join (select count(*) total from public.quiz_attempts
    where p_course_id is null or course_id = p_course_id) a;
  return v_result;
end;
$$;

revoke all on function public.submit_question_report(uuid,uuid,integer,uuid,uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.list_question_reports(text,uuid,integer,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.disposition_question_report(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.question_report_metrics(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_question_report(uuid,uuid,integer,uuid,uuid,text) to authenticated;
grant execute on function public.list_question_reports(text,uuid,integer,integer) to authenticated;
grant execute on function public.disposition_question_report(uuid,text) to authenticated;
grant execute on function public.question_report_metrics(uuid) to authenticated;

comment on table public.question_reports is
  'Private suspected-error evidence for formerly published CBT/theory revisions. One report per account/item/revision, including terminal reports.';
