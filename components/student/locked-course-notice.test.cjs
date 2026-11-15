const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { courseAdditionContact, courseChangeContact, COURSE_ADDITION_MESSAGE, COURSE_CHANGE_MESSAGE } = require('../../lib/whatsapp.ts')

function render(number, props = { outsideList: true, passHours: 72 }) {
  const load = Module._load, extension = Module._extensions['.tsx']
  const file = require.resolve('./LockedCourseNotice.tsx')
  try {
    Module._extensions['.tsx'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true },
    }).outputText, path)
    Module._load = function(name, ...args) {
      if (name === '@/lib/whatsapp') return { courseChangeContact: fallback => courseChangeContact(fallback, number),
        courseAdditionContact: fallback => courseAdditionContact(fallback, number) }
      return load.call(this, name, ...args)
    }
    delete require.cache[file]
    const { LockedCourseNotice } = require(file)
    return renderToStaticMarkup(React.createElement(LockedCourseNotice, props))
  } finally {
    Module._load = load
    if (extension) Module._extensions['.tsx'] = extension; else delete Module._extensions['.tsx']
    delete require.cache[file]
  }
}
test('outside-list contact uses generic WhatsApp text and never offers a plan or Discovery', () => {
  const html = render('2349012345678')
  assert.match(html, /Not in your courses this semester\./)
  assert.match(html, /Message us to add it\./)
  assert.ok(html.replaceAll('&#x27;', "'").includes('https://wa.me/2349012345678?text=' + encodeURIComponent(COURSE_ADDITION_MESSAGE)))
  assert.match(html, /rel="noopener noreferrer"/)
  assert.doesNotMatch(html, /Discovery|Early Access|See how to unlock|href="\/access"/)
})
test('missing or invalid WhatsApp configuration opens Help & Support', () => {
  for (const value of ['', 'invalid']) {
    const html = render(value)
    assert.match(html, /href="\/contact"/)
    assert.doesNotMatch(html, /wa.me|target="_blank"/)
  }
})

test('open selection recovery has one confirmation action and no plan or contact offer',()=>{
  const html=render('2349012345678',{reason:'needs-selection',passHours:72,backHref:'/courses',backLabel:'Back'})
  assert.match(html,/Confirm your courses for this semester\./)
  assert.match(html,/href="\/profile-selection"/)
  assert.match(html,/>Confirm my courses</)
  assert.equal((html.match(/<a\b/g)||[]).length,1)
  assert.doesNotMatch(html,/Message us|Discovery|Early Access|See how to unlock|>Back</)
})
test('locked semester mismatch has one team-contact action using the existing change message',()=>{
  for(const number of ['2349012345678','']) {
    const html=render(number,{reason:'selection-locked',passHours:72,backHref:'/courses',backLabel:'Back'})
    assert.match(html,/Your courses are set for another semester\./)
    assert.match(html,/>Message us</)
    assert.equal((html.match(/<a\b/g)||[]).length,1)
    assert.ok(html.includes(number ? encodeURIComponent(COURSE_CHANGE_MESSAGE) : 'href="/contact"'))
    assert.doesNotMatch(html,/Confirm my courses|Discovery|Early Access|See how to unlock|>Back</)
  }
})

const SOME = { notes: true, cbtPractice: true, theory: false }
const NONE = { notes: false, cbtPractice: false, theory: false }

test('a locked course is one notice: what it has, the unlock action and the free pass as a second button', () => {
  const html = render('2349012345678', { passHours: 72, has: SOME })
  assert.equal((html.match(/class="student-notice"/g) || []).length, 1, 'no second notice linking to the same page')
  assert.match(html, /<h2 class="student-notice-title">Included with full access<\/h2><p class="student-notice-text">Notes · CBT practice<\/p>/)
  assert.match(html, /<a class="[^"]*" href="\/access">See how to unlock<\/a><a data-pass-offer="" class="[^"]*" href="\/access">Get your free pass<\/a>/)
  assert.doesNotMatch(html, /GST|open fully|Try your department courses|CBT exam|study guide|one per|preview them first|Discovery/i,
    'no repetition, no GST line, and what the pass includes stays in the modal')
  const subscribe = render('2349012345678', { passHours: null, has: SOME, plansOnSale: true })
  assert.match(subscribe, /Included when you subscribe[\s\S]*>Subscribe<\/a>/)
  assert.doesNotMatch(subscribe, /data-pass-offer|Free pass|Get your free pass/)
  assert.doesNotMatch(render('2349012345678', { has: SOME }), /data-pass-offer|Get your free pass/)
})

test('a locked course with nothing published offers nothing to buy and says so', () => {
  const html = render('2349012345678', { passHours: 72, has: NONE, plansOnSale: true, backHref: '/courses/x', backLabel: 'Back to course' })
  assert.match(html, /<h2 class="student-notice-title">Study materials are not available\.<\/h2>/)
  assert.doesNotMatch(html, /href="\/access"|Subscribe|See how to unlock|Get your free pass|Included/)
  assert.match(html, /href="\/courses\/x"[^>]*>Back to course<\/a>/)
  assert.equal((html.match(/<a\b/g) || []).length, 1)
})
