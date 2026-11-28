// scripts/managed-content/study-guides.cjs — Build each imported study guide's notes, theory items and overview
// revision from the committed guide sources, and write the migration that imports it.
// The sources are the owner's files, committed as data under study-guides/source and pinned by a SHA-256 manifest:
// a source that differs from the manifest stops the build. Nothing in them is executed.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { uuidV5 } = require('./source-manifest.cjs')
const { slugFor } = require('./official-banks.cjs')
const { blocksToPlain, parseCover, parseTopic, plainInline } = require('./study-guides/parse.cjs')
const { GUIDE_COPIES, GUIDE_IMPORTS, GUIDES_WAITING } = require('./study-guides/imports.cjs')

const GUIDE_DIR = path.join(__dirname, 'study-guides')
const SOURCE_DIR = path.join(GUIDE_DIR, 'source')
const MANIFEST_PATH = path.join(GUIDE_DIR, 'manifest.json')
const SYSTEM_MIGRATION = '20261112110000_study_guide_notes.sql'
// The import function with kept items, created overviews and a new course: every guide after the pilot follows it.
const IMPORTS_MIGRATION = '20261113090000_study_guide_imports.sql'
const PILOT = 'GST111'
// A course with no overview gets one, and its text is the guide's own line that every topic is examinable. That line
// then leaves "How you're assessed", so it shows once. AMS 101's guide has no such line: its line about the exam is used.
const EXAMINABLE_LINES = ['Every topic is examinable.', 'Every topic is examinable. Work through every worked example with a calculator.']
const OVERVIEW_TEXT = { AMS101: 'The exam is mostly objective (CBT). Be ready for some theory questions too, where you define, list and explain.' }
const STUDY_KINDS = ['note', 'theory_question', 'model_answer', 'rubric']
const COURSES_MODULE = path.join(__dirname, '../../lib/data/study-guide-courses.ts')
// A migration provenance marker, never an Auth account.
const GUIDE_ACTOR = '00000000-0000-4000-8000-000000000045'
// Characters per stored chunk of an import document.
const CHUNK = 6000
// Longest statement a guide migration may hold (the chunk, its INSERT and the delimiters).
const STATEMENT_CHARS = 8000
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

/** A parsed topic as a guide_topic note payload; its theory question is the given item (none when null), its buttons
 *  the given practice topics. */
function guideTopicPayload(topic, questionId, practice) {
  const mustKnow = capitalised(topic.mustKnow)
  return { title: topic.title, body: plainInline(mustKnow), noteType: 'guide_topic', number: topic.number,
    mustKnow, ...(topic.introMore ? { introMore: topic.introMore } : {}), lessons: topic.lessons,
    recap: topic.recap, ...(questionId === null ? {} : { theory: { itemId: questionId, question: topic.theory.question } }),
    ...(practice.length ? { practice } : {}) }
}

/** The course a guide belongs to: a repository course, a course created for its official bank, or a course this import
 *  creates. `title` is set only for a course with no repository content, whose overview the import has to create. */
function guideCourse(entry, manifest, bankPlan) {
  const repository = manifest.courses.find(row => row.contentKey === entry.contentKey)
  if (entry.newCourse) {
    const { title, level, semesters } = entry.newCourse
    assert.ok(!repository && !bankPlan, `${entry.code}: a new course must not have a repository course or a bank`)
    assert.equal(entry.contentKey, slugFor(title), `${entry.code}: slug must follow the repository pattern`)
    assert.ok(!manifest.courses.some(row => row.slug === entry.contentKey), `${entry.code}: slug already used`)
    assert.match(level, /^[1-9]00-level$/, `${entry.code}: level`)
    assert.ok(semesters.length > 0 && semesters.every(key => ['first-semester', 'second-semester'].includes(key)), `${entry.code}: semesters`)
    return { courseId: uuidV5(`course:${entry.contentKey}`), slug: entry.contentKey, title,
      created: { contentKey: entry.contentKey, titles: [title], level, semesters } }
  }
  if (repository) {
    assert.ok(!bankPlan || bankPlan.courseId === repository.courseId, `${entry.code}: its bank belongs to another course`)
    return { courseId: repository.courseId, slug: repository.slug }
  }
  assert.ok(bankPlan?.shell && bankPlan.slug === entry.contentKey, `${entry.code}: unknown course ${entry.contentKey}`)
  return { courseId: bankPlan.courseId, slug: bankPlan.slug, title: bankPlan.course.title }
}

