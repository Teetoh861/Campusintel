-- Phase B Slice 1 — reference catalogue schema, fixed seed shape and grants.
-- The migration alone owns production reference values.

begin;

select plan(23);

-- ---------------------------------------------------------------------------
-- Reference-data shape and deterministic ordering
-- ---------------------------------------------------------------------------

select is(
  (select count(*)::int from public.departments),
  8,
  'the approved department catalogue has exactly eight rows'
);

select is(
  (select count(*)::int from public.academic_levels),
  3,
  'the approved academic-level catalogue has exactly three rows'
);

select is(
  (select count(*)::int from public.academic_periods),
  2,
  'the approved academic-period catalogue has exactly two rows'
);

select is(
  (
    select count(*)::int
    from (
      select is_active from public.departments
      union all
      select is_active from public.academic_levels
      union all
      select is_active from public.academic_periods
    ) as reference_rows
    where is_active
  ),
  13,
  'all thirteen approved reference rows begin active'
);

select ok(
  (
    select min(sort_order) = 1
       and max(sort_order) = count(*)
       and count(distinct sort_order) = count(*)
    from public.departments
  ),
  'department ordering is explicit and gap-free'
);

select ok(
  (
    select min(sort_order) = 1
       and max(sort_order) = count(*)
       and count(distinct sort_order) = count(*)
    from public.academic_levels
  ),
  'academic-level ordering is explicit and gap-free'
);

select ok(
  (
    select min(sort_order) = 1
       and max(sort_order) = count(*)
       and count(distinct sort_order) = count(*)
    from public.academic_periods
  ),
  'academic-period ordering is explicit and gap-free'
);

select ok(
  (
    select count(*) = count(distinct key)
       and count(*) = count(distinct sort_order)
       and bool_and(id is not null and btrim(display_name) <> '')
    from public.departments
  ),
  'departments have unique keys, unique ordering and populated fixed IDs'
);

select ok(
  (
    select count(*) = count(distinct key)
       and count(*) = count(distinct sort_order)
       and bool_and(id is not null and btrim(display_name) <> '')
    from public.academic_levels
  ),
  'academic levels have unique keys, unique ordering and populated fixed IDs'
);

select ok(
  (
    select count(*) = count(distinct key)
       and count(*) = count(distinct sort_order)
       and bool_and(id is not null and btrim(display_name) <> '')
    from public.academic_periods
  ),
  'academic periods have unique keys, unique ordering and populated fixed IDs'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.departments'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.academic_levels'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.academic_periods'::regclass),
  'RLS is enabled on every reference table'
);

select is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in (
        'department_id',
        'academic_level_id',
        'academic_period_id'
      )
  ),
  3,
  'profiles has all three typed selection references'
);

select is(
  (
    select count(*)::int
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name in ('department', 'level', 'semester')
  ),
  0,
  'legacy raw selection columns have been removed'
);

select is(
  (
    select count(*)::int
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and contype = 'f'
      and conname in (
        'profiles_department_id_fkey',
        'profiles_academic_level_id_fkey',
        'profiles_academic_period_id_fkey'
      )
      and confupdtype = 'r'
      and confdeltype = 'r'
  ),
  3,
  'all profile references restrict key updates and referenced-row deletion'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.profiles'::regclass
      and conname = 'profiles_selection_completeness_check'
      and contype = 'c'
  ),
  'profiles has an all-null-or-all-complete selection constraint'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profiles'
      and policyname = 'Profiles are updatable by their owner with active selection'
      and cmd = 'UPDATE'
  ),
  'profiles has the owner and active-reference UPDATE policy'
);

select is(
  (
    select count(*)::int
    from pg_policies
    where schemaname = 'public'
      and tablename in ('departments', 'academic_levels', 'academic_periods')
      and cmd = 'SELECT'
  ),
  3,
  'each reference table has one authenticated read policy'
);

-- ---------------------------------------------------------------------------
-- Explicit grant matrix
-- ---------------------------------------------------------------------------

select ok(
  has_table_privilege('authenticated', 'public.departments', 'SELECT')
  and has_table_privilege('authenticated', 'public.academic_levels', 'SELECT')
  and has_table_privilege('authenticated', 'public.academic_periods', 'SELECT'),
  'authenticated can SELECT every reference domain'
);

select ok(
  not has_table_privilege('anon', 'public.departments', 'SELECT')
  and not has_table_privilege('anon', 'public.academic_levels', 'SELECT')
  and not has_table_privilege('anon', 'public.academic_periods', 'SELECT'),
  'anon has no reference-data SELECT grant'
);

select ok(
  not has_table_privilege('authenticated', 'public.departments', 'INSERT')
  and not has_table_privilege('authenticated', 'public.departments', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.departments', 'DELETE')
  and not has_table_privilege('authenticated', 'public.academic_levels', 'INSERT')
  and not has_table_privilege('authenticated', 'public.academic_levels', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.academic_levels', 'DELETE')
  and not has_table_privilege('authenticated', 'public.academic_periods', 'INSERT')
  and not has_table_privilege('authenticated', 'public.academic_periods', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.academic_periods', 'DELETE'),
  'authenticated has no reference-data mutation grants'
);

select ok(
  has_column_privilege(
    'authenticated', 'public.profiles', 'department_id', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.profiles', 'academic_level_id', 'UPDATE'
  )
  and has_column_privilege(
    'authenticated', 'public.profiles', 'academic_period_id', 'UPDATE'
  ),
  'authenticated can update exactly the three selection columns'
);

select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'id', 'UPDATE')
  and not has_column_privilege(
    'authenticated', 'public.profiles', 'role', 'UPDATE'
  )
  and not has_column_privilege(
    'authenticated', 'public.profiles', 'created_at', 'UPDATE'
  )
  and not has_column_privilege(
    'authenticated', 'public.profiles', 'updated_at', 'UPDATE'
  ),
  'identity, role and timestamps have no authenticated UPDATE grant'
);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'INSERT')
  and not has_table_privilege('authenticated', 'public.profiles', 'DELETE'),
  'authenticated still cannot insert or delete profiles'
);


reset role;

select * from finish();

rollback;
