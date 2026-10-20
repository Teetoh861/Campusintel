// components/student/student-course-row.test.cjs — One adapter from StudentCourse truth to the shared row, in product order.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const shelved = slug => ({ state: 'shelved', repositoryCourseId: `${slug}-repository`, contentKey: `${slug}-key`,
  isShared: false, route: { slug, href: `/courses/${slug}`, course: { slug } } })
const study = flags => ({ notes: false, cbtPractice: false, theory: false, overview: true, ...flags })
const course = (code, repository, content) => ({ institutionalCourseId: `${code}-id`, code,
  title: `${code} institutional title`, isFree: false, applicability: [], repository, content })
const ready = course('BUA201', shelved('resolved-slug'), { state: 'ready', study: study({ notes: true, theory: true, cbtPractice: true }) })
const unbuilt = course('BUA203', { state: 'unlinked' }, { state: 'not-built', reason: 'unlinked' })
const unshelved = course('BUA205', { state: 'unshelved-repository', repositoryCourseId: 'r', contentKey: 'k', isShared: null },
  { state: 'ready', study: study({ notes: true }) })
const noLearning = course('BUA207', shelved('empty-slug'), { state: 'no-published-learning', study: study({}) })
const unavailable = course('BUA209', shelved('failed-slug'), { state: 'temporarily-unavailable', reason: 'publication-read-failed' })
const anchors = html => [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map(match => match[0])

const subject = () => withTsx(() => ({ ...require('./StudentCourseRow.tsx'), ...require('./study-families.ts') }))
const render = async item => renderToStaticMarkup(React.createElement((await subject()).StudentCourseRow, { course: item }))

test('study families keep the locked product order and exact availability copy', async () => {
  const { STUDY_FAMILIES, STUDY_COPY, getStudyFamilyLabels } = await subject()
  assert.deepEqual(STUDY_FAMILIES.map(family => family.label), ['Notes', 'CBT practice', 'Theory'])
  assert.deepEqual(getStudyFamilyLabels(study({ theory: true, notes: true, cbtPractice: true })), ['Notes', 'CBT practice', 'Theory'])
  assert.deepEqual(getStudyFamilyLabels(study({ theory: true, overview: true })), ['Theory'])
  assert.deepEqual(getStudyFamilyLabels(study({ overview: true })), [], 'overview is never a study family')
  assert.equal(STUDY_COPY.notYetAvailable, 'Study materials are not available.')
  assert.equal(STUDY_COPY.temporarilyUnavailable, 'Study materials are temporarily unavailable.')
})

test('ready rows are one canonical link and advertise only existing families in product order', async () => {
  const html = await render(ready)
  assert.equal(anchors(html).length, 1)
  assert.ok(anchors(html)[0].includes('href="/courses/resolved-slug"'))
  assert.match(html, /student-focus-row/)
  assert.match(html, /BUA201 institutional title/)
  assert.match(html, /Notes · CBT practice · Theory/)
  assert.doesNotMatch(html, /Open course|Available:|Overview|Practice quiz|<button\b/)
  for (const [flags, expected] of [
    [{ notes: true, overview: false }, 'Notes'],
    [{ theory: true, overview: true }, 'Theory'],
    [{ cbtPractice: true, overview: true }, 'CBT practice'],
    [{ notes: true, cbtPractice: true }, 'Notes · CBT practice'],
    [{ notes: true, theory: true }, 'Notes · Theory'],
    [{ theory: true, cbtPractice: true, overview: true }, 'CBT practice · Theory'],
  ]) {
    const partial = await render({ ...ready, content: { ...ready.content, study: study(flags) } })
    assert.ok(partial.includes(`<p>${expected}</p>`), expected)
    assert.equal(partial.includes('Notes'), flags.notes === true, 'Notes follows study.notes, never the overview')
    assert.equal(anchors(partial).length, 1)
    assert.doesNotMatch(partial, /unavailable|disabled|<del\b/)
  }
})

test('unavailable identities stay inert: missing content gets the rail, lost route or publication the temporary mark', async () => {
  const { STUDY_COPY } = await subject()
  for (const item of [unbuilt, noLearning, unshelved, unavailable]) {
    const html = await render(item)
    assert.ok(html.includes(item.code) && html.includes(item.title))
    assert.doesNotMatch(html, /<a\b|<button\b|href=|chevron|tabindex=/)
    if (item === unbuilt || item === noLearning) {
      assert.match(html, /data-status="unavailable"/)
      assert.ok(html.includes(STUDY_COPY.notYetAvailable))
      assert.ok(!html.includes(STUDY_COPY.temporarilyUnavailable))
    } else {
      assert.ok(html.includes(STUDY_COPY.temporarilyUnavailable))
      assert.match(html, /student-course-row-error/)
      assert.doesNotMatch(html, /student-status-rail|Coming soon/)
      assert.ok(!html.includes(STUDY_COPY.notYetAvailable))
    }
  }
  const overviewOnlyReady = { ...ready, content: { state: 'ready', study: study({ overview: true }) } }
  assert.match(await render(overviewOnlyReady), /<p><\/p>/, 'the adapter never invents a label the model did not grant')
})

const repositoryOnly = (slug, content) => ({ repository: shelved(slug), content })
const repositoryTitle = course => ({ ...course, repository: { ...course.repository,
  route: { ...course.repository.route, course: { slug: course.repository.route.slug, title: 'Shelved repository title' } } } })

test('the serializable presentation adapter is the one derivation every consumer composes', async () => {
  const { presentStudentCourseRow } = await subject()
  assert.deepEqual(presentStudentCourseRow(ready), { code: 'BUA201', title: 'BUA201 institutional title',
    href: '/courses/resolved-slug', learningTypes: ['Notes', 'CBT practice', 'Theory'] })
  assert.deepEqual(presentStudentCourseRow(unbuilt), { code: 'BUA203', title: 'BUA203 institutional title', unavailable: 'missing' })
  assert.deepEqual(presentStudentCourseRow(unshelved), { code: 'BUA205', title: 'BUA205 institutional title', unavailable: 'temporary' })
  assert.deepEqual(presentStudentCourseRow(noLearning), { code: 'BUA207', title: 'BUA207 institutional title', unavailable: 'missing' })
  assert.deepEqual(presentStudentCourseRow(unavailable), { code: 'BUA209', title: 'BUA209 institutional title', unavailable: 'temporary' })
})

test('repository-only courses present honestly: shelved AND ready links, otherwise inert, never an invented code', async () => {
  const { presentStudentCourseRow } = await subject()
  const readyRepo = repositoryTitle(repositoryOnly('repo-slug', { state: 'ready', study: study({ cbtPractice: true }) }))
  assert.deepEqual(presentStudentCourseRow(readyRepo), { repositoryOnly: true, title: 'Shelved repository title',
    href: '/courses/repo-slug', learningTypes: ['CBT practice'] })
  const html = await render(readyRepo)
  assert.equal(anchors(html).length, 1)
  assert.match(html, /data-identity="repository">Additional study material</)
  assert.match(html, /Shelved repository title/)
  assert.doesNotMatch(html, /BUA|undefined/)
  const missing = repositoryTitle(repositoryOnly('repo-empty', { state: 'no-published-learning', study: study({}) }))
  assert.deepEqual(presentStudentCourseRow(missing), { repositoryOnly: true, title: 'Shelved repository title', unavailable: 'missing' })
  assert.match(await render(missing), /Study materials are not available\./)
  const temporary = repositoryTitle(repositoryOnly('repo-failed', { state: 'temporarily-unavailable', reason: 'projection-failed' }))
  assert.deepEqual(presentStudentCourseRow(temporary), { repositoryOnly: true, title: 'Shelved repository title', unavailable: 'temporary' })
  const inert = await render(temporary)
  assert.match(inert, /Study materials are temporarily unavailable\./)
  assert.doesNotMatch(inert, /<a\b|Try again/)
})

test('StudentCourseRow forwards a trailing action beside the row target without nesting it', async () => {
  const { StudentCourseRow } = await subject()
  const html = renderToStaticMarkup(React.createElement(StudentCourseRow, { course: ready,
    trailingAction: React.createElement('button', { type: 'button' }, 'Bookmark') }))
  assert.equal(anchors(html).length, 1)
  assert.doesNotMatch(anchors(html)[0], /<button/)
  assert.match(html, /student-course-row-action"><button/)
})

test('a locked row links to its course page, says it is included with full access, and offers no AI fallback', async () => {
  const locked = course('BUA211', shelved('locked-slug'), { state: 'locked' })
  const html = await render(locked)
  assert.equal(anchors(html).length, 1)
  assert.ok(anchors(html)[0].includes('href="/courses/locked-slug"'))
  assert.match(html, /Included with full access\./)
  assert.doesNotMatch(html, /Notes|CBT practice|Theory|Practise from your own notes|temporarily unavailable/)
  const { presentStudentCourseRow } = await subject()
  assert.deepEqual(presentStudentCourseRow(locked), { code: 'BUA211', title: 'BUA211 institutional title',
    href: '/courses/locked-slug', locked: true })
})
