-- supabase/migrations/20261112110000_study_guide_notes.sql
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
-- lists added. Every other family and note type is checked exactly as before, the older note types refuse the
-- guide fields, and a guide topic refuses theirs.
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
      -- A guide topic carries none of the older note types' fields, as the site's own check requires.
      if not private.valid_guide_topic(p_payload) or
         p_payload ?| array['keyPoints','examTip','example','formula'] then
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
-- That revision is not an operator's draft. The correction's two functions are recreated in full below, generated from
-- the same source as 20261110090000, so that such a revision is not taken for someone else's edit: the correction still
-- sees the overview it wrote and can apply again after its own rollback. Any other pending revision is still refused.
-- ---------------------------------------------------------------------------------------------------------------
-- BEGIN GENERATED by scripts/managed-content/generate.cjs from scripts/managed-content/overview-revisions.cjs.
-- Where one overview stands: 'before' (publishes the text this correction replaces), 'after' (publishes this
-- correction's revision) or 'other'. An unpublished edit by anyone else is 'other'.
create or replace function private.course_overview_revision_state(p_item uuid, p_before jsonb, p_after jsonb, p_actor uuid,
  p_seed_actor uuid)
returns text language sql stable security invoker set search_path = '' as $state$
  select case
    when i.id is null or i.kind <> 'course_overview' or i.created_by is distinct from p_seed_actor then 'other'
    when i.current_revision <> i.published_revision and not exists (select 1 from public.managed_content_revisions c
      where c.item_id = i.id and c.revision = i.current_revision and c.authored_by = p_actor and c.payload = p_after)
      and not (i.approved_revision = i.published_revision and exists (select 1
          from public.managed_content_revisions g where g.item_id = i.id and g.revision = i.current_revision
          and g.authored_by = '00000000-0000-4000-8000-000000000045'))
      then 'other'
    when p.payload = p_before then 'before'
    when p.payload = p_after and p.authored_by = p_actor and (i.current_revision = i.published_revision
      or (i.approved_revision = i.published_revision and exists (select 1
          from public.managed_content_revisions g where g.item_id = i.id and g.revision = i.current_revision
          and g.authored_by = '00000000-0000-4000-8000-000000000045'))) then 'after'
    else 'other' end
  from (select p_item id) wanted
  left join public.managed_content_items i on i.id = wanted.id
  left join public.managed_content_revisions p on p.item_id = i.id and p.revision = i.published_revision
$state$;

create or replace function private.course_overview_revisions(p_action text)
returns text language plpgsql security invoker set search_path = '' as $overview_revisions$
declare
  v_data jsonb := $overview_source${"actor":"00000000-0000-4000-8000-000000000044","seedActor":"00000000-0000-4000-8000-000000000042","items":[{"slug":"leadership-governance","itemId":"22b198d9-ebcc-5801-8874-d9dd325124e5","before":{"title":"Leadership and Governance","body":"Leadership theories and styles, organisational ethics, governance frameworks, and stakeholder management across the public and private sectors.","topics":[{"chapter":"1-3","description":"Leadership Theories and Models"},{"chapter":"4-5","description":"Leadership Styles and Effectiveness"},{"chapter":"6-7","description":"Ethics and Governance Frameworks"},{"chapter":"8-9","description":"Stakeholder Management and Engagement"},{"chapter":"10","description":"Public Sector Reform and Innovation"}],"examFocus":["Leadership theory definitions and applications","Leadership styles and situational leadership","Ethical leadership principles","Governance structures and responsibilities","Stakeholder analysis and management","Essays on organizational leadership"]},"after":{"title":"Leadership and Governance","body":"Leadership theories and styles, organisational ethics, governance frameworks, and stakeholder management across the public and private sectors.","examFocus":["Leadership theory definitions and applications","Leadership styles and situational leadership","Ethical leadership principles","Governance structures and responsibilities","Stakeholder analysis and management","Essays on organizational leadership"]}},{"slug":"business-mathematics","itemId":"2cbcad08-271c-5705-9194-0da63d3d965c","before":{"title":"Business Mathematics","body":"Mathematical foundations for business including algebra, functions, optimization, demand-supply analysis, and financial calculations essential for business decision-making.","topics":[{"chapter":"1-2","description":"Algebra Fundamentals and Functions"},{"chapter":"3-4","description":"Linear Functions and Equations"},{"chapter":"5-6","description":"Demand, Supply and Market Equilibrium Mathematics"},{"chapter":"7-8","description":"Cost and Revenue Functions"},{"chapter":"9-10","description":"Calculus: Differentiation and Optimization"}],"examFocus":["Algebraic problem solving","Function notation and evaluation","Demand and supply curve calculations","Cost and revenue function optimization","Differentiation for optimization","Complex problem-solving with multiple steps"]},"after":{"title":"Business Mathematics","body":"Mathematical foundations for business including algebra, functions, optimization, demand-supply analysis, and financial calculations essential for business decision-making.","topics":[{"chapter":"1-2","description":"Algebra Fundamentals and Functions"},{"chapter":"3-4","description":"Linear Functions and Equations"},{"chapter":"5-6","description":"Demand, Supply and Market Equilibrium Mathematics"},{"chapter":"7-8","description":"Cost and Revenue Functions"},{"chapter":"9-10","description":"Calculus: Differentiation and Optimization"}],"examFocus":["Algebraic problem solving","Function notation and evaluation","Demand and supply curve calculations","Cost and revenue function optimization","Differentiation for optimization"]}},{"slug":"principles-business-administration","itemId":"393817a6-f4f6-5563-9b22-4614aa481ad9","before":{"title":"Principles of Business Administration I","body":"Foundation course covering business functions, marketing fundamentals, organizational structure, management concepts, business environment analysis, and contemporary issues in Nigerian business administration.","topics":[{"chapter":"1-2","description":"Business Functions and Organizational Structure"},{"chapter":"3-4","description":"Marketing Fundamentals and Segmentation"},{"chapter":"5-6","description":"Management Concepts and Principles"},{"chapter":"7-8","description":"Business Environment and Strategy"},{"chapter":"9-10","description":"Contemporary Issues and Change Management in Nigeria"},{"chapter":"11-12","description":"Business Ownership, Ethics, and Corporate Governance"}],"examFocus":["Definition of business functions","Organizational structure types and benefits","Market segmentation strategies","Management theories and applications","PESTLE analysis and business environment","Contemporary challenges in Nigerian business","Business ownership types and liability","Corporate governance principles (NCCG 2018)","Leadership theories and styles","Theory explanations and definitions"],"keyTakeaways":[{"title":"The True Purpose of Business Goes Beyond Profit","description":"While classical thinkers like Adam Smith viewed businesses narrowly as profit-maximizing machines, the modern view sees businesses as social institutions responsible for value creation, employment generation, and wealth distribution for all stakeholders."},{"title":"Management is Universal and Interconnected","description":"Wherever there are people and goals, management is required. The four core functions—Planning, Organising, Leading, and Controlling—are deeply interrelated. You cannot control what you have not planned. Success is measured by Effectiveness (doing the right things) and Efficiency (using the least resources)."},{"title":"Constantly Scan the Dynamic Business Environment","description":"No business operates in a vacuum. Always apply the PESTLE framework (Political, Economic, Sociocultural, Technological, Legal, Environmental) to analyze forces shaping your industry and adapt to opportunities and threats."},{"title":"The Reality of the Nigerian Business Context","description":"As managers in Nigeria, you will face infrastructure deficits, economic volatility (inflation, FX constraints), and security threats. You must act as an \"Organizational Stabiliser\" and Change Agent while managing cultural rigidity, employee burnout, and the skills gap."},{"title":"Organizations are Open Systems Requiring Integration","description":"Systems Theory views businesses as open systems that receive inputs, transform them, and produce outputs. Cross-functional integration is critical—Marketing, Operations, HR, and Finance must work together, not in silos."},{"title":"Understand Business Ownership and Liability","description":"A Sole Proprietorship carries unlimited personal liability—your personal assets can be seized to pay business debts. Incorporating as a company (like a PLC) creates a separate legal entity and provides limited liability protection."},{"title":"Ethics, Governance, and Responsible Leadership","description":"Management is a recognized profession requiring adherence to ethical codes like NIM. Uphold the NCCG 2018 principles: Responsibility, Accountability, Transparency, and Fairness. Strive to be a Transformational or Servant Leader who guides with honesty and empathy."}]},"after":{"title":"Principles of Business Administration I","body":"Foundation course covering business functions, marketing fundamentals, organizational structure, management concepts, business environment analysis, and contemporary issues in Nigerian business administration.","topics":[{"chapter":"1-2","description":"Business Functions and Organizational Structure"},{"chapter":"3-4","description":"Marketing Fundamentals and Segmentation"},{"chapter":"5-6","description":"Management Concepts and Principles"},{"chapter":"7-8","description":"Business Environment and Strategy"},{"chapter":"9-10","description":"Contemporary Issues and Change Management in Nigeria"},{"chapter":"11-12","description":"Business Ownership, Ethics, and Corporate Governance"}],"examFocus":["Definition of business functions","Organizational structure types and benefits","Market segmentation strategies","Management theories and applications","PESTLE analysis and business environment","Contemporary challenges in Nigerian business","Business ownership types and liability","Corporate governance principles (NCCG 2018)","Leadership theories and styles","Theory explanations and definitions"],"keyTakeaways":[{"title":"The True Purpose of Business Goes Beyond Profit","description":"While classical thinkers like Adam Smith viewed businesses narrowly as profit-maximizing machines, the modern view sees businesses as social institutions responsible for value creation, employment generation, and wealth distribution for all stakeholders."},{"title":"Management is Universal and Interconnected","description":"Wherever there are people and goals, management is required. The four core functions—Planning, Organising, Leading, and Controlling—are deeply interrelated. You cannot control what you have not planned. Success is measured by Effectiveness (doing the right things) and Efficiency (using the least resources)."},{"title":"Constantly Scan the Dynamic Business Environment","description":"No business operates in a vacuum. Always apply the PESTLE framework (Political, Economic, Sociocultural, Technological, Legal, Environmental) to analyze forces shaping your industry and adapt to opportunities and threats."},{"title":"The Reality of the Nigerian Business Context","description":"As managers in Nigeria, you will face infrastructure deficits, economic volatility (inflation, FX constraints), and security threats. You must act as an \"Organizational Stabiliser\" and Change Agent while managing cultural rigidity, employee burnout, and the skills gap."},{"title":"Organizations are Open Systems Requiring Integration","description":"Systems Theory views businesses as open systems that receive inputs, transform them, and produce outputs. Cross-functional integration is critical—Marketing, Operations, HR, and Finance must work together, not in silos."},{"title":"Understand Business Ownership and Liability","description":"A Sole Proprietorship carries unlimited personal liability—your personal assets can be seized to pay business debts. Incorporating as a company (like a PLC) creates a separate legal entity and provides limited liability protection."},{"title":"Ethics, Governance, and Responsible Leadership","description":"Management is a recognized profession requiring adherence to ethical codes like NIM's. Uphold the NCCG 2018 principles: Responsibility, Accountability, Transparency, and Fairness. Strive to be a Transformational or Servant Leader who guides with honesty and empathy."}]}},{"slug":"philosophy-logic-human-existence","itemId":"42bd1029-7f56-5b8d-824a-92f2405670f1","before":{"title":"Philosophy, Logic and Human Existence","body":"A foundational course examining what philosophy is and why it matters, moving from its nature and scope through the classical branches — metaphysics, epistemology, ethics and aesthetics, logic and argument, and the philosophy of other disciplines — before turning outward to socio-political philosophy, African philosophy, the philosophy and history of science, and philosophy's broader relevance to technology and society. None — compulsory General Studies course.","topics":[{"chapter":"1","description":"Conception, Nature, Scope and Problems of Philosophy"},{"chapter":"2","description":"A Survey of the History of Philosophy"},{"chapter":"3","description":"Metaphysics as a Branch of Philosophy"},{"chapter":"4","description":"Epistemology as a Branch of Philosophy"},{"chapter":"5","description":"Ethics and Aesthetics"},{"chapter":"6","description":"Logic and Its Importance"},{"chapter":"7","description":"Inference and Argument Types in Logic"},{"chapter":"8","description":"Laws of Thought, Elementary Formal Rules of Reasoning and Fallacies"},{"chapter":"9","description":"The Philosophy of Other Disciplines"},{"chapter":"10","description":"Socio-Political Philosophy"},{"chapter":"11","description":"African Philosophy"},{"chapter":"12","description":"The Concept and Nature of Philosophy of Science"},{"chapter":"13","description":"The History and Method of Science"},{"chapter":"14","description":"Philosophy, Science and Technology"},{"chapter":"15","description":"Philosophy and Its Relevance to Society"}],"examFocus":["The distinction between the narrow (technical) and broad (worldview) senses of philosophy","Why 'What is philosophy?' is treated as philosophy's own most fundamental problem","The shift from Pre-Socratic cosmology (Thales, Anaximander, Heraclitus, Parmenides) to Socrates' turn toward ethics","Why metaphysics lost independent status to the positive sciences, and how it remains their 'ground'","The rationalist vs empiricist divide, and Plato's account of knowledge as acquaintance with Forms","The three subdivisions of ethics (descriptive, meta-ethics, normative) and teleological vs deontological theories","Why logic is not the same discipline as the psychology of reasoning","The distinction between deductive validity and inductive strength/correctness","The three Laws of Thought (Identity, Contradiction, Excluded Middle) and their symbolic forms","How philosophy functions as the 'infrastructure' underlying law, history, religion, and science","Why prescribing the organisation of the ideal state is socio-political philosophy's central task","The narrow and broad senses of philosophy in African philosophy, and its four core content areas","Why philosophy should not become subservient ('handmaiden') to science, and what 'Philosophical Science' means","The trajectory of Greek scientific thought from Thales through Plato and Aristotle","Why philosophy's relevance to society lies in providing an organised, coherent view of a disjointed world"]},"after":{"title":"Philosophy, Logic and Human Existence","body":"A foundational course examining what philosophy is and why it matters, moving from its nature and scope through the classical branches — metaphysics, epistemology, ethics and aesthetics, logic and argument, and the philosophy of other disciplines — before turning outward to socio-political philosophy, African philosophy, the philosophy and history of science, and philosophy's broader relevance to technology and society.","topics":[{"chapter":"1","description":"Conception, Nature, Scope and Problems of Philosophy"},{"chapter":"2","description":"A Survey of the History of Philosophy"},{"chapter":"3","description":"Metaphysics as a Branch of Philosophy"},{"chapter":"4","description":"Epistemology as a Branch of Philosophy"},{"chapter":"5","description":"Ethics and Aesthetics"},{"chapter":"6","description":"Logic and Its Importance"},{"chapter":"7","description":"Inference and Argument Types in Logic"},{"chapter":"8","description":"Laws of Thought, Elementary Formal Rules of Reasoning and Fallacies"},{"chapter":"9","description":"The Philosophy of Other Disciplines"},{"chapter":"10","description":"Socio-Political Philosophy"},{"chapter":"11","description":"African Philosophy"},{"chapter":"12","description":"The Concept and Nature of Philosophy of Science"},{"chapter":"13","description":"The History and Method of Science"},{"chapter":"14","description":"Philosophy, Science and Technology"},{"chapter":"15","description":"Philosophy and Its Relevance to Society"}],"examFocus":["The distinction between the narrow (technical) and broad (worldview) senses of philosophy","Why 'What is philosophy?' is treated as philosophy's own most fundamental problem","The shift from Pre-Socratic cosmology (Thales, Anaximander, Heraclitus, Parmenides) to Socrates' turn toward ethics","Why metaphysics lost independent status to the positive sciences, and how it remains their 'ground'","The rationalist vs empiricist divide, and Plato's account of knowledge as acquaintance with Forms","The three subdivisions of ethics (descriptive, meta-ethics, normative) and teleological vs deontological theories","Why logic is not the same discipline as the psychology of reasoning","The distinction between deductive validity and inductive strength/correctness","The three Laws of Thought (Identity, Contradiction, Excluded Middle) and their symbolic forms","How philosophy functions as the 'infrastructure' underlying law, history, religion, and science","Why prescribing the organisation of the ideal state is socio-political philosophy's central task","The narrow and broad senses of philosophy in African philosophy, and its four core content areas","Why philosophy should not become subservient ('handmaiden') to science, and what 'Philosophical Science' means","The trajectory of Greek scientific thought from Thales through Plato and Aristotle","Why philosophy's relevance to society lies in providing an organised, coherent view of a disjointed world"]}},{"slug":"principles-business-administration-2","itemId":"577bde2b-9ef5-521c-b103-b65737b7b097","before":{"title":"Principles of Business Administration II","body":"BUA 202 is where Business Admin students stop looking at the org chart and start looking at the people and money that actually make it move. Half the course is about people — how to hire them, motivate them, manage change, and get groups working as teams — and half is about how a Nigerian business gets and manages its cash, from the CBN down to shares on the NGX. It's practical, Nigeria-focused, and heavy on named theories and models (Maslow, Herzberg, Lewin, Kotter) that lecturers love to test directly. Ethics closes the course out, tying people and money decisions back to responsible conduct. Builds on BUA 201.","topics":[{"chapter":"1","description":"Human Resource Management: Nature, Scope, and Importance"},{"chapter":"2","description":"Human Resource Planning, Recruitment, Selection, and Employee Development"},{"chapter":"3","description":"Employee Motivation, Leadership, and Performance Management"},{"chapter":"4","description":"Organisational Change and Change Management"},{"chapter":"5","description":"Managerial Decision-Making and Problem Solving"},{"chapter":"6","description":"Organisational Behaviour, Communication, and Team Dynamics"},{"chapter":"7","description":"Organisational Culture, Power, Politics, and Workplace Dynamics"},{"chapter":"8","description":"Business Communication, Information Systems, and Digital Management"},{"chapter":"9","description":"Business Ethics, Corporate Responsibility, and Ethical Decision-Making"},{"chapter":"10","description":"Nigeria's Banking, Financial System, and Securities Market"}],"examFocus":["Difference between Personnel Management and HRM","Objectives and functions of HRM","Maslow's Hierarchy of Needs (five levels, ordering, examples)","Herzberg's Two-Factor Theory — Hygiene (context) vs Motivator (content) factors","Lewin's Change Model and Kotter's Eight-Step Model","Drivers of and resistance to organisational change","Fields' (2000) three levels of organisational change (implemental, strategic, org-wide)","Types of managerial decisions: strategic, tactical, operational","Rationality and bounded rationality in decision-making","Nature and scope of organisational behaviour (individual, group, organisational levels)","Stages of group development (forming, storming, norming, performing, adjourning)","Formal vs informal groups; command group vs task group","Barriers to effective communication; formal vs informal channels","Structure of the Nigerian financial system (CBN, NDIC, SEC, NAICOM, PenCom)","Financial intermediation and its key functions","Expansionary vs contractionary monetary policy and business impact","Shares, bonds, debentures, and mutual funds — definitions and risk/reward","Sources of business finance: equity finance vs debt finance vs venture capital","NGX Group structure and capital market intermediaries (SEC, CSCS, NGX RegCo)","Ethical theories, CSR, and workplace ethical issues"]},"after":{"title":"Principles of Business Administration II","body":"Covers how businesses manage people, change, decisions, communication and ethics, and how the Nigerian financial system and securities market fund them.","topics":[{"chapter":"1","description":"Human Resource Management: Nature, Scope, and Importance"},{"chapter":"2","description":"Human Resource Planning, Recruitment, Selection, and Employee Development"},{"chapter":"3","description":"Employee Motivation, Leadership, and Performance Management"},{"chapter":"4","description":"Organisational Change and Change Management"},{"chapter":"5","description":"Managerial Decision-Making and Problem Solving"},{"chapter":"6","description":"Organisational Behaviour, Communication, and Team Dynamics"},{"chapter":"7","description":"Organisational Culture, Power, Politics, and Workplace Dynamics"},{"chapter":"8","description":"Business Communication, Information Systems, and Digital Management"},{"chapter":"9","description":"Business Ethics, Corporate Responsibility, and Ethical Decision-Making"},{"chapter":"10","description":"Nigeria's Banking, Financial System, and Securities Market"}],"examFocus":["Difference between Personnel Management and HRM","Objectives and functions of HRM","Maslow's Hierarchy of Needs (five levels, ordering, examples)","Herzberg's Two-Factor Theory — Hygiene (context) vs Motivator (content) factors","Lewin's Change Model and Kotter's Eight-Step Model","Drivers of and resistance to organisational change","Fields' (2000) three levels of organisational change (implemental, strategic, org-wide)","Types of managerial decisions: strategic, tactical, operational","Rationality and bounded rationality in decision-making","Nature and scope of organisational behaviour (individual, group, organisational levels)","Stages of group development (forming, storming, norming, performing, adjourning)","Formal vs informal groups; command group vs task group","Barriers to effective communication; formal vs informal channels","Structure of the Nigerian financial system (CBN, NDIC, SEC, NAICOM, PenCom)","Financial intermediation and its key functions","Expansionary vs contractionary monetary policy and business impact","Shares, bonds, debentures, and mutual funds — definitions and risk/reward","Sources of business finance: equity finance vs debt finance vs venture capital","NGX Group structure and capital market intermediaries (SEC, CSCS, NGX RegCo)","Ethical theories, CSR, and workplace ethical issues"]}},{"slug":"business-statistics","itemId":"58dca9fe-1102-567a-bae2-6dec6a9b89a2","before":{"title":"Business Statistics","body":"Data collection, analysis, and interpretation techniques including graphs, tables, statistical measures, probability distributions, and their application in business decision-making.","topics":[{"chapter":"1-2","description":"Data Collection Methods and Types"},{"chapter":"3-4","description":"Graphs, Tables, and Data Visualization"},{"chapter":"5-6","description":"Central Tendency: Mean, Median, Mode"},{"chapter":"7-8","description":"Dispersion: Variance and Standard Deviation"},{"chapter":"9-10","description":"Probability and Distributions"}],"examFocus":["Data collection and sampling techniques","Calculation of mean, median, mode","Standard deviation and variance calculations","Probability distributions","Problem-solving with formulas","Interpretation of statistical results"]},"after":{"title":"Business Statistics","body":"Data collection, analysis, and interpretation techniques including graphs, tables, statistical measures, probability distributions, and their application in business decision-making.","topics":[{"chapter":"1-2","description":"Data Collection Methods and Types"},{"chapter":"3-4","description":"Graphs, Tables, and Data Visualization"},{"chapter":"5-6","description":"Central Tendency: Mean, Median, Mode"},{"chapter":"7-8","description":"Dispersion: Variance and Standard Deviation"},{"chapter":"9-10","description":"Probability and Distributions"}],"examFocus":["Data collection and sampling techniques","Calculation of mean, median, mode","Standard deviation and variance calculations","Probability distributions"]}},{"slug":"consumer-behaviour","itemId":"5aad5fe7-ca39-5228-9fd8-a71a4aa69e1c","before":{"title":"Consumer Behaviour","body":"Study of consumer decision processes, buyer types, and the psychological, cultural, and social factors influencing consumer choices and market behaviour.","topics":[{"chapter":"1-2","description":"Consumer Decision-Making Process"},{"chapter":"3-4","description":"Types of Consumers and Buyer Behavior"},{"chapter":"5-6","description":"Cultural and Social Influences on Consumer Behavior"},{"chapter":"7-8","description":"Personality, Attitudes, and Perception"},{"chapter":"9-10","description":"Communication, Persuasion and Marketing Appeals"}],"examFocus":["Consumer decision-making models","Psychological factors affecting consumer choice","Cultural and social influences","Personality and attitude measurement","Communication theories in marketing","Theoretical explanations and applications"]},"after":{"title":"Consumer Behaviour","body":"Study of consumer decision processes, buyer types, and the psychological, cultural, and social factors influencing consumer choices and market behaviour.","topics":[{"chapter":"1-2","description":"Consumer Decision-Making Process"},{"chapter":"3-4","description":"Types of Consumers and Buyer Behaviour"},{"chapter":"5-6","description":"Cultural and Social Influences on Consumer Behaviour"},{"chapter":"7-8","description":"Personality, Attitudes, and Perception"},{"chapter":"9-10","description":"Communication, Persuasion and Marketing Appeals"}],"examFocus":["Consumer decision-making models","Psychological factors affecting consumer choice","Cultural and social influences","Personality and attitude measurement","Communication theories in marketing","Theoretical explanations and applications"]}},{"slug":"use-of-english","itemId":"684b4900-fe11-57fe-9c14-d7270a801804","before":{"title":"Communication in English","body":"Communication skills course covering listening, phonetics, syllable structure, stress patterns, reading strategies, comprehension, and summary writing. A 100-level General Studies course required of all UNILAG students; Direct Entry students take it in 200 Level.","topics":[{"chapter":"1","description":"Listening Skills"},{"chapter":"2","description":"The Sounds of English (Phonetics)"},{"chapter":"3","description":"Syllable, Stress and Intonation"},{"chapter":"4","description":"Strategies for Effective Reading"},{"chapter":"5","description":"Comprehension and Summary"}],"examFocus":["Listening skills and note-taking strategies","Phonetic symbols and organs of speech","Syllable structure and stress patterns","Reading types: skimming, scanning, study reading","Comprehension question types and summary writing"]},"after":{"title":"Communication in English","body":"Communication skills course covering listening, the sounds of English, stress and intonation, reading and comprehension, writing, grammar, vocabulary, and using the library and information sources."}},{"slug":"bua218","itemId":"7ecaf530-1c9c-58e0-b01f-cee369c4fc05","before":{"title":"Green Management","body":"A course on running organizations sustainably — how environmental principles, regulation, strategy, innovation, and marketing come together so that businesses can protect the planet while staying profitable and competitive.","topics":[{"chapter":"1","description":"Introduction to Green Management — definition, importance, key drivers, benefits to organizations and society"},{"chapter":"2","description":"Environmental Principles and Concepts — ecological and carbon footprint, the circular economy and waste management, environmental regulations and standards"},{"chapter":"3","description":"Strategic Green Management — integrating sustainability into business strategy, green innovation and eco-design"},{"chapter":"4","description":"Green Operations and Supply Chain Management — not yet covered"},{"chapter":"5","description":"Green Marketing and Corporate Social Responsibility — green marketing covered; Corporate Social Responsibility not yet covered"},{"chapter":"6","description":"Implementing Green Initiatives — not yet covered"},{"chapter":"7","description":"Future Trends, Challenges, and Successful Green Management — green digital transformation, emerging technologies, challenges and opportunities, characteristics and strategies of successful green management, Nigerian case examples"}],"examFocus":["The definition of green management and its framing as Profit + People + Planet (the Triple Bottom Line)","Why green management is treated as a strategic necessity rather than optional, and the reasoning behind that claim","The relationship between ecological footprint and carbon footprint — carbon as one component of ecological footprint","The waste management hierarchy, in strict order: Prevention, Re-use, Recycling, Recovery, Disposal","The difference between the circular economy and the traditional linear (take-make-dispose) model","How the circular economy and waste management relate to and reinforce each other","The distinction between environmental regulations (legally enforceable) and environmental standards (voluntary/mandatory guidelines), including the consequence of non-compliance for each","The steps for integrating sustainability into business strategy, in sequence","The relationship between green innovation and eco-design as complementary practices","The principles of eco-design and the stages of the eco-design life cycle, in order","Key digital technologies supporting green management (AI, IoT, big data, cloud, smart manufacturing) and what each contributes","The ‘5 Rs’ of the circular economy (reduce, reuse, repair, recycle, recover) replacing the take-make-dispose model","Definition and real-world meaning of carbon neutrality, including example offsetting activities","The ten challenges facing green management and how they map to opportunities","Characteristics and strategies of successful green management, including the Triple Bottom Line as a balancing framework","Internal vs external factors influencing green management success","Definition of greenwashing and how it differs from genuine green management","Nigerian company examples (Nigerian Breweries, Lafarge Africa, Dangote Cement, MTN, Access Bank) and the specific angle each is assessed from"]},"after":{"title":"Green Management","body":"A course on running organizations sustainably — how environmental principles, regulation, strategy, innovation, and marketing come together so that businesses can protect the planet while staying profitable and competitive.","topics":[{"chapter":"1","description":"Introduction to Green Management — definition, importance, key drivers, benefits to organizations and society"},{"chapter":"2","description":"Environmental Principles and Concepts — ecological and carbon footprint, the circular economy and waste management, environmental regulations and standards"},{"chapter":"3","description":"Strategic Green Management — integrating sustainability into business strategy, green innovation and eco-design"},{"chapter":"4","description":"Green Operations and Supply Chain Management"},{"chapter":"5","description":"Green Marketing and Corporate Social Responsibility"},{"chapter":"6","description":"Implementing Green Initiatives"},{"chapter":"7","description":"Future Trends, Challenges, and Successful Green Management — green digital transformation, emerging technologies, challenges and opportunities, characteristics and strategies of successful green management, Nigerian case examples"}],"examFocus":["The definition of green management and its framing as Profit + People + Planet (the Triple Bottom Line)","Why green management is treated as a strategic necessity rather than optional, and the reasoning behind that claim","The relationship between ecological footprint and carbon footprint — carbon as one component of ecological footprint","The waste management hierarchy, in strict order: Prevention, Re-use, Recycling, Recovery, Disposal","The difference between the circular economy and the traditional linear (take-make-dispose) model","How the circular economy and waste management relate to and reinforce each other","The distinction between environmental regulations (legally enforceable) and environmental standards (voluntary/mandatory guidelines), including the consequence of non-compliance for each","The steps for integrating sustainability into business strategy, in sequence","The relationship between green innovation and eco-design as complementary practices","The principles of eco-design and the stages of the eco-design life cycle, in order","Key digital technologies supporting green management (AI, IoT, big data, cloud, smart manufacturing) and what each contributes","The ‘5 Rs’ of the circular economy (reduce, reuse, repair, recycle, recover) replacing the take-make-dispose model","Definition and real-world meaning of carbon neutrality, including example offsetting activities","The ten challenges facing green management and how they map to opportunities","Characteristics and strategies of successful green management, including the Triple Bottom Line as a balancing framework","Internal vs external factors influencing green management success","Definition of greenwashing and how it differs from genuine green management","Nigerian company examples (Nigerian Breweries, Lafarge Africa, Dangote Cement, MTN, Access Bank) and the specific angle each is assessed from"]}},{"slug":"quantitative-analysis-management","itemId":"88bb9b97-531e-513d-971f-6277d4e6223e","before":{"title":"Quantitative Analysis in Management","body":"A foundational course examining how mathematical and statistical techniques support evidence-based managerial decision-making. The course moves from core quantitative concepts (break-even analysis, revenue/cost/profit formulas) through data collection, descriptive and inferential statistics, correlation and regression, linear programming, and decision theory under risk and uncertainty. Assumes Business Statistics.","topics":[{"chapter":"1","description":"Week 1: Introduction to Quantitative Analysis in Management — Definition, Features, Importance, Areas of Application, Analytical Tools"},{"chapter":"2","description":"Week 2: Basic Mathematical Concepts for Management — Core Concepts, Revenue/Cost/Profit Formulas, Break-Even Analysis"},{"chapter":"3","description":"Week 3: Data Collection, Organization, and Presentation — Primary vs Secondary Data, Quantitative vs Qualitative, Charts and Graphs"},{"chapter":"4","description":"Week 4: Statistical Analysis for Management — Foundations of Statistics, Descriptive Statistics, the Normal Distribution, Hypothesis Testing, Confidence Intervals, ANOVA"},{"chapter":"5","description":"Week 5: Operational Modelling — Linear Programming, the Graphical Solution Method, Applications"},{"chapter":"6","description":"Week 6: Decision Theory and Managerial Decision-Making — Decision Environments, Criteria Under Uncertainty, EMV, Decision Trees"},{"chapter":"7","description":"Week 7: Analysis and Interpretation of Results — Data Analysis vs Interpretation, Correlation Analysis, Regression Analysis, Common Pitfalls"},{"chapter":"8","description":"Week 8: Exam Hotspots & Complete Formula Quick-Reference — Revision, Priority Topics, Master Formula Sheet"}],"examFocus":["Know the definition of QAM, its six features, and its five areas of application; distinguish QAM from purely intuitive decision-making","Calculate TR, TC, Profit, BEQ, BER, and Target Profit Output; solve simultaneous equations for product-mix problems; apply FV = P(1+r)^n","Distinguish primary vs secondary data and quantitative vs qualitative characteristics; construct a frequency table and identify the correct chart type for a scenario","Know the three classical definitions of statistics (Bowley, King, Boddington) and the difference between descriptive and inferential statistics","Know when to use the Z-test vs t-test vs chi-square vs ANOVA; state H0 and H1 for any scenario; understand Type I and Type II errors; know the 68-95-99.7 rule","Formulate a linear programming problem and solve it graphically — identify the feasible region, evaluate all corner points, and state the optimal solution","Construct a payoff table, apply all five uncertainty criteria, calculate EMV, and solve a decision tree using the rollback method","Distinguish data analysis from data interpretation; interpret a regression equation (intercept, slope, R2) in plain business language","Know correlation vs causation and the other three common data-interpretation pitfalls (confirmation bias, small sample size, data quality issues)","Know the types of correlation (positive/negative, simple/multiple, partial/total, linear/non-linear) and when to use Pearson vs Spearman","Master the full Master Formula Sheet — revenue/cost/profit, descriptive statistics, probability and distributions, confidence intervals, correlation/regression, decision analysis, and LP formulas","Apply the study guide's “Common Exam Question Approaches” step-by-step methods for break-even, hypothesis testing, test selection, regression interpretation, payoff tables, LP formulation, mean/SD calculation, and simultaneous equations"],"formulaSheet":[{"name":"Break-Even Quantity (BEQ)","formula":"BEQ = FC / (P − v)","explanation":"The output level at which total revenue equals total cost — fixed cost divided by the contribution margin per unit.","example":"Selling Price = N5,000, Variable Cost = N3,000, Fixed Cost = N1,000,000; Contribution Margin = 5,000 − 3,000 = N2,000 per unit; BEQ = 1,000,000 / 2,000 = 500 units."},{"name":"Break-Even Revenue (BER)","formula":"BER = BEQ × P","explanation":"The sales revenue generated at the break-even point — break-even quantity multiplied by selling price."},{"name":"Total Revenue (TR)","formula":"TR = P × Q","explanation":"Total money earned from sales before deducting any cost — unit selling price times quantity sold.","example":"A company sells 2,500 units at N8,000 each: TR = 2,500 × N8,000 = N20,000,000."},{"name":"Total Cost (TC)","formula":"TC = FC + (v × Q)","explanation":"All costs combined — fixed cost plus the variable cost per unit times the number of units produced."},{"name":"Profit (π)","formula":"Profit = TR − TC = Q(P − v) − FC","explanation":"What remains after all costs: positive is a profit, negative is a loss — equivalently, contribution per unit times quantity, less fixed cost."},{"name":"Contribution Margin (CM)","formula":"CM = P − v","explanation":"The amount each unit sold contributes toward covering fixed costs (and then profit) — price minus variable cost per unit.","example":"Contribution Margin = 5,000 − 3,000 = N2,000 per unit."},{"name":"Average Cost (AC)","formula":"AC = TC / Q","explanation":"The cost per unit at a given output level — total cost divided by quantity."},{"name":"Marginal Cost (MC)","formula":"MC = change in TC / change in Q","explanation":"The cost of producing one additional unit — the change in total cost divided by the change in quantity."},{"name":"Target Profit Output","formula":"Target Profit Output = (FC + Target Profit) / (P − v)","explanation":"The number of units needed to reach a desired profit — fixed cost plus target profit, divided by contribution margin per unit.","example":"Target profit of N25,000 (FC = N45,000,000, P = N9,000, v = N6,000): Q = (45,000,000 + 25,000) / 3,000 = 15,009 units."},{"name":"Future Value (Compound Interest)","formula":"FV = P(1 + r)ⁿ","explanation":"The value of a present sum after n periods of compound growth at rate r per period.","example":"An investment of N1,000,000 growing at 10% annually for 3 years: FV = 1,000,000 × (1.10)³ = 1,000,000 × 1.331 = N1,331,000."},{"name":"Mean (x̄)","formula":"x̄ = Σ(x) / n","explanation":"The arithmetic average — the sum of all values divided by the number of values."},{"name":"Variance (s²)","formula":"s² = Σ(x − x̄)² / n","explanation":"The average of the squared deviations from the mean — a measure of how spread out the data is."},{"name":"Standard Deviation (s)","formula":"s = √[ Σ(x − x̄)² / n ]","explanation":"The square root of the variance — spread of the data in the same units as the data."},{"name":"Range","formula":"Range = Max − Min","explanation":"The simplest measure of spread — the largest value minus the smallest."},{"name":"Interquartile Range (IQR)","formula":"IQR = Q3 − Q1","explanation":"The spread of the middle 50% of the data — the third quartile minus the first quartile."},{"name":"Z-Score","formula":"Z = (X − μ) / σ","explanation":"How many standard deviations a value X lies from the mean — used with the normal distribution."},{"name":"Confidence Interval (CI)","formula":"CI = x̄ ± z × (σ / √(n))","explanation":"A range likely to contain the true population mean, at a chosen confidence level (z)."},{"name":"ANOVA F-Statistic","formula":"F = MSB / MSW","explanation":"Tests whether the means of three or more groups differ — the ratio of Mean Square Between to Mean Square Within; reject H0 if F-calculated > F-critical."},{"name":"Linear Programming (Objective & Corner-Point Method)","formula":"Maximise / Minimise Z = cx + dy  (evaluate Z at each corner point of the feasible region)","explanation":"Optimise an objective subject to linear constraints; the optimum occurs at a corner (vertex) of the feasible region, found by evaluating Z at every corner.","example":"Maximise Z = 5x + 4y subject to 6x + 4y ≤ 24, x + 2y ≤ 6, x ≥ 0, y ≥ 0. Corner points: (0,0) → 0, (4,0) → 20, (3,1.5) → 21, (0,3) → 12. Optimal: x = 3, y = 1.5, Z = 21."},{"name":"Expected Monetary Value (EMV)","formula":"EMV = Σ [ P(state) × Payoff(state) ]","explanation":"The probability-weighted average payoff of a decision alternative; choose the alternative with the highest EMV.","example":"Large Plant: 0.6(200,000) + 0.4(−180,000) = N48,000; Small Plant: 0.6(100,000) + 0.4(−20,000) = N52,000 → build the Small Plant (highest EMV of N52,000)."},{"name":"Pearson's Correlation Coefficient (r)","formula":"r = Σ[(x − x̄)(y − ȳ)] / √{ Σ(x − x̄)² × Σ(y − ȳ)² }","explanation":"Measures the strength and direction of a linear relationship between two variables, from −1 to +1; correlation does not imply causation.","example":"n=5, Σx=15, Σy=28, Σx²=55, Σy²=190, Σxy=102: r = [5(102) − (15)(28)] / √{[5(55) − 15²][5(190) − 28²]} = [510 − 420] / √{[275 − 225][950 − 784]} = 90 / √(50 × 166) = 90 / √8300 = 90 / 91.10 ≈ 0.988 (strong positive relationship)."}]},"after":{"title":"Quantitative Analysis in Management","body":"A foundational course examining how mathematical and statistical techniques support evidence-based managerial decision-making. The course moves from core quantitative concepts (break-even analysis, revenue/cost/profit formulas) through data collection, descriptive and inferential statistics, correlation and regression, linear programming, and decision theory under risk and uncertainty. Assumes Business Statistics.","topics":[{"chapter":"1","description":"Week 1: Introduction to Quantitative Analysis in Management — Definition, Features, Importance, Areas of Application, Analytical Tools"},{"chapter":"2","description":"Week 2: Basic Mathematical Concepts for Management — Core Concepts, Revenue/Cost/Profit Formulas, Break-Even Analysis"},{"chapter":"3","description":"Week 3: Data Collection, Organization, and Presentation — Primary vs Secondary Data, Quantitative vs Qualitative, Charts and Graphs"},{"chapter":"4","description":"Week 4: Statistical Analysis for Management — Foundations of Statistics, Descriptive Statistics, the Normal Distribution, Hypothesis Testing, Confidence Intervals, ANOVA"},{"chapter":"5","description":"Week 5: Operational Modelling — Linear Programming, the Graphical Solution Method, Applications"},{"chapter":"6","description":"Week 6: Decision Theory and Managerial Decision-Making — Decision Environments, Criteria Under Uncertainty, EMV, Decision Trees"},{"chapter":"7","description":"Week 7: Analysis and Interpretation of Results — Data Analysis vs Interpretation, Correlation Analysis, Regression Analysis, Common Pitfalls"}],"examFocus":["Know the definition of QAM, its six features, and its five areas of application; distinguish QAM from purely intuitive decision-making","Calculate TR, TC, Profit, BEQ, BER, and Target Profit Output; solve simultaneous equations for product-mix problems; apply FV = P(1 + r)ⁿ","Distinguish primary vs secondary data and quantitative vs qualitative characteristics; construct a frequency table and identify the correct chart type for a scenario","Know the three classical definitions of statistics (Bowley, King, Boddington) and the difference between descriptive and inferential statistics","Know when to use the Z-test vs t-test vs chi-square vs ANOVA; state H0 and H1 for any scenario; understand Type I and Type II errors; know the 68-95-99.7 rule","Formulate a linear programming problem and solve it graphically — identify the feasible region, evaluate all corner points, and state the optimal solution","Construct a payoff table, apply all five uncertainty criteria, calculate EMV, and solve a decision tree using the rollback method","Distinguish data analysis from data interpretation; interpret a regression equation (intercept, slope, R²) in plain business language","Know correlation vs causation and the other three common data-interpretation pitfalls (confirmation bias, small sample size, data quality issues)","Know the types of correlation (positive/negative, simple/multiple, partial/total, linear/non-linear) and when to use Pearson vs Spearman"],"formulaSheet":[{"name":"Break-Even Quantity (BEQ)","formula":"BEQ = FC / (P − v)","explanation":"The output level at which total revenue equals total cost — fixed cost divided by the contribution margin per unit.","example":"Selling Price = ₦5,000, Variable Cost = ₦3,000, Fixed Cost = ₦1,000,000; Contribution Margin = 5,000 − 3,000 = ₦2,000 per unit; BEQ = 1,000,000 / 2,000 = 500 units."},{"name":"Break-Even Revenue (BER)","formula":"BER = BEQ × P","explanation":"The sales revenue generated at the break-even point — break-even quantity multiplied by selling price."},{"name":"Total Revenue (TR)","formula":"TR = P × Q","explanation":"Total money earned from sales before deducting any cost — unit selling price times quantity sold.","example":"A company sells 2,500 units at ₦8,000 each: TR = 2,500 × ₦8,000 = ₦20,000,000."},{"name":"Total Cost (TC)","formula":"TC = FC + (v × Q)","explanation":"All costs combined — fixed cost plus the variable cost per unit times the number of units produced."},{"name":"Profit (π)","formula":"Profit = TR − TC = Q(P − v) − FC","explanation":"What remains after all costs: positive is a profit, negative is a loss — equivalently, contribution per unit times quantity, less fixed cost."},{"name":"Contribution Margin (CM)","formula":"CM = P − v","explanation":"The amount each unit sold contributes toward covering fixed costs (and then profit) — price minus variable cost per unit.","example":"Contribution Margin = 5,000 − 3,000 = ₦2,000 per unit."},{"name":"Average Cost (AC)","formula":"AC = TC / Q","explanation":"The cost per unit at a given output level — total cost divided by quantity."},{"name":"Marginal Cost (MC)","formula":"MC = change in TC / change in Q","explanation":"The cost of producing one additional unit — the change in total cost divided by the change in quantity."},{"name":"Target Profit Output","formula":"Target Profit Output = (FC + Target Profit) / (P − v)","explanation":"The number of units needed to reach a desired profit — fixed cost plus target profit, divided by contribution margin per unit.","example":"Target profit of ₦25,000 (FC = ₦45,000,000, P = ₦9,000, v = ₦6,000): Q = (45,000,000 + 25,000) / 3,000 = 15,009 units."},{"name":"Future Value (Compound Interest)","formula":"FV = P(1 + r)ⁿ","explanation":"The value of a present sum after n periods of compound growth at rate r per period.","example":"An investment of ₦1,000,000 growing at 10% annually for 3 years: FV = 1,000,000 × (1.10)³ = 1,000,000 × 1.331 = ₦1,331,000."},{"name":"Mean (x̄)","formula":"x̄ = Σ(x) / n","explanation":"The arithmetic average — the sum of all values divided by the number of values."},{"name":"Variance (s²)","formula":"s² = Σ(x − x̄)² / n","explanation":"The average of the squared deviations from the mean — a measure of how spread out the data is."},{"name":"Standard Deviation (s)","formula":"s = √[ Σ(x − x̄)² / n ]","explanation":"The square root of the variance — spread of the data in the same units as the data."},{"name":"Range","formula":"Range = Max − Min","explanation":"The simplest measure of spread — the largest value minus the smallest."},{"name":"Interquartile Range (IQR)","formula":"IQR = Q3 − Q1","explanation":"The spread of the middle 50% of the data — the third quartile minus the first quartile."},{"name":"Z-Score","formula":"Z = (X − μ) / σ","explanation":"How many standard deviations a value X lies from the mean — used with the normal distribution."},{"name":"Confidence Interval (CI)","formula":"CI = x̄ ± z × (σ / √(n))","explanation":"A range likely to contain the true population mean, at a chosen confidence level (z)."},{"name":"ANOVA F-Statistic","formula":"F = MSB / MSW","explanation":"Tests whether the means of three or more groups differ — the ratio of Mean Square Between to Mean Square Within; reject H0 if F-calculated > F-critical."},{"name":"Linear Programming (Objective & Corner-Point Method)","formula":"Maximise / Minimise Z = cx + dy  (evaluate Z at each corner point of the feasible region)","explanation":"Optimise an objective subject to linear constraints; the optimum occurs at a corner (vertex) of the feasible region, found by evaluating Z at every corner.","example":"Maximise Z = 5x + 4y subject to 6x + 4y ≤ 24, x + 2y ≤ 6, x ≥ 0, y ≥ 0. Corner points: (0,0) → 0, (4,0) → 20, (3,1.5) → 21, (0,3) → 12. Optimal: x = 3, y = 1.5, Z = 21."},{"name":"Expected Monetary Value (EMV)","formula":"EMV = Σ [ P(state) × Payoff(state) ]","explanation":"The probability-weighted average payoff of a decision alternative; choose the alternative with the highest EMV.","example":"Large Plant: 0.6(200,000) + 0.4(−180,000) = ₦48,000; Small Plant: 0.6(100,000) + 0.4(−20,000) = ₦52,000 → build the Small Plant (highest EMV of ₦52,000)."},{"name":"Pearson's Correlation Coefficient (r)","formula":"r = Σ[(x − x̄)(y − ȳ)] / √{ Σ(x − x̄)² × Σ(y − ȳ)² }","explanation":"Measures the strength and direction of a linear relationship between two variables, from −1 to +1; correlation does not imply causation.","example":"n=5, Σx=15, Σy=28, Σx²=55, Σy²=190, Σxy=102: r = [5(102) − (15)(28)] / √{[5(55) − 15²][5(190) − 28²]} = [510 − 420] / √{[275 − 225][950 − 784]} = 90 / √(50 × 166) = 90 / √8300 = 90 / 91.10 ≈ 0.988 (strong positive relationship)."}]}},{"slug":"introduction-financial-management","itemId":"aacda638-71d7-590e-9728-205fc7214117","before":{"title":"Introduction to Financial Management","body":"A quantitative course in financial decision-making built around a single problems-and-solutions workbook (Abass A. Shiro). The course progresses from the time value of money through investment appraisal (with certainty, risk, rationing, inflation, and tax), the cost of capital and leverage, working capital management, portfolio theory, dividend policy, and financial statement analysis, before moving into capital market instruments — bond valuation and the Capital Asset Pricing Model. Two topics on the official course outline (market efficiency; pension funds, mutual funds, and the structure of the money management industry) are not covered in the prescribed workbook and appear to require separate lecture material. Fin 101 introduction to finance.","topics":[{"chapter":"1","description":"Financial Ratio Analysis"},{"chapter":"2","description":"Mathematics of Finance"},{"chapter":"3","description":"Analysis of Risk and Return"},{"chapter":"4","description":"Working Capital Management"},{"chapter":"5","description":"Capital Asset Pricing Model"},{"chapter":"6","description":"Net Present Value"},{"chapter":"7","description":"Market Efficiency"},{"chapter":"8","description":"Pension Funds, Mutual Funds, Structure of Money Management Industry"},{"chapter":"9","description":"Bonds and Interest Rate Forwards, Futures and Options"}],"examFocus":["The difference between ordinary annuity and annuity due, and correctly identifying which applies to a given cash flow pattern","Continuous compounding versus discrete compounding, and computing the effective annual rate from a nominal rate","Resolving NPV/IRR conflicts for mutually exclusive projects with differing cash flow timing — and why NPV is the theoretically preferred criterion","Sensitivity margin calculations for sales, cost, and asset price in a capital budgeting decision, and the method's key limitation","Using the risk-free (treasury bill) rate, not the risk-adjusted cost of capital, to discount expected cash flows when computing Expected NPV","Coefficient of variation versus standard deviation as the correct basis for choosing between investments of different scale for a risk-averse investor","The Economic Order Quantity (EOQ) formula, and correctly separating ordering/carrying cost (controllable) from purchase cost (largely fixed)","The cash discount cost formula — [%disc ÷ (100 − %disc)] × [365 ÷ (max payment period − discount period)] — and its sensitivity to the assumed days-in-year convention (360 vs 365)","Computing a firm's working capital cycle in days from stock, debtor, WIP, and creditor turnover periods","Portfolio return as a weighted average of individual security returns, versus portfolio risk, which is NOT a simple weighted average once correlation is introduced","Identifying the minimum-risk portfolio weighting, which is rarely a 100% holding in either security","How positive correlation between two securities reduces the diversification benefit of combining them","The four major categories of financial ratio (liquidity, profitability/efficiency, long-term solvency and stability, stock market/investor) and which ratios belong to each","Correctly identifying all components of current liabilities in a ratio question — tax payable is often a hidden addition to trade creditors, not stated as a separate line","Bond valuation with semi-annual coupons — the periodic discount rate must be halved (Kd ÷ 2) and the number of periods doubled (2n); watch for workbook solutions that inconsistently apply this","The CAPM formula E(Ri) = Rf + [E(Rm) − Rf]×Bi, and the decision rule for over-priced versus under-priced securities based on comparing given return to CAPM-required return","Systematic (unavoidable, market-wide) versus unsystematic (avoidable, firm-specific) risk, and Beta as the proxy for systematic risk in CAPM"]},"after":{"title":"Introduction to Financial Management","body":"A quantitative course in financial decision-making. The course progresses from the time value of money through investment appraisal (with certainty, risk, rationing, inflation, and tax), the cost of capital and leverage, working capital management, portfolio theory, dividend policy, and financial statement analysis, before moving into capital market instruments — bond valuation and the Capital Asset Pricing Model.","examFocus":["The difference between ordinary annuity and annuity due, and correctly identifying which applies to a given cash flow pattern","Continuous compounding versus discrete compounding, and computing the effective annual rate from a nominal rate","Resolving NPV/IRR conflicts for mutually exclusive projects with differing cash flow timing — and why NPV is the theoretically preferred criterion","Sensitivity margin calculations for sales, cost, and asset price in a capital budgeting decision, and the method's key limitation","Using the risk-free (treasury bill) rate, not the risk-adjusted cost of capital, to discount expected cash flows when computing Expected NPV","Coefficient of variation versus standard deviation as the correct basis for choosing between investments of different scale for a risk-averse investor","The Economic Order Quantity (EOQ) formula, and correctly separating ordering/carrying cost (controllable) from purchase cost (largely fixed)","The cash discount cost formula — [%disc ÷ (100 − %disc)] × [365 ÷ (max payment period − discount period)] — and its sensitivity to the assumed days-in-year convention (360 vs 365)","Computing a firm's working capital cycle in days from stock, debtor, WIP, and creditor turnover periods","Portfolio return as a weighted average of individual security returns, versus portfolio risk, which is NOT a simple weighted average once correlation is introduced","Identifying the minimum-risk portfolio weighting, which is rarely a 100% holding in either security","How positive correlation between two securities reduces the diversification benefit of combining them","The four major categories of financial ratio (liquidity, profitability/efficiency, long-term solvency and stability, stock market/investor) and which ratios belong to each","Correctly identifying all components of current liabilities in a ratio question — tax payable is often a hidden addition to trade creditors, not stated as a separate line","Bond valuation with semi-annual coupons — the periodic discount rate must be halved (Kd ÷ 2) and the number of periods doubled (2n)","The CAPM formula E(Ri) = Rf + [E(Rm) − Rf]×Bi, and the decision rule for over-priced versus under-priced securities based on comparing given return to CAPM-required return","Systematic (unavoidable, market-wide) versus unsystematic (avoidable, firm-specific) risk, and Beta as the proxy for systematic risk in CAPM"]}},{"slug":"nigerian-peoples-and-culture","itemId":"bba5d149-4d82-5584-a1e9-c89fc82e7c84","before":{"title":"Nigerian Peoples and Culture","body":"A General Studies course surveying Nigerian peoples and culture. It covers the concept, characteristics and components of culture; an ethno-historical survey of Nigeria's major groups and geopolitical zones; the roles of Christianity and Islam in political culture; gender and culture; the Nigerian Civil War; and the political economy from agriculture to oil. A 100-level course required of all UNILAG students; Direct Entry students take it in 200 Level.","topics":[{"chapter":"1","description":"Culture and Society"},{"chapter":"2","description":"Nigeria: Ethno-Historical Survey"},{"chapter":"3","description":"Historical Foundation of Nigerian Culture"},{"chapter":"4","description":"Christianity and Political Culture"},{"chapter":"5","description":"Islam and Political Culture"},{"chapter":"6","description":"Nigerian Cultural Heritage: Marriage and Naming"},{"chapter":"7","description":"Gender and Culture"},{"chapter":"8","description":"Political Economy and Intergroup Relations"}],"examFocus":["Concept, characteristics and components of culture","Geopolitical zones and major ethnic groups of Nigeria","Introduction of Christianity and the role of Badagry","Spread of Islam in Kanem-Borno and Hausaland","Pre-colonial women and the Aba Women's Riot of 1929","The Nigerian Civil War: causes, key figures and outcomes","Political economy: agriculture, oil at Oloibiri, and national development","The 1914 amalgamation and intergroup relations"]},"after":{"title":"Nigerian Peoples and Culture","body":"A General Studies course surveying Nigerian peoples and culture. It covers the concept, characteristics and components of culture; an ethno-historical survey of Nigeria's major groups and geopolitical zones; the roles of Christianity and Islam in political culture; gender and culture; the Nigerian Civil War; and the political economy from agriculture to oil.","topics":[{"chapter":"1","description":"Culture and Society"},{"chapter":"2","description":"Nigeria: Ethno-Historical Survey"},{"chapter":"3","description":"Historical Foundation of Nigerian Culture"},{"chapter":"4","description":"Christianity and Political Culture"},{"chapter":"5","description":"Islam and Political Culture"},{"chapter":"6","description":"Nigerian Cultural Heritage: Marriage and Naming"},{"chapter":"7","description":"Gender and Culture"},{"chapter":"8","description":"Political Economy and Intergroup Relations"}],"examFocus":["Concept, characteristics and components of culture","Geopolitical zones and major ethnic groups of Nigeria","Introduction of Christianity and the role of Badagry","Spread of Islam in Kanem-Borno and Hausaland","Pre-colonial women and the Aba Women's Riot of 1929","The Nigerian Civil War: causes, key figures and outcomes","Political economy: agriculture, oil at Oloibiri, and national development","The 1914 amalgamation and intergroup relations"]}},{"slug":"entrepreneurship-innovation","itemId":"ce24b613-5845-53a2-a748-815347fbc945","before":{"title":"Entrepreneurship and Innovation","body":"Introduction to entrepreneurship and innovation, from recognising opportunities and developing business ideas to funding and launching new ventures, and entrepreneurship's role in economic development.","topics":[{"chapter":"1-2","description":"Meaning of Entrepreneurship & Types of Entrepreneurs"},{"chapter":"3-4","description":"Innovation and Opportunity Recognition"},{"chapter":"5-6","description":"Business Ideas and Concept Development"},{"chapter":"7-8","description":"Funding Sources and Business Creation"},{"chapter":"9","description":"Role of Entrepreneurship in Economic Development"}],"examFocus":["Definitions of entrepreneurship and innovation","Types of entrepreneurs and their characteristics","Opportunity recognition process","Business idea evaluation","Short essay questions on economic impact","Theoretical frameworks and concepts"]},"after":{"title":"Entrepreneurship and Innovation","body":"Introduction to entrepreneurship and innovation, from recognising opportunities and developing business ideas to funding and launching new ventures, and entrepreneurship's role in economic development.","examFocus":["Definitions of entrepreneurship and innovation","Types of entrepreneurs and their characteristics","Opportunity recognition process","Business idea evaluation","Short essay questions on economic impact","Theoretical frameworks and concepts"]}},{"slug":"financial-accounting-1","itemId":"fc9a0adc-5f6f-5c98-a35f-7473c94a400a","before":{"title":"Financial Accounting I","body":"Fundamentals of financial accounting under IFRS: the IASB conceptual framework and the key standards governing revenue, financial-statement presentation, inventories, accounting policies, property plant and equipment, government grants, and borrowing costs.","topics":[{"chapter":"1","description":"IASB Framework for the Preparation and Presentation of Financial Statements"},{"chapter":"2","description":"IFRS 15 - Revenue from Contracts with Customers"},{"chapter":"3","description":"IAS 1 - Presentation of Financial Statements"},{"chapter":"4","description":"IAS 2 - Accounting for Inventory"},{"chapter":"5","description":"IAS 8 - Accounting Policies, Changes in Estimates and Errors"},{"chapter":"6","description":"IAS 16 - Property, Plant, and Equipment (PPE)"},{"chapter":"7","description":"IAS 20 - Government Grants"},{"chapter":"8","description":"IAS 23 - Borrowing Costs"}],"examFocus":["IASB Framework qualitative characteristics","IFRS 15 five-step revenue recognition model","IAS 1 complete set of financial statements","IAS 2 inventory valuation (lower of cost and NRV)","IAS 8 retrospective vs prospective application","IAS 16 depreciation calculations (straight-line & reducing balance)","IAS 20 government grants recognition rules","IAS 23 borrowing costs capitalization"]},"after":{"title":"Financial Accounting I","body":"Fundamentals of financial accounting under IFRS: the IASB conceptual framework and the key standards governing revenue, financial-statement presentation, inventories, accounting policies, property, plant and equipment, government grants, and borrowing costs.","topics":[{"chapter":"1","description":"IASB Framework for the Preparation and Presentation of Financial Statements"},{"chapter":"2","description":"IFRS 15 - Revenue from Contracts with Customers"},{"chapter":"3","description":"IAS 1 - Presentation of Financial Statements"},{"chapter":"4","description":"IAS 2 - Accounting for Inventory"},{"chapter":"5","description":"IAS 8 - Accounting Policies, Changes in Estimates and Errors"},{"chapter":"6","description":"IAS 16 - Property, Plant, and Equipment (PPE)"},{"chapter":"7","description":"IAS 20 - Government Grants"},{"chapter":"8","description":"IAS 23 - Borrowing Costs"}],"examFocus":["IASB Framework qualitative characteristics","IFRS 15 five-step revenue recognition model","IAS 1 complete set of financial statements","IAS 2 inventory valuation (lower of cost and NRV)","IAS 8 retrospective vs prospective application","IAS 16 depreciation calculations (straight-line & reducing balance)","IAS 20 government grants recognition rules","IAS 23 borrowing costs capitalization"]}}]}$overview_source$::jsonb;
  v_actor uuid := (v_data->>'actor')::uuid;
  v_seed_actor uuid := (v_data->>'seedActor')::uuid;
  v_from text;
  v_to text;
  v_stray text;
  v_row jsonb;
  v_item public.managed_content_items%rowtype;
  v_revision integer;
begin
  if p_action is null or p_action not in ('apply', 'rollback') then
    raise exception 'Course overviews: unknown action %', p_action;
  end if;
  v_from := case when p_action = 'apply' then 'before' else 'after' end;
  v_to := case when p_action = 'apply' then 'after' else 'before' end;
  -- Every overview, locked in one order before anything is read or written.
  perform 1 from public.managed_content_items
    where id in (select (value->>'itemId')::uuid from jsonb_array_elements(v_data->'items')) order by id for update;

  if not exists (select 1 from jsonb_array_elements(v_data->'items') r where private.course_overview_revision_state(
      (r.value->>'itemId')::uuid, r.value->'before', r.value->'after', v_actor, v_seed_actor) <> v_to) then
    return 'unchanged';
  end if;
  select r.value->>'slug' into v_stray from jsonb_array_elements(v_data->'items') r
    where private.course_overview_revision_state((r.value->>'itemId')::uuid, r.value->'before', r.value->'after',
      v_actor, v_seed_actor) <> v_from
    order by r.value->>'itemId' limit 1;
  if v_stray is not null then
    raise exception 'Course overview %: the published text is not the text this correction %', v_stray,
      case when p_action = 'apply' then 'replaces' else 'published' end;
  end if;

  for v_row in select value from jsonb_array_elements(v_data->'items') order by value->>'itemId' loop
    select * into v_item from public.managed_content_items where id = (v_row->>'itemId')::uuid;
    if p_action = 'apply' then
      -- The new text is the next revision, or the revision this correction already wrote before a rollback.
      select r.revision into v_revision from public.managed_content_revisions r
        where r.item_id = v_item.id and r.authored_by = v_actor and r.payload = v_row->'after'
        order by r.revision desc limit 1;
      if v_revision is null then
        perform private.assert_managed_payload('course_overview', v_row->'after');
        v_revision := v_item.current_revision + 1;
        insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
          values (v_item.id, v_revision, v_row->'after', v_actor);
        update public.managed_content_items set current_revision = v_revision, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
      if v_item.current_revision <> v_revision and not (v_item.current_revision > v_revision
          and (v_item.approved_revision = v_item.published_revision and exists (select 1
          from public.managed_content_revisions g where g.item_id = v_item.id and g.revision = v_item.current_revision
          and g.authored_by = '00000000-0000-4000-8000-000000000045'))) then
        raise exception 'Course overview %: another revision is pending', v_row->>'slug';
      end if;
      if v_item.approved_revision is distinct from v_revision then
        insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
          values (v_item.id, v_revision, null, 'approved', v_actor, v_item.lock_version + 1);
        update public.managed_content_items set approved_revision = v_revision, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
    else
      -- The revision this correction's last publication replaced, which must still hold the text from before.
      select p.previous_revision into v_revision from public.managed_content_publications p
        where p.item_id = v_item.id and p.action = 'publish' and p.revision = v_item.published_revision
          and p.acted_by = v_actor
        order by p.lock_version desc limit 1;
      if v_revision is null or not exists (select 1 from public.managed_content_revisions r
          where r.item_id = v_item.id and r.revision = v_revision and r.payload = v_row->'before') then
        raise exception 'Course overview %: the text from before is not the revision it replaced', v_row->>'slug';
      end if;
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
  end loop;

  if exists (select 1 from jsonb_array_elements(v_data->'items') r where private.course_overview_revision_state(
      (r.value->>'itemId')::uuid, r.value->'before', r.value->'after', v_actor, v_seed_actor) <> v_to) then
    raise exception 'Course overviews: % did not publish the expected text', p_action;
  end if;
  return case when p_action = 'apply' then 'applied' else 'rolled-back' end;
end;
$overview_revisions$;

revoke all on function private.course_overview_revision_state(uuid, jsonb, jsonb, uuid, uuid), private.course_overview_revisions(text)
  from public, anon, authenticated, service_role;
-- END GENERATED
