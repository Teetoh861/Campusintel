// lib/auth/test-loader.cjs — Node test adapter using the existing TypeScript dependency.
// Only preloaded by the documented test command; never imported by application code.
const Module = require('node:module')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const originalLoad = Module._load
const originalResolve = Module._resolveFilename
Module._load = function (name, ...args) {
  if (name === 'server-only') return {}
  return originalLoad.call(this, name, ...args)
}
Module._resolveFilename = function (name, ...args) {
  if (name.startsWith('@/')) name = path.join(process.cwd(), name.slice(2))
  return originalResolve.call(this, name, ...args)
}
Module._extensions['.ts'] = function (module, file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  })
  module._compile(output.outputText, file)
}
