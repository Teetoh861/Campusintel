// lib/test/tsx-loader.cjs — Compile .tsx on require for node:test suites; test-only, never bundled.
const fs = require('node:fs')
const Module = require('node:module')
const ts = require('typescript')

const COMPILER_OPTIONS = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }

function compile(module, file) {
  module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: COMPILER_OPTIONS }).outputText, file)
}

/** Register .tsx compilation (and the server-only stub) for the duration of `run`, restoring afterwards. */
async function withTsx(run) {
  const originalTsx = Module._extensions['.tsx']
  const originalLoad = Module._load
  const cache = new Set(Object.keys(require.cache))
  Module._extensions['.tsx'] = compile
  Module._load = function(name, ...args) {
    if (name === 'server-only') return {}
    return originalLoad.call(this, name, ...args)
  }
  try {
    return await run()
  } finally {
    Module._load = originalLoad
    if (originalTsx) Module._extensions['.tsx'] = originalTsx; else delete Module._extensions['.tsx']
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
  }
}

module.exports = { compile, withTsx }
