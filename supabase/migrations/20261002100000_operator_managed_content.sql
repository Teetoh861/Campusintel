-- supabase/migrations/20261002100000_operator_managed_content.sql
-- Operator-authored content is keyed by the repository course UUID, independently
-- of institutional applicability, shared classification and entitlement.

create table public.managed_content_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on update restrict on delete restrict,
  kind text not null check (kind in (
    'course_overview', 'note', 'cbt_question', 'theory_question', 'model_answer', 'rubric'
  )),
  question_id uuid unique,
  source_key text,
  parent_item_id uuid,
  current_revision integer not null default 1 check (current_revision > 0),
  approved_revision integer check (approved_revision > 0),
  published_revision integer check (published_revision > 0),
  published_parent_revision integer check (published_parent_revision > 0),
  lock_version bigint not null default 1 check (lock_version > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint managed_content_source_key_format check (
    source_key is null or (length(source_key) between 1 and 120 and source_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._:-]*$')
  ),
  constraint managed_content_question_identity check (
    (kind = 'cbt_question' and question_id is not null)
    or (kind = 'theory_question')
    or (kind not in ('cbt_question', 'theory_question') and question_id is null)
  ),
  constraint managed_content_parent_kind check (
    (kind in ('model_answer', 'rubric') and parent_item_id is not null)
    or (kind not in ('model_answer', 'rubric') and parent_item_id is null)
  ),
  constraint managed_content_published_parent_check check (
    (parent_item_id is null and published_parent_revision is null)
    or (parent_item_id is not null and
      ((published_revision is null and published_parent_revision is null)
       or (published_revision is not null and published_parent_revision is not null)))
  ),
  constraint managed_content_item_course_unique unique (id, course_id),
  constraint managed_content_parent_same_course
    foreign key (parent_item_id, course_id)
    references public.managed_content_items(id, course_id) on update restrict on delete restrict
);

create unique index managed_content_source_identity
  on public.managed_content_items(course_id, kind, source_key)
  where source_key is not null;
create index managed_content_course_kind on public.managed_content_items(course_id, kind, id);
create unique index managed_content_one_overview_per_course
  on public.managed_content_items(course_id) where kind = 'course_overview';
create unique index managed_content_one_answer_per_theory
  on public.managed_content_items(parent_item_id) where kind = 'model_answer';
create unique index managed_content_one_rubric_per_theory
  on public.managed_content_items(parent_item_id) where kind = 'rubric';

create table public.managed_content_revisions (
  item_id uuid not null references public.managed_content_items(id) on update restrict on delete restrict,
  revision integer not null check (revision > 0),
  schema_version smallint not null default 1 check (schema_version = 1),
  payload jsonb not null,
  authored_by uuid not null,
  authored_at timestamptz not null default now(),
  primary key (item_id, revision)
);

alter table public.managed_content_items
  add constraint managed_content_current_revision_fkey
    foreign key (id, current_revision) references public.managed_content_revisions(item_id, revision)
    deferrable initially deferred,
  add constraint managed_content_approved_revision_fkey
    foreign key (id, approved_revision) references public.managed_content_revisions(item_id, revision)
    deferrable initially deferred,
  add constraint managed_content_published_revision_fkey
    foreign key (id, published_revision) references public.managed_content_revisions(item_id, revision)
    deferrable initially deferred,
  add constraint managed_content_published_parent_revision_fkey
    foreign key (parent_item_id, published_parent_revision)
    references public.managed_content_revisions(item_id, revision)
    deferrable initially deferred;

create table public.managed_content_reviews (
  item_id uuid not null,
  revision integer not null,
  parent_revision integer check (parent_revision > 0),
  decision text not null check (decision in ('approved', 'rejected')),
  note text check (note is null or length(note) <= 2000),
  reviewed_by uuid not null,
  reviewed_at timestamptz not null default now(),
  lock_version bigint not null,
  primary key (item_id, lock_version),
  foreign key (item_id, revision)
    references public.managed_content_revisions(item_id, revision) on update restrict on delete restrict
);

