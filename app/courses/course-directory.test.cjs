const { test } = require('node:test')
const assert = require('node:assert/strict')
const { fixture } = require('../../components/student/control-fixture.cjs')

const reference = (id, label, isActive = true) => ({ id, label, isActive })
const a = reference('a', 'Alpha department'), b = reference('b', 'Beta department')
const l1 = reference('l1', '100 Level'), l2 = reference('l2', '200 Level')
const p1 = reference('p1', 'First Semester'), p2 = reference('p2', 'Second Semester')
const tuple = (department = a, academicLevel = l1, academicPeriod = p1) => ({ department, academicLevel, academicPeriod })
const item = (f, id, code, title, applicability = [tuple()]) => ({ institutionalCourseId: id, code, title, applicability,
  row: f.React.createElement('div', { className: 'student-course-row' }, title) })

async function directory(run, makeItems) {
  return fixture(async f => {
    const { CourseDirectory } = require('./CourseDirectory.tsx')
    const { CourseRegister } = require('../../components/student/CourseRow.tsx')
    const { SearchField } = require('../../components/student/SearchField.tsx')
    const { FilterSelect } = require('../../components/student/FilterSelect.tsx')
    const { Pagination } = require('../../components/student/Pagination.tsx')
    const { EmptyState } = require('../../components/student/EmptyState.tsx')
    const entries = makeItems ? makeItems(f) : [
      item(f, 'one', 'ABC101', 'Institution One', [tuple(), tuple(b, l2, p2)]),
      item(f, 'two', 'XYZ202', 'Institution Two', [tuple(a, l2, p2)]),
    ]
    const view = f.mount(CourseDirectory, { items: entries })
    const find = type => f.nodes(view.render()).find(node => node.type === type)
    const visible = () => {
      const register = find(CourseRegister)
      return register ? register.props.children.map(child => child.key) : []
    }
    const query = value => find(SearchField).props.onChange(value)
    const filter = (label, value) => f.nodes(view.render()).find(node => node.type === FilterSelect && node.props.label === label).props.onChange(value)
    const clear = () => f.nodes(view.render()).find(node => node.type === 'button' && node.props.children === 'Clear filters').props.onClick()
    await run({ ...f, view, entries, find, visible, query, filter, clear, SearchField, FilterSelect, Pagination, EmptyState })
  })
}

test('one institutional identity stays one result across many applicability rows and empty applicability remains visible in All', async () =>
  directory(async f => {
    assert.deepEqual(f.visible(), ['shared', 'empty'])
    assert.equal((f.html(f.view.render()).match(/class="student-course-row"/g) || []).length, 2)
    f.filter('Department', a.id); assert.deepEqual(f.visible(), ['shared'])
  }, f => [item(f, 'shared', 'GST111', 'Shared course', Array.from({ length: 120 }, (_, i) =>
    tuple(reference('d' + i, 'Department ' + i))).concat(tuple())),
  item(f, 'empty', 'INST000', 'Awaiting applicability', [])]))

test('search matches only full institutional code/title, trimmed and case-insensitive', async () => directory(async f => {
  f.query('  abc101  '); assert.deepEqual(f.visible(), ['one'])
  f.query('institution TWO'); assert.deepEqual(f.visible(), ['two'])
  f.query('ALPHA DEPARTMENT'); assert.deepEqual(f.visible(), [])
  f.query('  '); assert.deepEqual(f.visible(), ['one', 'two'])
}))

test('long codes and the end of a full long title remain searchable and escaped', async () => directory(async f => {
  f.query('final searchable phrase'); assert.deepEqual(f.visible(), ['long'])
  f.query('LAG-VERY-LONG'); assert.deepEqual(f.visible(), ['long'])
  const html = f.html(f.view.render())
  assert.ok(html.includes('final searchable phrase'))
  assert.doesNotMatch(html, /line-clamp/)
}, f => [item(f, 'long', 'LAG-VERY-LONG-INSTITUTIONAL-COURSE-CODE', 'Long institutional title '.repeat(20) + 'final searchable phrase')]))

test('exactly three filters derive deduplicated labels/IDs including inactive references', async () => directory(async f => {
  const fields = f.nodes(f.view.render()).filter(node => node.type === f.FilterSelect)
  assert.deepEqual(fields.map(node => node.props.label), ['Department', 'Level', 'Semester'])
  const departments = fields[0].props.options
  assert.deepEqual(departments, [{ id: 'a', label: 'Alpha department' }, { id: 'b', label: 'Beta department' },
    { id: 'inactive', label: 'Inactive department' }])
  assert.deepEqual(fields[1].props.options.map(option => option.label), ['100 Level', '200 Level', '1000 Level'])
  f.filter('Department', 'inactive'); assert.deepEqual(f.visible(), ['inactive'])
}, f => [
  item(f, 'one', 'ONE', 'One', [tuple(), tuple(), tuple(b, l2, p2)]),
  item(f, 'inactive', 'TWO', 'Two', [tuple(reference('inactive', 'Inactive department', false), reference('l3', '1000 Level'))]),
]))

