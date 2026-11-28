// scripts/managed-content/owner-rule.cjs — The owner's content rule (21 Nov 2026): a student sees only content that comes
// from the owner's files, which are the official question banks, the study guides and the handoff documents. This file
// carries out decisions A1, A5, A6, A7, A8, A9, A10, A11 and A13 (22 Nov 2026). It withdraws what came from elsewhere
// through the publish history, deleting nothing, and one call rolls all of it back: the theory questions and model
// answers the study guide imports published, the practice questions made before the official banks, the notes made with
// v0 for the first site, and the overview text that is not the owner's. owner-sources.cjs stops it coming back.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { publishedCbt } = require('./official-banks.cjs')
const { laterPending } = require('./overview-revisions.cjs')
const { EXAMINABLE_LINES, GUIDE_ACTOR, IMPORTS_MIGRATION, guidePublished } = require('./study-guides.cjs')

const OWNER_RULE_MIGRATION = '20261122120000_owner_content_rule.sql'
// A migration provenance marker, never an Auth account.
const OWNER_RULE_ACTOR = '00000000-0000-4000-8000-000000000046'
const RULE = 'owner_content_rule'
const MIGRATIONS = path.join(__dirname, '../../supabase/migrations')
const FAMILIES = ['course_overview', 'note', 'cbt_question', 'theory_question', 'model_answer', 'rubric']

// The courses with no official bank: every practice question they publish was made before the banks arrived.
const PRACTICE_RETIRED = ['business-statistics', 'business-mathematics', 'consumer-behaviour', 'nigerian-peoples-and-culture',
  'international-organisational-behaviour', 'philosophy-logic-human-existence', 'bua218']
// The notes made with v0 for the first site.
const NOTES_RETIRED = ['business-statistics', 'business-mathematics', 'consumer-behaviour']
// How many items the rule withdraws, by kind. The generator stops if the published content ever differs.
const RETIRED = { model_answer: 179, theory_question: 179, cbt_question: 1583, note: 27 }

// The 15 overviews the rule changes: what each publishes now (its revision, and its keys with each list's length), the
// MD5 of that payload as PostgreSQL prints it (the exact text this rule replaces), and its keys after. The title never
// changes. 'guide': the overview a study guide import creates, which is the guide's examinable line as its text, the
// course outcomes and the rest of how the course is assessed. 'examFocus': Exam focus goes; the paragraph and the
// syllabus list are from the owner's handoff document. 'withdraw': nothing from the owner's files is left, so the overview
// is unpublished.
const OVERVIEWS = [
  { slug: 'entrepreneurship-innovation', code: 'ENT211', change: 'guide', md5: '41cb91dd90a75a77b49fc2bf690ea1e6',
    now: [3, 'body, examFocus 6, outcomes 7, assessment 2'], after: 'body, outcomes 7, assessment 1' },
  { slug: 'principles-business-administration', code: 'BUA201', change: 'guide', md5: '4537fdc61ccbf496bacb5ab5ea44b14e',
    now: [3, 'body, topics 6, examFocus 10, keyTakeaways 7, outcomes 8, assessment 3'], after: 'body, outcomes 8, assessment 2' },
  { slug: 'leadership-governance', code: 'BUA205', change: 'guide', md5: '1c261f2dc19026cd4ddf8b4376cd05e6',
    now: [3, 'body, examFocus 6, outcomes 8, assessment 2'], after: 'body, outcomes 8, assessment 1' },
  { slug: 'financial-accounting-1', code: 'ACC-CM201', change: 'guide', md5: '4c471053db844d3e36b715ec865ba5bb',
    now: [3, 'body, topics 8, examFocus 8, outcomes 8, assessment 3'], after: 'body, outcomes 8, assessment 2' },
  { slug: 'use-of-english', code: 'GST111', change: 'guide', md5: '10b54af76dededdf65c590db50ed69ef',
    now: [3, 'body, outcomes 12, assessment 2'], after: 'body, outcomes 12, assessment 1' },
  { slug: 'nigerian-peoples-and-culture', code: 'GST112', change: 'examFocus', md5: '2ad148689b5361ab8324c49e95f97fb9',
    now: [2, 'body, topics 8, examFocus 8'], after: 'body, topics 8' },
  { slug: 'international-organisational-behaviour', code: 'BUA222', change: 'examFocus', md5: '368c5eec35dc7793dff7699700384fbd',
    now: [1, 'body, topics 14, examFocus 18'], after: 'body, topics 14' },
  { slug: 'principles-business-administration-2', code: 'BUA202', change: 'examFocus', md5: '1e751246be87e3703539b4203f05c006',
    now: [2, 'body, topics 10, examFocus 20'], after: 'body, topics 10' },
  { slug: 'quantitative-analysis-management', code: 'BUA204', change: 'examFocus', md5: '10bf2dd68de95dd8a285a9adbc5fb1b5',
    now: [2, 'body, topics 7, examFocus 10, formulaSheet 21'], after: 'body, topics 7, formulaSheet 21' },
  { slug: 'philosophy-logic-human-existence', code: 'GST212', change: 'examFocus', md5: '12b94a395a960defc7e3154eb35d9dd8',
    now: [2, 'body, topics 15, examFocus 15'], after: 'body, topics 15' },
  { slug: 'introduction-financial-management', code: 'BUA216', change: 'examFocus', md5: '573dae829fbbf497e614436902751db5',
    now: [2, 'body, examFocus 17'], after: 'body' },
  { slug: 'bua218', code: 'BUA218', change: 'examFocus', md5: '12763f84e34b35caff0be1f87886e09b',
    now: [2, 'body, topics 7, examFocus 18'], after: 'body, topics 7' },
  { slug: 'business-statistics', code: 'BUA203', change: 'withdraw', md5: '0cc705a994c6486018ccd51117c5192e',
    now: [2, 'body, topics 5, examFocus 4'] },
  { slug: 'business-mathematics', code: 'LAG-BUA210', change: 'withdraw', md5: '7ebe4ad994875885fbe5dcddba675e55',
    now: [2, 'body, topics 5, examFocus 5'] },
  { slug: 'consumer-behaviour', code: 'BUA221', change: 'withdraw', md5: 'e7ccff3ccb47aad7671a5f8354d85906',
    now: [2, 'body, topics 5, examFocus 6'] },
]

/** JSON text as PostgreSQL prints jsonb: object keys shortest first, then by their UTF-8 bytes, a space after each colon
 *  and comma. Its MD5 is what md5(payload::text) gives on a database. */
function jsonbText(value) {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort((left, right) => {
      const a = Buffer.from(left), b = Buffer.from(right)
      return a.length - b.length || Buffer.compare(a, b)
    })
    return `{${keys.map(key => `${JSON.stringify(key)}: ${jsonbText(value[key])}`).join(', ')}}`
  }
  assert.ok(value === null || ['string', 'boolean'].includes(typeof value) || Number.isSafeInteger(value), 'a plain JSON value')
  return JSON.stringify(value)
}
const md5 = text => crypto.createHash('md5').update(text, 'utf8').digest('hex')
const jsonbMd5 = value => md5(jsonbText(value))

/** An overview's keys after the title, each list with its length: "body, topics 5, examFocus 4". */
const keySummary = payload => Object.entries(payload).filter(([key]) => key !== 'title')
  .map(([key, value]) => Array.isArray(value) ? `${key} ${value.length}` : key).join(', ')

const bySourceKey = (left, right) => left.sourceKey < right.sourceKey ? -1 : left.sourceKey > right.sourceKey ? 1 : 0

/** What every course publishes after the migrations before this rule, as the parity test compared it: the seed, each
 *  official bank in place of its course's seeded questions, the revised overviews and the study guides. The registry
 *  lists the repository courses, then those created for a bank, then those created for a guide. */
