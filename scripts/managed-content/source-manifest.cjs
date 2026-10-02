// scripts/managed-content/source-manifest.cjs — Derive managed records from committed repository learning content.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const ROOT = path.resolve(__dirname, '../..')
const REGISTRY = path.join(ROOT, 'supabase/migrations/20260923100000_course_registry.sql')
const ACTOR = '00000000-0000-4000-8000-000000000042'
const NAMESPACE = '91574351-b153-45d9-b037-65f1ba7e26dd'

/** @returns {{courses: object[], quizzes: object, theory: object, notes: object}} Committed content modules. */
function loadSource() {
  const originalExtension = Module._extensions['.ts']
  const originalLoad = Module._load
  Module._extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(
    fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    } },
  ).outputText, filename)
  Module._load = function (specifier, ...args) {
    if (specifier.startsWith('@/')) {
      return originalLoad.call(this, path.join(ROOT, specifier.slice(2)), ...args)
    }
    return originalLoad.call(this, specifier, ...args)
  }
  try {
    return {
      courses: require(path.join(ROOT, 'lib/data/courses.ts')).courses,
      quizzes: require(path.join(ROOT, 'lib/data/quizzes.ts')).quizzes,
      theory: require(path.join(ROOT, 'lib/data/theory-questions.ts')).theoryContent,
      notes: require(path.join(ROOT, 'lib/data/topic-notes.ts')).topicNotes,
    }
  } finally {
    Module._extensions['.ts'] = originalExtension
    Module._load = originalLoad
  }
}

function assertFields(value, allowed, label) {
  for (const key of Object.keys(value)) {
    assert.ok(allowed.includes(key), `${label}: unsupported source field ${key}`)
  }
}