/** One import: the guide's items, its overview, and what the course publishes today that it retires or keeps. */
function guidePlan(entry, manifest, bankPlans, overviewRevisions) {
  const bankPlan = bankPlans.find(plan => plan.code === entry.code)
  const course = guideCourse(entry, manifest, bankPlan)
  const { courseId } = course
  const { cover, topics } = readGuide(entry.code)
  // Today's published study items. Replacing them is a decision recorded on the import: the notes (replacesNotes) and
  // the theory questions with their answers (replacesTheory). Theory the import does not replace stays published
  // exactly as it is.
  const today = manifest.items.filter(item => item.courseId === courseId && STUDY_KINDS.includes(item.kind))
  const todayNotes = today.filter(item => item.kind === 'note')
  assert.equal(todayNotes.length, entry.replacesNotes ?? 0,
    `${entry.code}: the course publishes ${todayNotes.length} notes today; replacing them is a decision (replacesNotes)`)
  const todayTheory = today.filter(item => item.kind !== 'note')
  const todayQuestions = todayTheory.filter(item => item.kind === 'theory_question')
  const replacesTheory = entry.replacesTheory !== undefined
  if (replacesTheory) {
    assert.equal(todayQuestions.length, entry.replacesTheory,
      `${entry.code}: the course publishes ${todayQuestions.length} theory questions today; replacing them is a decision (replacesTheory)`)
    assert.ok(todayTheory.every(item => item.kind === 'theory_question' || todayQuestions.some(question => question.itemId === item.parentItemId)),
      `${entry.code}: a theory answer without its question`)
  }
  // What the import unpublishes, in its order: the notes, then each replaced theory question's answers before the
  // question. A rollback republishes them in reverse, each answer bound to its question's revision again.
  const retire = [...todayNotes.map(item => ({ itemId: item.itemId, revision: 1, parentRevision: null })),
    ...(replacesTheory ? todayQuestions.flatMap(question => [
      ...todayTheory.filter(item => item.parentItemId === question.itemId).map(item => ({ itemId: item.itemId, revision: 1, parentRevision: 1 })),
      { itemId: question.itemId, revision: 1, parentRevision: null }]) : [])]
  const keep = replacesTheory ? [] : todayTheory.map(item => ({ itemId: item.itemId, revision: 1 }))
  const bank = bankPlan?.bank
  if (entry.practice !== 'none' && entry.practice !== 'by-number') {
    assert.deepEqual(Object.keys(entry.practice).map(Number), topics.map(topic => topic.number), `${entry.code}: a mapping for every guide topic`)
  }
  const practiceFor = topic => {
    if (entry.practice === 'none') return []
    assert.ok(bank, `${entry.code}: no bank for its practice buttons`)
    if (entry.practice === 'by-number') {
      assert.equal(topics.length, bank.topics.length, `${entry.code}: guide and bank topic counts differ`)
      return [{ topic: bank.topics[topic.number - 1], named: false }]
    }
    const mapped = entry.practice[topic.number]
    assert.ok(Array.isArray(mapped) && mapped.every(label => bank.topics.includes(label)), `${entry.code} topic ${topic.number}: practice mapping`)
    assert.equal(new Set(mapped).size, mapped.length, `${entry.code} topic ${topic.number}: a bank topic listed twice`)
    return mapped.map(label => ({ topic: label, named: mapped.length > 1 || entry.namedTopics?.includes(topic.number) === true }))
  }
  // The owner content rule (owner-rule.cjs, required here because it reads this module): theory questions are not from
  // the owner's files. The guides whose migrations sort before the rule's were imported with theory questions, and their
  // migrations are applied; the rule unpublishes that theory. A guide imported after it publishes no theory question and
  // no theory link in its notes, whatever its source holds.
  const withTheory = entry.migration < require('./owner-rule.cjs').OWNER_RULE_MIGRATION
  const notes = [], theory = []
  for (const topic of topics) {
    assert.ok(!withTheory || topic.theory, `${entry.code} topic ${topic.number}: a theory question`)
    const questionId = withTheory ? uuidV5(`${courseId}|theory_question|guide-theory:${topic.number}`) : null
    const practice = practiceFor(topic)
    const payload = guideTopicPayload(topic, questionId, practice)
    assert.ok(jsonbBytes(payload) <= 262144, `${entry.code} topic ${topic.number}: payload too large`)
    notes.push({ kind: 'note', itemId: uuidV5(`${courseId}|note|guide-topic:${topic.number}`),
      sourceKey: `guide-topic:${topic.number}`, position: topic.number, payload })
    if (!withTheory) continue
    // Each topic's question sits in topic order on the theory page, as its note does in the notes.
    theory.push({ kind: 'theory_question', itemId: questionId, sourceKey: `guide-theory:${topic.number}`, position: topic.number,
      payload: { prompt: blocksToPlain(topic.theory.question).join('\n') },
      answer: { kind: 'model_answer', itemId: uuidV5(`${courseId}|model_answer|guide-answer:${topic.number}`),
        sourceKey: `guide-answer:${topic.number}`, payload: { body: blocksToPlain(topic.theory.answer).join('\n') } } })
  }
  const lists = { outcomes: cover.outcomes.map(plainInline), assessment: assessmentLines(entry.code, cover.assessment) }
  const overviewItem = manifest.items.find(item => item.courseId === courseId && item.kind === 'course_overview')
  let overview
  if (overviewItem) {
    // The overview gains the outcomes and how the course is assessed, on top of what it publishes today.
    const revised = overviewRevisions.find(row => row.itemId === overviewItem.itemId)
    const before = revised ? revised.after : overviewItem.payload
    overview = { itemId: overviewItem.itemId, beforeRevision: revised ? 2 : 1, before, after: { ...before, ...lists } }
  } else {
    // A course created for its bank, or by this import, has no overview. The import creates one: the course's
    // official title, the guide's line that every topic is examinable as its text, the outcomes, and the rest of how
    // the course is assessed. No description is written.
    assert.equal(cover.cover[1], `**${course.title}**`, `${entry.code}: the guide names the course by its official title`)
    const text = OVERVIEW_TEXT[entry.code] ?? lists.assessment.find(line => EXAMINABLE_LINES.includes(line))
    assert.ok(text && lists.assessment.filter(line => line === text).length === 1, `${entry.code}: one line to use as the overview text`)
    assert.ok(OVERVIEW_TEXT[entry.code] === undefined || !lists.assessment.some(line => EXAMINABLE_LINES.includes(line)),
      `${entry.code}: its guide has an examinable line after all`)
    const assessment = lists.assessment.filter(line => line !== text)
    assert.ok(assessment.length > 0, `${entry.code}: nothing would be left under "How you're assessed"`)
    overview = { itemId: uuidV5(`${courseId}|course_overview|course-overview`), create: true,
      after: { title: course.title, body: text, outcomes: lists.outcomes, assessment } }
  }
  const before = Object.fromEntries(STUDY_KINDS.map(kind => [kind, today.filter(item => item.kind === kind).map(item => item.sourceKey)]))
  // The source keys of what it retires, by kind.
  const retired = Object.fromEntries(STUDY_KINDS.map(kind => [kind, kind === 'note' || replacesTheory ? before[kind] : []]))
  assert.equal(STUDY_KINDS.reduce((sum, kind) => sum + retired[kind].length, 0), retire.length, `${entry.code}: every retired item is listed once`)
  return { ...entry, courseId, slug: course.slug, created: course.created ?? null, notes, theory, overview, retire, retired, keep, before }
}

