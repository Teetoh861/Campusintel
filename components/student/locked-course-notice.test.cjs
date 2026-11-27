// components/student/locked-course-notice.test.cjs — The one notice on a course the student's plan does not include:
// a course off their list (message us), courses not confirmed yet, and a course a plan would open, where the one
// button is free access when this student can claim it, else the free pass, else the way to a plan.
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
      // The free month button asks the router to read the page again; these renders mount no router.
      if (name === 'next/navigation') return { useRouter: () => ({ refresh() {} }) }
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
  assert.match(html, />Message us to add it<\/a>/, 'the button says what the message is for')
  assert.doesNotMatch(html, /Message us to add it\./, 'and no sentence above it says it again')
  assert.equal((html.match(/<a\b/g) || []).length, 1)
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
  assert.match(html,/>Confirm your courses</)
  assert.equal((html.match(/<a\b/g)||[]).length,1)
  assert.doesNotMatch(html,/Message us|Discovery|Early Access|See how to unlock|>Back</)
})
test('locked semester mismatch has one team-contact action using the existing change message',()=>{
  for(const number of ['2349012345678','']) {
    const html=render(number,{reason:'selection-locked',passHours:72,backHref:'/courses',backLabel:'Back'})
    assert.match(html,/Not in your courses this semester\./)
    assert.match(html,/>Message us</)
    assert.equal((html.match(/<a\b/g)||[]).length,1)
    assert.ok(html.includes(number ? encodeURIComponent(COURSE_CHANGE_MESSAGE) : 'href="/contact"'))
    assert.doesNotMatch(html,/Confirm (my|your) courses|Discovery|Early Access|See how to unlock|>Back</)
  }
})

const SOME = { notes: true, cbtPractice: true, theory: false }
// What the course has, as the notice lists it: the labels are the study families' own.
const HAS = require('./study-families.ts').getStudyFamilyLabels(SOME).join(' · ')
const NONE = { notes: false, cbtPractice: false, theory: false }

const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map(match => [match[1], match[2]])

test('a locked course is one notice: what it has and one button to Plan & Access, named for what the student finds there', () => {
  const html = render('2349012345678', { passHours: 72, has: SOME })
  assert.equal((html.match(/class="student-notice"/g) || []).length, 1, 'no second notice linking to the same page')
  assert.ok(html.includes(`<h2 class="student-notice-title">Included with a plan.</h2><p class="student-notice-text">${HAS}</p>`), html)
  assert.deepEqual(links(html), [['/access', 'Get your free pass']], 'a student who can still get a free pass: that, and no second button to the same page')
  assert.doesNotMatch(html, /GST|open fully|Try your department courses|CBT exam|one per|preview them first|Discovery|See how to unlock/i,
    'no repetition, no GST line, and what the pass includes stays in the modal')
  // No pass to get: the way to unlock, in the words the plan state uses.
  assert.deepEqual(links(render('2349012345678', { passHours: null, has: SOME })), [['/access', 'See how to unlock']])
  assert.deepEqual(links(render('2349012345678', { has: SOME })), [['/access', 'See how to unlock']])
  const subscribe = render('2349012345678', { passHours: null, has: SOME, plansOnSale: true })
  assert.match(subscribe, /Included when you subscribe\./)
  assert.deepEqual(links(subscribe), [['/access', 'Subscribe']])
  // The pass comes first while it can still be started, also once plans are on sale; the way back stays beside it.
  assert.deepEqual(links(render('2349012345678', { passHours: 72, has: SOME, plansOnSale: true, backHref: '/courses/x', backLabel: 'Back to course' })),
    [['/access', 'Get your free pass'], ['/courses/x', 'Back to course']])
})

// What the page hands the notice: the last day free access covers, as the server wrote it from the database's end.
const FREE_MONTH = { continuityToken: 'page-token', profileRevision: 7, endsOn: '30 December' }

test('a student who can claim free access sees it on a locked course: one line with its last day, what the course has and the button, in place of the pass and the plans', () => {
  for (const props of [{ passHours: 72 }, { passHours: null, plansOnSale: true }, { passHours: 72, plansOnSale: true }, {}]) {
    const html = render('2349012345678', { has: SOME, freeMonth: FREE_MONTH, ...props })
    assert.equal((html.match(/class="student-notice"/g) || []).length, 1)
    assert.ok(html.includes(`<h2 class="student-notice-title">Included free until 30 December.</h2><p class="student-notice-text">${HAS}</p>`), html)
    assert.match(html, /<div class="student-notice-action"><button type="button" data-free-month-start=""[^>]*>Get free access<\/button><\/div>/)
    assert.deepEqual(links(html), [], 'no trip to Plan & Access: the confirmation opens here')
    assert.equal((html.match(/30 December/g) || []).length, 1, 'the title carries the last day, once')
    assert.doesNotMatch(html, /free pass|Subscribe|See how to unlock|with a plan|full access|Early Access|31 Dec|free month/,
      'nothing else is offered, and never the 31st')
  }
  // The way back stays beside it.
  assert.deepEqual(links(render('2349012345678', { has: SOME, freeMonth: FREE_MONTH, backHref: '/courses/x', backLabel: 'Back to course' })),
    [['/courses/x', 'Back to course']])
})

test('free access is not offered where it would not open the course: off the list, courses not confirmed, nothing published', () => {
  for (const props of [{ outsideList: true }, { reason: 'outside-list' }, { reason: 'needs-selection' },
    { reason: 'selection-locked' }, { has: NONE }]) {
    const html = render('2349012345678', { has: SOME, freeMonth: FREE_MONTH, ...props })
    assert.doesNotMatch(html, /Free until|free access|data-free-month/i, JSON.stringify(props))
  }
})

test('a locked course with nothing published offers nothing to buy and says so', () => {
  const html = render('2349012345678', { passHours: 72, has: NONE, plansOnSale: true, backHref: '/courses/x', backLabel: 'Back to course' })
  assert.match(html, /<h2 class="student-notice-title">Study materials are not available\.<\/h2>/)
  assert.doesNotMatch(html, /href="\/access"|Subscribe|See how to unlock|Get your free pass|Included/)
  assert.match(html, /href="\/courses\/x"[^>]*>Back to course<\/a>/)
  assert.equal((html.match(/<a\b/g) || []).length, 1)
})
