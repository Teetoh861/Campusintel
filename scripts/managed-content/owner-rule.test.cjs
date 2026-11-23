// scripts/managed-content/owner-rule.test.cjs — The owner content rule as decided (22 Nov 2026): what it withdraws, the
// overviews it changes, that the generator stops when the published content differs, the migration's statements and
// document, and the earlier layers' state functions, which change only where the rule's rolled-back revision is history.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { buildManifest } = require('./source-manifest.cjs')
const { buildImports } = require('./official-banks.cjs')
const { overviewFunctionsSql, overviewRevisions } = require('./overview-revisions.cjs')
const { EXAMINABLE_LINES, GUIDE_ACTOR, IMPORTS_MIGRATION, SYSTEM_MIGRATION, guidePlans } = require('./study-guides.cjs')
const { NOTES_RETIRED, OVERVIEWS, OWNER_RULE_ACTOR, OWNER_RULE_MIGRATION, PRACTICE_RETIRED, documentChunks, guideOverview, jsonbText,
  keySummary, ownerRulePlan, publishedAfter, publishedBefore, publishedStudyModule, ruleDocument, ruleMigrationSql,
  studyGuideStateSql } = require('./owner-rule.cjs')

const ROOT = path.join(__dirname, '../..')
const MIGRATIONS = path.join(ROOT, 'supabase/migrations')
const manifest = buildManifest()
const { plans: banks } = buildImports(manifest)
const revisions = overviewRevisions(manifest)
const guides = guidePlans(manifest, banks, revisions)
const before = publishedBefore(manifest, banks, revisions, guides)
const plan = ownerRulePlan(before, guides)
const after = publishedAfter(before, plan)
const clone = value => JSON.parse(JSON.stringify(value))
const sum = (rows, kind) => rows.filter(row => row.kind === kind).reduce((total, row) => total + row.items.length, 0)

test('the rule withdraws the guides\' theory, the practice made before the banks and the v0 notes, and nothing else', () => {
  assert.equal(OWNER_RULE_MIGRATION, '20261122120000_owner_content_rule.sql')
  assert.equal(OWNER_RULE_ACTOR, '00000000-0000-4000-8000-000000000046')
  assert.deepEqual({ model_answer: sum(plan.groups, 'model_answer'), theory_question: sum(plan.groups, 'theory_question'),
    cbt_question: sum(plan.groups, 'cbt_question'), note: sum(plan.groups, 'note') },
  { model_answer: 179, theory_question: 179, cbt_question: 1583, note: 27 })
  // Every guide course's theory questions and answers, the answers first.
  const theory = plan.groups.filter(row => ['model_answer', 'theory_question'].includes(row.kind))
  assert.deepEqual([...new Set(theory.map(row => row.courseId))].sort(), guides.map(guide => guide.courseId).sort())
  theory.forEach((row, index) => assert.equal(row.kind, index % 2 ? 'theory_question' : 'model_answer', row.slug))
  assert.ok(theory.every(row => row.items.every(item => item.revision === 1
    && item.parentRevision === (row.kind === 'model_answer' ? 1 : null))))
  assert.deepEqual(plan.groups.filter(row => row.kind === 'cbt_question').map(row => [row.slug, row.items.length]), [
    ['business-statistics', 239], ['business-mathematics', 100], ['consumer-behaviour', 50], ['nigerian-peoples-and-culture', 377],
    ['international-organisational-behaviour', 200], ['philosophy-logic-human-existence', 467], ['bua218', 150]])
  assert.deepEqual(plan.groups.filter(row => row.kind === 'note').map(row => [row.slug, row.items.length]),
    [['business-statistics', 11], ['business-mathematics', 6], ['consumer-behaviour', 10]])
  assert.deepEqual([...PRACTICE_RETIRED, ...NOTES_RETIRED].filter(slug => before.courses.find(course => course.slug === slug).bank), [],
    'no course with an official bank')
  // The bank questions that kept their seeded quiz:* keys are the owner's, and stay published.
  const kept = after.courses.filter(course => course.bank).map(course => [course.slug,
    course.kinds.cbt_question.filter(record => record.sourceKey.startsWith('quiz:')).length]).filter(([, count]) => count)
  assert.deepEqual(kept, [['principles-business-administration', 1], ['leadership-governance', 141], ['financial-accounting-1', 1],
    ['principles-business-administration-2', 5], ['quantitative-analysis-management', 79]])
  for (const course of after.courses.filter(row => row.bank)) {
    assert.deepEqual(course.kinds.cbt_question, before.courses.find(row => row.slug === course.slug).kinds.cbt_question, course.slug)
  }
})

