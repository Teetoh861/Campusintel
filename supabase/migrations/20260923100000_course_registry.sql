-- Phase C Slice 1 — platform-owned course identity and explicit applicability.
--
-- Rich course content remains repository-owned. `content_key` is the immutable
-- bridge to that content and is deliberately independent of course URLs,
-- display titles, catalogue codes and legacy level/semester fields.

-- ---------------------------------------------------------------------------
-- Course registry
-- ---------------------------------------------------------------------------

create table public.courses (
  id uuid primary key,
  content_key text not null,
  is_shared boolean,
  is_free boolean not null,

  constraint courses_content_key_unique unique (content_key),
  constraint courses_content_key_format
    check (content_key ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);

comment on table public.courses is
  'Platform-owned identities for repository course content.';
comment on column public.courses.content_key is
  'Immutable repository content identity. It must not change with a route slug, title or course-code edit.';
comment on column public.courses.is_shared is
  'Editorial content classification independent of applicability: true is confirmed shared/general, false is confirmed department-specific, and null is unresolved.';
comment on column public.courses.is_free is
  'Product classification for the standing free tier. Independent of shared-course status and applicability.';

insert into public.courses (id, content_key, is_shared, is_free)
values
  ('40000000-0000-4000-8000-000000000001',
   'entrepreneurship-innovation', true, false),
  ('40000000-0000-4000-8000-000000000002',
   'principles-business-administration', false, false),
  ('40000000-0000-4000-8000-000000000003',
   'business-statistics', false, false),
  ('40000000-0000-4000-8000-000000000004',
   'leadership-governance', false, false),
  ('40000000-0000-4000-8000-000000000005',
   'business-mathematics', null, false),
  ('40000000-0000-4000-8000-000000000006',
   'consumer-behaviour', null, false),
  ('40000000-0000-4000-8000-000000000007',
   'financial-accounting-1', null, false),
  ('40000000-0000-4000-8000-000000000008',
   'use-of-english', true, true),
  ('40000000-0000-4000-8000-000000000009',
   'nigerian-peoples-and-culture', true, true),
  ('40000000-0000-4000-8000-000000000010',
   'international-organisational-behaviour', null, false),
  ('40000000-0000-4000-8000-000000000011',
   'principles-business-administration-2', false, false),
  ('40000000-0000-4000-8000-000000000012',
   'quantitative-analysis-management', false, false),
  ('40000000-0000-4000-8000-000000000013',
   'philosophy-logic-human-existence', true, true),
  ('40000000-0000-4000-8000-000000000014',
   'introduction-financial-management', true, false),
  ('40000000-0000-4000-8000-000000000015',
   'bua218', false, false);

-- ---------------------------------------------------------------------------
-- Exact Department + Level + Semester membership
-- ---------------------------------------------------------------------------

create table public.course_applicability (
  course_id uuid not null,
  department_id uuid not null,
  academic_level_id uuid not null,
  academic_period_id uuid not null,

  constraint course_applicability_pkey primary key (
    course_id,
    department_id,
    academic_level_id,
    academic_period_id
  ),
  constraint course_applicability_course_id_fkey
    foreign key (course_id)
    references public.courses (id)
    on update restrict
    on delete restrict,
  constraint course_applicability_department_id_fkey
    foreign key (department_id)
    references public.departments (id)
    on update restrict
    on delete restrict,
  constraint course_applicability_academic_level_id_fkey
    foreign key (academic_level_id)
    references public.academic_levels (id)
    on update restrict
    on delete restrict,
  constraint course_applicability_academic_period_id_fkey
    foreign key (academic_period_id)
    references public.academic_periods (id)
    on update restrict
    on delete restrict
);

comment on table public.course_applicability is
  'Explicit course membership for one Department + Level + Semester tuple. '
  'Absence is never inferred from course content.';

-- These are the 38 confirmed Master Course Catalog relationships only.
-- Unresolved code aliases and the uncertain BUA 200L GST112 row are omitted.
with approved_mappings (
  content_key,
  department_key,
  academic_level_key,
  academic_period_key
) as (
  values
    ('entrepreneurship-innovation', 'accounting', '200-level', 'first-semester'),
    ('entrepreneurship-innovation', 'taxation', '200-level', 'first-semester'),
    ('entrepreneurship-innovation', 'ehrm', '200-level', 'first-semester'),
    ('entrepreneurship-innovation', 'business-administration', '200-level', 'first-semester'),
    ('entrepreneurship-innovation', 'finance', '200-level', 'first-semester'),
    ('entrepreneurship-innovation', 'insurance', '200-level', 'first-semester'),

    ('principles-business-administration', 'business-administration', '200-level', 'first-semester'),
    ('business-statistics', 'business-administration', '200-level', 'first-semester'),
    ('leadership-governance', 'business-administration', '200-level', 'first-semester'),

    ('use-of-english', 'accounting', '100-level', 'first-semester'),
    ('use-of-english', 'business-administration', '100-level', 'first-semester'),
    ('use-of-english', 'actuarial-science', '100-level', 'first-semester'),
    ('use-of-english', 'taxation', '100-level', 'first-semester'),
    ('use-of-english', 'insurance', '100-level', 'first-semester'),
    ('use-of-english', 'procurement', '100-level', 'first-semester'),
    ('use-of-english', 'ehrm', '100-level', 'first-semester'),
    ('use-of-english', 'finance', '100-level', 'first-semester'),

    ('nigerian-peoples-and-culture', 'accounting', '100-level', 'second-semester'),
    ('nigerian-peoples-and-culture', 'business-administration', '100-level', 'second-semester'),
    ('nigerian-peoples-and-culture', 'actuarial-science', '100-level', 'second-semester'),
    ('nigerian-peoples-and-culture', 'taxation', '100-level', 'second-semester'),
    ('nigerian-peoples-and-culture', 'insurance', '100-level', 'second-semester'),
    ('nigerian-peoples-and-culture', 'procurement', '100-level', 'second-semester'),
    ('nigerian-peoples-and-culture', 'ehrm', '100-level', 'second-semester'),
    ('nigerian-peoples-and-culture', 'finance', '100-level', 'second-semester'),

    ('principles-business-administration-2', 'business-administration', '200-level', 'second-semester'),
    ('quantitative-analysis-management', 'business-administration', '200-level', 'second-semester'),

    ('philosophy-logic-human-existence', 'accounting', '200-level', 'second-semester'),
    ('philosophy-logic-human-existence', 'business-administration', '200-level', 'second-semester'),
    ('philosophy-logic-human-existence', 'actuarial-science', '200-level', 'second-semester'),
    ('philosophy-logic-human-existence', 'taxation', '200-level', 'second-semester'),
    ('philosophy-logic-human-existence', 'insurance', '200-level', 'second-semester'),
    ('philosophy-logic-human-existence', 'procurement', '200-level', 'second-semester'),
    ('philosophy-logic-human-existence', 'ehrm', '200-level', 'second-semester'),
    ('philosophy-logic-human-existence', 'finance', '200-level', 'second-semester'),

    ('introduction-financial-management', 'business-administration', '200-level', 'second-semester'),
    ('introduction-financial-management', 'insurance', '200-level', 'second-semester'),
    ('bua218', 'business-administration', '200-level', 'second-semester')
)
insert into public.course_applicability (
  course_id,
  department_id,
  academic_level_id,
  academic_period_id
)
select
  courses.id,
  departments.id,
  academic_levels.id,
  academic_periods.id
from approved_mappings
join public.courses
  on courses.content_key = approved_mappings.content_key
join public.departments
  on departments.key = approved_mappings.department_key
join public.academic_levels
  on academic_levels.key = approved_mappings.academic_level_key
join public.academic_periods
  on academic_periods.key = approved_mappings.academic_period_key;

-- ---------------------------------------------------------------------------
-- Platform-owned, authenticated-readable data
-- ---------------------------------------------------------------------------

alter table public.courses enable row level security;
alter table public.course_applicability enable row level security;

revoke all on table public.courses from public, anon, authenticated;
revoke all on table public.course_applicability from public, anon, authenticated;

grant select on table public.courses to authenticated;
grant select on table public.course_applicability to authenticated;

create policy "Courses are readable by authenticated students"
  on public.courses
  for select
  to authenticated
  using (true);

create policy "Course applicability is readable by authenticated students"
  on public.course_applicability
  for select
  to authenticated
  using (true);

-- Keep this guard last so any seed mismatch aborts the complete migration,
-- including its grants and policies. The upgrade harness forces this late
-- failure through the real Supabase migration boundary and verifies rollback.
do $$
begin
  if (select count(*) from public.courses) <> 15 then
    raise exception 'Expected exactly 15 seeded course identities';
  end if;

  if (select count(*) from public.course_applicability) <> 38 then
    raise exception 'Expected exactly 38 approved course applicability rows';
  end if;
end
$$;
