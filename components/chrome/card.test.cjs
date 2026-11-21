// Public-home card regression after retiring the superseded bookmark action slots.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

test('public course cards retain identity, difficulty and the course target after Bookmarks moves to the register', async () => {
  const { Card } = await withTsx(() => require('./Card.tsx'))
  const html = renderToStaticMarkup(React.createElement(Card, { code: 'BUA201', title: 'Business Administration',
    level: '200', credits: '3 credits', timeLimit: '', difficulty: 'medium', cta: { href: '/courses/business', label: 'View course' } }))
  assert.match(html, /Business Administration/)
  assert.match(html, /200 level/)
  assert.match(html, /3 credits/)
  assert.match(html, /Medium/)
  assert.match(html, /href="\/courses\/business"/)
  assert.equal((html.match(/<a\b/g) || []).length, 1)
  assert.doesNotMatch(html, /<button\b|aria-pressed/)
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, 'Card.tsx'), 'utf8'), /footerAction|cornerAction|bookmarks/i)
})
