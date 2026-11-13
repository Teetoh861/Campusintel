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

test('inline text keeps ordinary *italic* and **bold**, both together, and escapes', () => {
  assert.deepEqual(parseInline('a **b** *c* ***d*** \\_e\\_ f\\|g', 't'), [
    { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' },
    { text: 'd', bold: true, italic: true }, { text: ' _e_ f|g' }])
  assert.deepEqual(parseInline('plain *italic* and **bold** text', 't'), [
    { text: 'plain ' }, { text: 'italic', italic: true }, { text: ' and ' }, { text: 'bold', bold: true }, { text: ' text' }])
  assert.deepEqual(parseInline('**Must know:** read *this* first.', 't'), [
    { text: 'Must know:', bold: true }, { text: ' read ' }, { text: 'this', italic: true }, { text: ' first.' }])
  assert.deepEqual(parseInline('a ____ activity', 't'), [{ text: 'a ____ activity' }])
  // An escaped asterisk is text and never a delimiter.
  assert.deepEqual(parseInline('\\*not italic\\* and 2 \\* 3', 't'), [{ text: '*not italic* and 2 * 3' }])
})

test('an asterisk that matches nothing stays in the text: a USSD code, a truncation sign, a multiplication', () => {
  assert.deepEqual(parseInline('dial *XYZ# now', 't'), [{ text: 'dial *XYZ# now' }])
  assert.deepEqual(parseInline('dial *737# or *894# to check', 't'), [{ text: 'dial *737# or *894# to check' }])
  assert.deepEqual(parseInline('teen* retrieves teen, teens and teenager', 't'), [{ text: 'teen* retrieves teen, teens and teenager' }])
  assert.deepEqual(parseInline('a * b * c', 't'), [{ text: 'a * b * c' }])
  assert.deepEqual(parseInline('**unclosed', 't'), [{ text: '**unclosed' }])
  assert.deepEqual(parseInline('an asterisk (*) on its own', 't'), [{ text: 'an asterisk (*) on its own' }])
})

test('GST 111 topic 14 keeps its asterisks: the truncation sign and the bracketed search', () => {
  const topic = parseTopic(fs.readFileSync(path.join(SOURCE, 'GST111', 'T14.md'), 'utf8'), 'GST111/T14.md')
  const items = topic.lessons.flatMap(lesson => [...lesson.mustKnow, ...(lesson.explainMore ?? [])])
    .filter(block => block.type === 'list').flatMap(list => list.items.map(item => item.text))
  const starting = label => items.find(spans => spans[0].text === label && spans[0].bold)
  // T14.md line 90: the asterisk in brackets is bold with its label, and "teen*" keeps its sign.
  assert.deepEqual(starting('Truncation:'), [
    { text: 'Truncation:', bold: true }, { text: ' using an ' }, { text: 'asterisk (*)', bold: true }, { text: ' at the ' },
    { text: 'root', bold: true },
    { text: ' of a word so the tool retrieves all word variations after it. Purpose: to ' }, { text: 'broaden', bold: true },
    { text: ' results. teen* retrieves teen, teens, teenager, teenagers, teenaged, teensy, teeny.' }])
  // T14.md line 99: both truncated words keep their sign, and nothing between them is italic.
  assert.deepEqual(starting('Search order:').at(-1), { text: ' and connect AND terms first. When mixing AND and OR, put the alternatives in '
    + 'brackets: (ethic* OR moral*) AND (bioengineering OR cloning).' })
  assert.equal(JSON.stringify(topic).includes('"italic":true'), false, 'the topic has no italic text at all')
  // Every asterisk the topic's lessons and recap write, in order, each still attached to its word.
  const written = []
  const walk = value => {
    if (typeof value === 'string') written.push(...(value.match(/\S*\*\S*/g) ?? []))
    else if (Array.isArray(value)) value.forEach(walk)
    else if (value && typeof value === 'object') Object.values(value).forEach(walk)
  }
  walk([topic.lessons, topic.recap])
  assert.deepEqual(written, ['(*)', 'teen*', '(ethic*', 'moral*)', '*', '(*)', '*'])
})

test('asterisks follow CommonMark: flanking runs, nearest opener, the rule of three', () => {
  // Each line is an example from the CommonMark spec's "Emphasis and strong emphasis", written as it renders.
  const rendered = source => parseInline(source, 't').map(span => {
    let out = span.text
    if (span.bold) out = `<strong>${out}</strong>`
    if (span.italic) out = `<em>${out}</em>`
    return out
  }).join('')
  for (const [source, expected] of [
    // A run opens only when left-flanking and closes only when right-flanking.
    ['*foo bar*', '<em>foo bar</em>'], ['a * foo bar*', 'a * foo bar*'], ['a*"foo"*', 'a*"foo"*'], ['*foo bar *', '*foo bar *'],
    ['*(*foo)', '*(*foo)'], ['*(*foo*)*', '<em>(foo)</em>'], ['foo*bar*', 'foo<em>bar</em>'], ['5*6*78', '5<em>6</em>78'],
    ['*foo*bar', '<em>foo</em>bar'], ['**foo bar**', '<strong>foo bar</strong>'], ['** foo bar**', '** foo bar**'],
    ['a**"foo"**', 'a**"foo"**'], ['foo**bar**', 'foo<strong>bar</strong>'], ['**foo bar **', '**foo bar **'],
    ['**(**foo)', '**(**foo)'], ['**foo**bar', '<strong>foo</strong>bar'],
    ['** is not an empty emphasis', '** is not an empty emphasis'], ['foo ***', 'foo ***'],
    // Nesting, with bold taken first when both runs have two asterisks.
    ['*(**foo**)*', '<em>(</em><em><strong>foo</strong></em><em>)</em>'],
    ['*foo**bar**baz*', '<em>foo</em><em><strong>bar</strong></em><em>baz</em>'],
    ['***foo** bar*', '<em><strong>foo</strong></em><em> bar</em>'], ['*foo **bar***', '<em>foo </em><em><strong>bar</strong></em>'],
    ['foo***bar***baz', 'foo<em><strong>bar</strong></em>baz'], ['*foo *bar* baz*', '<em>foo bar baz</em>'],
    // The rule of three: lengths adding up to a multiple of three do not match when either run could open and close.
    ['*foo**bar*', '<em>foo**bar</em>'], ['*foo**bar***', '<em>foo</em><em><strong>bar</strong></em>'],
    ['foo******bar*********baz', 'foo<strong>bar</strong>***baz'], ['**foo*bar**', '<strong>foo*bar</strong>'],
    // Whatever is left over stays in the text.
    ['**foo*', '*<em>foo</em>'], ['*foo**', '<em>foo</em>*'], ['***foo**', '*<strong>foo</strong>'], ['****foo*', '***<em>foo</em>'],
    ['**foo***', '<strong>foo</strong>*'], ['*foo****', '<em>foo</em>***'], ['*foo**bar', '*foo**bar'],
  ]) assert.equal(rendered(source), expected, source)
  // A closing run after punctuation needs a space or punctuation after it, so this label is not bold.
  assert.deepEqual(parseInline('**Label:**text', 't'), [{ text: '**Label:**text' }])
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
