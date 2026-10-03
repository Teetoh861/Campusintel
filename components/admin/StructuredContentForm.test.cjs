// components/admin/StructuredContentForm.test.cjs — Operator form interactions preserve and edit structured managed fields.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const Module = require('node:module')
const { test } = require('node:test')
const ts = require('typescript')
const { parseContentPayload } = require('../../lib/operator/editor-contract.ts')

const COURSE_ID = '40000000-0000-4000-8000-000000000001'
const ITEM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const overview = {
  title: 'Course overview', body: 'Published body',
  topics: [{ chapter: '1', description: 'First topic' }, { chapter: '2', description: 'Second topic' }],
  examFocus: ['First focus', 'Second focus'],
  keyTakeaways: [{ title: 'First rule', description: 'First meaning' },
    { title: 'Second rule', description: 'Second meaning' }],
  formulaSheet: [{ name: 'First formula', formula: 'x + y', explanation: 'First explanation', example: '2 + 2' },
    { name: 'Second formula', formula: 'x - y', explanation: 'Second explanation' }],
}

function childrenText(node) {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(childrenText).join('')
  return node && typeof node === 'object' ? childrenText(node.props?.children) : ''
}

function findAll(node, predicate) {
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, predicate))
  if (!node || typeof node !== 'object') return []
  return [...(predicate(node) ? [node] : []), ...findAll(node.props?.children, predicate)]
}

function expand(node) {
  if (Array.isArray(node)) return node.map(expand)
  if (!node || typeof node !== 'object') return node
  if (typeof node.type === 'function') return expand(node.type(node.props))
  return { ...node, props: { ...node.props, children: expand(node.props?.children) } }
}

async function formFixture(item, run) {
  const oldLoad = Module._load
  const oldTsx = Module._extensions['.tsx']
  const cached = new Set(Object.keys(require.cache))
  const hooks = []
  const writes = []
  let cursor = 0
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  try {
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    Module._load = function (name, ...args) {
      if (name === 'react') return { useState: initial => {
        const index = cursor++
        if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
        return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
      } }
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: Symbol.for('react.fragment') }
      return oldLoad.call(this, name, ...args)
    }
    const file = require.resolve('./ContentForm.tsx')
    delete require.cache[file]
    const { ContentForm } = require(file)
    const props = { courseId: COURSE_ID, item, allItems: [], busy: false,
      onSave: async input => { writes.push(input) } }
    const render = () => { cursor = 0; return expand(ContentForm(props)) }
    const field = id => {
      const match = findAll(render(), node => node.props?.id === id)[0]
      assert.ok(match, `missing field ${id}`)
      return match
    }
    const change = (id, value) => field(id).props.onChange({ target: { value } })
    const click = label => {
      const button = findAll(render(), node => node.type === 'button' && childrenText(node) === label)[0]
      assert.ok(button, `missing button ${label}`)
      assert.notEqual(button.props.disabled, true, `${label} is disabled`)
      button.props.onClick()
    }
    const submit = async () => {
      const form = findAll(render(), node => node.type === 'form')[0]
      form.props.onSubmit({ preventDefault() {} })
      await new Promise(resolve => setImmediate(resolve))
    }
    await run({ render, field, change, click, submit, writes })
  } finally {
    Module._load = oldLoad
    if (oldTsx) Module._extensions['.tsx'] = oldTsx
    else delete Module._extensions['.tsx']
    for (const file of Object.keys(require.cache)) if (!cached.has(file)) delete require.cache[file]
  }
}

function existing(kind, payload) {
  return { item_id: ITEM_ID, course_id: COURSE_ID, kind, payload,
    parent_item_id: null, lock_version: 3, current_revision: 3,
    approved_revision: 1, published_revision: 1 }
}