function publishedBefore(manifest, bankPlans, revisions, guides) {
  const imported = new Map(bankPlans.map(plan => [plan.courseId, plan]))
  const revised = new Map(revisions.map(row => [row.itemId, row]))
  const guide = guidePublished(guides)
  const snapshot = item => ({ itemId: item.itemId, courseId: item.courseId, kind: item.kind, questionId: item.questionId,
    sourceKey: item.sourceKey, parentItemId: item.parentItemId, revision: 1, payload: item.payload })
  const published = item => guide.overviews.has(item.itemId)
    ? { ...snapshot(item), ...guide.overviews.get(item.itemId) }
    : revised.has(item.itemId) ? { ...snapshot(item), revision: 2, payload: revised.get(item.itemId).after } : snapshot(item)
  const registry = [...manifest.courses, ...bankPlans.filter(plan => plan.shell)
    .map(plan => ({ contentKey: plan.slug, slug: plan.slug, courseId: plan.courseId, created: plan })), ...guide.courses]
  const courses = registry.map(course => ({ ...course, bank: imported.has(course.courseId), kinds: Object.fromEntries(
    FAMILIES.map(family => {
      const bank = family === 'cbt_question' ? imported.get(course.courseId) : undefined
      // A note or theory item a guide replaced is unpublished, so it is not in the published set.
      return [family, (bank ? publishedCbt(bank) : [...manifest.items.filter(item => item.courseId === course.courseId
        && item.kind === family && !guide.retired.has(item.itemId)).map(published),
      ...guide.items.filter(item => item.courseId === course.courseId && item.kind === family)]).sort(bySourceKey)]
    })) }))
  return { registry, courses, guideRetired: guide.retired }
}

/** The overview a guide import creates, from the one a first-site course publishes today: the one line of how the
 *  course is assessed that is a guide's examinable line becomes the text, and the other lines stay under it. */
function guideOverview(before, code) {
  const lines = before.assessment.filter(line => EXAMINABLE_LINES.includes(line))
  assert.equal(lines.length, 1, `${code}: exactly one examinable line in how the course is assessed`)
  const assessment = before.assessment.filter(line => line !== lines[0])
  assert.ok(assessment.length > 0 && before.outcomes.length > 0, `${code}: outcomes and how the course is assessed`)
  return { title: before.title, body: lines[0], outcomes: before.outcomes, assessment }
}

/** What the rule withdraws and changes, checked against what the courses publish before it. Each group is one course
 *  and kind, every item of which the rule unpublishes: a course's model answers come before its theory questions, so
 *  apply unpublishes answers first and rollback, walking the groups backwards, republishes questions first. */
function ownerRulePlan(before, guides) {
  const bySlug = new Map(before.courses.map(course => [course.slug, course]))
  const course = slug => {
    assert.ok(bySlug.has(slug), `${slug}: not a course`)
    return bySlug.get(slug)
  }
  const entry = (record, parent = null) => {
    // Every item the rule withdraws is published at revision one, and an answer is bound to its question's revision.
    assert.ok(record.revision === 1 && (parent === null || parent.revision === 1), `${record.sourceKey}: revision one`)
    return { itemId: record.itemId, revision: record.revision, parentRevision: parent === null ? null : parent.revision }
  }
  const group = (row, kind, items) => ({ courseId: row.courseId, slug: row.slug, kind, items })
  const groups = []
  // Every theory question and model answer a guide import published; no other theory item is published anywhere.
  const guideByCourse = new Map(guides.map(plan => [plan.courseId, plan]))
  for (const row of before.courses) {
    const { theory_question: questions, model_answer: answers, rubric: rubrics } = row.kinds
    const plan = guideByCourse.get(row.courseId)
    assert.equal(rubrics.length, 0, `${row.slug}: a published rubric`)
    if (!plan) {
      assert.equal(questions.length + answers.length, 0, `${row.slug}: theory that no study guide published`)
      continue
    }
    const ids = records => records.map(record => record.itemId).sort()
    assert.deepEqual(ids(questions), plan.theory.map(question => question.itemId).sort(), `${plan.code}: the guide's theory questions`)
    assert.deepEqual(ids(answers), plan.theory.map(question => question.answer.itemId).sort(), `${plan.code}: the guide's answers`)
    const question = new Map(questions.map(record => [record.itemId, record]))
    assert.ok([...questions, ...answers].every(record => /^guide-(theory|answer):\d+$/.test(record.sourceKey)), `${plan.code}: guide theory`)
    groups.push(group(row, 'model_answer', answers.map(record => entry(record, question.get(record.parentItemId)))),
      group(row, 'theory_question', questions.map(record => entry(record))))
  }
  // Every practice question on the courses with no official bank.
  assert.deepEqual(before.courses.filter(row => !row.bank && row.kinds.cbt_question.length).map(row => row.slug).sort(),
    [...PRACTICE_RETIRED].sort(), 'the courses with no official bank that publish practice questions')
  for (const slug of PRACTICE_RETIRED) {
    const records = course(slug).kinds.cbt_question
    assert.ok(records.every(record => /^quiz:\d+$/.test(record.sourceKey)), `${slug}: seeded practice questions only`)
    groups.push(group(course(slug), 'cbt_question', records.map(record => entry(record))))
  }
  // Every note that is not a study guide's.
  assert.deepEqual(before.courses.filter(row => row.kinds.note.some(record => record.payload.noteType !== 'guide_topic'))
    .map(row => row.slug).sort(), [...NOTES_RETIRED].sort(), 'the courses that publish notes no study guide wrote')
  for (const slug of NOTES_RETIRED) {
    const records = course(slug).kinds.note
    assert.ok(records.every(record => /^topic-note:\d+$/.test(record.sourceKey)), `${slug}: seeded topic notes only`)
    groups.push(group(course(slug), 'note', records.map(record => entry(record))))
  }
  for (const [kind, count] of Object.entries(RETIRED)) {
    assert.equal(groups.filter(row => row.kind === kind).reduce((sum, row) => sum + row.items.length, 0), count,
      `the rule withdraws ${count} ${kind} items`)
  }
  assert.ok(groups.every(row => row.items.length > 0), 'every group withdraws something')

  const overviews = OVERVIEWS.map(spec => {
    const row = course(spec.slug)
    assert.equal(row.kinds.course_overview.length, 1, `${spec.code}: one published overview`)
    const [record] = row.kinds.course_overview
    assert.deepEqual([record.revision, keySummary(record.payload)], spec.now, `${spec.code}: what the overview publishes now`)
    assert.equal(jsonbMd5(record.payload), spec.md5, `${spec.code}: the published overview is not the text this rule replaces`)
    const base = { slug: spec.slug, code: spec.code, courseId: row.courseId, itemId: record.itemId, beforeRevision: record.revision,
      before: record.payload }
    if (spec.change === 'withdraw') return base
    assert.ok(['guide', 'examFocus'].includes(spec.change), `${spec.code}: change`)
    let after
    if (spec.change === 'guide') {
      assert.ok(guideByCourse.has(row.courseId), `${spec.code}: a course with a study guide`)
      after = guideOverview(record.payload, spec.code)
    } else {
      assert.ok(Array.isArray(record.payload.examFocus) && record.payload.examFocus.length > 0, `${spec.code}: Exam focus`)
      after = Object.fromEntries(Object.entries(record.payload).filter(([key]) => key !== 'examFocus'))
    }
    assert.equal(keySummary(after), spec.after, `${spec.code}: what the overview publishes after`)
    assert.equal(after.title, record.payload.title, `${spec.code}: the title never changes`)
    return { ...base, revision: record.revision + 1, after }
  })
  assert.equal(new Set(overviews.map(row => row.itemId)).size, OVERVIEWS.length, 'one change per overview')
  return { groups, overviews }
}

