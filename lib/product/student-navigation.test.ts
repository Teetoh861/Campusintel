// lib/product/student-navigation.test.ts — Independent contracts for shared destination identity, groups and matching.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { AUTH_PATHS, DEFAULT_AUTH_REDIRECT, STUDENT_HOME_PATH } from '@/lib/auth/constants'
import { isStudentDestinationActive, STUDENT_DESTINATIONS, STUDENT_FOOTER_GROUPS, STUDENT_NAVIGATION_GROUPS } from './student-navigation'

test('current destinations have unique semantic IDs and independent canonical href/label contracts', () => {
  assert.deepEqual(STUDENT_DESTINATIONS, {
    dashboard: { id: 'dashboard', href: '/dashboard', label: 'Dashboard' },
    myCourses: { id: 'myCourses', href: '/my-courses', label: 'My Courses' },
    courses: { id: 'courses', href: '/courses', label: 'All Courses' },
    bookmarks: { id: 'bookmarks', href: '/bookmarks', label: 'Bookmarks' },
    tutors: { id: 'tutors', href: '/tutors', label: 'Tutors' },
    contact: { id: 'contact', href: '/contact', label: 'Help & Support' },
    account: { id: 'account', href: '/account', label: 'Account' },
    materials: { id: 'materials', href: '/materials', label: 'Request Material' },
  })
  const ids = Object.values(STUDENT_DESTINATIONS).map(destination => destination.id)
  assert.equal(new Set(ids).size, 8)
  assert.equal(STUDENT_DESTINATIONS.bookmarks.label, 'Bookmarks')
})

test('locked desktop and menu navigation use canonical objects without contextual destinations or logout', () => {
  assert.deepEqual(Object.fromEntries(Object.entries(STUDENT_NAVIGATION_GROUPS)
    .map(([group, destinations]) => [group, destinations.map(destination => destination.id)])), {
    desktop: ['courses', 'tutors', 'contact', 'account'],
    menu: ['dashboard', 'courses', 'tutors', 'contact', 'account'],
  })
  for (const group of Object.values(STUDENT_NAVIGATION_GROUPS)) {
    for (const destination of group) assert.equal(destination, STUDENT_DESTINATIONS[destination.id])
  }
})

test('Footer subsets use canonical destinations and preserve their existing contextual labels', () => {
  assert.deepEqual(STUDENT_FOOTER_GROUPS.explore.map(({ destination, label }) =>
    [destination.id, destination.href, label]), [
    ['myCourses', '/my-courses', 'My Courses'], ['courses', '/courses', 'All Courses'], ['tutors', '/tutors', 'Tutoring'], ['bookmarks', '/bookmarks', 'Bookmarks'],
  ])
  assert.deepEqual(STUDENT_FOOTER_GROUPS.support.map(destination =>
    [destination.id, destination.href, destination.label]), [['contact', '/contact', 'Help & Support']])
  for (const { destination } of STUDENT_FOOTER_GROUPS.explore) {
    assert.equal(destination, STUDENT_DESTINATIONS[destination.id])
  }
  assert.equal(STUDENT_FOOTER_GROUPS.support[0], STUDENT_DESTINATIONS.contact)
})

test('only Courses retains descendant active matching and lookalike routes remain inactive', () => {
  for (const pathname of ['/courses', '/courses/', '/courses/accounting', '/courses/accounting/quiz']) {
    assert.equal(isStudentDestinationActive(pathname, STUDENT_DESTINATIONS.courses), true, pathname)
  }
  for (const pathname of ['/', '/course', '/courses-other', '/COURSES', '/courses?filter=all']) {
    assert.equal(isStudentDestinationActive(pathname, STUDENT_DESTINATIONS.courses), false, pathname)
  }
  for (const destination of Object.values(STUDENT_DESTINATIONS)) {
    assert.equal(isStudentDestinationActive(destination.href, destination), true)
    if (destination.id !== 'courses') {
      assert.equal(isStudentDestinationActive(`${destination.href}/nested`, destination), false)
    }
    assert.equal(isStudentDestinationActive('/unrelated', destination), false)
  }
})

test('auth destination aliases retain their existing routes without defining a second product href', () => {
  assert.equal(STUDENT_HOME_PATH, '/dashboard')
  assert.equal(DEFAULT_AUTH_REDIRECT, '/dashboard')
  assert.equal(AUTH_PATHS.account, '/account')
  assert.equal(STUDENT_HOME_PATH, STUDENT_DESTINATIONS.dashboard.href)
  assert.equal(AUTH_PATHS.account, STUDENT_DESTINATIONS.account.href)
})

test('navigation data has no authorization metadata or dependencies on auth/session boundaries', () => {
  for (const destination of Object.values(STUDENT_DESTINATIONS)) {
    assert.deepEqual(Object.keys(destination), ['id', 'href', 'label'])
  }
  const source = ts.createSourceFile('student-navigation.ts',
    readFileSync(join(__dirname, 'student-navigation.ts'), 'utf8'), ts.ScriptTarget.Latest)
  assert.equal(source.statements.some(ts.isImportDeclaration), false,
    'navigation remains independent of auth, profile, session, database and operator modules')
})