function savedRevision(writes, original, kind) {
  assert.equal(writes.length, 1)
  assert.equal(writes[0].action, 'revise')
  assert.equal(writes[0].itemId, ITEM_ID)
  assert.equal(writes[0].expectedLockVersion, 3)
  assert.deepEqual(parseContentPayload(kind, writes[0].payload), writes[0].payload)
  assert.equal(original.published_revision, 1)
  assert.equal(original.lock_version, 3)
  return writes[0].payload
}

test('seeded overview loads every field and a body-only draft preserves all structured values', async () => {
  const item = existing('course_overview', overview)
  await formFixture(item, async form => {
    for (const [id, value] of [
      ['overview-topic-0-chapter', '1'], ['overview-topic-1-description', 'Second topic'],
      ['overview-exam-0', 'First focus'], ['overview-takeaway-1-title', 'Second rule'],
      ['overview-formula-0-formula', 'x + y'], ['overview-formula-0-example', '2 + 2'],
    ]) assert.equal(form.field(id).props.value, value)
    form.change('content-body', 'New draft body')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, item, 'course_overview'),
      { ...overview, body: 'New draft body' })
  })
})

test('topics can be added, edited, removed, and reordered without changing other overview fields', async () => {
  const item = existing('course_overview', overview)
  await formFixture(item, async form => {
    form.change('overview-topic-0-description', 'Revised first topic')
    form.click('Add topic')
    form.change('overview-topic-2-chapter', '3')
    form.change('overview-topic-2-description', 'Third topic')
    form.click('Move topic 3 up')
    form.click('Remove topic 3')
    await form.submit()
    const payload = savedRevision(form.writes, item, 'course_overview')
    assert.deepEqual(payload.topics, [{ chapter: '1', description: 'Revised first topic' },
      { chapter: '3', description: 'Third topic' }])
    assert.deepEqual(payload.examFocus, overview.examFocus)
    assert.deepEqual(payload.keyTakeaways, overview.keyTakeaways)
    assert.deepEqual(payload.formulaSheet, overview.formulaSheet)
  })
})

test('exam focus entries can be added, edited, removed, reordered, or left explicitly empty', async () => {
  const item = existing('course_overview', overview)
  await formFixture(item, async form => {
    form.change('overview-exam-0', 'Revised first focus')
    form.click('Add exam focus')
    form.change('overview-exam-2', 'Third focus')
    form.click('Move exam focus 3 up')
    form.click('Remove exam focus 3')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, item, 'course_overview').examFocus,
      ['Revised first focus', 'Third focus'])
  })
  await formFixture(item, async form => {
    form.click('Remove exam focus 2')
    form.click('Remove exam focus 1')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, item, 'course_overview').examFocus, [])
  })
})

test('key takeaways can be added, edited, removed, and reordered', async () => {
  const item = existing('course_overview', overview)
  await formFixture(item, async form => {
    form.change('overview-takeaway-0-description', 'Revised first meaning')
    form.click('Add key takeaway')
    form.change('overview-takeaway-2-title', 'Third rule')
    form.change('overview-takeaway-2-description', 'Third meaning')
    form.click('Move key takeaway 3 up')
    form.click('Remove key takeaway 3')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, item, 'course_overview').keyTakeaways,
      [{ title: 'First rule', description: 'Revised first meaning' },
        { title: 'Third rule', description: 'Third meaning' }])
  })
})

test('formula entries and optional examples can be added, edited, removed, and reordered', async () => {
  const item = existing('course_overview', overview)
  await formFixture(item, async form => {
    form.change('overview-formula-0-example', 'Updated example')
    form.click('Add formula')
    form.change('overview-formula-2-name', 'Third formula')
    form.change('overview-formula-2-formula', 'x * y')
    form.change('overview-formula-2-explanation', 'Third explanation')
    form.change('overview-formula-2-example', '3 * 4')
    form.click('Move formula 3 up')
    form.click('Remove formula 3')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, item, 'course_overview').formulaSheet,
      [{ name: 'First formula', formula: 'x + y', explanation: 'First explanation', example: 'Updated example' },
        { name: 'Third formula', formula: 'x * y', explanation: 'Third explanation', example: '3 * 4' }])
  })
  await formFixture(item, async form => {
    form.change('overview-formula-0-example', '')
    await form.submit()
    assert.equal(Object.hasOwn(savedRevision(form.writes, item, 'course_overview').formulaSheet[0], 'example'), false)
  })
})

