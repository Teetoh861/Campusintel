-- Master Course Catalog v1.1: the 22-page owner edition, pages 9-10 and 15-20.
begin;

select plan(16);

create temporary view v1_1_selection as
select departments.key as department_key, academic_levels.key as level_key,
       academic_periods.key as period_key, institutional_courses.course_code
from public.course_applicability
join public.institutional_courses
  on institutional_courses.id = course_applicability.institutional_course_id
join public.departments
  on departments.id = course_applicability.department_id
join public.academic_levels
  on academic_levels.id = course_applicability.academic_level_id
join public.academic_periods
  on academic_periods.id = course_applicability.academic_period_id;

select is(
  (select array_agg(course_code || '=' || display_title order by id)
   from public.institutional_courses
   where id between '50000000-0000-4000-8000-000000000102'
                and '50000000-0000-4000-8000-000000000149'),
  array[
    'LAG-PRM103=Introductory Accounting for Procurement',
    'LAG-PRM105=Introductory Economics for Procurement I',
    'LAG-PRM109=Principles of Marketing',
    'PRM101=Introduction to Procurement 1',
    'LAG-FRE137=French for Arts and Social Sciences I',
    'LAG-PRM107=Element of Management in Procurement Management',
    'LAG-PRM124=Introductory Economics for Procurement II',
    'PRM102=Introduction to Procurement II',
    'PRM104=Introduction to Procurement and Supply Environments',
    'LAG-PRM122=Procurement Mathematics II',
    'LAG-PRM126=Introduction to Statistical Technique',
    'SST102=Introduction to Social Standards Practice',
    'ENS104=Introduction to Environmental Sciences',
    'LAG-PRM211=Ethics of Microeconomics I',
    'LAG-PRM213=Introduction to Cost Accounting for Procurement',
    'LAG-PRM215=Ethics of Insurance',
    'LAG-PRM217=Procurement and Business Finance',
    'LAG-PRM219=Ethics of Macroeconomics I',
    'PRM201=Procurement Planning and Budgeting',
    'PRM203=Project and Quality Management in Procurement',
    'PRM205=Essentials of Supply Chain Management',
    'PRM207=Operations Management',
    'LAG-PRM226=Risk Management in Procurement',
    'LAG-PRM228=Nigerian Financial Regulations System in Procurement',
    'PRM202=Global Procurement Practices',
    'PRM204=Sustainable Procurement',
    'PRM206=Principles of Logistics Management',
    'PRM299=SIWES I',
    'LAG-PRM208=Fundamentals of Macroeconomics II',
    'LAG-PRM222=Quantitative Analysis in Procurement',
    'LAG-PRM224=Fundamentals of Microeconomics II',
    'ACS101=Introduction to Actuarial Science',
    'ACS102=Basic Mathematics for Actuarial Science',
    'ACS104=Elements of Actuarial Statistics',
    'ACS-CM201=Differential Calculus for Actuarial Science',
    'ACS-CM203=Mathematical Statistics for Actuarial Science',
    'ACS-CM205=Introductory Actuarial Finance',
    'ACS-CM207=Economics of Insurance',
    'LAG-ACS211=Pension Administration',
    'LAG-ACS213=Mathematics for Business',
    'ACS-CM202=Integral Calculus for Actuarial Science',
    'ACS-CM204=Probability Theory for Actuarial Science',
    'ACS-CM206=Mathematics of Demography',
    'BUA302=Human Behaviour in Organisations',
    'BUA319=E-Commerce',
    'BUA321=Business Start-Up',
    'BUA323=Supply Chain Management',
    'BUA325=Research Methodology for Business'
  ]::text[],
  'all 48 new institutional code/title identities preserve the owner source wording'
);

select is(
  (select array_agg(id::text order by id)
   from public.institutional_courses
   where id between '50000000-0000-4000-8000-000000000102'
                and '50000000-0000-4000-8000-000000000149'),
  (select array_agg('50000000-0000-4000-8000-' || lpad(n::text, 12, '0') order by n)
   from generate_series(102, 149) as n),
  'all 48 new institutional IDs are fixed and contiguous'
);

