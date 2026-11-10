// lib/student-copy/stored-content.test.cjs — The copy guard over stored study content: every overview, note (study guide
// topics included), theory question and model answer the migrations publish, checked against docs/student-copy.md rule
// 2. A word from rule 2 that is the course's own subject (a library database, AI as a technology) is allowed only as a
// reviewed exception below; any other match fails, and an exception that no longer matches anything fails too.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { BANNED } = require('./scan.cjs')

const root = path.join(__dirname, '../..')
const { buildManifest } = require(path.join(root, 'scripts/managed-content/source-manifest.cjs'))
const { overviewRevisions } = require(path.join(root, 'scripts/managed-content/overview-revisions.cjs'))
const { buildImports } = require(path.join(root, 'scripts/managed-content/official-banks.cjs'))
const { guidePlans } = require(path.join(root, 'scripts/managed-content/study-guides.cjs'))

const STUDY_KINDS = ['course_overview', 'note', 'theory_question', 'model_answer', 'rubric']

// Reviewed: the word is what the course teaches, not a description of CampusIntell.
const REVIEWED = [
  { where: 'international-organisational-behaviour course_overview course-overview .body', label: 'AI', reason: 'AI as a future trend in the course' },
  { where: 'international-organisational-behaviour course_overview course-overview .topics[13].description', label: 'AI', reason: 'the topic title' },
  { where: 'bua218 course_overview course-overview .examFocus[10]', label: 'AI', reason: 'AI as a green-management technology' },
]

/** Every published text with where it is stored: course, kind, source key and field path. */
function storedTexts() {
  const manifest = buildManifest()
  const slug = Object.fromEntries(manifest.courses.map(course => [course.courseId, course.slug]))
  const revisions = overviewRevisions(manifest)
  const { plans } = buildImports(manifest)
  const guides = guidePlans(manifest, new Map(plans.map(plan => [plan.code, plan.bank])), revisions)
  const published = new Map()
  for (const item of manifest.items.filter(item => STUDY_KINDS.includes(item.kind))) {
    published.set(item.itemId, { course: slug[item.courseId], kind: item.kind, sourceKey: item.sourceKey, payload: item.payload })
  }
  for (const revision of revisions) published.get(revision.itemId).payload = revision.after
  for (const guide of guides) {
    published.get(guide.overview.itemId).payload = guide.overview.after
    for (const entry of [...guide.notes, ...guide.theory, ...guide.theory.map(question => question.answer)]) {
      published.set(entry.itemId, { course: guide.slug, kind: entry.kind, sourceKey: entry.sourceKey, payload: entry.payload })
    }
  }
  const texts = []
  const walk = (value, where) => {
    if (typeof value === 'string') texts.push({ where, text: value })
    else if (Array.isArray(value)) value.forEach((entry, index) => walk(entry, `${where}[${index}]`))
    else if (value && typeof value === 'object') for (const [key, entry] of Object.entries(value)) walk(entry, `${where}.${key}`)
  }
  for (const item of published.values()) walk(item.payload, `${item.course} ${item.kind} ${item.sourceKey} `)
  return { texts, guides }
}

test('no stored study text uses a word or phrase from rule 2, except reviewed subject matter', () => {
  const { texts } = storedTexts()
  assert.ok(texts.length > 1000, 'the stored texts were found')
  const hits = []
  for (const { where, text } of texts) {
    for (const banned of BANNED) {
      if (banned.pattern.test(text)) hits.push({ where: where.replace(/ \./, ' .'), label: banned.label })
    }
  }
  const covers = (entry, hit) => entry.label === hit.label
    && (entry.where !== undefined ? entry.where === hit.where : hit.where.startsWith(entry.topic))
  assert.deepEqual(hits.filter(hit => !REVIEWED.some(entry => covers(entry, hit))).map(hit => `${hit.where} [${hit.label}]`), [],
    'unreviewed matches')
  assert.deepEqual(REVIEWED.filter(entry => !hits.some(hit => covers(entry, hit))).map(entry => entry.where ?? entry.topic), [],
    'stale reviewed exceptions')
})

test('imported study guides store no talk about the guide, its arrows or its practice markers', () => {
  const { guides } = storedTexts()
  for (const guide of guides) {
    const text = JSON.stringify([guide.notes, guide.theory, guide.overview.after])
    assert.doesNotMatch(text, /\[\[NUDGE|Practise this topic|Study Guide by CampusIntell|How to use this guide/, guide.code)
    assert.doesNotMatch(JSON.stringify(guide.overview.after), /this guide/i, guide.code)
  }
})
