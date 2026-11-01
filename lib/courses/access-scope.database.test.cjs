const { test } = require('node:test')
const assert = require('node:assert/strict')
const f = require('./access-scope-fixture.cjs')

test('unlocked selection save first: practice waits, then refuses the old list', { skip: !f.enabled }, async () => {
  const p = f.student({ future: true })
  let held, racer
  try {
    held = await f.hold(f.save(p))
    const marker = 'scope-save-first-' + f.randomUUID()
    racer = f.background(`/* ${marker} */ ${f.service(f.start(p))}`)
    await f.until(() => f.waiting(marker), 'start waits for the new selection')
    await f.delay(2100)
    await held.release(); held = null
    assert.equal(f.state(await racer).state, 'locked')
    assert.equal(f.department(p), f.ACC)
    assert.equal(f.attempts(p), 0)
  } finally { if (held) await held.release(); if (racer) await racer; f.cleanup(p) }
})

test('start first: a queued unlocked save cannot change the list after its future grant starts', { skip: !f.enabled }, async () => {
  const p = f.student({ future: true })
  let gate, start, save
  try {
    gate = await f.hold(`select pg_advisory_xact_lock(hashtextextended('practice-account:${p.user}',0))`)
    const startMarker = 'scope-start-first-' + f.randomUUID()
    start = f.background(`/* ${startMarker} */ ${f.service(f.start(p))}`)
    await f.until(() => f.waiting(startMarker), 'start holds profile scope before the practice lock')
    const saveMarker = 'scope-save-after-' + f.randomUUID()
    save = f.background(`/* ${saveMarker} */ ${f.save(p)}`)
    await f.until(() => f.waiting(saveMarker), 'save waits for scope')
    await f.delay(2100)
    await gate.release(); gate = null
    assert.equal(f.state(await start).state, 'ready')
    const refused = await save
    assert.notEqual(refused.code, 0)
    assert.match(refused.err, /Course selection is set for this semester/)
    assert.equal(f.department(p), f.BUA)
    assert.equal(f.attempts(p), 1)
  } finally { if (gate) await gate.release(); if (start) await start; if (save) await save; f.cleanup(p) }
})

test('locked operator correction first: start sees only the corrected list', { skip: !f.enabled }, async () => {
  const p = f.student()
  let held, racer
  try {
    held = await f.hold(f.correction(p))
    const marker = 'scope-correction-first-' + f.randomUUID()
    racer = f.background(`/* ${marker} */ ${f.service(f.start(p))}`)
    await f.until(() => f.waiting(marker), 'start waits for correction')
    await held.release(); held = null
    assert.equal(f.state(await racer).state, 'locked')
    assert.equal(f.department(p), f.ACC)
    assert.equal(f.attempts(p), 0)
    assert.equal(f.sql(`select private.course_selection_state('${p.user}')->>'state'`), 'locked')
  } finally { if (held) await held.release(); if (racer) await racer; f.cleanup(p) }
})

test('start first: correction waits; the next content read is denied after it commits', { skip: !f.enabled }, async () => {
  const p = f.student()
  let held, racer
  try {
    held = await f.hold(f.service(f.start(p)))
    const marker = 'scope-correction-after-' + f.randomUUID()
    racer = f.background(`/* ${marker} */ ${f.correction(p)}`)
    await f.until(() => f.waiting(marker), 'correction waits behind the authorized start')
    await held.release(); held = null
    assert.equal(f.state(await racer).state, 'changed')
    assert.equal(f.department(p), f.ACC)
    assert.equal(f.attempts(p), 1)
    const read = await f.background(f.asStudent(p, `select count(*) from public.read_published_managed_content('${f.COURSE}')`))
    assert.notEqual(read.code, 0)
    assert.match(read.err, /Course access requires an active plan/)
  } finally { if (held) await held.release(); if (racer) await racer; f.cleanup(p) }
})

test('a grant expiring while start waits admits nothing on the transaction-start clock', { skip: !f.enabled }, async () => {
  const p = f.student({ expires: true })
  let gate, racer
  try {
    gate = await f.hold(`select pg_advisory_xact_lock(hashtextextended('practice-account:${p.user}',0))`)
    const marker = 'scope-expiry-' + f.randomUUID()
    racer = f.background(`/* ${marker} */ ${f.service(f.start(p))}`)
    await f.until(() => f.waiting(marker), 'start waits while the grant is still active')
    await f.delay(2100)
    await gate.release(); gate = null
    assert.equal(f.state(await racer).state, 'locked')
    assert.equal(f.attempts(p), 0)
  } finally { if (gate) await gate.release(); if (racer) await racer; f.cleanup(p) }
})

// A genuinely unlocked student can both practise a free course and change selection. Neither order may
// deadlock or manufacture a paid grant; the future-grant races above separately cover becoming locked while queued.
const FREE = '40000000-0000-4000-8000-000000000008'
test('unlocked save first: free practice waits, then both operations commit', { skip: !f.enabled }, async () => {
  const p = f.student({ source: null })
  let held, racer
  try {
    held = await f.hold(f.save(p))
    const marker = 'scope-free-save-first-' + f.randomUUID()
    racer = f.background(`/* ${marker} */ ${f.service(f.start(p, undefined, FREE))}`)
    await f.until(() => f.waiting(marker), 'free start waits for the unlocked selection save')
    await held.release(); held = null
    assert.equal(f.state(await racer).state, 'ready')
    assert.equal(f.department(p), f.ACC)
    assert.equal(f.sql(`select private.course_selection_state('${p.user}')->>'state'`), 'open')
    assert.equal(f.attempts(p), 1)
  } finally { if (held) await held.release(); if (racer) await racer; f.cleanup(p) }
})

test('free start first: unlocked selection save waits, then both operations commit', { skip: !f.enabled }, async () => {
  const p = f.student({ source: null })
  let held, racer
  try {
    held = await f.hold(f.service(f.start(p, undefined, FREE)))
    const marker = 'scope-free-start-first-' + f.randomUUID()
    racer = f.background(`/* ${marker} */ ${f.save(p)}`)
    await f.until(() => f.waiting(marker), 'unlocked save waits for the free start')
    const started = await held.release(); held = null
    assert.match(started, /"state": "ready"/)
    const saved = await racer
    assert.equal(saved.code, 0, saved.err)
    assert.equal(f.department(p), f.ACC)
    assert.equal(f.sql(`select private.course_selection_state('${p.user}')->>'state'`), 'open')
    assert.equal(f.attempts(p), 1)
  } finally { if (held) await held.release(); if (racer) await racer; f.cleanup(p) }
})