test('after the rule: guide notes only, bank questions only, no theory, and the 15 overviews as decided', () => {
  const all = kind => after.courses.flatMap(course => course.kinds[kind])
  assert.deepEqual(all('theory_question').concat(all('model_answer'), all('rubric')), [])
  assert.ok(all('note').every(record => record.payload.noteType === 'guide_topic'))
  assert.equal(all('note').length, 179)
  const overview = slug => after.courses.find(course => course.slug === slug).kinds.course_overview
  assert.deepEqual(plan.overviews.map(row => [row.code, row.after ? `r${row.revision}: ${keySummary(row.after)}` : 'unpublished']), [
    ['ENT211', 'r4: body, outcomes 7, assessment 1'], ['BUA201', 'r4: body, outcomes 8, assessment 2'],
    ['BUA205', 'r4: body, outcomes 8, assessment 1'], ['ACC-CM201', 'r4: body, outcomes 8, assessment 2'],
    ['GST111', 'r4: body, outcomes 12, assessment 1'], ['GST112', 'r3: body, topics 8'], ['BUA222', 'r2: body, topics 14'],
    ['BUA202', 'r3: body, topics 10'], ['BUA204', 'r3: body, topics 7, formulaSheet 21'], ['GST212', 'r3: body, topics 15'],
    ['BUA216', 'r3: body'], ['BUA218', 'r3: body, topics 7'], ['BUA203', 'unpublished'], ['LAG-BUA210', 'unpublished'],
    ['BUA221', 'unpublished']])
  for (const row of plan.overviews) {
    if (!row.after) {
      assert.deepEqual(overview(row.slug), [], `${row.code}: unpublished`)
      continue
    }
    assert.deepEqual(overview(row.slug).map(record => [record.revision, record.payload]), [[row.revision, row.after]], row.code)
    assert.equal(row.after.title, row.before.title, `${row.code}: the title never changes`)
    if (OVERVIEWS.find(spec => spec.slug === row.slug).change === 'guide') {
      // As a guide import creates an overview: the examinable line moves from how it is assessed to the text.
      assert.ok(EXAMINABLE_LINES.includes(row.after.body), row.code)
      assert.deepEqual(row.after.assessment, row.before.assessment.filter(line => line !== row.after.body), row.code)
      assert.deepEqual(row.after.outcomes, row.before.outcomes, row.code)
      assert.deepEqual(Object.keys(row.after), ['title', 'body', 'outcomes', 'assessment'], row.code)
    } else {
      const { examFocus, ...rest } = row.before
      assert.ok(examFocus.length > 0, row.code)
      assert.deepEqual(row.after, rest, `${row.code}: only Exam focus goes`)
    }
  }
  assert.deepEqual(plan.overviews.find(row => row.code === 'BUA204').after.formulaSheet,
    plan.overviews.find(row => row.code === 'BUA204').before.formulaSheet, 'the BUA204 formula sheet stays')
})