function uuidV5(name) {
  const namespace = Buffer.from(NAMESPACE.replaceAll('-', ''), 'hex')
  const bytes = crypto.createHash('sha1').update(namespace).update(name).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function registryCourses() {
  const sql = fs.readFileSync(REGISTRY, 'utf8')
  const matches = [...sql.matchAll(/\('([0-9a-f-]{36})',\s*'([a-z0-9-]+)',\s*(?:true|false|null),\s*(?:true|false)\)/g)]
  const byKey = new Map(matches.map(match => [match[2], match[1]]))
  assert.equal(matches.length, 15, 'expected the full seeded repository registry')
  assert.equal(byKey.size, matches.length, 'repository content keys must be unique')
  return byKey
}

/** @returns {object} Migration items with source-derived payloads and repository UUID ownership. */
function buildManifest() {
  const { courses, quizzes, theory, notes } = loadSource()
  const byKey = registryCourses()
  assert.equal(courses.length, byKey.size, 'every repository course must be accounted for')
  const items = []
  const ids = new Set()
  const sourceIdentities = new Set()
  const questionIds = new Set()
  const courseRows = []

  function append(courseId, kind, sourceKey, payload, questionId = null, parentItemId = null) {
    const sourceIdentity = `${courseId}|${kind}|${sourceKey}`
    assert.ok(!sourceIdentities.has(sourceIdentity), `duplicate source identity ${sourceIdentity}`)
    sourceIdentities.add(sourceIdentity)
    const itemId = uuidV5(sourceIdentity)
    assert.ok(!ids.has(itemId), `duplicate item UUID ${itemId}`)
    ids.add(itemId)
    if (questionId !== null) {
      assert.ok(!questionIds.has(questionId), `duplicate CBT questionId ${questionId}`)
      questionIds.add(questionId)
    }
    items.push({ itemId, courseId, kind, questionId, sourceKey, parentItemId, payload })
    return itemId
  }

  for (const course of courses) {
    assertFields(course, ['id', 'contentKey', 'slug', 'code', 'title', 'overview', 'tagline',
      'level', 'semester', 'credits', 'difficulty', 'featured', 'examCritical', 'lecturer',
      'assessmentStructure', 'keyTakeaways', 'formulaSheet', 'textbooks', 'topics',
      'examFocus', 'resources'], `course ${course.contentKey}`)
    const courseId = byKey.get(course.contentKey)
    assert.ok(courseId, `missing registry identity for ${course.contentKey}`)
    assert.ok(!courseRows.some(row => row.courseId === courseId), `duplicate course ${courseId}`)
    courseRows.push({ contentKey: course.contentKey, slug: course.slug, courseId })
    assert.ok(course.overview, `missing course overview for ${course.contentKey}`)
    for (const topic of course.topics) assertFields(topic, ['chapter', 'description'], `topic ${course.contentKey}`)
    for (const takeaway of course.keyTakeaways ?? []) {
      assertFields(takeaway, ['title', 'description'], `takeaway ${course.contentKey}`)
    }
    for (const formula of course.formulaSheet ?? []) {
      assertFields(formula, ['name', 'formula', 'explanation', 'example'], `formula ${course.contentKey}`)
    }
    const overview = { title: course.title, body: course.overview,
      topics: course.topics, examFocus: course.examFocus }
    if (course.keyTakeaways !== undefined) overview.keyTakeaways = course.keyTakeaways
    if (course.formulaSheet !== undefined) overview.formulaSheet = course.formulaSheet
    append(courseId, 'course_overview', 'course-overview', overview)

    const topicNotes = notes[course.slug]
    if (topicNotes) {
      assertFields(topicNotes, ['courseSlug', 'courseCode', 'topics'], `notes ${course.slug}`)
      assert.equal(topicNotes.courseSlug, course.slug)
      assert.equal(topicNotes.courseCode, course.code)
      topicNotes.topics.forEach((note, index) => {
        assertFields(note, ['topicTitle', 'summary', 'keyPoints', 'examTip'], `note ${course.slug}:${index}`)
        const payload = { title: note.topicTitle, body: note.summary,
          noteType: 'topic_note', keyPoints: note.keyPoints }
        if (note.examTip !== undefined) payload.examTip = note.examTip
        append(courseId, 'note', `topic-note:${index + 1}`, payload)
      })
    }

    const quiz = quizzes[course.slug]
    assert.ok(quiz, `missing CBT bank for ${course.slug}`)
    assertFields(quiz, ['courseSlug', 'courseCode', 'title', 'totalQuestions',
      'maxQuizQuestions', 'quizDurationMinutes', 'sections', 'questions'], `quiz ${course.slug}`)
    assert.equal(quiz.courseSlug, course.slug)
    assert.equal(quiz.courseCode, course.code)
    assert.equal(quiz.totalQuestions, quiz.questions.length, `quiz totalQuestions ${course.slug}`)
    for (const question of quiz.questions) {
      assertFields(question, ['id', 'questionId', 'question', 'options', 'correctAnswer',
        'section', 'explanation'], `CBT ${course.slug}:${question.id}`)
      assert.match(question.questionId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      assert.ok(Number.isInteger(question.id) && question.id > 0)
      const payload = { prompt: question.question, options: question.options,
        correctOption: question.correctAnswer, section: question.section }
      if (question.explanation !== undefined) payload.explanation = question.explanation
      append(courseId, 'cbt_question', `quiz:${question.id}`, payload, question.questionId)
    }

    const theoryContent = theory[course.slug]
    if (theoryContent) {
      assertFields(theoryContent, ['courseSlug', 'courseCode', 'theoryQuestions',
        'calculatorTricks'], `theory ${course.slug}`)
      assert.equal(theoryContent.courseSlug, course.slug)
      assert.equal(theoryContent.courseCode, course.code)
      for (const question of theoryContent.theoryQuestions) {
        assertFields(question, ['id', 'question', 'answer', 'examTip'], `theory ${course.slug}:${question.id}`)
        assert.ok(Number.isInteger(question.id) && question.id > 0)
        const payload = { prompt: question.question }
        if (question.examTip !== undefined) payload.examTip = question.examTip
        const parentId = append(courseId, 'theory_question', `theory:${question.id}`, payload)
        append(courseId, 'model_answer', `theory-answer:${question.id}`,
          { body: question.answer }, null, parentId)
      }
      for (const trick of theoryContent.calculatorTricks) {
        assertFields(trick, ['id', 'title', 'description', 'example', 'formula'],
          `calculator trick ${course.slug}:${trick.id}`)
        assert.ok(Number.isInteger(trick.id) && trick.id > 0)
        const payload = { title: trick.title, body: trick.description,
          noteType: 'calculator_trick', example: trick.example }
        if (trick.formula !== undefined) payload.formula = trick.formula
        append(courseId, 'note', `calculator-trick:${trick.id}`, payload)
      }
    }
  }

  for (const key of byKey.keys()) {
    assert.ok(courseRows.some(row => row.contentKey === key), `unrepresented registry course ${key}`)
  }
  for (const [label, source] of [['quizzes', quizzes], ['notes', notes], ['theory', theory]]) {
    for (const slug of Object.keys(source)) {
      assert.ok(courseRows.some(row => row.slug === slug), `${label} has unknown course slug ${slug}`)
    }
  }
  return { actor: ACTOR, courses: courseRows, items }
}

module.exports = { buildManifest, loadSource }
