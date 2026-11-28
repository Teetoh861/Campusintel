-- supabase/tests/course_overview_revisions.test.sql — The approved overview text (20261110090000) is published as each
-- overview's revision two through the managed-content history; a rerun changes nothing, an edited overview is refused
-- with nothing changed, and rollback brings back the text from before.
begin;
select no_plan();

-- The study guides imported after this correction publish later overview revisions (revision three on the five revised
-- overviews that have a guide), and the owner content rule (20261122120000) publishes the revision after that on twelve
-- overviews and unpublishes three. The rule, then the guides, are rolled back here, inside this test's transaction, so
-- the overviews stand as this correction left them.
select is(array[private.study_guide('study_guide_bua203', 'rollback'), private.study_guide('study_guide_lag_bua210', 'rollback'),
    private.official_bank_bua203('rollback'), private.official_bank_lag_bua210('rollback')],
  array_fill('rolled-back'::text, array[4]), 'the BUA203 and LAG-BUA210 copies (20261125100000) rolled back for this test');
select is(private.owner_content_rule('rollback'), 'rolled-back', 'the owner content rule (20261122120000) rolled back for this test');
select is(private.study_guide(guide, 'rollback'), 'rolled-back', format('%s rolled back for this test', guide))
  from private.study_guides where guide not in ('study_guide_bua203', 'study_guide_lag_bua210') order by guide;

create function pg_temp.overview(p_slug text) returns uuid language sql as $$
  select i.id from public.managed_content_items i join public.courses c on c.id = i.course_id
    where c.content_key = p_slug and i.kind = 'course_overview' $$;
create function pg_temp.published(p_slug text) returns jsonb language sql as $$
  select r.payload from public.managed_content_items i
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
    where i.id = pg_temp.overview(p_slug) $$;
-- Everything the correction could touch: every overview's pointers and lock, and the history rows.
create function pg_temp.state() returns jsonb language sql as $$
  select jsonb_build_object(
    'items', (select jsonb_agg(jsonb_build_array(id, current_revision, approved_revision, published_revision, lock_version)
      order by id) from public.managed_content_items where kind = 'course_overview'),
    'revisions', (select count(*) from public.managed_content_revisions),
    'reviews', (select count(*) from public.managed_content_reviews),
    'publications', (select count(*) from public.managed_content_publications)) $$;
-- A rolled-back later layer's overview revision stays the current revision, as the history keeps it; that is not a
-- draft. Five of the revised overviews have a guide: GST 111, ACC-CM201, BUA 201, BUA 205 and ENT 211; the guide wrote
-- their revision three and the owner content rule their revision four. The rule wrote revision three of six more:
-- GST 112, BUA 202, BUA 204, GST 212, BUA 216 and BUA 218.
create function pg_temp.current(p_slug text) returns integer language sql as $$
  select case when p_slug in ('use-of-english', 'financial-accounting-1', 'principles-business-administration',
    'leadership-governance', 'entrepreneurship-innovation') then 4
    when p_slug in ('nigerian-peoples-and-culture', 'principles-business-administration-2', 'quantitative-analysis-management',
      'philosophy-logic-human-existence', 'introduction-financial-management', 'bua218') then 3 else 2 end $$;
select is((select jsonb_build_array(i.current_revision, r.authored_by) from public.managed_content_items i
    join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.current_revision
    where i.id = pg_temp.overview('use-of-english')), '[4, "00000000-0000-4000-8000-000000000046"]'::jsonb,
  'GST111 keeps the rolled-back owner content rule revision as its current one');
select is((select authored_by from public.managed_content_revisions where item_id = pg_temp.overview('use-of-english')
    and revision = 3), '00000000-0000-4000-8000-000000000045'::uuid, 'with the rolled-back guide revision before it');
create temporary table revised (slug text primary key) on commit drop;
insert into revised values ('introduction-financial-management'), ('quantitative-analysis-management'),
  ('principles-business-administration-2'), ('use-of-english'), ('leadership-governance'), ('entrepreneurship-innovation'),
  ('financial-accounting-1'), ('bua218'), ('philosophy-logic-human-existence'), ('nigerian-peoples-and-culture'),
  ('consumer-behaviour'), ('principles-business-administration'), ('business-statistics'), ('business-mathematics');

