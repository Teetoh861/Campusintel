// Repository/database bridge checks for the Phase C platform course registry.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  courses,
  getCourseByContentKey,
} = require('./courses.ts')

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260923100000_course_registry.sql',
)

// This bridge intentionally reads the Slice 1 registry seed. A later migration
// that adds course identities must extend this check to materialize that newer
// registry state rather than rewriting this immutable migration.
function readSeededRegistry() {
  const migration = fs.readFileSync(migrationPath, 'utf8')
  const insert = migration.match(
    /insert into public\.courses \(id, content_key, is_shared, is_free\)\s+values([\s\S]*?);\n\n-- -+\n-- Exact Department/,
  )
  assert.ok(insert, 'course registry seed statement must remain inspectable')

  return [...insert[1].matchAll(
    /\('[0-9a-f-]{36}',\s*'([^']+)',\s*(true|false|null),\s*(true|false)\)/g,
  )].map((match) => ({
    contentKey: match[1],
    isShared: match[2] === 'null' ? null : match[2] === 'true',
    isFree: match[3] === 'true',
  }))
}

test('all repository courses expose unique immutable content keys', () => {
  assert.equal(courses.length, 15)
  assert.equal(new Set(courses.map((course) => course.contentKey)).size, 15)
  assert.ok(courses.every((course) => Object.hasOwn(course, 'contentKey')))
})

test('the migration registry and repository catalogue contain the same courses', () => {
  const registry = readSeededRegistry()
  const databaseKeys = registry.map((row) => row.contentKey).toSorted()
  const repositoryKeys = courses.map((course) => course.contentKey).toSorted()

  assert.equal(registry.length, 15)
  assert.equal(new Set(databaseKeys).size, 15)
  assert.deepEqual(databaseKeys, repositoryKeys)
})

test('every database content key resolves to exactly one repository course', () => {
  for (const { contentKey } of readSeededRegistry()) {
    const matchingCourses = courses.filter(
      (course) => course.contentKey === contentKey,
    )
    assert.equal(matchingCourses.length, 1, contentKey)
    assert.equal(getCourseByContentKey(contentKey), matchingCourses[0])
  }

  assert.equal(getCourseByContentKey('not-a-course'), undefined)
})

test('shared and free registry properties are independently seeded', () => {
  const registry = readSeededRegistry()
  assert.ok(registry.some((row) => row.isShared && !row.isFree))
  assert.ok(registry.some((row) => row.isShared && row.isFree))
  assert.ok(registry.some((row) => row.isShared === false && !row.isFree))
  assert.ok(registry.some((row) => row.isShared === null && !row.isFree))
})
