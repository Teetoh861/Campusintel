-- supabase/migrations/20260915100000_recovery_grants.sql — Token-free, private one-time recovery grants.
create table public.auth_recovery_grants (
  grant_hash text primary key check (grant_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid not null unique,
  flow_binding text not null check (flow_binding ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '10 minutes')
);
comment on column public.auth_recovery_grants.flow_binding is
  'Purpose-separated HMAC of verified email; prevents cross-tab account mixing without storing email.';
alter table public.auth_recovery_grants enable row level security;
revoke all on public.auth_recovery_grants from public, anon, authenticated, service_role;
create index auth_recovery_grants_expiry on public.auth_recovery_grants(expires_at);

create function public.issue_recovery_grant(p_hash text, p_user_id uuid, p_binding text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_user_id is null
    or p_user_id = '00000000-0000-0000-0000-000000000000'::uuid
    or p_binding is null or p_binding !~ '^[a-f0-9]{64}$'
  then raise exception using errcode = '22023', message = 'Invalid recovery grant'; end if;
  insert into public.auth_recovery_grants(grant_hash,user_id,flow_binding,created_at,expires_at)
    values(p_hash,p_user_id,p_binding,v_now,v_now + interval '10 minutes')
    on conflict (user_id) do update set grant_hash = excluded.grant_hash,
      flow_binding = excluded.flow_binding, created_at = excluded.created_at, expires_at = excluded.expires_at;
end;
$$;

create function public.consume_recovery_grant(p_hash text, p_binding text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid; v_expires timestamptz; v_binding text;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
    or (p_binding is not null and p_binding !~ '^[a-f0-9]{64}$')
  then raise exception using errcode = '22023', message = 'Invalid recovery grant'; end if;
  -- A single DELETE claims the grant even for concurrent consumers. Null binding is cancellation.
  delete from public.auth_recovery_grants where grant_hash = p_hash
    returning user_id, expires_at, flow_binding into v_user_id, v_expires, v_binding;
  if p_binding is not null and v_binding = p_binding and v_expires > pg_catalog.clock_timestamp()
    then return v_user_id; end if;
  return null;
end;
$$;
revoke all on function public.issue_recovery_grant(text,uuid,text) from public, anon, authenticated;
revoke all on function public.consume_recovery_grant(text,text) from public, anon, authenticated;
grant execute on function public.issue_recovery_grant(text,uuid,text) to service_role;
grant execute on function public.consume_recovery_grant(text,text) to service_role;

-- Cleanup runs independently of traffic; expired grants are unusable even before the next run.
create function public.prune_recovery_grants()
returns void language sql security definer set search_path = '' as $$
  delete from public.auth_recovery_grants where expires_at <= pg_catalog.clock_timestamp();
$$;
revoke all on function public.prune_recovery_grants() from public, anon, authenticated, service_role;
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('campusintell-recovery-grant-expiry', '* * * * *', 'select public.prune_recovery_grants()');
