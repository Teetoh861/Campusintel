-- supabase/migrations/20261001100000_student_bookmarks.sql — Account bookmarks and import receipts.
-- Account bookmarks belong to the permanent Auth user and the stable
-- platform course registry, never to a route slug or institutional code.
create table public.student_bookmarks (
  user_id uuid not null references auth.users (id) on delete cascade,
  course_id uuid not null references public.courses (id) on delete restrict,
  saved_at timestamptz not null default now(),
  constraint student_bookmarks_pkey primary key (user_id, course_id)
);

create index student_bookmarks_course_id_idx
  on public.student_bookmarks (course_id);

alter table public.student_bookmarks enable row level security;

revoke all on table public.student_bookmarks from public, anon, authenticated;
grant select, delete on table public.student_bookmarks to authenticated;
grant insert (user_id, course_id) on table public.student_bookmarks to authenticated;

create policy "Students read their own bookmarks"
  on public.student_bookmarks for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Students add their own bookmarks"
  on public.student_bookmarks for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Students remove their own bookmarks"
  on public.student_bookmarks for delete to authenticated
  using ((select auth.uid()) = user_id);

-- One immutable receipt per account and local import. Its creation and the
-- bookmark union occur in the same statement/transaction, so a lost HTTP
-- acknowledgement can be retried without replaying an already applied union.
create table public.student_bookmark_reconciliations (
  user_id uuid not null references auth.users (id) on delete cascade,
  reconciliation_id uuid not null,
  course_ids uuid[] not null,
  applied_at timestamptz not null default now(),
  constraint student_bookmark_reconciliations_pkey primary key (user_id, reconciliation_id)
);

alter table public.student_bookmark_reconciliations enable row level security;
revoke all on table public.student_bookmark_reconciliations from public, anon, authenticated;

-- The caller supplies a replay identifier and canonical course IDs, never an
-- owner. This narrow function derives ownership from the verified Auth JWT.
-- The receipt table has no browser-facing grants; direct bookmark access keeps
-- its owner-scoped RLS policies above.
-- The 32-ID ceiling bounds one call (MAX_BOOKMARK_RECONCILIATION_BATCH_SIZE in
-- lib/bookmarks/contract.ts), not an account: larger local sets are split into
-- several receipts, each fixed when the client first creates its import.
create function public.reconcile_student_bookmarks(
  p_reconciliation_id uuid, p_course_ids uuid[]
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_course_ids uuid[];
  v_existing_ids uuid[];
  v_applied boolean;
begin
  if v_user_id is null or p_reconciliation_id is null or p_course_ids is null
      or cardinality(p_course_ids) > 32 or array_position(p_course_ids, null) is not null then
    raise exception 'Invalid bookmark reconciliation' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct input.course_id order by input.course_id), '{}'::uuid[])
    into v_course_ids from unnest(p_course_ids) as input(course_id);

  insert into public.student_bookmark_reconciliations
    (user_id, reconciliation_id, course_ids)
  values (v_user_id, p_reconciliation_id, v_course_ids)
  on conflict do nothing
  returning true into v_applied;

  if v_applied then
    insert into public.student_bookmarks (user_id, course_id)
    select v_user_id, input.course_id from unnest(v_course_ids) as input(course_id)
    on conflict do nothing;
    return true;
  end if;

  select course_ids into v_existing_ids
    from public.student_bookmark_reconciliations
    where user_id = v_user_id and reconciliation_id = p_reconciliation_id;
  if v_existing_ids is distinct from v_course_ids then
    raise exception 'Bookmark reconciliation payload changed' using errcode = '22023';
  end if;
  return false;
end;
$$;

revoke all on function public.reconcile_student_bookmarks(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reconcile_student_bookmarks(uuid, uuid[]) to authenticated;
