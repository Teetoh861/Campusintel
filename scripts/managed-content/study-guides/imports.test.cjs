// scripts/managed-content/study-guides/imports.test.cjs — The study guide imports as decided: which guides are imported,
// what each practice button opens, which notes a guide replaces and what it leaves published, the overview each
// course gets, the course ACC 121 needs, and migrations the Supabase CLI can take.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '../../..')
const { buildManifest } = require('../source-manifest.cjs')
const { overviewRevisions } = require('../overview-revisions.cjs')
const { buildImports } = require('../official-banks.cjs')
const { GUIDE_ACTOR, IMPORTS_MIGRATION, assessmentLines, coursesModule, guideDocument, guidePlans, migrationSql, readGuide } = require('../study-guides.cjs')
const { GUIDE_IMPORTS, GUIDES_WAITING } = require('./imports.cjs')

const manifest = buildManifest()
const { plans: banks } = buildImports(manifest)
const revisions = overviewRevisions(manifest)
const guides = guidePlans(manifest, banks, revisions)
const guide = code => guides.find(plan => plan.code === code)
const bankTopics = code => banks.find(plan => plan.code === code).bank.topics
/** One guide's buttons, topic by topic: a plain string for "Practise this topic", [names] for named buttons. */
const buttons = code => guide(code).notes.map(note => {
  const practice = note.payload.practice ?? []
  return practice.every(entry => !entry.named) && practice.length === 1 ? practice[0].topic : practice.map(entry => {
    assert.equal(entry.named, true, `${code} topic ${note.payload.number}: several buttons are all named`)
    return entry.topic
  })
})
const REPLACED = { 'ACC-CM201': 20, BUA201: 10, BUA205: 10, ENT211: 10 }
const CREATED_FOR_BANK = ['ACC101', 'ACS101', 'AMS101', 'BUA101', 'ECO101', 'FIN-CM209', 'FIN101', 'LAG-ACS209', 'LAG-ACS213',
  'LAG-BUA111', 'LAG-BUA123', 'LAG-BUA125', 'PUL101']

test('nineteen guides are imported, the pilot first; BUA 323 waits', () => {
  assert.equal(guides.length, 19)
  assert.equal(guides[0].code, 'GST111')
  assert.deepEqual(GUIDES_WAITING, ['BUA323'])
  assert.deepEqual([...guides.map(plan => plan.code), 'BUA323'].sort(),
    fs.readdirSync(path.join(__dirname, 'source')).sort(), 'every committed guide is imported or waiting')
  assert.deepEqual(guides.slice(1).map(plan => plan.code), ['ACC-CM201', 'ACC101', 'ACC121', 'ACS101', 'AMS101', 'BUA101', 'BUA201',
    'BUA205', 'ECO101', 'ENT211', 'FIN-CM209', 'FIN101', 'LAG-ACS209', 'LAG-ACS213', 'LAG-BUA111', 'LAG-BUA123', 'LAG-BUA125', 'PUL101'])
  assert.equal(guides.reduce((sum, plan) => sum + plan.notes.length, 0), 179, '183 topics less the four of BUA 323')
  for (const plan of guides) {
    assert.equal(plan.theory.length, plan.notes.length, `${plan.code}: one theory question for each topic`)
    plan.notes.forEach((note, index) => {
      assert.deepEqual([note.position, note.payload.number, note.sourceKey], [index + 1, index + 1, `guide-topic:${index + 1}`])
      const question = plan.theory[index]
      assert.deepEqual([question.position, question.sourceKey, question.answer.sourceKey],
        [index + 1, `guide-theory:${index + 1}`, `guide-answer:${index + 1}`], `${plan.code}: theory in topic order`)
      assert.equal(note.payload.theory.itemId, question.itemId, `${plan.code} topic ${index + 1}: the note links its own question`)
      assert.ok(question.payload.prompt.trim() && question.answer.payload.body.trim())
    })
  }
})

test('the pilot is what it was: its document has no new key', () => {
  const pilot = guideDocument(guide('GST111'))
  assert.deepEqual(Object.keys(pilot), ['guide', 'code', 'courseId', 'actor', 'overview', 'retire', 'notes', 'theory'])
  assert.deepEqual(Object.keys(pilot.overview), ['itemId', 'before', 'after'])
  assert.deepEqual(pilot.retire, [])
  assert.equal(fs.readFileSync(path.join(root, 'supabase/migrations', guide('GST111').migration), 'utf8'), migrationSql(guide('GST111')))
})

