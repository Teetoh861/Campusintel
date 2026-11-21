-- Updated owner-approved CampusIntell Master Course Catalog, BUA rows 34-41.
-- BUA303 is Management Theory (3 units), a distinct identity from BUA302.
-- Units are source evidence only: the existing catalogue has no units column.
-- Retain old identities and all content/history; change only this offering.
do $$
declare
  v_department uuid;
  v_level uuid;
  v_period uuid;
  v_existing_ids uuid[];
  v_codes text[];
begin
  select id into strict v_department from public.departments
  where key = 'business-administration' and is_active;
  select id into strict v_level from public.academic_levels
  where key = '300-level' and is_active;
  select id into strict v_period from public.academic_periods
  where key = 'first-semester' and is_active;

  -- Refuse ambiguous or independently edited identities, rather than rename,
  -- merge, overwrite content links, or reinterpret a reserved UUID.
  if exists (
    select 1
    from (values
      ('50000000-0000-4000-8000-000000000145'::uuid, 'BUA302', 'Human Behaviour in Organisations'),
      ('50000000-0000-4000-8000-000000000146'::uuid, 'BUA319', 'E-Commerce'),
      ('50000000-0000-4000-8000-000000000147'::uuid, 'BUA321', 'Business Start-Up'),
      ('50000000-0000-4000-8000-000000000148'::uuid, 'BUA323', 'Supply Chain Management'),
      ('50000000-0000-4000-8000-000000000149'::uuid, 'BUA325', 'Research Methodology for Business')
    ) expected(id, code, title)
    left join public.institutional_courses actual on actual.id = expected.id
    where actual.course_code is distinct from expected.code
       or actual.display_title is distinct from expected.title
  ) then
    raise exception 'BUA 300L predecessor identities differ; review catalogue history before correction';
  end if;

  select array_agg(institutional_course_id order by institutional_course_id)
  into v_existing_ids
  from public.course_applicability
  where department_id = v_department and academic_level_id = v_level
    and academic_period_id = v_period;

  if v_existing_ids is distinct from array[
    '50000000-0000-4000-8000-000000000145',
    '50000000-0000-4000-8000-000000000146',
    '50000000-0000-4000-8000-000000000147',
    '50000000-0000-4000-8000-000000000148',
    '50000000-0000-4000-8000-000000000149'
  ]::uuid[] then
    raise exception 'Expected the five seeded BUA 300L First Semester mappings; review catalogue drift';
  end if;

  if exists (
    select 1 from public.institutional_courses
    where course_code in ('BUA303', 'BUA305', 'BUA313', 'BUS254', 'BUA310')
       or id between '50000000-0000-4000-8000-000000000150'
                 and '50000000-0000-4000-8000-000000000154'
  ) then
    raise exception 'New BUA 300L course code or reserved UUID already exists; resolve identity conflicts explicitly';
  end if;

  insert into public.institutional_courses (
    id, course_code, display_title, repository_course_id, is_free
  ) values
    ('50000000-0000-4000-8000-000000000150', 'BUA303', 'Management Theory', null, false),
    ('50000000-0000-4000-8000-000000000151', 'BUA305', 'Financial Management', null, false),
    ('50000000-0000-4000-8000-000000000152', 'BUA313', 'Innovation Management', null, false),
    ('50000000-0000-4000-8000-000000000153', 'BUS254', 'Principles of Marketing', null, false),
    ('50000000-0000-4000-8000-000000000154', 'BUA310', 'Production & Operation Management', null, false);

  -- Removing applicability leaves the historical BUA302/BUA325 identities,
  -- personal uploads/generations, and any later content links intact.
  delete from public.course_applicability
  where department_id = v_department and academic_level_id = v_level
    and academic_period_id = v_period
    and institutional_course_id in (
      '50000000-0000-4000-8000-000000000145',
      '50000000-0000-4000-8000-000000000149'
    );

  insert into public.course_applicability (
    institutional_course_id, department_id, academic_level_id, academic_period_id
  )
  select id, v_department, v_level, v_period
  from public.institutional_courses
  where id between '50000000-0000-4000-8000-000000000150'
               and '50000000-0000-4000-8000-000000000154';

  select array_agg(c.course_code order by c.course_code) into v_codes
  from public.course_applicability a
  join public.institutional_courses c on c.id = a.institutional_course_id
  where a.department_id = v_department and a.academic_level_id = v_level
    and a.academic_period_id = v_period;

  if v_codes is distinct from array[
    'BUA303', 'BUA305', 'BUA310', 'BUA313',
    'BUA319', 'BUA321', 'BUA323', 'BUS254'
  ]::text[] then
    raise exception 'BUA 300L First Semester correction did not produce exactly eight approved courses';
  end if;
end
$$;
