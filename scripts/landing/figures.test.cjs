// scripts/landing/figures.test.cjs — The landing figures are generated, current, and equal to what the content pipeline
// publishes for courses on the catalogue.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { CATALOGUE_MIGRATIONS, figuresModule, landingFigures, readyCourses } = require('./figures.cjs')
const { buildManifest } = require('../managed-content/source-manifest.cjs')
const { buildImports, publishedCbt } = require('../managed-content/official-banks.cjs')
const { IMPORTS } = require('../managed-content/official-banks/imports.cjs')

const ROOT = path.resolve(__dirname, '../..')
const MIGRATIONS = path.join(ROOT, 'supabase/migrations')

test('lib/landing/figures.ts is what the generator writes', () => {
  assert.equal(fs.readFileSync(path.join(ROOT, 'lib/landing/figures.ts'), 'utf8'), figuresModule(landingFigures()),
    'lib/landing/figures.ts is stale; run node scripts/landing/figures.cjs')
})

test('the build generates the figures before it compiles the page', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  assert.equal(scripts.build, 'node scripts/landing/figures.cjs && next build')
})

test('the figures equal what the content pipeline publishes for courses on the catalogue', () => {
  const manifest = buildManifest()
  const { plans } = buildImports(manifest)
  const imported = new Map(plans.map(plan => [plan.courseId, plan]))
  // The published question bank of every course: the official bank where one is imported, the seeded bank otherwise.
  const published = new Map()
  for (const course of manifest.courses) {
    const plan = imported.get(course.courseId)
    published.set(course.contentKey, plan ? publishedCbt(plan).length
      : manifest.items.filter(item => item.courseId === course.courseId && item.kind === 'cbt_question').length)
  }
  for (const plan of plans.filter(plan => plan.shell)) published.set(plan.slug, publishedCbt(plan).length)
  assert.equal(published.size, manifest.courses.length + plans.filter(plan => plan.shell).length)

  const ready = readyCourses()
  for (const course of ready) assert.equal(course.questions, published.get(course.key), course.key)
  assert.equal(new Set(ready.map(course => course.key)).size, ready.length)
  // Every course with a bank is counted, except the one seeded course no catalogue course links to (BUA 222): no
  // student can have it on their list, so the page does not count it.
  const counted = new Set(ready.map(course => course.key))
  assert.deepEqual([...published.keys()].filter(key => !counted.has(key)), ['international-organisational-behaviour'])

  const figures = landingFigures()
  assert.equal(figures.courses, ready.length)
  assert.equal(figures.questions, ready.reduce((sum, course) => sum + course.questions, 0))
  assert.ok(figures.courses > 0 && figures.questions > figures.courses && figures.departments > 0)
})

test('the catalogue is changed only by the migrations the figures were checked against', () => {
  const files = fs.readdirSync(MIGRATIONS)
  // Official bank migrations are generated, one per import, and counted from the import list.
  assert.deepEqual(files.filter(name => /_official_bank_/.test(name)).sort(),
    ['20261106090000_official_bank_rows.sql', ...IMPORTS.map(entry => entry.migration)].sort())
  const writes = /(?:insert into|update|delete from)\s+public\.(?:departments|courses|institutional_courses|course_applicability)\b/i
  const writers = files.filter(name => !/_official_bank_/.test(name) && writes.test(fs.readFileSync(path.join(MIGRATIONS, name), 'utf8')))
  assert.deepEqual(writers.sort(), Object.keys(CATALOGUE_MIGRATIONS).sort(),
    'another migration now changes the departments, the registry or the catalogue: check that scripts/landing/figures.cjs '
    + 'still counts the landing figures correctly, then add the migration to CATALOGUE_MIGRATIONS')
})