test('a guide topic that matches one bank topic gets one "Practise this topic" button', () => {
  for (const code of ['ACC-CM201', 'ACS101', 'AMS101', 'BUA201', 'BUA205', 'ENT211', 'FIN-CM209', 'FIN101', 'LAG-ACS209', 'LAG-ACS213',
    'LAG-BUA111', 'LAG-BUA123', 'LAG-BUA125', 'PUL101', 'GST111']) {
    assert.deepEqual(buttons(code), bankTopics(code), `${code}: topic N opens bank topic N`)
  }
  // PUL 101's titles differ from the bank's, but the nine topics match one to one.
  assert.equal(guide('PUL101').notes[5].payload.title, 'Legal Reasoning')
  assert.equal(buttons('PUL101')[5], 'Legal Reasoning: Logic, Rhetoric, Principles and Standards')
})

test('ACC 101: eight guide topics open all fifteen bank topics, each once', () => {
  const [b1, b2, b3, b4, b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15] = bankTopics('ACC101')
  assert.deepEqual(buttons('ACC101'), [[b1, b2, b15], [b3, b4, b5], [b7, b8], b6, b9, b10, [b11, b12, b13], b14])
  assert.deepEqual(buttons('ACC101').flat().sort(), [...bankTopics('ACC101')].sort())
  assert.deepEqual(buttons('ACC101')[0], ['Nature, scope and objectives of accounting', 'Users and qualitative characteristics', 'Branches of accounting'])
})

test('ECO 101: topics 5, 6 and 7 share one bank topic, and each names it', () => {
  const [b1, b2, b3, b4, b5, b6, b7, b8] = bankTopics('ECO101')
  assert.equal(b5, 'Demand and Supply Analysis')
  assert.deepEqual(buttons('ECO101'), [b1, b2, b3, b4, [b5], [b5], [b5], b6, b7, b8])
})

test('BUA 101: topic 7 also opens Organization and Teamwork, and topic 10 has no button', () => {
  const [b1, b2, b3, b4, b5, b6, b7, b8, b9, b10] = bankTopics('BUA101')
  assert.deepEqual([b8, b9, b10], ['Organization and Teamwork', 'Production Systems', 'Employee Motivation'])
  assert.deepEqual(buttons('BUA101'), [b1, b2, b3, b4, b5, b6, [b7, b8], b9, b10, []])
  assert.equal('practice' in guide('BUA101').notes[9].payload, false, 'topic 10 stores no practice list')
  // The second button rests on lesson 7.3, which teaches organising, structure and teams.
  assert.equal(guide('BUA101').notes[6].payload.lessons[2].title, 'The organising function: structure and teams')
})

test('ACC 121 has notes and theory questions but no practice button', () => {
  const plan = guide('ACC121')
  assert.equal(plan.notes.length, 11)
  assert.ok(plan.notes.every(note => !('practice' in note.payload)))
  assert.equal(banks.some(bank => bank.code === 'ACC121'), false, 'it has no bank')
})

test('four guides replace the notes their course publishes today, and nothing else is unpublished', () => {
  for (const plan of guides) {
    const today = manifest.items.filter(item => item.courseId === plan.courseId)
    const notes = today.filter(item => item.kind === 'note')
    assert.equal(plan.retire.length, REPLACED[plan.code] ?? 0, `${plan.code}: notes replaced`)
    assert.deepEqual(plan.retire.map(entry => entry.itemId).sort(), notes.map(item => item.itemId).sort(), `${plan.code}: every note of today`)
    assert.ok(plan.retire.every(entry => entry.revision === 1 && entry.parentRevision === null))
    // The course's own theory questions and their answers stay published exactly as they are.
    const kept = today.filter(item => ['theory_question', 'model_answer', 'rubric'].includes(item.kind))
    assert.deepEqual(plan.keep, kept.map(item => ({ itemId: item.itemId, revision: 1 })), `${plan.code}: theory items kept`)
    const mine = new Set([...plan.notes, ...plan.theory, ...plan.theory.map(question => question.answer)].map(entry => entry.itemId))
    assert.ok(today.every(item => !mine.has(item.itemId)), `${plan.code}: no guide item reuses an existing identity`)
  }
  // ACC-CM201: ten topic notes and the ten calculator tricks go; its twenty theory questions and answers stay.
  const accounting = manifest.items.filter(item => item.courseId === guide('ACC-CM201').courseId && item.kind === 'note')
  assert.deepEqual([accounting.filter(item => item.payload.noteType === 'topic_note').length,
    accounting.filter(item => item.payload.noteType === 'calculator_trick').length], [10, 10])
  assert.equal(guide('ACC-CM201').keep.length, 40)
  assert.deepEqual(guides.filter(plan => plan.keep.length).map(plan => plan.code), ['ACC-CM201'])
})

