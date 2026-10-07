// components/chrome/navigation.test.cjs — Restricted public chrome, shared session reconciliation and student-menu transitions.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { renderToStaticMarkup } = require('react-dom/server')
const { fixture, nodes } = require('./navigation.fixture.cjs')
const { AUTH_STATUS_EVENT } = require('../../lib/auth/constants.ts')

const header = f => renderToStaticMarkup(nodes(f.nav()).find(node => node.type === 'nav'))
const forbidden = /href="\/(?:courses|bookmarks|tutors|contact|materials|dashboard|account)"|Open menu/

const links = tree => nodes(tree).filter(node => node.props?.href)
  .map(node => [node.props.children, node.props.href])
const accountControls = f => nodes(f.nav()).filter(node => node.type?.name === 'NavigationAccountControls')
  .flatMap(node => nodes(node.type(node.props)))

function publicHeader(f) {
  const html = header(f)
  assert.match(html, /Campus.*Intell/)
  assert.match(html, /href="\/login"/)
  assert.match(html, /href="\/register"/)
  assert.doesNotMatch(html, forbidden)
  assert.equal((html.match(/<a /g) || []).length, 3, 'brand and two auth actions only')
  assert.equal(nodes(f.nav()).some(node => node.type === f.sheet.SheetContent), false)
}

test('initial, failed, malformed, disabled and signed-out session status never exposes app navigation', async () => fixture(async f => {
  publicHeader(f)
  for (const [body, status] of [[{ error: 'unavailable' }, 503], [{}, 200],
    [{ enabled: true, signedIn: 'yes' }, 200], [{ enabled: false, signedIn: true }, 200],
    [{ enabled: true, signedIn: false }, 200]]) {
    f.change(); publicHeader(f)
    await f.respond(body, status); publicHeader(f)
  }
  const footer = renderToStaticMarkup(f.footer())
  assert.doesNotMatch(footer, forbidden)
  assert.match(footer, /mailto:/)
}))

test('confirmed sign-in presents desktop study/account links and an accessible Sheet trigger', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  const html = header(f)
  for (const path of ['courses', 'bookmarks', 'tutors', 'contact', 'dashboard', 'account']) {
    assert.match(html, new RegExp(`href="/${path}"`))
  }
  assert.match(html, /Log out/)
  assert.ok(nodes(f.nav()).find(node => node.type === f.sheet.SheetTrigger))
  const content = nodes(f.nav()).find(node => node.type === f.sheet.SheetContent)
  assert.match(content.props.className, /overflow-y-auto/)
  assert.match(content.props.closeClassName, /h-11 w-11/)
  assert.match(renderToStaticMarkup(f.footer()), /href="\/courses"/)
  assert.equal(f.requests.length, 1, 'Header and Footer share one lookup')
}))

test('public and student auth actions independently retain compact sizes and outlined secondary variants', async () => fixture(async f => {
  const actions = () => accountControls(f).flatMap(node => node.type?.name === 'AuthNavActions'
    ? nodes(node.type(node.props)) : [node]).filter(node => node.props?.href)
  const check = (link, padding, border) => {
    const classes = new Set(link.props.className.split(/\s+/))
    for (const token of [padding, 'py-2', 'text-[14px]', border]) assert.ok(classes.has(token), `missing ${token}`)
    for (const token of ['px-5', 'py-2.5', 'text-[15px]']) assert.equal(classes.has(token), false, `conflicting ${token}`)
    if (border !== 'border-transparent') assert.equal(classes.has('border-transparent'), false)
  }
  check(actions().find(node => node.props.href === '/login'), 'px-2', 'border-student-navigation-outline')
  check(actions().find(node => node.props.href === '/register'), 'px-2', 'border-transparent')
  await f.respond({ enabled: true, signedIn: true })
  assert.equal(actions().length, 4, 'Dashboard and Account retain their header and Sheet presentations')
  for (const link of actions()) check(link, 'px-3', link.props.className.includes('border-student-navigation-outline')
    ? 'border-student-navigation-outline' : 'border-student-border-strong')
}))

test('current tablet/header and Sheet groups keep independent product membership and order', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  const groups = nodes(f.nav()).filter(node => node.type === 'div')
  const tablet = groups.find(node => node.props.className === 'ml-auto hidden items-center gap-1 tablet:flex desktop:hidden')
  const desktop = groups.find(node => node.props.className === 'ml-auto hidden items-center gap-1 desktop:flex')
  assert.deepEqual(links(tablet), [['Courses', '/courses'], ['Bookmarks', '/bookmarks']])
  assert.deepEqual(links(desktop), [
    ['Courses', '/courses'], ['Bookmarks', '/bookmarks'], ['Tutors', '/tutors'], ['Contact', '/contact'],
  ])
  const content = nodes(f.nav()).find(node => node.type === f.sheet.SheetContent)
  const study = nodes(content).find(node => node.props?.className === 'tablet:hidden')
  assert.deepEqual(links(study), [['Courses', '/courses'], ['Bookmarks', '/bookmarks']])
  const support = nodes(content).find(node => node.props?.className === 'border-t border-student-border pt-4')
  assert.deepEqual(links(support), [['Tutors', '/tutors'], ['Contact', '/contact']])
  const account = accountControls(f).filter(node => node.props?.href)
  assert.deepEqual(account.map(node => [node.props.children, node.props.href]), [
    ['Dashboard', '/dashboard'], ['Account', '/account'], ['Dashboard', '/dashboard'], ['Account', '/account'],
  ])
  assert.ok(account.every(node => node.props.prefetch === false))
}))

