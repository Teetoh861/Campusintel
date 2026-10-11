-- Profile whole-form compare-and-swap token. Existing and new rows start at zero.
alter table public.profiles add column revision bigint not null default 0;
alter table public.profiles add constraint profiles_revision_nonnegative check (revision >= 0);
comment on column public.profiles.revision is
  'Database-owned monotonic profile revision; clients submit it only as an UPDATE predicate.';

-- This helper also timestamps quiz_attempts. Keep their existing revision semantics.
create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  if tg_table_schema = 'public' and tg_table_name = 'profiles' then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

-- No new UPDATE privilege or RLS policy: revision stays database-owned.
revoke all on function private.set_updated_at() from public, anon, authenticated;
