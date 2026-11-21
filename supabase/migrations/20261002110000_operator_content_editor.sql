-- supabase/migrations/20261002110000_operator_content_editor.sql — Atomic course provisioning and operator-only content history.

-- A catalogue identity is locked before creating its repository identity. A
-- second request waits, observes the existing link, and cannot create a copy.
create function public.provision_repository_content(p_institutional_course_id uuid)
returns table (repository_course_id uuid, created boolean)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_catalogue public.institutional_courses%rowtype;
  v_repository_id uuid;
begin
  select * into v_catalogue
  from public.institutional_courses
  where id = p_institutional_course_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'Unknown institutional course';
  end if;
  if v_catalogue.repository_course_id is not null then
    return query select v_catalogue.repository_course_id, false;
    return;
  end if;

  v_repository_id := gen_random_uuid();
  insert into public.courses (id, content_key, is_shared)
  values (v_repository_id, 'managed-' || replace(v_repository_id::text, '-', ''), null);
  update public.institutional_courses as catalogue
  set repository_course_id = v_repository_id
  where catalogue.id = p_institutional_course_id and catalogue.repository_course_id is null;
  if not found then
    raise exception using errcode = '40001', message = 'Institutional course link changed';
  end if;
  return query select v_repository_id, true;
end;
$$;

-- Append-only history stays behind the same live Auth and role check as the
-- editor mutations. No direct table access or student history endpoint exists.
create function public.get_managed_content_history(p_item_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_item public.managed_content_items%rowtype;
begin
  select * into v_item from public.managed_content_items where id = p_item_id;
  if not found then
    raise exception using errcode = '22023', message = 'Unknown managed content';
  end if;
  return jsonb_build_object(
    'item', to_jsonb(v_item),
    'revisions', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.revision)
      from public.managed_content_revisions r where r.item_id = p_item_id
    ), '[]'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.lock_version)
      from public.managed_content_reviews r where r.item_id = p_item_id
    ), '[]'::jsonb),
    'publications', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.lock_version)
      from public.managed_content_publications p where p.item_id = p_item_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.provision_repository_content(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_managed_content_history(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.provision_repository_content(uuid) to authenticated;
grant execute on function public.get_managed_content_history(uuid) to authenticated;

comment on function public.provision_repository_content(uuid) is
  'Live operators can atomically create and link one repository identity for one unlinked institutional course. A linked row is returned unchanged.';
comment on function public.get_managed_content_history(uuid) is
  'Live operator-only revision, review, and publication history for one managed item.';