/** What every course publishes after every migration: the earlier layers' content with this rule applied. */
function publishedAfter(before, plan) {
  const retired = new Set(plan.groups.flatMap(row => row.items.map(item => item.itemId)))
  const overviews = new Map(plan.overviews.map(row => [row.itemId, row]))
  return { ...before, courses: before.courses.map(course => ({ ...course, kinds: Object.fromEntries(
    Object.entries(course.kinds).map(([kind, records]) => [kind, records.filter(record => !retired.has(record.itemId))
      .flatMap(record => {
        const overview = overviews.get(record.itemId)
        if (!overview) return [record]
        return overview.after ? [{ ...record, revision: overview.revision, payload: overview.after }] : []
      })])) })) }
}

/** What every course publishes after every migration: this rule's state, then the copies published after it on courses
 *  it emptied (official-banks.cjs planCopy and study-guides.cjs guideCopyPlans): a bank copy's questions and a guide
 *  copy's notes, nothing else. */
function publishedWithCopies(after, bankCopies, guideCopies) {
  const banks = new Map(bankCopies.map(plan => [plan.courseId, plan]))
  const guides = new Map(guideCopies.map(plan => [plan.courseId, plan]))
  const courses = after.courses.map(course => {
    const bank = banks.get(course.courseId), guide = guides.get(course.courseId)
    if (!bank && !guide) return course
    assert.ok(course.kinds.cbt_question.length === 0 && course.kinds.note.length === 0, `${course.slug}: a copy on a course the rule emptied`)
    const note = record => ({ itemId: record.itemId, courseId: course.courseId, kind: 'note', questionId: null,
      sourceKey: record.sourceKey, parentItemId: null, revision: 1, payload: record.payload })
    return { ...course, kinds: { ...course.kinds, ...(bank ? { cbt_question: publishedCbt(bank).sort(bySourceKey) } : {}),
      ...(guide ? { note: guide.notes.map(note).sort(bySourceKey) } : {}) } }
  })
  const placed = new Set(courses.map(course => course.courseId))
  assert.ok([...banks.keys(), ...guides.keys()].every(id => placed.has(id)), 'every copy is on a registered course')
  return { ...after, courses }
}

/** For a test of an earlier layer: this rule rolled back first, inside the test's own transaction. */
const ROLLED_BACK_FOR_TEST = `select is(private.${RULE}('rollback'), 'rolled-back', 'the owner content rule (${
  OWNER_RULE_MIGRATION.slice(0, 14)}) rolled back for this test');`

/** For a test of this rule or a layer before it: the copies published after this rule rolled back first, inside the test's
 *  own transaction, since the rule refuses to run again or roll back while they are published on courses it audits. */
function copiesRolledBackForTest(bankCopies, guideCopies) {
  if (bankCopies.length + guideCopies.length === 0) return null
  const guides = guideCopies.map(plan => `private.study_guide('${plan.guide}', 'rollback')`)
  const banks = bankCopies.map(plan => `private.${plan.functionName}('rollback')`)
  const first = [...bankCopies, ...guideCopies].map(plan => plan.migration).sort()[0].slice(0, 14)
  const codes = [...new Set(bankCopies.map(plan => plan.code))].join(' and ')
  return `select is(array[${guides.join(', ')},\n    ${banks.join(', ')}],\n  array_fill('rolled-back'::text, array[${
    guides.length + banks.length}]), 'the ${codes} copies (${first}) rolled back for this test');`
}

/** The overview revision a rollback of this rule leaves as the current one, by overview item, as the history keeps it. */
const pendingAfterRollback = plan => new Map(plan.overviews.filter(row => row.after).map(row => [row.itemId, row.revision]))

/** The document the migration stores and private.owner_content_rule reads. */
function ruleDocument(plan) {
  return { rule: RULE, actor: OWNER_RULE_ACTOR, groups: plan.groups,
    overviews: plan.overviews.map(row => row.after
      ? { slug: row.slug, itemId: row.itemId, before: row.before, after: row.after }
      : { slug: row.slug, itemId: row.itemId, before: row.before, withdraw: true }) }
}

// Bytes per stored chunk of the document, and the longest statement the migration may hold: the Supabase CLI is slow on
// long statements, so every statement stays under 8,000 characters and bytes, as the study guides' do.
const CHUNK_BYTES = 7000
const STATEMENT_CHARS = 8000
const DELIMITER = '$owner_content_rule$'

/** The document as text chunks of at most CHUNK_BYTES, never splitting a character. */
function documentChunks(text) {
  const chunks = []
  let chunk = '', bytes = 0
  for (const character of text) {
    const size = Buffer.byteLength(character)
    if (bytes + size > CHUNK_BYTES) {
      chunks.push(chunk)
      chunk = ''
      bytes = 0
    }
    chunk += character
    bytes += size
  }
  if (chunk) chunks.push(chunk)
  return chunks
}

/** private.study_guide_state as 20261113090000_study_guide_imports.sql defines it, redefined so that this rule's
 *  rolled-back overview revision is history, not someone's draft, exactly as the overview correction treats a
 *  rolled-back guide's. Only that condition changes, in its two places. */
function studyGuideStateSql() {
  const source = fs.readFileSync(path.join(MIGRATIONS, IMPORTS_MIGRATION), 'utf8')
  const head = 'create or replace function private.study_guide_state(p_doc jsonb) returns text'
  const start = source.indexOf(head)
  const end = source.indexOf('\n$$;\n', start) + '\n$$;\n'.length
  assert.ok(start >= 0 && source.indexOf(head, start + 1) < 0 && end > start, `${IMPORTS_MIGRATION}: one study_guide_state`)
  const pending = laterPending([OWNER_RULE_ACTOR])('v_item')
  const edits = [
    ["and c.authored_by = v_actor and c.payload = p_doc->'overview'->'after')) then",
      `and c.authored_by = v_actor and c.payload = p_doc->'overview'->'after')\n         and not ${pending}) then`],
    ["and v_author = v_actor and v_item.current_revision = v_item.published_revision\n      then v_overview := 'after';",
      `and v_author = v_actor and (v_item.current_revision = v_item.published_revision\n      or ${pending})\n      then v_overview := 'after';`],
  ]
  let text = source.slice(start, end)
  for (const [from, to] of edits) {
    assert.equal(text.split(from).length, 2, `study_guide_state: "${from}" once`)
    text = text.replace(from, to)
  }
  return text
}

const sqlText = value => `'${String(value).replaceAll("'", "''")}'`

/** The migration: the document's tables and reader, the rule's state and its one function, the earlier layers' state
 *  functions redefined, the document, and the rule applied. `overviewFunctions` is the overview correction's two
 *  functions with this rule's actor added to the later layers (overview-revisions.cjs overviewFunctionsSql). */
