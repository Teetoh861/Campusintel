// components/landing/landing.test.cjs — Public landing page: sections, copy, destinations, optional settings, images, motion,
// and that it is one page built once for every visitor. The signed-in redirect is the proxy's: lib/account/proxy.test.cjs.
// Run with lib/auth/test-loader.cjs preloaded.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { compile } = require('../../lib/test/tsx-loader.cjs')
const { elementNodes } = require('../../lib/test/element-walker.cjs')
const { landingFigures } = require('../../scripts/landing/figures.cjs')

const root = path.join(__dirname, '../..')
const SETTINGS = ['NEXT_PUBLIC_WHATSAPP_NUMBER', 'NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL', 'NEXT_PUBLIC_EARLY_ACCESS_FORM_URL']
const CONFIGURED = { NEXT_PUBLIC_WHATSAPP_NUMBER: '2348000000000',
  NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: 'https://chat.whatsapp.com/fixture-community',
  NEXT_PUBLIC_EARLY_ACCESS_FORM_URL: 'https://forms.example.com/early-access' }
const FORBIDDEN_COPY = ['→', 'photos', '2 practice quizzes', '3.5']
const CLIENT_FILES = ['FaqList.tsx', 'SignedInHome.tsx', 'TryQuestionQuiz.tsx']
const REMOVED_FILES = ['CourseStrip.tsx', 'HowItWorks.tsx', 'MobileMenu.tsx', 'OtherFaculties.tsx', 'WhyCampusIntell.tsx']

/** assert.match and assert.doesNotMatch print their whole input when they fail, and here that is a rendered page.
 *  These name the pattern, and what it found, instead. */
function match(text, pattern, message) {
  assert.ok(pattern.test(text), message ?? `expected ${pattern}`)
}
function noMatch(text, pattern, message) {
  const hit = pattern.exec(text)
  assert.equal(hit === null ? null : hit[0].slice(0, 200), null, message ?? `unexpected ${pattern}`)
}

const cssModule = new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : String(key)) })

/** Modules through which server code reads one visitor's request or session. The landing page is built once, so loading
 *  any of them fails the render. */
const PER_VISITOR_MODULES = ['next/headers', '@/lib/auth/render-session', '@/lib/auth/server-chrome', '@/lib/auth/student-state',
  '@/lib/supabase/server']
const FORBIDDEN = Symbol('forbidden module')

/** Load modules fresh with Next.js runtime pieces replaced; `react` may be swapped for a hook harness. */
function withModules(env, overrides, run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const cache = new Set(Object.keys(require.cache))
  const savedEnv = Object.fromEntries(SETTINGS.map(key => [key, process.env[key]]))
  for (const key of SETTINGS) if (key in env) process.env[key] = env[key]; else delete process.env[key]
  Module._extensions['.tsx'] = compile
  Module._load = function(name, ...args) {
    if (overrides[name] === FORBIDDEN) throw new Error(`the landing page must not load ${name}`)
    if (name in overrides) return overrides[name]
    if (name.endsWith('.module.css')) return cssModule
    // The landing asks for one typeface only; any other request fails the render.
    if (name === 'next/font/google') return { Playfair_Display: () => ({ variable: 'font-display' }) }
    if (name === 'next/link') return ({ href, prefetch, children, ...props }) =>
      React.createElement('a', { href, 'data-prefetch': prefetch === false ? 'off' : undefined, ...props }, children)
    // next/image as it renders: lazy unless the component asks for eager, so React's own preload hints are the real ones.
    if (name === 'next/image') return ({ preload, loading = 'lazy', ...props }) =>
      React.createElement('img', { ...props, loading, 'data-preload': preload ? 'true' : undefined })
    return originalLoad.call(this, name, ...args)
  }
  const restore = () => {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of Object.entries(savedEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
  return Promise.resolve().then(run).finally(restore)
}

/** Render "/" as the build does: no request, no session, and nothing that could read one. */
async function renderHome({ env = {} } = {}) {
  return withModules(env, Object.fromEntries(PER_VISITOR_MODULES.map(name => [name, FORBIDDEN])),
    () => renderToStaticMarkup(require(path.join(root, 'app/page.tsx')).default()))
}

const anchors = html => [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
  href: /href="([^"]*)"/.exec(attributes)?.[1], text: inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), attributes, inner }))
const hrefsFor = (html, text) => anchors(html).filter(link => link.text === text).map(link => link.href)
const imageTags = html => [...html.matchAll(/<img ([^>]*)>/g)].map(([, attributes]) => attributes)
const srcOf = image => /src="([^"]+)"/.exec(image)[1]
/** What a visitor reads: tags and icon geometry removed, entities decoded. */
const visibleText = html => html.replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
const count = (text, pattern) => (text.match(pattern) || []).length

/** Drive a client component with a minimal hook harness: click handlers update state, then re-render. */
function interactive(file, props) {
  const slots = []
  let index = 0
  const hooks = { ...React,
    useState(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial
      return [slots[slot], value => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value }]
    },
    useRef(initial) { const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot] },
    useId: () => 'fixture-id',
    useEffect: () => { index++ },
  }
  return withModules({}, { react: hooks }, () => {
    const exported = require(path.join(__dirname, file))
    const Component = Object.values(exported)[0]
    const tree = () => { index = 0; return elementNodes(Component(props)) }
    const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
      : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : ''
    const buttons = () => tree().filter(node => node.type === 'button')
    const button = label => buttons().find(node => text(node).includes(label))
    return { tree, text, buttons, button }
  })
}

const content = () => withModules({}, {}, () => require(path.join(root, 'lib/landing/content.ts')).landingContent)
const landingCss = () => fs.readFileSync(path.join(__dirname, 'landing.module.css'), 'utf8')

