-- Checked imports are operator-only, idempotent by explicit event ID and canonical pack hash.
create function public.orientation_import(p_event uuid, p_pack jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := private.require_live_operator(); q jsonb; opt jsonb; n integer := 0;
  correct_count integer; answer_index integer; options jsonb; existing_hash text; c text;
begin
  if p_event is null or jsonb_typeof(p_pack) <> 'object'
    or p_pack->>'kind' not in ('official','practice') or p_pack->>'title' is null
    or char_length(btrim(p_pack->>'title')) not between 1 and 100
    or jsonb_typeof(p_pack->'questions') is distinct from 'array'
    or jsonb_array_length(p_pack->'questions') not between 18 and 45 then
    raise exception 'Invalid question pack' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_array_elements(p_pack->'questions') x where x->>'spare' = 'false') <> 15 then
    raise exception 'Expected fifteen main questions' using errcode = '22023';
  end if;
  foreach c in array array['orientation','general','campusintell'] loop
    if (select count(*) from jsonb_array_elements(p_pack->'questions') x where x->>'category' = c and x->>'spare' = 'false') <> 5 then
      raise exception 'Expected five main questions per category' using errcode = '22023';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_pack->'questions') x where x->>'spare' = 'true') < 3
    or exists(select 1 from jsonb_array_elements(p_pack->'questions') x
      where x->>'spare' = 'true' and x->>'category' not in ('general','campusintell')) then
    raise exception 'Expected at least three independent spares' using errcode = '22023';
  end if;
  -- Serialize duplicate imports even when the event row does not yet exist.
  perform pg_advisory_xact_lock(hashtextextended(p_event::text,0));
  select import_hash into existing_hash from private.orientation_events where id = p_event;
  if found then
    if existing_hash <> md5(p_pack::text) then raise exception 'Event already contains a different pack' using errcode = '22023'; end if;
    return p_event;
  end if;
  insert into private.orientation_events(id,title,kind,import_hash)
    values(p_event,btrim(p_pack->>'title'),p_pack->>'kind',md5(p_pack::text));
  -- Main ordinals always remain 1..15 regardless of where spares appear in the source file.
  for q in select value from jsonb_array_elements(p_pack->'questions') with ordinality order by (value->>'spare')::boolean, ordinality loop
    n := n + 1;
    if jsonb_typeof(q->'spare') is distinct from 'boolean' or q->>'category' not in ('orientation','general','campusintell')
      or q->>'prompt' is null or char_length(btrim(q->>'prompt')) not between 1 and 240
      or jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options') not between 2 and 4 then
      raise exception 'Invalid question' using errcode = '22023';
    end if;
    options := '[]'::jsonb; correct_count := 0; answer_index := null;
    for opt in select value from jsonb_array_elements(q->'options') loop
      if jsonb_typeof(opt->'text') is distinct from 'string' or char_length(btrim(opt->>'text')) not between 1 and 120
        or jsonb_typeof(opt->'correct') is distinct from 'boolean' then
        raise exception 'Invalid option' using errcode = '22023';
      end if;
      if (opt->>'correct')::boolean then correct_count := correct_count + 1; answer_index := jsonb_array_length(options); end if;
      options := options || jsonb_build_array(btrim(opt->>'text'));
    end loop;
    if (select count(distinct value) from jsonb_array_elements(options)) <> jsonb_array_length(options) then
      raise exception 'Options must be distinct' using errcode = '22023';
    end if;
    if correct_count <> 1 then raise exception 'Expected exactly one correct option' using errcode = '22023'; end if;
    insert into private.orientation_questions(event_id,ordinal,category,spare,prompt,options,correct)
      values(p_event,n,q->>'category',(q->>'spare')::boolean,btrim(q->>'prompt'),options,answer_index);
  end loop;
  return p_event;
end $$;
revoke all on function public.orientation_import(uuid,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.orientation_import(uuid,jsonb) to authenticated;