create table public.managed_content_publications (
  item_id uuid not null references public.managed_content_items(id) on update restrict on delete restrict,
  lock_version bigint not null,
  action text not null check (action in ('publish', 'unpublish')),
  revision integer,
  parent_revision integer check (parent_revision > 0),
  previous_revision integer,
  previous_parent_revision integer check (previous_parent_revision > 0),
  acted_by uuid not null,
  acted_at timestamptz not null default now(),
  primary key (item_id, lock_version),
  constraint managed_content_publication_action check (
    (action = 'publish' and revision is not null)
    or (action = 'unpublish' and revision is null and parent_revision is null
        and previous_revision is not null)
  ),
  foreign key (item_id, revision)
    references public.managed_content_revisions(item_id, revision) on update restrict on delete restrict,
  foreign key (item_id, previous_revision)
    references public.managed_content_revisions(item_id, revision) on update restrict on delete restrict
);

-- No table policy is deliberately permissive. Only the narrow, validating
-- functions below can read or mutate these rows for API roles.
alter table public.managed_content_items enable row level security;
alter table public.managed_content_revisions enable row level security;
alter table public.managed_content_reviews enable row level security;
alter table public.managed_content_publications enable row level security;
revoke all on table public.managed_content_items from public, anon, authenticated, service_role;
revoke all on table public.managed_content_revisions from public, anon, authenticated, service_role;
revoke all on table public.managed_content_reviews from public, anon, authenticated, service_role;
revoke all on table public.managed_content_publications from public, anon, authenticated, service_role;

comment on column public.managed_content_items.question_id is
  'Permanent logical question UUID, including existing CBT questionId values used by attempt history. Never regenerated on revision.';
comment on column public.managed_content_items.source_key is
  'Optional immutable migration key for source rows such as course-local numeric theory IDs; never a course foreign key.';
comment on column public.managed_content_items.lock_version is
  'Optimistic concurrency token. Every edit, review or publication transition requires its previous value.';
comment on column public.managed_content_items.published_parent_revision is
  'For a published answer/rubric, the exact theory-question revision it was reviewed against. Only a matching parent publication exposes it.';
comment on column public.profiles.role is
  'student | operator. Operator access uses the existing Auth account and this server-owned role; authenticated clients cannot update role.';

create function private.require_live_operator()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id text := auth.jwt()->>'session_id';
begin
  if v_user_id is null or v_session_id is null or
     v_session_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or
     not exists (
       select 1 from auth.sessions s
       join public.profiles p on p.id = s.user_id
       where s.id = v_session_id::uuid and s.user_id = v_user_id and p.role = 'operator'
         and (s.not_after is null or s.not_after > now())
     ) then
    raise exception using errcode = '42501', message = 'Operator authorization required';
  end if;
  return v_user_id;
end;
$$;

create function private.require_live_account()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_session_id text := auth.jwt()->>'session_id';
begin
  if v_user_id is null or v_session_id is null or
     v_session_id !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or
     not exists (
       select 1 from auth.sessions s
       where s.id = v_session_id::uuid and s.user_id = v_user_id
         and (s.not_after is null or s.not_after > now())
     ) then
    raise exception using errcode = '42501', message = 'Account session required';
  end if;
  return v_user_id;
end;
$$;

create function private.valid_managed_text(p_payload jsonb, p_key text, p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_payload->p_key) = 'string'
    and length(btrim(p_payload->>p_key)) between 1 and p_max,
    false
  );
$$;

create function private.valid_optional_managed_text(p_payload jsonb, p_key text, p_max integer)
returns boolean language sql immutable set search_path = '' as $$
  select not (p_payload ? p_key) or private.valid_managed_text(p_payload, p_key, p_max);
$$;

