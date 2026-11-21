// scripts/managed-content/source-manifest.test.cjs — Source identity, field, and generated-artifact parity.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const { test } = require('node:test')
const { buildManifest, loadSource } = require('./source-manifest.cjs')

const ROOT = path.resolve(__dirname, '../..')

test('all 15 repository courses and all live learning records map without identity loss', () => {
  const { courses, quizzes, theory, notes } = loadSource()
  const manifest = buildManifest()
  const byCourse = new Map(manifest.courses.map(row => [row.slug, row.courseId]))
  assert.equal(byCourse.size, 15)
  assert.equal(manifest.items.length, 3247)
  assert.deepEqual(Object.fromEntries(['course_overview', 'note', 'cbt_question',
    'theory_question', 'model_answer', 'rubric'].map(kind =>
    [kind, manifest.items.filter(item => item.kind === kind).length])), {
    course_overview: 15, note: 77, cbt_question: 3115,
    theory_question: 20, model_answer: 20, rubric: 0,
  })

  for (const course of courses) {
    const courseId = byCourse.get(course.slug)
    assert.ok(courseId, `missing ${course.slug}`)
    assert.equal(manifest.courses.find(row => row.slug === course.slug).contentKey, course.contentKey)
    const items = manifest.items.filter(item => item.courseId === courseId)
    const overview = items.find(item => item.kind === 'course_overview')
    assert.deepEqual(overview.payload, {
      title: course.title, body: course.overview, topics: course.topics,
      examFocus: course.examFocus,
      ...(course.keyTakeaways === undefined ? {} : { keyTakeaways: course.keyTakeaways }),
      ...(course.formulaSheet === undefined ? {} : { formulaSheet: course.formulaSheet }),
    })
    assert.equal(items.filter(item => item.kind === 'course_overview').length, 1)
    assert.ok(!('resources' in overview.payload) && !('textbooks' in overview.payload)
      && !('assessmentStructure' in overview.payload))

    const sourceQuiz = quizzes[course.slug]
    const migratedQuestions = items.filter(item => item.kind === 'cbt_question')
    assert.equal(migratedQuestions.length, sourceQuiz.questions.length, course.slug)
    assert.deepEqual(new Set(migratedQuestions.map(item => item.questionId)),
      new Set(sourceQuiz.questions.map(question => question.questionId)))
    for (const question of sourceQuiz.questions) {
      const migrated = migratedQuestions.find(item => item.sourceKey === `quiz:${question.id}`)
      assert.ok(migrated, `${course.slug} CBT ${question.id}`)
      assert.equal(migrated.questionId, question.questionId)
      assert.deepEqual(migrated.payload, {
        prompt: question.question, options: question.options,
        correctOption: question.correctAnswer, section: question.section,
        ...(question.explanation === undefined ? {} : { explanation: question.explanation }),
      })
    }

    for (const [index, sourceNote] of (notes[course.slug]?.topics ?? []).entries()) {
      const migrated = items.find(item => item.kind === 'note'
        && item.sourceKey === `topic-note:${index + 1}`)
      assert.ok(migrated)
      assert.deepEqual(migrated.payload, {
        title: sourceNote.topicTitle, body: sourceNote.summary,
        noteType: 'topic_note', keyPoints: sourceNote.keyPoints,
        ...(sourceNote.examTip === undefined ? {} : { examTip: sourceNote.examTip }),
      })
    }

    for (const question of theory[course.slug]?.theoryQuestions ?? []) {
      const migrated = items.find(item => item.kind === 'theory_question'
        && item.sourceKey === `theory:${question.id}`)
      const answer = items.find(item => item.kind === 'model_answer'
        && item.sourceKey === `theory-answer:${question.id}`)
      assert.ok(migrated && answer)
      assert.deepEqual(migrated.payload, {
        prompt: question.question,
        ...(question.examTip === undefined ? {} : { examTip: question.examTip }),
      })
      assert.equal(answer.parentItemId, migrated.itemId)
      assert.deepEqual(answer.payload, { body: question.answer })
    }
    for (const trick of theory[course.slug]?.calculatorTricks ?? []) {
      const migrated = items.find(item => item.kind === 'note'
        && item.sourceKey === `calculator-trick:${trick.id}`)
      assert.ok(migrated)
      assert.deepEqual(migrated.payload, {
        title: trick.title, body: trick.description,
        noteType: 'calculator_trick', example: trick.example,
        ...(trick.formula === undefined ? {} : { formula: trick.formula }),
      })
    }
  }
})

test('generated SQL and DB parity snapshots are current with committed sources', () => {
  const result = spawnSync(process.execPath, ['scripts/managed-content/generate.cjs', '--check'],
    { cwd: ROOT, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
