// components/chrome/ui.test.cjs — Concatenation compatibility and explicit button precedence.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')
const previous = Module._extensions['.tsx']
Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, file)
const { btnBase, btnSm, btnGhost, btnGhostOnBlue, btnAccent, cx, buttonClassName } = require('./ui.tsx')
if (previous) Module._extensions['.tsx'] = previous; else delete Module._extensions['.tsx']

test('cx preserves conflicting and duplicate classes and filters only falsy parts', () => {
  assert.equal(cx('border-transparent', null, 'border-student-border-strong', 'px-5', false,
    'px-4', undefined, 'px-4', ''), 'border-transparent border-student-border-strong px-5 px-4 px-4')
  assert.equal(cx(' px-5 ', 'px-4'), ' px-5  px-4')
  assert.equal(cx(), '')
  for (const parts of [[btnBase, btnSm, btnGhost, 'min-h-11 border-ci-border-2 text-ci-navy-900'],
    [btnBase, btnSm, btnGhost, 'disabled:pointer-events-none disabled:opacity-40'],
    [btnBase, btnSm, btnAccent], [btnBase, btnSm, btnGhost, 'min-[1024px]:hidden'],
    [btnBase, btnSm, btnAccent, 'w-full']]) {
    assert.equal(cx(...parts), parts.join(' '), 'existing quiz-style compositions keep every original token')
  }
})

test('ghost variants retain their semantic outline instead of a conflicting transparent border', () => {
  for (const [variant, border] of [[btnGhost, 'border-student-border-strong'], [btnGhostOnBlue, 'border-student-navigation-outline']]) {
    const classes = buttonClassName(btnBase, btnSm, variant)
    assert.ok(classes.split(' ').includes(border))
    assert.doesNotMatch(classes, /border-transparent/)
    assert.doesNotMatch(classes, /(?:^| )(?:px-5|py-2\.5|text-\[15px\])(?: |$)/)
    for (const required of ['min-h-11', 'px-4', 'py-2', 'text-[14px]', 'tablet:text-[15px]']) {
      assert.ok(classes.split(' ').includes(required), `missing compact action class ${required}`)
    }
  }
})

test('primary actions and explicit compact sizing preserve intended precedence', () => {
  const classes = buttonClassName(btnBase, btnSm, btnAccent, 'px-2 tablet:px-4')
  assert.match(classes, /bg-student-accent/)
  assert.match(classes, /border-transparent/)
  assert.doesNotMatch(classes, /(?:^| )px-4(?: |$)/)
  assert.match(classes, /tablet:px-4/)
})
