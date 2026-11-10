-- supabase/migrations/20261111090000_study_guide_notes.sql
-- Study guide notes. A guide topic is a note of type guide_topic: a tree of plain text with bold and italic flags,
-- paragraphs, lists, tables and preformatted text, parsed from the owner's guides when the repository is built and
-- rendered by the site as React elements, so no HTML ever reaches a page. Each topic's theory question and answer are
-- ordinary theory items. Course overviews gain two lists: outcomes and how the course is assessed. Notes gain an
-- explicit order. Each guide is imported by its own migration through private.study_guide(guide, action), which
-- publishes through the managed-content history, refuses unless the course's published study items are exactly the
-- ones the import was written against, does nothing on a rerun, and rolls back without deleting anything.

-- ---------------------------------------------------------------------------------------------------------------
-- The guide topic payload.
-- ---------------------------------------------------------------------------------------------------------------

-- Inline text: spans of non-empty text, each optionally bold and/or italic. Table cells may be empty.
create function private.valid_guide_inline(p_value jsonb, p_allow_empty boolean default false)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_span jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 500 or
     (jsonb_array_length(p_value) = 0 and not p_allow_empty) then
    return false;
  end if;
  for v_span in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_span) <> 'object' or jsonb_typeof(v_span->'text') is distinct from 'string' or
       length(v_span->>'text') not between 1 and 20000 or
       exists (select 1 from jsonb_object_keys(v_span) key where key <> all (array['text','bold','italic'])) or
       (v_span ? 'bold' and v_span->'bold' <> 'true'::jsonb) or
       (v_span ? 'italic' and v_span->'italic' <> 'true'::jsonb) then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- Blocks: paragraph, list (items of inline text with nested blocks), table (a header and rows of cells) and
-- preformatted text. Nesting stops at depth 6.
create function private.valid_guide_blocks(p_value jsonb, p_depth integer default 0, p_allow_empty boolean default false)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_block jsonb;
  v_item jsonb;
  v_row jsonb;
  v_cell jsonb;
  v_width integer;
begin
  if p_depth > 6 or p_value is null or jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 2000 or
     (jsonb_array_length(p_value) = 0 and not p_allow_empty) then
    return false;
  end if;
  for v_block in select value from jsonb_array_elements(p_value) loop
    if jsonb_typeof(v_block) <> 'object' then
      return false;
    end if;
    if v_block->>'type' = 'paragraph' then
      if exists (select 1 from jsonb_object_keys(v_block) key where key <> all (array['type','text'])) or
         not private.valid_guide_inline(v_block->'text') then
        return false;
      end if;
    elsif v_block->>'type' = 'preformatted' then
      if exists (select 1 from jsonb_object_keys(v_block) key where key <> all (array['type','text'])) or
         jsonb_typeof(v_block->'text') is distinct from 'string' or length(v_block->>'text') not between 1 and 20000 then
        return false;
      end if;
    elsif v_block->>'type' = 'list' then
      if exists (select 1 from jsonb_object_keys(v_block) key where key <> all (array['type','ordered','start','items'])) or
         jsonb_typeof(v_block->'ordered') is distinct from 'boolean' or
         (v_block->'ordered' = 'true'::jsonb) <> (v_block ? 'start') or
         (v_block ? 'start' and (jsonb_typeof(v_block->'start') <> 'number' or (v_block->>'start') !~ '^[1-9][0-9]{0,3}$')) or
         jsonb_typeof(v_block->'items') is distinct from 'array' or jsonb_array_length(v_block->'items') not between 1 and 500 then
        return false;
      end if;
      for v_item in select value from jsonb_array_elements(v_block->'items') loop
        if jsonb_typeof(v_item) <> 'object' or
           exists (select 1 from jsonb_object_keys(v_item) key where key <> all (array['text','blocks'])) or
           not private.valid_guide_inline(v_item->'text') or
           (v_item ? 'blocks' and not private.valid_guide_blocks(v_item->'blocks', p_depth + 1)) then
          return false;
        end if;
      end loop;
    elsif v_block->>'type' = 'table' then
      if exists (select 1 from jsonb_object_keys(v_block) key where key <> all (array['type','header','rows'])) or
         jsonb_typeof(v_block->'header') is distinct from 'array' or
         jsonb_typeof(v_block->'rows') is distinct from 'array' or jsonb_array_length(v_block->'rows') > 500 then
        return false;
      end if;
      v_width := jsonb_array_length(v_block->'header');
      if v_width not between 1 and 20 then
        return false;
      end if;
      for v_row in select (v_block->'header') union all select value from jsonb_array_elements(v_block->'rows') loop
        if jsonb_typeof(v_row) <> 'array' or jsonb_array_length(v_row) <> v_width then
          return false;
        end if;
        for v_cell in select value from jsonb_array_elements(v_row) loop
          if not private.valid_guide_inline(v_cell, true) then
            return false;
          end if;
        end loop;
      end loop;
    else
      return false;
    end if;
  end loop;
  return true;
