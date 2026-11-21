// lib/operator/structured-form.test.cjs — Seeded managed overview and note payloads round-trip through editor drafts.
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { buildManifest } = require('../../scripts/managed-content/source-manifest.cjs')
const { initialOverviewDraft, initialNoteDraft, notePayload, overviewPayload } = require('./structured-form.ts')
const { parseContentPayload } = require('./editor-contract.ts')

test('every seeded overview and note loads and saves without losing a supported field', () => {
  const manifest = buildManifest()
  const overviews = manifest.items.filter(item => item.kind === 'course_overview')
  const notes = manifest.items.filter(item => item.kind === 'note')
  assert.equal(overviews.length, 15)
  assert.equal(notes.length, 77)
  for (const item of overviews) {
    const draft = initialOverviewDraft(item.payload)
    assert.ok(draft, item.sourceKey)
    assert.deepEqual(overviewPayload(item.payload.title, item.payload.body, draft), item.payload,
      `overview ${item.courseId}`)
  }
  for (const item of notes) {
    const draft = initialNoteDraft(item.payload)
    assert.ok(draft, item.sourceKey)
    assert.deepEqual(notePayload(item.payload.title, item.payload.body, draft), item.payload,
      `note ${item.courseId}/${item.sourceKey}`)
  }
})

test('absent optional collections stay absent, while intentionally empty collections remain valid', () => {
  const minimal = { title: 'Course', body: 'Overview' }
  const loaded = initialOverviewDraft(minimal)
  assert.deepEqual(overviewPayload(minimal.title, minimal.body, loaded), minimal)
  const emptied = overviewPayload(minimal.title, minimal.body, { topics: [], examFocus: [],
    keyTakeaways: [], formulaSheet: [] })
  assert.deepEqual(parseContentPayload('course_overview', emptied), emptied)
  assert.equal(parseContentPayload('course_overview', { ...emptied, topics: Array(201).fill({
    chapter: '1', description: 'Too many',
  }) }), null)
})

test('an overview keeps its outcomes and assessment lists through an edit', () => {
  const payload = { title: 'Overview', body: 'Body', outcomes: ['Listen well', 'Write well'], assessment: ['Every topic is examinable.'] }
  assert.ok(parseContentPayload('course_overview', payload))
  const draft = initialOverviewDraft(payload)
  assert.deepEqual(draft.outcomes, payload.outcomes)
  assert.deepEqual(overviewPayload('Overview', 'Body', draft), payload)
})

test('a study guide topic is never loaded into a note form, so a save cannot drop its lessons', () => {
  const { isGuideTopic } = require('./structured-form.ts')
  const guide = { title: 'Listening', body: 'What to know', noteType: 'guide_topic', number: 1,
    mustKnow: [{ text: 'What to know' }],
    lessons: [{ number: '1.1', title: 'Lesson', mustKnow: [{ type: 'paragraph', text: [{ text: 'Must', bold: true }] }] }],
    recap: [{ type: 'list', ordered: false, items: [{ text: [{ text: 'Recap' }] }] }] }
  assert.ok(parseContentPayload('note', guide), 'a valid guide topic')
  assert.equal(isGuideTopic(guide), true)
  assert.equal(initialNoteDraft(guide), null)
  // The guide fields are refused on the older note types.
  assert.equal(parseContentPayload('note', { title: 'T', body: 'B', noteType: 'topic_note', keyPoints: ['a'], lessons: [] }), null)
  // Unknown block types, HTML-looking fields and stray keys are refused.
  for (const broken of [
    { ...guide, recap: [{ type: 'html', text: '<b>x</b>' }] },
    { ...guide, recap: [{ type: 'paragraph', text: [{ text: 'x', html: '<b>x</b>' }] }] },
    { ...guide, lessons: [] },
    { ...guide, practice: [{ topic: 'A', named: 'yes' }] },
    { ...guide, recap: [{ type: 'list', ordered: true, items: [{ text: [{ text: 'x' }] }] }] },
  ]) assert.equal(parseContentPayload('note', broken), null)
})
