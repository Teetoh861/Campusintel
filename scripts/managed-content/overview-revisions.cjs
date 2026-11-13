// scripts/managed-content/overview-revisions.cjs — Approved course overview text, published as a new revision.
// Each edit names the seeded text it replaces, so the generator fails if the source ever differs from what was approved.
// The migration publishes the new revisions through the managed-content history and can roll them back.
const assert = require('node:assert/strict')

const OVERVIEW_MIGRATION = '20261110090000_course_overview_revisions.sql'
// A migration provenance marker, never an Auth account.
const OVERVIEW_ACTOR = '00000000-0000-4000-8000-000000000044'

const clone = value => JSON.parse(JSON.stringify(value))
/** Replace one exact string field. */
const replace = (key, from, to) => payload => {
  assert.equal(payload[key], from, `${key} is not the approved text`)
  payload[key] = to
}
/** Replace exact text inside a string field; it must occur exactly once. */
const edit = (key, from, to) => payload => {
  assert.equal(payload[key].split(from).length, 2, `${key} must contain "${from}" once`)
  payload[key] = payload[key].replace(from, to)
}
/** Drop a list; a list that is gone shows nothing, heading included. */
const remove = key => payload => {
  assert.ok(Array.isArray(payload[key]) && payload[key].length > 0, `${key} is not a list to remove`)
  delete payload[key]
}
/** Drop the exact lines given from a text list. */
const cut = (key, lines) => payload => {
  for (const line of lines) assert.equal(payload[key].filter(entry => entry === line).length, 1, `${key}: "${line}"`)
  payload[key] = payload[key].filter(entry => !lines.includes(entry))
}
/** Replace one exact line of a text list. */
const line = (key, from, to) => payload => {
  const index = payload[key].indexOf(from)
  assert.ok(index >= 0 && payload[key].lastIndexOf(from) === index, `${key}: "${from}"`)
  payload[key][index] = to
}
/** Replace one exact field of one record in a record list. */
const record = (key, field, from, to) => payload => {
  const matches = payload[key].filter(entry => entry[field] === from)
  assert.equal(matches.length, 1, `${key}.${field}: "${from}"`)
  matches[0][field] = to
}
/** Drop one record of a record list, found by an exact field. */
const drop = (key, field, value) => payload => {
  assert.equal(payload[key].filter(entry => entry[field] === value).length, 1, `${key}.${field}: "${value}"`)
  payload[key] = payload[key].filter(entry => entry[field] !== value)
}

/** 2026-11-10, owner-approved: course overview text the official banks made wrong, sourcing talk, stray fragments and
 *  typos. Keyed by repository slug. */