-- ---------------------------------------------------------------------------
-- After the migrations: each revised overview publishes revision two, reviewed and published by the correction.
-- ---------------------------------------------------------------------------
select is((select count(*)::int from revised r join public.managed_content_items i on i.id = pg_temp.overview(r.slug)
    where i.current_revision = pg_temp.current(r.slug) and i.approved_revision = 2 and i.published_revision = 2), 14,
  'the 14 revised overviews publish revision two');
select is((select count(*)::int from public.managed_content_revisions where authored_by = '00000000-0000-4000-8000-000000000044'),
  14, 'one new revision each, written by the correction');
select is((select count(*)::int from revised r join public.managed_content_publications p on p.item_id = pg_temp.overview(r.slug)
    where p.action = 'publish' and p.revision = 2 and p.previous_revision = 1
      and p.acted_by = '00000000-0000-4000-8000-000000000044'), 14, 'each publication records the revision it replaced');
select is((select count(*)::int from revised r join public.managed_content_reviews v on v.item_id = pg_temp.overview(r.slug)
    where v.revision = 2 and v.decision = 'approved' and v.reviewed_by = '00000000-0000-4000-8000-000000000044'), 14,
  'each new revision is approved before it is published');
select is((select published_revision from public.managed_content_items
    where id = pg_temp.overview('international-organisational-behaviour')), 1, 'an overview with no change keeps revision one');

select is(pg_temp.published('introduction-financial-management')->>'body',
  'A quantitative course in financial decision-making. The course progresses from the time value of money through investment appraisal (with certainty, risk, rationing, inflation, and tax), the cost of capital and leverage, working capital management, portfolio theory, dividend policy, and financial statement analysis, before moving into capital market instruments — bond valuation and the Capital Asset Pricing Model.',
  'BUA216: no workbook, no coverage claim, no stray fragment');
select is((select count(*)::int from unnest(array['introduction-financial-management', 'use-of-english',
    'leadership-governance', 'entrepreneurship-innovation']) slug where pg_temp.published(slug) ? 'topics'), 0,
  'BUA216, GST111, BUA205 and ENT211 have no syllabus list of their own');
select ok(not pg_temp.published('use-of-english') ? 'examFocus', 'GST111 has no exam focus list');
select is(pg_temp.published('use-of-english')->>'body',
  'Communication skills course covering listening, the sounds of English, stress and intonation, reading and comprehension, writing, grammar, vocabulary, and using the library and information sources.',
  'GST111 body names its topics, with no applicability sentence');
select is(jsonb_array_length(pg_temp.published('quantitative-analysis-management')->'topics'), 7, 'BUA204 has no Week 8 row');
select is((select count(*)::int from jsonb_array_elements(pg_temp.published('quantitative-analysis-management')->'formulaSheet') f
    where f.value->>'example' ~ 'N[0-9]'), 0, 'BUA204 examples write naira with ₦');
select is((select jsonb_agg(f.value->'formula') from jsonb_array_elements(pg_temp.published('quantitative-analysis-management')->'formulaSheet') f),
  (select jsonb_agg(f.value->'formula') from jsonb_array_elements((select payload from public.managed_content_revisions
    where item_id = pg_temp.overview('quantitative-analysis-management') and revision = 1)->'formulaSheet') f),
  'no formula text changed');

select ok(not has_function_privilege(r, 'private.course_overview_revisions(text)', 'execute'),
    format('%s cannot run the correction', r))
  from unnest(array['anon', 'authenticated', 'service_role']) r;

-- ---------------------------------------------------------------------------
-- A rerun changes nothing.
-- ---------------------------------------------------------------------------
create temporary table applied on commit drop as select pg_temp.state() state;
select is(private.course_overview_revisions('apply'), 'unchanged', 'apply again: unchanged');
select is(pg_temp.state(), (select state from applied), 'the rerun changed nothing');

-- An overview edited after the correction is refused by rollback, with nothing changed.
savepoint edited_after;
-- Revision four: the owner content rule's rolled-back revision three is kept in the history.
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  select pg_temp.overview('introduction-financial-management'), 4,
    jsonb_set(pg_temp.published('introduction-financial-management'), '{body}', '"Operator draft"'),
    '11111111-1111-4111-8111-111111111111';
update public.managed_content_items set current_revision = 4, lock_version = lock_version + 1
  where id = pg_temp.overview('introduction-financial-management');
