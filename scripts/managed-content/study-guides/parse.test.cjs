// scripts/managed-content/study-guides/parse.test.cjs — Every committed guide (all 20, 183 topics) parses, and the parse
// loses nothing: written back out, it equals the source line for line. HTML, links and images are refused.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { normalizedSource, normalizedWritten, parseBlocks, parseCover, parseInline, parseTopic, coverToMarkdown,
  topicToMarkdown } = require('./parse.cjs')

const SOURCE = path.join(__dirname, 'source')
const courses = fs.readdirSync(SOURCE).sort()
const topicFiles = code => fs.readdirSync(path.join(SOURCE, code)).filter(name => /^T[1-9]\d*\.md$/.test(name))
  .sort((a, b) => Number(a.slice(1, -3)) - Number(b.slice(1, -3)))

test('all 20 guides and their 183 topics parse, and each written back equals its source', () => {
  assert.equal(courses.length, 20)
  let topics = 0, lessons = 0
  for (const code of courses) {
    const coverSource = fs.readFileSync(path.join(SOURCE, code, 'T0.md'), 'utf8')
    const cover = parseCover(coverSource, `${code}/T0.md`)
    assert.deepEqual(normalizedWritten(coverToMarkdown(cover)), normalizedSource(coverSource), `${code}/T0.md`)
    topicFiles(code).forEach((name, index) => {
      const source = fs.readFileSync(path.join(SOURCE, code, name), 'utf8')
      const topic = parseTopic(source, `${code}/${name}`)
      assert.equal(topic.number, index + 1, `${code}/${name}: topics are numbered in order`)
      assert.equal(topic.theory.nudge, topic.number, `${code}/${name}: its practice link is its own topic`)
      assert.deepEqual(normalizedWritten(topicToMarkdown(topic)), normalizedSource(source), `${code}/${name}`)
      topics++
      lessons += topic.lessons.length
    })
  }
  assert.equal(topics, 183)
  assert.equal(lessons, 1000)
})

test('the parse keeps the guide structure: lessons, folded detail, tables, nested lists, the theory question', () => {
  const read = (code, name) => parseTopic(fs.readFileSync(path.join(SOURCE, code, name), 'utf8'), name)
  const inventories = read('ACC-CM201', 'T4.md')
  assert.equal(inventories.title, 'IAS 2 Inventories')
  assert.deepEqual(inventories.lessons.map(lesson => lesson.number), ['4.1', '4.2', '4.3', '4.4', '4.5'])
  assert.ok(inventories.lessons.every(lesson => lesson.mustKnow.length > 0 && lesson.explainMore.length > 0))
  const table = inventories.lessons[3].explainMore.find(block => block.type === 'table')
  assert.deepEqual(table.header.map(cell => cell.map(span => span.text).join('')), ['Line', 'Cost (₦)', 'NRV (₦)', 'Lower (₦)'])
  assert.deepEqual(table.rows[3][3], [{ text: '790,000', bold: true }])
  assert.equal(inventories.theory.answerLabel, '*Solution:*')
  // Two lessons have no "Explain more"; the stem-and-leaf plot is one preformatted block.
  assert.equal(read('AMS101', 'T3.md').lessons.find(lesson => lesson.number === '3.5').explainMore, undefined)
  const statistics = read('LAG-ACS209', 'T2.md').lessons.flatMap(lesson => [...lesson.mustKnow, ...(lesson.explainMore ?? [])])
  assert.match(statistics.find(block => block.type === 'preformatted').text, /^2 \| 4 7\n3 \| 1 3 3 8/)
})

test('inline text keeps bold, italic, both, escapes and a lone literal asterisk', () => {
  assert.deepEqual(parseInline('a **b** *c* ***d*** \\_e\\_ f\\|g', 't'), [
    { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' },
    { text: 'd', bold: true, italic: true }, { text: ' _e_ f|g' }])
  assert.deepEqual(parseInline('dial *XYZ# now', 't'), [{ text: 'dial *XYZ# now' }])
  assert.deepEqual(parseInline('a ____ activity', 't'), [{ text: 'a ____ activity' }])
})

test('HTML, links, images, inline code and entities are refused anywhere', () => {
  for (const bad of ['<b>x</b>', 'a <script>alert(1)</script>', '[text](https://example.com)', '![image](x.png)',
    'use `code`', 'a &amp; b', 'x <img src=x onerror=y>', '<!-- note -->']) {
    assert.throws(() => parseInline(bad, 't'), /not allowed/, bad)
    assert.throws(() => parseBlocks([`- ${bad}`], 't'), /not allowed/, bad)
    assert.throws(() => parseBlocks(['| a | b |', '| --- | --- |', `| ${bad} | x |`], 't'), /not allowed/, bad)
  }
  assert.throws(() => parseBlocks(['```', '<b>x</b>', '```'], 't'), /invalid preformatted/)
  assert.throws(() => parseBlocks(['> quoted'], 't'), /quotation/)
  assert.throws(() => parseBlocks(['# heading'], 't'), /heading/)
  assert.throws(() => parseInline('**unclosed', 't'), /unbalanced bold/)
  // An escaped bracket and a less-than sign in a sum stay text.
  assert.deepEqual(parseInline('x < 5 and \\[y\\]', 't'), [{ text: 'x < 5 and [y]' }])
})

test('a topic out of shape is refused', () => {
  const topic = fs.readFileSync(path.join(SOURCE, 'GST111', 'T1.md'), 'utf8')
  assert.throws(() => parseTopic(topic.replace('[[NUDGE:1]]', '[[NUDGE:2]]'), 't'), /practice link/)
  assert.throws(() => parseTopic(topic.replace('**Question:** ', ''), 't'), /Question/)
  assert.throws(() => parseTopic(topic.replace('### One-minute recap', '### Summary'), 't'), /unexpected section/)
  assert.throws(() => parseTopic(topic.replace('**Must know**', 'Must know'), 't'), /Must know/)
})
