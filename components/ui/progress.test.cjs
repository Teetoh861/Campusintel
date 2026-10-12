// components/ui/progress.test.cjs — One normalized maximum drives semantics and the visual indicator together.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const read = html => ({
  now: /aria-valuenow="([^"]+)"/.exec(html)?.[1] ?? null,
  max: /aria-valuemax="([^"]+)"/.exec(html)?.[1] ?? null,
  state: /data-state="([^"]+)"/.exec(html)?.[1] ?? null,
  transform: /translateX\(([^)]+)\)/.exec(html)?.[1] ?? null,
})

test('determinate values expose aria-valuenow/max, state and the matching visual percentage', async () => {
  const { Progress } = await withTsx(() => require('./progress.tsx'))
  const render = props => read(renderToStaticMarkup(React.createElement(Progress, props)))
  const cases = [
    [{ value: 0, max: 100 }, { now: '0', max: '100', state: 'loading', transform: '-100%' }],
    [{ value: 50, max: 100 }, { now: '50', max: '100', state: 'loading', transform: '-50%' }],
    [{ value: 100, max: 100 }, { now: '100', max: '100', state: 'complete', transform: '-0%' }],
    [{ value: 25, max: 50 }, { now: '25', max: '50', state: 'loading', transform: '-50%' }],
    [{ value: 100, max: 50 }, { now: '50', max: '50', state: 'complete', transform: '-0%' }],
    [{ value: 150 }, { now: '100', max: '100', state: 'complete', transform: '-0%' }],
    [{ value: -5 }, { now: '0', max: '100', state: 'loading', transform: '-100%' }],
    [{ value: 3, max: 4 }, { now: '3', max: '4', state: 'loading', transform: '-25%' }],
  ]
  for (const [props, expected] of cases) assert.deepEqual(render(props), expected, JSON.stringify(props))
})

test('invalid maximums normalize once to the default and never leak NaN or Infinity into styles', async () => {
  const { Progress } = await withTsx(() => require('./progress.tsx'))
  const render = props => renderToStaticMarkup(React.createElement(Progress, props))
  for (const max of [0, -1, NaN, Infinity, -Infinity]) {
    const html = render({ value: 50, max })
    assert.deepEqual(read(html), { now: '50', max: '100', state: 'loading', transform: '-50%' }, String(max))
    assert.doesNotMatch(html, /NaN|Infinity/)
    const full = read(render({ value: 100, max }))
    assert.equal(full.state, 'complete', `${max} at 100`)
    assert.equal(full.transform, '-0%')
  }
})

test('indeterminate only when the value itself is absent or invalid, and never shown as complete', async () => {
  const { Progress } = await withTsx(() => require('./progress.tsx'))
  const render = props => renderToStaticMarkup(React.createElement(Progress, props))
  for (const props of [{}, { value: null }, { value: NaN }, { value: Infinity }, { value: undefined, max: 0 }]) {
    const html = render(props)
    assert.equal(read(html).state, 'indeterminate', JSON.stringify(props))
    assert.doesNotMatch(html, /aria-valuenow|NaN|Infinity/)
    assert.equal(read(html).transform, '-100%', 'an indeterminate bar does not look complete')
  }
})