end;
$$;

-- A guide topic: its number, "What you must know", optional blocks after it, lessons (each with "Must know" and an
-- optional "Explain more"), the recap, its theory question (shown in the note, answered on the theory page) and the
-- practice topics its buttons open.
create function private.valid_guide_topic(p_payload jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v_lesson jsonb;
  v_practice jsonb;
begin
  if jsonb_typeof(p_payload->'number') is distinct from 'number' or (p_payload->>'number') !~ '^[1-9][0-9]?$' or
     not private.valid_guide_inline(p_payload->'mustKnow') or
     (p_payload ? 'introMore' and not private.valid_guide_blocks(p_payload->'introMore')) or
     not private.valid_guide_blocks(p_payload->'recap') or
     jsonb_typeof(p_payload->'lessons') is distinct from 'array' or
     jsonb_array_length(p_payload->'lessons') not between 1 and 50 then
    return false;
  end if;
  for v_lesson in select value from jsonb_array_elements(p_payload->'lessons') loop
    if jsonb_typeof(v_lesson) <> 'object' or
       exists (select 1 from jsonb_object_keys(v_lesson) key
               where key <> all (array['number','title','mustKnow','explainMore'])) or
       (v_lesson->>'number') !~ '^[1-9][0-9]?\.[1-9][0-9]?$' or
       not private.valid_managed_text(v_lesson, 'title', 240) or
       not private.valid_guide_blocks(v_lesson->'mustKnow') or
       (v_lesson ? 'explainMore' and not private.valid_guide_blocks(v_lesson->'explainMore')) then
      return false;
    end if;
  end loop;
  if p_payload ? 'theory' and (jsonb_typeof(p_payload->'theory') <> 'object' or
     exists (select 1 from jsonb_object_keys(p_payload->'theory') key where key <> all (array['itemId','question'])) or
     (p_payload->'theory'->>'itemId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or
     not private.valid_guide_blocks(p_payload->'theory'->'question')) then
    return false;
  end if;
  if p_payload ? 'practice' then
    if jsonb_typeof(p_payload->'practice') <> 'array' or jsonb_array_length(p_payload->'practice') not between 1 and 10 then
      return false;
    end if;
    for v_practice in select value from jsonb_array_elements(p_payload->'practice') loop
      if jsonb_typeof(v_practice) <> 'object' or
         exists (select 1 from jsonb_object_keys(v_practice) key where key <> all (array['topic','named'])) or
         not private.valid_managed_text(v_practice, 'topic', 240) or
         jsonb_typeof(v_practice->'named') is distinct from 'boolean' then
        return false;
      end if;
    end loop;
  end if;
  return true;
end;
$$;

-- The payload check, as 20261002120000_managed_source_payloads.sql wrote it, with guide topics and the two overview
-- lists added. Every other family and note type is checked exactly as before, and the older note types refuse the
-- guide fields.
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
       not private.valid_managed_text_array(p_payload, 'outcomes', 200, 10000) or
       not private.valid_managed_text_array(p_payload, 'assessment', 200, 10000) or
       exists (select 1 from jsonb_object_keys(p_payload) key
               where key <> all (array['title','body','topics','examFocus',
                                       'keyTakeaways','formulaSheet','outcomes','assessment'])) then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
  elsif p_kind = 'note' then
    if not private.valid_managed_text(p_payload, 'title', 240) or
       not private.valid_managed_text(p_payload, 'body', 200000) or
       (p_payload ? 'noteType' and p_payload->>'noteType' not in
         ('topic_note','calculator_trick','guide_topic')) or
       exists (select 1 from jsonb_object_keys(p_payload) key
               where key <> all (array['title','body','noteType','keyPoints',
                                       'examTip','example','formula','number','mustKnow','introMore','lessons',
                                       'recap','theory','practice'])) or
       (p_payload->>'noteType' is distinct from 'guide_topic' and p_payload ?| array['number','mustKnow','introMore',
         'lessons','recap','theory','practice']) then
      raise exception using errcode = '22023', message = 'Invalid managed content';
    end if;
    if p_payload->>'noteType' = 'guide_topic' then
      if not private.valid_guide_topic(p_payload) then
        raise exception using errcode = '22023', message = 'Invalid managed content';
      end if;
    elsif p_payload->>'noteType' = 'topic_note' then
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


revoke all on function private.valid_guide_inline(jsonb, boolean), private.valid_guide_blocks(jsonb, integer, boolean),
  private.valid_guide_topic(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- Note order.
-- ---------------------------------------------------------------------------------------------------------------

alter table public.managed_content_items add column position integer check (position between 1 and 10000);
comment on column public.managed_content_items.position is
  'Display order within a course and kind, set by an import (guide topics) or the seed order. Items without one follow, oldest first.';

-- The published read, as 20261103140000_campus_bot_review_fixes.sql wrote it, ordered by position first.
create or replace function public.read_published_managed_content(p_course_id uuid)
returns table (
  item_id uuid, course_id uuid, kind text, question_id uuid, source_key text,
  parent_item_id uuid, revision integer, payload jsonb, feedback_available boolean
)
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  v_user := auth.uid();
  perform private.open_course_access_read(v_user);
  v_user := private.require_course_access_account();
  if p_course_id is null then
    raise exception using errcode = '22023', message = 'Course identity required';
  end if;
  if not private.can_read_course_content(v_user, p_course_id) then
    raise exception using errcode = 'CI403', message = 'Course access requires an active plan';
  end if;
  return query
    select i.id, i.course_id, i.kind, i.question_id, i.source_key,
           i.parent_item_id, i.published_revision, r.payload,
           i.kind = 'theory_question' and exists (
             select 1 from public.managed_content_items answer where answer.parent_item_id = i.id
               and answer.kind = 'model_answer' and answer.published_revision is not null
               and answer.published_parent_revision = i.published_revision)
    from public.managed_content_items i
    join public.managed_content_revisions r
      on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = p_course_id and i.published_revision is not null
      -- CBT questions reach a student only inside their own practice attempt.
      and i.kind <> 'cbt_question'
      and (i.kind not in ('model_answer', 'rubric') or exists (
        select 1 from public.profiles p where p.id = v_user and p.role = 'operator'))
      and (i.parent_item_id is null or exists (
        select 1 from public.managed_content_items parent
        where parent.id = i.parent_item_id
          and parent.published_revision = i.published_parent_revision
      ))
    -- Notes keep the order their import or the seed gives them; anything without one follows, oldest first.
    order by i.position nulls last, i.created_at, i.id;
end;
$$;


-- Topic titles for a free-pass preview, in the same order as the notes.
create or replace function private.discovery_topic_titles(p_course_id uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('item_id', i.id, 'title', r.payload ->> 'title')
      order by i.position nulls last, i.created_at, i.id), '[]'::jsonb)
  from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  where i.course_id = p_course_id and i.kind = 'note' and i.published_revision is not null;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- Guide imports.
-- ---------------------------------------------------------------------------------------------------------------

-- Each guide's import document, held as text in short chunks (the migration runner is slow on long statements) and
-- checked whole against its SHA-256 before it is read. Only migrations read these tables.
create table private.study_guides (
  guide text primary key check (guide ~ '^study_guide_[a-z0-9_]+$'),
  chunks integer not null check (chunks between 1 and 100000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$')
);
create table private.study_guide_chunks (
  guide text not null references private.study_guides (guide) on update restrict on delete restrict,
  ordinal integer not null check (ordinal > 0),
  chunk text not null check (length(chunk) between 1 and 8000),
  primary key (guide, ordinal)
);
alter table private.study_guides enable row level security;
alter table private.study_guide_chunks enable row level security;
revoke all on table private.study_guides, private.study_guide_chunks from public, anon, authenticated, service_role;

-- The import document, refused before anything is read or written if a chunk is missing, extra or changed.
create function private.study_guide_source(p_guide text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_head private.study_guides;
  v_count integer;
  v_text text;
begin
  select * into v_head from private.study_guides where guide = p_guide;
  select count(*), string_agg(chunk, '' order by ordinal) into v_count, v_text
    from private.study_guide_chunks where guide = p_guide;
  if v_head.guide is null or v_text is null or v_count <> v_head.chunks or
     (select max(ordinal) from private.study_guide_chunks where guide = p_guide) <> v_count or
     encode(sha256(convert_to(v_text, 'UTF8')), 'hex') <> v_head.sha256 or
     (v_text::jsonb)->>'guide' is distinct from p_guide then
    raise exception 'Study guide %: its source rows are missing or changed', p_guide;
  end if;
  return v_text::jsonb;
end;
$$;

-- This guide's own items (notes, theory questions, model answers), each with its kind, source key and payload.
create function private.study_guide_items(p_doc jsonb) returns setof jsonb
language sql immutable set search_path = '' as $$
  select value from jsonb_array_elements(p_doc->'notes')
  union all select value from jsonb_array_elements(p_doc->'theory')
  union all select value->'answer' from jsonb_array_elements(p_doc->'theory')
$$;

-- Where a course stands: 'before' (it publishes exactly the study items the import was written against, the overview
-- text it replaces, and none of this guide's items), 'after' (it publishes this guide's items unchanged, the guide's
-- overview, and nothing it retired) or 'other'. An unpublished edit by anyone else is 'other'.
create function private.study_guide_state(p_doc jsonb) returns text
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_course uuid := (p_doc->>'courseId')::uuid;
  v_actor uuid := (p_doc->>'actor')::uuid;
  v_ours uuid[];
  v_others jsonb;
  v_retire jsonb;
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
    from jsonb_array_elements(p_doc->'retire');
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
  if jsonb_typeof(p_doc->'overview') = 'object' then
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
  if v_overview in ('none', 'before') and v_none_published and v_others = v_retire then
    return 'before';
  end if;
  if v_overview in ('none', 'after') and v_all_published and v_others = '{}'::jsonb then
    return 'after';
  end if;
  return 'other';
end;
$$;

-- Publish one of the guide's items at revision one: create it the first time, republish it after a rollback.
create function private.study_guide_publish(p_row jsonb, p_course uuid, p_actor uuid, p_parent uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_item public.managed_content_items;
  v_parent_revision integer := case when p_parent is null then null else 1 end;
begin
  select * into v_item from public.managed_content_items where id = (p_row->>'itemId')::uuid;
  if v_item.id is not null then
    insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision,
        previous_revision, acted_by)
      values (v_item.id, v_item.lock_version + 1, 'publish', 1, v_parent_revision, v_item.published_revision, p_actor);
    update public.managed_content_items set published_revision = 1, published_parent_revision = v_parent_revision,
      position = (p_row->>'position')::integer, lock_version = lock_version + 1, updated_at = now()
      where id = v_item.id;
    return;
  end if;
  perform private.assert_managed_payload(p_row->>'kind', p_row->'payload');
  insert into public.managed_content_items (id, course_id, kind, question_id, source_key, parent_item_id,
      current_revision, approved_revision, published_revision, published_parent_revision, lock_version, created_by, position)
    values ((p_row->>'itemId')::uuid, p_course, p_row->>'kind', null, p_row->>'sourceKey', p_parent,
      1, 1, 1, v_parent_revision, 3, p_actor, (p_row->>'position')::integer);
  insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
    values ((p_row->>'itemId')::uuid, 1, p_row->'payload', p_actor);
  insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
    values ((p_row->>'itemId')::uuid, 1, v_parent_revision, 'approved', p_actor, 2);
  insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision, acted_by)
    values ((p_row->>'itemId')::uuid, 3, 'publish', 1, v_parent_revision, p_actor);
end;
$$;

-- Unpublish one item through the publication history; nothing is deleted.
create function private.study_guide_unpublish(p_item uuid, p_actor uuid) returns void
language plpgsql security invoker set search_path = '' as $$
declare
  v_item public.managed_content_items;
begin
  select * into v_item from public.managed_content_items where id = p_item;
  insert into public.managed_content_publications (item_id, lock_version, action, previous_revision,
      previous_parent_revision, acted_by)
    values (v_item.id, v_item.lock_version + 1, 'unpublish', v_item.published_revision, v_item.published_parent_revision,
      p_actor);
  update public.managed_content_items set published_revision = null, published_parent_revision = null,
    lock_version = lock_version + 1, updated_at = now() where id = v_item.id;
end;
$$;

-- Apply or roll back one guide, in one statement: everything or nothing.
create function private.study_guide(p_guide text, p_action text) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_doc jsonb := private.study_guide_source(p_guide);
  v_course uuid := (v_doc->>'courseId')::uuid;
  v_actor uuid := (v_doc->>'actor')::uuid;
  v_from text;
  v_to text;
  v_state text;
  v_row jsonb;
  v_item public.managed_content_items;
  v_revision integer;
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
    -- Retired items are unpublished, never deleted; the list puts answers before their questions.
    for v_row in select value from jsonb_array_elements(v_doc->'retire') loop
      perform private.study_guide_unpublish((v_row->>'itemId')::uuid, v_actor);
    end loop;
    if jsonb_typeof(v_doc->'overview') = 'object' then
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
    for v_row in select value from jsonb_array_elements(v_doc->'retire') with ordinality r(value, n) order by n desc loop
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
    if jsonb_typeof(v_doc->'overview') = 'object' then
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

revoke all on function private.study_guide_source(text), private.study_guide_items(jsonb), private.study_guide_state(jsonb),
  private.study_guide_publish(jsonb, uuid, uuid, uuid), private.study_guide_unpublish(uuid, uuid),
  private.study_guide(text, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- The overview correction (20261110090000) and a rolled-back guide. Rolling back a guide republishes the overview
-- revision it replaced and leaves the guide's revision in the history as the current one, as every rollback here does.
-- That revision is not an operator's draft, so the correction still sees the overview it wrote, and can apply again
-- after its own rollback; any other unpublished revision stays 'other' and is still refused. Otherwise as
-- 20261110090000 wrote them.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function private.course_overview_revision_state(p_item uuid, p_before jsonb, p_after jsonb, p_actor uuid,
  p_seed_actor uuid)
returns text language sql stable security invoker set search_path = '' as $state$
  select case
    when i.id is null or i.kind <> 'course_overview' or i.created_by is distinct from p_seed_actor then 'other'
    when i.current_revision <> i.published_revision and not exists (select 1 from public.managed_content_revisions c
      where c.item_id = i.id and c.revision = i.current_revision and c.authored_by = p_actor and c.payload = p_after)
      and not (i.approved_revision = i.published_revision and exists (select 1 from public.managed_content_revisions c
        where c.item_id = i.id and c.revision = i.current_revision
          and c.authored_by = '00000000-0000-4000-8000-000000000045'))
      then 'other'
    when p.payload = p_before then 'before'
    when p.payload = p_after and p.authored_by = p_actor
      and (i.current_revision = i.published_revision or i.approved_revision = i.published_revision and exists (
        select 1 from public.managed_content_revisions c where c.item_id = i.id and c.revision = i.current_revision
          and c.authored_by = '00000000-0000-4000-8000-000000000045')) then 'after'
    else 'other' end
  from (select p_item id) wanted
  left join public.managed_content_items i on i.id = wanted.id
  left join public.managed_content_revisions p on p.item_id = i.id and p.revision = i.published_revision
$state$;

revoke all on function private.course_overview_revision_state(uuid, jsonb, jsonb, uuid, uuid)
  from public, anon, authenticated, service_role;

-- The correction's apply refuses while another revision is pending. Its definition carries the correction's text, so
-- only that one check is changed here, and the change must match exactly once.
do $patch$
declare
  v_def text := pg_get_functiondef('private.course_overview_revisions(text)'::regprocedure);
  v_old text := 'if v_item.current_revision <> v_revision then';
  v_new text := 'if v_item.current_revision <> v_revision and not (v_item.current_revision > v_revision'
    || ' and v_item.approved_revision = v_item.published_revision and exists (select 1'
    || ' from public.managed_content_revisions g where g.item_id = v_item.id and g.revision = v_item.current_revision'
    || ' and g.authored_by = ''00000000-0000-4000-8000-000000000045'')) then';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'Course overviews: the pending-revision check is not the one 20261110090000 wrote';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

revoke all on function private.course_overview_revisions(text) from public, anon, authenticated, service_role;