function ruleMigrationSql(plan, overviewFunctions) {
  const text = JSON.stringify(ruleDocument(plan))
  assert.ok(!text.includes(DELIMITER), 'the rule document contains the SQL delimiter')
  const chunks = documentChunks(text)
  const data = [
    `insert into private.content_rules (rule, chunks, sha256) values ('${RULE}', ${chunks.length}, '${
      crypto.createHash('sha256').update(text, 'utf8').digest('hex')}');`,
    ...chunks.map((chunk, index) =>
      `insert into private.content_rule_chunks (rule, ordinal, chunk) values ('${RULE}', ${index + 1}, ${DELIMITER}${chunk}${DELIMITER});`),
    `select private.${RULE}('apply');`,
  ]
  for (const statement of data) {
    assert.ok(statement.length <= STATEMENT_CHARS && Buffer.byteLength(statement) <= STATEMENT_CHARS,
      `a statement over ${STATEMENT_CHARS} characters`)
  }
  const count = kind => plan.groups.filter(row => row.kind === kind).reduce((sum, row) => sum + row.items.length, 0)
  const revised = plan.overviews.filter(row => row.after), withdrawn = plan.overviews.filter(row => !row.after)
  return `-- supabase/migrations/${OWNER_RULE_MIGRATION}
-- GENERATED by scripts/managed-content/generate.cjs from scripts/managed-content/owner-rule.cjs. Do not edit by hand.
-- The owner's content rule (21 Nov 2026): a student sees only content from the owner's files. private.${RULE}('apply')
-- unpublishes, through the publish history, the ${count('theory_question')} theory questions and ${count('model_answer')} model answers the study guide imports
-- published, the ${count('cbt_question')} practice questions on the ${PRACTICE_RETIRED.length} courses with no official bank and the ${count('note')} notes made with v0; it
-- publishes ${revised.length} course overviews as their next revision and unpublishes ${withdrawn.length} (${withdrawn.map(row => row.code).join(', ')}). It refuses, changing
-- nothing, unless every course and kind it audits publishes exactly what this rule was written against and every
-- overview exactly the text it replaces, and does nothing when all of it is done already.
-- private.${RULE}('rollback') publishes again exactly what was published before; nothing is deleted.
-- The earlier layers' state functions are redefined so that a rolled-back revision of this rule is history, not a draft.

-- ---------------------------------------------------------------------------------------------------------------
-- The rule's document.
-- ---------------------------------------------------------------------------------------------------------------

-- Held as text in short chunks (the migration runner is slow on long statements) and checked whole against its SHA-256
-- before it is read. Only migrations read these tables.
create table private.content_rules (
  rule text primary key check (rule ~ '^[a-z0-9_]+$'),
  chunks integer not null check (chunks between 1 and 100000),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$')
);
create table private.content_rule_chunks (
  rule text not null references private.content_rules (rule) on update restrict on delete restrict,
  ordinal integer not null check (ordinal > 0),
  chunk text not null check (length(chunk) between 1 and 8000),
  primary key (rule, ordinal)
);
alter table private.content_rules enable row level security;
alter table private.content_rule_chunks enable row level security;
revoke all on table private.content_rules, private.content_rule_chunks from public, anon, authenticated, service_role;

-- The document, refused before anything is read or written if a chunk is missing, extra or changed.
create function private.content_rule_source(p_rule text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_head private.content_rules;
  v_count integer;
  v_text text;
begin
  select * into v_head from private.content_rules where rule = p_rule;
  select count(*), string_agg(chunk, '' order by ordinal) into v_count, v_text
    from private.content_rule_chunks where rule = p_rule;
  if v_head.rule is null or v_text is null or v_count <> v_head.chunks or
     (select max(ordinal) from private.content_rule_chunks where rule = p_rule) <> v_count or
     encode(sha256(convert_to(v_text, 'UTF8')), 'hex') <> v_head.sha256 or
     (v_text::jsonb)->>'rule' is distinct from p_rule then
    raise exception 'Content rule %: its source rows are missing or changed', p_rule;
  end if;
  return v_text::jsonb;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- The rule.
-- ---------------------------------------------------------------------------------------------------------------

-- Where the rule stands, one row for each course and kind it audits and for each overview it changes, in the
-- document's order: 'before' (it publishes exactly what this rule replaces), 'after' (exactly what this rule leaves) or
-- 'other'. An item or overview with an edit by anyone else, published or not, is 'other'.
create function private.${RULE}_states(p_doc jsonb)
returns table (subject text, state text)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_actor uuid := (p_doc->>'actor')::uuid;
  v_group jsonb;
  v_overview jsonb;
  v_live jsonb;
  v_audited jsonb;
  v_item public.managed_content_items;
  v_published public.managed_content_revisions;
  v_current public.managed_content_revisions;
begin
  for v_group in select value from jsonb_array_elements(p_doc->'groups') loop
    subject := format('%s %s', v_group->>'slug', v_group->>'kind');
    state := 'other';
    select coalesce(jsonb_object_agg(i.id::text, jsonb_build_array(i.published_revision, i.published_parent_revision)), '{}')
      into v_live from public.managed_content_items i
      where i.course_id = (v_group->>'courseId')::uuid and i.kind = v_group->>'kind' and i.published_revision is not null;
    select coalesce(jsonb_object_agg(e.value->>'itemId', jsonb_build_array((e.value->>'revision')::integer,
        (e.value->>'parentRevision')::integer)), '{}')
      into v_audited from jsonb_array_elements(v_group->'items') e;
    -- Every audited item is still the item the rule read, current and approved at the revision it recorded.
    if not exists (select 1 from jsonb_array_elements(v_group->'items') e
        left join public.managed_content_items i on i.id = (e.value->>'itemId')::uuid
          and i.course_id = (v_group->>'courseId')::uuid and i.kind = v_group->>'kind'
        where i.id is null or i.current_revision <> (e.value->>'revision')::integer
          or i.approved_revision is distinct from (e.value->>'revision')::integer) then
      if v_live = v_audited then
        state := 'before';
      -- Nothing is published, and each item's last publication is this rule's unpublishing of the revision it recorded.
      elsif v_live = '{}'::jsonb and not exists (select 1 from jsonb_array_elements(v_group->'items') e
          where not exists (select 1 from public.managed_content_publications p
            where p.item_id = (e.value->>'itemId')::uuid and p.action = 'unpublish' and p.acted_by = v_actor
              and p.previous_revision = (e.value->>'revision')::integer
              and p.previous_parent_revision is not distinct from (e.value->>'parentRevision')::integer
              and p.lock_version = (select max(q.lock_version) from public.managed_content_publications q
                where q.item_id = p.item_id))) then
        state := 'after';
      end if;
    end if;
    return next;
  end loop;
  for v_overview in select value from jsonb_array_elements(p_doc->'overviews') loop
    subject := format('%s course_overview', v_overview->>'slug');
    state := 'other';
    select * into v_item from public.managed_content_items where id = (v_overview->>'itemId')::uuid;
    select * into v_published from public.managed_content_revisions
      where item_id = v_item.id and revision = v_item.published_revision;
    select * into v_current from public.managed_content_revisions
      where item_id = v_item.id and revision = v_item.current_revision;
    if v_item.id is null or v_item.kind <> 'course_overview' then
      null;
    elsif v_overview ? 'after' then
      -- Before, only this rule's own revision may be pending: the one a rollback leaves in the history.
      if v_published.payload = v_overview->'before' and (v_item.current_revision = v_item.published_revision
          or (v_current.authored_by = v_actor and v_current.payload = v_overview->'after')) then
        state := 'before';
      elsif v_published.payload = v_overview->'after' and v_published.authored_by = v_actor
          and v_item.current_revision = v_item.published_revision then
        state := 'after';
      end if;
    elsif v_item.current_revision = v_item.approved_revision then
      -- A withdrawn overview: published at the revision with its text from before, or unpublished by this rule at that
      -- revision and nothing since.
      if v_item.published_revision = v_item.current_revision and v_published.payload = v_overview->'before' then
        state := 'before';
      elsif v_item.published_revision is null and v_current.payload = v_overview->'before' and exists (
          select 1 from public.managed_content_publications p where p.item_id = v_item.id and p.action = 'unpublish'
            and p.acted_by = v_actor and p.previous_revision = v_item.current_revision
            and p.lock_version = (select max(q.lock_version) from public.managed_content_publications q
              where q.item_id = v_item.id)) then
        state := 'after';
      end if;
    end if;
    return next;
  end loop;
end;
$$;

-- Apply or roll back the rule, in one statement: everything or nothing.
create function private.${RULE}(p_action text) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  v_doc jsonb := private.content_rule_source('${RULE}');
  v_actor uuid := (v_doc->>'actor')::uuid;
  v_from text;
  v_to text;
  v_done boolean;
  v_other text;
  v_mixed text;
  v_group jsonb;
  v_entry jsonb;
  v_overview jsonb;
  v_item public.managed_content_items;
  v_revision integer;
  v_parent integer;
begin
  if p_action is null or p_action not in ('apply', 'rollback') then
    raise exception 'Owner content rule: unknown action %', p_action;
  end if;
  v_from := case when p_action = 'apply' then 'before' else 'after' end;
  v_to := case when p_action = 'apply' then 'after' else 'before' end;
  -- Every item of each course and kind the rule audits, and every overview it changes, locked in one order before any of
  -- them is read.
  perform 1 from public.managed_content_items i
    where (i.course_id, i.kind) in (select (g.value->>'courseId')::uuid, g.value->>'kind'
        from jsonb_array_elements(v_doc->'groups') g)
      or i.id in (select (o.value->>'itemId')::uuid from jsonb_array_elements(v_doc->'overviews') o)
    order by i.id for update;
  -- Refused, naming the first course and kind that is neither before nor after, or else the first not yet at the start.
  select coalesce(bool_and(s.state = v_to), true), (array_agg(s.subject order by s.n) filter (where s.state = 'other'))[1],
      (array_agg(s.subject order by s.n) filter (where s.state <> v_from))[1]
    into v_done, v_other, v_mixed
    from private.${RULE}_states(v_doc) with ordinality s(subject, state, n);
  if v_done then
    return 'unchanged';
  end if;
  if v_mixed is not null then
    raise exception 'Owner content rule: % is not what this rule %', coalesce(v_other, v_mixed),
      case when p_action = 'apply' then 'replaces' else 'published' end;
  end if;

  if p_action = 'apply' then
    -- Unpublished, never deleted; a course's model answers before its theory questions.
    for v_group in select value from jsonb_array_elements(v_doc->'groups') loop
      for v_entry in select value from jsonb_array_elements(v_group->'items') loop
        perform private.study_guide_unpublish((v_entry->>'itemId')::uuid, v_actor);
      end loop;
    end loop;
    for v_overview in select value from jsonb_array_elements(v_doc->'overviews') loop
      select * into v_item from public.managed_content_items where id = (v_overview->>'itemId')::uuid;
      if not v_overview ? 'after' then
        perform private.study_guide_unpublish(v_item.id, v_actor);
        continue;
      end if;
      -- The new text is the next revision, or the revision this rule wrote before a rollback.
      select r.revision into v_revision from public.managed_content_revisions r
        where r.item_id = v_item.id and r.authored_by = v_actor and r.payload = v_overview->'after'
        order by r.revision desc limit 1;
      if v_revision is null then
        perform private.assert_managed_payload('course_overview', v_overview->'after');
        v_revision := v_item.current_revision + 1;
        insert into public.managed_content_revisions (item_id, revision, payload, authored_by)
          values (v_item.id, v_revision, v_overview->'after', v_actor);
        update public.managed_content_items set current_revision = v_revision, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id returning * into v_item;
      end if;
      if v_item.approved_revision is distinct from v_revision then
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
  else
    -- Each item comes back at the revision and parent revision its unpublication recorded; theory questions before
    -- their answers.
    for v_group in select g.value from jsonb_array_elements(v_doc->'groups') with ordinality g(value, n) order by g.n desc loop
      for v_entry in select value from jsonb_array_elements(v_group->'items') loop
        select * into v_item from public.managed_content_items where id = (v_entry->>'itemId')::uuid;
        select p.previous_revision, p.previous_parent_revision into v_revision, v_parent
          from public.managed_content_publications p
          where p.item_id = v_item.id and p.action = 'unpublish' and p.acted_by = v_actor
          order by p.lock_version desc limit 1;
        insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision, acted_by)
          values (v_item.id, v_item.lock_version + 1, 'publish', v_revision, v_parent, v_actor);
        update public.managed_content_items set published_revision = v_revision, published_parent_revision = v_parent,
          lock_version = lock_version + 1, updated_at = now() where id = v_item.id;
      end loop;
    end loop;
    for v_overview in select value from jsonb_array_elements(v_doc->'overviews') loop
      select * into v_item from public.managed_content_items where id = (v_overview->>'itemId')::uuid;
      if not v_overview ? 'after' then
        select p.previous_revision into v_revision from public.managed_content_publications p
          where p.item_id = v_item.id and p.action = 'unpublish' and p.acted_by = v_actor
          order by p.lock_version desc limit 1;
        insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision, acted_by)
          values (v_item.id, v_item.lock_version + 1, 'publish', v_revision, null, v_actor);
        update public.managed_content_items set published_revision = v_revision, lock_version = lock_version + 1,
          updated_at = now() where id = v_item.id;
        continue;
      end if;
      -- The revision this rule's last publication replaced, which must still hold the text from before.
      select p.previous_revision into v_revision from public.managed_content_publications p
        where p.item_id = v_item.id and p.action = 'publish' and p.revision = v_item.published_revision
          and p.acted_by = v_actor
        order by p.lock_version desc limit 1;
      if v_revision is null or not exists (select 1 from public.managed_content_revisions r
          where r.item_id = v_item.id and r.revision = v_revision and r.payload = v_overview->'before') then
        raise exception 'Owner content rule: % course_overview: the text from before is not the revision it replaced',
          v_overview->>'slug';
      end if;
      insert into public.managed_content_reviews (item_id, revision, parent_revision, decision, reviewed_by, lock_version)
        values (v_item.id, v_revision, null, 'approved', v_actor, v_item.lock_version + 1);
      update public.managed_content_items set approved_revision = v_revision, lock_version = lock_version + 1,
        updated_at = now() where id = v_item.id returning * into v_item;
      insert into public.managed_content_publications (item_id, lock_version, action, revision, parent_revision,
          previous_revision, previous_parent_revision, acted_by)
        values (v_item.id, v_item.lock_version + 1, 'publish', v_revision, null, v_item.published_revision, null, v_actor);
      update public.managed_content_items set published_revision = v_revision, lock_version = lock_version + 1,
        updated_at = now() where id = v_item.id;
    end loop;
  end if;

  if exists (select 1 from private.${RULE}_states(v_doc) s where s.state <> v_to) then
    raise exception 'Owner content rule: % did not reach the expected state', p_action;
  end if;
  return case when p_action = 'apply' then 'applied' else 'rolled-back' end;
end;
$$;

revoke all on function private.content_rule_source(text), private.${RULE}_states(jsonb), private.${RULE}(text)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- The earlier layers. A rollback of this rule leaves the overview revision it wrote as the current revision, as the
-- history keeps it, with the revision before it published and approved again. Their state functions take any such
-- revision for someone's draft and would refuse, so they are redefined to treat it as history, exactly as the overview
-- correction already treats a rolled-back study guide's revision. Nothing else in them changes.
-- ---------------------------------------------------------------------------------------------------------------

-- The overview correction (20261110090000), as 20261112110000_study_guide_notes.sql redefined it, with this rule added
-- to the later layers. GENERATED by scripts/managed-content/overview-revisions.cjs.
${overviewFunctions}
-- The study guide imports' state (20261113090000_study_guide_imports.sql), with this rule's pending overview revision
-- taken as history in its two places.
${studyGuideStateSql()}
revoke all on function private.study_guide_state(jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------
-- The document, in ${chunks.length} chunks, and the rule applied.
-- ---------------------------------------------------------------------------------------------------------------
${data.join('\n')}
`
}

