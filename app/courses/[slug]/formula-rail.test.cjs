// app/courses/[slug]/formula-rail.test.cjs — Formula boxes show every formula's text unchanged and wrap long formulas
// at their spaces, never inside a word or number, so nothing is cut off at the box edge.
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

test('every seeded formula renders with its text unchanged, and hyphenated words are kept whole', async () => withTsx(async () => {
  const { FormulaRail } = require('./sections.tsx')
  const formulas = seeded()
  assert.ok(formulas.length >= 30, 'the seeded formulas were found')
  for (const formula of formulas) {
    const html = renderToStaticMarkup(React.createElement(FormulaRail, { formula }))
    assert.equal(decode(html), formula, formula)
    const whole = [...html.matchAll(/<span class="student-formula-word">([^<]*)<\/span>/g)].map(m => decode(m[1]))
    assert.deepEqual(whole, formula.split(' ').filter(word => /\S-\S/.test(word)), formula)
  }
  const html = renderToStaticMarkup(React.createElement(FormulaRail, { formula: 'Margin of Safety = Budgeted Sales - Break-Even Sales' }))
  assert.match(html, /Budgeted Sales - <span class="student-formula-word">Break-Even<\/span> Sales/)
  assert.equal(renderToStaticMarkup(React.createElement(FormulaRail, { formula: 'BEQ = FC / (P − v)' })),
    '<div class="student-formula-rail"><code>BEQ = FC / (P − v)</code></div>', 'a formula without hyphenated words is plain text')
}))

test('the formula box wraps at spaces and never inside a word or number', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../styles/student-app.css'), 'utf8')
  const rule = css.match(/\.student-formula-rail > code \{([^}]*)\}/)[1]
  assert.match(rule, /white-space: normal/)
  assert.match(rule, /overflow-wrap: normal/, 'the inherited anywhere-wrapping is turned off')
  assert.match(rule, /word-break: normal/)
  assert.match(css, /\.student-formula-word \{ white-space: nowrap; \}/)
})
