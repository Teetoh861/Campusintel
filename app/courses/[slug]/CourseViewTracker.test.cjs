// Run with lib/auth/test-loader.cjs preloaded.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')

test('course view fires after browser commit, once per mounted course identity', () => {
  const originalLoad = Module._load
  const originalWindow = global.window
  const file = require.resolve('./CourseViewTracker.ts')
  const calls = []
  const effects = []
  const ref = { current: null }
  const pending = new Map()
  let nextTimer = 0
  try {
    global.window = {
      va: undefined,
      setTimeout: callback => { const id = ++nextTimer; pending.set(id, callback); return id },
      clearTimeout: id => pending.delete(id),
    }
    Module._load = function(name, ...args) {
      if (name === 'react') return {
        useRef: () => ref,
        useEffect: callback => effects.push(callback),
      }
      if (name === '@vercel/analytics') return { track: (...args) => calls.push(args) }
      return originalLoad.call(this, name, ...args)
    }
    delete require.cache[file]
    const { CourseViewTracker } = require(file)
    assert.equal(CourseViewTracker({ courseSlug: 'financial-accounting-1' }), null)
    assert.equal(calls.length, 0)
    const cleanup = effects[0]()
    assert.equal(calls.length, 0)
    assert.equal(pending.size, 1)
    cleanup() // React development effect replay cancels the first wait.
    assert.equal(pending.size, 0)
    effects[0]()
    global.window.va = () => {}
    const callback = [...pending.values()][0]
    pending.clear()
    callback()
    effects[0]() // A replay after delivery is not a second view.
    assert.deepEqual(calls, [['course_viewed', { course_slug: 'financial-accounting-1' }]])
    CourseViewTracker({ courseSlug: 'business-statistics' })
    effects[1]()
    assert.deepEqual(calls[1], ['course_viewed', { course_slug: 'business-statistics' }])
  } finally {
    Module._load = originalLoad
    delete require.cache[file]
    if (originalWindow === undefined) delete global.window; else global.window = originalWindow
  }
})