const OVERVIEW_EDITS = {
  // BUA216
  'introduction-financial-management': [
    edit('body', 'A quantitative course in financial decision-making built around a single problems-and-solutions workbook (Abass A. Shiro). The course progresses',
      'A quantitative course in financial decision-making. The course progresses'),
    edit('body', ' Two topics on the official course outline (market efficiency; pension funds, mutual funds, and the structure of the money management industry) are not covered in the prescribed workbook and appear to require separate lecture material.', ''),
    edit('body', ' Fin 101 introduction to finance.', ''),
    remove('topics'),
    line('examFocus',
      'Bond valuation with semi-annual coupons — the periodic discount rate must be halved (Kd ÷ 2) and the number of periods doubled (2n); watch for workbook solutions that inconsistently apply this',
      'Bond valuation with semi-annual coupons — the periodic discount rate must be halved (Kd ÷ 2) and the number of periods doubled (2n)'),
  ],
  // BUA204
  'quantitative-analysis-management': [
    drop('topics', 'description', 'Week 8: Exam Hotspots & Complete Formula Quick-Reference — Revision, Priority Topics, Master Formula Sheet'),
    cut('examFocus', [
      'Master the full Master Formula Sheet — revenue/cost/profit, descriptive statistics, probability and distributions, confidence intervals, correlation/regression, decision analysis, and LP formulas',
      "Apply the study guide's “Common Exam Question Approaches” step-by-step methods for break-even, hypothesis testing, test selection, regression interpretation, payoff tables, LP formulation, mean/SD calculation, and simultaneous equations",
    ]),
    line('examFocus',
      'Calculate TR, TC, Profit, BEQ, BER, and Target Profit Output; solve simultaneous equations for product-mix problems; apply FV = P(1+r)^n',
      'Calculate TR, TC, Profit, BEQ, BER, and Target Profit Output; solve simultaneous equations for product-mix problems; apply FV = P(1 + r)ⁿ'),
    line('examFocus',
      'Distinguish data analysis from data interpretation; interpret a regression equation (intercept, slope, R2) in plain business language',
      'Distinguish data analysis from data interpretation; interpret a regression equation (intercept, slope, R²) in plain business language'),
    // Naira amounts only: every "N" followed by a digit in these examples is money, never a variable.
    payload => {
      let count = 0
      for (const entry of payload.formulaSheet) {
        if (entry.example === undefined) continue
        entry.example = entry.example.replace(/\bN(?=\d)/g, () => { count += 1; return '₦' })
      }
      assert.equal(count, 17, 'naira amounts in the BUA204 formula examples')
    },
  ],
  // BUA202
  'principles-business-administration-2': [
    replace('body', 'BUA 202 is where Business Admin students stop looking at the org chart and start looking at the people and money that actually make it move. Half the course is about people — how to hire them, motivate them, manage change, and get groups working as teams — and half is about how a Nigerian business gets and manages its cash, from the CBN down to shares on the NGX. It\'s practical, Nigeria-focused, and heavy on named theories and models (Maslow, Herzberg, Lewin, Kotter) that lecturers love to test directly. Ethics closes the course out, tying people and money decisions back to responsible conduct. Builds on BUA 201.',
      'Covers how businesses manage people, change, decisions, communication and ethics, and how the Nigerian financial system and securities market fund them.'),
  ],
  // GST111
  'use-of-english': [
    replace('body', 'Communication skills course covering listening, phonetics, syllable structure, stress patterns, reading strategies, comprehension, and summary writing. A 100-level General Studies course required of all UNILAG students; Direct Entry students take it in 200 Level.',
      'Communication skills course covering listening, the sounds of English, stress and intonation, reading and comprehension, writing, grammar, vocabulary, and using the library and information sources.'),
    remove('topics'),
    remove('examFocus'),
  ],
  // BUA205
  'leadership-governance': [remove('topics')],
  // ENT211
  'entrepreneurship-innovation': [remove('topics')],
  // ACC-CM201
  'financial-accounting-1': [edit('body', 'property plant and equipment', 'property, plant and equipment')],
  // BUA218
  bua218: [
    record('topics', 'description', 'Green Operations and Supply Chain Management — not yet covered',
      'Green Operations and Supply Chain Management'),
    record('topics', 'description', 'Green Marketing and Corporate Social Responsibility — green marketing covered; Corporate Social Responsibility not yet covered',
      'Green Marketing and Corporate Social Responsibility'),
    record('topics', 'description', 'Implementing Green Initiatives — not yet covered', 'Implementing Green Initiatives'),
  ],
  'philosophy-logic-human-existence': [edit('body', ' None — compulsory General Studies course.', '')],
  'nigerian-peoples-and-culture': [
    edit('body', ' A 100-level course required of all UNILAG students; Direct Entry students take it in 200 Level.', ''),
  ],
  'consumer-behaviour': [
    record('topics', 'description', 'Types of Consumers and Buyer Behavior', 'Types of Consumers and Buyer Behaviour'),
    record('topics', 'description', 'Cultural and Social Influences on Consumer Behavior', 'Cultural and Social Influences on Consumer Behaviour'),
  ],
  // BUA201
  'principles-business-administration': [
    payload => {
      const matches = payload.keyTakeaways.filter(entry => entry.description.split('ethical codes like NIM.').length === 2)
      assert.equal(matches.length, 1, 'BUA201 NIM takeaway')
      matches[0].description = matches[0].description.replace('ethical codes like NIM.', "ethical codes like NIM's.")
    },
  ],
  // Exam focus lines that name nothing specific.
  'business-statistics': [cut('examFocus', ['Problem-solving with formulas', 'Interpretation of statistical results'])],
  'business-mathematics': [cut('examFocus', ['Complex problem-solving with multiple steps'])],
}

