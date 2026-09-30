-- Owner's Master Course Catalog v1.1 (the 22-page edition): Procurement and
-- Actuarial Science 100L/200L, plus confirmed BUA 300L First Semester.
-- Existing institutional IDs, faculty-wide GST, and content links are retained.
do $$
begin
  if (select count(*) from public.courses) <> 15
    or (select count(*) from public.institutional_courses) <> 101
    or (select count(*) from public.course_applicability) <> 196
    or (select count(*) from public.institutional_courses
        where repository_course_id is not null) <> 11 then
    raise exception 'Expected the committed institutional catalogue baseline';
  end if;
end
$$;

-- Fixed IDs continue after the predecessor's 001-101 range. Printed wording
-- is preserved, including unusual titles such as "Procurement 1" and "Ethics
-- of Microeconomics I". All new rows lack confirmed CampusIntell content.
insert into public.institutional_courses (
  id, course_code, display_title, repository_course_id, is_free
)
values
  -- Procurement: 31 new identities; five other non-GST codes already exist.
  ('50000000-0000-4000-8000-000000000102', 'LAG-PRM103', 'Introductory Accounting for Procurement', null, false),
  ('50000000-0000-4000-8000-000000000103', 'LAG-PRM105', 'Introductory Economics for Procurement I', null, false),
  ('50000000-0000-4000-8000-000000000104', 'LAG-PRM109', 'Principles of Marketing', null, false),
  ('50000000-0000-4000-8000-000000000105', 'PRM101', 'Introduction to Procurement 1', null, false),
  ('50000000-0000-4000-8000-000000000106', 'LAG-FRE137', 'French for Arts and Social Sciences I', null, false),
  ('50000000-0000-4000-8000-000000000107', 'LAG-PRM107', 'Element of Management in Procurement Management', null, false),
  ('50000000-0000-4000-8000-000000000108', 'LAG-PRM124', 'Introductory Economics for Procurement II', null, false),
  ('50000000-0000-4000-8000-000000000109', 'PRM102', 'Introduction to Procurement II', null, false),
  ('50000000-0000-4000-8000-000000000110', 'PRM104', 'Introduction to Procurement and Supply Environments', null, false),
  ('50000000-0000-4000-8000-000000000111', 'LAG-PRM122', 'Procurement Mathematics II', null, false),
  ('50000000-0000-4000-8000-000000000112', 'LAG-PRM126', 'Introduction to Statistical Technique', null, false),
  ('50000000-0000-4000-8000-000000000113', 'SST102', 'Introduction to Social Standards Practice', null, false),
  ('50000000-0000-4000-8000-000000000114', 'ENS104', 'Introduction to Environmental Sciences', null, false),
  ('50000000-0000-4000-8000-000000000115', 'LAG-PRM211', 'Ethics of Microeconomics I', null, false),
  ('50000000-0000-4000-8000-000000000116', 'LAG-PRM213', 'Introduction to Cost Accounting for Procurement', null, false),
  ('50000000-0000-4000-8000-000000000117', 'LAG-PRM215', 'Ethics of Insurance', null, false),
  ('50000000-0000-4000-8000-000000000118', 'LAG-PRM217', 'Procurement and Business Finance', null, false),
  ('50000000-0000-4000-8000-000000000119', 'LAG-PRM219', 'Ethics of Macroeconomics I', null, false),
  ('50000000-0000-4000-8000-000000000120', 'PRM201', 'Procurement Planning and Budgeting', null, false),
  ('50000000-0000-4000-8000-000000000121', 'PRM203', 'Project and Quality Management in Procurement', null, false),
  ('50000000-0000-4000-8000-000000000122', 'PRM205', 'Essentials of Supply Chain Management', null, false),
  ('50000000-0000-4000-8000-000000000123', 'PRM207', 'Operations Management', null, false),
  ('50000000-0000-4000-8000-000000000124', 'LAG-PRM226', 'Risk Management in Procurement', null, false),
  ('50000000-0000-4000-8000-000000000125', 'LAG-PRM228', 'Nigerian Financial Regulations System in Procurement', null, false),
  ('50000000-0000-4000-8000-000000000126', 'PRM202', 'Global Procurement Practices', null, false),
  ('50000000-0000-4000-8000-000000000127', 'PRM204', 'Sustainable Procurement', null, false),
  ('50000000-0000-4000-8000-000000000128', 'PRM206', 'Principles of Logistics Management', null, false),
  ('50000000-0000-4000-8000-000000000129', 'PRM299', 'SIWES I', null, false),
  ('50000000-0000-4000-8000-000000000130', 'LAG-PRM208', 'Fundamentals of Macroeconomics II', null, false),
  ('50000000-0000-4000-8000-000000000131', 'LAG-PRM222', 'Quantitative Analysis in Procurement', null, false),
  ('50000000-0000-4000-8000-000000000132', 'LAG-PRM224', 'Fundamentals of Microeconomics II', null, false),

  -- Actuarial Science: 12 new identities; 15 other non-GST codes already exist.
  ('50000000-0000-4000-8000-000000000133', 'ACS101', 'Introduction to Actuarial Science', null, false),
  ('50000000-0000-4000-8000-000000000134', 'ACS102', 'Basic Mathematics for Actuarial Science', null, false),
  ('50000000-0000-4000-8000-000000000135', 'ACS104', 'Elements of Actuarial Statistics', null, false),
  ('50000000-0000-4000-8000-000000000136', 'ACS-CM201', 'Differential Calculus for Actuarial Science', null, false),
  ('50000000-0000-4000-8000-000000000137', 'ACS-CM203', 'Mathematical Statistics for Actuarial Science', null, false),
  ('50000000-0000-4000-8000-000000000138', 'ACS-CM205', 'Introductory Actuarial Finance', null, false),
  ('50000000-0000-4000-8000-000000000139', 'ACS-CM207', 'Economics of Insurance', null, false),
  ('50000000-0000-4000-8000-000000000140', 'LAG-ACS211', 'Pension Administration', null, false),
  ('50000000-0000-4000-8000-000000000141', 'LAG-ACS213', 'Mathematics for Business', null, false),
  ('50000000-0000-4000-8000-000000000142', 'ACS-CM202', 'Integral Calculus for Actuarial Science', null, false),
  ('50000000-0000-4000-8000-000000000143', 'ACS-CM204', 'Probability Theory for Actuarial Science', null, false),
  ('50000000-0000-4000-8000-000000000144', 'ACS-CM206', 'Mathematics of Demography', null, false),

  -- Only the five confirmed BUA 300L First Semester rows are included.
  ('50000000-0000-4000-8000-000000000145', 'BUA302', 'Human Behaviour in Organisations', null, false),
  ('50000000-0000-4000-8000-000000000146', 'BUA319', 'E-Commerce', null, false),
  ('50000000-0000-4000-8000-000000000147', 'BUA321', 'Business Start-Up', null, false),
  ('50000000-0000-4000-8000-000000000148', 'BUA323', 'Supply Chain Management', null, false),
  ('50000000-0000-4000-8000-000000000149', 'BUA325', 'Research Methodology for Business', null, false);

