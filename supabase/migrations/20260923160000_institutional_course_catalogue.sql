-- Phase C Slice 1 correction — separate institutional catalogue identity
-- from repository content identity.
--
-- The committed 20260923100000 migration is intentionally left immutable.
-- This forward migration upgrades both fresh databases and databases already
-- carrying that Slice 1 state.

-- Refuse to reinterpret a different predecessor state. These tables are
-- migration-owned and authenticated callers never had write access to them.
do $$
begin
  if (select count(*) from public.courses) <> 15 then
    raise exception 'Expected the committed 15-row repository course registry';
  end if;

  if (select count(*) from public.course_applicability) <> 38 then
    raise exception 'Expected the committed 38-row applicability seed';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'courses'
      and column_name = 'is_free'
  ) then
    raise exception 'Expected the committed repository is_free column';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Institutional course catalogue
-- ---------------------------------------------------------------------------

create table public.institutional_courses (
  id uuid primary key,
  course_code text not null,
  display_title text not null,
  repository_course_id uuid,
  is_free boolean not null,

  constraint institutional_courses_code_nonempty
    check (btrim(course_code) <> ''),
  constraint institutional_courses_title_nonempty
    check (btrim(display_title) <> ''),
  constraint institutional_courses_code_title_unique
    unique (course_code, display_title),
  constraint institutional_courses_repository_course_id_unique
    unique (repository_course_id),
  constraint institutional_courses_repository_course_id_fkey
    foreign key (repository_course_id)
    references public.courses (id)
    on update restrict
    on delete restrict
);

comment on table public.institutional_courses is
  'Source-backed institutional catalogue: what course exists, independently of whether CampusIntell has built content.';
comment on column public.institutional_courses.id is
  'Stable institutional course identity. Content links and applicability may change without changing this ID.';
comment on column public.institutional_courses.course_code is
  'Institutional code preserved exactly from the current catalogue evidence; unresolved aliases remain separate rows.';
comment on column public.institutional_courses.display_title is
  'Institutional title preserved exactly from the current catalogue evidence.';
comment on column public.institutional_courses.repository_course_id is
  'Optional, uniquely confirmed link to one repository content identity. Null means no confirmed content match.';
comment on column public.institutional_courses.is_free is
  'Independent product-access classification owned by the institutional course, including courses with no built content.';

