// scripts/managed-content/study-guides.cjs — Build each imported study guide's notes, theory items and overview
// revision from the committed guide sources, and write the migration that imports it.
// The sources are the owner's files, committed as data under study-guides/source and pinned by a SHA-256 manifest:
// a source that differs from the manifest stops the build. Nothing in them is executed.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { uuidV5 } = require('./source-manifest.cjs')
const { blocksToPlain, parseCover, parseTopic, plainInline } = require('./study-guides/parse.cjs')
const { GUIDE_IMPORTS } = require('./study-guides/imports.cjs')

const GUIDE_DIR = path.join(__dirname, 'study-guides')
const SOURCE_DIR = path.join(GUIDE_DIR, 'source')
const MANIFEST_PATH = path.join(GUIDE_DIR, 'manifest.json')
const SYSTEM_MIGRATION = '20261112110000_study_guide_notes.sql'
// A migration provenance marker, never an Auth account.
const GUIDE_ACTOR = '00000000-0000-4000-8000-000000000045'
// Characters per stored chunk of an import document.
const CHUNK = 6000
const DELIMITER = '$study_guide$'

const sha256 = data => crypto.createHash('sha256').update(data).digest('hex')

/** Every committed source file and its SHA-256, by path relative to the source folder. */
function sourceDigests(dir = SOURCE_DIR) {
  const files = {}
  for (const code of fs.readdirSync(dir).sort()) {
    for (const name of fs.readdirSync(path.join(dir, code)).sort()) {
      files[`${code}/${name}`] = sha256(fs.readFileSync(path.join(dir, code, name)))
    }
  }
  return files
}

/** The committed manifest, which must list exactly the committed files with their digests. */
function checkManifest(dir = SOURCE_DIR, manifestPath = MANIFEST_PATH) {
  const committed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  assert.deepEqual(committed, { algorithm: 'sha256', files: sourceDigests(dir) },
    'study guide sources differ from scripts/managed-content/study-guides/manifest.json')
  return committed
}

function readGuide(code) {
  const dir = path.join(SOURCE_DIR, code)
  const names = fs.readdirSync(dir).filter(name => /^T[1-9]\d*\.md$/.test(name))
    .sort((a, b) => Number(a.slice(1, -3)) - Number(b.slice(1, -3)))
  const topics = names.map((name, index) => {
    const topic = parseTopic(fs.readFileSync(path.join(dir, name), 'utf8'), `${code}/${name}`)
    assert.equal(topic.number, index + 1, `${code}/${name}: topics are numbered in order`)
    return topic
  })
  return { cover: parseCover(fs.readFileSync(path.join(dir, 'T0.md'), 'utf8'), `${code}/T0.md`), topics }
}

/** "How you're assessed", with the approved copy changes: the guide is not mentioned. Any other mention of the guide
 *  stops the build until it is decided. */
function assessmentLines(code, items) {
  return items.map(plainInline).flatMap(line => {
    if (/^Every topic in this guide is examinable\. Read all [a-z]+\.$/.test(line)) return ['Every topic is examinable.']
    if (/^Every topic in this guide is examinable\. Read all [a-z]+, and work through every worked example with a calculator\.$/.test(line)) {
      return ['Every topic is examinable. Work through every worked example with a calculator.']
    }
    if (code === 'FIN-CM209' && line.startsWith('Banking rules and figures change. This guide gives the current position')) {
      return []
    }
    assert.ok(!/\bguide\b/i.test(line), `${code}: an assessment line mentions the guide: ${line}`)
    return [line]
  })
}

// JSON text as PostgreSQL stores jsonb (a space after each colon and comma), to check the 262144-byte payload limit.
const jsonbBytes = value => Buffer.byteLength(JSON.stringify(value).replace(/("(?:[^"\\]|\\.)*")|([:,])/g,
  (match, string, punctuation) => string ?? `${punctuation} `))

/** "What you must know" as a sentence: the guides write it to follow a colon, so its first letter is capitalised.
 *  Nothing else in the text changes. */
function capitalised(spans) {
  const [first, ...rest] = spans
  const letter = Array.from(first.text)[0]
  return [{ ...first, text: letter.toUpperCase() + first.text.slice(letter.length) }, ...rest]
}

/** A parsed topic as a guide_topic note payload; its theory question is the given item, its buttons the given
 *  practice topics. */
