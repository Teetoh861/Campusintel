const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const fs = require('node:fs')
const ts = require('typescript')
const { randomUUID } = require('node:crypto')

async function fixture(run) {
  const load = Module._load, tsx = Module._extensions['.tsx'], cache = new Map(Object.entries(require.cache))
  const originalFetch = global.fetch
  const hooks = [], requests = [], receipts = new Map()
  let cursor = 0
  const state = { loseResponse: true, block: null, unreadable: false, unavailable: false,
    versionConflict: false, nextRead: null, readUnavailable: false }
  const CoursePicker = () => null, ContentForm = () => null
  const react = {
    useState(initial) {
      const slot = cursor++
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial
      return [hooks[slot], value => { hooks[slot] = value }]
    },
    useRef(initial) {
      const slot = cursor++
      if (!(slot in hooks)) hooks[slot] = { current: initial }
      return hooks[slot]
    },
  }
  const jsx = (type, props, key) => ({ type, props, key })
  const mocks = { react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    './CoursePicker': { CoursePicker }, './ContentForm': { ContentForm },
    './ContentList': { ContentList: () => null }, './ContentHistory': { ContentHistory: () => null } }
  try {
    Module._load = function (name, ...args) { return mocks[name] || load.call(this, name, ...args) }
    Module._extensions['.tsx'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText, file)
    const courseId = randomUUID(), otherCourseId = randomUUID()
    const existingItem = { item_id: randomUUID(), course_id: courseId, kind: 'note', question_id: null,
      source_key: null, parent_item_id: null, current_revision: 1, approved_revision: null,
      published_revision: null, published_parent_revision: null, lock_version: 1, payload: { title: 'Existing', body: 'Existing' } }
    const allItems = () => [existingItem, ...Array.from(receipts.values(), receipt => {
      const input = JSON.parse(receipt.body)
      return { ...existingItem, item_id: receipt.itemId, course_id: input.courseId, kind: input.kind, payload: input.payload }
    })]
    global.fetch = async (url, options) => {
      if (options.method !== 'POST') {
        if (state.nextRead) {
          const pending = state.nextRead
          state.nextRead = null
          await pending
        }
        if (state.readUnavailable) return Response.json({ status: 'unavailable', message: 'Read unavailable' }, { status: 503 })
        const query = new URL(url, 'https://campus.test').searchParams
        if (query.get('view') === 'items') return Response.json({ status: 'ok',
          data: allItems().filter(item => item.course_id === query.get('courseId')) })
        const item = allItems().find(item => item.item_id === query.get('itemId'))
        assert.ok(item, 'history reads select a real fixture item')
        const { item_id, payload, ...identity } = item
        return Response.json({ status: 'ok', data: { item: { ...identity, id: item_id,
          created_by: courseId, created_at: '2026-10-10T00:00:00Z', updated_at: '2026-10-10T00:00:00Z' },
          revisions: [], reviews: [], publications: [] } })
      }
      const input = JSON.parse(options.body)
      requests.push(input)
      if (input.action !== 'create') return state.versionConflict
        ? Response.json({ status: 'conflict', message: 'Stale version' }, { status: 409 })
        : Response.json({ status: 'ok', data: { lockVersion: 2 } })
      const prior = receipts.get(input.createIntentId)
      if (prior && prior.body !== options.body) return Response.json({ status: 'conflict', message: 'Create intent mismatch' }, { status: 409 })
      if (!prior) receipts.set(input.createIntentId, { body: options.body, itemId: randomUUID() })
      if (state.block) await state.block
      if (state.loseResponse) throw new TypeError('Response lost after commit')
      if (state.unreadable) return new Response('{', { status: 200 })
      if (state.unavailable) return Response.json({ status: 'unavailable', message: 'Temporarily unavailable' }, { status: 503 })
      return Response.json({ status: 'ok', data: { itemId: receipts.get(input.createIntentId).itemId } })
    }
    const file = require.resolve('../../components/admin/OperatorWorkspace.tsx')
    delete require.cache[file]
    const { OperatorWorkspace } = require(file)
    const nodes = tree => !tree || typeof tree !== 'object' ? []
      : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)]
    const render = () => { cursor = 0; return OperatorWorkspace({ repositories: [{ id: courseId,
      content_key: 'create-test', is_shared: false }, { id: otherCourseId,
      content_key: 'other-create-test', is_shared: false }], institutional: [], continuityToken: 'rendered-operator' }) }
    nodes(render()).find(node => node.type === CoursePicker).props.onOpen(courseId)
    await new Promise(setImmediate)
    const save = () => nodes(render()).find(node => node.type === ContentForm).props.onSave
    const form = () => nodes(render()).find(node => node.type === ContentForm)
    const newContent = () => nodes(render()).find(node => node.props?.onNew).props.onNew()
    const openCourse = async id => {
      nodes(render()).find(node => node.type === CoursePicker).props.onOpen(id)
      await new Promise(setImmediate)
    }
    const selectItem = async item => {
      nodes(render()).find(node => node.props?.onSelect).props.onSelect(item)
      await new Promise(setImmediate)
    }
    const draft = { action: 'create', courseId, kind: 'note', payload: { title: 'T', body: 'B' } }
    await run({ save, form, newContent, openCourse, selectItem, existingItem, otherCourseId,
      draft, render, nodes, requests, receipts, state })
  } finally {
    Module._load = load
    if (tsx) Module._extensions['.tsx'] = tsx; else delete Module._extensions['.tsx']
    global.fetch = originalFetch
    for (const key of Object.keys(require.cache)) if (!cache.has(key)) delete require.cache[key]
    for (const [key, value] of cache) require.cache[key] = value
  }
}