-- Fixed IDs make institutional identity stable across environments. The 101
-- identities are the distinct exact code/title pairs printed in the six
-- documented 100L/200L department sections. Similar or flagged aliases are
-- deliberately not reconciled.
insert into public.institutional_courses (
  id,
  course_code,
  display_title,
  repository_course_id,
  is_free
)
values
  ('50000000-0000-4000-8000-000000000001', 'ACC101',
   'Introduction to Financial Accounting I', null, false),
  ('50000000-0000-4000-8000-000000000002', 'AMS101',
   'Principles of Management', null, false),
  ('50000000-0000-4000-8000-000000000003', 'AMS103',
   'Introduction to Computer', null, false),
  ('50000000-0000-4000-8000-000000000004', 'ECO101',
   'Principles of Economics I', null, false),
  ('50000000-0000-4000-8000-000000000005', 'GST111',
   'Communication in English',
   '40000000-0000-4000-8000-000000000008', true),
  ('50000000-0000-4000-8000-000000000006', 'SOC101',
   'Introduction to Sociology I', null, false),
  ('50000000-0000-4000-8000-000000000007', 'GST102',
   'Philosophy & Logic of Science', null, true),
  ('50000000-0000-4000-8000-000000000008', 'PSY-CM101',
   'Introduction to Psychology', null, false),
  ('50000000-0000-4000-8000-000000000009', 'ACC102',
   'Introduction to Financial Accounting II', null, false),
  ('50000000-0000-4000-8000-000000000010', 'AMS102',
   'Basic Mathematics', null, false),
  ('50000000-0000-4000-8000-000000000011', 'AMS104',
   'Principles of Project Management', null, false),
  ('50000000-0000-4000-8000-000000000012', 'ECO102',
   'Principles of Economics II', null, false),
  ('50000000-0000-4000-8000-000000000013', 'GST112',
   'Nigerian Peoples and Culture',
   '40000000-0000-4000-8000-000000000009', true),
  ('50000000-0000-4000-8000-000000000014', 'SOC106',
   'Introduction to Sociology II', null, false),
  ('50000000-0000-4000-8000-000000000015', 'LAG-PSY136',
   'Introduction to Psychology II', null, false),
  ('50000000-0000-4000-8000-000000000016', 'ACC-CM201',
   'Financial Accounting I', null, false),
  ('50000000-0000-4000-8000-000000000017', 'ACC-CM203',
   'Corporate Governance & Accounting Ethics', null, false),
  ('50000000-0000-4000-8000-000000000018', 'ECO201',
   'Introduction to Microeconomics', null, false),
  ('50000000-0000-4000-8000-000000000019', 'ENT211',
   'Entrepreneurship and Innovation',
   '40000000-0000-4000-8000-000000000001', false),
  ('50000000-0000-4000-8000-000000000020', 'LAG-ACS209',
   'Business Statistics I', null, false),
  ('50000000-0000-4000-8000-000000000021', 'TAX-CM313',
   'Business Law I (Mercantile Law)', null, false),
  ('50000000-0000-4000-8000-000000000022', 'FIN-CM101',
   'Introduction to Finance', null, false),
  ('50000000-0000-4000-8000-000000000023', 'ACC-CM202',
   'Financial Accounting II', null, false),
  ('50000000-0000-4000-8000-000000000024', 'ACC-CM204',
   'Cost Accounting', null, false),
  ('50000000-0000-4000-8000-000000000025', 'ACC-CM206',
   'Accounting Laboratory', null, false),
  ('50000000-0000-4000-8000-000000000026', 'ECO203',
   'Introduction to Macroeconomics', null, false),
  ('50000000-0000-4000-8000-000000000027', 'GST212',
   'Philosophy, Logic and Human Existence',
   '40000000-0000-4000-8000-000000000013', true),
  ('50000000-0000-4000-8000-000000000028', 'FIN-CM209',
   'Element of Banking', null, false),
  ('50000000-0000-4000-8000-000000000029', 'EHR208',
   'Human Resource Metrics & Analytics', null, false),
  ('50000000-0000-4000-8000-000000000030', 'PUL101',
   'Legal Methods I', null, false),
  ('50000000-0000-4000-8000-000000000031', 'LAG-TAX124',
   'Statistical Methods in Taxation', null, false),
  ('50000000-0000-4000-8000-000000000032', 'PUL102',
   'Legal Methods II', null, false),
  ('50000000-0000-4000-8000-000000000033', 'ECO205',
   'Structure of the Nigerian Economy', null, false),
  ('50000000-0000-4000-8000-000000000034', 'PUL-CM201',
   'Constitutional Law I', null, false),
  ('50000000-0000-4000-8000-000000000035', 'TAX-CM211',
   'Nigeria Legal System I', null, false),
  ('50000000-0000-4000-8000-000000000036', 'TAX-CM212',
   'Introduction to Taxation I', null, false),
  ('50000000-0000-4000-8000-000000000037', 'TAX-CM213',
   'Business Taxation I', null, false),
  ('50000000-0000-4000-8000-000000000038', 'LAG-TAX224',
   'Tax Software Application I', null, false),
  ('50000000-0000-4000-8000-000000000039', 'LAG-TAX225',
   'On-Job Training and Internship I', null, false),
  ('50000000-0000-4000-8000-000000000040', 'TAX-CM221',
   'Nigeria Legal System II', null, false),
  ('50000000-0000-4000-8000-000000000041', 'TAX-CM222',
   'Introduction to Taxation II', null, false),
  ('50000000-0000-4000-8000-000000000042', 'TAX-CM223',
   'Business Taxation II', null, false),
  ('50000000-0000-4000-8000-000000000043', 'BUA101',
   'Introduction to Business I', null, false),
  ('50000000-0000-4000-8000-000000000044', 'EHR101',
   'Introduction to Human Resource Management', null, false),
  ('50000000-0000-4000-8000-000000000045', 'LAG-EHR111',
   'Labour History', null, false),
  ('50000000-0000-4000-8000-000000000046', 'LAG-EHR113',
   'Principles of Economics', null, false),
  ('50000000-0000-4000-8000-000000000047', 'LAG-EHR121',
   'Elements of Labour-Management Relations', null, false),
  ('50000000-0000-4000-8000-000000000048', 'BUA102',
   'Introduction to Business II', null, false),
  ('50000000-0000-4000-8000-000000000049', 'EHR102',
   'Introduction to Employment Relations', null, false),
  ('50000000-0000-4000-8000-000000000050', 'INS102',
   'Principles and Practice of Insurance', null, false),
  ('50000000-0000-4000-8000-000000000051', 'LAG-EHR122',
   'Introduction to Sociology of Work and Organisations', null, false),
  ('50000000-0000-4000-8000-000000000052', 'EHR201',
   'Human Resource Planning & Administration', null, false),
  ('50000000-0000-4000-8000-000000000053', 'EHR203',
   'Trade Unions and Employers Associations', null, false),
  ('50000000-0000-4000-8000-000000000054', 'EHR205',
   'Industrial and Organisational Behaviour', null, false),
  ('50000000-0000-4000-8000-000000000055', 'EHR207',
   'Public Sector Human Resource Management', null, false),
  ('50000000-0000-4000-8000-000000000056', 'LAG-EHR210',
   'Foundation of Employment Relations', null, false),
  ('50000000-0000-4000-8000-000000000057', 'LAG-EHR213',
   'International Labour Institutions', null, false),
  ('50000000-0000-4000-8000-000000000058', 'LAG-EHR215',
   'Labour Administration & Inspection', null, false),
  ('50000000-0000-4000-8000-000000000059', 'EHR202',
   'Recruitment, Selection and Placement', null, false),
  ('50000000-0000-4000-8000-000000000060', 'EHR204',
   'Communication in Human Resource Management and Employment Relations',
   null, false),
  ('50000000-0000-4000-8000-000000000061', 'EHR206',
   'Occupational Safety and Health', null, false),
  ('50000000-0000-4000-8000-000000000062', 'LAG-EHR212',
   'Business Statistics', null, false),
  ('50000000-0000-4000-8000-000000000063', 'LAG-EHR222',
   'Elements of Human Relations in the Workplace', null, false),
  ('50000000-0000-4000-8000-000000000064', 'LAG-EHR224',
   'Foundation of HRM', null, false),
  ('50000000-0000-4000-8000-000000000065', 'FIN101',
   'Introduction to Finance', null, false),
  ('50000000-0000-4000-8000-000000000066', 'INS101',
   'Introduction to Insurance', null, false),
  ('50000000-0000-4000-8000-000000000067', 'LAG-BUA111',
   'Principles of Marketing', null, false),
  ('50000000-0000-4000-8000-000000000068', 'LAG-BUA123',
   'Marketing Communication', null, false),
  ('50000000-0000-4000-8000-000000000069', 'LAG-BUA125',
   'Managerial Economics', null, false),
  ('50000000-0000-4000-8000-000000000070', 'LAG-BUA122',
   'Introduction to Quality Control', null, false),
  ('50000000-0000-4000-8000-000000000071', 'LAG-BUA124',
   'Workplace Soft Skills', null, false),
  ('50000000-0000-4000-8000-000000000072', 'BUA201',
   'Principles of Business Administration I',
   '40000000-0000-4000-8000-000000000002', false),
  ('50000000-0000-4000-8000-000000000073', 'BUA203',
   'Business Statistics',
   '40000000-0000-4000-8000-000000000003', false),
  ('50000000-0000-4000-8000-000000000074', 'BUA205',
   'Leadership and Governance',
   '40000000-0000-4000-8000-000000000004', false),
  ('50000000-0000-4000-8000-000000000075', 'LAG-BUA210',
   'Business Mathematics', null, false),
  ('50000000-0000-4000-8000-000000000076', 'LAG-BUA221',
   'Consumer Behaviour', null, false),
  ('50000000-0000-4000-8000-000000000077', 'BUA202',
   'Principles of Business Administration II',
   '40000000-0000-4000-8000-000000000011', false),
  ('50000000-0000-4000-8000-000000000078', 'BUA204',
   'Quantitative Analysis in Management',
   '40000000-0000-4000-8000-000000000012', false),
  ('50000000-0000-4000-8000-000000000079', 'BUA216',
   'Introduction to Financial Management',
   '40000000-0000-4000-8000-000000000014', false),
  ('50000000-0000-4000-8000-000000000080', 'BUA218',
   'Green Management',
   '40000000-0000-4000-8000-000000000015', false),
  ('50000000-0000-4000-8000-000000000081', 'LAG-BUA222',
   'International Organizational Behaviour', null, false),
  ('50000000-0000-4000-8000-000000000082', 'FIN-CM215',
   'Applications of Computer in Finance', null, false),
  ('50000000-0000-4000-8000-000000000083', 'FIN-CM217',
   'Law of Banking', null, false),
  ('50000000-0000-4000-8000-000000000084', 'LAG-FIN203',
   'Financial Planning and Control', null, false),
  ('50000000-0000-4000-8000-000000000085', 'FIN-CM202',
   'Principles of Insurance', null, false),
  ('50000000-0000-4000-8000-000000000086', 'FIN-CM204',
   'Quantitative Analysis', null, false),
  ('50000000-0000-4000-8000-000000000087', 'FIN-CM210',
   'Banking Methods and Process', null, false),
  ('50000000-0000-4000-8000-000000000088', 'FIN216',
   'Fundamentals of Deposit Insurance', null, false),
  ('50000000-0000-4000-8000-000000000089', 'HER206',
   'Occupational Safety & Health', null, false),
  ('50000000-0000-4000-8000-000000000090', 'ACS-CM208',
   'Risk Management', null, false),
  ('50000000-0000-4000-8000-000000000091', 'BUS120',
   'Introduction to Management', null, false),
  ('50000000-0000-4000-8000-000000000092', 'FIN120',
   'Intro. to Banking Method and Processes', null, false),
  ('50000000-0000-4000-8000-000000000093', 'IRP121',
   'Element of Human Relations', null, false),
  ('50000000-0000-4000-8000-000000000094', 'ACC121',
   'Introduction to Cost Accounting', null, false),
  ('50000000-0000-4000-8000-000000000095', 'ACS207',
   'Economics of Insurance', null, false),
  ('50000000-0000-4000-8000-000000000096', 'INS-CM201',
   'Law of Tort', null, false),
  ('50000000-0000-4000-8000-000000000097', 'INS-CM203',
   'Life Assurance', null, false),
  ('50000000-0000-4000-8000-000000000098', 'INS-CM205',
   'Insurance Broking', null, false),
  ('50000000-0000-4000-8000-000000000099', 'INS-CM202',
   'Insurance Underwriting', null, false),
  ('50000000-0000-4000-8000-000000000100', 'INS-CM204',
   'Insurance Claims Management', null, false),
  ('50000000-0000-4000-8000-000000000101', 'LAG-ACS210',
   'Pension Law and Governance', null, false);