function guideTopicPayload(topic, questionId, practice) {
  const mustKnow = capitalised(topic.mustKnow)
  return { title: topic.title, body: plainInline(mustKnow), noteType: 'guide_topic', number: topic.number,
    mustKnow, ...(topic.introMore ? { introMore: topic.introMore } : {}), lessons: topic.lessons,
    recap: topic.recap, theory: { itemId: questionId, question: topic.theory.question },
    ...(practice.length ? { practice } : {}) }
}

/** One import: the guide's items, the overview revision and what the course publishes today. */
function guidePlan(entry, manifest, banks, overviewRevisions) {
  const course = manifest.courses.find(row => row.contentKey === entry.contentKey)
  assert.ok(course, `${entry.code}: unknown repository course ${entry.contentKey}`)
  const { courseId } = course
  const { cover, topics } = readGuide(entry.code)
  // Today's published study items: an import that replaces any must list them as retired (a later decision).
  const today = manifest.items.filter(item => item.courseId === courseId
    && ['note', 'theory_question', 'model_answer', 'rubric'].includes(item.kind))
  assert.deepEqual(today.map(item => item.sourceKey), [], `${entry.code}: the course publishes study items; retiring them needs a decision`)
  const bank = banks.get(entry.code)
  const practiceFor = topic => {
    if (entry.practice === 'none') return []
    assert.ok(bank, `${entry.code}: no bank for its practice buttons`)
    if (entry.practice === 'by-number') {
      assert.equal(topics.length, bank.topics.length, `${entry.code}: guide and bank topic counts differ`)
      return [{ topic: bank.topics[topic.number - 1], named: false }]
    }
    const mapped = entry.practice[topic.number]
    assert.ok(Array.isArray(mapped) && mapped.every(label => bank.topics.includes(label)), `${entry.code} topic ${topic.number}: practice mapping`)
    return mapped.map(label => ({ topic: label, named: mapped.length > 1 || entry.namedTopics?.includes(topic.number) === true }))
  }
  const notes = [], theory = []
  for (const topic of topics) {
    const questionId = uuidV5(`${courseId}|theory_question|guide-theory:${topic.number}`)
    const practice = practiceFor(topic)
    const payload = guideTopicPayload(topic, questionId, practice)
    assert.ok(jsonbBytes(payload) <= 262144, `${entry.code} topic ${topic.number}: payload too large`)
    notes.push({ kind: 'note', itemId: uuidV5(`${courseId}|note|guide-topic:${topic.number}`),
      sourceKey: `guide-topic:${topic.number}`, position: topic.number, payload })
    // Each topic's question sits in topic order on the theory page, as its note does in the notes.
    theory.push({ kind: 'theory_question', itemId: questionId, sourceKey: `guide-theory:${topic.number}`, position: topic.number,
      payload: { prompt: blocksToPlain(topic.theory.question).join('\n') },
      answer: { kind: 'model_answer', itemId: uuidV5(`${courseId}|model_answer|guide-answer:${topic.number}`),
        sourceKey: `guide-answer:${topic.number}`, payload: { body: blocksToPlain(topic.theory.answer).join('\n') } } })
  }
  // The overview gains the outcomes and how the course is assessed, on top of what it publishes today.
  const overviewItem = manifest.items.find(item => item.courseId === courseId && item.kind === 'course_overview')
  const revised = overviewRevisions.find(row => row.itemId === overviewItem?.itemId)
  const overview = overviewItem ? {
    itemId: overviewItem.itemId, beforeRevision: revised ? 2 : 1, before: revised ? revised.after : overviewItem.payload,
    after: { ...(revised ? revised.after : overviewItem.payload), outcomes: cover.outcomes.map(plainInline),
      assessment: assessmentLines(entry.code, cover.assessment) } } : null
  assert.ok(overview, `${entry.code}: a course without an overview needs one created (a later decision)`)
  return { ...entry, courseId, slug: course.slug, notes, theory, overview, retire: [] }
}

function guidePlans(manifest, banks, overviewRevisions) {
  const plans = GUIDE_IMPORTS.map(entry => guidePlan(entry, manifest, banks, overviewRevisions))
  assert.equal(new Set(plans.map(plan => plan.migration)).size, plans.length, 'one migration per guide')
  for (const plan of plans) {
    assert.match(plan.migration, /^\d{14}_study_guide_[a-z0-9_]+\.sql$/)
    assert.ok(plan.migration > SYSTEM_MIGRATION, `${plan.migration} must sort after ${SYSTEM_MIGRATION}`)
    assert.match(plan.guide, /^study_guide_[a-z0-9_]+$/)
  }
  return plans
}

