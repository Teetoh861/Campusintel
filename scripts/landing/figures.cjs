// scripts/landing/figures.cjs — The landing page's course figures, counted from the repository's own content.
// The build runs this first (package.json "build"), so the page shows what the repository publishes and nothing is typed in.
//   node scripts/landing/figures.cjs           write lib/landing/figures.ts
//   node scripts/landing/figures.cjs --check   fail when the committed file is stale
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { IMPORTS } = require('../managed-content/official-banks/imports.cjs')

const ROOT = path.resolve(__dirname, '../..')
const MIGRATIONS = 'supabase/migrations'
const OUTPUT = path.join(ROOT, 'lib/landing/figures.ts')
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** The hand-written migrations that change the departments, the course registry or the catalogue, and what each one
 *  means for these figures. figures.test.cjs fails when another migration starts writing those tables, so the figures
 *  are looked at again whenever the catalogue changes. Official bank migrations are generated and counted from IMPORTS. */
const CATALOGUE_MIGRATIONS = {
  '20260918190000_profile_reference_data.sql': 'the departments',
  '20260923100000_course_registry.sql': 'the seeded courses',
  '20260923160000_institutional_course_catalogue.sql': 'the catalogue and its first content links',
  '20260930100000_master_course_catalog_v1_1.sql': 'more catalogue courses',
  '20261002110000_operator_content_editor.sql': 'operator functions only; nothing changes when it is applied',
  '20261020100000_bua_300l_catalogue_correction.sql': 'more catalogue courses',
  '20261025120000_link_first_semester_courses.sql': 'three more content links',
}
const CATALOGUE_COURSES = ['20260923160000_institutional_course_catalogue.sql', '20260930100000_master_course_catalog_v1_1.sql',
  '20261020100000_bua_300l_catalogue_correction.sql']
const CATALOGUE_LINKS = '20261025120000_link_first_semester_courses.sql'

const migration = name => fs.readFileSync(path.join(ROOT, MIGRATIONS, name), 'utf8')

/** Active departments in the reference seed. */
function departments() {
  const seed = /insert into public\.departments[^;]*;/.exec(migration('20260918190000_profile_reference_data.sql'))
  assert.ok(seed, 'the departments seed must stay readable')
  const rows = [...seed[0].matchAll(new RegExp(`\\('${UUID}',\\s*'[a-z-]+',\\s*'[^']+',\\s*(true|false),\\s*\\d+\\)`, 'g'))]
  assert.ok(rows.length > 0, 'the departments seed has no rows')
  return rows.filter(row => row[1] === 'true').length
}