const EXAMINABLE = 'Every topic is examinable.'
const EXAMINABLE_WITH_CALCULATOR = 'Every topic is examinable. Work through every worked example with a calculator.'
const AMS101_EXAM = 'The exam is mostly objective (CBT). Be ready for some theory questions too, where you define, list and explain.'
// The overview text of each of the 14 courses that had no overview, as decided.
const OVERVIEW_TEXTS = { ACC101: EXAMINABLE, ACC121: EXAMINABLE, ACS101: EXAMINABLE, AMS101: AMS101_EXAM, BUA101: EXAMINABLE, ECO101: EXAMINABLE,
  'FIN-CM209': EXAMINABLE, FIN101: EXAMINABLE, 'LAG-ACS209': EXAMINABLE_WITH_CALCULATOR, 'LAG-ACS213': EXAMINABLE_WITH_CALCULATOR,
  'LAG-BUA111': EXAMINABLE, 'LAG-BUA123': EXAMINABLE, 'LAG-BUA125': EXAMINABLE, PUL101: EXAMINABLE }

test('an overview gains its outcomes and how the course is assessed; a course without one gets one', () => {
  assert.deepEqual(Object.keys(OVERVIEW_TEXTS).sort(), [...CREATED_FOR_BANK, 'ACC121'].sort())
  for (const plan of guides) {
    const { overview } = plan
    // What the guide says under "How you are assessed", after the approved copy changes.
    const written = assessmentLines(plan.code, readGuide(plan.code).cover.assessment)
    assert.ok(overview.after.outcomes.length >= 7 && overview.after.assessment.length >= 1, `${plan.code}: both lists`)
    assert.doesNotMatch(JSON.stringify(overview.after), /this guide|Study Guide|How to use|Read all|By the end of this course/i, `${plan.code}: nothing about the guide`)
    if (plan.code in OVERVIEW_TEXTS) {
      // No overview today: the new one's text is the course's examinable line, which then leaves the assessment list.
      const text = OVERVIEW_TEXTS[plan.code]
      assert.equal(overview.create, true, `${plan.code}: a new overview`)
      assert.deepEqual(Object.keys(overview.after), ['title', 'body', 'outcomes', 'assessment'])
      assert.equal(overview.after.body, text, `${plan.code}: overview text`)
      assert.equal(written.filter(line => line === text).length, 1, `${plan.code}: the text is one of the guide's assessment lines`)
      assert.deepEqual(overview.after.assessment, written.filter(line => line !== text), `${plan.code}: the other assessment lines, in order`)
      assert.equal(JSON.stringify(overview.after).split(text).length - 1, 1, `${plan.code}: the line shows once`)
      assert.equal(manifest.items.some(item => item.courseId === plan.courseId), false, `${plan.code}: no repository content today`)
    } else {
      // A repository course: the corrected overview (revision two) with the two lists added and nothing else changed.
      const corrected = revisions.find(row => row.itemId === overview.itemId)
      assert.ok(corrected, `${plan.code}: its overview was corrected`)
      assert.deepEqual(overview.before, corrected.after)
      const { outcomes, assessment, ...rest } = overview.after
      assert.deepEqual(rest, overview.before, `${plan.code}: the rest of the overview is unchanged`)
      assert.deepEqual(assessment, written, `${plan.code}: every assessment line, the examinable one included`)
      assert.equal(overview.beforeRevision, 2)
    }
  }
  assert.equal(guide('ACC101').overview.after.title, 'Introduction to Financial Accounting I')
  assert.equal(guide('ACC121').overview.after.title, 'Introduction to Cost Accounting')
  // AMS 101's guide has no examinable line, so its line about the exam is the overview text.
  assert.equal(assessmentLines('AMS101', readGuide('AMS101').cover.assessment).includes(EXAMINABLE), false)
  assert.equal(guide('AMS101').overview.after.assessment.length, 3)
})

test('the assessment lines: every topic is examinable, with the calculator line for the two statistics courses', () => {
  for (const plan of guides) {
    const shown = [plan.overview.after.body, ...plan.overview.after.assessment]
    if (plan.code === 'LAG-ACS209' || plan.code === 'LAG-ACS213') assert.ok(shown.includes(EXAMINABLE_WITH_CALCULATOR), plan.code)
    else if (plan.code !== 'AMS101') assert.ok(shown.includes(EXAMINABLE), plan.code)
    assert.ok(plan.overview.after.assessment.every(line => !/\bguide\b|Read all/i.test(line)), plan.code)
  }
  // A course that already had an overview keeps its own text, and the examinable line is in its assessment list.
  for (const code of ['GST111', 'ACC-CM201', 'BUA201', 'BUA205', 'ENT211']) assert.ok(guide(code).overview.after.assessment.includes(EXAMINABLE), code)
  // FIN-CM209's line about banking rules and figures changing is dropped; its other lines stay.
  assert.doesNotMatch(JSON.stringify(guide('FIN-CM209').overview.after), /Banking rules and figures change/)
  assert.equal(guide('FIN-CM209').overview.after.assessment.length, 1)
  // LAG-ACS209 topic 3 keeps "remember this guide": there it means a rule of thumb.
  assert.match(JSON.stringify(guide('LAG-ACS209').notes[2].payload), /remember this guide/)
})