/** The import document the migration stores and private.study_guide reads. */
function guideDocument(plan) {
  return { guide: plan.guide, code: plan.code, courseId: plan.courseId, actor: GUIDE_ACTOR,
    overview: { itemId: plan.overview.itemId, before: plan.overview.before, after: plan.overview.after },
    retire: plan.retire, notes: plan.notes, theory: plan.theory }
}

function migrationSql(plan) {
  const text = JSON.stringify(guideDocument(plan))
  assert.ok(!text.includes(DELIMITER), `${plan.code}: the guide contains the SQL delimiter`)
  const points = Array.from(text)
  const chunks = []
  for (let index = 0; index < points.length; index += CHUNK) chunks.push(points.slice(index, index + CHUNK).join(''))
  const quote = value => `'${value.replaceAll("'", "''")}'`
  return [
    `-- supabase/migrations/${plan.migration}`,
    `-- GENERATED by scripts/managed-content/generate.cjs from the ${plan.code} study guide`,
    `-- (scripts/managed-content/study-guides/source/${plan.code}, pinned by its manifest). Do not edit by hand.`,
    `-- ${plan.notes.length} guide topics as notes, ${plan.theory.length} theory questions with their answers, and the course overview's`,
    '-- outcomes and assessment, published through private.study_guide (20261112110000_study_guide_notes.sql), which',
    "-- refuses unless the course publishes what this import was written against. private.study_guide(guide, 'rollback')",
    '-- unpublishes them again and restores the overview; nothing is deleted.',
    '',
    `insert into private.study_guides (guide, chunks, sha256) values (${quote(plan.guide)}, ${chunks.length}, '${sha256(Buffer.from(text, 'utf8'))}');`,
    ...chunks.map((chunk, index) =>
      `insert into private.study_guide_chunks (guide, ordinal, chunk) values (${quote(plan.guide)}, ${index + 1}, ${DELIMITER}${chunk}${DELIMITER});`),
    `select private.study_guide(${quote(plan.guide)}, 'apply');`,
    '',
  ].join('\n')
}

const BEGIN = '-- BEGIN GENERATED by scripts/managed-content/generate.cjs from scripts/managed-content/overview-revisions.cjs.\n'
const END = '-- END GENERATED\n'

/** The system migration with its generated block (the overview correction's functions, redefined) written in; the rest
 *  of the file is hand-written and kept as it is. */
function systemMigrationOutput(block) {
  const file = path.join(__dirname, '../../supabase/migrations', SYSTEM_MIGRATION)
  const text = fs.readFileSync(file, 'utf8')
  const start = text.indexOf(BEGIN), end = text.indexOf(END)
  assert.ok(start >= 0 && end > start && text.indexOf(BEGIN, start + 1) < 0 && text.indexOf(END, end + 1) < 0,
    `${SYSTEM_MIGRATION}: one generated block`)
  return [file, text.slice(0, start + BEGIN.length) + block + text.slice(end)]
}

/** Generated outputs: one migration per imported guide. */
function guideOutputs(plans) {
  return plans.map(plan => [path.join(__dirname, '../../supabase/migrations', plan.migration), migrationSql(plan)])
}

/** What each guide publishes, for the parity test: its notes, theory items and the overview revision. */
function guidePublished(plans) {
  const items = [], overviews = new Map()
  for (const plan of plans) {
    const row = (entry, parentItemId) => ({ itemId: entry.itemId, courseId: plan.courseId, kind: entry.kind, questionId: null,
      sourceKey: entry.sourceKey, parentItemId, revision: 1, payload: entry.payload })
    items.push(...plan.notes.map(note => row(note, null)))
    for (const question of plan.theory) items.push(row(question, null), row(question.answer, question.itemId))
    overviews.set(plan.overview.itemId, { revision: plan.overview.beforeRevision + 1, payload: plan.overview.after })
  }
  return { items, overviews }
}

module.exports = { GUIDE_ACTOR, capitalised, systemMigrationOutput, guideTopicPayload, MANIFEST_PATH, SOURCE_DIR, SYSTEM_MIGRATION, assessmentLines, checkManifest,
  guideDocument, guideOutputs, guidePlans, guidePublished, jsonbBytes, migrationSql, readGuide, sourceDigests }
