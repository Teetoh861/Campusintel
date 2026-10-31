const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), Module = require('node:module'), ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { courseAdditionContact, courseChangeContact, COURSE_ADDITION_MESSAGE, COURSE_CHANGE_MESSAGE } = require('../../lib/whatsapp.ts')

function render(number, props = { outsideList: true, passOffered: true }) {
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
  const html=render('2349012345678',{reason:'needs-selection',passOffered:true,backHref:'/courses',backLabel:'Back'})
  assert.match(html,/Confirm your courses for this semester\./)
  assert.match(html,/href="\/profile-selection"/)
  assert.match(html,/>Confirm my courses</)
  assert.equal((html.match(/<a\b/g)||[]).length,1)
  assert.doesNotMatch(html,/Message us|Discovery|Early Access|See how to unlock|>Back</)
})
test('locked semester mismatch has one team-contact action using the existing change message',()=>{
  for(const number of ['2349012345678','']) {
    const html=render(number,{reason:'selection-locked',passOffered:true,backHref:'/courses',backLabel:'Back'})
    assert.match(html,/Your courses are set for another semester\./)
    assert.match(html,/>Message us</)
    assert.equal((html.match(/<a\b/g)||[]).length,1)
    assert.ok(html.includes(number ? encodeURIComponent(COURSE_CHANGE_MESSAGE) : 'href="/contact"'))
    assert.doesNotMatch(html,/Confirm my courses|Discovery|Early Access|See how to unlock|>Back</)
  }
})
