// Read-only sizing against every published guide (including the course copies).
// Run: node -r ./lib/auth/test-loader.cjs scripts/campus-bot/chat-capacity.cjs
const { buildManifest, loadSource } = require('../managed-content/source-manifest.cjs')
const { buildImports } = require('../managed-content/official-banks.cjs')
const { overviewRevisions } = require('../managed-content/overview-revisions.cjs')
const { guidePlans, guideCopyPlans } = require('../managed-content/study-guides.cjs')
const { publishedBefore, publishedAfter, publishedWithCopies, ownerRulePlan } = require('../managed-content/owner-rule.cjs')
const { notesContextFromTopic } = require('../../lib/campus-bot/notes-context.ts')
const { buildAskPrompt } = require('../../lib/campus-bot/prompts.ts')
const { promptTokenBound, fitChatPrompt } = require('../../lib/campus-bot/model-call.ts')
const { CHAT_LIMITS } = require('../../lib/campus-bot/contract.ts')

const READ_CEILING = 18_000
const READ_ROUNDING = 500
// Match private.guide_inline_text, private.guide_blocks_text and private.note_passages_of.
const inline = spans => (spans ?? []).map(span => span.text ?? '').join('')
function blocks(values, depth = 0) {
  if (!Array.isArray(values) || depth > 6) return ''
  const indent = '  '.repeat(Math.min(Math.max(depth, 0), 6))
  let out = ''
  for (const block of values) {
    if (block.type === 'paragraph') out += indent + inline(block.text) + '\n'
    else if (block.type === 'preformatted') out += (block.text ?? '') + '\n'
    else if (block.type === 'list') {
      let number = /^\d{1,4}$/.test(String(block.start)) ? block.start : 1
      for (const item of block.items) {
        out += indent + (block.ordered ? number + '. ' : '- ') + inline(item.text) + '\n' + blocks(item.blocks, depth + 1)
        number++
      }
    } else if (block.type === 'table') {
      for (const row of [block.header, ...block.rows]) out += indent + row.map(inline).join(' | ') + '\n'
    }
  }
  return out
}
function passages(payload) {
  return [
    { heading: 'What you must know', body: (inline(payload.mustKnow) + '\n' + blocks(payload.introMore)).trim() },
    ...payload.lessons.map(lesson => ({ heading: [lesson.number, lesson.title].join(' ').trim(),
      body: (blocks(lesson.mustKnow) + blocks(lesson.explainMore)).trim() })),
    { heading: 'Recap', body: blocks(payload.recap).trim() },
  ].filter(row => row.body !== '')
}

/** The same final published state used by the managed-content parity tests. */
function publishedTopics() {
  const manifest = buildManifest()
  const { plans: banks, copies } = buildImports(manifest)
  const guides = guidePlans(manifest, banks, overviewRevisions(manifest))
  const guideCopies = guideCopyPlans(guides, copies, manifest)
  const catalogue = loadSource().courses
  const before = publishedBefore(manifest, banks, overviewRevisions(manifest), guides)
  const after = publishedWithCopies(publishedAfter(before, ownerRulePlan(before, guides)), copies,
    guideCopies)
  return after.courses.flatMap(course => {
    const repository = catalogue.find(row => row.contentKey === course.contentKey)
    const imported = [...banks, ...copies, ...guides, ...guideCopies].find(row => row.courseId === course.courseId)
    return course.kinds.note.map(note => ({ itemId: note.itemId,
      code: imported?.code ?? repository?.code ?? course.slug,
      courseTitle: repository?.title ?? imported?.course?.title ?? course.title ?? course.slug,
      payload: note.payload, passages: passages(note.payload) }))
  })
}

/** Size the current prompt with maximum valid fields, including a check on every bot turn and Explain again's rule.
 * The strict wire shape allows twelve bot messages, so this deliberately bounds that too.
 * An optional database snapshot uses the same shape as publishedTopics(), with SQL-extracted passages. */
function capacityReport(topics = publishedTopics()) {
  const history = Array.from({ length: CHAT_LIMITS.plusTurns }, () => ({ role: 'bot',
    text: 'x'.repeat(CHAT_LIMITS.turnChars), check: 'q'.repeat(CHAT_LIMITS.checkChars) }))
  const limits = { model: 'claude-haiku-5-5', maxInputTokens: READ_CEILING, maxOutputTokens: 1_500 }
  const rows = topics.map(topic => {
    const title = topic.payload.title
    const notes = notesContextFromTopic(title, topic.passages)
    if (notes === null) throw new Error(`No passages for ${topic.code}: ${title}`)
    const course = { code: topic.code, title: topic.courseTitle }
    const build = (context, turns) => buildAskPrompt(course, title, context, turns,
      'm'.repeat(CHAT_LIMITS.messageChars), true)
    const fitted = fitChatPrompt(notes, history, build, limits)
    return { itemId: topic.itemId, course: topic.code, topic: title,
      noteChars: notes.passages.reduce((sum, passage) => sum + passage.text.length, 0),
      fullInputBound: promptTokenBound(build(notes, history)),
      notesOnlyBound: promptTokenBound(build(notes, [])),
      keptMessages: fitted?.turns.length ?? 0,
      lostLessons: notes.passages.slice(fitted?.notes.passages.length ?? 0).map(passage => passage.heading) }
  })
  const largest = rows.reduce((a, b) => b.fullInputBound > a.fullInputBound ? b : a)
  const needed = Math.ceil(largest.fullInputBound / READ_ROUNDING) * READ_ROUNDING
  return { topics: rows.length, largest, fullHistoryReadRequired: needed,
    chosenRead: Math.min(needed, READ_CEILING), written: limits.maxOutputTokens,
    // The shipped tiers have weight 5 and the writing model Haiku has price weight 1.
    haikuReservation: Math.min(needed, READ_CEILING) + 5 * limits.maxOutputTokens,
    topicsWithShorterMemory: rows.filter(row => row.keptMessages < CHAT_LIMITS.plusTurns),
    notesLostAt18000: rows.filter(row => row.lostLessons.length > 0) }
}

if (require.main === module) {
  const fs = require('node:fs')
  const topics = process.argv[2] ? JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) : publishedTopics()
  process.stdout.write(JSON.stringify(capacityReport(topics), null, 2) + '\n')
}
module.exports = { capacityReport, passages, publishedTopics }