test('all active dimensions must match one tuple; separate matching tuples never pass', async () => directory(async f => {
  f.filter('Department', a.id); f.filter('Level', l2.id); f.filter('Semester', p2.id)
  assert.deepEqual(f.visible(), ['two'], 'one has these values across different tuples only')
  f.filter('Department', b.id); f.filter('Level', l1.id); f.filter('Semester', p1.id)
  assert.deepEqual(f.visible(), [])
  f.filter('Department', null); f.filter('Level', l2.id); f.filter('Semester', p2.id)
  assert.deepEqual(f.visible(), ['one', 'two'])
}))

test('query clear preserves filters, clear filters preserves query, no-results recovery resets both', async () => directory(async f => {
  f.query('Institution One')
  f.filter('Department', a.id); f.filter('Level', l2.id); f.filter('Semester', p2.id)
  assert.deepEqual(f.visible(), [])
  f.clear(); assert.deepEqual(f.visible(), ['one'])
  assert.equal(f.find(f.SearchField).props.value, 'Institution One')
  f.filter('Department', b.id)
  let focused = 0
  const searchProps = f.find(f.SearchField).props
  searchProps.inputRef.current = { focus: () => { focused++ } }
  const search = f.mount(f.SearchField, searchProps).render()
  f.nodes(search.props.trailing).find(node => node.type === 'button').props.onClick()
  assert.equal(f.find(f.SearchField).props.value, '')
  assert.deepEqual(f.visible(), ['one'])
  assert.equal(focused, 1)
  assert.equal(f.nodes(f.view.render()).find(node => node.type === f.FilterSelect && node.props.label === 'Department').props.value, b.id)
  f.query('No such title')
  const empty = f.find(f.EmptyState)
  empty.props.actions.props.onClick()
  assert.deepEqual(f.visible(), ['one', 'two'])
  assert.equal(f.find(f.SearchField).props.value, '')
  assert.ok(f.nodes(f.view.render()).filter(node => node.type === f.FilterSelect).every(node => node.props.value === null))
  assert.equal(focused, 2)
}))

test('search and filters happen before pagination; either input resets page to one', async () => directory(async f => {
  assert.equal(f.visible().length, 12)
  f.find(f.Pagination).props.onPageChange(3)
  assert.equal(f.find(f.Pagination).props.page, 3)
  f.query('MATCH')
  assert.deepEqual(f.visible(), Array.from({ length: 8 }, (_, i) => 'id-' + (i + 20)))
  assert.equal(f.find(f.Pagination).props.page, 1)
  assert.equal(f.find(f.Pagination).props.totalPages, 1)
  f.query(''); f.find(f.Pagination).props.onPageChange(3)
  f.filter('Department', b.id)
  assert.deepEqual(f.visible(), ['id-5', 'id-6', 'id-7', 'id-8', 'id-9', 'id-10'])
  assert.equal(f.find(f.Pagination).props.page, 1)
}, f => Array.from({ length: 32 }, (_, i) => item(f, 'id-' + i, 'CODE' + i,
  (i >= 20 && i < 28 ? 'MATCH ' : '') + 'Course ' + i, [tuple(i >= 5 && i <= 10 ? b : a)]))))

test('data shrink clamps before rendering and settles the page before later growth', async () => directory(async f => {
  f.find(f.Pagination).props.onPageChange(3)
  f.view.props = { items: f.entries.slice(0, 13) }
  assert.deepEqual(f.visible(), ['id-12'])
  assert.equal(f.find(f.Pagination).props.page, 2)
  f.view.props = { items: f.entries }
  assert.equal(f.find(f.Pagination).props.page, 2)
  assert.equal(f.visible()[0], 'id-12')
}, f => Array.from({ length: 30 }, (_, i) => item(f, 'id-' + i, 'CODE' + i, 'Course ' + i))))

test('genuine empty catalogue differs from no matches and has no search, filters or pagination', async () =>
  directory(async f => {
    assert.match(f.html(f.view.render()), /No courses are available to browse\./)
    assert.equal(f.find(f.SearchField), undefined); assert.equal(f.find(f.FilterSelect), undefined)
    assert.equal(f.find(f.Pagination), undefined)
  }, () => []))

test('normal results have no external search clear and the count is announced without making inert rows tabbable', async () => directory(async f => {
  const tree = f.view.render(), html = f.html(tree)
  assert.equal((html.match(/aria-label="Clear search"/g) || []).length, 0)
  assert.equal((html.match(/>Clear filters<\/button>/g) || []).length, 1)
  assert.match(html, /aria-live="polite"/)
  assert.doesNotMatch(html, /Difficulty|credits|Exam-critical|Reset filters|tabindex="0"|role="link"/)
  assert.equal((html.match(/<li\b/g) || []).length, 2)
}))