/** Seeded question banks by course key; lib/data/quizzes.ts states each bank's size. */
function seedBanks() {
  const source = fs.readFileSync(path.join(ROOT, 'lib/data/quizzes.ts'), 'utf8')
  const banks = new Map()
  for (const [, key, size] of source.matchAll(/courseSlug:\s*['"]([a-z0-9-]+)['"],\s*courseCode:\s*['"][^'"]+['"],[\s\S]*?totalQuestions:\s*(\d+),/g)) {
    assert.ok(!banks.has(key), `two seeded banks for ${key}`)
    banks.set(key, Number(size))
  }
  return banks
}

/** The seeded courses: registry id to course key. */
function registry() {
  const rows = [...migration('20260923100000_course_registry.sql')
    .matchAll(new RegExp(`\\('(${UUID})',\\s*'([a-z0-9-]+)',\\s*(?:true|false|null),\\s*(?:true|false)\\)`, 'g'))]
  assert.ok(rows.length > 0, 'the course registry seed must stay readable')
  return new Map(rows.map(row => [row[1], row[2]]))
}

/** Registry ids a catalogue course links to. Only a linked course can be on a student's list. */
function linkedRegistryIds() {
  const linked = new Set()
  const course = new RegExp(`\\('${UUID}',\\s*'[^']+',\\s*'(?:[^']|'')+',\\s*(null|'${UUID}'),\\s*(?:true|false)\\)`, 'g')
  for (const name of CATALOGUE_COURSES) {
    const rows = [...migration(name).matchAll(course)]
    assert.ok(rows.length > 0, `${name}: no catalogue courses read`)
    for (const row of rows) if (row[1] !== 'null') linked.add(row[1].slice(1, -1))
  }
  const links = [...migration(CATALOGUE_LINKS)
    .matchAll(new RegExp(`\\('${UUID}'::uuid,\\s*'[^']+',\\s*'[^']+',\\s*'[a-z0-9-]+',\\s*'(${UUID})'::uuid\\)`, 'g'))]
  assert.ok(links.length > 0, `${CATALOGUE_LINKS}: no links read`)
  for (const link of links) linked.add(link[1])
  return linked
}

/** Every course a student can have on their list that publishes a question bank, with the size of that bank. */
function readyCourses() {
  const banks = seedBanks()
  const seeded = registry()
  const seededKeys = new Set(seeded.values())
  const linked = linkedRegistryIds()
  const imported = new Map(IMPORTS.map(entry => [entry.contentKey, entry]))
  assert.equal(imported.size, IMPORTS.length, 'one import per course')
  for (const id of linked) assert.ok(seeded.has(id), `catalogue link to an unknown course ${id}`)
  const ready = []
  for (const [id, key] of seeded) {
    assert.ok(banks.has(key), `no seeded bank for ${key}`)
    // An official bank replaces the seeded one; `bank` is the audited size the import publishes.
    const questions = imported.get(key)?.expected.bank ?? banks.get(key)
    if (linked.has(id) && questions > 0) ready.push({ key, questions })
  }
  for (const entry of IMPORTS) {
    if (seededKeys.has(entry.contentKey)) {
      assert.ok(!entry.newCourse, `${entry.contentKey} is seeded, not new`)
      continue
    }
    // A course created for its official bank: its migration registers it and links its catalogue course.
    assert.equal(entry.newCourse, true, `${entry.contentKey} has no seeded course`)
    if (entry.expected.bank > 0) ready.push({ key: entry.contentKey, questions: entry.expected.bank })
  }
  return ready.sort((a, b) => (a.key < b.key ? -1 : 1))
}

/** The three figures on the landing page. */
function landingFigures() {
  const ready = readyCourses()
  return { courses: ready.length, questions: ready.reduce((sum, course) => sum + course.questions, 0), departments: departments() }
}

function figuresModule(figures) {
  return `// lib/landing/figures.ts — GENERATED by scripts/landing/figures.cjs from the repository's content; do not edit.
// Courses a student can have on their list that publish a question bank, the questions in those banks, and the
// faculty's departments. The build writes this file again before it compiles the page.
export const LANDING_FIGURES = { courses: ${figures.courses}, questions: ${figures.questions}, departments: ${figures.departments} } as const
`
}

module.exports = { CATALOGUE_MIGRATIONS, figuresModule, landingFigures, readyCourses }

if (require.main === module) {
  const generated = figuresModule(landingFigures())
  if (process.argv[2] === '--check') {
    assert.ok(fs.existsSync(OUTPUT), 'lib/landing/figures.ts is missing; run node scripts/landing/figures.cjs')
    assert.equal(fs.readFileSync(OUTPUT, 'utf8'), generated, 'lib/landing/figures.ts is stale; run node scripts/landing/figures.cjs')
    process.stdout.write('lib/landing/figures.ts matches the repository content.\n')
  } else if (process.argv.length === 2) {
    fs.writeFileSync(OUTPUT, generated)
    process.stdout.write(`Landing figures: ${JSON.stringify(landingFigures())}\n`)
  } else {
    process.stderr.write('Usage: node scripts/landing/figures.cjs [--check]\n')
    process.exitCode = 2
  }
}