create function private.assert_managed_payload(p_kind text, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
declare
  v_option jsonb;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or
     octet_length(p_payload::text) > 262144 then
    raise exception using errcode = '22023', message = 'Invalid managed content';
  end if;
  if p_kind in ('course_overview', 'note') then
    if not private.valid_managed_text(p_payload, 'title', 240) or
       not private.valid_managed_text(p_payload, 'body', 200000) or
       (select count(*) from jsonb_object_keys(p_payload)) <> 2 then
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

revoke all on function private.require_live_operator() from public, anon, authenticated, service_role;
revoke all on function private.require_live_account() from public, anon, authenticated, service_role;
revoke all on function private.valid_managed_text(jsonb,text,integer) from public, anon, authenticated, service_role;
revoke all on function private.valid_optional_managed_text(jsonb,text,integer) from public, anon, authenticated, service_role;
revoke all on function private.assert_managed_payload(text,jsonb) from public, anon, authenticated, service_role;

-- These SECURITY DEFINER entry points are narrowly granted below. Each call
-- verifies the current Auth session and reads role from the protected profile,
-- never from a client argument or JWT role claim.
create function public.create_managed_content(
  p_course_id uuid, p_kind text, p_payload jsonb,
  p_question_id uuid default null, p_source_key text default null, p_parent_item_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_item_id uuid;
begin
  perform private.assert_managed_payload(p_kind, p_payload);
  if p_course_id is null or
     (p_kind = 'cbt_question' and p_question_id is null) or
     (p_kind not in ('cbt_question', 'theory_question') and p_question_id is not null) or
     (p_kind in ('model_answer', 'rubric') and
       not exists (select 1 from public.managed_content_items parent
                   where parent.id = p_parent_item_id and parent.course_id = p_course_id
                     and parent.kind = 'theory_question')) or
     (p_kind not in ('model_answer', 'rubric') and p_parent_item_id is not null) then
    raise exception using errcode = '22023', message = 'Invalid managed content identity';
  end if;
  insert into public.managed_content_items
    (course_id, kind, question_id, source_key, parent_item_id, created_by)
  values (p_course_id, p_kind, p_question_id, p_source_key, p_parent_item_id, v_actor)
  returning id into v_item_id;
  insert into public.managed_content_revisions(item_id, revision, payload, authored_by)
  values (v_item_id, 1, p_payload, v_actor);
  return v_item_id;
end;
$$;

create function public.revise_managed_content(
  p_item_id uuid, p_expected_lock_version bigint, p_payload jsonb
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_item public.managed_content_items%rowtype;
begin
  select * into v_item from public.managed_content_items where id = p_item_id for update;
  if not found then raise exception using errcode = '22023', message = 'Unknown managed content'; end if;
  if p_expected_lock_version is distinct from v_item.lock_version then
    raise exception using errcode = '40001', message = 'Managed content changed';
  end if;
  perform private.assert_managed_payload(v_item.kind, p_payload);
  insert into public.managed_content_revisions(item_id, revision, payload, authored_by)
  values (v_item.id, v_item.current_revision + 1, p_payload, v_actor);
  update public.managed_content_items
  set current_revision = v_item.current_revision + 1,
      lock_version = v_item.lock_version + 1, updated_at = now()
  where id = v_item.id;
  return v_item.lock_version + 1;
end;
$$;

create function public.review_managed_content(
  p_item_id uuid, p_expected_lock_version bigint, p_revision integer,
  p_decision text, p_note text default null, p_parent_revision integer default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_item public.managed_content_items%rowtype;
  v_parent public.managed_content_items%rowtype;
  v_parent_revision integer;
begin
  if p_decision not in ('approved', 'rejected') or
     (p_note is not null and length(p_note) > 2000) then
    raise exception using errcode = '22023', message = 'Invalid review';
  end if;
  select * into v_item from public.managed_content_items where id = p_item_id for update;
  if not found or p_revision is null or
     not exists (select 1 from public.managed_content_revisions
                 where item_id = p_item_id and revision = p_revision) then
    raise exception using errcode = '22023', message = 'Unknown managed revision';
  end if;
  if p_expected_lock_version is distinct from v_item.lock_version then
    raise exception using errcode = '40001', message = 'Managed content changed';
  end if;
  if v_item.parent_item_id is not null then
    select * into v_parent from public.managed_content_items
    where id = v_item.parent_item_id for share;
    if not found then raise exception using errcode = '22023', message = 'Unknown parent question'; end if;
    -- The review records the exact theory wording it evaluated. An explicit
    -- historical revision supports deliberate preparation for a rollback.
    v_parent_revision := coalesce(p_parent_revision, v_parent.published_revision, v_parent.current_revision);
    if not exists (select 1 from public.managed_content_revisions
                   where item_id = v_parent.id and revision = v_parent_revision) then
      raise exception using errcode = '22023', message = 'Unknown parent revision';
    end if;
  elsif p_parent_revision is not null then
    raise exception using errcode = '22023', message = 'Unexpected parent revision';
  end if;
  insert into public.managed_content_reviews
    (item_id, revision, parent_revision, decision, note, reviewed_by, lock_version)
  values (p_item_id, p_revision, v_parent_revision, p_decision, p_note, v_actor, v_item.lock_version + 1);
  -- Rejecting the student-visible revision atomically withdraws it and leaves
  -- the same-version unpublish event beside the review decision in the audit.
  if p_decision = 'rejected' and v_item.published_revision = p_revision then
    insert into public.managed_content_publications
      (item_id, lock_version, action, previous_revision, previous_parent_revision, acted_by)
    values (p_item_id, v_item.lock_version + 1, 'unpublish',
            v_item.published_revision, v_item.published_parent_revision, v_actor);
  end if;
  update public.managed_content_items
  set approved_revision = case when p_decision = 'approved' then p_revision
                               when approved_revision = p_revision then null
                               else approved_revision end,
      published_revision = case when p_decision = 'rejected' and published_revision = p_revision
                                then null else published_revision end,
      published_parent_revision = case when p_decision = 'rejected' and published_revision = p_revision
                                       then null else published_parent_revision end,
      lock_version = v_item.lock_version + 1, updated_at = now()
  where id = p_item_id;
  return v_item.lock_version + 1;
end;
$$;

create function public.publish_managed_content(
  p_item_id uuid, p_expected_lock_version bigint, p_revision integer
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_item public.managed_content_items%rowtype;
  v_parent_revision integer;
begin
  select * into v_item from public.managed_content_items where id = p_item_id for update;
  if not found then raise exception using errcode = '22023', message = 'Unknown managed content'; end if;
  if p_expected_lock_version is distinct from v_item.lock_version then
    raise exception using errcode = '40001', message = 'Managed content changed';
  end if;
  if p_revision is null or p_revision is distinct from v_item.approved_revision then
    raise exception using errcode = '22023', message = 'Revision is not approved for publication';
  end if;
  select parent_revision into v_parent_revision
  from public.managed_content_reviews
  where item_id = p_item_id and revision = p_revision and decision = 'approved'
  order by lock_version desc limit 1;
  if (v_item.parent_item_id is not null and v_parent_revision is null) or
     (v_item.parent_item_id is null and v_parent_revision is not null) or
     (p_revision is not distinct from v_item.published_revision and
      v_parent_revision is not distinct from v_item.published_parent_revision) then
    raise exception using errcode = '22023', message = 'Revision is not approved for publication';
  end if;
  insert into public.managed_content_publications
    (item_id, lock_version, action, revision, parent_revision,
     previous_revision, previous_parent_revision, acted_by)
  values (p_item_id, v_item.lock_version + 1, 'publish', p_revision, v_parent_revision,
          v_item.published_revision, v_item.published_parent_revision, v_actor);
  update public.managed_content_items
  set published_revision = p_revision, published_parent_revision = v_parent_revision,
      lock_version = v_item.lock_version + 1,
      updated_at = now()
  where id = p_item_id;
  return v_item.lock_version + 1;
end;
$$;

create function public.unpublish_managed_content(
  p_item_id uuid, p_expected_lock_version bigint
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := private.require_live_operator();
  v_item public.managed_content_items%rowtype;
begin
  select * into v_item from public.managed_content_items where id = p_item_id for update;
  if not found then raise exception using errcode = '22023', message = 'Unknown managed content'; end if;
  if p_expected_lock_version is distinct from v_item.lock_version then
    raise exception using errcode = '40001', message = 'Managed content changed';
  end if;
  if v_item.published_revision is null then
    raise exception using errcode = '22023', message = 'Managed content is not published';
  end if;
  insert into public.managed_content_publications
    (item_id, lock_version, action, previous_revision, previous_parent_revision, acted_by)
  values (p_item_id, v_item.lock_version + 1, 'unpublish',
          v_item.published_revision, v_item.published_parent_revision, v_actor);
  update public.managed_content_items
  set published_revision = null, published_parent_revision = null,
      lock_version = v_item.lock_version + 1,
      updated_at = now()
  where id = p_item_id;
  return v_item.lock_version + 1;
end;
$$;

create function public.list_managed_content(p_course_id uuid)
returns table (
  item_id uuid, course_id uuid, kind text, question_id uuid, source_key text,
  parent_item_id uuid, current_revision integer, approved_revision integer,
  published_revision integer, published_parent_revision integer,
  lock_version bigint, payload jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_live_operator();
  if p_course_id is null then
    raise exception using errcode = '22023', message = 'Course identity required';
  end if;
  return query
    select i.id, i.course_id, i.kind, i.question_id, i.source_key,
           i.parent_item_id, i.current_revision, i.approved_revision,
           i.published_revision, i.published_parent_revision, i.lock_version, r.payload
    from public.managed_content_items i
    join public.managed_content_revisions r
      on r.item_id = i.id and r.revision = i.current_revision
    where i.course_id = p_course_id
    order by i.created_at, i.id;
end;
$$;

create function public.read_published_managed_content(p_course_id uuid)
returns table (
  item_id uuid, course_id uuid, kind text, question_id uuid, source_key text,
  parent_item_id uuid, revision integer, payload jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_live_account();
  if p_course_id is null then
    raise exception using errcode = '22023', message = 'Course identity required';
  end if;
  return query
    select i.id, i.course_id, i.kind, i.question_id, i.source_key,
           i.parent_item_id, i.published_revision, r.payload
    from public.managed_content_items i
    join public.managed_content_revisions r
      on r.item_id = i.id and r.revision = i.published_revision
    where i.course_id = p_course_id and i.published_revision is not null
      and (i.parent_item_id is null or exists (
        select 1 from public.managed_content_items parent
        where parent.id = i.parent_item_id
          and parent.published_revision = i.published_parent_revision
      ))
    order by i.created_at, i.id;
end;
$$;

revoke all on function public.create_managed_content(uuid,text,jsonb,uuid,text,uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.revise_managed_content(uuid,bigint,jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.review_managed_content(uuid,bigint,integer,text,text,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.publish_managed_content(uuid,bigint,integer)
  from public, anon, authenticated, service_role;
revoke all on function public.unpublish_managed_content(uuid,bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.list_managed_content(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.read_published_managed_content(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_managed_content(uuid,text,jsonb,uuid,text,uuid) to authenticated;
grant execute on function public.revise_managed_content(uuid,bigint,jsonb) to authenticated;
grant execute on function public.review_managed_content(uuid,bigint,integer,text,text,integer) to authenticated;
grant execute on function public.publish_managed_content(uuid,bigint,integer) to authenticated;
grant execute on function public.unpublish_managed_content(uuid,bigint) to authenticated;
grant execute on function public.list_managed_content(uuid) to authenticated;
grant execute on function public.read_published_managed_content(uuid) to authenticated;

comment on function public.read_published_managed_content(uuid) is
  'Authenticated published-only read boundary for a repository course UUID. Drafts and review history are never returned.';
