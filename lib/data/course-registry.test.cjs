// Repository/database bridge checks for the separated Phase C course model.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  courses,
  getCourseByContentKey,
} = require('./courses.ts')

const repositoryMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260923100000_course_registry.sql',
)
const catalogueMigrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260923160000_institutional_course_catalogue.sql',
)

function readRepositorySeed() {
  const migration = fs.readFileSync(repositoryMigrationPath, 'utf8')
  const insert = migration.match(
    /insert into public\.courses \(id, content_key, is_shared, is_free\)\s+values([\s\S]*?);\n\n-- -+\n-- Exact Department/,
  )
  assert.ok(insert, 'repository content seed must remain inspectable')

  return [...insert[1].matchAll(
    /\('([0-9a-f-]{36})',\s*'([^']+)',\s*(true|false|null),\s*(true|false)\)/g,
  )].map((match) => ({
    id: match[1],
    contentKey: match[2],
    isShared: match[3] === 'null' ? null : match[3] === 'true',
  }))
}

function readCatalogueSeed() {
  const migration = fs.readFileSync(catalogueMigrationPath, 'utf8')
  const insert = migration.match(
    /insert into public\.institutional_courses \([\s\S]*?\)\s*values([\s\S]*?);\n\n-- -+\n-- Applicability/,
  )
  assert.ok(insert, 'institutional catalogue seed must remain inspectable')

  return [...insert[1].matchAll(
    /\('([0-9a-f-]{36})',\s*'([^']+)',\s*'([^']+)',\s*(null|'[0-9a-f-]{36}'),\s*(true|false)\)/g,
  )].map((match) => ({
    id: match[1],
    courseCode: match[2],
    displayTitle: match[3],
    repositoryCourseId: match[4] === 'null' ? null : match[4].slice(1, -1),
    isFree: match[5] === 'true',
  }))
}

function readApplicabilitySeedShape() {
  const migration = fs.readFileSync(catalogueMigrationPath, 'utf8')
  const section = migration.match(
    /with section_applicability \([\s\S]*?\) as \(\s*values([\s\S]*?)\n\),\nfaculty_wide_gst/,
  )
  const gst = migration.match(
    /from \(\s*values([\s\S]*?)\n  \) as gst\(course_code, academic_level_key, academic_period_key\)/,
  )
  assert.ok(section, 'six-section applicability seed must remain inspectable')
  assert.ok(gst, 'faculty-wide GST seed must remain inspectable')

  const sectionRows = [...section[1].matchAll(
    /\('([^']+)', '([^']+)', '([^']+)', '([^']+)'\)/g,
  )].map((match) => match.slice(1))
  const gstRows = [...gst[1].matchAll(
    /\('([^']+)', '([^']+)', '([^']+)'\)/g,
  )].map((match) => match.slice(1))
  return { sectionRows, gstRows }
}

test('all repository courses expose the same fifteen immutable content keys', () => {
  const registry = readRepositorySeed()
  const databaseKeys = registry.map((row) => row.contentKey).toSorted()
  const repositoryKeys = courses.map((course) => course.contentKey).toSorted()

  assert.equal(courses.length, 15)
  assert.equal(new Set(repositoryKeys).size, 15)
  assert.equal(registry.length, 15)
  assert.deepEqual(databaseKeys, repositoryKeys)
  assert.ok(courses.every((course) => Object.hasOwn(course, 'contentKey')))
})

test('every database content key resolves to exactly one repository course', () => {
  for (const { contentKey } of readRepositorySeed()) {
    const matchingCourses = courses.filter(
      (course) => course.contentKey === contentKey,
    )
    assert.equal(matchingCourses.length, 1, contentKey)
    assert.equal(getCourseByContentKey(contentKey), matchingCourses[0])
  }

  assert.equal(getCourseByContentKey('not-a-course'), undefined)
})

test('the correction preserves the content registry instead of seeding placeholders', () => {
  const correction = fs.readFileSync(catalogueMigrationPath, 'utf8')

  assert.doesNotMatch(correction, /insert into public\.courses/i)
  assert.match(correction, /alter table public\.courses\s+drop column is_free/)
  assert.equal(readRepositorySeed().length, courses.length)
})

test('the institutional seed contains 101 stable exact code/title identities', () => {
  const catalogue = readCatalogueSeed()

  assert.equal(catalogue.length, 101)
  assert.equal(new Set(catalogue.map((row) => row.id)).size, 101)
  assert.equal(
    new Set(catalogue.map((row) => `${row.courseCode}\u0000${row.displayTitle}`)).size,
    101,
  )
})

test('only the eleven confirmed institutional identities link to content', () => {
  const repositoryById = new Map(
    readRepositorySeed().map((row) => [row.id, row.contentKey]),
  )
  const actualLinks = Object.fromEntries(
    readCatalogueSeed()
      .filter((row) => row.repositoryCourseId)
      .map((row) => [row.courseCode, repositoryById.get(row.repositoryCourseId)]),
  )

  assert.deepEqual(actualLinks, {
    GST111: 'use-of-english',
    GST112: 'nigerian-peoples-and-culture',
    ENT211: 'entrepreneurship-innovation',
    GST212: 'philosophy-logic-human-existence',
    BUA201: 'principles-business-administration',
    BUA203: 'business-statistics',
    BUA205: 'leadership-governance',
    BUA202: 'principles-business-administration-2',
    BUA204: 'quantitative-analysis-management',
    BUA216: 'introduction-financial-management',
    BUA218: 'bua218',
  })
  assert.equal(new Set(Object.values(actualLinks)).size, 11)
})

test('the four known runtime-to-catalogue aliases remain unresolved', () => {
  const catalogueByCode = new Map(
    readCatalogueSeed().map((row) => [row.courseCode, row]),
  )
  const repositoryByCode = new Map(courses.map((course) => [course.code, course]))
  const unresolved = [
    ['BUA210', 'LAG-BUA210'],
    ['BUA221', 'LAG-BUA221'],
    ['ACC201', 'ACC-CM201'],
    ['BUA222', 'LAG-BUA222'],
  ]

  for (const [runtimeCode, catalogueCode] of unresolved) {
    assert.ok(repositoryByCode.has(runtimeCode), runtimeCode)
    assert.equal(catalogueByCode.get(catalogueCode)?.repositoryCourseId, null)
  }
})

test('source applicability arithmetic is explicit rather than content-derived', () => {
  const { sectionRows, gstRows } = readApplicabilitySeedShape()

  assert.equal(sectionRows.length, 164)
  assert.equal(gstRows.length, 4)
  assert.equal(sectionRows.length + (gstRows.length * 8), 196)
  assert.deepEqual(gstRows.map(([code]) => code).toSorted(), [
    'GST102', 'GST111', 'GST112', 'GST212',
  ])
})

test('free and shared remain independent properties with separate owners', () => {
  const freeCatalogueCodes = readCatalogueSeed()
    .filter((row) => row.isFree)
    .map((row) => row.courseCode)
    .toSorted()
  const gst102 = readCatalogueSeed().find((row) => row.courseCode === 'GST102')
  const repository = readRepositorySeed()

  assert.deepEqual(freeCatalogueCodes, ['GST102', 'GST111', 'GST112', 'GST212'])
  assert.equal(gst102?.repositoryCourseId, null)
  assert.ok(repository.some((row) => row.isShared === true))
  assert.ok(repository.some((row) => row.isShared === false))
  assert.ok(repository.some((row) => row.isShared === null))
})
