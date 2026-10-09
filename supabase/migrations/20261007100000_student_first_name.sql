-- supabase/migrations/20261007100000_student_first_name.sql
-- Real student first names use the existing owner/live-session profile boundary.
-- Keep legacy names null: application completeness routes those owners through
-- one-time setup rather than fabricating a name or changing their academic IDs.

alter table public.profiles add column first_name text;
alter table public.profiles add constraint profiles_first_name_check check (
  first_name is null or (
    char_length(first_name) between 1 and 80
    and first_name = btrim(first_name,
      E' \t\n\r\f' || U&'\000B\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  )
);

-- Column privilege only. Existing ownership, live-session, active-selection
-- policies, identity/role restrictions and timestamp trigger remain intact.
grant update (first_name) on public.profiles to authenticated;
comment on column public.profiles.first_name is
  'Student-supplied trimmed first name, 1–80 Unicode characters. Null until profile setup is completed.';