const OPERATOR = '11111111-1111-4111-8111-111111111111'
const READER = '46464646-4646-4646-8646-464646464646'
const READER_SESSION = '46464646-0000-4000-8000-464646464646'
function sqlJson(value) {
  const text = JSON.stringify(value)
  assert.ok(!text.includes('$expected$'), 'content contains the test delimiter')
  return `$expected$${text}$expected$::jsonb`
}
/** A group's published set as pg_temp.published prints it before its MD5: id, revision and parent revision, by id. */
const groupDigest = items => md5([...items].sort((left, right) => left.itemId < right.itemId ? -1 : 1)
  .map(item => `${item.itemId}:${item.revision}:${item.parentRevision ?? '-'}`).join(','))

/** Generated pgTAP: what the migrations leave; a rerun changes nothing; a retired item published again or an operator's
 *  draft is refused by apply and rollback with nothing changed; rollback publishes exactly what was published before,
 *  deleting nothing; a second rollback changes nothing; the rule applies again reusing what it wrote; and the published
 *  read and the practice pool hold none of what it withdrew. `rollbacks` undo what migrations after the rule published on
 *  the courses it audits (the copies), first, inside the test's own transaction. */
function ruleTestSql(plan, seedActor, rollbacks = []) {
  const fn = `private.${RULE}`
  const revised = plan.overviews.filter(row => row.after), withdrawn = plan.overviews.filter(row => !row.after)
  const total = plan.groups.reduce((sum, row) => sum + row.items.length, 0)
  const course = row => `'${row.courseId}'::uuid`
  const item = row => `'${row.itemId}'::uuid`
  const plural = { model_answer: 'model answers', theory_question: 'theory questions', cbt_question: 'practice questions',
    note: 'notes' }
  const saved = name => `(select state from snapshots where name = ${sqlText(name)})`
  const save = name => `insert into snapshots values (${sqlText(name)}, pg_temp.state());`
  const refused = (subject, action) => sqlText(`Owner content rule: ${subject} is not what this rule ${
    action === 'apply' ? 'replaces' : 'published'}`)
  const groupSql = (row, condition) => `(select count(*)::integer from public.managed_content_items where course_id = ${
    course(row)} and kind = '${row.kind}' and ${condition})`
  const first = (slug, kind) => {
    const row = plan.groups.find(entry => entry.slug === slug && entry.kind === kind)
    assert.ok(row, `${slug} ${kind}: a group`)
    return row
  }
  const cbt = first('business-statistics', 'cbt_question'), theory = first('use-of-english', 'theory_question')
  const unpublishedSince = first('philosophy-logic-human-existence', 'cbt_question')
  const draftOn = revised.find(row => row.slug === 'philosophy-logic-human-existence')
  const draftOnWithdrawn = withdrawn.find(row => row.slug === 'business-statistics')
  const draftBefore = revised.find(row => row.slug === 'international-organisational-behaviour')
  assert.ok(draftOn && draftOnWithdrawn && draftBefore, 'the overviews the test edits')
  const lines = [
    '-- supabase/tests/owner_content_rule.test.sql — GENERATED by scripts/managed-content/generate.cjs; do not edit.',
    `-- The owner content rule (${OWNER_RULE_MIGRATION}). After the migrations: nothing it withdrew is published, each item`,
    '-- is kept at the revision it had, the 15 overviews and the history it wrote. A rerun changes nothing. A withdrawn item',
    "-- published again, an item unpublished since or an operator's overview draft is refused with nothing changed. Rollback",
    '-- publishes exactly what was published before, deleting nothing; a second rollback changes nothing; and the rule',
    '-- applies again, reusing the revisions it wrote. The published read and the practice pool hold none of it.',
    'begin;',
    'select no_plan();',
    '',
    ...(rollbacks.length ? ['-- What migrations after the rule published on the courses it audits is rolled back first: the rule refuses to',
      '-- run again or roll back while it is published.', ...rollbacks, ''] : []),
    "-- A course and kind's published items, each with its revision and parent revision, as one MD5.",
    'create function pg_temp.published(p_course uuid, p_kind text) returns text language sql stable as $$',
    "  select md5(coalesce(string_agg(format('%s:%s:%s', id, published_revision, coalesce(published_parent_revision::text, '-')),",
    "    ',' order by id), '')) from public.managed_content_items",
    '  where course_id = p_course and kind = p_kind and published_revision is not null $$;',
    'create function pg_temp.pointers(p_item uuid) returns jsonb language sql stable as $$',
    '  select jsonb_build_array(published_revision, current_revision, approved_revision) from public.managed_content_items',
    '  where id = p_item $$;',
    'create function pg_temp.payload(p_item uuid) returns jsonb language sql stable as $$',
    '  select r.payload from public.managed_content_items i join public.managed_content_revisions r',
    '    on r.item_id = i.id and r.revision = i.published_revision where i.id = p_item $$;',
    "-- Everything the rule could touch: every item's pointers and lock, and the history.",
    'create function pg_temp.state() returns jsonb language sql as $$',
    '  select jsonb_build_object(',
    "    'items', (select md5(string_agg(format('%s:%s:%s:%s:%s:%s', id, current_revision, approved_revision,",
    "      published_revision, published_parent_revision, lock_version), ',' order by id)) from public.managed_content_items),",
    "    'count', (select count(*) from public.managed_content_items),",
    "    'revisions', (select count(*) from public.managed_content_revisions),",
    "    'reviews', (select count(*) from public.managed_content_reviews),",
    "    'publications', (select count(*) from public.managed_content_publications)) $$;",
    'create temporary table snapshots (name text primary key, state jsonb not null) on commit drop;',
    '',
    '-- ---------------------------------------------------------------------------------------------------------------',
    '-- After the migrations.',
    '-- ---------------------------------------------------------------------------------------------------------------',
  ]
  // Who wrote what the rule withdraws: a study guide import wrote the theory, the repository seed the rest.
  const author = row => ['theory_question', 'model_answer'].includes(row.kind) ? GUIDE_ACTOR : seedActor
  for (const row of plan.groups) {
    lines.push(`select is(${groupSql(row, 'published_revision is not null')}, 0, ${sqlText(`${row.slug}: no ${plural[row.kind]} are published`)});`,
      `select is(${groupSql(row, `created_by = '${author(row)}' and published_revision is null and published_parent_revision is null`
        + ' and current_revision = 1 and approved_revision = 1')},`,
      `  ${row.items.length}, ${sqlText(`${row.slug}: its ${row.items.length} ${plural[row.kind]} are kept, unpublished, at the revision they had`)});`)
  }
  lines.push(
    "select is((select count(*)::integer from public.managed_content_items where kind in ('theory_question', 'model_answer', 'rubric')",
    "  and published_revision is not null), 0, 'no theory question, model answer or rubric is published anywhere');",
    'select is((select count(*)::integer from public.managed_content_items i join public.managed_content_revisions r',
    "    on r.item_id = i.id and r.revision = i.published_revision where i.kind = 'note' and r.payload->>'noteType' <> 'guide_topic'), 0,",
    "  'every published note is a study guide topic');",
    `select is((select count(*)::integer from public.managed_content_items where kind = 'cbt_question' and published_revision is not null`,
    `  and course_id = any (array[${plan.groups.filter(row => row.kind === 'cbt_question').map(row => `'${row.courseId}'`).join(', ')}]::uuid[])), 0,`,
    `  'the ${PRACTICE_RETIRED.length} courses with no official bank publish no practice question');`)
  for (const row of revised) {
    lines.push(`select is(pg_temp.pointers(${item(row)}), '[${row.revision}, ${row.revision}, ${row.revision}]'::jsonb,`,
      `  ${sqlText(`${row.code}: the overview publishes revision ${row.revision}`)});`,
      `select is(pg_temp.payload(${item(row)}), ${sqlJson(row.after)},`,
      `  ${sqlText(`${row.code}: ${row.after.examFocus === undefined && row.before.examFocus !== undefined ? 'no Exam focus' : 'its text'}${
        OVERVIEWS.find(spec => spec.slug === row.slug).change === 'guide' ? ', the examinable line as its text, the outcomes and how it is assessed' : ''}`)});`)
  }
  for (const row of withdrawn) {
    lines.push(`select is(pg_temp.pointers(${item(row)}), '[null, ${row.beforeRevision}, ${row.beforeRevision}]'::jsonb,`,
      `  ${sqlText(`${row.code}: the overview is unpublished, and kept`)});`)
  }
  lines.push(
    `select is((select count(*)::integer from public.managed_content_revisions where authored_by = '${OWNER_RULE_ACTOR}'), ${revised.length},`,
    `  'one new revision for each of the ${revised.length} overviews it revises, written by the rule');`,
    `select is((select count(*)::integer from public.managed_content_reviews where reviewed_by = '${OWNER_RULE_ACTOR}' and decision = 'approved'),`,
    `  ${revised.length}, 'each approved before it is published');`,
    `select is((select count(*)::integer from public.managed_content_publications where acted_by = '${OWNER_RULE_ACTOR}' and action = 'publish'),`,
    `  ${revised.length}, 'each publication is in the history');`,
    `select is((select count(*)::integer from public.managed_content_publications where acted_by = '${OWNER_RULE_ACTOR}' and action = 'unpublish'),`,
    `  ${total + withdrawn.length}, 'and so is every withdrawal: ${total} items and ${withdrawn.length} overviews');`,
    `select is((select count(*)::integer from public.managed_content_publications p join public.managed_content_items i on i.id = p.item_id`,
    `    where p.acted_by = '${OWNER_RULE_ACTOR}' and p.action = 'publish' and i.kind = 'course_overview'`,
    `      and p.previous_revision = p.revision - 1), ${revised.length}, 'each overview publication records the revision it replaced');`,
    '',
    '-- The practice pool, the free-pass topic list and the published read (as an operator, who sees model answers too).')
  for (const row of plan.groups.filter(entry => entry.kind === 'cbt_question')) {
    lines.push(`select is((select count(*)::integer from private.practice_pool(${course(row)})), 0, ${sqlText(`${row.slug}: nothing to practise`)});`)
  }
  for (const row of plan.groups.filter(entry => entry.kind === 'note')) {
    lines.push(`select is(private.discovery_topic_titles(${course(row)}), '[]'::jsonb, ${sqlText(`${row.slug}: no notes topic to preview`)});`)
  }
  lines.push(
    'insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data,',
    '  raw_user_meta_data, created_at, updated_at)',
    `values ('00000000-0000-0000-0000-000000000000', '${READER}', 'authenticated', 'authenticated',`,
    "  'owner-rule-reader@example.test', 'x', now(), '{\"provider\":\"email\",\"providers\":[\"email\"]}', '{}', now(), now());",
    `insert into auth.sessions (id, user_id, created_at, updated_at) values ('${READER_SESSION}', '${READER}', now(), now());`,
    `update public.profiles set role = 'operator' where id = '${READER}';`,
    'insert into public.entitlement_grants (user_id, source, starts_at, ends_at, ai_terms, created_by)',
    `  values ('${READER}', 'manual', now() - interval '1 day', now() + interval '1 day', 'none', 'test');`,
    'set local role authenticated;',
    `set local request.jwt.claims = '{"sub":"${READER}","role":"authenticated","session_id":"${READER_SESSION}"}';`)
  const readCourses = [...new Map(plan.groups.map(row => [row.courseId, row])).values()]
  for (const row of readCourses) {
    const kinds = plan.groups.filter(entry => entry.courseId === row.courseId).map(entry => entry.kind)
    lines.push(`select is((select count(*)::integer from public.read_published_managed_content(${course(row)})`,
      `  where kind in (${kinds.map(kind => `'${kind}'`).join(', ')})), 0, ${sqlText(`${row.slug}: the published read returns none of what the rule withdrew`)});`)
  }
  for (const row of withdrawn) {
    lines.push(`select is((select count(*)::integer from public.read_published_managed_content(${course(row)}) where kind = 'course_overview'), 0,`,
      `  ${sqlText(`${row.code}: no overview`)});`)
  }
  lines.push('reset role;', '')

  // A rerun, and refusals from the applied state.
  lines.push('-- ---------------------------------------------------------------------------------------------------------------',
    '-- A rerun changes nothing; drift is refused with nothing changed.',
    '-- ---------------------------------------------------------------------------------------------------------------',
    save('applied'),
    `select is(${fn}('apply'), 'unchanged', 'a rerun is unchanged');`,
    `select is(pg_temp.state(), ${saved('applied')}, 'and changes nothing');`,
    'savepoint republished;',
    `update public.managed_content_items set published_revision = 1, lock_version = lock_version + 1 where id = '${cbt.items[0].itemId}';`,
    save('republished'),
    `select throws_ok($$select ${fn}('apply')$$, 'P0001', ${refused('business-statistics cbt_question', 'apply')},`,
    "  'a withdrawn practice question published again is refused by a rerun');",
    `select throws_ok($$select ${fn}('rollback')$$, 'P0001', ${refused('business-statistics cbt_question', 'rollback')},`,
    "  'and by a rollback');",
    `select is(pg_temp.state(), ${saved('republished')}, 'and nothing changed');`,
    'rollback to savepoint republished;',
    'savepoint republished_theory;',
    `update public.managed_content_items set published_revision = 1, lock_version = lock_version + 1 where id = '${theory.items[0].itemId}';`,
    save('republished theory'),
    `select throws_ok($$select ${fn}('rollback')$$, 'P0001', ${refused('use-of-english theory_question', 'rollback')},`,
    "  'a withdrawn theory question published again is refused by a rollback');",
    `select throws_ok($$select ${fn}('apply')$$, 'P0001', ${refused('use-of-english theory_question', 'apply')}, 'and by a rerun');`,
    `select is(pg_temp.state(), ${saved('republished theory')}, 'and nothing changed');`,
    'rollback to savepoint republished_theory;')
  for (const [name, row] of [['overview_draft', draftOn], ['withdrawn_draft', draftOnWithdrawn]]) {
    lines.push(`savepoint ${name};`,
      'insert into public.managed_content_revisions (item_id, revision, payload, authored_by)',
      `  select id, current_revision + 1, '{"title":"Operator draft","body":"Draft"}'::jsonb, '${OPERATOR}'`,
      `  from public.managed_content_items where id = ${item(row)};`,
      `update public.managed_content_items set current_revision = current_revision + 1, lock_version = lock_version + 1 where id = ${item(row)};`,
      save(name),
      `select throws_ok($$select ${fn}('rollback')$$, 'P0001', ${refused(`${row.slug} course_overview`, 'rollback')},`,
      `  ${sqlText(`an operator's draft of the ${row.after ? 'revised' : 'withdrawn'} ${row.code} overview is refused by a rollback`)});`,
      `select throws_ok($$select ${fn}('apply')$$, 'P0001', ${refused(`${row.slug} course_overview`, 'apply')}, 'and by a rerun');`,
      `select is(pg_temp.state(), ${saved(name)}, 'and nothing changed');`,
      `rollback to savepoint ${name};`)
  }
  lines.push(`select is(pg_temp.state(), ${saved('applied')}, 'back to the applied state');`, '')

  // Rollback.
  lines.push('-- ---------------------------------------------------------------------------------------------------------------',
    '-- Rollback publishes exactly what was published before; nothing is deleted.',
    '-- ---------------------------------------------------------------------------------------------------------------',
    `select is(${fn}('rollback'), 'rolled-back', 'rollback runs');`)
  for (const row of plan.groups) {
    lines.push(`select is(pg_temp.published(${course(row)}, '${row.kind}'), '${groupDigest(row.items)}',`,
      `  ${sqlText(`${row.slug}: its ${row.items.length} ${plural[row.kind]} are published again at the revision they had`)});`)
  }
  for (const row of revised) {
    lines.push(`select is(pg_temp.pointers(${item(row)}), '[${row.beforeRevision}, ${row.revision}, ${row.beforeRevision}]'::jsonb,`,
      `  ${sqlText(`${row.code}: the overview publishes revision ${row.beforeRevision} again, its revision ${row.revision} kept in the history`)});`,
      `select is(md5(pg_temp.payload(${item(row)})::text), '${jsonbMd5(row.before)}', ${sqlText(`${row.code}: with the text it had`)});`)
  }
  for (const row of withdrawn) {
    lines.push(`select is(pg_temp.pointers(${item(row)}), '[${row.beforeRevision}, ${row.beforeRevision}, ${row.beforeRevision}]'::jsonb,`,
      `  ${sqlText(`${row.code}: the overview is published again`)});`,
      `select is(md5(pg_temp.payload(${item(row)})::text), '${jsonbMd5(row.before)}', ${sqlText(`${row.code}: with the text it had`)});`)
  }
  lines.push(
    `select is((pg_temp.state()->>'count')::integer, (${saved('applied')}->>'count')::integer, 'nothing was deleted');`,
    `select is((select count(*)::integer from public.managed_content_publications p join public.managed_content_items i on i.id = p.item_id`,
    `    where p.acted_by = '${OWNER_RULE_ACTOR}' and p.action = 'publish' and i.kind <> 'course_overview'), ${total},`,
    `  'every item came back through the publish history');`,
    `select is(${fn}('rollback'), 'unchanged', 'a second rollback is unchanged');`,
    save('rolled back'),
    'savepoint unpublished_since;',
    'update public.managed_content_items set published_revision = null, published_parent_revision = null, lock_version = lock_version + 1',
    `  where id = '${unpublishedSince.items[0].itemId}';`,
    save('unpublished since'),
    `select throws_ok($$select ${fn}('apply')$$, 'P0001', ${refused('philosophy-logic-human-existence cbt_question', 'apply')},`,
    "  'a practice question unpublished since is refused by apply');",
    `select is(pg_temp.state(), ${saved('unpublished since')}, 'and nothing changed');`,
    'rollback to savepoint unpublished_since;',
    'savepoint draft_before;',
    'insert into public.managed_content_revisions (item_id, revision, payload, authored_by)',
    `  select id, current_revision + 1, '{"title":"Operator draft","body":"Draft"}'::jsonb, '${OPERATOR}'`,
    `  from public.managed_content_items where id = ${item(draftBefore)};`,
    `update public.managed_content_items set current_revision = current_revision + 1, lock_version = lock_version + 1 where id = ${item(draftBefore)};`,
    save('draft before'),
    `select throws_ok($$select ${fn}('apply')$$, 'P0001', ${refused(`${draftBefore.slug} course_overview`, 'apply')},`,
    `  ${sqlText(`an operator's draft of the ${draftBefore.code} overview is refused by apply`)});`,
    `select is(pg_temp.state(), ${saved('draft before')}, 'and nothing changed');`,
    'rollback to savepoint draft_before;',
    `select is(pg_temp.state(), ${saved('rolled back')}, 'back to the rolled-back state');`, '')

  // Apply again.
  lines.push('-- ---------------------------------------------------------------------------------------------------------------',
    '-- The rule applies again, reusing the revisions it wrote.',
    '-- ---------------------------------------------------------------------------------------------------------------',
    `select is(${fn}('apply'), 'applied', 'apply after rollback');`,
    `select is((select count(*)::integer from public.managed_content_revisions where authored_by = '${OWNER_RULE_ACTOR}'), ${revised.length},`,
    "  'no revision was written twice');",
    `select is((select count(*)::integer from public.managed_content_items i where i.published_revision is not null`,
    `  and (i.course_id, i.kind) in (${plan.groups.map(row => `('${row.courseId}'::uuid, '${row.kind}')`).join(', ')})), 0,`,
    "  'nothing it withdraws is published');")
  for (const row of revised) {
    lines.push(`select is(pg_temp.pointers(${item(row)}), '[${row.revision}, ${row.revision}, ${row.revision}]'::jsonb,`,
      `  ${sqlText(`${row.code}: the overview publishes revision ${row.revision} again`)});`)
  }
  for (const row of withdrawn) {
    lines.push(`select is(pg_temp.pointers(${item(row)}), '[null, ${row.beforeRevision}, ${row.beforeRevision}]'::jsonb,`,
      `  ${sqlText(`${row.code}: the overview is unpublished again`)});`)
  }
  lines.push(`select is(${fn}('apply'), 'unchanged', 'and a rerun is unchanged');`, '',
    `select ok(not has_function_privilege(r, f, 'execute'), format('%s cannot call %s', r, f))`,
    "  from unnest(array['anon', 'authenticated', 'service_role']) r,",
    `       unnest(array['${fn}(text)', '${fn}_states(jsonb)', 'private.content_rule_source(text)']) f;`,
    "select ok(not has_table_privilege(r, t, 'select, insert, update, delete'), format('%s has no access to %s', r, t))",
    "  from unnest(array['anon', 'authenticated', 'service_role']) r,",
    "       unnest(array['private.content_rules', 'private.content_rule_chunks']) t;",
    `select is((select count(*)::integer from public.managed_content_items where created_by = '${seedActor}'`,
    "  and kind = 'note' and published_revision is not null), 0, 'no seeded note is published');",
    'select * from finish();', 'rollback;', '')
  return lines.join('\n')
}