test('AuthNavActions owns only entry/logout while chrome composes ordinary product links', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  const authActions = accountControls(f).filter(node => node.type?.name === 'AuthNavActions')
  assert.equal(authActions.length, 2)
  for (const action of authActions) {
    const tree = action.type(action.props)
    assert.deepEqual(links(tree), [])
    assert.match(renderToStaticMarkup(tree), /Log out/)
  }
  const source = fs.readFileSync(path.join(__dirname, '../auth/AuthNavActions.tsx'), 'utf8')
  assert.doesNotMatch(source, /STUDENT_HOME_PATH|STUDENT_DESTINATIONS|STUDENT_NAVIGATION_GROUPS|AUTH_PATHS\.account|\/dashboard|\/account|\bDashboard\b/)
}))

test('Footer retains current labels/order and independent support links', async () => fixture(async f => {
  assert.deepEqual(links(f.footer()).map(([, href]) => href), ['/', 'mailto:support@campusintell.com'])
  await f.respond({ enabled: true, signedIn: true })
  assert.deepEqual(links(f.footer()).filter(([, href]) => href.startsWith('/') && href !== '/'), [
    ['Courses', '/courses'], ['Tutoring', '/tutors'], ['Bookmarks', '/bookmarks'],
    ['Contact', '/contact'], ['Apply to tutor', '/become-a-tutor'],
  ])
}))

test('nested course highlighting changes neither other links nor account action semantics', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  for (const pathname of ['/courses', '/courses/accounting/quiz', '/courses-other', '/bookmarks/nested']) {
    f.path(pathname)
    const current = nodes(f.nav()).filter(node => node.props?.['aria-current'] === 'page')
    assert.deepEqual(current.map(node => node.props.href), pathname.startsWith('/courses/') || pathname === '/courses'
      ? ['/courses', '/courses', '/courses'] : [])
  }
  assert.ok(accountControls(f).filter(node => node.props?.href).every(node => node.props['aria-current'] === undefined))
}))

test('student sheet closes on link navigation, route changes, desktop resize and session reconciliation', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  const open = () => { f.nav().props.onOpenChange(true); assert.equal(f.nav().props.open, true) }
  open()
  nodes(f.nav()).find(node => node.props?.href === '/contact' && node.props.onClick)?.props.onClick()
  assert.equal(f.nav().props.open, false)
  open(); f.path('/account'); f.nav()
  assert.equal(f.nav().props.open, false)
  open(); f.resize(1200)
  assert.equal(f.nav().props.open, false)
  open(); f.change(); publicHeader(f)
  await f.respond({ enabled: true, signedIn: true })
  assert.equal(f.nav().props.open, false, 'replacement sign-in cannot restore an old open sheet')
  open(); f.win.dispatchEvent(new Event(AUTH_STATUS_EVENT)); await f.settle(); publicHeader(f)
  await f.respond({ enabled: true, signedIn: false }); publicHeader(f)
  f.change(); await f.respond({ enabled: true, signedIn: true })
  assert.match(header(f), /href="\/dashboard"/)
}))

test('aborted delayed lookups cannot restore student navigation after sign-out or failure', async () => fixture(async f => {
  const stale = f.requests[0]
  f.change()
  assert.equal(stale.options.signal.aborted, true)
  await f.respond({ enabled: true, signedIn: false }); publicHeader(f)
  await f.respond({ enabled: true, signedIn: true }, 200, stale); publicHeader(f)
  f.change(); await f.respond({ enabled: true, signedIn: true })
  assert.equal(f.state().signedIn, true)
  f.change(); await f.respond({ error: 'unavailable' }, 503); publicHeader(f)
  assert.doesNotMatch(renderToStaticMarkup(f.footer()), forbidden)
}))

test('focus, visibility and browser restore invalidate shared navigation presentation', async () => fixture(async f => {
  for (const event of ['focus', 'pageshow']) {
    await f.respond({ enabled: true, signedIn: true })
    const restored = new Event(event)
    if (event === 'pageshow') Object.defineProperty(restored, 'persisted', { value: true })
    f.win.dispatchEvent(restored); await f.settle(); publicHeader(f)
  }
  await f.respond({ enabled: true, signedIn: true })
  f.doc.dispatchEvent(new Event('visibilitychange')); await f.settle(); publicHeader(f)
  assert.ok(f.requests.every(request => request.options.cache === 'no-store' && request.options.credentials === 'same-origin'))
}))