select is(
  (select count(*)::int from public.institutional_courses
   where id between '50000000-0000-4000-8000-000000000102'
                and '50000000-0000-4000-8000-000000000149'
     and (repository_course_id is not null or is_free)),
  0,
  'new catalogue rows neither infer content links nor free-tier status'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'procurement' and level_key = '100-level' and period_key = 'first-semester'),
  array['AMS101', 'AMS103', 'GST102', 'GST111', 'LAG-FRE137', 'LAG-PRM103',
        'LAG-PRM105', 'LAG-PRM107', 'LAG-PRM109', 'PRM101']::text[],
  'Procurement 100L First Semester includes source rows and faculty-wide GST102'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'procurement' and level_key = '100-level' and period_key = 'second-semester'),
  array['AMS102', 'AMS104', 'ENS104', 'GST112', 'LAG-PRM122', 'LAG-PRM124',
        'LAG-PRM126', 'PRM102', 'PRM104', 'SST102']::text[],
  'Procurement 100L Second Semester matches the owner source'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'procurement' and level_key = '200-level' and period_key = 'first-semester'),
  array['ENT211', 'LAG-PRM211', 'LAG-PRM213', 'LAG-PRM215', 'LAG-PRM217',
        'LAG-PRM219', 'PRM201', 'PRM203', 'PRM205', 'PRM207']::text[],
  'Procurement 200L First Semester matches the owner source'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'procurement' and level_key = '200-level' and period_key = 'second-semester'),
  array['GST212', 'LAG-PRM208', 'LAG-PRM222', 'LAG-PRM224', 'LAG-PRM226',
        'LAG-PRM228', 'PRM202', 'PRM204', 'PRM206', 'PRM299']::text[],
  'Procurement 200L Second Semester matches the owner source'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'actuarial-science' and level_key = '100-level' and period_key = 'first-semester'),
  array['ACC101', 'ACS101', 'AMS101', 'AMS103', 'ECO101', 'FIN101', 'GST102', 'GST111']::text[],
  'Actuarial 100L First Semester includes source rows and faculty-wide GST102'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'actuarial-science' and level_key = '100-level' and period_key = 'second-semester'),
  array['ACC121', 'ACS102', 'ACS104', 'AMS102', 'AMS104', 'FIN120', 'GST112', 'INS102']::text[],
  'Actuarial 100L Second Semester matches the owner source'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'actuarial-science' and level_key = '200-level' and period_key = 'first-semester'),
  array['ACS-CM201', 'ACS-CM203', 'ACS-CM205', 'ACS-CM207', 'ENT211',
        'LAG-ACS209', 'LAG-ACS211', 'LAG-ACS213']::text[],
  'Actuarial 200L First Semester retains separate ACS-CM207 identity'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'actuarial-science' and level_key = '200-level' and period_key = 'second-semester'),
  array['ACS-CM202', 'ACS-CM204', 'ACS-CM206', 'ACS-CM208', 'FIN216', 'GST212', 'LAG-ACS210']::text[],
  'Actuarial 200L Second Semester matches the owner source'
);

select is(
  (select array_agg(course_code order by course_code) from v1_1_selection
   where department_key = 'business-administration' and level_key = '300-level' and period_key = 'first-semester'),
  array['BUA302', 'BUA319', 'BUA321', 'BUA323', 'BUA325']::text[],
  'BUA 300L First Semester includes only the five confirmed rows'
);

select is(
  (select coalesce(array_agg(course_code), array[]::text[]) from v1_1_selection
   where department_key = 'business-administration' and level_key = '300-level' and period_key = 'second-semester'),
  array[]::text[],
  'BUA 300L Second Semester remains empty without a supplied list'
);

select is(
  (select count(*)::int from public.institutional_courses
   where course_code in ('BUA305', 'BUA313', 'FBA311', 'CIL318')),
  0,
  'the four expressly unconfirmed BUA 300L identities are absent'
);

select ok(
  (select count(*) = 2 and count(distinct id) = 2
          and bool_and(repository_course_id is null)
   from public.institutional_courses
   where course_code in ('ACS207', 'ACS-CM207'))
  and (select count(*) = 1 from v1_1_selection
       where department_key = 'insurance' and course_code = 'ACS207')
  and (select count(*) = 1 from v1_1_selection
       where department_key = 'actuarial-science' and course_code = 'ACS-CM207'),
  'Insurance ACS207 and Actuarial ACS-CM207 remain separate, unlinked identities'
);

select is(
  (select count(*)::int from v1_1_selection
   where department_key in ('accounting', 'business-administration', 'ehrm',
                            'finance', 'insurance', 'taxation')
     and level_key in ('100-level', '200-level')),
  188,
  'all six predecessor departments retain their 100L and 200L applicability'
);

select * from finish();
rollback;
