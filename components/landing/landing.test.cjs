// components/landing/landing.test.cjs — Public landing page: copy, destinations, optional settings, redirect and controls.
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

const root = path.join(__dirname, '../..')
const SETTINGS = ['NEXT_PUBLIC_WHATSAPP_NUMBER', 'NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL', 'NEXT_PUBLIC_EARLY_ACCESS_FORM_URL']
const CONFIGURED = { NEXT_PUBLIC_WHATSAPP_NUMBER: '2348000000000',
  NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: 'https://chat.whatsapp.com/fixture-community',
  NEXT_PUBLIC_EARLY_ACCESS_FORM_URL: 'https://forms.example.com/early-access' }
const FORBIDDEN_COPY = ['→', 'photos', '2 practice quizzes', '3.5']
const CLIENT_FILES = ['FaqList.tsx', 'MobileMenu.tsx', 'TryQuestionQuiz.tsx']

const cssModule = new Proxy({}, { get: (_target, key) => (key === '__esModule' ? false : String(key)) })

/** Load modules fresh with Next.js runtime pieces replaced; `react` may be swapped for a hook harness. */
function withModules(env, overrides, run) {
  const originalLoad = Module._load
  const originalTsx = Module._extensions['.tsx']
  const cache = new Set(Object.keys(require.cache))
  const savedEnv = Object.fromEntries(SETTINGS.map(key => [key, process.env[key]]))
  for (const key of SETTINGS) if (key in env) process.env[key] = env[key]; else delete process.env[key]
  Module._extensions['.tsx'] = compile
  Module._load = function(name, ...args) {
    if (name in overrides) return overrides[name]
    if (name.endsWith('.module.css')) return cssModule
    if (name === 'next/font/google') return { Playfair_Display: () => ({ variable: 'font-display' }),
      Source_Sans_3: () => ({ variable: 'font-body' }) }
    if (name === 'next/link') return ({ href, prefetch, children, ...props }) => React.createElement('a', { href, ...props }, children)
    if (name === 'next/image') return ({ preload, ...props }) => React.createElement('img', { ...props, 'data-preload': preload ? 'true' : undefined })
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

/** Render "/" through the real PublicHomeBoundary with a fixture session. */
async function renderHome({ env = {}, signedIn = false, lookupFails = false } = {}) {
  return withModules(env, {
    'next/navigation': { redirect: to => { throw new Error(`redirect:${to}`) } },
    '@/lib/auth/config': { isStudentAuthEnabled: () => true },
    '@/lib/auth/student-state': { getStudentSessionContext: async () => {
      if (lookupFails) throw new Error('Session validation failed')
      return signedIn ? { user: { id: 'student' }, sessionId: 'fixture-session' } : null
    } },
  }, async () => {
    const page = require(path.join(root, 'app/page.tsx')).default()
    return renderToStaticMarkup(await page.type(page.props))
  })
}

const anchors = html => [...html.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes, inner]) => ({
  href: /href="([^"]*)"/.exec(attributes)?.[1], text: inner.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(), attributes }))
const hrefsFor = (html, text) => anchors(html).filter(link => link.text === text).map(link => link.href)

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

function strings(value) {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

test('landing copy carries none of the retired claims, arrows or marks', async () => {
  const copy = strings(await content())
  // Icon path data is geometry, not copy, so only the page outside SVG markup is checked.
  const html = (await renderHome({ env: CONFIGURED })).replace(/<svg[\s\S]*?<\/svg>/g, '')
  for (const phrase of FORBIDDEN_COPY) {
    assert.equal(copy.filter(text => text.includes(phrase)).length, 0, `content: ${phrase}`)
    assert.equal(html.includes(phrase), false, `page: ${phrase}`)
  }
  assert.doesNotMatch(html, /&rarr;|AI tutor chat|partial credit|marked instantly/)
  for (const phrase of ['Theory answers, model answers', 'Write your answer. Compare and mark.',
    'Upload your notes. Get a quiz in seconds.', 'Works with PDF, Word and text files',
    'Start a free 72-hour Discovery Pass to try your department courses. GST courses are always free.',
    'Every course across the 8 departments of the Faculty of Management Sciences, from 100 to 300 level.']) {
    assert.ok(html.includes(phrase.replace(/'/g, '&#x27;')), phrase)
  }
  assert.doesNotMatch(html, /Pick a study style|Snap your notes|lecture slides/)
})

test('calls to action go to login, register and the course library', async () => {
  const html = await renderHome({ env: CONFIGURED })
  for (const href of hrefsFor(html, 'Log in')) assert.equal(href, '/login')
  assert.equal(hrefsFor(html, 'Log in').length, 3, 'header, menu and closing call to action')
  for (const label of ['Create account', 'Start for free', 'Sign up free']) {
    const hrefs = hrefsFor(html, label)
    assert.ok(hrefs.length > 0, label)
    assert.ok(hrefs.every(href => href === '/register'), label)
  }
  assert.deepEqual(hrefsFor(html, 'Browse courses'), ['/courses', '/courses'], 'header and mobile menu')
  assert.equal((await content()).tryQuestion.cta.href, '/register')
  // The page promises no course readiness: no quiz routes, question counts or durations.
  assert.doesNotMatch(html, /href="\/courses\/[^"]+"|Start quiz|Timed quiz|\d+ questions|\d+ min\b/)
  for (const link of anchors(html).filter(link => /target="_blank"/.test(link.attributes))) {
    assert.match(link.attributes, /rel="noopener noreferrer"/, link.text)
  }
})

test('a signed-in visit to / redirects home; signed-out and failed lookups see the landing page', async () => {
  await assert.rejects(renderHome({ signedIn: true }), /redirect:\/dashboard/)
  assert.match(await renderHome(), /Walk into every exam already/)
  assert.match(await renderHome({ lookupFails: true }), /Walk into every exam already/)
})

test('setting-controlled buttons render only when their setting is a valid https link', async () => {
  const unset = await renderHome()
  for (const label of ['Join the WhatsApp community', 'Before launch: join Early Access for a free month', 'Join the waitlist', 'WhatsApp us']) {
    assert.equal(unset.includes(label), false, label)
  }
  assert.doesNotMatch(unset, /wa\.me|chat\.whatsapp|tel:/)

  const set = await renderHome({ env: CONFIGURED })
  assert.deepEqual(hrefsFor(set, 'Join the WhatsApp community (opens in a new tab)'), [CONFIGURED.NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL])
  assert.deepEqual(hrefsFor(set, 'Before launch: join Early Access for a free month (opens in a new tab)'),
    [CONFIGURED.NEXT_PUBLIC_EARLY_ACCESS_FORM_URL])
  assert.deepEqual(hrefsFor(set, 'Join the waitlist (opens in a new tab)'),
    [`https://wa.me/2348000000000?text=${encodeURIComponent("I'd like to join the waitlist for my faculty.")}`.replace(/'/g, '&#x27;')])
  assert.deepEqual(hrefsFor(set, 'WhatsApp us (opens in a new tab)'), ['https://wa.me/2348000000000'])
  assert.doesNotMatch(set, /\+234 707|tel:/)

  const unsafe = await renderHome({ env: { NEXT_PUBLIC_WHATSAPP_NUMBER: '+234 800',
    NEXT_PUBLIC_WHATSAPP_COMMUNITY_URL: 'javascript:alert(1)', NEXT_PUBLIC_EARLY_ACCESS_FORM_URL: 'http://forms.example.com' } })
  assert.doesNotMatch(unsafe, /javascript:|http:\/\/forms|Join the WhatsApp community|Early Access|Join the waitlist|WhatsApp us/)
})

test('one h1, labelled landmarks, lazy decorative images and a single preloaded hero image', async () => {
  const html = await renderHome({ env: CONFIGURED })
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1)
  assert.match(html, /<header[^>]*>/)
  assert.match(html, /<nav aria-label="Primary"/)
  assert.match(html, /<footer[^>]*>/)
  const images = [...html.matchAll(/<img ([^>]*)>/g)].map(([, attributes]) => attributes)
  assert.ok(images.length > 0)
  for (const image of images) {
    assert.match(image, /sizes="[^"]+"/)
    assert.match(image, /src="\/landing\/[^"]+"/)
    assert.match(image, /alt="[^"]*"/)
  }
  const preloaded = images.filter(image => /data-preload="true"/.test(image))
  assert.deepEqual(preloaded.map(image => /src="([^"]+)"/.exec(image)[1]), ['/landing/hero.webp'])
  assert.doesNotMatch(html, /data:image|base64|<script|fonts\.googleapis/)
})

test('the sample questions are BUA 201 bank questions with their real answers', async () => {
  const { tryQuestion } = await content()
  const bank = await withModules({}, {}, () => require(path.join(root, 'lib/data/quizzes.ts')).getQuizByCourseSlug('principles-business-administration'))
  assert.equal(bank.courseCode, 'BUA201')
  assert.equal(tryQuestion.questions.length, 2)
  for (const sample of tryQuestion.questions) {
    const source = bank.questions.find(question => question.questionId === sample.questionId)
    assert.ok(source, sample.questionId)
    assert.equal(sample.question, source.question)
    assert.deepEqual(sample.options, source.options)
    assert.equal(sample.answer, source.correctAnswer)
    assert.ok(sample.explanation.length > 0)
  }
})

test('Try a question marks right and wrong answers with an icon and a word, then offers the bank', async () => {
  const { tryQuestion } = await content()
  const { questions, ...copy } = tryQuestion
  const quiz = await interactive('TryQuestionQuiz.tsx', { copy, questions, intro: null, botSrc: '/landing/campus-bot.png' })
  global.requestAnimationFrame = callback => callback()
  try {
    assert.equal(quiz.button('Next question').props.disabled, true)
    quiz.button(questions[0].options[questions[0].answer]).props.onClick()
    let answer = quiz.button(questions[0].options[questions[0].answer])
    assert.match(quiz.text(answer), /Correct$/)
    assert.ok(elementNodes(answer).some(node => node.type?.displayName === 'Check' || /check/i.test(node.type?.displayName ?? '')))
    assert.match(quiz.text(quiz.tree().find(node => node.props?.['aria-live'] === 'polite')), new RegExp(`Why: ${questions[0].explanation.slice(0, 20)}`))

    quiz.button('Next question').props.onClick()
    const wrong = questions[1].options.findIndex((_, i) => i !== questions[1].answer)
    quiz.button(questions[1].options[wrong]).props.onClick()
    assert.match(quiz.text(quiz.button(questions[1].options[wrong])), /Wrong$/)
    assert.match(quiz.text(quiz.button(questions[1].options[questions[1].answer])), /Correct$/)
    quiz.button(questions[1].options[questions[1].answer]).props.onClick()
    assert.doesNotMatch(quiz.text(quiz.button(questions[1].options[questions[1].answer])), /Wrong/, 'a second tap changes nothing')

    quiz.button('See your score').props.onClick()
    const end = quiz.tree()
    assert.ok(end.some(node => quiz.text(node) === 'You got 1 out of 2.'))
    assert.ok(end.some(node => node.props?.href === '/register' && quiz.text(node) === 'Get the full question bank'))
    assert.ok(end.some(node => quiz.text(node) === copy.endText))

    quiz.button('Play again').props.onClick()
    assert.equal(quiz.button('Next question').props.disabled, true)
    const examSwitch = quiz.buttons().find(node => node.props.role === 'switch')
    assert.equal(examSwitch.props['aria-checked'], false)
    examSwitch.props.onClick()
    quiz.button(questions[0].options[0]).props.onClick()
    assert.match(quiz.text(quiz.button(questions[0].options[0])), /Your answer$/)
    assert.doesNotMatch(quiz.buttons().map(quiz.text).join(' '), /Correct|Wrong/, 'exam mode reveals nothing until the end')
  } finally {
    delete global.requestAnimationFrame
  }
})

test('FAQ questions are buttons with aria-expanded that open and close their answers', async () => {
  const { faq } = await content()
  const list = await interactive('FaqList.tsx', { items: faq.items })
  const toggles = () => list.buttons()
  assert.equal(toggles().length, faq.items.length)
  assert.deepEqual(toggles().map(node => node.props['aria-expanded']), [true, false, false, false, false])
  const answer = id => list.tree().find(node => node.props?.id === id)
  const second = toggles()[1]
  assert.equal(answer(second.props['aria-controls']).props.hidden, true)
  second.props.onClick()
  assert.equal(toggles()[1].props['aria-expanded'], true)
  assert.equal(answer(second.props['aria-controls']).props.hidden, false)
  toggles()[1].props.onClick()
  assert.equal(toggles()[1].props['aria-expanded'], false)
})

test('the mobile menu toggles with aria-expanded and lists Browse courses and account entry', async () => {
  const { header } = await content()
  const menu = await interactive('MobileMenu.tsx', { links: header.links, login: header.login, register: header.register,
    label: header.menuLabel, openLabel: header.menuOpen, closeLabel: header.menuClose })
  const toggle = () => menu.buttons()[0]
  assert.equal(toggle().props['aria-expanded'], false)
  assert.equal(toggle().props['aria-label'], 'Open menu')
  toggle().props.onClick()
  assert.equal(toggle().props['aria-expanded'], true)
  assert.equal(toggle().props['aria-label'], 'Close menu')
  const links = menu.tree().filter(node => node.props?.href)
  assert.ok(links.some(node => node.props.href === '/courses' && menu.text(node) === 'Browse courses'))
  assert.ok(links.some(node => node.props.href === '/login'))
  assert.ok(links.some(node => node.props.href === '/register'))
})

// Emoji are pictographs; the typographic © ® ™ marks are text symbols the copyright line legitimately uses.
const EMOJI = /(?![\u00a9\u00ae\u2122])[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{FE0F}]/u

test('no emoji and no hand-drawn SVG: icons are lucide-react or official brand image files', async () => {
  const sourceFiles = [
    ...fs.readdirSync(__dirname).map(file => path.join(__dirname, file)),
    ...fs.readdirSync(path.join(root, 'lib/landing')).map(file => path.join(root, 'lib/landing', file)),
  ].filter(file => /\.(tsx?|css)$/.test(file))
  for (const file of sourceFiles) {
    const source = fs.readFileSync(file, 'utf8')
    assert.doesNotMatch(source, EMOJI, `${path.relative(root, file)} contains an emoji`)
    if (!/\.test\./.test(file)) {
      assert.doesNotMatch(source, /<svg|<path|stroke-dash|@keyframes draw/i, `${path.relative(root, file)} draws SVG`)
      assert.doesNotMatch(source, /from 'lucide-react'[^\n]*\b(?:Instagram|Twitter|Facebook|MessageCircle)\b/, 'brand marks are official files')
    }
  }
  assert.doesNotMatch('Join the WhatsApp community', EMOJI)
  assert.match('\u260e Join the WhatsApp community', EMOJI, 'the check catches the design\'s phone glyph')

  const html = await renderHome({ env: CONFIGURED })
  assert.doesNotMatch(html.replace(/<svg[\s\S]*?<\/svg>/g, ''), EMOJI)
  const sources = [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map(([, src]) => src)
  for (const src of sources) assert.match(src, /^\/landing\/[\w/-]+\.(?:png|webp|jpe?g|gif)$/, src)
  for (const brand of ['whatsapp-glyph-white.png', 'whatsapp-glyph-green.png', 'instagram-glyph.png', 'x-logo-black.png']) {
    assert.ok(sources.includes(`/landing/icons/${brand}`), brand)
    assert.ok(fs.existsSync(path.join(root, 'public/landing/icons', brand)), brand)
  }
  for (const file of fs.readdirSync(path.join(root, 'public/landing'), { recursive: true })) {
    if (fs.statSync(path.join(root, 'public/landing', file)).isFile()) assert.match(file, /\.(?:png|webp|jpe?g|gif|mp4|webm)$/, file)
  }
})

test('landing source keeps client code small, scripts out, colours on tokens and motion optional', () => {
  const dir = __dirname
  const sources = fs.readdirSync(dir).filter(file => /\.(tsx?|css)$/.test(file))
  for (const file of sources) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8')
    assert.equal(/^'use client'/m.test(source), CLIENT_FILES.includes(file), `${file} client boundary`)
    assert.doesNotMatch(source, /dangerouslySetInnerHTML|<script|#[0-9a-fA-F]{3,8}\b|base64|fonts\.googleapis/, file)
  }
  const css = fs.readFileSync(path.join(dir, 'landing.module.css'), 'utf8')
  const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
  assert.match(reduced, /\.landing \*[^{]*\{[^}]*animation: none !important;[^}]*transition: none !important;/)
  for (const [, name] of css.matchAll(/@keyframes (\w+)/g)) assert.match(css, new RegExp(`animation: ${name}\\b`), name)
  const fontUsers = ['app', 'components'].flatMap(function walk(folder) {
    return fs.readdirSync(path.join(root, folder), { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? walk(`${folder}/${entry.name}`) : /\.tsx?$/.test(entry.name) ? [`${folder}/${entry.name}`] : [])
  }).filter(file => /next\/font\/google/.test(fs.readFileSync(path.join(root, file), 'utf8')))
  assert.deepEqual(fontUsers.sort(), ['app/layout.tsx', 'components/landing/fonts.ts'])
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8'), /Playfair|Source_Sans/)
})
