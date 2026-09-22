const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const ts = require('typescript')

test('profile selection pending state is an accessible, inert form skeleton', () => {
  const previousTsx = Module._extensions['.tsx']
  const file = require.resolve('./loading.tsx')
  try {
    Module._extensions['.tsx'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, path)
    delete require.cache[file]
    const Loading = require(file).default
    const html = renderToStaticMarkup(React.createElement(Loading))

    assert.match(html, /<h1[^>]*>Profile selection<\/h1>/)
    assert.match(html, /role="status"/)
    assert.match(html, /aria-live="polite"/)
    assert.match(html, /aria-busy="true"/)
    assert.match(html, /class="sr-only">Please wait\.<\/span>/)
    assert.doesNotMatch(html, /Loading selection|Fetching profile/i)
    assert.doesNotMatch(html, /<(?:button|input|select)\b/)
    assert.equal((html.match(/\bh-12\b/g) || []).length, 3)
    assert.equal((html.match(/\bh-11\b/g) || []).length, 1)
    assert.match(html, /bg-ci-blue-50/)
    assert.match(html, /motion-reduce:animate-none/)
  } finally {
    if (previousTsx) Module._extensions['.tsx'] = previousTsx
    else delete Module._extensions['.tsx']
    delete require.cache[file]
  }
})