/** The module the app reads for a course the student's plan does not include: what each course publishes after every
 *  migration, by course slug (lib/courses/build-time-study.ts). The database refuses every read of such a course,
 *  counts included. */
function publishedStudyModule(after) {
  const rows = [...after.courses].sort((left, right) => left.slug < right.slug ? -1 : 1).map(course => {
    const count = kind => course.kinds[kind].length
    return `  ${JSON.stringify(course.slug)}: { notes: ${count('note')}, cbt: ${count('cbt_question')}, theory: ${count('theory_question')} },`
  })
  return [
    '// lib/data/published-study.ts — GENERATED by scripts/managed-content/generate.cjs; do not edit.',
    '// What every course publishes after every migration, by course slug: its notes, practice questions and theory questions.',
    'export const PUBLISHED_STUDY: Readonly<Record<string, { readonly notes: number; readonly cbt: number; readonly theory: number }>> = {',
    ...rows,
    '}',
    '',
  ].join('\n')
}

const ROOT = path.join(__dirname, '../..')
const PUBLISHED_STUDY = path.join(ROOT, 'lib/data/published-study.ts')
const RULE_TEST = path.join(ROOT, 'supabase/tests/owner_content_rule.test.sql')

/** The rule's generated outputs: its migration, its pgTAP test (which first runs `rollbacks`, ruleTestSql) and the
 *  build-time study module of what every course publishes after every migration (`after`). */
function ownerRuleOutputs(plan, after, overviewFunctions, seedActor, rollbacks = []) {
  return [[path.join(MIGRATIONS, OWNER_RULE_MIGRATION), ruleMigrationSql(plan, overviewFunctions)],
    [RULE_TEST, ruleTestSql(plan, seedActor, rollbacks)], [PUBLISHED_STUDY, publishedStudyModule(after)]]
}

module.exports = { NOTES_RETIRED, OVERVIEWS, OWNER_RULE_ACTOR, OWNER_RULE_MIGRATION, PRACTICE_RETIRED, RETIRED, ROLLED_BACK_FOR_TEST, RULE,
  copiesRolledBackForTest, documentChunks, groupDigest, guideOverview, jsonbMd5, jsonbText, keySummary, ownerRuleOutputs, ownerRulePlan,
  pendingAfterRollback, publishedAfter, publishedBefore, publishedStudyModule, publishedWithCopies, ruleDocument, ruleMigrationSql,
  ruleTestSql, studyGuideStateSql }