test('ACC 121 gets its course: the catalogue course for Insurance and Actuarial Science, 100 level, second semester', () => {
  const plan = guide('ACC121')
  assert.deepEqual(guideDocument(plan).course, { contentKey: 'introduction-cost-accounting', titles: ['Introduction to Cost Accounting'],
    level: '100-level', semesters: ['second-semester'] })
  assert.deepEqual(guides.filter(entry => entry.created).map(entry => entry.code), ['ACC121'], 'no other guide creates a course')
  assert.equal(manifest.courses.some(course => course.contentKey === plan.contentKey || course.slug === plan.slug), false)
  // The app lists it from the generated module, with identity only: no units, overview or description are invented.
  const module = fs.readFileSync(path.join(root, 'lib/data/study-guide-courses.ts'), 'utf8')
  assert.equal(module, coursesModule(guides))
  assert.match(module, /id: "guide-ACC121", contentKey: "introduction-cost-accounting", slug: "introduction-cost-accounting", code: "ACC121",\n {4}title: "Introduction to Cost Accounting", level: 100, semester: 2, textbooks: \[\], topics: \[\], examFocus: \[\], resources: \[\] \}/)
  assert.doesNotMatch(module, /credits|overview|tagline/)
  const { courses } = require(path.join(root, 'lib/data/courses.ts'))
  const { getQuizByCourseSlug, getQuizConfigurationByCourseSlug } = require(path.join(root, 'lib/data/quizzes.ts'))
  const listed = courses.filter(course => course.code === 'ACC121')
  assert.deepEqual(listed.map(course => [course.id, course.slug, course.title, course.level, course.semester, course.credits]),
    [['guide-ACC121', 'introduction-cost-accounting', 'Introduction to Cost Accounting', 100, 2, undefined]], 'the course list holds it once')
  assert.equal(new Set(courses.map(course => course.slug)).size, courses.length, 'no slug is listed twice')
  assert.deepEqual([getQuizByCourseSlug('introduction-cost-accounting') ?? null, getQuizConfigurationByCourseSlug('introduction-cost-accounting') ?? null],
    [null, null], 'it has no practice settings')
  // The catalogue seed offers ACC121 to both departments in the second semester of 100 level.
  const catalogue = fs.readFileSync(path.join(root, 'supabase/migrations/20260930100000_master_course_catalog_v1_1.sql'), 'utf8')
  assert.match(catalogue, /\('ACC121', 'Introduction to Cost Accounting', 'actuarial-science', '100-level', 'second-semester'\)/)
})

test('each import is its own migration, after the newest on origin, in statements the CLI takes quickly', () => {
  const directory = path.join(root, 'supabase/migrations')
  const later = guides.slice(1)
  assert.deepEqual(later.map(plan => plan.migration), [...later.map(plan => plan.migration)].sort(), 'in code order')
  for (const plan of later) {
    // After the function they use and after 20261112100000, the sign-in fix a test database takes first.
    assert.ok(plan.migration > IMPORTS_MIGRATION && IMPORTS_MIGRATION > '20261112100000', plan.migration)
    const sql = fs.readFileSync(path.join(directory, plan.migration), 'utf8')
    assert.equal(sql, migrationSql(plan), `${plan.migration} is what the generator writes`)
    const statements = sql.split('\n').filter(line => line && !line.startsWith('--'))
    const text = JSON.stringify(guideDocument(plan))
    const chunks = statements.slice(1, -1).map(statement => /\$study_guide\$([\s\S]*)\$study_guide\$\);$/.exec(statement)[1])
    assert.equal(chunks.join(''), text, `${plan.code}: the chunks are the document`)
    assert.match(statements[0], new RegExp(`values \\('${plan.guide}', ${chunks.length}, '${crypto.createHash('sha256').update(text).digest('hex')}'\\);$`))
    assert.equal(statements.at(-1), `select private.study_guide('${plan.guide}', 'apply');`)
    for (const statement of statements) {
      assert.ok(statement.length <= 8000 && Buffer.byteLength(statement) <= 8000, `${plan.code}: a statement over 8 KB`)
    }
    assert.equal(guideDocument(plan).actor, GUIDE_ACTOR)
  }
  const names = fs.readdirSync(directory).filter(name => /_study_guide_/.test(name)).sort()
  assert.deepEqual(names, ['20261111090000_study_guide_notes.sql', '20261111100000_study_guide_gst111.sql', IMPORTS_MIGRATION,
    ...later.map(plan => plan.migration)], 'no other study guide migration exists')
  assert.deepEqual(GUIDE_IMPORTS.map(entry => entry.migration), guides.map(plan => plan.migration))
})
