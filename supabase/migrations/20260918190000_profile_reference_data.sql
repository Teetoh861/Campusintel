-- Phase B Slice 1 — platform-owned profile-selection reference data.
--
-- This is a forward-only replacement for the nullable legacy department,
-- level and semester columns created in Phase A. The reference rows below are
-- authoritative business data. Application code must read them from the
-- database rather than reproduce the catalogue in arrays or enums.

-- Validate the audited all-null legacy state before creating any new objects.
-- ADD CONSTRAINT validates existing rows while holding its DDL lock. Once
-- installed, this temporary CHECK also rejects privileged writes of any
-- non-null legacy value until the columns and constraint are dropped together.
-- This does not depend on the migration runner wrapping the whole file in a
-- transaction (local reset and migration up use different execution paths).
alter table public.profiles
  add constraint profiles_legacy_selection_empty_check
    check (num_nonnulls(department, level, semester) = 0);

-- ---------------------------------------------------------------------------
-- Independent reference domains
-- ---------------------------------------------------------------------------

create table public.departments (
  id uuid primary key,
  key text not null,
  display_name text not null,
  is_active boolean not null default true,
  sort_order integer not null,

  constraint departments_key_unique unique (key),
  constraint departments_sort_order_unique unique (sort_order),
  constraint departments_key_format
    check (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint departments_display_name_nonempty
    check (btrim(display_name) <> ''),
  constraint departments_sort_order_positive
    check (sort_order > 0)
);

create table public.academic_levels (
  id uuid primary key,
  key text not null,
  display_name text not null,
  is_active boolean not null default true,
  sort_order integer not null,

  constraint academic_levels_key_unique unique (key),
  constraint academic_levels_sort_order_unique unique (sort_order),
  constraint academic_levels_key_format
    check (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint academic_levels_display_name_nonempty
    check (btrim(display_name) <> ''),
  constraint academic_levels_sort_order_positive
    check (sort_order > 0)
);

create table public.academic_periods (
  id uuid primary key,
  key text not null,
  display_name text not null,
  is_active boolean not null default true,
  sort_order integer not null,

  constraint academic_periods_key_unique unique (key),
  constraint academic_periods_sort_order_unique unique (sort_order),
  constraint academic_periods_key_format
    check (key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint academic_periods_display_name_nonempty
    check (btrim(display_name) <> ''),
  constraint academic_periods_sort_order_positive
    check (sort_order > 0)
);

comment on table public.departments is
  'Platform-owned student department catalogue. Deactivate rows to remove '
  'them from new selections; do not delete referenced historical values.';
comment on table public.academic_levels is
  'Platform-owned academic-level catalogue, independent of departments.';
comment on table public.academic_periods is
  'Platform-owned academic-period catalogue, independent of levels.';

comment on column public.departments.key is
  'Immutable semantic machine key. Display-name changes must not change it.';
comment on column public.academic_levels.key is
  'Immutable semantic machine key. Display-name changes must not change it.';
comment on column public.academic_periods.key is
  'Immutable semantic machine key. Display-name changes must not change it.';

-- Fixed UUIDs make references identical in every environment. The keys make
-- migration review readable; profile relationships use only the UUIDs.
insert into public.departments (id, key, display_name, is_active, sort_order)
values
  ('10000000-0000-4000-8000-000000000001', 'accounting',
   'Accounting', true, 1),
  ('10000000-0000-4000-8000-000000000002', 'business-administration',
   'Business Administration', true, 2),
  ('10000000-0000-4000-8000-000000000003', 'actuarial-science',
   'Actuarial Science', true, 3),
  ('10000000-0000-4000-8000-000000000004', 'taxation',
   'Taxation', true, 4),
  ('10000000-0000-4000-8000-000000000005', 'insurance',
   'Insurance', true, 5),
  ('10000000-0000-4000-8000-000000000006', 'procurement',
   'Procurement', true, 6),
  ('10000000-0000-4000-8000-000000000007', 'ehrm',
   'EHRM', true, 7),
  ('10000000-0000-4000-8000-000000000008', 'finance',
   'Finance', true, 8);

insert into public.academic_levels
  (id, key, display_name, is_active, sort_order)
values
  ('20000000-0000-4000-8000-000000000001', '100-level',
   '100L', true, 1),
  ('20000000-0000-4000-8000-000000000002', '200-level',
   '200L', true, 2),
  ('20000000-0000-4000-8000-000000000003', '300-level',
   '300L', true, 3);

insert into public.academic_periods
  (id, key, display_name, is_active, sort_order)
values
  ('30000000-0000-4000-8000-000000000001', 'first-semester',
   'First Semester', true, 1),
  ('30000000-0000-4000-8000-000000000002', 'second-semester',
   'Second Semester', true, 2);

-- Reference data is readable by a signed-in student, including inactive rows
-- needed to describe a historical selection. Browser-facing roles never own
-- reference-data writes; future catalogue changes arrive through migrations.
alter table public.departments enable row level security;
alter table public.academic_levels enable row level security;
alter table public.academic_periods enable row level security;

revoke all on table public.departments from public, anon, authenticated;
revoke all on table public.academic_levels from public, anon, authenticated;
revoke all on table public.academic_periods from public, anon, authenticated;

grant select on table public.departments to authenticated;
grant select on table public.academic_levels to authenticated;
grant select on table public.academic_periods to authenticated;

create policy "Departments are readable by authenticated students"
  on public.departments
  for select
  to authenticated
  using (true);

create policy "Academic levels are readable by authenticated students"
  on public.academic_levels
  for select
  to authenticated
  using (true);

create policy "Academic periods are readable by authenticated students"
  on public.academic_periods
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- Profiles now reference the three independent domains
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column department_id uuid,
  add column academic_level_id uuid,
  add column academic_period_id uuid,
  add constraint profiles_department_id_fkey
    foreign key (department_id)
    references public.departments (id)
    on update restrict
    on delete restrict,
  add constraint profiles_academic_level_id_fkey
    foreign key (academic_level_id)
    references public.academic_levels (id)
    on update restrict
    on delete restrict,
  add constraint profiles_academic_period_id_fkey
    foreign key (academic_period_id)
    references public.academic_periods (id)
    on update restrict
    on delete restrict,
  add constraint profiles_selection_completeness_check
    check (
      num_nonnulls(
        department_id,
        academic_level_id,
        academic_period_id
      ) in (0, 3)
    );

comment on column public.profiles.department_id is
  'Stable department reference. Null only while profile selection is incomplete.';
comment on column public.profiles.academic_level_id is
  'Stable academic-level reference. Null only while profile selection is incomplete.';
comment on column public.profiles.academic_period_id is
  'Stable academic-period reference. Null only while profile selection is incomplete.';

alter table public.profiles
  drop constraint profiles_legacy_selection_empty_check,
  drop constraint profiles_semester_check,
  drop column department,
  drop column level,
  drop column semester;

-- Defensively remove any future table-wide UPDATE grant before adding the
-- exact Phase B capability. Students still cannot insert or delete profiles,
-- or update identity, role or timestamps.
revoke update on table public.profiles from public, anon, authenticated;
grant update (
  department_id,
  academic_level_id,
  academic_period_id
) on public.profiles to authenticated;

create policy "Profiles are updatable by their owner with active selection"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    and department_id is not null
    and academic_level_id is not null
    and academic_period_id is not null
    and exists (
      select 1
      from public.departments
      where departments.id = profiles.department_id
        and departments.is_active
    )
    and exists (
      select 1
      from public.academic_levels
      where academic_levels.id = profiles.academic_level_id
        and academic_levels.is_active
    )
    and exists (
      select 1
      from public.academic_periods
      where academic_periods.id = profiles.academic_period_id
        and academic_periods.is_active
    )
  );