test('lost response retains one intent; manual replay recovers it; confirmed success permits a fresh intent', async () => fixture(async f => {
  await f.save()(f.draft)
  assert.equal(f.requests.length, 1, 'no automatic retry')
  const intent = f.requests[0].createIntentId
  assert.match(intent, /^[0-9a-f-]{36}$/)
  f.state.loseResponse = false
  await f.save()(f.draft)
  assert.deepEqual(f.requests[1], f.requests[0], 'same unresolved form sends same intent and payload')
  assert.equal(f.receipts.size, 1)
  assert.ok(f.form().props.item, 'confirmed creation opens its existing item for editing')
  f.newContent()
  await f.save()(f.draft)
  assert.notEqual(f.requests[2].createIntentId, intent)
  assert.equal(f.receipts.size, 2, 'distinct intentional create with identical text remains allowed')
}))

test('changing an uncertain create retains the original intent and presents conflict instead of false success', async () => fixture(async f => {
  await f.save()(f.draft)
  f.state.loseResponse = false
  await f.save()({ ...f.draft, payload: { title: 'T', body: 'Changed' } })
  assert.equal(f.requests[1].createIntentId, f.requests[0].createIntentId)
  assert.equal(f.receipts.size, 1)
  assert.ok(f.nodes(f.render()).some(node => node.props?.role === 'alert'))
  await f.save()(f.draft)
  assert.equal(f.requests[2].createIntentId, f.requests[0].createIntentId, 'conflict never abandons unresolved identity')
}))

test('slow create and synchronous double submit do not regenerate the intent or queue automatic work', async () => fixture(async f => {
  let release
  f.state.block = new Promise(resolve => { release = resolve })
  const save = f.save()
  const pending = save(f.draft)
  await save(f.draft)
  assert.equal(f.requests.length, 1)
  release(); await pending
  f.state.block = null; f.state.loseResponse = false
  await f.save()(f.draft)
  assert.equal(f.requests[1].createIntentId, f.requests[0].createIntentId)
}))

test('selecting an existing item abandons the unresolved draft before returning to New content', async () => fixture(async f => {
  const abandonedSave = f.save()
  await abandonedSave(f.draft)
  const first = f.requests[0].createIntentId
  await f.selectItem(f.existingItem)
  assert.equal(f.form().props.item.item_id, f.existingItem.item_id)
  assert.ok(f.nodes(f.render()).some(node => node.props?.history?.item?.id === f.existingItem.item_id))
  f.newContent()
  f.state.loseResponse = false
  await abandonedSave(f.draft)
  assert.equal(f.requests.length, 1, 'an abandoned form callback cannot mint another intent')
  await f.save()(f.draft)
  assert.notEqual(f.requests[1].createIntentId, first)
  assert.equal(f.receipts.size, 2, 'identical content in a separate intentional draft creates another item')
}))

