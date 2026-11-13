-- supabase/migrations/20261113090000_study_guide_imports.sql
-- Study guide imports for the other courses. private.study_guide (20261111090000_study_guide_notes.sql) gains three
-- things the first guide did not need. An import that uses none of them behaves exactly as before.
--   keep             Study items the course publishes today that stay published as they are: a course's own theory
--                    questions and their answers. The import refuses unless each is still published at the revision
--                    it read, before and after.
--   overview.create  The course has no overview. The import creates one at revision one, holding the outcomes and how
--                    the course is assessed, and a rollback unpublishes it as it does the guide's notes. It refuses
--                    if the course has gained an overview of its own.
--   course           The course has no repository identity. The import creates it and links its catalogue course,
--                    once, exactly as the official banks do; a rollback leaves both in place.
-- Nothing is deleted by any of them, and every publication and unpublication is in the publish history.

-- This guide's own items: its notes, theory questions and model answers, and the overview when the import creates it.
create or replace function private.study_guide_items(p_doc jsonb) returns setof jsonb
language sql immutable set search_path = '' as $$
  select value from jsonb_array_elements(p_doc->'notes')
  union all select value from jsonb_array_elements(p_doc->'theory')
  union all select value->'answer' from jsonb_array_elements(p_doc->'theory')
  union all select jsonb_build_object('itemId', p_doc->'overview'->>'itemId', 'kind', 'course_overview',
      'sourceKey', 'course-overview', 'payload', p_doc->'overview'->'after')
    where p_doc->'overview'->'create' = 'true'::jsonb
$$;

-- Where a course stands: 'before' (it publishes exactly the study items the import was written against, the overview
-- text it replaces, and none of this guide's items), 'after' (it publishes this guide's items unchanged, the guide's
-- overview, what it keeps, and nothing it retired) or 'other'. An unpublished edit by anyone else to one of the
-- guide's items is 'other'.
create or replace function private.study_guide_state(p_doc jsonb) returns text
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_course uuid := (p_doc->>'courseId')::uuid;
  v_actor uuid := (p_doc->>'actor')::uuid;
  v_creates boolean := coalesce(p_doc->'overview'->'create' = 'true'::jsonb, false);
  v_ours uuid[];
  v_others jsonb;
  v_retire jsonb;
  v_keep jsonb;
  v_row jsonb;
  v_item public.managed_content_items;
  v_payload jsonb;
  v_author uuid;
  v_none_published boolean := true;
  v_all_published boolean := true;
  v_overview text := 'none';
begin
  select coalesce(array_agg((value->>'itemId')::uuid), array[]::uuid[]) into v_ours from private.study_guide_items(p_doc) as items(value);
  select coalesce(jsonb_object_agg(id::text, published_revision), '{}') into v_others
    from public.managed_content_items
    where course_id = v_course and kind in ('note', 'theory_question', 'model_answer', 'rubric')
      and published_revision is not null and id <> all (v_ours);
  select coalesce(jsonb_object_agg(value->>'itemId', (value->>'revision')::integer), '{}') into v_retire
    from jsonb_array_elements(coalesce(p_doc->'retire', '[]'::jsonb));
  select coalesce(jsonb_object_agg(value->>'itemId', (value->>'revision')::integer), '{}') into v_keep
    from jsonb_array_elements(coalesce(p_doc->'keep', '[]'::jsonb));
  for v_row in select value from private.study_guide_items(p_doc) as items(value) loop
    select * into v_item from public.managed_content_items where id = (v_row->>'itemId')::uuid;
    if v_item.id is null then
      v_all_published := false;
      continue;
    end if;
    select payload into v_payload from public.managed_content_revisions where item_id = v_item.id and revision = 1;
    if v_item.created_by is distinct from v_actor or v_item.course_id is distinct from v_course or
       v_item.kind is distinct from v_row->>'kind' or v_item.source_key is distinct from v_row->>'sourceKey' or
       v_item.current_revision <> 1 or v_item.approved_revision is distinct from 1 or
       v_payload is distinct from v_row->'payload' then
      return 'other';
    end if;
    if v_item.published_revision is null then v_all_published := false; else v_none_published := false; end if;
  end loop;
  if v_creates then
    -- The overview is one of the guide's own items, checked above. Any other overview on the course is not ours.
    if exists (select 1 from public.managed_content_items where course_id = v_course and kind = 'course_overview'
        and id <> (p_doc->'overview'->>'itemId')::uuid) then
      return 'other';
    end if;
  elsif jsonb_typeof(p_doc->'overview') = 'object' then
    select * into v_item from public.managed_content_items where id = (p_doc->'overview'->>'itemId')::uuid;
    select payload, authored_by into v_payload, v_author from public.managed_content_revisions
      where item_id = v_item.id and revision = v_item.published_revision;
    if v_item.id is null or v_item.kind <> 'course_overview' or v_item.course_id <> v_course or
       (v_item.current_revision <> v_item.published_revision and not exists (
         select 1 from public.managed_content_revisions c where c.item_id = v_item.id and c.revision = v_item.current_revision
           and c.authored_by = v_actor and c.payload = p_doc->'overview'->'after')) then
      return 'other';
    end if;
    if v_payload = p_doc->'overview'->'before' then v_overview := 'before';
    elsif v_payload = p_doc->'overview'->'after' and v_author = v_actor and v_item.current_revision = v_item.published_revision
      then v_overview := 'after';
    else return 'other';
    end if;
  end if;
  if v_overview in ('none', 'before') and v_none_published and v_others = v_retire || v_keep then
    return 'before';
  end if;
  if v_overview in ('none', 'after') and v_all_published and v_others = v_keep then
    return 'after';
  end if;
  return 'other';
