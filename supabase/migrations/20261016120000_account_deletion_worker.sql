-- No cron.schedule here. Deployment/monitoring activation is a separate owner step.
create table private.account_deletion_worker_health (
  singleton boolean primary key default true check (singleton),
  last_run_at timestamptz
);
insert into private.account_deletion_worker_health(singleton) values (true);
alter table private.account_deletion_worker_health enable row level security;
revoke all on private.account_deletion_worker_health from public, anon, authenticated, service_role;

create function public.account_deletion_monitor()
returns jsonb language sql security definer set search_path = '' as $$
  select jsonb_build_object('lastRunAt', (select last_run_at from private.account_deletion_worker_health),
    'workerStale', count(*) > 0 and coalesce((select last_run_at < clock_timestamp() - interval '1 hour'
      from private.account_deletion_worker_health), true),
    'pending', count(*),
    'due', count(*) filter (where deadline <= clock_timestamp()),
    'overdue', count(*) filter (where deadline + interval '24 hours' <= clock_timestamp()),
    'failed', count(*) filter (where attempts > 0),
    'oldestDeadline', min(deadline),
    'overdueJobs', coalesce(jsonb_agg(jsonb_build_object('jobId', id, 'deadline', deadline,
      'attempts', attempts, 'errorCode', last_error_code, 'escalatedAt', escalated_at)
      order by deadline) filter (where deadline + interval '24 hours' <= clock_timestamp()), '[]'::jsonb))
  from private.account_deletion_jobs;
$$;

create function public.run_account_deletion_jobs(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_candidate record; v_job private.account_deletion_jobs%rowtype;
  v_completed integer := 0; v_failed integer := 0; v_escalated integer := 0; v_state text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Invalid deletion batch size' using errcode = '22023';
  end if;
  for v_candidate in select user_id from private.account_deletion_jobs
    where deadline <= clock_timestamp() and (retry_at <= clock_timestamp()
      or (deadline + interval '24 hours' <= clock_timestamp() and escalated_at is null))
    order by deadline, id limit p_limit
  loop
    -- Match schedule/cancel ordering. Concurrent workers skip a claimed account.
    if not pg_try_advisory_xact_lock(hashtextextended('account-lifecycle:' || v_candidate.user_id::text, 0))
      then continue; end if;
    perform 1 from auth.users where id = v_candidate.user_id for update;
    select * into v_job from private.account_deletion_jobs
      where user_id = v_candidate.user_id for update skip locked;
    if not found or v_job.deadline > clock_timestamp() then continue; end if;
    if v_job.deadline + interval '24 hours' <= clock_timestamp() and v_job.escalated_at is null then
      update private.account_deletion_jobs set escalated_at = clock_timestamp() where user_id = v_job.user_id;
      v_escalated := v_escalated + 1;
    end if;
    if v_job.retry_at > clock_timestamp() then continue; end if;
    begin
      -- A privileged role update need not take the Auth row lock. Lock the
      -- profile too, then read its committed role before deciding to purge.
      perform 1 from public.profiles where id = v_job.user_id for update;
      if private.is_governed_account(v_job.user_id) then
        raise exception 'Governed account requires operator procedure' using errcode = 'P0001';
      end if;
      -- Storage deletes must use the provider API, never SQL metadata deletion.
      -- Fail closed if this installation has owned objects or an unknown schema.
      if exists (select 1 from storage.objects where owner_id = v_job.user_id::text or owner = v_job.user_id)
        or exists (select 1 from storage.buckets where owner_id = v_job.user_id::text or owner = v_job.user_id) then
        raise exception 'Owned storage requires operator procedure' using errcode = 'P0002';
      end if;
      -- Reports may restrict attempt deletion and contain identifying free text.
      -- Retain no report evidence: deidentification of free text is not assumed.
      delete from public.question_reports where reporter_id = v_job.user_id
        or attempt_id in (select id from public.quiz_attempts where user_id = v_job.user_id);
      delete from public.auth_recovery_grants where user_id = v_job.user_id;
      delete from auth.refresh_tokens where user_id = v_job.user_id::text;
      -- Existing FK cascades remove ONLY this student's profile/bookmarks/
      -- receipts/attempts/answers/snapshots and provider-owned Auth children.
      delete from auth.users where id = v_job.user_id;
      v_completed := v_completed + 1;
    exception when others then
      -- The whole account's purge rolls back. Store SQLSTATE, never provider
      -- messages, SQL payloads, student notes, passwords or email addresses.
      get stacked diagnostics v_state = returned_sqlstate;
      update private.account_deletion_jobs set attempts = least(attempts + 1, 1000000),
        last_error_code = v_state,
        retry_at = clock_timestamp() + make_interval(secs => least(3600, 60 * power(2, least(attempts, 6))::integer))
      where user_id = v_job.user_id;
      v_failed := v_failed + 1;
    end;
  end loop;
  update private.account_deletion_worker_health set last_run_at = clock_timestamp() where singleton;
  return jsonb_build_object('completed', v_completed, 'failedThisRun', v_failed, 'escalatedThisRun', v_escalated,
    'monitor', public.account_deletion_monitor());
end;
$$;

revoke all on function public.account_deletion_monitor() from public, anon, authenticated, service_role;
revoke all on function public.run_account_deletion_jobs(integer) from public, anon, authenticated, service_role;
grant execute on function public.account_deletion_monitor() to service_role;
grant execute on function public.run_account_deletion_jobs(integer) to service_role;
