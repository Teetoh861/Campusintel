// components/admin/OperatorWorkspace.test.cjs — Course-load failure cannot expose or act on another course's content.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')

const COURSE_A = '40000000-0000-4000-8000-000000000001'
const COURSE_B = '40000000-0000-4000-8000-000000000002'
const ITEM_A = { item_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', course_id: COURSE_A,
  kind: 'note', payload: { title: 'Course A note', body: 'A body' }, parent_item_id: null,
  current_revision: 1, approved_revision: null, published_revision: null, lock_version: 1 }
const ITEM_B = { ...ITEM_A, item_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  course_id: COURSE_B, payload: { title: 'Course B note', body: 'B body' } }

function findAll(node, match) {
  if (Array.isArray(node)) return node.flatMap(child => findAll(child, match))
  if (!node || typeof node !== 'object') return []
  return [...(match(node) ? [node] : []), ...findAll(node.props?.children, match)]
}

function content(node) {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(content).join('')
  return node && typeof node === 'object' ? content(node.props?.children) : ''
}

function flush() { return new Promise(resolve => setImmediate(resolve)) }

test('failed course switch hides old items and actions; retry loads only the new course', async () => {
  const oldLoad = Module._load
  const oldTsx = Module._extensions['.tsx']
  const file = require.resolve('./OperatorWorkspace.tsx')
  const hooks = []
  let cursor = 0
  let rejectCourseB
  let courseBAttempts = 0
  const writes = []
  const CoursePicker = () => null
  const ContentList = () => null
  const ContentForm = () => null
  const ContentHistory = () => null
  class EditorApiError extends Error { constructor(status, message) { super(message); this.status = status } }
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
  }
  const jsx = (type, props, key) => ({ type, props: props ?? {}, key })
  const mocks = {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol.for('react.fragment') },
    './CoursePicker': { CoursePicker }, './ContentList': { ContentList },
    './ContentForm': { ContentForm }, './ContentHistory': { ContentHistory },
    '@/lib/operator/editor-client': {
      EditorApiError,
      fetchOperatorCourses: async () => ({ repositories: [], institutional: [] }),
      fetchOperatorHistory: async itemId => ({ item: { id: itemId }, revisions: [], reviews: [], publications: [] }),
      fetchOperatorItems: async courseId => {
        if (courseId === COURSE_A) return [ITEM_A]
        courseBAttempts++
        if (courseBAttempts === 1) return new Promise((_, reject) => { rejectCourseB = reject })
        return [ITEM_B]
      },
      sendEditorMutation: async input => { writes.push(input); return { lockVersion: 2 } },
    },
  }

  try {
    Module._extensions['.tsx'] = (module, path) => module._compile(ts.transpileModule(fs.readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, path)
    Module._load = function(name, ...args) { return mocks[name] ?? oldLoad.call(this, name, ...args) }
    delete require.cache[file]
    const { OperatorWorkspace } = require(file)
    const render = () => { cursor = 0; return OperatorWorkspace({ repositories: [
      { id: COURSE_A, content_key: 'course-a', is_shared: null },
      { id: COURSE_B, content_key: 'course-b', is_shared: null },
    ], institutional: [] }) }
    const one = (tree, type) => findAll(tree, node => node.type === type)[0]

    let tree = render()
    one(tree, CoursePicker).props.onOpen(COURSE_A)
    await flush()
    tree = render()
    assert.deepEqual(one(tree, ContentList).props.items, [ITEM_A])
    one(tree, ContentList).props.onSelect(ITEM_A)
    await flush()
    tree = render()
    assert.equal(one(tree, ContentForm).props.item.item_id, ITEM_A.item_id)
    assert.ok(one(tree, ContentHistory))
    const staleSave = one(tree, ContentForm).props.onSave
    const staleReview = one(tree, ContentHistory).props.onAction

    one(tree, CoursePicker).props.onOpen(COURSE_B)
    tree = render()
    assert.match(content(tree), /course-b/)
    assert.equal(one(tree, ContentList), undefined)
    assert.equal(one(tree, ContentForm), undefined)
    assert.equal(one(tree, ContentHistory), undefined)
    await staleSave({ action: 'create', courseId: COURSE_A, kind: 'note',
      payload: { title: 'Stale', body: 'Should not save' } })
    await staleReview({ action: 'publish', itemId: ITEM_A.item_id,
      expectedLockVersion: 1, revision: 1 })
    assert.equal(writes.length, 0)

    rejectCourseB(new EditorApiError(503, 'Course B read unavailable'))
    await flush()
    tree = render()
    assert.equal(one(tree, ContentList), undefined)
    assert.equal(one(tree, ContentForm), undefined)
    assert.equal(one(tree, ContentHistory), undefined)
    assert.match(content(tree), /Course B read unavailable/)
    const retry = findAll(tree, node => node.type === 'button' && content(node).includes('Retry loading course'))[0]
    assert.ok(retry)
    retry.props.onClick()
    await flush()
    tree = render()
    assert.deepEqual(one(tree, ContentList).props.items, [ITEM_B])
    assert.equal(one(tree, ContentForm).props.courseId, COURSE_B)
    assert.deepEqual(one(tree, ContentForm).props.allItems, [ITEM_B])
    assert.equal(one(tree, ContentHistory), undefined)
    await one(tree, ContentForm).props.onSave({ action: 'create', courseId: COURSE_B,
      kind: 'note', payload: { title: 'New B note', body: 'Ready' } })
    assert.equal(writes.length, 1)
    assert.equal(writes[0].courseId, COURSE_B)
  } finally {
    Module._load = oldLoad
    if (oldTsx) Module._extensions['.tsx'] = oldTsx
    else delete Module._extensions['.tsx']
    delete require.cache[file]
  }
})
