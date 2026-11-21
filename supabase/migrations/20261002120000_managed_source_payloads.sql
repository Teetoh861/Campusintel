-- supabase/migrations/20261002120000_managed_source_payloads.sql
-- Preserve structured repository study content in existing managed families.

create function private.valid_managed_text_array(
  p_payload jsonb, p_key text, p_max_items integer, p_max_text integer
)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_value jsonb;
begin
  if not p_payload ? p_key then
    return true;
  end if;
  if jsonb_typeof(p_payload->p_key) is distinct from 'array' or
     jsonb_array_length(p_payload->p_key) > p_max_items then
    return false;
  end if;
  for v_value in select value from jsonb_array_elements(p_payload->p_key) loop
    if jsonb_typeof(v_value) is distinct from 'string' or
       length(btrim(v_value #>> '{}')) not between 1 and p_max_text then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

create function private.valid_managed_record_array(
  p_payload jsonb, p_key text, p_required text[], p_optional text[],
  p_max_items integer, p_max_text integer
)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_value jsonb;
  v_field text;
begin
  if not p_payload ? p_key then
    return true;
  end if;
  if jsonb_typeof(p_payload->p_key) is distinct from 'array' or
     jsonb_array_length(p_payload->p_key) > p_max_items then
    return false;
  end if;
  for v_value in select value from jsonb_array_elements(p_payload->p_key) loop
    if jsonb_typeof(v_value) is distinct from 'object' then
      return false;
    end if;
    foreach v_field in array p_required loop
      if not private.valid_managed_text(v_value, v_field, p_max_text) then
        return false;
      end if;
    end loop;
    for v_field in select key from jsonb_object_keys(v_value) key loop
      if v_field <> all (p_required || p_optional) or
         not private.valid_managed_text(v_value, v_field, p_max_text) then
        return false;
      end if;
    end loop;
  end loop;
  return true;
end;
$$;

create or replace function private.assert_managed_payload(p_kind text, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_option jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or
     octet_length(p_payload::text) > 262144 then
    raise exception using errcode = '22023', message = 'Invalid managed content';
  end if;
  if p_kind = 'course_overview' then
    if not private.valid_managed_text(p_payload, 'title', 240) or
       not private.valid_managed_text(p_payload, 'body', 200000) or
       not private.valid_managed_record_array(p_payload, 'topics',
         array['chapter','description'], array[]::text[], 200, 10000) or
       not private.valid_managed_text_array(p_payload, 'examFocus', 200, 10000) or
       not private.valid_managed_record_array(p_payload, 'keyTakeaways',
         array['title','description'], array[]::text[], 200, 10000) or
       not private.valid_managed_record_array(p_payload, 'formulaSheet',
         array['name','formula','explanation'], array['example'], 200, 10000) or
       exists (select 1 from jsonb_object_keys(p_payload) key
               where key <> all (array['title','body','topics','examFocus',
                                       'keyTakeaways','formulaSheet'])) then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
  elsif p_kind = 'note' then
    if not private.valid_managed_text(p_payload, 'title', 240) or
       not private.valid_managed_text(p_payload, 'body', 200000) or
       (p_payload ? 'noteType' and p_payload->>'noteType' not in
         ('topic_note','calculator_trick')) or
       exists (select 1 from jsonb_object_keys(p_payload) key
               where key <> all (array['title','body','noteType','keyPoints',
                                       'examTip','example','formula'])) then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
    if p_payload->>'noteType' = 'topic_note' then
      if jsonb_typeof(p_payload->'keyPoints') is distinct from 'array' or
         jsonb_array_length(p_payload->'keyPoints') = 0 or
         not private.valid_managed_text_array(p_payload, 'keyPoints', 200, 10000) or
         not private.valid_optional_managed_text(p_payload, 'examTip', 10000) or
         p_payload ?| array['example','formula'] then
        raise exception using errcode = '22023', message = 'Invalid managed content';
      end if;
    elsif p_payload->>'noteType' = 'calculator_trick' then
      if not private.valid_managed_text(p_payload, 'example', 10000) or
         not private.valid_optional_managed_text(p_payload, 'formula', 10000) or
         p_payload ?| array['keyPoints','examTip'] then
        raise exception using errcode = '22023', message = 'Invalid managed content';
      end if;
    elsif (select count(*) from jsonb_object_keys(p_payload)) <> 2 then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
  elsif p_kind = 'cbt_question' then
    if not private.valid_managed_text(p_payload, 'prompt', 10000) or
       not private.valid_optional_managed_text(p_payload, 'section', 240) or
       not private.valid_optional_managed_text(p_payload, 'explanation', 10000) or
       jsonb_typeof(p_payload->'options') is distinct from 'array' or
       jsonb_typeof(p_payload->'correctOption') is distinct from 'number' or
       (p_payload->>'correctOption') !~ '^[0-7]$' or
       exists (select 1 from jsonb_object_keys(p_payload) key
               where key <> all (array['prompt','section','explanation','options','correctOption'])) then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
    if jsonb_array_length(p_payload->'options') not between 2 and 8 or
       (p_payload->>'correctOption')::integer >= jsonb_array_length(p_payload->'options') then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
    for v_option in select value from jsonb_array_elements(p_payload->'options') loop
      if jsonb_typeof(v_option) <> 'string' or
         length(btrim(v_option #>> '{}')) not between 1 and 2000 then
        raise exception using errcode = '22023', message = 'Invalid managed content';
      end if;
    end loop;
  elsif p_kind = 'theory_question' then
    if not private.valid_managed_text(p_payload, 'prompt', 20000) or
       not private.valid_optional_managed_text(p_payload, 'examTip', 10000) or
       exists (select 1 from jsonb_object_keys(p_payload) key
               where key <> all (array['prompt','examTip'])) then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
  elsif p_kind in ('model_answer', 'rubric') then
    if not private.valid_managed_text(p_payload, 'body', 200000) or
       (select count(*) from jsonb_object_keys(p_payload)) <> 1 then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
  else
    raise exception using errcode = '22023', message = 'Invalid managed content';
  end if;
end;
$$;

revoke all on function private.valid_managed_text_array(jsonb,text,integer,integer)
  from public, anon, authenticated, service_role;
revoke all on function private.valid_managed_record_array(jsonb,text,text[],text[],integer,integer)
  from public, anon, authenticated, service_role;
revoke all on function private.assert_managed_payload(text,jsonb)
  from public, anon, authenticated, service_role;
