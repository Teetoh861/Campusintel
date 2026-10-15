const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { fixture } = require('./control-fixture.cjs')

test('shared search has one explicit clear, keeps native cancellation out, and restores input focus', async () => fixture(async f => {
  const { SearchField } = require('./SearchField.tsx')
  let value = 'search query', focused = 0
  const inputRef = { current: { focus: () => { focused++ } } }
  const view = f.mount(SearchField, { id: 'shared-search', label: 'Find records', value,
    onChange: next => { value = next }, inputRef })
  const tree = view.render(), field = tree.props
  assert.equal(field.type, 'text'); assert.equal(field.role, 'searchbox')
  assert.equal(field.label, 'Find records'); assert.equal(field.maxLength, 100)
  const clear = f.nodes(tree.props.trailing).filter(node => node.type === 'button')
  assert.equal(clear.length, 1)
  assert.equal(clear[0].props['aria-label'], 'Clear search')
  assert.match(clear[0].props.className, /min-h-11/)
  clear[0].props.onClick()
  assert.equal(value, ''); assert.equal(focused, 1)
  view.props = { ...view.props, value }
  assert.equal(f.nodes(view.render().props.trailing).filter(node => node.type === 'button').length, 0)
  const html = f.html(tree)
  assert.match(html, /for="shared-search"/)
  assert.equal((html.match(/aria-label="Clear search"/g) || []).length, 1)
}))

test('shared filter uses native labelled selection, All as null, and exact reference IDs', async () => fixture(async f => {
  const { FilterSelect } = require('./FilterSelect.tsx')
  const chosen = [], options = [{ id: 'd2', label: 'Second department' }, { id: 'd1', label: 'First department' }]
  const view = f.mount(FilterSelect, { id: 'reference-filter', label: 'Department', value: null,
    options, onChange: next => chosen.push(next) })
  const tree = view.render(), select = f.nodes(tree).find(node => node.type === 'select')
  assert.equal(select.props.value, '')
  assert.deepEqual(f.nodes(select).filter(node => node.type === 'option').map(node => [node.props.value, node.props.children]),
    [['', 'All'], ['d2', 'Second department'], ['d1', 'First department']])
  select.props.onChange({ target: { value: 'd2' } })
  select.props.onChange({ target: { value: 'forged-id' } })
  select.props.onChange({ target: { value: '' } })
  assert.deepEqual(chosen, ['d2', null])
  assert.match(f.html(tree), /for="reference-filter"/)
  assert.match(select.props.className, /student-focus-control/)
}))

test('shared pager hides for zero/one page; desktop numbers are bounded with current and true disabled controls', async () => fixture(async f => {
  const { Pagination } = require('./Pagination.tsx')
  for (const totalPages of [0, 1]) assert.equal(f.mount(Pagination, { page: 1, totalPages, onPageChange() {} }).render(), null)
  for (const page of [1, 2, 4, 50, 98, 100]) {
    const moves = [], tree = f.mount(Pagination, { page, totalPages: 100, onPageChange: next => moves.push(next) }).render()
    const buttons = f.nodes(tree).filter(node => node.type === 'button')
    const numbers = buttons.filter(node => node.props['aria-label']?.startsWith('Page '))
    assert.ok(numbers.length <= 7)
    assert.equal(numbers[0].props.children, 1); assert.equal(numbers.at(-1).props.children, 100)
    assert.equal(numbers.filter(node => node.props['aria-current'] === 'page').length, 1)
    assert.equal(numbers.find(node => node.props['aria-current'] === 'page').props.children, page)
    const previous = buttons.find(node => node.props.children === 'Previous'), next = buttons.find(node => node.props.children === 'Next')
    assert.equal(previous.props.disabled, page === 1); assert.equal(next.props.disabled, page === 100)
    assert.ok(buttons.every(node => node.props.type === 'button' && /min-h-11/.test(node.props.className)))
    numbers.find(node => node.props['aria-current'] === 'page').props.onClick()
    if (page === 1) previous.props.onClick()
    if (page === 100) next.props.onClick()
    assert.deepEqual(moves, [])
    assert.match(f.html(tree), new RegExp('Page ' + page + ' of 100'))
  }
}))

test('shared pager changes one page and uses reduced-motion scrolling with focus in new results', async () => fixture(async f => {
  const { Pagination } = require('./Pagination.tsx')
  for (const reduced of [true, false]) {
    f.state.reducedMotion = reduced
    const moves = [], focus = [], scroll = []
    const scrollTarget = { current: { focus: options => focus.push(options), scrollIntoView: options => scroll.push(options) } }
    const tree = f.mount(Pagination, { page: 2, totalPages: 5, onPageChange: next => moves.push(next), scrollTarget }).render()
    f.nodes(tree).find(node => node.type === 'button' && node.props.children === 'Next').props.onClick()
    assert.deepEqual(moves, [3]); assert.deepEqual(scroll, [])
    f.flushFrames()
    assert.deepEqual(focus, [{ preventScroll: true }])
    assert.deepEqual(scroll, [{ block: 'start', behavior: reduced ? 'auto' : 'smooth' }])
  }
}))

test('shared controls keep 44px targets and mobile/desktop presentation in Student App tokens', () => {
  const css = fs.readFileSync('styles/student-app.css', 'utf8')
  assert.match(css, /\.student-search-clear[^}]*width: 44px; height: 44px/)
  assert.match(css, /\.student-filter-select[^}]*min-height: 48px/)
  assert.match(css, /\.student-pagination-number[^}]*min-width: 44px/)
  assert.match(css, /\.student-pagination-numbers \{ display: none/)
  assert.match(css, /\.student-pagination-position \{ display: none/)
  assert.match(css, /\.student-course-row-body[^}]*overflow-wrap: anywhere/)
  assert.match(css, /\.student-course-row-shell > \.student-course-row \{ flex: 1 1 0; min-width: 0; \}/)
  assert.match(css, /\.student-course-row-action \{ display: flex; flex: none; align-items: center;/)
  assert.match(css, /\.student-bookmark-toggle \{[^}]*min-width: 44px; min-height: 44px/)
  assert.match(css, /forced-colors: active/)
})


test('a selected reference removed by refreshed data stays explicit instead of masquerading as All', async () => fixture(async f => {
  const { FilterSelect } = require('./FilterSelect.tsx')
  const tree = f.mount(FilterSelect, { id: 'removed-reference', label: 'Department', value: 'formerly-present',
    options: [{ id: 'current', label: 'Current department' }], onChange() {} }).render()
  const select = f.nodes(tree).find(node => node.type === 'select')
  const unavailable = f.nodes(select).find(node => node.type === 'option' && node.props.value === 'formerly-present')
  assert.equal(select.props.value, 'formerly-present')
  assert.equal(unavailable.props.disabled, true)
  assert.equal(unavailable.props.children, 'Selection no longer available')
}))
