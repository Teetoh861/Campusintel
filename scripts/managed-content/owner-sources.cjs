// scripts/managed-content/owner-sources.cjs — The content-build check of the owner content rule (owner-rule.cjs, decision
// A13): generation fails unless everything published after every migration comes from the owner's files.
//   1. Every published note is a study guide topic.
//   2. Every published CBT question is in an official bank import's published set.
//   3. No theory question, model answer or rubric is published, until the owner's own theory source exists.
//   4. Every published overview key other than the title has a source: a guide course's outcomes, how it is assessed,
//      and a text that is the guide's examinable line (or AMS 101's line about the exam); a handoff course's paragraph
//      and syllabus list (and BUA 204's formula sheet). Nothing else.
//   5. Every course's reading list is empty, until the owner supplies checked titles.
const { publishedCbt } = require('./official-banks.cjs')
const { EXAMINABLE_LINES, OVERVIEW_TEXT } = require('./study-guides.cjs')

// The handoff courses, whose overview paragraph and syllabus list come from the owner's handoff document for the course.
// The names of the 7 handoff documents are recorded below, in `document`.
const HANDOFF = {
  'nigerian-peoples-and-culture': { code: 'GST112', document: 'GST112 course schema document (owner handoff)', keys: ['body', 'topics'] },
  'international-organisational-behaviour': { code: 'BUA222', document: 'BUA222 course schema document (owner handoff)', keys: ['body', 'topics'] },
  'principles-business-administration-2': { code: 'BUA202', document: 'BUA202 course schema document (owner handoff)', keys: ['body', 'topics'] },
  'quantitative-analysis-management': { code: 'BUA204', document: 'BUA204_Schema.pdf (owner handoff)', keys: ['body', 'topics', 'formulaSheet'] },
  'philosophy-logic-human-existence': { code: 'GST212', document: 'GST212_Schema.docx (owner handoff)', keys: ['body', 'topics'] },
  'introduction-financial-management': { code: 'BUA216', document: 'BUA216 course schema document (owner handoff)', keys: ['body', 'topics'] },
  bua218: { code: 'BUA218', document: 'BUA218 course schema document (owner handoff)', keys: ['body', 'topics'] },
}

const RULES = {
  1: 'rule 1: every published note is a study guide topic',
  2: "rule 2: every published CBT question is in an official bank import's published set",
  3: 'rule 3: no theory question, model answer or rubric is published',
  4: "rule 4: every published overview key other than the title comes from the owner's files",
  5: "rule 5: every course's reading list is empty",
}

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right)

/** Every way the published content breaks the rule, each naming the course, the kind, the source key (or overview key)
 *  and the rule. `state` is the published state (owner-rule.cjs publishedBefore or publishedAfter); `courses` are the
 *  app's courses with their reading lists. */
function ownerSourceFailures(state, bankPlans, guides, courses) {
  const failures = []
  const fail = (slug, kind, key, rule) => failures.push(`${slug} ${kind} ${key}: ${RULES[rule]}`)
  const banks = new Map(bankPlans.map(plan => [plan.courseId, new Map(publishedCbt(plan).map(record => [record.itemId, record]))]))
  const guideByCourse = new Map(guides.map(plan => [plan.courseId, plan]))
  const guideNotes = new Map(guides.flatMap(plan => plan.notes.map(note => [note.itemId, note])))
  for (const course of state.courses) {
    const { slug } = course
    for (const record of course.kinds.note) {
      const note = guideNotes.get(record.itemId)
      if (!note || record.payload.noteType !== 'guide_topic' || !same(note.payload, record.payload)) {
        fail(slug, 'note', record.sourceKey, 1)
      }
    }
    const bank = banks.get(course.courseId)
    for (const record of course.kinds.cbt_question) {
      const official = bank?.get(record.itemId)
      if (!official || official.revision !== record.revision || !same(official.payload, record.payload)) {
        fail(slug, 'cbt_question', record.sourceKey, 2)
      }
    }
    for (const kind of ['theory_question', 'model_answer', 'rubric']) {
      for (const record of course.kinds[kind]) fail(slug, kind, record.sourceKey, 3)
    }
    for (const record of course.kinds.course_overview) {
      const keys = Object.keys(record.payload).filter(key => key !== 'title')
      const guide = guideByCourse.get(course.courseId)
      if (guide) {
        // The guide's own lines: its examinable line (or the line used in its place) and the rest of how it is assessed.
        const after = guide.overview.after
        const lines = guide.overview.create ? [after.body, ...after.assessment] : after.assessment
        const body = record.payload.body
        const text = OVERVIEW_TEXT[guide.code] === undefined ? EXAMINABLE_LINES.includes(body) : body === OVERVIEW_TEXT[guide.code]
        for (const key of keys) {
          const sourced = key === 'body' ? text && lines.includes(body)
            : key === 'outcomes' ? same(record.payload.outcomes, after.outcomes)
              : key === 'assessment' ? same(record.payload.assessment, lines.filter(line => line !== body)) : false
          if (!sourced) fail(slug, 'course_overview', key, 4)
        }
      } else {
        const handoff = Object.hasOwn(HANDOFF, slug) ? HANDOFF[slug] : null
        for (const key of keys) if (!handoff?.keys.includes(key)) fail(slug, 'course_overview', key, 4)
      }
    }
  }
  for (const course of courses) {
    const titles = (course.textbooks ?? []).length
    if (titles) fail(course.slug, 'textbooks', `(${titles} ${titles === 1 ? 'title' : 'titles'})`, 5)
  }
  return failures
}

/** Stop generation, naming every failure, unless everything published comes from the owner's files. */
function checkOwnerSources(state, bankPlans, guides, courses) {
  const failures = ownerSourceFailures(state, bankPlans, guides, courses)
  if (failures.length) {
    throw new Error(`Published content that is not from the owner's files (${failures.length}):\n${failures.join('\n')}`)
  }
}

module.exports = { HANDOFF, RULES, checkOwnerSources, ownerSourceFailures }
