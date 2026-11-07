// app/courses/[slug]/overview-bank-topics.test.cjs — A course whose questions come from an official bank lists the
// bank's topic names, in order and with nothing added, as its syllabus topics; any other course keeps its overview's.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../../lib/test/tsx-loader.cjs')

const text = html => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
const overview = { title: 'Overview', body: 'Published overview body.',
  topics: [{ chapter: '1', description: 'Old chapter one' }, { chapter: '2', description: 'Old chapter two' }] }

test('bank topic names replace the overview topics, numbered, in bank order, with no descriptions', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const bankTopics = ['An Overview of Leadership', 'Leadership Approaches and Practices', 'Public Sector Reforms']
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview, bankTopics, number: 4 }))
  assert.match(text(html), /Syllabus topics 01 An Overview of Leadership 02 Leadership Approaches and Practices 03 Public Sector Reforms/)
  assert.equal((html.match(/Syllabus topics/g) || []).length, 1, 'one topic list')
  assert.doesNotMatch(html, /Old chapter|CH \d/, 'the old overview topics and their descriptions are gone')
  assert.match(text(html), /Published overview body\./, 'the rest of the overview stays')
}))

test('a course without a bank keeps its overview topics with their descriptions', async () => withTsx(async () => {
  const { OverviewSection } = require('./sections.tsx')
  const html = renderToStaticMarkup(React.createElement(OverviewSection, { overview, number: 4 }))
  assert.match(text(html), /Syllabus topics CH 1 Old chapter one CH 2 Old chapter two/)
}))

test('every imported course has its bank topics for the overview', async () => withTsx(async () => {
  const { OFFICIAL_BANK_SECTIONS } = require('../../../lib/data/official-bank-sections.ts')
  assert.deepEqual(Object.keys(OFFICIAL_BANK_SECTIONS).sort(), ['entrepreneurship-innovation', 'financial-accounting-1',
    'introduction-financial-management', 'leadership-governance', 'principles-business-administration',
    'principles-business-administration-2', 'quantitative-analysis-management', 'use-of-english'])
}))