function strings(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

/** Every `selector { declarations }` rule in a stylesheet, media queries flattened. */
const cssRules = css => [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
  .map(([, selector, body]) => ({ selector: selector.trim(), body }))
const ruleBody = (css, selector) => cssRules(css).filter(item => item.selector === selector).map(item => item.body).join(' ')

test('the page runs in the agreed order and the retired sections are gone', async () => {
  const html = await renderHome({ env: CONFIGURED })
  const order = ['<header', 'id="landing-title"', 'id="try"', 'id="features"', 'Practice questions from your own notes.',
    'Theory questions with suggested answers.', 'aria-label="Courses on CampusIntell"', 'id="faq"', 'aria-labelledby="final-cta-title"', '<footer']
  const positions = order.map(marker => html.indexOf(marker))
  for (const [i, position] of positions.entries()) assert.ok(position >= 0, order[i])
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, 'header, hero, try a question, what you get, showcase, courses, FAQ, closing, footer')
  assert.equal(count(html, /<section\b/g), 7, 'hero, try a question, what you get, showcase, courses, FAQ and the closing section')

  const text = visibleText(html)
  for (const gone of ['How it works', 'Why CampusIntell', 'Other faculties', 'Your faculty not here yet', 'Peer Tutors', 'Coming soon',
    'Newsletter', 'Browse courses', 'Pick your path', 'Not another generic study platform', 'Study Hard. Study Smart... Walk']) {
    assert.equal(text.includes(gone), false, gone)
  }
  noMatch(html, /id="how"|href="#how"|href="\/courses"|class="(?:marquee|track|trust|tagChip|tagline|dangle|blob|stage)\b/)
  for (const file of REMOVED_FILES) assert.equal(fs.existsSync(path.join(__dirname, file)), false, file)
  // What you get is four cards; the showcase is two rows; the FAQ has four questions.
  const features = /<section id="features"[\s\S]*?<\/section>/.exec(html)[0]
  assert.deepEqual([...features.matchAll(/<h3>([^<]*)<\/h3>/g)].map(match => match[1]),
    ['Verified past questions', 'Study guides by topic', 'Exam mode', 'Campus Bot practice from your notes'])
  const { showcase, faq } = await content()
  assert.deepEqual(showcase.map(row => row.shots.length), [2, 1])
  assert.equal(faq.items.length, 4)
})

test('landing copy claims only what the product does', async () => {
  const copy = strings(await content())
  const html = await renderHome({ env: CONFIGURED })
  const page = html.replace(/<svg[\s\S]*?<\/svg>/g, '')
  for (const phrase of FORBIDDEN_COPY) {
    assert.equal(copy.filter(text => text.includes(phrase)).length, 0, `content: ${phrase}`)
    assert.equal(page.includes(phrase), false, `page: ${phrase}`)
  }
  noMatch(page, /&rarr;|AI tutor chat|partial credit|marked instantly|Discovery Pass|72-hour/)
  const text = visibleText(html)
  // Campus Bot builds practice from notes: no chat or tutor, no speed claim, and its sets are not said to be checked.
  noMatch(text, /explain anything|\btutor|\bchat with\b|ask Campus Bot|in seconds|in a minute|instantly/i)
  noMatch(text, /answers? (?:is|are) checked|checked before/i)
  // No promise of every course or level.
  noMatch(text, /every course|every level|both semesters|100L|300L|100 to 300|exact courses/i)
  // The free pass is named once, in general terms, for new accounts; GST free is said once.
  assert.equal(count(text, /free pass/gi), 1)
  match(text, /a new account can start a free pass/)
  noMatch(text, /3 days|three days|\b\d+ days\b|72 hours/i)
  assert.equal(count(text, /GST courses are free/g), 1)
  assert.equal(count(text, /\bfree for\b/gi), 1, 'GST free is not repeated in other words')
  // Theory is practising theory questions with suggested answers: nothing about comparing, marking or scoring.
  assert.ok(text.includes('Theory questions with suggested answers.'))
  assert.ok(text.includes('Practise theory questions and see a suggested answer for each one.'))
  noMatch(text, /compar|key points|mark yourself|self-mark|marking guide|points you made|theory marking|score yourself|rewrite/i)
  // Nothing tells the visitor how to use the page.
  noMatch(text, /\btap\b|\bclick\b|flag button|pick an answer|scroll/i)
  // Rule 2 of docs/student-copy.md, on the rendered page.
  noMatch(text, /\bAI\b|model answer|self-assess|unverified|not verified|\bgraded\b/i)
  for (const phrase of ['Practice questions from your own notes.', 'PDF, Word and text files',
    'For a course with no study materials yet, Campus Bot builds practice questions from the notes you upload.',
    'Verified past questions, study guides and timed exam practice for UNILAG Management Sciences students.']) {
    assert.ok(text.includes(phrase), phrase)
  }
})

test('the page title and description say CampusIntell and describe the product', () => {
  const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8')
  const metadata = layout.slice(layout.indexOf('const SITE_TITLE'), layout.indexOf('export const viewport'))
  match(metadata, /const SITE_TITLE = 'CampusIntell · Past questions and exam practice for UNILAG'/)
  match(metadata, /Verified past questions, study guides and timed exam practice for Management Sciences courses at the University of Lagos\./)
  match(metadata, /siteName: 'CampusIntell'/)
  noMatch(metadata, /CampusIntel(?!l)|inside track|Academic [Ii]ntelligence|decoded exam patterns/)
  assert.equal(count(metadata, /title: SITE_TITLE/g), 3, 'page, Open Graph and X share one title')
})

test('the header has no menu: two links from tablet up, Log in and Create account at every width', async () => {
  const html = await renderHome({ env: CONFIGURED })
  const header = /<header[^>]*>([\s\S]*?)<\/header>/.exec(html)[1]
  noMatch(header, /<button|aria-expanded|aria-controls|aria-haspopup/)
  const nav = /<nav aria-label="Primary"[^>]*>([\s\S]*?)<\/nav>/.exec(header)[1]
  assert.deepEqual(anchors(nav).map(link => [link.text, link.href]), [['Try a question', '#try'], ['FAQ', '#faq']])
  const account = anchors(header).filter(link => link.text === 'Log in' || link.text === 'Create account')
  assert.deepEqual(account.map(link => [link.text, link.href]), [['Log in', '/login'], ['Create account', '/register']])
  // Neither is hidden at any width: no `hidden` class and no display utility behind a breakpoint.
  for (const link of account) noMatch(link.attributes, /\bhidden\b|:(?:inline-flex|flex|block|grid|hidden)\b/, `${link.text} shows on phones too`)
  assert.equal(anchors(header).length, 5, 'logo, two links, Log in and Create account')
  const css = landingCss()
  match(ruleBody(css, '.headerLinks'), /display: none;[\s\S]*display: flex;/, 'links are hidden on phones and shown later')
  match(css, /@media \(min-width: 768px\) \{[^@]*\.headerLinks \{ display: flex; \}/)
  noMatch(css, /\.menu[A-Z]/)
})

test('calls to action go to login and register; nothing links to the course library', async () => {
  const html = await renderHome({ env: CONFIGURED })
  assert.deepEqual(hrefsFor(html, 'Log in'), ['/login', '/login'], 'header and closing call to action')
  for (const label of ['Create account', 'Start for free']) {
    const hrefs = hrefsFor(html, label)
    assert.ok(hrefs.length > 0, label)
    assert.ok(hrefs.every(href => href === '/register'), label)
  }
  assert.deepEqual(hrefsFor(html, 'Start for free'), ['/register', '/register'], 'hero and closing call to action')
  assert.deepEqual(hrefsFor(html, 'Try a real question'), ['#try'])
  assert.equal((await content()).tryQuestion.cta.href, '/register')
  // /courses sends a signed-out visitor to Sign in, so the page never links there, or to any quiz.
  noMatch(html, /href="\/courses|Start quiz|Timed quiz|\d+ min\b/)
  for (const link of anchors(html).filter(link => /target="_blank"/.test(link.attributes))) {
    match(link.attributes, /rel="noopener noreferrer"/, link.text)
  }
  // Links inside the page and to sign-in pages are not fetched ahead of a tap.
  for (const link of anchors(html).filter(link => /^[#/]/.test(link.href ?? ''))) match(link.attributes, /data-prefetch="off"/, link.text)
})

test('the page is built once for every visitor: static, synchronous and blind to the session on the server', async () => {
  const file = path.join(root, 'app/page.tsx')
  const source = fs.readFileSync(file, 'utf8')
  const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
  match(code, /^export const dynamic = 'force-static'$/m, 'the page asks to be prerendered')
  for (const pattern of [/force-dynamic/, /revalidate/, /\basync\b/, /\bawait\b/, /searchParams/, /redirect/, /Boundary/,
    /from '(next\/(headers|navigation|server)|@\/lib\/(auth|supabase|account)[^']*|@\/components\/auth[^']*)'/]) noMatch(code, pattern)
  assert.equal(fs.existsSync(path.join(root, 'components/auth/PublicHomeBoundary.tsx')), false, 'the per-request boundary is gone')
  // The fixture forbids every module that reads a request, so a render that finishes read none of them.
  const page = await withModules({}, Object.fromEntries(PER_VISITOR_MODULES.map(name => [name, FORBIDDEN])), () => {
    const loaded = require(file)
    assert.equal(loaded.dynamic, 'force-static')
    const element = loaded.default()
    assert.equal(typeof element?.then, 'undefined', 'the page renders without waiting for anything')
    return renderToStaticMarkup(element)
  })
  match(page, /Walk into every exam already/)
  await assert.rejects(withModules({}, { '@/components/landing/Faq': FORBIDDEN }, () => require(file)),
    /must not load @\/components\/landing\/Faq/, 'the fixture really refuses a forbidden module')
})

test('a kept copy of the page sends a signed-in student home; every other session answer leaves it alone', async () => {
  // The browser can show the landing page again without asking the server (the Back button), so the page itself reacts to
  // the shared session check's verified answer. Effects run here as they do in a browser, after the render.
  const visit = async session => {
    const went = []
    const savedWindow = global.window
    global.window = { location: { replace: to => went.push(to) } }
    try {
      const effects = []
      const rendered = await withModules({}, {
        react: { ...React, useEffect: (effect, dependencies) => { effects.push({ effect, dependencies }) } },
        '@/components/auth/NavigationSession': { useNavigationSession: () => session },
      }, () => require(path.join(__dirname, 'SignedInHome.tsx')).SignedInHome())
      assert.equal(rendered, null, 'it draws nothing')
      assert.equal(effects.length, 1)
      assert.deepEqual(effects[0].dependencies, [session.signedIn], 'it reacts when the answer changes')
      effects[0].effect()
      return went
    } finally { if (savedWindow === undefined) delete global.window; else global.window = savedWindow }
  }
  assert.deepEqual(await visit({ status: 'signed-in', signedIn: true, version: 1, continuityToken: 'token' }), ['/dashboard'])
  assert.deepEqual(await visit({ status: 'signed-out', signedIn: false, version: 1, continuityToken: null }), [])
  assert.deepEqual(await visit({ status: 'unknown', signedIn: false, version: 0, continuityToken: null }), [], 'no answer is not an answer')
  // It is on the page, and the page still renders with no session at all.
  const source = fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8')
  assert.equal(count(source, /<SignedInHome \/>/g), 1)
  match(await renderHome(), /Walk into every exam already/)
})

test('the courses line shows the figures counted from the repository', async () => {
  const figures = landingFigures()
  const { LANDING_FIGURES } = await withModules({}, {}, () => require(path.join(root, 'lib/landing/figures.ts')))
  assert.deepEqual({ ...LANDING_FIGURES }, figures, 'lib/landing/figures.ts is what scripts/landing/figures.cjs counts')
  const html = await renderHome()
  const line = /<section class="figures" aria-label="Courses on CampusIntell">([\s\S]*?)<\/section>/.exec(html)
  assert.ok(line, 'courses line')
  const number = new Intl.NumberFormat('en-GB')
  assert.deepEqual([...line[1].matchAll(/<li><b>([^<]*)<\/b> ([^<]*)<\/li>/g)].map(match => [match[1], match[2]]), [
    [number.format(figures.courses), 'courses ready to practise'], [number.format(figures.questions), 'questions'],
    [number.format(figures.departments), 'departments']])
  // One still line: no heading, no link, no list of course codes.
  noMatch(line[1], /<h\d|<a |<img|[A-Z]{3} \d{3}/)
  assert.ok(visibleText(html).includes(`Courses for the ${figures.departments} departments of the Faculty of Management Sciences at UNILAG`))
  // The numbers are never typed into the copy or the components.
  const typed = new RegExp(`\\b(?:${figures.courses}|${figures.questions}|${number.format(figures.questions)})\\b`)
  for (const file of ['lib/landing/content.ts', 'components/landing/CourseFigures.tsx']) {
    noMatch(fs.readFileSync(path.join(root, file), 'utf8'), typed, file)
  }
})

test('setting-controlled links render only when their setting is a valid https link', async () => {
  const unset = await renderHome()
  for (const label of ['Join the WhatsApp community', 'Before launch: join Early Access for a free month', 'Faculty not listed?',
    'Join the waitlist', 'WhatsApp us', 'Community']) {
    assert.equal(unset.includes(label), false, label)
  }
  noMatch(unset, /wa\.me|chat\.whatsapp|tel:/)

  const set = await renderHome({ env: CONFIGURED })
  // The closing section and the footer's Community column both link to the community.
  assert.deepEqual(hrefsFor(set, 'Join the WhatsApp community (opens in a new tab)'),
    [CONFIGURED.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL, CONFIGURED.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL])
  assert.deepEqual(hrefsFor(set, 'Before launch: join Early Access for a free month (opens in a new tab)'),
    [CONFIGURED.NEXT_PUBLIC_EARLY_ACCESS_FORM_URL])
  assert.deepEqual(hrefsFor(set, 'Join the waitlist on WhatsApp (opens in a new tab)'),
    [`https://wa.me/2348000000000?text=${encodeURIComponent("I'd like to join the waitlist for my faculty.")}`.replace(/'/g, '&#x27;')])
  assert.deepEqual(hrefsFor(set, 'WhatsApp us (opens in a new tab)'), ['https://wa.me/2348000000000'])
  noMatch(set, /\+234 707|tel:/)

  // The live site sets no Early Access link: the line is absent while everything else stays.
  const live = await renderHome({ env: { NEXT_PUBLIC_WHATSAPP_NUMBER: CONFIGURED.NEXT_PUBLIC_WHATSAPP_NUMBER,
    NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: CONFIGURED.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL } })
  noMatch(live, /Early Access/)
  match(live, /Faculty not listed\?/)

  const unsafe = await renderHome({ env: { NEXT_PUBLIC_WHATSAPP_NUMBER: '+234 800',
    NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: 'javascript:alert(1)', NEXT_PUBLIC_EARLY_ACCESS_FORM_URL: 'http://forms.example.com' } })
  noMatch(unsafe, /javascript:|http:\/\/forms|Join the WhatsApp community|Early Access|Join the waitlist|WhatsApp us/)
})

test('the closing section has its actions, the community link and one waitlist line', async () => {
  const html = await renderHome({ env: CONFIGURED })
  const closing = /<section aria-labelledby="final-cta-title">([\s\S]*?)<\/section>/.exec(html)[1]
  assert.deepEqual(anchors(closing).map(link => link.text), ['Start for free', 'Log in', 'Join the WhatsApp community (opens in a new tab)',
    'Join the waitlist on WhatsApp (opens in a new tab)'])
  assert.equal(count(visibleText(html), /Faculty not listed\?/g), 1)
  match(closing, /<p class="faculty">Faculty not listed\? <a /)
  // The waitlist is a text link on the Navy card: no mark of its own, and no picture in the section but the community mark.
  const waitlist = anchors(closing).find(link => link.text.startsWith('Join the waitlist'))
  noMatch(waitlist.inner, /<img/)
  match(waitlist.attributes, /underline/)
  assert.deepEqual(imageTags(closing).map(srcOf), ['/landing/icons/whatsapp-glyph-white.png'])
  assert.deepEqual(hrefsFor(html.slice(html.lastIndexOf('<footer')), 'Join the WhatsApp community (opens in a new tab)'),
    [CONFIGURED.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL])
})

test('one h1, labelled landmarks, and images that load in the right order', async () => {
  const html = await renderHome({ env: CONFIGURED })
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1)
  match(html, /<header[^>]*>/)
  match(html, /<nav aria-label="Primary"/)
  match(html, /<footer[^>]*>/)
  const images = imageTags(html)
  assert.ok(images.length > 0)
  for (const image of images) {
    match(image, /sizes="[^"]+"/)
    match(image, /src="\/landing\/[^"]+"/)
    match(image, /alt="[^"]*"/)
    match(image, /width="\d+"/)
    match(image, /height="\d+"/)
  }
  // The header logo and the hero photograph load with the page; everything else, below the first screen, is lazy.
  assert.deepEqual(images.filter(image => /loading="eager"/.test(image)).map(srcOf), ['/landing/logo-full.png', '/landing/hero.webp'])
  assert.equal(images.findIndex(image => /loading="eager"/.test(image)), 0, 'the logo is the first image')
  for (const image of images.filter(image => !/loading="eager"/.test(image))) match(image, /loading="lazy"/, srcOf(image))
  // The hero is not preloaded: no preload prop, no priority hint, and no preload link from React, which hints every
  // eager image except one inside <picture>. The logo is the only image hinted.
  assert.equal(images.filter(image => /data-preload="true"/.test(image)).length, 0)
  noMatch(html, /fetchPriority|fetchpriority/)
  assert.deepEqual([...html.matchAll(/<link rel="preload" as="image" href="([^"]+)"/g)].map(match => match[1]), ['/landing/logo-full.png'])
  match(html, /<picture class="heroFrame"><img [^>]*src="\/landing\/hero\.webp"[^>]*><\/picture>/)
  // No preload or priority prop on the hero image (the word may appear in a comment).
  noMatch(fs.readFileSync(path.join(__dirname, 'Hero.tsx'), 'utf8'), /\bpreload(?:=|\s*\/?>|\s+\w+=)|\bpriority\b|fetchPriority/)
  noMatch(html, /data:image|base64|<script|fonts\.googleapis/)
})

/** Width and height from a WebP header (lossy, lossless or extended). */
function webpSize(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF')
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP')
  const chunk = buffer.toString('ascii', 12, 16)
  if (chunk === 'VP8X') return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) }
  if (chunk === 'VP8 ') return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff }
  const bits = buffer.readUInt32LE(21)
  return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
}

const SCREENSHOT_WIDTH = 700
const SCREENSHOT_MAX_BYTES = 150 * 1024

test('every image fills its frame: the hero has the photograph\'s shape and each screenshot is its own frame', async () => {
  const { images, showcase } = await content()
  const css = landingCss()
  // Hero: the frame takes the photograph's aspect ratio and the picture covers all of it.
  match(ruleBody(css, '.heroFrame'), new RegExp(`aspect-ratio: ${images.hero.width} / ${images.hero.height};`))
  const hero = ruleBody(css, '.heroImage')
  match(hero, /object-fit: cover;/)
  match(hero, /width: 100%;/)
  match(hero, /height: 100%;/)
  assert.deepEqual(webpSize(fs.readFileSync(path.join(root, 'public', images.hero.src))), { width: images.hero.width, height: images.hero.height })
  noMatch(css, /object-fit: contain|inset: 0 4%|height: 96%/)

  // Showcase: three real app screens, each 700 px wide, drawn at their own shape with no border or rounding added.
  const shots = showcase.flatMap(row => row.shots)
  assert.deepEqual(shots.map(shot => shot.src), ['/landing/upload-notes.webp', '/landing/campus-bot-question.webp', '/landing/theory-answer.webp'])
  for (const shot of shots) {
    const buffer = fs.readFileSync(path.join(root, 'public', shot.src))
    assert.deepEqual(webpSize(buffer), { width: shot.width, height: shot.height }, shot.src)
    assert.equal(shot.width, SCREENSHOT_WIDTH, shot.src)
    assert.ok(buffer.length < SCREENSHOT_MAX_BYTES, `${shot.src}: ${buffer.length} bytes`)
    assert.ok(shot.alt.length > 10 && !/\bAI\b/.test(shot.alt), shot.src)
  }
  const frame = ruleBody(css, '.shot')
  match(frame, /width: 100%;/)
  match(frame, /height: auto;/)
  noMatch(frame, /border|radius|aspect-ratio|object-fit|padding/)
  noMatch(css, /\.(?:blob|stage|screen|screenBack|screenFront|float|chip)\b/)

  const html = await renderHome()
  const section = html.slice(html.indexOf('Practice questions from your own notes.'), html.indexOf('aria-label="Courses on CampusIntell"'))
  const rendered = imageTags(section)
  assert.deepEqual(rendered.map(srcOf), shots.map(shot => shot.src))
  for (const [i, image] of rendered.entries()) {
    match(image, new RegExp(`width="${shots[i].width}" height="${shots[i].height}"`))
    match(image, /class="shot"/)
    match(image, new RegExp(`alt="${shots[i].alt}"`))
  }
  // Nothing sits on top of a screenshot or the hero photograph.
  noMatch(section, /Quiz ready|aria-hidden="true"><div/)
  const heroSection = /<section class="hero"[\s\S]*?<\/section>/.exec(html)[0]
  assert.deepEqual(imageTags(heroSection).map(srcOf), ['/landing/hero.webp'])
})

// The owner's official GST111 bank lives outside the repository; set CAMPUSINTEL_OFFICIAL_BANKS to check it elsewhere.
const GST111_BANK = path.join(process.env.CAMPUSINTEL_OFFICIAL_BANKS
  ?? path.join(require('node:os').homedir(), 'Desktop/CampusIntell-official-banks'), 'batch-1/GST111/GST111_Platform.json')

test('the sample questions come from the free GST111 bank', async () => {
  const { tryQuestion } = await content()
  assert.equal(tryQuestion.questions.length, 2)
  assert.equal(new Set(tryQuestion.questions.map(sample => sample.questionId)).size, 2)
  for (const sample of tryQuestion.questions) {
    match(sample.questionId, /^(GST111|G111N\d)-\d{3,4}$/, 'a GST111 bank ID')
    match(sample.course, /^GST 111 · /)
    noMatch(`${sample.course} ${sample.question}`, /BUA/)
  }
})

test('each sample is copied word for word from the official GST111 bank', { skip: !fs.existsSync(GST111_BANK) && 'official bank not on this machine' }, async () => {
  const { tryQuestion } = await content()
  const bank = JSON.parse(fs.readFileSync(GST111_BANK, 'utf8'))
  assert.equal(bank.course, 'GST111')
  for (const sample of tryQuestion.questions) {
    const matches = bank.questions.filter(question => question.id === sample.questionId)
    assert.equal(matches.length, 1, sample.questionId)
    const [source] = matches
    const keys = Object.keys(source.options).sort()
    assert.equal(sample.question, source.question)
    assert.deepEqual(sample.options, keys.map(key => source.options[key]))
    assert.equal(sample.answer, keys.indexOf(source.answer))
    assert.equal(sample.explanation, source.explanation)
  }
})

test('Try a question marks right and wrong answers with an icon and a word, then offers the bank', async () => {
  const { tryQuestion } = await content()
  const { questions, ...copy } = tryQuestion
  const quiz = await interactive('TryQuestionQuiz.tsx', { copy, questions, intro: null, botSrc: '/landing/campus-bot.png' })
  global.requestAnimationFrame = callback => callback()
  const explanation = () => quiz.text(quiz.tree().find(node => node.props?.['aria-live'] === 'polite'))
  const optionButtons = () => quiz.buttons().filter(node => questions.some(q => q.options.some(option => quiz.text(node).includes(option))))
  try {
    assert.equal(quiz.button('Next question').props.disabled, true)
    // Before an answer the card holds the question alone: no prompt telling the visitor what to do, and nothing shakes.
    assert.equal(explanation(), '')
    assert.ok(optionButtons().every(node => !/\bshake\b/.test(node.props.className)))
    quiz.button(questions[0].options[questions[0].answer]).props.onClick()
    let answer = quiz.button(questions[0].options[questions[0].answer])
    match(quiz.text(answer), /Correct$/)
    noMatch(quiz.text(answer), /Correct answer/, 'a right pick says Correct')
    assert.ok(elementNodes(answer).some(node => node.type?.displayName === 'CircleCheck'))
    match(explanation(), new RegExp(`Why: ${questions[0].explanation.slice(0, 20)}`))
    assert.ok(optionButtons().every(node => !/\bshake\b/.test(node.props.className)), 'a right answer does not shake')

    quiz.button('Next question').props.onClick()
    const wrong = questions[1].options.findIndex((_, i) => i !== questions[1].answer)
    quiz.button(questions[1].options[wrong]).props.onClick()
    const picked = quiz.button(questions[1].options[wrong])
    const corrected = quiz.button(questions[1].options[questions[1].answer])
    match(quiz.text(picked), /Your answer$/)
    assert.ok(elementNodes(picked).some(node => node.type?.displayName === 'CircleX'))
    // The wrong pick, and only it, shakes.
    assert.deepEqual(optionButtons().filter(node => /\bshake\b/.test(node.props.className)).map(quiz.text), [quiz.text(picked)])
    match(quiz.text(corrected), /Correct answer$/)
    assert.ok(elementNodes(corrected).some(node => node.type?.displayName === 'CircleCheck'))
    quiz.button(questions[1].options[questions[1].answer]).props.onClick()
    match(quiz.text(quiz.button(questions[1].options[questions[1].answer])), /Correct answer$/, 'a second tap changes nothing')
    match(quiz.text(quiz.button(questions[1].options[wrong])), /Your answer$/)

    quiz.button('See your score').props.onClick()
    const end = quiz.tree()
    assert.ok(end.some(node => quiz.text(node) === 'You got 1 out of 2.'))
    assert.ok(end.some(node => node.props?.href === '/register' && quiz.text(node) === 'Get the full question bank'))
    assert.ok(end.some(node => quiz.text(node) === copy.endText))

    quiz.button('Play again').props.onClick()
    assert.equal(quiz.button('Next question').props.disabled, true)
    const examSwitch = quiz.buttons().find(node => node.props.role === 'switch')
    assert.equal(examSwitch.props['aria-checked'], false)
    // The timer mark belongs to exam mode only; practice has no timer.
    assert.equal(quiz.tree().some(node => node.type?.displayName === 'Timer'), false)
    examSwitch.props.onClick()
    assert.equal(quiz.tree().some(node => node.type?.displayName === 'Timer'), true)
    quiz.button(questions[0].options[0]).props.onClick()
    match(quiz.text(quiz.button(questions[0].options[0])), /Your answer$/)
    noMatch(quiz.buttons().map(quiz.text).join(' '), /Correct/, 'exam mode reveals nothing until the end')
    assert.equal(explanation(), copy.savedExam)
  } finally {
    delete global.requestAnimationFrame
  }
})

test('FAQ questions are buttons with aria-expanded that open and close their answers', async () => {
  const { faq } = await content()
  const list = await interactive('FaqList.tsx', { items: faq.items })
  const toggles = () => list.buttons()
  assert.equal(toggles().length, faq.items.length)
  assert.deepEqual(toggles().map(node => node.props['aria-expanded']), [true, false, false, false])
  const answer = id => list.tree().find(node => node.props?.id === id)
  const second = toggles()[1]
  assert.equal(answer(second.props['aria-controls']).props.hidden, true)
  second.props.onClick()
  assert.equal(toggles()[1].props['aria-expanded'], true)
  assert.equal(answer(second.props['aria-controls']).props.hidden, false)
  toggles()[1].props.onClick()
  assert.equal(toggles()[1].props['aria-expanded'], false)
})

// Emoji are pictographs; the typographic © ® ™ marks are text symbols the copyright line legitimately uses.
const EMOJI = /(?![©®™])[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}]/u
const WHITE_MARKS = ['whatsapp-glyph-white.png']
// Retired by the design system or replaced by this page: coloured or black marks, icons with other meanings, the design
// mock-ups that stood in for app screens, and the pattern's larger PNG copy.
const RETIRED = /whatsapp-glyph-green|x-logo-black|instagram-glyph(?:\.png|-gradient|-white)|\b(?:Gift|Zap|RotateCcw|ClipboardCheck)\b|answer\.jpg|upload\.jpg|question\.jpg|theory\.webp|pattern-on-navy\.png/

test('no emoji and no hand-drawn SVG: icons are lucide-react or official brand image files', async () => {
  const sourceFiles = [
    ...fs.readdirSync(__dirname).map(file => path.join(__dirname, file)),
    ...fs.readdirSync(path.join(root, 'lib/landing')).map(file => path.join(root, 'lib/landing', file)),
  ].filter(file => /\.(tsx?|css)$/.test(file))
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8')
    noMatch(source, EMOJI, `${path.relative(root, file)} contains an emoji`)
    if (!/\.test\./.test(file)) {
      noMatch(source, /<svg|<path|stroke-dash|@keyframes draw/i, `${path.relative(root, file)} draws SVG`)
      noMatch(source, /from 'lucide-react'[^\n]*\b(?:Instagram|Twitter|Facebook|MessageCircle)\b/, 'brand marks are official files')
    }
  }
  noMatch('Join the WhatsApp community', EMOJI)
  match('☎ Join the WhatsApp community', EMOJI, 'the check catches the design\'s phone glyph')

  const html = await renderHome({ env: CONFIGURED })
  noMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), EMOJI)
  const sources = imageTags(html).map(srcOf)
  for (const src of sources) match(src, /^\/landing\/[\w/-]+\.(?:png|webp|jpe?g|gif)$/, src)
  // Marks are white only, on Navy or Blue; the official white X mark is not added yet, so X shows its words alone.
  for (const brand of WHITE_MARKS) {
    assert.ok(sources.includes(`/landing/icons/${brand}`), brand)
    assert.ok(fs.existsSync(path.join(root, 'public/landing/icons', brand)), brand)
  }
  assert.deepEqual(fs.readdirSync(path.join(root, 'public/landing/icons')).sort(), [...WHITE_MARKS].sort())
  for (const file of fs.readdirSync(path.join(root, 'public/landing'), { recursive: true })) {
    if (fs.statSync(path.join(root, 'public/landing', file)).isFile()) match(file, /\.(?:png|webp|jpe?g|gif|mp4|webm)$/, file)
  }
  // Every picture in the folder is used by the page or its stylesheet, and every picture used is in the folder.
  const used = new Set([...sources, ...[...landingCss().matchAll(/url\("(\/landing\/[^"]+)"\)/g)].map(match => match[1])])
  const present = fs.readdirSync(path.join(root, 'public/landing'), { recursive: true })
    .filter(file => fs.statSync(path.join(root, 'public/landing', file)).isFile()).map(file => `/landing/${file}`)
  assert.deepEqual([...used].sort(), present.sort())
})

test('marks are white, icons keep one meaning each, and retired assets are gone', async () => {
  const sources = fs.readdirSync(__dirname).filter(file => /\.(tsx?|css)$/.test(file) && !/\.test\./.test(file))
    .map(file => path.join(__dirname, file))
    .concat(fs.readdirSync(path.join(root, 'lib/landing')).map(file => path.join(root, 'lib/landing', file)))
  for (const file of sources) noMatch(fs.readFileSync(file, 'utf8'), RETIRED, path.relative(root, file))
  const html = await renderHome({ env: CONFIGURED })
  noMatch(html, RETIRED)
  for (const file of ['answer.jpg', 'upload.jpg', 'question.jpg', 'theory.webp', 'pattern-on-navy.png']) {
    assert.equal(fs.existsSync(path.join(root, 'public/landing', file)), false, file)
  }
  const x = anchors(html).find(item => item.text.startsWith('X (Twitter)'))
  noMatch(x.inner, /<img/, 'X shows its words alone')
  // One icon per card, and nothing imported that the page no longer shows.
  const icons = fs.readFileSync(path.join(__dirname, 'icons.tsx'), 'utf8')
  match(icons, /import \{ FileText, FileUp, ListChecks, Timer \} from 'lucide-react'/)
  const faq = fs.readFileSync(path.join(__dirname, 'FaqList.tsx'), 'utf8')
  match(faq, /expanded \? <ChevronUp[^:]*: <ChevronDown/)
  const css = landingCss()
  noMatch(css, /\.(?:circle|face|phone|blobWarm)\b|radial-gradient/)
  // Campus Bot appears where its background shows it whole: beside the question card and in the FAQ help card.
  assert.deepEqual(imageTags(html).map(srcOf).filter(src => src.endsWith('campus-bot.png')).length, 2)
  noMatch(/<section aria-labelledby="final-cta-title">[\s\S]*?<\/section>/.exec(html)[0], /campus-bot/)
})

test('landing source keeps client code small, scripts out and colours on tokens', () => {
  const dir = __dirname
  const sources = fs.readdirSync(dir).filter(file => /\.(tsx?|css)$/.test(file))
  for (const file of sources) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.equal(/^'use client'/m.test(source), CLIENT_FILES.includes(file), `${file} client boundary`)
    noMatch(source, /dangerouslySetInnerHTML|<script|#[0-9a-fA-F]{3,8}\b|base64|fonts\.googleapis/, file)
  }
})

test('nothing moves by itself: no looping animation, no entrance and no lift on hover', async () => {
  const css = landingCss()
  // The one animation left is the wrong-answer shake, and it runs once.
  assert.deepEqual([...css.matchAll(/@keyframes (\w+)/g)].map(match => match[1]), ['shake'])
  assert.deepEqual(cssRules(css).filter(rule => /animation(?:-name)?:/.test(rule.body) && !/animation: none/.test(rule.body))
    .map(rule => [rule.selector, /animation: ([^;]+);/.exec(rule.body)[1]]), [['.shake', 'shake .35s']])
  noMatch(css, /infinite|animation-iteration-count|\brise\b|\bbob\b|\bswing\b|\bloop\b|marquee/)
  // Hover changes no position or size, and no card reacts to the pointer.
  for (const rule of cssRules(css).filter(rule => /:hover/.test(rule.selector))) assert.fail(`hover rule in landing.module.css: ${rule.selector}`)
  noMatch(css, /translateY|scale\(|rotate\(/)
  // What still moves answers the visitor: the switch, the step dots, an open FAQ item, and button press feedback.
  assert.deepEqual(cssRules(css).filter(rule => /transition:/.test(rule.body) && !/transition: none/.test(rule.body)).map(rule => rule.selector),
    ['.switch', '.switch::after', '.stepDot', '.faqItem'])
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  match(reduced, /\.landing \*[^{]*\{[^}]*animation: none !important;[^}]*transition: none !important;/)
  // The hero is in the first frame: none of its elements carries an animation or starts hidden.
  const html = await renderHome({ env: CONFIGURED })
  const hero = /<section class="hero"[\s\S]*?<\/section>/.exec(html)[0]
  noMatch(hero, /class="[^"]*\b(?:rise|d[1-5]|float|fade)\b/)
  for (const selector of ['.hero', '.heroGrid', '.landing .heroTitle', '.lead', '.ctas', '.heroFrame', '.heroImage']) {
    noMatch(ruleBody(css, selector), /opacity|animation|visibility|transform/, selector)
  }
})

test('the landing loads two font files: the display face here and the app\'s body face', () => {
  const fonts = fs.readFileSync(path.join(__dirname, 'fonts.ts'), 'utf8')
  assert.deepEqual([...fonts.matchAll(/^export const (\w+) = (\w+)\(/gm)].map(match => [match[1], match[2]]), [['landingDisplay', 'Playfair_Display']])
  noMatch(fonts, /italic|Source_Sans|style:/)
  const css = landingCss()
  match(ruleBody(css, '.landing'), /font-family: var\(--font-hanken\), system-ui, sans-serif;/)
  noMatch(css, /--landing-body|font-style: italic/)
  noMatch(fs.readFileSync(path.join(root, 'app/page.tsx'), 'utf8'), /landingBody/)
  const fontUsers = ['app', 'components'].flatMap(function walk(folder) {
    return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? walk(`${folder}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${folder}/${entry.name}`] : [])
  }).filter(file => /next\/font\/google/.test(fs.readFileSync(path.join(root, file), 'utf8')))
  assert.deepEqual(fontUsers.sort(), ['app/layout.tsx', 'components/landing/fonts.ts'])
  noMatch(fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8'), /Playfair|Source_Sans/)
})

test('green marks only a right answer: ticks are Blue, done steps Navy', async () => {
  const css = landingCss()
  // Token definitions aside, the success colour is used by the right-answer key alone.
  const green = cssRules(css).filter(rule =>
    /var\(--l-ok|student-success/.test(rule.body.replace(/--l-ok(?:-soft)?:[^;]*;/g, '')))
  assert.deepEqual(green.map(rule => rule.selector), ['.keyRight'])
  match(ruleBody(css, '.tick'), /background: var\(--l-blue\)/)
  match(ruleBody(css, '.tick'), /color: var\(--l-surface\)/)
  match(ruleBody(css, '.stepDone'), /background: var\(--l-navy\)/)
  for (const file of fs.readdirSync(__dirname).filter(name => /\.tsx?$/.test(name) && name !== 'TryQuestionQuiz.tsx')) {
    noMatch(fs.readFileSync(path.join(__dirname, file), 'utf8'), /success|keyRight/, file)
  }

  const { tryQuestion } = await content()
  const { questions, ...copy } = tryQuestion
  const quiz = await interactive('TryQuestionQuiz.tsx', { copy, questions, intro: null, botSrc: '/landing/campus-bot.png' })
  global.requestAnimationFrame = callback => callback()
  const isGreen = node => /success|keyRight/.test(node.props?.className ?? '')
  // Every green element sits inside an option whose word names the right answer; nothing else is green.
  const greenOnly = rightLabel => {
    const options = quiz.buttons().filter(node => questions.some(q => q.options.some(text => quiz.text(node).includes(text))))
    assert.ok(options.length >= 2)
    let inRight = 0
    for (const option of options) {
      const greenNodes = elementNodes(option).filter(isGreen).length
      if (rightLabel !== null && new RegExp(`${rightLabel}$`).test(quiz.text(option))) { assert.ok(greenNodes > 0); inRight += greenNodes }
      else assert.equal(greenNodes, 0, quiz.text(option))
    }
    assert.equal(quiz.tree().filter(isGreen).length, inRight)
  }
  try {
    greenOnly(null)
    quiz.button(questions[0].options[questions[0].answer]).props.onClick()
    greenOnly('Correct')
    quiz.button('Next question').props.onClick()
    const wrong = questions[1].options.findIndex((_, i) => i !== questions[1].answer)
    quiz.button(questions[1].options[wrong]).props.onClick()
    greenOnly('Correct answer')
  } finally {
    delete global.requestAnimationFrame
  }
})

test('the header is solid: no translucent background and no backdrop filter', () => {
  const css = landingCss()
  const header = cssRules(css).filter(rule => /\.header\b(?![A-Za-z])/.test(rule.selector))
  assert.ok(header.length > 0)
  for (const { selector, body } of header) {
    noMatch(body, /backdrop-filter|transparent|opacity|rgba\(/, selector)
  }
  match(header.find(rule => rule.selector === '.header').body, /background: var\(--l-bg\);/)
})

const footerOf = html => html.slice(html.lastIndexOf('<footer'))
const isNavyButton = link => /bg-student-primary/.test(link.attributes)
const COMMUNITY_LABEL = 'Join the WhatsApp community (opens in a new tab)'

test('the footer Contact list has no link to the site itself', async () => {
  const html = await renderHome({ env: CONFIGURED })
  const footer = footerOf(html)
  const contact = /<h2>Contact<\/h2><ul>([\s\S]*?)<\/ul>/.exec(footer)
  assert.ok(contact, 'Contact list')
  assert.deepEqual(anchors(contact[1]).map(link => link.text), ['WhatsApp us (opens in a new tab)', 'hello@campusintell.com'])
  for (const link of anchors(footer)) noMatch(link.href ?? '', /^https?:\/\/(www\.)?campusintell\.com/, link.text)
  assert.equal('website' in (await content()).footer, false)
})

test('the footer links to the sections the page still has', async () => {
  const footer = footerOf(await renderHome({ env: CONFIGURED }))
  const product = /<nav aria-labelledby="footer-product">([\s\S]*?)<\/nav>/.exec(footer)[1]
  assert.deepEqual(anchors(product).map(link => [link.text, link.href]), [['Try a question', '#try'], ['What you get', '#features'], ['FAQ', '#faq']])
  const html = await renderHome({ env: CONFIGURED })
  for (const [, id] of html.matchAll(/href="#([a-z-]+)"/g)) {
    assert.ok(id === 'top' || html.includes(`id="${id}"`), `#${id} has a target on the page`)
  }
})

test('the footer has one Navy button: the community button with the white WhatsApp mark, after Follow', async () => {
  const footer = footerOf(await renderHome({ env: CONFIGURED }))
  const buttons = anchors(footer).filter(isNavyButton)
  assert.deepEqual(buttons.map(link => [link.text, link.href]), [[COMMUNITY_LABEL, CONFIGURED.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL]])
  match(buttons[0].attributes, /target="_blank"/)
  match(buttons[0].inner, /src="\/landing\/icons\/whatsapp-glyph-white\.png"/)
  assert.equal(footer.match(/<img [^>]*src="\/landing\/icons\//g)?.length, 1, 'the community button holds the only brand mark')
  assert.ok(footer.indexOf('<h2>Follow</h2>') < footer.indexOf('<h2>Community</h2>'), 'Community comes after Follow')
  match(footer, /class="app-container footerGrid footerGridWide"/)

  // Unset or unsafe: no Community column at all, so the footer has no Navy button, no mark and no empty heading.
  for (const env of [{}, { NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: 'http://chat.whatsapp.com/fixture-community' }]) {
    const hidden = footerOf(await renderHome({ env }))
    assert.equal(anchors(hidden).filter(isNavyButton).length, 0)
    noMatch(hidden, /\/landing\/icons\/|Join the WhatsApp community|<h2>Community<\/h2>|footerGridWide/)
    assert.deepEqual([...hidden.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map(match => match[1]), ['Product', 'Contact', 'Follow'])
  }
})

test('footer Contact and Follow links are plain text, styled like the email link', async () => {
  const footer = footerOf(await renderHome({ env: CONFIGURED }))
  const list = heading => anchors(new RegExp(`<h2>${heading}</h2><ul>([\\s\\S]*?)</ul>`).exec(footer)[1])
  const email = list('Contact').find(link => link.href.startsWith('mailto:'))
  const plain = [...list('Contact'), ...list('Follow')]
  assert.deepEqual(plain.map(link => link.text), ['WhatsApp us (opens in a new tab)', 'hello@campusintell.com',
    'Instagram (opens in a new tab)', 'X (Twitter) (opens in a new tab)'])
  for (const link of plain) {
    noMatch(link.inner, /<img/, link.text)
    assert.equal(/class="([^"]*)"/.exec(link.attributes)[1], /class="([^"]*)"/.exec(email.attributes)[1], link.text)
  }
})

test('the footer has no newsletter line, form or email field', async () => {
  for (const env of [CONFIGURED, {}]) {
    const footer = footerOf(await renderHome({ env }))
    noMatch(footer, /[Nn]ewsletter|coming soon|<form|<input|type="email"/)
  }
  assert.equal('newsletter' in (await content()).footer, false)
})

test('the copyright year is the year the page was built', async () => {
  const RealDate = Date
  try {
    global.Date = class extends RealDate { getFullYear() { return 2031 } }
    match(footerOf(await renderHome()), /© 2031 CampusIntell/)
  } finally { global.Date = RealDate }
  match(footerOf(await renderHome()), new RegExp(`© ${new Date().getFullYear()} CampusIntell`))
})
