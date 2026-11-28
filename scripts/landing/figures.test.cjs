// scripts/landing/figures.test.cjs — The landing figures are generated, current, and equal to what the content pipeline
// publishes for courses on the catalogue.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { CATALOGUE_MIGRATIONS, figuresModule, landingFigures, readyCourses } = require('./figures.cjs')
const { buildManifest } = require('../managed-content/source-manifest.cjs')
const { buildImports } = require('../managed-content/official-banks.cjs')
const { IMPORTS } = require('../managed-content/official-banks/imports.cjs')
const { overviewRevisions } = require('../managed-content/overview-revisions.cjs')
const { PRACTICE_RETIRED, ownerRulePlan, publishedAfter, publishedBefore } = require('../managed-content/owner-rule.cjs')
const { guidePlans } = require('../managed-content/study-guides.cjs')
const { GUIDE_IMPORTS } = require('../managed-content/study-guides/imports.cjs')

const ROOT = path.resolve(__dirname, '../..')
const MIGRATIONS = path.join(ROOT, 'supabase/migrations')

test('lib/landing/figures.ts is what the generator writes', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'lib/landing/figures.ts'), 'utf8'), figuresModule(landingFigures()),
    'lib/landing/figures.ts is stale; run node scripts/landing/figures.cjs')
})

test('the build generates the figures before it compiles the page', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(scripts.build, 'node scripts/auth/check-settings.cjs && node scripts/landing/figures.cjs && next build')
})

test('the figures equal what the content pipeline publishes for courses on the catalogue', () => {
  const manifest = buildManifest()
  const { plans } = buildImports(manifest)
  const revisions = overviewRevisions(manifest)
  const guides = guidePlans(manifest, plans, revisions)
  // The published question bank of every course after every migration: the official bank where one is imported, the
  // seeded bank otherwise, less what the owner content rule withdrew.
  const before = publishedBefore(manifest, plans, revisions, guides)
  const after = publishedAfter(before, ownerRulePlan(before, guides))
  const published = new Map(after.courses.map(course => [course.contentKey, course.kinds.cbt_question.length]))
  assert.equal(published.size, manifest.courses.length + plans.filter(plan => plan.shell).length + guides.filter(plan => plan.created).length)

  const ready = readyCourses()
  for (const course of ready) assert.equal(course.questions, published.get(course.key), course.key)
  assert.equal(new Set(ready.map(course => course.key)).size, ready.length)
  const counted = new Set(ready.map(course => course.key))
  // Every course that publishes a bank is counted. The one seeded course no catalogue course links to (BUA 222) is not
  // counted either way: no student can have it on their list, and the owner content rule withdrew its questions.
  assert.deepEqual([...published].filter(([key, size]) => size > 0 && !counted.has(key)).map(([key]) => key), [])
  assert.equal(counted.has('international-organisational-behaviour'), false)
  // A seeded bank the owner content rule withdrew counts as no bank.
  for (const slug of PRACTICE_RETIRED) assert.equal(published.get(slug), 0, slug)
  assert.deepEqual(PRACTICE_RETIRED.filter(slug => counted.has(slug)), [])

  const figures = landingFigures()
  assert.equal(figures.courses, ready.length)
  assert.equal(figures.questions, ready.reduce((sum, course) => sum + course.questions, 0))
  assert.ok(figures.courses > 0 && figures.questions > figures.courses && figures.departments > 0)
  assert.deepEqual(figures, { courses: 27, questions: 20988, departments: 8 }, 'the figures as decided on 22 November')
})

test('the catalogue is changed only by the migrations the figures were checked against', () => {
  const files = fs.readdirSync(MIGRATIONS)
  // Official bank migrations are generated, one per import, and counted from the import list.
  assert.deepEqual(files.filter(name => /_official_bank_/.test(name)).sort(),
    ['20261106090000_official_bank_rows.sql', ...IMPORTS.map(entry => entry.migration)].sort())
  const writes = /(?:insert into|update|delete from)\s+public\.(?:departments|courses|institutional_courses|course_applicability)\b/i
  // A study guide import that creates its course registers it and links its catalogue course through private.study_guide,
  // so its migration names neither table: the guide import list says which imports do.
  const creates = new Set(GUIDE_IMPORTS.filter(entry => entry.newCourse).map(entry => entry.migration))
  const writers = files.filter(name => !/_official_bank_/.test(name)
    && (creates.has(name) || writes.test(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8'))))
  assert.deepEqual(writers.sort(), Object.keys(CATALOGUE_MIGRATIONS).sort(),
    'another migration now changes the departments, the registry or the catalogue: check that scripts/landing/figures.cjs '
    + 'still counts the landing figures correctly, then add the migration to CATALOGUE_MIGRATIONS')
})