test('explicit New content resets the form lifecycle even without visiting an existing item', async () => fixture(async f => {
  await f.save()(f.draft)
  const before = f.form().key
  f.newContent()
  assert.notEqual(f.form().key, before, 'a fresh form mounts rather than carrying old field state')
  f.state.loseResponse = false
  await f.save()(f.draft)
  assert.notEqual(f.requests[1].createIntentId, f.requests[0].createIntentId)
  assert.equal(f.receipts.size, 2)
}))

test('deliberate course replacement abandons the old course draft and creates with a fresh key', async () => fixture(async f => {
  const oldSave = f.save()
  await oldSave(f.draft)
  await f.openCourse(f.otherCourseId)
  f.state.loseResponse = false
  await oldSave(f.draft)
  assert.equal(f.requests.length, 1, 'old course callback is inert')
  await f.save()({ ...f.draft, courseId: f.otherCourseId })
  assert.notEqual(f.requests[1].createIntentId, f.requests[0].createIntentId)
  assert.equal(f.requests[1].courseId, f.otherCourseId)
  assert.equal(f.receipts.size, 2)
}))

test('create conflict recovery reloads content, retires the conflicting key, and allows a deliberate new create', async () => fixture(async f => {
  await f.save()(f.draft)
  f.state.loseResponse = false
  const changed = { ...f.draft, payload: { title: 'T', body: 'Changed' } }
  await f.save()(changed)
  assert.equal(f.requests[1].createIntentId, f.requests[0].createIntentId, 'field edits retain the same draft intent')
  assert.equal(f.receipts.size, 1)
  assert.ok(f.nodes(f.render()).some(node => node.props?.role === 'alert'))
  const before = f.form().key
  const recovery = f.nodes(f.render()).find(node => node.type === 'button' &&
    node.props.children === 'Reload latest content and reset draft')
  assert.ok(recovery)
  recovery.props.onClick()
  await new Promise(setImmediate)
  assert.notEqual(f.form().key, before)
  assert.equal(f.form().props.item, null)
  assert.ok(f.nodes(f.render()).some(node => node.props?.items?.length === 2), 'reload reveals the original committed item')
  assert.equal(f.nodes(f.render()).some(node => node.props?.role === 'alert'), false)
  assert.equal(f.requests.length, 2, 'recovery performs a read, never an automatic create retry')
  await f.save()(changed)
  assert.notEqual(f.requests[2].createIntentId, f.requests[0].createIntentId)
  assert.equal(f.receipts.size, 2)
  assert.equal(f.nodes(f.render()).some(node => node.props?.role === 'alert'), false)
}))

test('network, unreadable-response and unavailable failures retain the same active draft until manual retry', async () => {
  for (const failure of ['loseResponse', 'unreadable', 'unavailable']) await fixture(async f => {
    f.state.loseResponse = false; f.state[failure] = true
    const before = f.form().key
    await f.save()(f.draft)
    assert.equal(f.requests.length, 1)
    assert.equal(f.form().props.busy, false)
    assert.equal(f.form().key, before)
    assert.ok(f.nodes(f.render()).some(node => node.props?.role === 'alert'))
    f.state[failure] = false
    await f.save()(f.draft)
    assert.equal(f.requests[1].createIntentId, f.requests[0].createIntentId)
    assert.equal(f.receipts.size, 1)
  })
})

test('ordinary revision conflict keeps the existing selected-item reload interaction', async () => fixture(async f => {
  await f.selectItem(f.existingItem)
  f.state.versionConflict = true
  await f.save()({ action: 'revise', itemId: f.existingItem.item_id, expectedLockVersion: 1,
    payload: { title: 'Existing', body: 'Edited' } })
  const recovery = f.nodes(f.render()).find(node => node.type === 'button' && node.props.children === 'Reload latest version')
  assert.ok(recovery)
  assert.equal(f.nodes(f.render()).some(node => node.props?.children === 'Reload latest content and reset draft'), false)
  recovery.props.onClick()
  await new Promise(setImmediate)
  assert.equal(f.form().props.item.item_id, f.existingItem.item_id)
  assert.equal(f.requests.length, 1, 'recovery reloads the item without retrying the revision')
  assert.equal(Object.hasOwn(f.requests[0], 'createIntentId'), false)
}))