create temporary table edited on commit drop as select pg_temp.state() state;
select throws_ok($$select private.course_overview_revisions('rollback')$$, 'P0001',
  'Course overview introduction-financial-management: the published text is not the text this correction published',
  'rollback refuses an overview with a later edit');
select is(pg_temp.state(), (select state from edited), 'the refused rollback changed nothing');
rollback to savepoint edited_after;

-- ---------------------------------------------------------------------------
-- Rollback brings back the text from before, through the same history.
-- ---------------------------------------------------------------------------
select is(private.course_overview_revisions('rollback'), 'rolled-back', 'rollback runs');
select is((select count(*)::int from revised r join public.managed_content_items i on i.id = pg_temp.overview(r.slug)
    join public.managed_content_revisions v on v.item_id = i.id and v.revision = i.published_revision
    where i.published_revision = 1 and i.approved_revision = 1 and v.authored_by = '00000000-0000-4000-8000-000000000042'),
  14, 'every revised overview publishes its seeded revision one again');
select ok(pg_temp.published('introduction-financial-management')->>'body' like '%Fin 101 introduction to finance.',
  'BUA216 has its text from before');
select is(jsonb_array_length(pg_temp.published('use-of-english')->'topics'), 5, 'GST111 has its syllabus list again');
select is(private.course_overview_revisions('rollback'), 'unchanged', 'rollback again: unchanged');

-- ---------------------------------------------------------------------------
-- Apply refuses, changing nothing, when one overview no longer publishes the text it replaces.
-- ---------------------------------------------------------------------------
create temporary table rolled_back on commit drop as select pg_temp.state() state;

savepoint published_edit;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  select pg_temp.overview('quantitative-analysis-management'), 4,
    jsonb_set(pg_temp.published('quantitative-analysis-management'), '{body}', '"Operator text"'),
    '11111111-1111-4111-8111-111111111111';
update public.managed_content_items set current_revision = 4, approved_revision = 4, published_revision = 4,
  lock_version = lock_version + 3 where id = pg_temp.overview('quantitative-analysis-management');
create temporary table published_edit on commit drop as select pg_temp.state() state;
select throws_ok($$select private.course_overview_revisions('apply')$$, 'P0001',
  'Course overview quantitative-analysis-management: the published text is not the text this correction replaces',
  'apply refuses an overview whose published text was edited');
select is(pg_temp.state(), (select state from published_edit), 'the refused apply changed nothing');
select is(pg_temp.published('introduction-financial-management')->>'body' like '%Fin 101%', true,
  'no other overview was changed either');
rollback to savepoint published_edit;

savepoint draft_edit;
insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
  select pg_temp.overview('use-of-english'), 5, jsonb_set(pg_temp.published('use-of-english'), '{body}', '"Draft"'),
    '11111111-1111-4111-8111-111111111111';
update public.managed_content_items set current_revision = 5, lock_version = lock_version + 1
  where id = pg_temp.overview('use-of-english');
create temporary table draft_edit on commit drop as select pg_temp.state() state;
select throws_ok($$select private.course_overview_revisions('apply')$$, 'P0001',
  'Course overview use-of-english: the published text is not the text this correction replaces',
  'apply refuses an overview with an unpublished edit');
select is(pg_temp.state(), (select state from draft_edit), 'the refused apply changed nothing');
rollback to savepoint draft_edit;

select is(pg_temp.state(), (select state from rolled_back), 'back to the rolled-back state');

-- ---------------------------------------------------------------------------
-- Apply after a rollback publishes the same revision two again; no revision is written twice.
-- ---------------------------------------------------------------------------
select is(private.course_overview_revisions('apply'), 'applied', 'apply after rollback');
select is((select count(*)::int from public.managed_content_revisions where authored_by = '00000000-0000-4000-8000-000000000044'),
  14, 'the revisions are reused');
select is((select count(*)::int from revised r join public.managed_content_items i on i.id = pg_temp.overview(r.slug)
    where i.current_revision = pg_temp.current(r.slug) and i.approved_revision = 2 and i.published_revision = 2), 14,
  'the 14 overviews publish revision two again');
select is((select jsonb_object_agg(r.slug, pg_temp.published(r.slug)) from revised r),
  (select jsonb_object_agg(r.slug, v.payload) from revised r join public.managed_content_revisions v
    on v.item_id = pg_temp.overview(r.slug) and v.revision = 2), 'with the same text');

select * from finish();
rollback;