/** Every revised overview: its item, the published text it replaces and the text it publishes. */
function overviewRevisions(manifest) {
  const bySlug = new Map(manifest.courses.map(course => [course.slug, course.courseId]))
  return Object.entries(OVERVIEW_EDITS).map(([slug, edits]) => {
    const courseId = bySlug.get(slug)
    assert.ok(courseId, `${slug}: not a repository course`)
    const items = manifest.items.filter(item => item.courseId === courseId && item.kind === 'course_overview')
    assert.equal(items.length, 1, `${slug}: one overview`)
    const after = clone(items[0].payload)
    for (const apply of edits) apply(after)
    assert.notDeepEqual(after, items[0].payload, `${slug}: the revision changes nothing`)
    return { slug, itemId: items[0].itemId, before: items[0].payload, after }
  }).sort((left, right) => left.itemId < right.itemId ? -1 : 1)
}

/** The migration: one statement publishes every revision or none, and the same function rolls them back. */
/** A pending revision written by the given actor, with the published revision still approved: a study guide's overview
 *  revision left in the history when the guide rolled back (20261112110000_study_guide_notes.sql). */
const guidePending = actor => item => `(${item}.approved_revision = ${item}.published_revision and exists (select 1
          from public.managed_content_revisions g where g.item_id = ${item}.id and g.revision = ${item}.current_revision
          and g.authored_by = '${actor}'))`

/** The correction's two functions. With a guide actor, they are redefined so that a rolled-back study guide's pending
 *  overview revision is not taken for someone else's edit; nothing else differs. */
