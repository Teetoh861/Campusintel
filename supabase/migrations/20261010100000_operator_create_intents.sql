-- Durable, operator-scoped runtime create receipts. Imported items remain unchanged.
create table private.managed_content_create_intents (
  actor_id uuid not null,
  intent_id uuid not null,
  item_id uuid not null unique references public.managed_content_items(id)
    on update restrict on delete restrict deferrable initially deferred,
  request jsonb not null,
  primary key (actor_id, intent_id)
);
alter table private.managed_content_create_intents enable row level security;
revoke all on table private.managed_content_create_intents from public, anon, authenticated, service_role;

create function public.create_managed_content_once(
  p_course_id uuid, p_kind text, p_payload jsonb, p_create_intent_id uuid,
  p_parent_item_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_item_id uuid := gen_random_uuid();
  v_inserted uuid;
  v_existing private.managed_content_create_intents%rowtype;
  v_request jsonb := jsonb_build_object('course', p_course_id, 'kind', p_kind,
    'parent', p_parent_item_id, 'payload', p_payload);
begin
  if p_create_intent_id is null then
    raise exception using errcode = '22023', message = 'Create intent required';
  end if;
  -- The unique key waits only for an equivalent actor/intent transaction. The
  -- item FK is deferred until commit; any failure rolls back receipt + content.
  insert into private.managed_content_create_intents(actor_id, intent_id, item_id, request)
  values (v_actor, p_create_intent_id, v_item_id, v_request)
  on conflict (actor_id, intent_id) do nothing
  returning item_id into v_inserted;
  if v_inserted is null then
    select * into strict v_existing from private.managed_content_create_intents
    where actor_id = v_actor and intent_id = p_create_intent_id;
    if v_existing.request is distinct from v_request then
      raise exception using errcode = '40001', message = 'Create intent does not match';
    end if;
    return v_existing.item_id;
  end if;

  perform private.assert_managed_payload(p_kind, p_payload);
  if p_course_id is null or
     (p_kind in ('model_answer', 'rubric') and
       not exists (select 1 from public.managed_content_items parent
                   where parent.id = p_parent_item_id and parent.course_id = p_course_id
                     and parent.kind = 'theory_question')) or
     (p_kind not in ('model_answer', 'rubric') and p_parent_item_id is not null) then
    raise exception using errcode = '22023', message = 'Invalid managed content identity';
  end if;
  insert into public.managed_content_items
    (id, course_id, kind, question_id, parent_item_id, created_by)
  values (v_item_id, p_course_id, p_kind,
    case when p_kind = 'cbt_question' then gen_random_uuid() else null end, p_parent_item_id, v_actor);
  insert into public.managed_content_revisions(item_id, revision, payload, authored_by)
  values (v_item_id, 1, p_payload, v_actor);
  return v_item_id;
end;
$$;

revoke all on function public.create_managed_content_once(uuid,text,jsonb,uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.create_managed_content_once(uuid,text,jsonb,uuid,uuid) to authenticated;
-- Retain the historical function for owner-only legacy/import verification,
-- but ordinary callers cannot create without a durable intent.
revoke all on function public.create_managed_content(uuid,text,jsonb,uuid,text,uuid)
  from public, anon, authenticated, service_role;
