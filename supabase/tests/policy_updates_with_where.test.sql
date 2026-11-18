-- Local Supabase's postgres role cannot LOAD shared libraries. Reconnect using the local bootstrap role only to
-- load safeupdate; the operator calls below still run as service_role, as they do through the API.
\connect - supabase_admin
load 'safeupdate';
begin;
select no_plan();

-- A successful LOAD alone is not proof that the restriction is enforced.
create temporary table safeupdate_probe (id integer primary key, value integer not null);
insert into safeupdate_probe values (1, 1);
select throws_ok($$update safeupdate_probe set value = 2$$, '21000', 'UPDATE requires a WHERE clause',
  'safeupdate rejects a bare UPDATE, as the hosted API does');
select throws_ok($$delete from safeupdate_probe$$, '21000', 'DELETE requires a WHERE clause',
  'and rejects a bare DELETE');
select is((select value from safeupdate_probe where id = 1), 1, 'the rejected statements changed nothing');

-- Keep the launch window relative to the database clock so this regression stays useful after November 2026.
update private.entitlement_policy set actual_launch_at = null, early_access_enrollment_days = 10,
  early_access_claim_cutoff = clock_timestamp() + interval '60 days' where singleton = true;
create temporary table before_grants as select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb) as rows
  from public.entitlement_grants g;
create temporary table outcome (step text primary key, result jsonb);
grant insert, select on outcome to service_role;

set local role service_role;
insert into outcome values ('configure', public.admin_configure_early_access(now() + interval '1 day', 10, null,
  'safeupdate-test', 'configure before launch with safeupdate loaded'));
reset role;
select is((select result->>'state' from outcome where step = 'configure'), 'changed',
  'configure works before launch with safeupdate loaded');
select is((select jsonb_build_array(planned_launch_at, early_access_enrollment_days, actual_launch_at)
    from private.entitlement_policy where singleton = true),
  jsonb_build_array(now() + interval '1 day', 10, null), 'the policy row was configured without starting launch');

set local role service_role;
insert into outcome values ('launch', public.admin_activate_public_launch('safeupdate-test',
  'activate launch with safeupdate loaded', false));
reset role;
select is((select result->>'state' from outcome where step = 'launch'), 'launched',
  'launch works with safeupdate loaded');
select is((select jsonb_build_object('actual_launch_at', actual_launch_at, 'claim_closes_at', early_access_claim_closes_at)
    from private.entitlement_policy where singleton = true),
  (select result - 'state' - 'claim_days' - 'short_window' from outcome where step = 'launch'),
  'the launch and its closing instant were stored together');
select is((select early_access_claim_closes_at - actual_launch_at from private.entitlement_policy where singleton = true),
  interval '10 days', 'the window is still ten days');

set local role service_role;
insert into outcome values ('refused', public.admin_configure_early_access(null, 30, null, 'safeupdate-test',
  'try changing the window after launch'));
insert into outcome values ('legacy', public.admin_activate_public_launch('safeupdate-test', 'retry through the old wrapper', 200));
insert into outcome values ('retry', public.admin_activate_public_launch('safeupdate-test', 'retry the boolean form', false));
reset role;
select is((select result->>'state' from outcome where step = 'refused'), 'claim-window-fixed',
  'configure still refuses a day change after launch');
select is((select early_access_enrollment_days from private.entitlement_policy where singleton = true), 10,
  'the refused configuration left the days unchanged');
select is((select result->>'state' from outcome where step = 'legacy'), 'already-launched',
  'the old three-argument wrapper still reaches the same launch');
select is((select result->>'state' from outcome where step = 'retry'), 'already-launched',
  'the boolean form is still idempotent');
select ok((select bool_and(o.result->'actual_launch_at' = launch.result->'actual_launch_at'
    and o.result->'claim_closes_at' = launch.result->'claim_closes_at')
  from outcome o cross join (select result from outcome where step = 'launch') launch
  where o.step in ('refused', 'legacy', 'retry')), 'no refusal or retry moved either stored instant');
select is((select count(*)::integer from private.entitlement_events
    where event = 'operator.public-launch' and actor = 'operator:safeupdate-test'), 1, 'launch was audited once');
select is((select count(*)::integer from private.entitlement_events
    where event = 'operator.early-access-policy' and actor = 'operator:safeupdate-test'), 1,
  'only the successful configuration was audited');
select is((select coalesce(jsonb_agg(to_jsonb(g) order by g.id), '[]'::jsonb) from public.entitlement_grants g),
  (select rows from before_grants), 'existing grants were left untouched and none was issued');

select is((select count(*)::integer from unnest(array[
    'public.admin_configure_early_access(timestamptz,integer,boolean,text,text)',
    'public.admin_activate_public_launch(text,text,boolean)',
    'public.admin_activate_public_launch(text,text,integer)']) f
  where has_function_privilege('anon', f, 'execute') or has_function_privilege('authenticated', f, 'execute')
    or not has_function_privilege('service_role', f, 'execute')), 0, 'all three entry points remain service-role only');

select * from finish();
rollback;