-- ---------------------------------------------------------------------------
-- Applicability now belongs to institutional identity
-- ---------------------------------------------------------------------------

-- Slice 1 seeded only relationships reachable through built content. Replace
-- that migration-owned seed, but retain the table, grants, RLS setting and
-- authenticated-read policy while changing the owned identity dimension.
truncate table public.course_applicability;

alter table public.course_applicability
  drop constraint course_applicability_pkey,
  drop constraint course_applicability_course_id_fkey;

alter table public.course_applicability
  rename column course_id to institutional_course_id;

alter table public.course_applicability
  add constraint course_applicability_pkey primary key (
    institutional_course_id,
    department_id,
    academic_level_id,
    academic_period_id
  ),
  add constraint course_applicability_institutional_course_id_fkey
    foreign key (institutional_course_id)
    references public.institutional_courses (id)
    on update restrict
    on delete restrict;

comment on table public.course_applicability is
  'Explicit institutional-course membership for one Department + Level + Semester tuple. Content availability is resolved separately through the optional catalogue link.';
comment on column public.course_applicability.institutional_course_id is
  'Stable institutional catalogue identity; never a repository content identity.';

-- The six printed department sections contain 184 rows. Twenty are GST rows:
-- 164 non-GST rows are preserved below exactly by department, level and
-- semester. The catalogue explicitly marks GST111, GST102, GST112 and GST212
-- as all-department courses, producing 4 * 8 = 32 faculty-wide tuples.
-- The separately printed BUA 200L GST112 row is explicitly uncertain
-- (retake or form error), so it is not confirmed applicability.
-- Total confirmed: 164 + 32 = 196.
with section_applicability (
  course_code,
  department_key,
  academic_level_key,
  academic_period_key
) as (
  values
    -- Accounting: 25 non-GST rows.
    ('ACC101', 'accounting', '100-level', 'first-semester'),
    ('AMS101', 'accounting', '100-level', 'first-semester'),
    ('AMS103', 'accounting', '100-level', 'first-semester'),
    ('ECO101', 'accounting', '100-level', 'first-semester'),
    ('SOC101', 'accounting', '100-level', 'first-semester'),
    ('PSY-CM101', 'accounting', '100-level', 'first-semester'),
    ('ACC102', 'accounting', '100-level', 'second-semester'),
    ('AMS102', 'accounting', '100-level', 'second-semester'),
    ('AMS104', 'accounting', '100-level', 'second-semester'),
    ('ECO102', 'accounting', '100-level', 'second-semester'),
    ('SOC106', 'accounting', '100-level', 'second-semester'),
    ('LAG-PSY136', 'accounting', '100-level', 'second-semester'),
    ('ACC-CM201', 'accounting', '200-level', 'first-semester'),
    ('ACC-CM203', 'accounting', '200-level', 'first-semester'),
    ('ECO201', 'accounting', '200-level', 'first-semester'),
    ('ENT211', 'accounting', '200-level', 'first-semester'),
    ('LAG-ACS209', 'accounting', '200-level', 'first-semester'),
    ('TAX-CM313', 'accounting', '200-level', 'first-semester'),
    ('FIN-CM101', 'accounting', '200-level', 'first-semester'),
    ('ACC-CM202', 'accounting', '200-level', 'second-semester'),
    ('ACC-CM204', 'accounting', '200-level', 'second-semester'),
    ('ACC-CM206', 'accounting', '200-level', 'second-semester'),
    ('ECO203', 'accounting', '200-level', 'second-semester'),
    ('FIN-CM209', 'accounting', '200-level', 'second-semester'),
    ('EHR208', 'accounting', '200-level', 'second-semester'),

    -- Taxation: 29 non-GST rows.
    ('ACC101', 'taxation', '100-level', 'first-semester'),
    ('AMS101', 'taxation', '100-level', 'first-semester'),
    ('AMS103', 'taxation', '100-level', 'first-semester'),
    ('ECO101', 'taxation', '100-level', 'first-semester'),
    ('PUL101', 'taxation', '100-level', 'first-semester'),
    ('SOC101', 'taxation', '100-level', 'first-semester'),
    ('ACC102', 'taxation', '100-level', 'second-semester'),
    ('AMS102', 'taxation', '100-level', 'second-semester'),
    ('AMS104', 'taxation', '100-level', 'second-semester'),
    ('ECO102', 'taxation', '100-level', 'second-semester'),
    ('LAG-TAX124', 'taxation', '100-level', 'second-semester'),
    ('PUL102', 'taxation', '100-level', 'second-semester'),
    ('SOC106', 'taxation', '100-level', 'second-semester'),
    ('ACC-CM201', 'taxation', '200-level', 'first-semester'),
    ('ECO201', 'taxation', '200-level', 'first-semester'),
    ('ECO205', 'taxation', '200-level', 'first-semester'),
    ('ENT211', 'taxation', '200-level', 'first-semester'),
    ('PUL-CM201', 'taxation', '200-level', 'first-semester'),
    ('TAX-CM211', 'taxation', '200-level', 'first-semester'),
    ('TAX-CM212', 'taxation', '200-level', 'first-semester'),
    ('TAX-CM213', 'taxation', '200-level', 'first-semester'),
    ('ACC-CM204', 'taxation', '200-level', 'second-semester'),
    ('ACC-CM202', 'taxation', '200-level', 'second-semester'),
    ('ECO203', 'taxation', '200-level', 'second-semester'),
    ('LAG-TAX224', 'taxation', '200-level', 'second-semester'),
    ('LAG-TAX225', 'taxation', '200-level', 'second-semester'),
    ('TAX-CM221', 'taxation', '200-level', 'second-semester'),
    ('TAX-CM222', 'taxation', '200-level', 'second-semester'),
    ('TAX-CM223', 'taxation', '200-level', 'second-semester'),

    -- EHRM: 28 non-GST rows.
    ('AMS101', 'ehrm', '100-level', 'first-semester'),
    ('AMS103', 'ehrm', '100-level', 'first-semester'),
    ('BUA101', 'ehrm', '100-level', 'first-semester'),
    ('EHR101', 'ehrm', '100-level', 'first-semester'),
    ('LAG-EHR111', 'ehrm', '100-level', 'first-semester'),
    ('LAG-EHR113', 'ehrm', '100-level', 'first-semester'),
    ('LAG-EHR121', 'ehrm', '100-level', 'first-semester'),
    ('AMS102', 'ehrm', '100-level', 'second-semester'),
    ('AMS104', 'ehrm', '100-level', 'second-semester'),
    ('BUA102', 'ehrm', '100-level', 'second-semester'),
    ('EHR102', 'ehrm', '100-level', 'second-semester'),
    ('INS102', 'ehrm', '100-level', 'second-semester'),
    ('LAG-EHR122', 'ehrm', '100-level', 'second-semester'),
    ('EHR201', 'ehrm', '200-level', 'first-semester'),
    ('EHR203', 'ehrm', '200-level', 'first-semester'),
    ('EHR205', 'ehrm', '200-level', 'first-semester'),
    ('EHR207', 'ehrm', '200-level', 'first-semester'),
    ('ENT211', 'ehrm', '200-level', 'first-semester'),
    ('LAG-EHR210', 'ehrm', '200-level', 'first-semester'),
    ('LAG-EHR213', 'ehrm', '200-level', 'first-semester'),
    ('LAG-EHR215', 'ehrm', '200-level', 'first-semester'),
    ('EHR202', 'ehrm', '200-level', 'second-semester'),
    ('EHR204', 'ehrm', '200-level', 'second-semester'),
    ('EHR206', 'ehrm', '200-level', 'second-semester'),
    ('EHR208', 'ehrm', '200-level', 'second-semester'),
    ('LAG-EHR212', 'ehrm', '200-level', 'second-semester'),
    ('LAG-EHR222', 'ehrm', '200-level', 'second-semester'),
    ('LAG-EHR224', 'ehrm', '200-level', 'second-semester'),

    -- Business Administration: 29 non-GST rows.
    ('AMS101', 'business-administration', '100-level', 'first-semester'),
    ('AMS103', 'business-administration', '100-level', 'first-semester'),
    ('BUA101', 'business-administration', '100-level', 'first-semester'),
    ('ECO101', 'business-administration', '100-level', 'first-semester'),
    ('FIN101', 'business-administration', '100-level', 'first-semester'),
    ('INS101', 'business-administration', '100-level', 'first-semester'),
    ('LAG-BUA111', 'business-administration', '100-level', 'first-semester'),
    ('LAG-BUA123', 'business-administration', '100-level', 'first-semester'),
    ('LAG-BUA125', 'business-administration', '100-level', 'first-semester'),
    ('AMS102', 'business-administration', '100-level', 'second-semester'),
    ('AMS104', 'business-administration', '100-level', 'second-semester'),
    ('BUA102', 'business-administration', '100-level', 'second-semester'),
    ('ECO102', 'business-administration', '100-level', 'second-semester'),
    ('INS102', 'business-administration', '100-level', 'second-semester'),
    ('LAG-BUA122', 'business-administration', '100-level', 'second-semester'),
    ('LAG-BUA124', 'business-administration', '100-level', 'second-semester'),
    ('ENT211', 'business-administration', '200-level', 'first-semester'),
    ('BUA201', 'business-administration', '200-level', 'first-semester'),
    ('BUA203', 'business-administration', '200-level', 'first-semester'),
    ('BUA205', 'business-administration', '200-level', 'first-semester'),
    ('LAG-BUA210', 'business-administration', '200-level', 'first-semester'),
    ('LAG-BUA221', 'business-administration', '200-level', 'first-semester'),
    ('ACC-CM201', 'business-administration', '200-level', 'first-semester'),
    ('ACC-CM204', 'business-administration', '200-level', 'second-semester'),
    ('BUA202', 'business-administration', '200-level', 'second-semester'),
    ('BUA204', 'business-administration', '200-level', 'second-semester'),
    ('BUA216', 'business-administration', '200-level', 'second-semester'),
    ('BUA218', 'business-administration', '200-level', 'second-semester'),
    ('LAG-BUA222', 'business-administration', '200-level', 'second-semester'),

    -- Finance: 27 non-GST rows.
    ('ACC101', 'finance', '100-level', 'first-semester'),
    ('AMS101', 'finance', '100-level', 'first-semester'),
    ('AMS103', 'finance', '100-level', 'first-semester'),
    ('ECO101', 'finance', '100-level', 'first-semester'),
    ('FIN101', 'finance', '100-level', 'first-semester'),
    ('INS101', 'finance', '100-level', 'first-semester'),
    ('EHR101', 'finance', '100-level', 'first-semester'),
    ('AMS102', 'finance', '100-level', 'second-semester'),
    ('AMS104', 'finance', '100-level', 'second-semester'),
    ('ECO102', 'finance', '100-level', 'second-semester'),
    ('INS102', 'finance', '100-level', 'second-semester'),
    ('ACC102', 'finance', '100-level', 'second-semester'),
    ('ECO201', 'finance', '200-level', 'first-semester'),
    ('ENT211', 'finance', '200-level', 'first-semester'),
    ('FIN-CM209', 'finance', '200-level', 'first-semester'),
    ('FIN-CM215', 'finance', '200-level', 'first-semester'),
    ('FIN-CM217', 'finance', '200-level', 'first-semester'),
    ('LAG-FIN203', 'finance', '200-level', 'first-semester'),
    ('LAG-ACS209', 'finance', '200-level', 'first-semester'),
    ('ECO203', 'finance', '200-level', 'first-semester'),
    ('ACC-CM204', 'finance', '200-level', 'second-semester'),
    ('FIN-CM202', 'finance', '200-level', 'second-semester'),
    ('FIN-CM204', 'finance', '200-level', 'second-semester'),
    ('FIN-CM210', 'finance', '200-level', 'second-semester'),
    ('FIN216', 'finance', '200-level', 'second-semester'),
    ('HER206', 'finance', '200-level', 'second-semester'),
    ('ACS-CM208', 'finance', '200-level', 'second-semester'),

    -- Insurance: 26 non-GST rows.
    ('AMS101', 'insurance', '100-level', 'first-semester'),
    ('AMS103', 'insurance', '100-level', 'first-semester'),
    ('FIN101', 'insurance', '100-level', 'first-semester'),
    ('INS101', 'insurance', '100-level', 'first-semester'),
    ('ACC101', 'insurance', '100-level', 'first-semester'),
    ('ECO101', 'insurance', '100-level', 'first-semester'),
    ('AMS102', 'insurance', '100-level', 'second-semester'),
    ('AMS104', 'insurance', '100-level', 'second-semester'),
    ('INS102', 'insurance', '100-level', 'second-semester'),
    ('BUS120', 'insurance', '100-level', 'second-semester'),
    ('FIN120', 'insurance', '100-level', 'second-semester'),
    ('IRP121', 'insurance', '100-level', 'second-semester'),
    ('ACC121', 'insurance', '100-level', 'second-semester'),
    ('ACS207', 'insurance', '200-level', 'first-semester'),
    ('ENT211', 'insurance', '200-level', 'first-semester'),
    ('INS-CM201', 'insurance', '200-level', 'first-semester'),
    ('INS-CM203', 'insurance', '200-level', 'first-semester'),
    ('INS-CM205', 'insurance', '200-level', 'first-semester'),
    ('LAG-ACS209', 'insurance', '200-level', 'first-semester'),
    ('FIN-CM209', 'insurance', '200-level', 'first-semester'),
    ('INS-CM202', 'insurance', '200-level', 'second-semester'),
    ('INS-CM204', 'insurance', '200-level', 'second-semester'),
    ('LAG-ACS210', 'insurance', '200-level', 'second-semester'),
    ('BUA216', 'insurance', '200-level', 'second-semester'),
    ('FIN216', 'insurance', '200-level', 'second-semester'),
    ('BUA102', 'insurance', '200-level', 'second-semester')
),
faculty_wide_gst (
  course_code,
  department_key,
  academic_level_key,
  academic_period_key
) as (
  select
    gst.course_code,
    departments.key,
    gst.academic_level_key,
    gst.academic_period_key
  from (
    values
      ('GST111', '100-level', 'first-semester'),
      ('GST102', '100-level', 'first-semester'),
      ('GST112', '100-level', 'second-semester'),
      ('GST212', '200-level', 'second-semester')
  ) as gst(course_code, academic_level_key, academic_period_key)
  cross join public.departments
),
approved_applicability as (
  select * from section_applicability
  union all
  select * from faculty_wide_gst
)
insert into public.course_applicability (
  institutional_course_id,
  department_id,
  academic_level_id,
  academic_period_id
)
select
  institutional_courses.id,
  departments.id,
  academic_levels.id,
  academic_periods.id
