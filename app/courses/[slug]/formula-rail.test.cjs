// app/courses/[slug]/formula-rail.test.cjs — Formula boxes show every formula's text unchanged and wrap long formulas
// only between their units: never inside a word, a number or a short bracketed group, and never leaving a short closing
// term alone on a line, so nothing is cut off at the box edge.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../lib/test/tsx-loader.cjs')

const decode = html => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
// Every formula the seeded courses publish.
const seeded = () => {
  const dir = path.join(__dirname, '../../../supabase/migrations')
  const found = new Set()
  for (const file of fs.readdirSync(dir)) {
    for (const match of fs.readFileSync(path.join(dir, file), 'utf8').matchAll(/"formula" *: *("(?:[^"\\]|\\.)*")/g)) {
      found.add(JSON.parse(match[1]))
    }
  }
  return [...found]
}

// Bracketed groups of at most 20 visible characters ("x̄" is one) that contain a space: a line never breaks inside one.
const width = text => text.replace(/\p{M}/gu, '').length
const shortGroups = formula => {
  const groups = [], open = []
  ;[...formula].forEach((char, index) => {
    if ('([{'.includes(char)) open.push(index)
    else if (')]}'.includes(char) && open.length) groups.push([open.pop(), index])
  })
  return groups.filter(([start, end]) => width(formula.slice(start, end + 1)) <= 20 && formula.slice(start, end + 1).includes(' '))
}

test('every seeded formula renders with its text unchanged, as units a line never breaks inside', async () => withTsx(async () => {
  const { FormulaRail, formulaUnits } = require('./sections.tsx')
  const formulas = seeded()
  assert.ok(formulas.length >= 30, 'the seeded formulas were found')
  for (const formula of formulas) {
    const html = renderToStaticMarkup(React.createElement(FormulaRail, { formula }))
    assert.equal(decode(html), formula, formula)
    const units = formulaUnits(formula)
    assert.equal(units.map(unit => unit.before + unit.text).join(''), formula, formula)
    assert.deepEqual([...html.matchAll(/<span class="student-formula-word">([^<]*)<\/span>/g)].map(m => decode(m[1])),
      units.map(unit => unit.text), formula)
    // Where each unit starts and ends in the formula: a line can break only there.
    let at = 0
    const edges = units.map(unit => { at += unit.before.length; const edge = [at, at + unit.text.length]; at = edge[1]; return edge })
    for (const [start, end] of shortGroups(formula)) {
      assert.ok(edges.some(([from, to]) => from <= start && end < to), `${formula}: ${formula.slice(start, end + 1)} stays whole`)
    }
    for (const word of formula.split(' ').filter(word => /\S-\S/.test(word))) {
      assert.ok(units.some(unit => unit.text.includes(word)), `${formula}: ${word} stays whole`)
    }
    const last = units[units.length - 1].text
    assert.ok(units.length === 1 || width(last) >= 8, `${formula}: the last unit "${last}" does not stand alone`)
    assert.ok(units.every(unit => width(unit.text) <= 24), `${formula}: every unit fits a formula box's line`)
    assert.ok(units.slice(0, -1).every(unit => !/[=+−\-×÷/±([{]$/.test(unit.text)) || formula.includes('  '),
      `${formula}: no line ends with an operator or an opening bracket`)
  }
  const units = formula => formulaUnits(formula).map(unit => unit.text)
  assert.deepEqual(units('BEQ = FC / (P − v)'), ['BEQ', '= FC', '/ (P − v)'], 'the group stays whole, each operator starts its line')
  assert.deepEqual(units('Target Profit Output = (FC + Target Profit) / (P − v)').slice(-2), ['= (FC + Target Profit)', '/ (P − v)'])
  assert.deepEqual(units('Capitalization Rate = (Total Interest on All Loans ÷ Total Principal) × 100').slice(-1),
    ['Principal) × 100'], '"× 100" never stands alone')
  assert.deepEqual(units('Margin of Safety = Budgeted Sales - Break-Even Sales').slice(-1), ['- Break-Even Sales'])
  assert.deepEqual(units('r = Σ[(x − x̄)(y − ȳ)] / √{ Σ(x − x̄)² × Σ(y − ȳ)² }'),
    ['r', '= Σ[(x − x̄)(y − ȳ)]', '/ √{ Σ(x − x̄)²', '× Σ(y − ȳ)² }'], '"x̄" counts as one character')
  // Two groups side by side inside a long one may break between them, with nothing added to the text.
  const wide = 'K = (Alpha Beta Gamma Delta Epsilon)(Zeta Eta Theta Iota Kappa)'
  assert.equal(formulaUnits(wide).filter((unit, index) => index > 0 && unit.before === '').length, 1)
  assert.match(renderToStaticMarkup(React.createElement(FormulaRail, { formula: wide })), /Epsilon\)<\/span><wbr\/><span/)
  assert.equal(decode(renderToStaticMarkup(React.createElement(FormulaRail, { formula: wide }))), wide)
}))

test('the formula box wraps at spaces and never inside a word or number', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../styles/student-app.css'), 'utf8')
  const rule = css.match(/\.student-formula-rail > code \{([^}]*)\}/)[1]
  assert.match(rule, /white-space: normal/)
  assert.match(rule, /overflow-wrap: normal/, 'the inherited anywhere-wrapping is turned off')
  assert.match(rule, /word-break: normal/)
  assert.match(css, /\.student-formula-word \{ white-space: nowrap; \}/)
  assert.match(css, /\.student-grid\.student-formula-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/,
    'the desktop formula sheet keeps two columns')
})