test('topic notes load, stay topic notes, and save edited key points and exam tip', async () => {
  const payload = { title: 'Topic', body: 'Summary', noteType: 'topic_note',
    keyPoints: ['First point', 'Second point'], examTip: 'Review this' }
  const item = existing('note', payload)
  await formFixture(item, async form => {
    assert.equal(form.field('content-note-format').props.value, 'topic_note')
    assert.equal(form.field('content-note-format').props.disabled, true)
    assert.equal(form.field('note-key-point-1').props.value, 'Second point')
    assert.equal(form.field('content-note-exam-tip').props.value, 'Review this')
    form.change('note-key-point-0', 'Revised first point')
    form.click('Add key point')
    form.change('note-key-point-2', 'Third point')
    form.click('Move key point 3 up')
    form.click('Remove key point 3')
    form.change('content-note-exam-tip', 'New exam tip')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, item, 'note'), { ...payload,
      keyPoints: ['Revised first point', 'Third point'], examTip: 'New exam tip' })
  })
})

test('calculator tricks load and edit example/formula; generic notes stay generic', async () => {
  const trick = { title: 'Calculator', body: 'Method', noteType: 'calculator_trick',
    example: '2 + 2 = 4', formula: 'x + y' }
  const item = existing('note', trick)
  await formFixture(item, async form => {
    assert.equal(form.field('content-note-format').props.value, 'calculator_trick')
    assert.equal(form.field('content-note-format').props.disabled, true)
    assert.equal(form.field('content-note-example').props.value, trick.example)
    assert.equal(form.field('content-note-formula').props.value, trick.formula)
    form.change('content-note-example', '3 + 3 = 6')
    form.change('content-note-formula', 'a + b')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, item, 'note'), { ...trick,
      example: '3 + 3 = 6', formula: 'a + b' })
  })
  await formFixture(item, async form => {
    form.change('content-note-formula', '')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, item, 'note'),
      { title: trick.title, body: trick.body, noteType: 'calculator_trick', example: trick.example })
  })
  const generic = existing('note', { title: 'Plain', body: 'Note body' })
  await formFixture(generic, async form => {
    assert.equal(form.field('content-note-format').props.value, 'generic')
    form.change('content-body', 'Revised note body')
    await form.submit()
    assert.deepEqual(savedRevision(form.writes, generic, 'note'),
      { title: 'Plain', body: 'Revised note body' })
  })
})

test('new topic and calculator notes require an explicit format choice and valid subtype fields', async () => {
  await formFixture(null, async form => {
    form.change('content-note-format', 'topic_note')
    form.change('content-title', 'Topic')
    form.change('content-body', 'Summary')
    form.click('Add key point')
    form.change('note-key-point-0', 'Study this')
    await form.submit()
    assert.deepEqual(form.writes[0], { action: 'create', courseId: COURSE_ID, kind: 'note',
      payload: { title: 'Topic', body: 'Summary', noteType: 'topic_note', keyPoints: ['Study this'] } })
  })
  await formFixture(null, async form => {
    form.change('content-note-format', 'calculator_trick')
    form.change('content-title', 'Calculator')
    form.change('content-body', 'Method')
    form.change('content-note-example', '3 + 4 = 7')
    await form.submit()
    assert.deepEqual(form.writes[0], { action: 'create', courseId: COURSE_ID, kind: 'note',
      payload: { title: 'Calculator', body: 'Method', noteType: 'calculator_trick', example: '3 + 4 = 7' } })
  })
})

