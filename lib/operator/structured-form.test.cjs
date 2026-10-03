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
