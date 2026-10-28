// Failed status reads never guess an account state, including after a previously verified answer.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { renderToStaticMarkup } = require('react-dom/server')
const { fixture, nodes } = require('./navigation.fixture.cjs')

function neutral(f) {
  const html = renderToStaticMarkup(nodes(f.nav()).find(node => node.type === 'nav'))
  assert.doesNotMatch(html, /Sign in|Create account|Open menu|href="\/(?:login|register|courses|account)"/)
  assert.equal(f.state().status, 'unknown')
  assert.equal(f.state().signedIn, false)
  assert.equal(f.state().continuityToken, null)
  assert.equal(f.nav().props.open, false)
}

for (const initial of ['signed-in', 'signed-out', 'unknown']) {
  test(`failed, malformed and incomplete session answers keep ${initial} presentation neutral until recovery`, async () => fixture(async f => {
    const failures = [[{ error: 'unavailable' }, 503], [null, 200], [{}, 200],
      [{ enabled: true, signedIn: 'yes' }, 200], [{ enabled: true, signedIn: true, continuityToken: null }, 200],
      [{ enabled: true, signedIn: true, continuityToken: 'not-an-answer-on-error' }, 500]]
    for (const [body, status] of failures) {
      await f.respond(body, status)
      neutral(f)
      f.change()
    }
    // Only a complete, successful answer restores either account presentation.
    await f.respond({ enabled: true, signedIn: true })
    assert.equal(f.state().status, 'signed-in')
    assert.match(renderToStaticMarkup(f.nav()), /Open menu/)
    f.change()
    await f.respond({ enabled: true, signedIn: false })
    assert.equal(f.state().status, 'signed-out')
    assert.match(renderToStaticMarkup(f.nav()), /Sign in/)
  }, { initial }))
}

test('network and JSON failures neutralize a known account state and close its menu', async () => fixture(async f => {
  for (const failure of ['network', 'json']) {
    await f.respond({ enabled: true, signedIn: true })
    f.nav().props.onOpenChange(true)
    assert.equal(f.nav().props.open, true)
    f.win.dispatchEvent(new Event('focus'))
    await f.settle()
    const request = f.requests.at(-1)
    request.resolve(failure === 'network' ? Promise.reject(new TypeError('offline')) : new Response('{bad JSON'))
    await f.settle()
    neutral(f)
    f.change()
  }
}, { initial: 'signed-in' }))

test('an aborted old failure cannot replace the newer definitive signed-in answer', async () => fixture(async f => {
  const old = f.requests[0]
  f.change()
  await f.respond({ enabled: true, signedIn: true })
  await f.respond({ error: 'unavailable' }, 503, old)
  assert.equal(old.options.signal.aborted, true)
  assert.equal(f.state().status, 'signed-in')
  assert.match(renderToStaticMarkup(f.nav()), /Open menu/)
}, { initial: 'unknown' }))
