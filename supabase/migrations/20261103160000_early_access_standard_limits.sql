-- Owner decision: Early Access uses the live Standard tier during its free month.
-- Paid plus Early Access still selects the higher tier, without adding limits. Equal tiers keep the existing
-- Early Access funding preference; the account's active paid grant independently controls platform-reserve access.
-- This replaces only the tier selector: existing windows, usage, grants, admission locks and settlement stay intact.
create or replace function private.campus_bot_plan(p_user uuid, p_at timestamptz, p_sources text[])
returns table (source text, grant_id uuid, tier text, ends_at timestamptz, session_hours integer, session_tokens integer,
  week_days integer, week_tokens integer, written_token_weight integer)
language sql stable security definer set search_path = '' as $$
  with scope as (select private.current_course_scope(p_user, p_at) as s),
  candidates as (
    select 'paid'::text as source, g.id, g.campus_bot_tier as tier, private.grant_effective_end(g) as ends_at
      from public.entitlement_grants g cross join scope
      where 'paid' = any (p_sources) and g.user_id = p_user and g.source = 'paid' and g.order_id is not null
        and g.revoked_at is null and g.starts_at <= p_at and private.grant_effective_end(g) > p_at
        and scope.s->>'state' = 'ready' and g.course_term_id = (scope.s->>'term_id')::uuid
        and g.course_department_id = (scope.s->>'department_id')::uuid
    union all
    select 'early_access', g.id, 'standard', g.ends_at from public.entitlement_grants g
      where 'early_access' = any (p_sources) and g.user_id = p_user and g.source = 'early_access'
        and g.revoked_at is null and g.starts_at <= p_at and g.ends_at > p_at
  )
  select c.source, c.id, c.tier, c.ends_at, t.session_hours, t.session_tokens, t.week_days, t.week_tokens,
    t.written_token_weight
  from candidates c join private.campus_bot_tiers t on t.tier = c.tier
  order by (c.tier = 'plus') desc, (c.source = 'early_access') desc, c.ends_at desc, c.id
  limit 1;
$$;
revoke all on function private.campus_bot_plan(uuid, timestamptz, text[])
  from public, anon, authenticated, service_role;
