-- Updated owner-approved BUA 300L identities and narrowly scoped applicability.
begin;
select plan(7);

create temporary view bua_300l_offering as
select c.* from public.course_applicability a
join public.institutional_courses c on c.id = a.institutional_course_id
join public.departments d on d.id = a.department_id
join public.academic_levels l on l.id = a.academic_level_id
join public.academic_periods p on p.id = a.academic_period_id
where d.key = 'business-administration' and l.key = '300-level'
  and p.key = 'first-semester';

select is(
  (select array_agg(course_code || '=' || display_title order by course_code) from bua_300l_offering),
  array[
    'BUA303=Management Theory',
    'BUA305=Financial Management',
    'BUA310=Production & Operation Management',
    'BUA313=Innovation Management',
    'BUA319=E-Commerce',
    'BUA321=Business Start-Up',
    'BUA323=Supply Chain Management',
    'BUS254=Principles of Marketing'
  ]::text[],
  'exactly eight BUA 300L First Semester code/title pairs match the updated catalog'
);

select is(
  (select id::text from bua_300l_offering where course_code = 'BUA303'),
  '50000000-0000-4000-8000-000000000150',
  'BUA303 has a new institutional UUID distinct from historical BUA302'
);

select is(
  (select array_agg(id::text || '=' || course_code || '=' || display_title order by id)
   from public.institutional_courses
   where id in ('50000000-0000-4000-8000-000000000145', '50000000-0000-4000-8000-000000000149')),
  array[
    '50000000-0000-4000-8000-000000000145=BUA302=Human Behaviour in Organisations',
    '50000000-0000-4000-8000-000000000149=BUA325=Research Methodology for Business'
  ]::text[],
  'retired offering identities survive unchanged for historical foreign keys'
);

select is(
  (select array_agg(id::text || '=' || course_code order by id) from bua_300l_offering
   where course_code in ('BUA319', 'BUA321', 'BUA323')),
  array[
    '50000000-0000-4000-8000-000000000146=BUA319',
    '50000000-0000-4000-8000-000000000147=BUA321',
    '50000000-0000-4000-8000-000000000148=BUA323'
  ]::text[],
  'the three retained offerings keep their institutional identities'
);

select ok(
  (select count(*) = 5 and bool_and(repository_course_id is null and not is_free)
   from public.institutional_courses
   where course_code in ('BUA303', 'BUA305', 'BUA313', 'BUS254', 'BUA310')),
  'new identities inherit neither content links nor free-course status'
);

select is(
  (select count(*)::int from public.course_applicability a
   join public.institutional_courses c on c.id = a.institutional_course_id
   where c.course_code in ('BUA303', 'BUA305', 'BUA313', 'BUS254', 'BUA310')),
  5,
  'each new identity applies only to the approved BUA 300L First Semester offering'
);

select is(
  (select count(*)::int from public.institutional_courses where course_code in ('FBA311', 'CIL318')),
  0,
  'the correction does not introduce FBA311 or CIL318'
);

select * from finish();
rollback;