-- The predecessor already supplies all four GST identities across all eight
-- departments, including GST102 where it is absent from printed sections.
-- Add 36 Procurement + 27 Actuarial non-GST rows and five BUA 300L rows.
-- Exact code/title pairs prevent similarly named unresolved aliases merging.
with source_applicability (
  course_code, display_title, department_key, academic_level_key, academic_period_key
) as (
  values
    -- Procurement: source rows 1-39, excluding printed GST111/112/212.
    ('AMS101', 'Principles of Management', 'procurement', '100-level', 'first-semester'),
    ('AMS103', 'Introduction to Computer', 'procurement', '100-level', 'first-semester'),
    ('LAG-PRM103', 'Introductory Accounting for Procurement', 'procurement', '100-level', 'first-semester'),
    ('LAG-PRM105', 'Introductory Economics for Procurement I', 'procurement', '100-level', 'first-semester'),
    ('LAG-PRM109', 'Principles of Marketing', 'procurement', '100-level', 'first-semester'),
    ('PRM101', 'Introduction to Procurement 1', 'procurement', '100-level', 'first-semester'),
    ('LAG-FRE137', 'French for Arts and Social Sciences I', 'procurement', '100-level', 'first-semester'),
    ('LAG-PRM107', 'Element of Management in Procurement Management', 'procurement', '100-level', 'first-semester'),
    ('AMS102', 'Basic Mathematics', 'procurement', '100-level', 'second-semester'),
    ('LAG-PRM124', 'Introductory Economics for Procurement II', 'procurement', '100-level', 'second-semester'),
    ('PRM102', 'Introduction to Procurement II', 'procurement', '100-level', 'second-semester'),
    ('PRM104', 'Introduction to Procurement and Supply Environments', 'procurement', '100-level', 'second-semester'),
    ('AMS104', 'Principles of Project Management', 'procurement', '100-level', 'second-semester'),
    ('LAG-PRM122', 'Procurement Mathematics II', 'procurement', '100-level', 'second-semester'),
    ('LAG-PRM126', 'Introduction to Statistical Technique', 'procurement', '100-level', 'second-semester'),
    ('SST102', 'Introduction to Social Standards Practice', 'procurement', '100-level', 'second-semester'),
    ('ENS104', 'Introduction to Environmental Sciences', 'procurement', '100-level', 'second-semester'),
    ('ENT211', 'Entrepreneurship and Innovation', 'procurement', '200-level', 'first-semester'),
    ('LAG-PRM211', 'Ethics of Microeconomics I', 'procurement', '200-level', 'first-semester'),
    ('LAG-PRM213', 'Introduction to Cost Accounting for Procurement', 'procurement', '200-level', 'first-semester'),
    ('LAG-PRM215', 'Ethics of Insurance', 'procurement', '200-level', 'first-semester'),
    ('LAG-PRM217', 'Procurement and Business Finance', 'procurement', '200-level', 'first-semester'),
    ('LAG-PRM219', 'Ethics of Macroeconomics I', 'procurement', '200-level', 'first-semester'),
    ('PRM201', 'Procurement Planning and Budgeting', 'procurement', '200-level', 'first-semester'),
    ('PRM203', 'Project and Quality Management in Procurement', 'procurement', '200-level', 'first-semester'),
    ('PRM205', 'Essentials of Supply Chain Management', 'procurement', '200-level', 'first-semester'),
    ('PRM207', 'Operations Management', 'procurement', '200-level', 'first-semester'),
    ('LAG-PRM226', 'Risk Management in Procurement', 'procurement', '200-level', 'second-semester'),
    ('LAG-PRM228', 'Nigerian Financial Regulations System in Procurement', 'procurement', '200-level', 'second-semester'),
    ('PRM202', 'Global Procurement Practices', 'procurement', '200-level', 'second-semester'),
    ('PRM204', 'Sustainable Procurement', 'procurement', '200-level', 'second-semester'),
    ('PRM206', 'Principles of Logistics Management', 'procurement', '200-level', 'second-semester'),
    ('PRM299', 'SIWES I', 'procurement', '200-level', 'second-semester'),
    ('LAG-PRM208', 'Fundamentals of Macroeconomics II', 'procurement', '200-level', 'second-semester'),
    ('LAG-PRM222', 'Quantitative Analysis in Procurement', 'procurement', '200-level', 'second-semester'),
    ('LAG-PRM224', 'Fundamentals of Microeconomics II', 'procurement', '200-level', 'second-semester'),

    -- Actuarial Science: source rows 1-30, excluding printed GST111/112/212.
    ('ACS101', 'Introduction to Actuarial Science', 'actuarial-science', '100-level', 'first-semester'),
    ('AMS101', 'Principles of Management', 'actuarial-science', '100-level', 'first-semester'),
    ('AMS103', 'Introduction to Computer', 'actuarial-science', '100-level', 'first-semester'),
    ('ACC101', 'Introduction to Financial Accounting I', 'actuarial-science', '100-level', 'first-semester'),
    ('ECO101', 'Principles of Economics I', 'actuarial-science', '100-level', 'first-semester'),
    ('FIN101', 'Introduction to Finance', 'actuarial-science', '100-level', 'first-semester'),
    ('ACS102', 'Basic Mathematics for Actuarial Science', 'actuarial-science', '100-level', 'second-semester'),
    ('ACS104', 'Elements of Actuarial Statistics', 'actuarial-science', '100-level', 'second-semester'),
    ('AMS102', 'Basic Mathematics', 'actuarial-science', '100-level', 'second-semester'),
    ('AMS104', 'Principles of Project Management', 'actuarial-science', '100-level', 'second-semester'),
    ('INS102', 'Principles and Practice of Insurance', 'actuarial-science', '100-level', 'second-semester'),
    ('FIN120', 'Intro. to Banking Method and Processes', 'actuarial-science', '100-level', 'second-semester'),
    ('ACC121', 'Introduction to Cost Accounting', 'actuarial-science', '100-level', 'second-semester'),
    ('ACS-CM201', 'Differential Calculus for Actuarial Science', 'actuarial-science', '200-level', 'first-semester'),
    ('ACS-CM203', 'Mathematical Statistics for Actuarial Science', 'actuarial-science', '200-level', 'first-semester'),
    ('ACS-CM205', 'Introductory Actuarial Finance', 'actuarial-science', '200-level', 'first-semester'),
    ('ACS-CM207', 'Economics of Insurance', 'actuarial-science', '200-level', 'first-semester'),
    ('ENT211', 'Entrepreneurship and Innovation', 'actuarial-science', '200-level', 'first-semester'),
    ('LAG-ACS209', 'Business Statistics I', 'actuarial-science', '200-level', 'first-semester'),
    ('LAG-ACS211', 'Pension Administration', 'actuarial-science', '200-level', 'first-semester'),
    ('LAG-ACS213', 'Mathematics for Business', 'actuarial-science', '200-level', 'first-semester'),
    ('ACS-CM202', 'Integral Calculus for Actuarial Science', 'actuarial-science', '200-level', 'second-semester'),
    ('ACS-CM204', 'Probability Theory for Actuarial Science', 'actuarial-science', '200-level', 'second-semester'),
    ('ACS-CM206', 'Mathematics of Demography', 'actuarial-science', '200-level', 'second-semester'),
    ('ACS-CM208', 'Risk Management', 'actuarial-science', '200-level', 'second-semester'),
    ('LAG-ACS210', 'Pension Law and Governance', 'actuarial-science', '200-level', 'second-semester'),
    ('FIN216', 'Fundamentals of Deposit Insurance', 'actuarial-science', '200-level', 'second-semester'),

    ('BUA302', 'Human Behaviour in Organisations', 'business-administration', '300-level', 'first-semester'),
    ('BUA319', 'E-Commerce', 'business-administration', '300-level', 'first-semester'),
    ('BUA321', 'Business Start-Up', 'business-administration', '300-level', 'first-semester'),
    ('BUA323', 'Supply Chain Management', 'business-administration', '300-level', 'first-semester'),
    ('BUA325', 'Research Methodology for Business', 'business-administration', '300-level', 'first-semester')
)
insert into public.course_applicability (
  institutional_course_id, department_id, academic_level_id, academic_period_id
)
select institutional_courses.id, departments.id, academic_levels.id, academic_periods.id
from source_applicability
join public.institutional_courses
  on institutional_courses.course_code = source_applicability.course_code
 and institutional_courses.display_title = source_applicability.display_title
join public.departments
  on departments.key = source_applicability.department_key
join public.academic_levels
  on academic_levels.key = source_applicability.academic_level_key
join public.academic_periods
  on academic_periods.key = source_applicability.academic_period_key;

-- Refuse a partial source transfer: missing code/title or dimension joins must
-- not quietly reduce the seeded catalogue. Preserve the eleven content links.
do $$
begin
  if (select count(*) from public.institutional_courses) <> 149
    or (select count(*) from public.course_applicability) <> 264
    or (select count(*) from public.institutional_courses
        where repository_course_id is not null) <> 11
    or (select count(*) from public.courses) <> 15 then
    raise exception 'Master Course Catalog v1.1 totals did not match';
  end if;
end
$$;
