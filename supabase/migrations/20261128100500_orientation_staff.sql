-- Event-scoped staff can check and collect codes; they receive no host or player privileges.
create function public.orientation_staff_events() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_live_account(); is_operator boolean;
begin
  is_operator := exists(select 1 from public.profiles where id = actor and role = 'operator');
  return jsonb_build_object('events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title)
    order by e.created_at desc),'[]'::jsonb) from private.orientation_events e where is_operator or
    exists(select 1 from private.orientation_staff s where s.event_id = e.id and s.user_id = actor)));
end $$;

create function public.orientation_staff_claim(p_event uuid, p_code text, p_collect boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_live_account(); e private.orientation_events%rowtype;
  w private.orientation_winners%rowtype; normalized text;
begin
  -- Same event-first order as host commands; revocation and collection serialize on this row.
  select * into e from private.orientation_events where id = p_event for share;
  if e.id is null or not (exists(select 1 from public.profiles where id = actor and role = 'operator') or
    exists(select 1 from private.orientation_staff where event_id = p_event and user_id = actor)) then
    raise exception 'Event staff authorization required' using errcode = '42501';
  end if;
  if e.phase not in ('ended','off') then return jsonb_build_object('status','missing'); end if;
  if p_code is null or char_length(p_code) > 80 then return jsonb_build_object('status','missing'); end if;
  normalized := regexp_replace(upper(btrim(p_code)),'[ -]','','g');
  if normalized !~ '^[0-9A-F]{16}$' then return jsonb_build_object('status','missing'); end if;
  if p_collect then
    select * into w from private.orientation_winners where event_id = p_event and claim_code = normalized for update;
  else
    select * into w from private.orientation_winners where event_id = p_event and claim_code = normalized;
  end if;
  if w.player_id is null then return jsonb_build_object('status','missing'); end if;
  if p_collect and w.collected_at is null then
    update private.orientation_winners set collected_at = clock_timestamp(),collected_by = actor
      where event_id = p_event and player_id = w.player_id and collected_at is null returning * into w;
  end if;
  return jsonb_build_object('status','ok','winner',jsonb_build_object(
    'name',(select first_name || ' ' || surname from private.orientation_players where id = w.player_id),
    'position',(select s.position from private.orientation_scores(p_event) s where s.player_id = w.player_id),'prize',w.prize_name,'collectedAt',w.collected_at));
end $$;
revoke all on function public.orientation_staff_events(), public.orientation_staff_claim(uuid,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.orientation_staff_events(), public.orientation_staff_claim(uuid,text,boolean) to authenticated;