function overviewFunctionsSql(seedActor, revisions, guideActor = null) {
  const data = JSON.stringify({ actor: OVERVIEW_ACTOR, seedActor, items: revisions })
  assert.ok(!data.includes('$overview_source$'), 'overview text contains the SQL delimiter')
  const fn = 'private.course_overview_revisions'
  const create = guideActor ? 'create or replace function' : 'create function'
  const guide = guideActor ? guidePending(guideActor) : null
  return `-- Where one overview stands: 'before' (publishes the text this correction replaces), 'after' (publishes this
-- correction's revision) or 'other'. An unpublished edit by anyone else is 'other'.
${create} private.course_overview_revision_state(p_item uuid, p_before jsonb, p_after jsonb, p_actor uuid,
  p_seed_actor uuid)
returns text language sql stable security invoker set search_path = '' as $state$
  select case
    when i.id is null or i.kind <> 'course_overview' or i.created_by is distinct from p_seed_actor then 'other'
    when i.current_revision <> i.published_revision and not exists (select 1 from public.managed_content_revisions c
      where c.item_id = i.id and c.revision = i.current_revision and c.authored_by = p_actor and c.payload = p_after)${guide ? `
      and not ${guide('i')}` : ''}
      then 'other'
    when p.payload = p_before then 'before'
    when p.payload = p_after and p.authored_by = p_actor and ${guide ? `(i.current_revision = i.published_revision
      or ${guide('i')})` : 'i.current_revision = i.published_revision'} then 'after'
    else 'other' end
  from (select p_item id) wanted
  left join public.managed_content_items i on i.id = wanted.id
  left join public.managed_content_revisions p on p.item_id = i.id and p.revision = i.published_revision
$state$;

${create} ${fn}(p_action text)
returns text language plpgsql security invoker set search_path = '' as $overview_revisions$
declare
  v_data jsonb := $overview_source$${data}$overview_source$::jsonb;
  v_actor uuid := (v_data->>'actor')::uuid;
  v_seed_actor uuid := (v_data->>'seedActor')::uuid;
  v_from text;
  v_to text;
  v_stray text;
  v_row jsonb;
  v_item public.managed_content_items%rowtype;
  v_revision integer;
begin
  if p_action is null or p_action not in ('apply', 'rollback') then
    raise exception 'Course overviews: unknown action %', p_action;
  end if;
  v_from := case when p_action = 'apply' then 'before' else 'after' end;
  v_to := case when p_action = 'apply' then 'after' else 'before' end;
  -- Every overview, locked in one order before anything is read or written.
  perform 1 from public.managed_content_items
    where id in (select (value->>'itemId')::uuid from jsonb_array_elements(v_data->'items')) order by id for update;

  if not exists (select 1 from jsonb_array_elements(v_data->'items') r where private.course_overview_revision_state(
      (r.value->>'itemId')::uuid, r.value->'before', r.value->'after', v_actor, v_seed_actor) <> v_to) then
    return 'unchanged';
  end if;
  select r.value->>'slug' into v_stray from jsonb_array_elements(v_data->'items') r
    where private.course_overview_revision_state((r.value->>'itemId')::uuid, r.value->'before', r.value->'after',
      v_actor, v_seed_actor) <> v_from
    order by r.value->>'itemId' limit 1;
  if v_stray is not null then
    raise exception 'Course overview %: the published text is not the text this correction %', v_stray,
      case when p_action = 'apply' then 'replaces' else 'published' end;
  end if;

  for v_row in select value from jsonb_array_elements(v_data->'items') order by value->>'itemId' loop
    select * into v_item from public.managed_content_items where id = (v_row->>'itemId')::uuid;
    if p_action = 'apply' then
      -- The new text is the next revision, or the revision this correction already wrote before a rollback.
      select r.revision into v_revision from public.managed_content_revisions r
        where r.item_id = v_item.id and r.authored_by = v_actor and r.payload = v_row->'after'
        order by r.revision desc limit 1;
      if v_revision is null then
        perform private.assert_managed_payload('course_overview', v_row->'after');
        v_revision := v_item.current_revision + 1;
        insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
          values (v_item.id, v_revision, v_row->'after', v_actor);
        update public.managed_content_items set current_revision = v_revision, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
      if v_item.current_revision <> v_revision${guide ? ` and not (v_item.current_revision > v_revision
          and ${guide('v_item')})` : ''} then
        raise exception 'Course overview %: another revision is pending', v_row->>'slug';
      end if;
      if v_item.approved_revision is distinct from v_revision then
        insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
          values (v_item.id, v_revision, null, 'approved', v_actor, v_item.lock_version + 1);
        update public.managed_content_items set approved_revision = v_revision, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
    else
      -- The revision this correction's last publication replaced, which must still hold the text from before.
      select p.previous_revision into v_revision from public.managed_content_publications p
        where p.item_id = v_item.id and p.action = 'publish' and p.revision = v_item.published_revision
          and p.acted_by = v_actor
        order by p.lock_version desc limit 1;
      if v_revision is null or not exists (select 1 from public.managed_content_revisions r
          where r.item_id = v_item.id and r.revision = v_revision and r.payload = v_row->'before') then
        raise exception 'Course overview %: the text from before is not the revision it replaced', v_row->>'slug';
      end if;
      insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
        values (v_item.id, v_revision, null, 'approved', v_actor, v_item.lock_version + 1);
      update public.managed_content_items set approved_revision = v_revision, lock_version = lock_version + 1,
        updated_at = now() where id = v_item.id returning * into v_item;
    end if;
    insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision,
        previous_revision, previous_parent_revision, acted_by)
      values (v_item.id, v_item.lock_version + 1, 'publish', v_revision, null, v_item.published_revision, null, v_actor);
    update public.managed_content_items set published_revision = v_revision, lock_version = lock_version + 1,
      updated_at = now() where id = v_item.id;
  end loop;

  if exists (select 1 from jsonb_array_elements(v_data->'items') r where private.course_overview_revision_state(
      (r.value->>'itemId')::uuid, r.value->'before', r.value->'after', v_actor, v_seed_actor) <> v_to) then
    raise exception 'Course overviews: % did not publish the expected text', p_action;
  end if;
  return case when p_action = 'apply' then 'applied' else 'rolled-back' end;
end;
$overview_revisions$;

revoke all on function private.course_overview_revision_state(uuid, jsonb, jsonb, uuid, uuid), ${fn}(text)
  from public, anon, authenticated, service_role;
`
}

function overviewMigrationSql(seedActor, revisions) {
  const fn = 'private.course_overview_revisions'
  return `-- supabase/migrations/${OVERVIEW_MIGRATION}
-- GENERATED by scripts/managed-content/generate.cjs from scripts/managed-content/overview-revisions.cjs. Do not edit by hand.
-- Approved course overview text (2026-11-10) for ${revisions.length} courses: ${revisions.map(row => row.slug).join(', ')}.
-- ${fn}('apply') publishes each overview's new text as its next revision, reviewed and published through the
-- managed-content history, in one statement: every overview or none. It refuses, changing nothing, unless every
-- overview's published text is exactly the text it replaces with no other edit pending, and does nothing when every
-- overview already publishes the new text.
-- ${fn}('rollback') republishes the text each overview had before, through the same history; nothing is deleted.

${overviewFunctionsSql(seedActor, revisions)}select ${fn}('apply');
`
}

module.exports = { OVERVIEW_ACTOR, OVERVIEW_EDITS, OVERVIEW_MIGRATION, overviewFunctionsSql, overviewMigrationSql, overviewRevisions }
