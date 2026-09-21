const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomUUID } = require('node:crypto')
const fs = require('node:fs')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

test('server-rendered selection form cannot submit before hydration', () => {
  const previousTsx = Module._extensions['.tsx']
  const file = require.resolve('./ProfileSelectionForm.tsx')
  try {
    Module._extensions['.tsx'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, path)
    delete require.cache[file]
    const { ProfileSelectionForm } = require(file)
    const html = renderToStaticMarkup(React.createElement(ProfileSelectionForm, {
      initial: { status: 'incomplete', options: {
        departments: [{ id: randomUUID(), label: 'Unit A' }],
        academicLevels: [{ id: randomUUID(), label: 'Stage B' }],
        academicPeriods: [{ id: randomUUID(), label: 'Term C' }],
      } },
    }))
    assert.match(html, /<form\b/)
    for (const id of ['department', 'academic-level', 'academic-period']) {
      const control = html.match(new RegExp(`<select\\b[^>]*\\bid="${id}"[^>]*>`))?.[0]
      assert.ok(control, `${id} is present in server HTML`)
      assert.match(control, /\sdisabled(?:="")?(?=\s|>)/, `${id} is inert before hydration`)
    }
    const submit = html.match(/<button\b[^>]*\btype="submit"[^>]*>/)?.[0]
    assert.ok(submit, 'submit button is present in server HTML')
    assert.match(submit, /\sdisabled(?:="")?(?=\s|>)/, 'native submit is unavailable before hydration')
  } finally {
    if (previousTsx) Module._extensions['.tsx'] = previousTsx
    else delete Module._extensions['.tsx']
    delete require.cache[file]
  }
})
