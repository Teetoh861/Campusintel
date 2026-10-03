// components/admin/ContentForm.test.cjs — Revising seeded text never strips structured source fields.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')

function findForm(node) {
  if (Array.isArray(node)) return node.map(findForm).find(Boolean)
  if (!node || typeof node !== 'object') return null
  if (node.type === 'form') return node
  return findForm(node.props?.children)
}

test('overview and note edits preserve their structured repository fields', async () => {
  const oldLoad = Module._load
  const oldTsx = Module._extensions['.tsx']
  const filename = require.resolve('./ContentForm.tsx')
  const hooks = []
  let cursor = 0
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(
      fs.readFileSync(file, 'utf8'), { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      } },
    ).outputText, file)
    Module._load = function (name, ...args) {
      if (name === 'react') return { useState: initial => {
        const index = cursor++
        if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
        return [hooks[index], value => { hooks[index] = value }]
      } }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('react.fragment') }
      return oldLoad.call(this, name, ...args)
    }
    delete require.cache[filename]
    const { ContentForm } = require(filename)
    const cases = [
      { kind: 'course_overview', payload: { title: 'Course', body: 'Overview',
        topics: [{ chapter: '1', description: 'Introduction' }],
        examFocus: ['Definitions'], formulaSheet: [{ name: 'Ratio', formula: 'A / B',
          explanation: 'Meaning' }] } },
      { kind: 'note', payload: { title: 'Topic', body: 'Summary',
        noteType: 'topic_note', keyPoints: ['Keep this point'], examTip: 'Review this' } },
      { kind: 'note', payload: { title: 'Calculator', body: 'Method',
        noteType: 'calculator_trick', example: '2 + 2 = 4', formula: 'x + y' } },
    ]
    for (const [index, item] of cases.entries()) {
      hooks.length = 0
      cursor = 0
      const writes = []
      const tree = ContentForm({ courseId: '40000000-0000-4000-8000-000000000001',
        item: { item_id: `10000000-0000-4000-8000-00000000000${index}`,
          parent_item_id: null, lock_version: 3, ...item },
        allItems: [], busy: false, onSave: async input => { writes.push(input) } })
      findForm(tree).props.onSubmit({ preventDefault() {} })
      assert.equal(writes.length, 1)
      assert.deepEqual(writes[0].payload, item.payload)
    }
  } finally {
    Module._load = oldLoad
    if (oldTsx) Module._extensions['.tsx'] = oldTsx
    else delete Module._extensions['.tsx']
    delete require.cache[filename]
  }
})