function guidePlans(manifest, bankPlans, overviewRevisions) {
  const plans = GUIDE_IMPORTS.map(entry => guidePlan(entry, manifest, bankPlans, overviewRevisions))
  assert.equal(new Set(plans.map(plan => plan.migration)).size, plans.length, 'one migration per guide')
  assert.equal(new Set(plans.map(plan => plan.guide)).size, plans.length, 'one name per guide')
  assert.equal(new Set(plans.map(plan => plan.courseId)).size, plans.length, 'one guide per course')
  // Every committed guide is imported or waiting, and nothing else is.
  assert.deepEqual([...plans.map(plan => plan.code), ...GUIDES_WAITING].sort(), fs.readdirSync(SOURCE_DIR).sort(),
    'every committed guide is imported or listed as waiting')
  for (const plan of plans) {
    assert.match(plan.migration, /^\d{14}_study_guide_[a-z0-9_]+\.sql$/)
    assert.ok(plan.migration > SYSTEM_MIGRATION, `${plan.migration} must sort after ${SYSTEM_MIGRATION}`)
    // A guide imported after the owner content rule publishes no theory question and no theory link in its notes.
    if (plan.migration > require('./owner-rule.cjs').OWNER_RULE_MIGRATION) {
      assert.ok(plan.theory.length === 0 && plan.notes.every(note => !('theory' in note.payload)), `${plan.code}: no theory`)
    }
    assert.match(plan.guide, /^study_guide_[a-z0-9_]+$/)
    if (plan.code === PILOT) {
      // The pilot was written against the first import function and uses none of what came after.
      assert.ok(!plan.created && !plan.overview.create && plan.retire.length === 0 && plan.keep.length === 0, 'the pilot is unchanged')
    } else {
      assert.ok(plan.migration > IMPORTS_MIGRATION, `${plan.migration} must sort after ${IMPORTS_MIGRATION}`)
      assert.equal(plan.guide, `study_guide_${plan.code.toLowerCase().replaceAll('-', '_')}`, `${plan.code}: guide name`)
      assert.equal(plan.migration.slice(15, -4), plan.guide, `${plan.code}: migration name`)
    }
  }
  return plans
}

/** The copies (imports.cjs GUIDE_COPIES): each publishes its source guide's topics as notes on its own course, after the
 *  owner content rule withdrew that course's own notes. A note is its source's note exactly, but for the source's link
 *  to its theory question, which the rule withdrew and a guide imported after the rule never has; its practice buttons
 *  name the source bank's topics, which the course's bank copy publishes. No theory, no overview, nothing retired. */
function guideCopyPlans(guides, bankCopies, manifest) {
  const { NOTES_RETIRED, OWNER_RULE_MIGRATION } = require('./owner-rule.cjs')
  const none = Object.fromEntries(STUDY_KINDS.map(kind => [kind, []]))
  const plans = GUIDE_COPIES.map(entry => {
    const source = guides.find(plan => plan.code === entry.copyOf)
    const course = manifest.courses.find(row => row.contentKey === entry.contentKey)
    const bank = bankCopies.find(plan => plan.code === entry.code)
    assert.ok(source && course, `${entry.code}: a copy of an imported guide, on a repository course`)
    assert.ok(bank?.copyOf === entry.copyOf && bank.courseId === course.courseId, `${entry.code}: its bank copies ${entry.copyOf} too`)
    assert.ok(entry.migration > OWNER_RULE_MIGRATION && entry.migration > bank.migration, `${entry.code}: after the rule and its bank`)
    assert.ok(NOTES_RETIRED.includes(entry.contentKey) && !manifest.items.some(item => item.courseId === course.courseId
      && STUDY_KINDS.slice(1).includes(item.kind)), `${entry.code}: its own notes withdrawn by the rule, and no theory`)
    assert.match(entry.migration, /^\d{14}_study_guide_[a-z0-9_]+\.sql$/)
    assert.equal(entry.guide, `study_guide_${entry.code.toLowerCase().replaceAll('-', '_')}`, `${entry.code}: guide name`)
    assert.equal(entry.migration.slice(15, -4), entry.guide, `${entry.code}: migration name`)
    const notes = source.notes.map(note => ({ kind: 'note', itemId: uuidV5(`${course.courseId}|note|${note.sourceKey}`),
      sourceKey: note.sourceKey, position: note.position,
      payload: Object.fromEntries(Object.entries(note.payload).filter(([key]) => key !== 'theory')) }))
    return { ...entry, courseId: course.courseId, slug: course.slug, created: null, notes, theory: [], overview: null,
      retire: [], retired: none, keep: [], before: none }
  })
  const all = [...guides, ...plans]
  assert.ok(new Set(all.map(plan => plan.guide)).size === all.length && new Set(all.map(plan => plan.courseId)).size === all.length,
    'one name and one course per guide')
  return plans
}

/** The import document the migration stores and private.study_guide reads. */
function guideDocument(plan) {
  const overview = plan.overview === null ? null
    : plan.overview.create ? { itemId: plan.overview.itemId, create: true, after: plan.overview.after }
      : { itemId: plan.overview.itemId, before: plan.overview.before, after: plan.overview.after }
  // A key the import does not use is left out, so the pilot's document is what it has always been. A copy has no overview.
  return { guide: plan.guide, code: plan.code, courseId: plan.courseId, actor: GUIDE_ACTOR,
    ...(plan.created ? { course: plan.created } : {}), ...(overview ? { overview } : {}), retire: plan.retire,
    ...(plan.keep.length ? { keep: plan.keep } : {}), notes: plan.notes, theory: plan.theory }
}