end;
$$;

-- Apply or roll back one guide, in one statement: everything or nothing.
create or replace function private.study_guide(p_guide text, p_action text) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_doc jsonb := private.study_guide_source(p_guide);
  v_course uuid := (v_doc->>'courseId')::uuid;
  v_actor uuid := (v_doc->>'actor')::uuid;
  v_creates boolean := coalesce(v_doc->'overview'->'create' = 'true'::jsonb, false);
  v_created jsonb := jsonb_build_object('itemId', v_doc->'overview'->>'itemId', 'kind', 'course_overview',
    'sourceKey', 'course-overview', 'payload', v_doc->'overview'->'after');
  v_from text;
  v_to text;
  v_state text;
  v_row jsonb;
  v_item public.managed_content_items;
  v_revision integer;
  v_catalogue uuid;
begin
  if p_action is null or p_action not in ('apply', 'rollback') then
    raise exception 'Study guide %: unknown action %', v_doc->>'code', p_action;
  end if;
  v_from := case when p_action = 'apply' then 'before' else 'after' end;
  v_to := case when p_action = 'apply' then 'after' else 'before' end;
  -- Every study item of the course, locked in one order before anything is read or written.
  perform 1 from public.managed_content_items
    where course_id = v_course and kind in ('course_overview', 'note', 'theory_question', 'model_answer', 'rubric')
    order by id for update;
  v_state := private.study_guide_state(v_doc);
  if v_state = v_to then
    return 'unchanged';
  end if;
  if v_state <> v_from then
    raise exception 'Study guide %: the published notes, theory or overview are not the ones this import %', v_doc->>'code',
      case when p_action = 'apply' then 'replaces' else 'published' end;
  end if;

  if p_action = 'apply' then
    -- A new course, once: its repository identity and the link from its catalogue course, which must already apply at
    -- its level in every semester it is taught. An apply after a rollback finds them in place; anything else is refused.
    if jsonb_typeof(v_doc->'course') = 'object' then
      insert into public.courses (id, content_key, is_shared)
        values (v_course, v_doc->'course'->>'contentKey', null) on conflict do nothing;
      if not exists (select 1 from public.courses where id = v_course and content_key = v_doc->'course'->>'contentKey') then
        raise exception 'Study guide %: the repository identity is not this course''s', v_doc->>'code';
      end if;
      update public.institutional_courses set repository_course_id = v_course
        where course_code = v_doc->>'code' and repository_course_id is null
          and display_title in (select jsonb_array_elements_text(v_doc->'course'->'titles'));
      select id into v_catalogue from public.institutional_courses
        where course_code = v_doc->>'code' and repository_course_id = v_course;
      if v_catalogue is null or (select count(*) from public.institutional_courses where course_code = v_doc->>'code') <> 1 then
        raise exception 'Study guide %: the catalogue course is not linked exactly once', v_doc->>'code';
      end if;
      -- Which students see the course stays the catalogue's: the import never adds or removes applicability rows.
      if exists (select 1 from jsonb_array_elements_text(v_doc->'course'->'semesters') s(key)
          where not exists (select 1 from public.course_applicability a
            join public.academic_levels l on l.id = a.academic_level_id
            join public.academic_periods p on p.id = a.academic_period_id
            where a.institutional_course_id = v_catalogue and l.key = v_doc->'course'->>'level' and p.key = s.key)) then
        raise exception 'Study guide %: the catalogue course does not apply at its level in every semester it is taught',
          v_doc->>'code';
      end if;
    end if;
    -- Retired items are unpublished, never deleted; the list puts answers before their questions.
    for v_row in select value from jsonb_array_elements(coalesce(v_doc->'retire', '[]'::jsonb)) loop
      perform private.study_guide_unpublish((v_row->>'itemId')::uuid, v_actor);
    end loop;
    if v_creates then
      perform private.study_guide_publish(v_created, v_course, v_actor, null);
    elsif jsonb_typeof(v_doc->'overview') = 'object' then
      select * into v_item from public.managed_content_items where id = (v_doc->'overview'->>'itemId')::uuid;
      -- The guide's overview is the next revision, or the revision this import wrote before a rollback.
      select r.revision into v_revision from public.managed_content_revisions r
        where r.item_id = v_item.id and r.authored_by = v_actor and r.payload = v_doc->'overview'->'after'
        order by r.revision desc limit 1;
      if v_revision is null then
        perform private.assert_managed_payload('course_overview', v_doc->'overview'->'after');
        v_revision := v_item.current_revision + 1;
        insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
          values (v_item.id, v_revision, v_doc->'overview'->'after', v_actor);
        update public.managed_content_items set current_revision = v_revision, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
      if v_item.approved_revision is distinct from v_revision then
        insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
          values (v_item.id, v_revision, null, 'approved', v_actor, v_item.lock_version + 1);
        update public.managed_content_items set approved_revision = v_revision, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
      insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision,
          previous_revision, previous_parent_revision, acted_by)
        values (v_item.id, v_item.lock_version + 1, 'publish', v_revision, null, v_item.published_revision, null, v_actor);
      update public.managed_content_items set published_revision = v_revision, lock_version = lock_version + 1,
        updated_at = now() where id = v_item.id;
    end if;
    for v_row in select value from jsonb_array_elements(v_doc->'notes') loop
      perform private.study_guide_publish(v_row, v_course, v_actor, null);
    end loop;
    for v_row in select value from jsonb_array_elements(v_doc->'theory') loop
      perform private.study_guide_publish(v_row, v_course, v_actor, null);
      perform private.study_guide_publish(v_row->'answer', v_course, v_actor, (v_row->>'itemId')::uuid);
    end loop;
  else
    for v_row in select value from jsonb_array_elements(v_doc->'theory') loop
      perform private.study_guide_unpublish((v_row->'answer'->>'itemId')::uuid, v_actor);
      perform private.study_guide_unpublish((v_row->>'itemId')::uuid, v_actor);
    end loop;
    for v_row in select value from jsonb_array_elements(v_doc->'notes') loop
      perform private.study_guide_unpublish((v_row->>'itemId')::uuid, v_actor);
    end loop;
    -- Retired items come back at the revision they had, questions before their answers.
    for v_row in select value from jsonb_array_elements(coalesce(v_doc->'retire', '[]'::jsonb)) with ordinality r(value, n)
        order by n desc loop
      select * into v_item from public.managed_content_items where id = (v_row->>'itemId')::uuid;
      if v_item.approved_revision is distinct from (v_row->>'revision')::integer then
        raise exception 'Study guide %: % is no longer approved at the revision it had', v_doc->>'code', v_item.id;
      end if;
      insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision, acted_by)
        values (v_item.id, v_item.lock_version + 1, 'publish', (v_row->>'revision')::integer,
          (v_row->>'parentRevision')::integer, v_actor);
      update public.managed_content_items set published_revision = (v_row->>'revision')::integer,
        published_parent_revision = (v_row->>'parentRevision')::integer, lock_version = lock_version + 1,
        updated_at = now() where id = v_item.id;
    end loop;
    if v_creates then
      perform private.study_guide_unpublish((v_doc->'overview'->>'itemId')::uuid, v_actor);
    elsif jsonb_typeof(v_doc->'overview') = 'object' then
      select * into v_item from public.managed_content_items where id = (v_doc->'overview'->>'itemId')::uuid;
      select p.previous_revision into v_revision from public.managed_content_publications p
        where p.item_id = v_item.id and p.action = 'publish' and p.revision = v_item.published_revision
          and p.acted_by = v_actor
        order by p.lock_version desc limit 1;
      if v_revision is null or not exists (select 1 from public.managed_content_revisions r
          where r.item_id = v_item.id and r.revision = v_revision and r.payload = v_doc->'overview'->'before') then
        raise exception 'Study guide %: the overview from before is not the revision it replaced', v_doc->>'code';
      end if;
      insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
        values (v_item.id, v_revision, null, 'approved', v_actor, v_item.lock_version + 1);
      update public.managed_content_items set approved_revision = v_revision, lock_version = lock_version + 1,
        updated_at = now() where id = v_item.id returning * into v_item;
      insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision,
          previous_revision, previous_parent_revision, acted_by)
        values (v_item.id, v_item.lock_version + 1, 'publish', v_revision, null, v_item.published_revision, null, v_actor);
      update public.managed_content_items set published_revision = v_revision, lock_version = lock_version + 1,
        updated_at = now() where id = v_item.id;
    end if;
  end if;

  if private.study_guide_state(v_doc) <> v_to then
    raise exception 'Study guide %: % did not reach the expected state', v_doc->>'code', p_action;
  end if;
  return case when p_action = 'apply' then 'applied' else 'rolled-back' end;
end;
$$;

revoke all on function private.study_guide_items(jsonb), private.study_guide_state(jsonb), private.study_guide(text, text)
  from public, anon, authenticated, service_role;