from approved_applicability
join public.institutional_courses
  on institutional_courses.course_code = approved_applicability.course_code
join public.departments
  on departments.key = approved_applicability.department_key
join public.academic_levels
  on academic_levels.key = approved_applicability.academic_level_key
join public.academic_periods
  on academic_periods.key = approved_applicability.academic_period_key;

-- `is_shared` remains editorial metadata of built repository content. Free
-- access is an institutional-course property, so it leaves the content table.
alter table public.courses
  drop column is_free;

comment on table public.courses is
  'Repository content registry: what CampusIntell has built. Institutional identity and applicability live separately.';
comment on column public.courses.is_shared is
  'Editorial classification of built content, independent of institutional applicability and free-tier status: true is confirmed shared/general, false is confirmed department-specific, and null is unresolved.';

-- ---------------------------------------------------------------------------
-- Platform-owned, authenticated-readable catalogue data
-- ---------------------------------------------------------------------------

alter table public.institutional_courses enable row level security;

revoke all on table public.institutional_courses
  from public, anon, authenticated;
grant select on table public.institutional_courses to authenticated;

create policy "Institutional courses are readable by authenticated students"
  on public.institutional_courses
  for select
  to authenticated
  using (true);

-- Keep the complete guard last. A mismatch rolls back catalogue creation,
-- applicability conversion, content-property relocation, grants and policy.
do $$
begin
  if (select count(*) from public.courses) <> 15 then
    raise exception 'Expected exactly 15 repository content identities';
  end if;

  if (select count(*) from public.institutional_courses) <> 101 then
    raise exception 'Expected exactly 101 institutional catalogue identities';
  end if;

  if (
    select count(*)
    from public.institutional_courses
    where repository_course_id is not null
  ) <> 11 then
    raise exception 'Expected exactly 11 confirmed repository content links';
  end if;

  if (select count(*) from public.course_applicability) <> 196 then
    raise exception 'Expected exactly 196 institutional applicability rows';
  end if;
end
$$;
