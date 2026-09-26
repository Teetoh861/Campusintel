-- supabase/migrations/20260912090000_auth_rate_limits.sql — Private atomic rolling-window auth limits.
create table public.auth_rate_limit_events (
  id bigint generated always as identity primary key,
  action text not null,
  kind text not null check (kind in ('account', 'origin')),
  bucket text not null check (bucket ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp()
);
alter table public.auth_rate_limit_events enable row level security;
revoke all on public.auth_rate_limit_events from public, anon, authenticated, service_role;
revoke all on sequence public.auth_rate_limit_events_id_seq from public, anon, authenticated, service_role;
create index auth_rate_limit_lookup on public.auth_rate_limit_events(action, kind, bucket, created_at);
create index auth_rate_limit_expiry on public.auth_rate_limit_events(created_at);

create function public.consume_auth_rate_limit(
  p_action text, p_account text, p_origin text,
  p_account_limit integer, p_account_window integer,
  p_origin_limit integer, p_origin_window integer
) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_now timestamptz;
  v_account_count integer;
  v_origin_count integer;
  v_expected integer[];
begin
  v_expected := case p_action
    when 'LOGIN' then array[20,900,30,300]
    when 'REGISTER' then array[3,3600,20,3600]
    when 'RESEND_CONFIRMATION' then array[3,3600,20,3600]
    when 'PASSWORD_RESET_REQUEST' then array[3,3600,20,3600]
    when 'PASSWORD_RESET_SUBMIT' then array[5,900,20,900]
    when 'CONFIRM_EMAIL' then array[5,900,20,900]
    else null end;
  if v_expected is null or p_account is null or p_origin is null
    or p_account !~ '^[a-f0-9]{64}$' or p_origin !~ '^[a-f0-9]{64}$'
    or array[p_account_limit,p_account_window,p_origin_limit,p_origin_window] is distinct from v_expected
  then raise exception using errcode = '22023', message = 'Invalid auth rate-limit arguments'; end if;

  -- Every call locks account then origin. Kind is part of the lock namespace, so no cycles.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_action || ':account:' || p_account, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_action || ':origin:' || p_origin, 1));
  v_now := pg_catalog.clock_timestamp();
  -- Maximum window is one hour. Opportunistic cleanup bounds retention without a new scheduler.
  -- SKIP LOCKED avoids cleanup deadlocks across unrelated concurrent buckets.
  delete from public.auth_rate_limit_events where id in (
    select id from public.auth_rate_limit_events
    where created_at <= v_now - interval '1 hour'
    for update skip locked
  );
  select count(*) into v_account_count from public.auth_rate_limit_events
    where action = p_action and kind = 'account' and bucket = p_account
      and created_at > v_now - pg_catalog.make_interval(secs => p_account_window);
  select count(*) into v_origin_count from public.auth_rate_limit_events
    where action = p_action and kind = 'origin' and bucket = p_origin
      and created_at > v_now - pg_catalog.make_interval(secs => p_origin_window);

  -- Charge each bucket that still has capacity even when its partner is exhausted:
  -- repeated attempts at one exhausted account must not bypass the origin limit.
  if v_account_count < p_account_limit then
    insert into public.auth_rate_limit_events(action,kind,bucket,created_at)
      values(p_action,'account',p_account,v_now);
  end if;
  if v_origin_count < p_origin_limit then
    insert into public.auth_rate_limit_events(action,kind,bucket,created_at)
      values(p_action,'origin',p_origin,v_now);
  end if;
  return v_account_count < p_account_limit and v_origin_count < p_origin_limit;
end;
$$;
revoke all on function public.consume_auth_rate_limit(text,text,text,integer,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text,text,text,integer,integer,integer,integer)
  to service_role;