test('normal current-context create refresh presents success and genuine refresh failure presents the recorded-action warning', async () => {
  for (const readUnavailable of [false, true]) await fixture(async f => {
    f.state.loseResponse = false; f.state.readUnavailable = readUnavailable
    await f.save()(f.draft)
    const notice = f.nodes(f.render()).find(node => node.props?.role === (readUnavailable ? 'alert' : 'status'))
    assert.ok(notice)
    assert.equal(notice.props.children[0], readUnavailable
      ? 'The action was recorded, but the latest view could not load. Select the course to reload.' : 'Draft created.')
    assert.equal(f.receipts.size, 1)
    if (!readUnavailable) {
      assert.equal(f.form().props.item.item_id, [...f.receipts.values()][0].itemId)
      assert.equal(f.form().props.busy, false)
    }
  })
})

test('superseded post-success refresh cannot add a stale notice or change replacement-course presentation', async () => {
  for (const rejectRefresh of [false, true]) await fixture(async f => {
    f.state.loseResponse = false
    let resolveRead, rejectRead
    f.state.nextRead = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject })
    const pendingA = f.save()(f.draft)
    await new Promise(setImmediate)
    await f.openCourse(f.otherCourseId)
    assert.equal(f.form().props.courseId, f.otherCourseId)
    assert.equal(f.nodes(f.render()).some(node => node.props?.role === 'alert' || node.props?.role === 'status'), false)
    const before = JSON.stringify(f.render())
    if (rejectRefresh) rejectRead(new Error('Superseded read failed'))
    else resolveRead()
    await pendingA
    assert.equal(JSON.stringify(f.render()), before)
    assert.equal(f.nodes(f.render()).some(node => node.props?.role === 'alert' || node.props?.role === 'status'), false)
  })
})

test('superseded post-success refresh cannot change the replacement draft intent or its pending create', async () => {
  for (const rejectRefresh of [false, true]) await fixture(async f => {
    f.state.loseResponse = false
    let resolveRead, rejectRead
    f.state.nextRead = new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject })
    const pendingA = f.save()(f.draft)
    await new Promise(setImmediate)
    assert.equal(f.requests.length, 1)
    await f.openCourse(f.otherCourseId)
    const draftB = { ...f.draft, courseId: f.otherCourseId }
    let resolvePost
    f.state.block = new Promise(resolve => { resolvePost = resolve })
    const saveB = f.save(), pendingB = saveB(draftB)
    assert.equal(f.requests.length, 2, 'replacement context can start its own create')
    const keyB = f.requests[1].createIntentId
    assert.notEqual(keyB, f.requests[0].createIntentId)
    const before = JSON.stringify(f.render())
    if (rejectRefresh) rejectRead(new Error('Superseded read failed'))
    else resolveRead()
    await pendingA
    assert.equal(JSON.stringify(f.render()), before, 'late A changes no B presentation state')
    assert.equal(f.form().props.busy, true, 'late A cannot clear B pending state')
    await saveB(draftB)
    assert.equal(f.requests.length, 2, 'late A cannot release B synchronous double-submit guard')
    resolvePost(); await pendingB
    assert.equal(f.requests[1].createIntentId, keyB)
    assert.equal(f.form().props.item.item_id, f.receipts.get(keyB).itemId)
    assert.equal(f.form().props.busy, false)
  })
})

test('delayed POST after draft abandonment cannot revive the old draft or replace its new intent', async () => {
  for (const loseResponse of [false, true]) await fixture(async f => {
    let release
    f.state.block = new Promise(resolve => { release = resolve }); f.state.loseResponse = loseResponse
    const staleSave = f.save(), pending = staleSave(f.draft)
    f.newContent()
    const key = f.form().key
    release(); await pending; f.state.block = null
    assert.equal(f.form().key, key); assert.equal(f.form().props.item, null)
    assert.equal(f.nodes(f.render()).some(node => node.props?.role === 'alert' || node.props?.role === 'status'), false)
    f.state.loseResponse = true
    await f.save()(f.draft)
    const newIntent = f.requests[1].createIntentId
    assert.notEqual(newIntent, f.requests[0].createIntentId)
    await staleSave(f.draft)
    assert.equal(f.requests.length, 2)
    f.state.loseResponse = false
    await f.save()(f.draft)
    assert.equal(f.requests[2].createIntentId, newIntent)
  })
})
