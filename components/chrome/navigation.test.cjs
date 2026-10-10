// components/chrome/navigation.test.cjs — Restricted public chrome, shared session reconciliation and student-menu transitions.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { renderToStaticMarkup } = require('react-dom/server')
const { fixture, nodes } = require('./navigation.fixture.cjs')
const { AUTH_STATUS_EVENT } = require('../../lib/auth/constants.ts')

const header = f => renderToStaticMarkup(nodes(f.nav()).find(node => node.type === 'nav'))
const forbidden = /href="\/(?:courses|my-courses|bookmarks|tutors|contact|materials|dashboard|account)"|Open menu/

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

test('confirmed sign-in presents the locked desktop destinations without contextual links or logout', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  const html = header(f)
  for (const path of ['courses', 'tutors', 'contact', 'account']) {
    assert.match(html, new RegExp(`href="/${path}"`))
  }
  assert.doesNotMatch(html, /Log out|href="\/(my-courses|bookmarks|materials)"/)
  assert.equal((html.match(/href="\/dashboard"/g) || []).length, 1, 'Dashboard home is carried by the brand lockup')
  assert.ok(nodes(f.nav()).find(node => node.type === f.sheet.SheetTrigger))
  const content = nodes(f.nav()).find(node => node.type === f.sheet.SheetContent)
  assert.match(content.props.className, /overflow-y-auto/)
  assert.match(content.props.closeClassName, /h-11 w-11/)
  assert.match(renderToStaticMarkup(f.footer()), /The inside track on every paper\./)
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
  assert.equal(actions().length, 0, 'auth actions do not own application links')
  const ordinary = nodes(f.nav()).filter(node => node.props?.href === '/dashboard' && !node.props['aria-label'])
  assert.equal(ordinary.length, 1, 'Dashboard is explicit only in the menu')
  assert.ok(ordinary.every(node => !node.props.className.includes('border-transparent')))

}))

test('desktop and Sheet consume the locked breakpoint groups; Account remains an ordinary destination', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  const expected = [['All Courses', '/courses'], ['Tutors', '/tutors'],
    ['Help & Support', '/contact'], ['Account', '/account']]
  const desktop = nodes(f.nav()).find(node => node.props?.className === 'ml-auto hidden items-center gap-1 desktop:flex')
  assert.deepEqual(links(desktop), expected)
  const content = nodes(f.nav()).find(node => node.type === f.sheet.SheetContent)
  assert.deepEqual(links(content), [['Dashboard', '/dashboard'], ...expected])
  assert.doesNotMatch(renderToStaticMarkup(content), /Log out|href="\/(my-courses|bookmarks|materials)"/)
  assert.equal(nodes(f.nav()).find(node => node.props?.['aria-label'] === 'CampusIntell home').props.href, '/dashboard')
  assert.deepEqual(accountControls(f).filter(node => node.props?.href), [])
}))

test('logout lives in Account and authenticated shared chrome contains no session action', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  assert.equal(accountControls(f).length, 0)
  assert.doesNotMatch(renderToStaticMarkup(f.nav()), /Log out/)
  assert.doesNotMatch(renderToStaticMarkup(f.footer()), /Log out/)
  assert.match(fs.readFileSync(path.join(__dirname, '../../app/account/page.tsx'), 'utf8'), /<LogoutButton continuityToken=\{continuityToken\}\s*\/>/)
  const source = fs.readFileSync(path.join(__dirname, '../auth/AuthNavActions.tsx'), 'utf8')
  assert.doesNotMatch(source, /STUDENT_HOME_PATH|STUDENT_DESTINATIONS|STUDENT_NAVIGATION_GROUPS|AUTH_PATHS\.account|\/dashboard|\/account|\bDashboard\b/)
}))

test('Dashboard home state belongs to the lockup and to the explicit menu destination', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  f.path('/dashboard')
  const current = nodes(f.nav()).filter(node => node.props?.['aria-current'] === 'page')
  assert.equal(current.length, 2)
  assert.ok(current.every(node => node.props.href === '/dashboard'))
  assert.equal(current.filter(node => node.props['aria-label'] === 'CampusIntell home').length, 1)
}))

test('Footer separates unchanged public support from compact authenticated Student App identity', async () => fixture(async f => {
  assert.deepEqual(links(f.footer()).map(([, href]) => href), ['/', 'mailto:hello@campusintell.com'])
  const publicHtml = renderToStaticMarkup(f.footer())
  assert.match(publicHtml, /Academic intelligence for the University of Lagos\./)
  assert.match(publicHtml, /© 2026 CampusIntel/)
  await f.respond({ enabled: true, signedIn: true })
  const studentHtml = renderToStaticMarkup(f.footer())
  assert.equal(links(f.footer()).length, 0, 'compact identity does not duplicate application navigation')
  assert.match(studentHtml, /class="student-footer"/)
  assert.match(studentHtml, /The inside track on every paper\./)
  assert.equal((studentHtml.match(/src="\/brand\/campusintell-mark\.png"/g) || []).length, 1)
  assert.match(studentHtml, /width="24" height="24" alt=""/)
  assert.doesNotMatch(studentHtml, /wordmark|<h2|<ul|My Courses|All Courses|Tutoring|Bookmarks|Help &amp; Support|Apply to tutor|mailto:/)
  f.change(); await f.respond({ enabled: true, signedIn: false })
  assert.equal(renderToStaticMarkup(f.footer()), publicHtml, 'logout restores the same public footer')
}))

test('shared chrome uses the official white/navy wordmark artwork inside one named home link', async () => fixture(async f => {
  for (const signedIn of [false, true]) {
    if (signedIn) await f.respond({ enabled: true, signedIn: true })
    const nav = header(f), footer = renderToStaticMarkup(f.footer())
    for (const [html, tone] of [[nav, 'white'], ...(!signedIn ? [[footer, 'navy']] : [])]) {
      assert.match(html, /aria-label="CampusIntell home"/)
      assert.doesNotMatch(html, /CampusIntel home|>CampusIntell<\/span>/)
      assert.equal((html.match(/src="\/brand\/campusintell-mark\.png"/g) || []).length, 1)
      assert.equal((html.match(new RegExp(`src="/brand/campusintell-wordmark-${tone}\\.png"`, 'g')) || []).length, 1)
      assert.match(html, /width="859" height="135" alt=""/)
      assert.match(html, /h-\[18px\] w-auto shrink-0 tablet:h-5/)
    }
  }
}))

test('nested course highlighting changes neither other links nor account action semantics', async () => fixture(async f => {
  await f.respond({ enabled: true, signedIn: true })
  for (const pathname of ['/courses', '/courses/accounting/quiz', '/courses-other', '/bookmarks/nested']) {
    f.path(pathname)
    const current = nodes(f.nav()).filter(node => node.props?.['aria-current'] === 'page')
    assert.deepEqual(current.map(node => node.props.href), pathname.startsWith('/courses/') || pathname === '/courses'
      ? ['/courses', '/courses'] : [])
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

test('logout presentation requests rendered continuity and rejects signed-in responses missing it', async () => fixture(async f => {
  assert.equal(f.requests[0].options.headers['x-campus-logout-context'], 'true')
  await f.respond({ enabled: true, signedIn: true, continuityToken: null })
  assert.equal(f.state().signedIn, false)
  f.change()
  await f.respond({ enabled: true, signedIn: true, continuityToken: 'rendered-A' })
  assert.equal(f.state().continuityToken, 'rendered-A')
  f.change()
  assert.equal(f.state().continuityToken, null)
}))