function migrationSql(plan) {
  const text = JSON.stringify(guideDocument(plan))
  assert.ok(!text.includes(DELIMITER), `${plan.code}: the guide contains the SQL delimiter`)
  const points = Array.from(text)
  const chunks = []
  for (let index = 0; index < points.length; index += CHUNK) chunks.push(points.slice(index, index + CHUNK).join(''))
  const quote = value => `'${value.replaceAll("'", "''")}'`
  const statements = [
    `insert into private.study_guides (guide, chunks, sha256) values (${quote(plan.guide)}, ${chunks.length}, '${sha256(Buffer.from(text, 'utf8'))}');`,
    ...chunks.map((chunk, index) =>
      `insert into private.study_guide_chunks (guide, ordinal, chunk) values (${quote(plan.guide)}, ${index + 1}, ${DELIMITER}${chunk}${DELIMITER});`),
    `select private.study_guide(${quote(plan.guide)}, 'apply');`,
    // Campus Bot reads a note through its passages, which a trigger writes when a note's row is inserted: before its
    // text is, for an imported note, so it finds none. A copy writes its notes' passages from their published text, as
    // 20261117100000_campus_bot_explain_ask.sql wrote them for every note before it.
    ...(plan.copyOf ? [`insert into private.note_passages (item_id, ordinal, revision, course_id, heading, body)
  select i.id, p.ordinal, i.published_revision, i.course_id, left(coalesce(nullif(btrim(p.heading), ''), 'Notes'), 300), p.body
  from public.managed_content_items i
  join public.managed_content_revisions r on r.item_id = i.id and r.revision = i.published_revision
  cross join lateral private.note_passages_of(r.payload) p
  where i.course_id = '${plan.courseId}' and i.kind = 'note' and i.published_revision is not null
    and not exists (select 1 from private.note_passages n where n.item_id = i.id);`] : []),
  ]
  // The Supabase CLI is slow on long statements, so every statement stays under 8,000 characters, as the banks' do.
  assert.ok(statements.every(statement => statement.length <= STATEMENT_CHARS), `${plan.code}: a statement over ${STATEMENT_CHARS} characters`)
  const header = plan.code === PILOT ? [
    `-- ${plan.notes.length} guide topics as notes, ${plan.theory.length} theory questions with their answers, and the course overview's`,
    `-- outcomes and assessment, published through private.study_guide (${SYSTEM_MIGRATION}), which`,
    "-- refuses unless the course publishes what this import was written against. private.study_guide(guide, 'rollback')",
    '-- unpublishes them again and restores the overview; nothing is deleted.',
  ] : plan.copyOf ? [
    `-- ${plan.code} is ${plan.copyOf} under another code: its ${plan.notes.length} guide topics as notes, each as ${plan.copyOf} publishes it`,
    `-- but for its link to a withdrawn theory question, published through private.study_guide (${IMPORTS_MIGRATION}),`,
    '-- which refuses unless the course publishes exactly what this import was written against. No theory question and no',
    '-- overview. Correct the source guide, never this copy alone. Its notes\' Campus Bot passages are written after it.',
    "-- private.study_guide(guide, 'rollback') unpublishes the notes again; nothing is deleted.",
  ] : [
    `-- ${plan.notes.length} guide topics as notes and ${plan.theory.length} theory questions with their answers, published through`,
    `-- private.study_guide (${IMPORTS_MIGRATION}), which refuses unless the course publishes`,
    '-- exactly what this import was written against.',
    ...(plan.created ? ['-- The course has no repository identity yet: it is created and its catalogue course linked.'] : []),
    ...(plan.retired.note.length ? [`-- The ${plan.retired.note.length} notes the course publishes today are unpublished, never deleted.`] : []),
    ...(plan.retired.theory_question.length ? [`-- So are its own ${plan.retired.theory_question.length} theory questions and their answers: the guide's ${
      plan.theory.length} replace them.`] : []),
    ...(plan.keep.length ? [`-- Its own ${plan.before.theory_question.length} theory questions and their answers stay published as they are.`] : []),
    plan.overview.create ? '-- The course has no overview: one is created with its outcomes and how it is assessed.'
      : '-- The course overview gains its outcomes and how the course is assessed.',
    "-- private.study_guide(guide, 'rollback') unpublishes the guide's items again and brings back what the course",
    '-- published before; nothing is deleted.',
  ]
  return [
    `-- supabase/migrations/${plan.migration}`,
    `-- GENERATED by scripts/managed-content/generate.cjs from the ${plan.copyOf ?? plan.code} study guide${
      plan.copyOf ? `, as ${plan.code}'s copy` : ''}`,
    `-- (scripts/managed-content/study-guides/source/${plan.copyOf ?? plan.code}, pinned by its manifest). Do not edit by hand.`,
    ...header,
    '',
    ...statements,
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

const OPERATOR = '11111111-1111-4111-8111-111111111111'
const sqlText = value => `'${String(value).replaceAll("'", "''")}'`
const sqlArray = (values, type = 'text') => `array[${values.map(sqlText).join(', ')}]::${type}[]`
function sqlJson(value) {
  const text = JSON.stringify(value)
  assert.ok(!text.includes('$expected$'), 'guide content contains the test delimiter')
  return `$expected$${text}$expected$::jsonb`
}
const sorted = values => [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

/** Generated pgTAP for every guide imported after the pilot: what it published, a rerun, refusals with nothing changed,
 *  rollback bringing back exactly what the course published before, and a second apply reusing what it wrote. `later`
 *  is what the migrations after the guides did, which the test rolls back first, inside its own transaction: their
 *  rollback statements, and the overview revision each leaves as the current one (by overview item), as the history
 *  keeps it. */
function importsTestSql(plans, later = { rollbacks: [], pending: new Map() }) {
  const lines = [
    '-- supabase/tests/study_guide_imports.test.sql — GENERATED by scripts/managed-content/generate.cjs; do not edit.',
    `-- The ${plans.length} study guides imported after the pilot (${IMPORTS_MIGRATION} and the migrations after it).`,
    '-- For each course: what the import published; a rerun changes nothing; an edited note, theory question, kept or',
    '-- retired item or overview is refused with nothing changed; rollback brings back exactly what the course published',
    '-- before, deleting nothing; and the guide applies again, reusing what it wrote.',
    'begin;',
    'select no_plan();',
    '',
    ...(later.rollbacks.length ? ['-- What the migrations after the guides changed is rolled back first, so the courses stand as the guides left them.',
      ...later.rollbacks, ''] : []),
    'create function pg_temp.item(p_course uuid, p_key text) returns uuid language sql stable as $$',
    '  select id from public.managed_content_items where course_id = p_course and source_key = p_key $$;',
    "-- Everything an import could touch: each study item's pointers, lock and position, the history, and the course lists.",
    'create function pg_temp.state(p_course uuid) returns jsonb language sql as $$',
    '  select jsonb_build_object(',
    "    'items', (select coalesce(jsonb_agg(jsonb_build_array(id, kind, current_revision, approved_revision, published_revision,",
    "      published_parent_revision, lock_version, position) order by id), '[]'::jsonb) from public.managed_content_items",
    "      where course_id = p_course and kind in ('course_overview', 'note', 'theory_question', 'model_answer', 'rubric')),",
    "    'revisions', (select count(*) from public.managed_content_revisions),",
    "    'reviews', (select count(*) from public.managed_content_reviews),",
    "    'publications', (select count(*) from public.managed_content_publications),",
    "    'courses', (select count(*) from public.courses),",
    "    'linked', (select count(*) from public.institutional_courses where repository_course_id is not null)) $$;",
    '-- The source keys a course publishes for one kind.',
    'create function pg_temp.keys(p_course uuid, p_kind text) returns text[] language sql stable as $$',
    "  select coalesce(array_agg(source_key order by source_key collate \"C\"), array[]::text[]) from public.managed_content_items",
    '  where course_id = p_course and kind = p_kind and published_revision is not null $$;',
    '-- The same keys in the order students see them.',
    'create function pg_temp.shown(p_course uuid, p_kind text, p_prefix text) returns text[] language sql stable as $$',
    '  select coalesce(array_agg(source_key order by position nulls last, created_at, id), array[]::text[]) from public.managed_content_items',
    "  where course_id = p_course and kind = p_kind and published_revision is not null and source_key like p_prefix || '%' $$;",
    'create function pg_temp.payload(p_item uuid) returns jsonb language sql stable as $$',
    '  select r.payload from public.managed_content_items i join public.managed_content_revisions r',
    '    on r.item_id = i.id and r.revision = i.published_revision where i.id = p_item $$;',
    'create function pg_temp.pointers(p_item uuid) returns jsonb language sql stable as $$',
    '  select jsonb_build_array(published_revision, current_revision, approved_revision) from public.managed_content_items where id = p_item $$;',
    'create temporary table snapshots (name text primary key, state jsonb not null) on commit drop;',
    'create temporary table applicability_start on commit drop as select * from public.course_applicability;',
    '',
  ]
  for (const plan of plans) {
    const course = `'${plan.courseId}'::uuid`, guide = sqlText(plan.guide), n = plan.notes.length
    const label = text => sqlText(`${plan.code}: ${text}`)
    const state = `pg_temp.state(${course})`
    const snapshot = name => `(select state from snapshots where name = ${sqlText(`${plan.code} ${name}`)})`
    const save = name => `insert into snapshots values (${sqlText(`${plan.code} ${name}`)}, ${state});`
    const item = key => `pg_temp.item(${course}, ${sqlText(key)})`
    const refused = action => sqlText(`Study guide ${plan.code}: the published notes, theory or overview are not the ones this import ${
      action === 'apply' ? 'replaces' : 'published'}`)
    const noteKeys = plan.notes.map(note => note.sourceKey), theoryKeys = plan.theory.map(question => question.sourceKey)
    const answerKeys = plan.theory.map(question => question.answer.sourceKey)
    const own = n * 3 + (plan.overview.create ? 1 : 0)
    const overview = `'${plan.overview.itemId}'::uuid`
    // After the import the course publishes the guide's items and the theory of its own that the import keeps.
    const keptKeys = kind => plan.before[kind].filter(key => !plan.retired[kind].includes(key))
    const afterKeys = { note: noteKeys, theory_question: [...keptKeys('theory_question'), ...theoryKeys],
      model_answer: [...keptKeys('model_answer'), ...answerKeys], rubric: keptKeys('rubric') }
    const retiredTheory = [...plan.retired.theory_question, ...plan.retired.model_answer, ...plan.retired.rubric]
    const replacing = [...(plan.retired.note.length ? [`${plan.retired.note.length} notes`] : []),
      ...(retiredTheory.length ? [`${plan.retired.theory_question.length} theory questions with their answers`] : [])]
    const published = (keys, text) => ['note', 'theory_question', 'model_answer', 'rubric'].map(kind =>
      `select is(pg_temp.keys(${course}, '${kind}'), ${sqlArray(sorted(keys[kind]))}, ${label(`${text}: ${kind.replace('_', ' ')}s`)});`)
    lines.push(
      '-- ---------------------------------------------------------------------------------------------------------------',
      `-- ${plan.code} (${plan.slug}): ${n} topics${replacing.length ? `, replacing ${replacing.join(' and ')}` : ''}${
        plan.keep.length ? `, keeping ${plan.keep.length} theory items` : ''}${plan.overview.create ? ', a new overview' : ''}${
        plan.created ? ', a new course' : ''}.`,
      '-- ---------------------------------------------------------------------------------------------------------------',
      ...published(afterKeys, 'after the import'),
      `select is(pg_temp.shown(${course}, 'note', 'guide-topic:'), ${sqlArray(noteKeys)}, ${label('topics in order')});`,
      `select is(pg_temp.shown(${course}, 'theory_question', 'guide-theory:'), ${sqlArray(theoryKeys)}, ${label('theory questions in topic order')});`,
      `select is((select array_agg(pg_temp.payload(pg_temp.item(${course}, 'guide-topic:' || t))->>'title' order by t) from generate_series(1, ${n}) t),`,
      `  ${sqlArray(plan.notes.map(note => note.payload.title))}, ${label('topic titles')});`,
      `select is((select jsonb_agg(coalesce(pg_temp.payload(pg_temp.item(${course}, 'guide-topic:' || t))->'practice', '[]'::jsonb) order by t)`,
      `  from generate_series(1, ${n}) t), ${sqlJson(plan.notes.map(note => note.payload.practice ?? []))},`,
      `  ${label(plan.practice === 'none' ? 'no practice button on any topic' : 'the practice buttons of every topic')});`,
      `select is((select count(*)::integer from generate_series(1, ${n}) t where pg_temp.payload(pg_temp.item(${course}, 'guide-topic:' || t))`,
      `    #>> '{theory,itemId}' = pg_temp.item(${course}, 'guide-theory:' || t)::text`,
      `  and pg_temp.payload(pg_temp.item(${course}, 'guide-topic:' || t))->>'noteType' = 'guide_topic'), ${n}, ${label('each topic links its own theory question')});`,
      `select is((select count(*)::integer from public.managed_content_items a join public.managed_content_items q on q.id = a.parent_item_id`,
      `  where a.course_id = ${course} and a.kind = 'model_answer' and a.published_parent_revision = q.published_revision`,
      `    and a.source_key = replace(q.source_key, 'guide-theory', 'guide-answer')), ${n}, ${label('each answer is bound to its question')});`,
      `select is((select count(*)::integer from public.managed_content_items where course_id = ${course} and created_by = '${GUIDE_ACTOR}'`,
      `  and current_revision = 1 and approved_revision = 1 and published_revision = 1), ${own}, ${label('every guide item is published at revision one, with the import as its author')});`)
    if (plan.retired.note.length) {
      lines.push(`select is((select count(*)::integer from public.managed_content_items where course_id = ${course} and kind = 'note'`,
        `  and source_key = any (${sqlArray(plan.retired.note)}) and published_revision is null and current_revision = 1 and approved_revision = 1),`,
        `  ${plan.retired.note.length}, ${label(`the ${plan.retired.note.length} notes it replaces are unpublished and kept`)});`)
    }
    if (retiredTheory.length) {
      lines.push(`select is((select count(*)::integer from public.managed_content_items where course_id = ${course}`,
        `  and kind in ('theory_question', 'model_answer', 'rubric') and source_key = any (${sqlArray(retiredTheory)})`,
        `  and published_revision is null and published_parent_revision is null and current_revision = 1 and approved_revision = 1`,
        `  and created_by <> '${GUIDE_ACTOR}'), ${retiredTheory.length},`,
        `  ${label(`the ${plan.retired.theory_question.length} theory questions it replaces and their answers are unpublished and kept`)});`)
    }
    if (plan.keep.length) {
      lines.push(`select is((select count(*)::integer from public.managed_content_items where course_id = ${course}`,
        `  and source_key = any (${sqlArray([...plan.before.theory_question, ...plan.before.model_answer, ...plan.before.rubric])})`,
        `  and published_revision = 1 and created_by <> '${GUIDE_ACTOR}'), ${plan.keep.length}, ${label("the course's own theory questions and answers are untouched")});`)
    }
    if (plan.overview.create) {
      lines.push(`select is(pg_temp.pointers(${overview}), '[1, 1, 1]'::jsonb, ${label('a new overview is published at revision one')});`,
        `select is(pg_temp.payload(${overview}), ${sqlJson(plan.overview.after)},`,
        `  ${label('the overview: the official title, the examinable line as its text, the outcomes and the rest of how the course is assessed')});`,
        `select is((select count(*)::integer from public.managed_content_items where course_id = ${course} and kind = 'course_overview'), 1, ${label('one overview')});`)
    } else {
      const revision = plan.overview.beforeRevision + 1
      // A later revision rolled back for this test stays the current one, as the history keeps it.
      const current = later.pending.get(plan.overview.itemId) ?? revision
      lines.push(`select is(pg_temp.pointers(${overview}), '[${revision}, ${current}, ${revision}]'::jsonb, ${label(`the overview publishes revision ${revision}`)});`,
        `select is(pg_temp.payload(${overview})->'outcomes', ${sqlJson(plan.overview.after.outcomes)}, ${label('course outcomes')});`,
        `select is(pg_temp.payload(${overview})->'assessment', ${sqlJson(plan.overview.after.assessment)}, ${label('how you are assessed')});`,
        `select is((select (now_published.payload - 'outcomes' - 'assessment') = earlier.payload from public.managed_content_revisions now_published`,
        `  join public.managed_content_revisions earlier on earlier.item_id = now_published.item_id and earlier.revision = ${plan.overview.beforeRevision}`,
        `  where now_published.item_id = ${overview} and now_published.revision = ${revision}), true, ${label('the rest of the overview is unchanged')});`)
    }
    lines.push(`select is((select count(*)::integer from public.managed_content_publications p join public.managed_content_items i on i.id = p.item_id`,
      `  where i.course_id = ${course} and p.acted_by = '${GUIDE_ACTOR}' and p.action = 'publish'), ${n * 3 + 1}, ${label('every publication is in the history')});`,
      `select is((select count(*)::integer from public.managed_content_publications p join public.managed_content_items i on i.id = p.item_id`,
      `  where i.course_id = ${course} and p.acted_by = '${GUIDE_ACTOR}' and p.action = 'unpublish'), ${plan.retire.length}, ${label('and so is every unpublication')});`)
    if (plan.created) {
      lines.push(`select is((select content_key from public.courses where id = ${course}), ${sqlText(plan.created.contentKey)}, ${label('the new course is registered')});`,
        `select is((select jsonb_agg(jsonb_build_array(course_code, display_title)) from public.institutional_courses where repository_course_id = ${course}),`,
        `  ${sqlJson([[plan.code, plan.newCourse.title]])}, ${label('and its catalogue course is linked, once')});`,
        `select is((select array_agg(distinct p.key order by p.key) from public.course_applicability a`,
        `  join public.institutional_courses c on c.id = a.institutional_course_id join public.academic_levels l on l.id = a.academic_level_id`,
        `  join public.academic_periods p on p.id = a.academic_period_id where c.repository_course_id = ${course} and l.key = ${sqlText(plan.created.level)}),`,
        `  ${sqlArray(plan.created.semesters)}, ${label("students see it where the catalogue already offers it")});`)
    }
    // A rerun, and refusals from the applied state.
    lines.push('', save('applied'),
      `select is(private.study_guide(${guide}, 'apply'), 'unchanged', ${label('a rerun is unchanged')});`,
      `select is(${state}, ${snapshot('applied')}, ${label('and changes nothing')});`,
      'savepoint edited_note;',
      'insert into public.managed_content_revisions (item_id, revision, payload, authored_by)',
      `  values (${item('guide-topic:1')}, 2, '{"title":"Operator draft","body":"Draft"}'::jsonb, '${OPERATOR}');`,
      `update public.managed_content_items set current_revision = 2, lock_version = lock_version + 1 where id = ${item('guide-topic:1')};`,
      save('edited note'),
      `select throws_ok($$select private.study_guide(${guide}, 'rollback')$$, 'P0001', ${refused('rollback')}, ${label('an edited note is refused')});`,
      `select is(${state}, ${snapshot('edited note')}, ${label('and nothing changed')});`,
      'rollback to savepoint edited_note;',
      'savepoint edited_theory;',
      'insert into public.managed_content_revisions (item_id, revision, payload, authored_by)',
      `  values (${item(`guide-theory:${n}`)}, 2, '{"prompt":"An operator question"}', '${OPERATOR}');`,
      'update public.managed_content_items set current_revision = 2, approved_revision = 2, published_revision = 2,',
      `  lock_version = lock_version + 3 where id = ${item(`guide-theory:${n}`)};`,
      save('edited theory'),
      `select throws_ok($$select private.study_guide(${guide}, 'apply')$$, 'P0001', ${refused('apply')}, ${label('an edited theory question is refused by a rerun')});`,
      `select throws_ok($$select private.study_guide(${guide}, 'rollback')$$, 'P0001', ${refused('rollback')}, ${label('and by a rollback')});`,
      `select is(${state}, ${snapshot('edited theory')}, ${label('and nothing changed')});`,
      'rollback to savepoint edited_theory;')
    if (plan.keep.length) {
      const kept = item(plan.before.theory_question[0]), answer = item(plan.before.model_answer[0])
      lines.push('savepoint kept_unpublished;',
        `update public.managed_content_items set published_revision = null, published_parent_revision = null, lock_version = lock_version + 1`,
        `  where id = ${answer};`,
        save('kept unpublished'),
        `select throws_ok($$select private.study_guide(${guide}, 'rollback')$$, 'P0001', ${refused('rollback')},`,
        `  ${label("one of the course's own answers, unpublished since, is refused")});`,
        `select is(${state}, ${snapshot('kept unpublished')}, ${label('and nothing changed')});`,
        'rollback to savepoint kept_unpublished;',
        'savepoint kept_revised;',
        'insert into public.managed_content_revisions (item_id, revision, payload, authored_by)',
        `  values (${kept}, 2, '{"prompt":"An operator question"}', '${OPERATOR}');`,
        'update public.managed_content_items set current_revision = 2, approved_revision = 2, published_revision = 2,',
        `  lock_version = lock_version + 3 where id = ${kept};`,
        `select throws_ok($$select private.study_guide(${guide}, 'rollback')$$, 'P0001', ${refused('rollback')},`,
        `  ${label("one of the course's own theory questions, revised since, is refused")});`,
        'rollback to savepoint kept_revised;')
    }
    if (plan.retired.note.length) {
      lines.push('savepoint retired_republished;',
        `update public.managed_content_items set published_revision = 1, lock_version = lock_version + 1 where id = ${item(plan.retired.note[0])};`,
        save('retired republished'),
        `select throws_ok($$select private.study_guide(${guide}, 'rollback')$$, 'P0001', ${refused('rollback')},`,
        `  ${label('a replaced note someone published again is refused')});`,
        `select throws_ok($$select private.study_guide(${guide}, 'apply')$$, 'P0001', ${refused('apply')}, ${label('by a rerun too')});`,
        `select is(${state}, ${snapshot('retired republished')}, ${label('and nothing changed')});`,
        'rollback to savepoint retired_republished;')
    }
    if (retiredTheory.length) {
      lines.push('savepoint retired_theory_republished;',
        `update public.managed_content_items set published_revision = 1, lock_version = lock_version + 1 where id = ${item(plan.retired.theory_question[0])};`,
        save('retired theory republished'),
        `select throws_ok($$select private.study_guide(${guide}, 'rollback')$$, 'P0001', ${refused('rollback')},`,
        `  ${label('a replaced theory question someone published again is refused')});`,
        `select throws_ok($$select private.study_guide(${guide}, 'apply')$$, 'P0001', ${refused('apply')}, ${label('by a rerun too')});`,
        `select is(${state}, ${snapshot('retired theory republished')}, ${label('and nothing changed')});`,
        'rollback to savepoint retired_theory_republished;')
    }
    lines.push(`select is(${state}, ${snapshot('applied')}, ${label('back to the applied state')});`, '')
    // Rollback.
    lines.push(`select is(private.study_guide(${guide}, 'rollback'), 'rolled-back', ${label('rollback runs')});`,
      ...published(plan.before, 'after a rollback, exactly what the course published before'),
      `select is((select count(*)::integer from public.managed_content_items where course_id = ${course} and created_by = '${GUIDE_ACTOR}'`,
      `  and published_revision is null and current_revision = 1 and approved_revision = 1), ${own}, ${label('every guide item is unpublished, and none was deleted')});`)
    if (plan.retired.note.length) {
      lines.push(`select is((select count(*)::integer from public.managed_content_items where course_id = ${course} and kind = 'note'`,
        `  and source_key = any (${sqlArray(plan.retired.note)}) and published_revision = 1 and published_parent_revision is null),`,
        `  ${plan.retired.note.length}, ${label('the notes it replaced are published again at the revision they had')});`,
        `select is((select count(*)::integer from public.managed_content_publications p join public.managed_content_items i on i.id = p.item_id`,
        `  where i.course_id = ${course} and i.kind = 'note' and i.created_by <> '${GUIDE_ACTOR}' and p.acted_by = '${GUIDE_ACTOR}' and p.action = 'publish'),`,
        `  ${plan.retired.note.length}, ${label('through the publish history')});`)
    }
    if (retiredTheory.length) {
      const answers = [...plan.retired.model_answer, ...plan.retired.rubric]
      lines.push(`select is((select count(*)::integer from public.managed_content_items where course_id = ${course} and kind = 'theory_question'`,
        `  and source_key = any (${sqlArray(plan.retired.theory_question)}) and published_revision = 1 and published_parent_revision is null),`,
        `  ${plan.retired.theory_question.length}, ${label('the theory questions it replaced are published again at the revision they had')});`,
        `select is((select count(*)::integer from public.managed_content_items a join public.managed_content_items q on q.id = a.parent_item_id`,
        `  where a.course_id = ${course} and a.source_key = any (${sqlArray(answers)}) and q.kind = 'theory_question'`,
        `    and a.published_revision = 1 and a.published_parent_revision = q.published_revision),`,
        `  ${answers.length}, ${label('each of their answers is bound to its question again')});`,
        `select is((select count(*)::integer from public.managed_content_publications p join public.managed_content_items i on i.id = p.item_id`,
        `  where i.course_id = ${course} and i.kind in ('theory_question', 'model_answer', 'rubric') and i.created_by <> '${GUIDE_ACTOR}'`,
        `    and p.acted_by = '${GUIDE_ACTOR}' and p.action = 'publish'),`,
        `  ${retiredTheory.length}, ${label('through the publish history')});`)
    }
    if (plan.overview.create) {
      lines.push(`select is(pg_temp.pointers(${overview}), '[null, 1, 1]'::jsonb, ${label('the overview it created is unpublished and kept')});`)
    } else {
      lines.push(`select is((select published_revision from public.managed_content_items where id = ${overview}), ${plan.overview.beforeRevision},`,
        `  ${label(`the overview publishes its revision ${plan.overview.beforeRevision} again`)});`,
        `select is(pg_temp.payload(${overview}), ${sqlJson(plan.overview.before)}, ${label('with the text it had')});`)
    }
    if (plan.created) {
      lines.push(`select is((select count(*)::integer from public.institutional_courses where repository_course_id = ${course}), 1,`,
        `  ${label('the course and its catalogue link stay, as a rolled-back bank leaves them')});`)
    }
    lines.push(`select is(private.study_guide(${guide}, 'rollback'), 'unchanged', ${label('a second rollback is unchanged')});`, save('rolled back'),
      'savepoint edited_overview;',
      'insert into public.managed_content_revisions (item_id, revision, payload, authored_by)',
      `  select id, current_revision + 1, '{"title":"Edited","body":"Edited"}'::jsonb, '${OPERATOR}' from public.managed_content_items where id = ${overview};`,
      plan.overview.create
        ? `update public.managed_content_items set current_revision = current_revision + 1, lock_version = lock_version + 1 where id = ${overview};`
        : `update public.managed_content_items set current_revision = current_revision + 1, approved_revision = current_revision + 1,\n`
          + `  published_revision = current_revision + 1, lock_version = lock_version + 3 where id = ${overview};`,
      save('edited overview'),
      `select throws_ok($$select private.study_guide(${guide}, 'apply')$$, 'P0001', ${refused('apply')}, ${label('an edited overview is refused')});`,
      `select is(${state}, ${snapshot('edited overview')}, ${label('and nothing changed')});`,
      'rollback to savepoint edited_overview;',
      'savepoint added_note;',
      'insert into public.managed_content_items (id, course_id, kind, source_key, current_revision, approved_revision,',
      '    published_revision, lock_version, created_by)',
      `  values ('90000000-0000-4000-8000-000000000045', ${course}, 'note', 'operator-note', 1, 1, 1, 3, '${OPERATOR}');`,
      'insert into public.managed_content_revisions (item_id, revision, payload, authored_by)',
      `  values ('90000000-0000-4000-8000-000000000045', 1, '{"title":"Operator","body":"Note"}', '${OPERATOR}');`,
      `select throws_ok($$select private.study_guide(${guide}, 'apply')$$, 'P0001', ${refused('apply')}, ${label('a note published by someone else is refused')});`,
      'rollback to savepoint added_note;',
      `select is(${state}, ${snapshot('rolled back')}, ${label('back to the rolled-back state')});`, '')
    // Apply again.
    lines.push(`select is(private.study_guide(${guide}, 'apply'), 'applied', ${label('apply after rollback')});`,
      ...published(afterKeys, 'applied again'),
      `select is((select count(*)::integer from public.managed_content_revisions r join public.managed_content_items i on i.id = r.item_id`,
      `  where i.course_id = ${course} and r.authored_by = '${GUIDE_ACTOR}'), ${n * 3 + 1}, ${label('no revision was written twice')});`,
      `select is(pg_temp.pointers(${overview}), '${plan.overview.create ? '[1, 1, 1]' : `[${plan.overview.beforeRevision + 1}, ${
        later.pending.get(plan.overview.itemId) ?? plan.overview.beforeRevision + 1}, ${plan.overview.beforeRevision + 1}]`}'::jsonb,`,
      `  ${label("the guide's overview is published again")});`, '')
  }
  lines.push('-- Every apply, rerun, refusal and rollback above leaves the course lists exactly as the migrations left them.',
    'select ok((select count(*) from applicability_start) = (select count(*) from public.course_applicability)',
    '  and not exists (select * from applicability_start except select * from public.course_applicability),',
    "  'the imports add and remove no applicability rows');",
    'select * from finish();', 'rollback;', '')
  return lines.join('\n')
}

const IMPORTS_TEST = path.join(__dirname, '../../supabase/tests/study_guide_imports.test.sql')

/** The module the app reads for the courses created for a study guide, as the app's course list reads them: only
 *  identity (code, official title, level and the first semester the course is taught). No overview, tagline,
 *  description or units are written. What every course publishes is lib/data/published-study.ts (owner-rule.cjs). */
function coursesModule(plans) {
  const rows = plans.filter(plan => plan.created).map(plan => `  { id: ${JSON.stringify(`guide-${plan.code}`)}, `
    + `contentKey: ${JSON.stringify(plan.slug)}, slug: ${JSON.stringify(plan.slug)}, code: ${JSON.stringify(plan.code)},\n    `
    + `title: ${JSON.stringify(plan.newCourse.title)}, level: ${Number(plan.created.level.slice(0, 3))}, `
    + `semester: ${plan.created.semesters[0] === 'second-semester' ? 2 : 1}, textbooks: [], topics: [], examFocus: [], resources: [] },`)
  return [
    '// lib/data/study-guide-courses.ts — GENERATED by scripts/managed-content/generate.cjs; do not edit.',
    "import type { Course } from '@/lib/types'",
    '',
    '// Courses created for a study guide: shelf identity only (code, official title, level, first semester taught). Which',
    '// students see a course is decided by its catalogue applicability, not by these fields.',
    'export const STUDY_GUIDE_NEW_COURSES: Course[] = [',
    ...rows,
    ']',
    '',
  ].join('\n')
}

/** Generated outputs: one migration per imported guide, the module of the courses the guides created, and the pgTAP test
 *  of every import after the pilot (`later` as importsTestSql takes it). */
function guideOutputs(plans, later) {
  return [...plans.map(plan => [path.join(__dirname, '../../supabase/migrations', plan.migration), migrationSql(plan)]),
    [COURSES_MODULE, coursesModule(plans)], [IMPORTS_TEST, importsTestSql(plans.filter(plan => plan.code !== PILOT), later)]]
}

/** What each guide publishes, for the parity test: its notes and theory items, the overview it revises or creates,
 *  the items it retires (no longer published) and the course it creates. */
function guidePublished(plans) {
  const items = [], overviews = new Map(), retired = new Set(), courses = []
  for (const plan of plans) {
    const row = (entry, parentItemId) => ({ itemId: entry.itemId, courseId: plan.courseId, kind: entry.kind, questionId: null,
      sourceKey: entry.sourceKey, parentItemId, revision: 1, payload: entry.payload })
    items.push(...plan.notes.map(note => row(note, null)))
    for (const question of plan.theory) items.push(row(question, null), row(question.answer, question.itemId))
    if (plan.overview?.create) {
      items.push(row({ itemId: plan.overview.itemId, kind: 'course_overview', sourceKey: 'course-overview', payload: plan.overview.after }, null))
    } else if (plan.overview) {
      overviews.set(plan.overview.itemId, { revision: plan.overview.beforeRevision + 1, payload: plan.overview.after })
    }
    for (const entry of plan.retire) retired.add(entry.itemId)
    if (plan.created) courses.push({ contentKey: plan.created.contentKey, slug: plan.slug, courseId: plan.courseId })
  }
  return { items, overviews, retired, courses }
}

module.exports = { EXAMINABLE_LINES, GUIDE_ACTOR, IMPORTS_MIGRATION, OVERVIEW_TEXT, capitalised, systemMigrationOutput, guideTopicPayload, MANIFEST_PATH, SOURCE_DIR,
  SYSTEM_MIGRATION, assessmentLines, checkManifest, coursesModule, guideCopyPlans, guideDocument, guideOutputs, guidePlan, guidePlans,
  guidePublished, importsTestSql, jsonbBytes, migrationSql, readGuide, sourceDigests }