test('new overviews and generic notes can be authored through structured controls', async () => {
  await formFixture(null, async form => {
    form.change('content-kind', 'course_overview')
    form.change('content-title', 'New course')
    form.change('content-body', 'New overview body')
    form.click('Add topic')
    form.change('overview-topic-0-chapter', '1')
    form.change('overview-topic-0-description', 'Introduction')
    form.click('Add exam focus')
    form.change('overview-exam-0', 'Definitions')
    form.click('Add key takeaway')
    form.change('overview-takeaway-0-title', 'Principle')
    form.change('overview-takeaway-0-description', 'Meaning')
    form.click('Add formula')
    form.change('overview-formula-0-name', 'Ratio')
    form.change('overview-formula-0-formula', 'a / b')
    form.change('overview-formula-0-explanation', 'Compare quantities')
    await form.submit()
    assert.deepEqual(form.writes[0], { action: 'create', courseId: COURSE_ID,
      kind: 'course_overview', payload: { title: 'New course', body: 'New overview body',
        topics: [{ chapter: '1', description: 'Introduction' }], examFocus: ['Definitions'],
        keyTakeaways: [{ title: 'Principle', description: 'Meaning' }],
        formulaSheet: [{ name: 'Ratio', formula: 'a / b', explanation: 'Compare quantities' }] } })
  })
  await formFixture(null, async form => {
    form.change('content-title', 'Plain note')
    form.change('content-body', 'Note body')
    await form.submit()
    assert.deepEqual(form.writes[0], { action: 'create', courseId: COURSE_ID, kind: 'note',
      payload: { title: 'Plain note', body: 'Note body' } })
  })
})

test('malformed structured entries and unsupported stored fields cannot invoke mutation', async () => {
  await formFixture(existing('course_overview', overview), async form => {
    form.change('overview-topic-0-chapter', '   ')
    await form.submit()
    assert.equal(form.writes.length, 0)
    assert.match(findAll(form.render(), node => node.props?.role === 'alert').map(childrenText).join(' '),
      /topics \/ entry 1 \/ chapter/i)
  })
  await formFixture(existing('note', { title: 'Topic', body: 'Body', noteType: 'topic_note',
    keyPoints: ['Only point'] }), async form => {
    form.click('Remove key point 1')
    await form.submit()
    assert.equal(form.writes.length, 0)
    assert.match(findAll(form.render(), node => node.props?.role === 'alert').map(childrenText).join(' '),
      /keyPoints/i)
  })
  await formFixture(existing('course_overview', { ...overview, unsupported: 'data' }), async form => {
    await form.submit()
    assert.equal(form.writes.length, 0)
    assert.match(childrenText(form.render()), /Editing is unavailable/i)
  })
})

test('an oversized structured edit reports the byte limit before onSave', async () => {
  const examFocus = [...Array(26).fill('a'.repeat(10000)), 'a'.repeat(1994)]
  const item = existing('course_overview', { title: 'T', body: 'B', examFocus })
  await formFixture(item, async form => {
    form.change('overview-exam-26', 'a'.repeat(1995))
    await form.submit()
    assert.equal(form.writes.length, 0)
    assert.match(findAll(form.render(), node => node.props?.role === 'alert').map(childrenText).join(' '),
      /262,144-byte limit/)
  })
})

test('CBT, theory, model answer, and rubric edits keep their existing payload controls', async () => {
  for (const [kind, payload] of [
    ['cbt_question', { prompt: 'Choose', options: ['A', 'B'], correctOption: 1,
      section: 'Section', explanation: 'Because' }],
    ['theory_question', { prompt: 'Explain', examTip: 'Remember this' }],
    ['model_answer', { body: 'Model answer' }],
    ['rubric', { body: 'Rubric' }],
  ]) {
    const item = existing(kind, payload)
    await formFixture(item, async form => {
      await form.submit()
      assert.deepEqual(savedRevision(form.writes, item, kind), payload)
    })
  }
})