test('the generator stops when the published content is not what the rule was written against', () => {
  const edited = (change) => { const copy = clone(before); change(copy); return () => ownerRulePlan(copy, guides) }
  const course = (copy, slug) => copy.courses.find(row => row.slug === slug)
  assert.throws(edited(copy => { course(copy, 'bua218').kinds.course_overview[0].payload.body += ' Edited.' }),
    /BUA218: the published overview is not the text this rule replaces/)
  assert.throws(edited(copy => { course(copy, 'bua218').kinds.course_overview[0].revision = 3 }), /BUA218: what the overview publishes now/)
  assert.throws(edited(copy => { course(copy, 'business-statistics').kinds.cbt_question.pop() }), /withdraws 1583 cbt_question/)
  assert.throws(edited(copy => { course(copy, 'consumer-behaviour').kinds.note.pop() }), /withdraws 27 note/)
  assert.throws(edited(copy => { course(copy, 'use-of-english').kinds.theory_question.pop() }), /GST111: the guide's theory questions/)
  assert.throws(edited(copy => {
    const seeded = course(copy, 'business-statistics').kinds.cbt_question[0]
    course(copy, 'introduction-insurance').kinds.theory_question.push({ ...seeded, kind: 'theory_question', sourceKey: 'theory:1' })
  }), /introduction-insurance: theory that no study guide published/)
  assert.throws(edited(copy => { course(copy, 'use-of-english').kinds.rubric.push({ sourceKey: 'rubric:1' }) }), /a published rubric/)
  // A course with no bank and practice of its own that the rule does not list is not left published.
  assert.throws(edited(copy => {
    course(copy, 'introduction-cost-accounting').kinds.cbt_question.push(clone(course(copy, 'bua218').kinds.cbt_question[0]))
  }), /courses with no official bank that publish practice questions/)
})

test('a guide course\'s overview needs exactly one examinable line', () => {
  const base = { title: 'T', body: 'B', outcomes: ['O'], assessment: ['Expect objective questions.', EXAMINABLE_LINES[0]] }
  assert.deepEqual(guideOverview(base, 'X'), { title: 'T', body: EXAMINABLE_LINES[0], outcomes: ['O'], assessment: ['Expect objective questions.'] })
  assert.throws(() => guideOverview({ ...base, assessment: ['Expect objective questions.'] }, 'X'), /exactly one examinable line/)
  assert.throws(() => guideOverview({ ...base, assessment: [...base.assessment, EXAMINABLE_LINES[1]] }, 'X'), /exactly one examinable line/)
  assert.throws(() => guideOverview({ ...base, assessment: [EXAMINABLE_LINES[0]] }, 'X'), /outcomes and how the course is assessed/)
})

test('the migration: every statement under 8,000 characters and bytes, the document whole, the rule applied last', () => {
  const sql = fs.readFileSync(path.join(MIGRATIONS, OWNER_RULE_MIGRATION), 'utf8')
  const overviews = overviewFunctionsSql(manifest.actor, revisions, [GUIDE_ACTOR, OWNER_RULE_ACTOR])
  assert.equal(sql, ruleMigrationSql(plan, overviews), 'the migration is what the generator writes')
  const text = JSON.stringify(ruleDocument(plan))
  const chunks = documentChunks(text)
  assert.equal(chunks.join(''), text)
  assert.ok(chunks.every(chunk => Buffer.byteLength(chunk) <= 7000 && chunk.length > 0))
  const inserts = sql.split('\n').filter(line => line.startsWith('insert into private.content_rule'))
  assert.equal(inserts.length, chunks.length + 1)
  assert.match(inserts[0], new RegExp(`values \\('owner_content_rule', ${chunks.length}, '${crypto.createHash('sha256').update(text).digest('hex')}'\\);$`))
  for (const statement of inserts) assert.ok(statement.length <= 8000 && Buffer.byteLength(statement) <= 8000)
  assert.ok(sql.trimEnd().endsWith("select private.owner_content_rule('apply');"))
  assert.ok(OWNER_RULE_MIGRATION > fs.readdirSync(MIGRATIONS).filter(name => name !== OWNER_RULE_MIGRATION).sort().at(-1),
    'the newest migration')
  // Nothing is deleted: the migration has no delete statement at all.
  assert.doesNotMatch(sql, /\bdelete\s+from\b/i)
  // The document records each withdrawn item with the revision and parent revision it had.
  const document = ruleDocument(plan)
  assert.equal(document.actor, OWNER_RULE_ACTOR)
  assert.deepEqual(document.groups.flatMap(row => row.items).length, 1968)
  assert.deepEqual(Object.keys(document.overviews[0]), ['slug', 'itemId', 'before', 'after'])
  assert.deepEqual(Object.keys(document.overviews.at(-1)), ['slug', 'itemId', 'before', 'withdraw'])
})

test('the earlier layers\' state functions change only where the rule\'s pending revision is history', () => {
  const pending = actors => `(VAR.approved_revision = VAR.published_revision and exists (select 1
          from public.managed_content_revisions g where g.item_id = VAR.id and g.revision = VAR.current_revision
          and g.authored_by ${actors})`
  // The overview correction: the rule's actor joins the guide's, nothing else differs from 20261112110000.
  const system = fs.readFileSync(path.join(MIGRATIONS, SYSTEM_MIGRATION), 'utf8')
  const redefined = overviewFunctionsSql(manifest.actor, revisions, [GUIDE_ACTOR, OWNER_RULE_ACTOR])
  const current = overviewFunctionsSql(manifest.actor, revisions, [GUIDE_ACTOR])
  assert.ok(system.includes(current))
  assert.equal(redefined.replaceAll(`in ('${GUIDE_ACTOR}', '${OWNER_RULE_ACTOR}')`, `= '${GUIDE_ACTOR}'`), current)
  assert.equal(redefined.split(OWNER_RULE_ACTOR).length - 1, 3, 'its three conditions')
  // The study guides' state: the applied definition with the rule's pending revision added in its two places.
  const imports = fs.readFileSync(path.join(MIGRATIONS, IMPORTS_MIGRATION), 'utf8')
  const state = studyGuideStateSql()
  const clause = pending(`= '${OWNER_RULE_ACTOR}')`).replaceAll('VAR', 'v_item')
  const stripped = state.replace(`\n         and not ${clause}) then`, ') then')
    .replace(`and (v_item.current_revision = v_item.published_revision\n      or ${clause})\n`, 'and v_item.current_revision = v_item.published_revision\n')
  assert.ok(imports.includes(stripped), 'nothing else differs from 20261113090000')
  assert.notEqual(state, stripped)
  const sql = fs.readFileSync(path.join(MIGRATIONS, OWNER_RULE_MIGRATION), 'utf8')
  assert.ok(sql.includes(redefined) && sql.includes(state))
})

test('jsonb text is what PostgreSQL prints, so its MD5 matches md5(payload::text)', () => {
  assert.equal(jsonbText({ bb: 1, a: [1, 'x'], ccc: { z: null, y: true } }), '{"a": [1, "x"], "bb": 1, "ccc": {"y": true, "z": null}}')
  assert.equal(jsonbText({ b: 1, a: 2 }), '{"a": 2, "b": 1}', 'keys of one length in byte order')
  assert.equal(jsonbText({ 'é': 1, z: 2 }), '{"z": 2, "é": 1}', 'a two-byte key is longer')
  assert.equal(jsonbText({ text: 'a "quote"\n₦' }), '{"text": "a \\"quote\\"\\n₦"}')
  assert.equal(jsonbText([]), '[]')
  assert.equal(jsonbText({}), '{}')
})

test('the build-time study module lists what every course publishes after every migration', () => {
  const module = fs.readFileSync(path.join(ROOT, 'lib/data/published-study.ts'), 'utf8')
  assert.equal(module, publishedStudyModule(after))
  assert.match(module, /"business-statistics": \{ notes: 0, cbt: 0, theory: 0 \},/)
  assert.match(module, /"use-of-english": \{ notes: 15, cbt: 650, theory: 0 \},/)
  assert.equal((module.match(/^ {2}"/gm) ?? []).length, after.registry.length)
})
