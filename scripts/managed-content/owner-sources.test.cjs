// scripts/managed-content/owner-sources.test.cjs — The content-build check of the owner content rule: the real content
// passes once the rule is applied, it fails on the content published before the rule (naming every theory item, seeded
// question and note), and each of its five rules fails on a fixture with a message that names the course, the kind, the
// key and the rule.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { buildManifest, loadSource } = require('./source-manifest.cjs')
const { buildImports } = require('./official-banks.cjs')
const { overviewRevisions } = require('./overview-revisions.cjs')
const { guidePlans } = require('./study-guides.cjs')
const { ownerRulePlan, publishedAfter, publishedBefore } = require('./owner-rule.cjs')
const { HANDOFF, RULES, checkOwnerSources, ownerSourceFailures } = require('./owner-sources.cjs')

const manifest = buildManifest()
const { plans: banks } = buildImports(manifest)
const revisions = overviewRevisions(manifest)
const guides = guidePlans(manifest, banks, revisions)
const before = publishedBefore(manifest, banks, revisions, guides)
const after = publishedAfter(before, ownerRulePlan(before, guides))
const courses = loadSource().courses
const clone = value => JSON.parse(JSON.stringify(value))
const byRule = failures => Object.fromEntries(Object.keys(RULES).map(rule => [rule,
  failures.filter(failure => failure.endsWith(RULES[rule])).length]))

test('everything published after every migration comes from the owner\'s files', () => {
  assert.deepEqual(ownerSourceFailures(after, banks, guides, courses), [])
  assert.doesNotThrow(() => checkOwnerSources(after, banks, guides, courses))
  // The handoff courses: GST 112, BUA 222, BUA 202, BUA 204, GST 212, BUA 216 and BUA 218.
  assert.deepEqual(Object.values(HANDOFF).map(row => row.code), ['GST112', 'BUA222', 'BUA202', 'BUA204', 'GST212', 'BUA216', 'BUA218'])
  assert.deepEqual(Object.entries(HANDOFF).filter(([, row]) => row.keys.includes('formulaSheet')).map(([slug]) => slug),
    ['quantitative-analysis-management'])
})

test('on what was published before the rule, the check fails and names every item that is not the owner\'s', () => {
  const failures = ownerSourceFailures(before, banks, guides, [])
  const counts = byRule(failures)
  assert.equal(counts[1], 27, 'the 27 v0 notes')
  assert.equal(counts[2], 1583, 'the 1,583 practice questions made before the banks')
  assert.equal(counts[3], 358, 'the 179 theory questions and 179 model answers')
  for (const item of ['business-statistics note topic-note:1', 'consumer-behaviour note topic-note:10',
    'philosophy-logic-human-existence cbt_question quiz:467', 'bua218 cbt_question quiz:150',
    'use-of-english theory_question guide-theory:15', 'financial-accounting-1 model_answer guide-answer:8']) {
    assert.ok(failures.some(failure => failure.startsWith(`${item}: `)), item)
  }
  // And the overview text that is not the owner's: every Exam focus, BUA 201's key takeaways, a syllabus list on a guide
  // course, the five first-site paragraphs on guide courses and everything on the three courses with nothing left.
  const overview = failures.filter(failure => failure.endsWith(RULES[4]))
  for (const item of ['bua218 course_overview examFocus', 'principles-business-administration course_overview keyTakeaways',
    'financial-accounting-1 course_overview topics', 'use-of-english course_overview body', 'business-statistics course_overview body',
    'international-organisational-behaviour course_overview examFocus']) {
    assert.ok(overview.some(failure => failure.startsWith(`${item}: `)), item)
  }
  assert.equal(overview.filter(failure => / examFocus: /.test(failure)).length, 14)
  assert.throws(() => checkOwnerSources(before, banks, guides, []), /Published content that is not from the owner's files \(\d+\):\n/)
})

test('each rule fails on a fixture, naming the course, the kind, the key and the rule', () => {
  const state = clone(after)
  const course = slug => state.courses.find(row => row.slug === slug)
  const seeded = before.courses.find(row => row.slug === 'business-statistics')
  course('business-statistics').kinds.note.push(seeded.kinds.note[0])
  course('business-statistics').kinds.cbt_question.push(seeded.kinds.cbt_question[0])
  // A bank question with a payload that is not the bank's.
  const banked = course('use-of-english').kinds.cbt_question[0]
  banked.payload = { ...banked.payload, prompt: 'Changed' }
  course('use-of-english').kinds.theory_question.push(before.courses.find(row => row.slug === 'use-of-english').kinds.theory_question[0])
  course('introduction-insurance').kinds.rubric.push({ sourceKey: 'rubric:1', payload: {} })
  const handoff = course('quantitative-analysis-management').kinds.course_overview[0]
  handoff.payload = { ...handoff.payload, examFocus: ['Anything'] }
  const guide = course('use-of-english').kinds.course_overview[0]
  guide.payload = { ...guide.payload, body: 'A paragraph that is not the guide\'s.' }
  const guideOutcomes = course('principles-management').kinds.course_overview[0]
  guideOutcomes.payload = { ...guideOutcomes.payload, outcomes: ['Not the guide\'s outcome.'] }
  // A course with neither a guide nor a handoff document publishes no overview text at all.
  course('introduction-insurance').kinds.course_overview.push({ sourceKey: 'course-overview', payload: { title: 'T', body: 'B' } })
  const failures = ownerSourceFailures(state, banks, guides,
    [{ slug: 'business-statistics', textbooks: [{ title: 'A book' }, { title: 'Another' }] }, { slug: 'bua218', textbooks: [] }])
  assert.deepEqual([...failures].sort(), [
    `business-statistics note topic-note:1: ${RULES[1]}`,
    `business-statistics cbt_question quiz:1: ${RULES[2]}`,
    `use-of-english cbt_question ${banked.sourceKey}: ${RULES[2]}`,
    `use-of-english theory_question guide-theory:1: ${RULES[3]}`,
    // A text that is not the guide's examinable line leaves that line missing from how the course is assessed, too.
    `use-of-english course_overview body: ${RULES[4]}`,
    `use-of-english course_overview assessment: ${RULES[4]}`,
    `quantitative-analysis-management course_overview examFocus: ${RULES[4]}`,
    `principles-management course_overview outcomes: ${RULES[4]}`,
    `introduction-insurance rubric rubric:1: ${RULES[3]}`,
    `introduction-insurance course_overview body: ${RULES[4]}`,
    `business-statistics textbooks (2 titles): ${RULES[5]}`,
  ].sort())
})

test('every course\'s reading list is empty, until the owner supplies checked titles', () => {
  assert.deepEqual(courses.filter(course => course.textbooks.length).map(course => course.slug), [])
  assert.equal(courses.length, 15)
})
