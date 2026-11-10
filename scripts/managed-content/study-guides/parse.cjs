// scripts/managed-content/study-guides/parse.cjs — A strict parser for the owner's study guide markdown.
// The guides are untrusted data. This parser accepts only the structures the guides use (headings in fixed places,
// paragraphs, bold and italic text, nested lists, tables, one preformatted block) and refuses anything else, so no
// HTML, link or image can reach a payload. The result is a plain tree of text and flags that the site renders as
// React elements. toMarkdown() writes a tree back out, so tests can prove the parse lost nothing.
const assert = require('node:assert/strict')

const ESCAPABLE = new Set(['\\', '*', '_', '|', '`', '[', ']', '#', '>', '-', '+', '.', '!', '(', ')'])

/** Refuse what a guide must never carry: tags, links, images, inline code and HTML entities. */
function refuseUnsafe(text, where) {
  const plain = text.replace(/\\./g, '')
  assert.ok(!/<[A-Za-z/!?]/.test(plain), `${where}: HTML is not allowed`)
  assert.ok(!/\]\(/.test(plain) && !/!\[/.test(plain), `${where}: links and images are not allowed`)
  assert.ok(!plain.includes('`'), `${where}: inline code is not allowed`)
  assert.ok(!/&(#\d+|#x[0-9a-f]+|[a-z]+);/i.test(plain), `${where}: HTML entities are not allowed`)
}

/** One line of inline text as spans of plain text with bold and italic flags. */
function parseInline(text, where) {
  refuseUnsafe(text, where)
  const tokens = []
  let buffer = ''
  const flush = () => { if (buffer) tokens.push({ kind: 'text', value: buffer }); buffer = '' }
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '\\' && index + 1 < text.length && ESCAPABLE.has(text[index + 1])) {
      buffer += text[index + 1]; index++; continue
    }
    if (char === '*') {
      flush()
      if (text[index + 1] === '*') { tokens.push({ kind: 'bold' }); index++ } else tokens.push({ kind: 'italic' })
      continue
    }
    buffer += char
  }
  flush()
  assert.equal(tokens.filter(token => token.kind === 'bold').length % 2, 0, `${where}: unbalanced bold`)
  // A lone asterisk with no partner (a USSD code such as *XYZ#) is literal text.
  const italics = tokens.filter(token => token.kind === 'italic')
  if (italics.length % 2 === 1) Object.assign(italics[italics.length - 1], { kind: 'text', value: '*' })
  const spans = []
  let bold = false, italic = false
  for (const token of tokens) {
    if (token.kind === 'bold') { bold = !bold; continue }
    if (token.kind === 'italic') { italic = !italic; continue }
    const last = spans[spans.length - 1]
    if (last && Boolean(last.bold) === bold && Boolean(last.italic) === italic) { last.text += token.value; continue }
    spans.push({ text: token.value, ...(bold ? { bold: true } : {}), ...(italic ? { italic: true } : {}) })
  }
  assert.ok(!bold && !italic, `${where}: unclosed emphasis`)
  return spans
}

function inlineToMarkdown(spans) {
  let out = '', bold = false, italic = false
  for (const span of spans) {
    const wantBold = Boolean(span.bold), wantItalic = Boolean(span.italic)
    if (italic && !wantItalic) { out += '*'; italic = false }
    if (bold && !wantBold) { out += '**'; bold = false }
    if (!bold && wantBold) { out += '**'; bold = true }
    if (!italic && wantItalic) { out += '*'; italic = true }
    out += span.text
  }
  if (italic) out += '*'
  if (bold) out += '**'
  return out
}

const plainInline = spans => spans.map(span => span.text).join('')

const LIST_LINE = /^( *)([-*]|\d+\.) (.*)$/
const indentOf = line => line.length - line.trimStart().length

/** Split one table row on unescaped pipes. */
function tableCells(line, where) {
  const row = line.trim()
  assert.ok(row.startsWith('|') && row.endsWith('|') && !row.endsWith('\\|'), `${where}: a table row must start and end with |`)
  const cells = []
  let cell = ''
  for (let index = 1; index < row.length - 1; index++) {
    if (row[index] === '\\' && row[index + 1] === '|') { cell += '\\|'; index++; continue }
    if (row[index] === '|') { cells.push(cell); cell = ''; continue }
    cell += row[index]
  }
  cells.push(cell)
  return cells.map(value => value.trim())
}

/**
 * Parse a run of body lines into blocks: paragraphs, lists (nested by indentation), tables and preformatted text.
 * Each source line of text becomes its own paragraph or list item; indented lines under a list item belong to it.
 */
function parseBlocks(lines, where) {
  const blocks = []
  let stack = [] // open lists, outermost first: { indent, list, items }
  let index = 0
  const closeLists = () => { stack = [] }
  while (index < lines.length) {
    const line = lines[index]
    const at = `${where} line ${index + 1}`
    // A blank line keeps open lists open: an indented line after it still belongs to the list item above.
    if (!line.trim()) { index++; continue }
    const trimmed = line.trim()
    assert.ok(!trimmed.startsWith('#'), `${at}: a heading is not allowed here`)
    assert.ok(!trimmed.startsWith('>'), `${at}: a quotation is not allowed here`)
    if (trimmed.startsWith('```')) {
      closeLists()
      const body = []
      index++
      while (index < lines.length && !lines[index].trim().startsWith('```')) body.push(lines[index++])
      assert.ok(index < lines.length, `${at}: unclosed preformatted block`)
      assert.ok(body.length > 0 && body.every(text => !/<[A-Za-z/!?]/.test(text)), `${at}: invalid preformatted block`)
      blocks.push({ type: 'preformatted', text: body.join('\n') })
      index++
      continue
    }
    if (trimmed.startsWith('|')) {
      assert.equal(indentOf(line), 0, `${at}: an indented table is not supported`)
      const header = tableCells(line, at)
      const separator = lines[index + 1] === undefined ? [] : tableCells(lines[index + 1], `${at} separator`)
      assert.ok(separator.length === header.length && separator.every(cell => /^:?-{3,}:?$/.test(cell)),
        `${at}: a table needs a separator row`)
      const rows = []
      index += 2
      while (index < lines.length && lines[index].trim().startsWith('|')) {
        const cells = tableCells(lines[index], `${where} line ${index + 1}`)
        assert.equal(cells.length, header.length, `${where} line ${index + 1}: a table row needs ${header.length} cells`)
        rows.push(cells.map(cell => parseInline(cell, `${where} line ${index + 1}`)))
        index++
      }
      const table = { type: 'table', header: header.map(cell => parseInline(cell, at)), rows }
      // A table between a list item and that item's indented continuation belongs to the item; otherwise it stands
      // alone and ends any open list.
      let next = index
      while (next < lines.length && !lines[next].trim()) next++
      const continuation = next < lines.length && indentOf(lines[next]) > 0
      if (stack.length && continuation) {
        const parent = stack[stack.length - 1]
        const owner = parent.list.items[parent.list.items.length - 1]
        owner.blocks = owner.blocks ?? []
        owner.blocks.push(table)
      } else {
        closeLists()
        blocks.push(table)
      }
      continue
    }
    const list = LIST_LINE.exec(line)
    if (list) {
      const indent = list[1].length, ordered = /\d/.test(list[2]), number = ordered ? Number.parseInt(list[2], 10) : null
      const item = { text: parseInline(list[3], at) }
      assert.ok(item.text.length > 0, `${at}: an empty list item`)
      while (stack.length && stack[stack.length - 1].indent > indent) stack.pop()
      const top = stack[stack.length - 1]
      const continues = top && top.indent === indent && top.list.ordered === ordered
        && (!ordered || number === top.list.start + top.list.items.length)
      if (continues) top.list.items.push(item)
      else if (top && top.indent === indent && ordered && top.list.ordered && number !== 1) {
        assert.fail(`${at}: list numbers must run in order`)
      }
      else {
        if (top && top.indent === indent) stack.pop()
        const created = { type: 'list', ordered, ...(ordered ? { start: number } : {}), items: [item] }
        const parent = stack[stack.length - 1]
        if (parent) {
          const owner = parent.list.items[parent.list.items.length - 1]
          owner.blocks = owner.blocks ?? []
          owner.blocks.push(created)
        } else blocks.push(created)
        stack.push({ indent, list: created })
      }
      index++
      continue
    }
    if (indentOf(line) > 0) {
      // A continuation line under a list item: a paragraph inside the deepest item it is indented under.
      while (stack.length && stack[stack.length - 1].indent >= indentOf(line)) stack.pop()
      const parent = stack[stack.length - 1]
      assert.ok(parent, `${at}: an indented line outside a list`)
      const owner = parent.list.items[parent.list.items.length - 1]
      owner.blocks = owner.blocks ?? []
      owner.blocks.push({ type: 'paragraph', text: parseInline(trimmed, at) })
      index++
      continue
    }
    closeLists()
    blocks.push({ type: 'paragraph', text: parseInline(trimmed, at) })
    index++
  }
  return blocks
}

/** Write blocks back as markdown lines, two spaces of indentation per level. */
function blocksToMarkdown(blocks, depth = 0) {
  const pad = '  '.repeat(depth)
  const out = []
  for (const block of blocks) {
    if (block.type === 'paragraph') out.push(pad + inlineToMarkdown(block.text))
    else if (block.type === 'preformatted') out.push('```', ...block.text.split('\n'), '```')
    else if (block.type === 'table') {
      const row = cells => `| ${cells.map(cell => inlineToMarkdown(cell).replaceAll('|', '\\|')).join(' | ')} |`
      out.push(row(block.header), `| ${block.header.map(() => '---').join(' | ')} |`, ...block.rows.map(row))
    } else {
      block.items.forEach((item, index) => {
        out.push(`${pad}${block.ordered ? `${block.start + index}.` : '-'} ${inlineToMarkdown(item.text)}`)
        if (item.blocks) out.push(...blocksToMarkdown(item.blocks, depth + 1))
      })
    }
  }
  return out
}

/** Plain text of blocks, for theory prompts and answers, which the site shows as text with line breaks. */
function blocksToPlain(blocks, depth = 0) {
  const pad = '  '.repeat(depth)
  const out = []
  for (const block of blocks) {
    if (block.type === 'paragraph') out.push(pad + plainInline(block.text))
    else if (block.type === 'preformatted') out.push(block.text)
    else if (block.type === 'table') {
      out.push(...[block.header, ...block.rows].map(cells => pad + cells.map(plainInline).join(' | ')))
    } else {
      block.items.forEach((item, index) => {
        out.push(`${pad}${block.ordered ? `${block.start + index}.` : '•'} ${plainInline(item.text)}`)
        if (item.blocks) out.push(...blocksToPlain(item.blocks, depth + 1))
      })
    }
  }
  return out
}

const sections = lines => {
  // Split on '### ' headings; the first entry is what comes before the first one.
  const parts = [{ heading: null, lines: [] }]
  for (const line of lines) {
    if (line.startsWith('### ')) parts.push({ heading: line.slice(4), lines: [] })
    else parts[parts.length - 1].lines.push(line)
  }
  return parts
}

const ANSWER_LABELS = ['*Solution:*', '*Answer outline:*', '*Worked solution:*', '*Answer:*', '**Solution:**']

/** One topic file (T1..TN.md). */
function parseTopic(source, where) {
  assert.ok(!source.includes('\r'), `${where}: carriage returns are not allowed`)
  const lines = source.replace(/\n+$/, '').split('\n')
  const head = /^## Topic (\d+): (.+)$/.exec(lines[0])
  assert.ok(head, `${where}: the first line must be "## Topic N: Title"`)
  const number = Number(head[1])
  const title = parseInline(head[2], `${where} title`)
  assert.ok(title.every(span => !span.bold && !span.italic), `${where}: a plain title`)
  const parts = sections(lines.slice(1))
  const introStart = parts[0].lines.findIndex(line => line.trim())
  const intro = parts[0].lines[introStart] ?? ''
  assert.ok(intro.startsWith('**What you must know:** '), `${where}: "What you must know" comes first`)
  const mustKnow = parseInline(intro.slice('**What you must know:** '.length), `${where} what you must know`)
  // A few topics add a short block after it, such as a key to the symbols used.
  const introMore = parseBlocks(parts[0].lines.slice(introStart + 1), `${where} introduction`)
  const lessons = []
  let recap = null, theory = null
  for (const part of parts.slice(1)) {
    const at = `${where} "${part.heading}"`
    const lesson = /^Lesson (\d+\.\d+): (.+)$/.exec(part.heading)
    if (lesson) {
      assert.ok(recap === null && theory === null, `${at}: lessons come before the recap`)
      assert.ok(lesson[1].startsWith(`${number}.`), `${at}: lesson number belongs to topic ${number}`)
      const body = part.lines
      const must = body.findIndex(line => line === '**Must know**')
      const more = body.findIndex(line => line === '**Explain more**')
      assert.ok(must >= 0 && body.slice(0, must).every(line => !line.trim()), `${at}: starts with "Must know"`)
      assert.ok(more === -1 || more > must, `${at}: "Explain more" follows "Must know"`)
      lessons.push({ number: lesson[1], title: plainInline(parseInline(lesson[2], at)),
        mustKnow: parseBlocks(body.slice(must + 1, more === -1 ? undefined : more), `${at} must know`),
        ...(more === -1 ? {} : { explainMore: parseBlocks(body.slice(more + 1), `${at} explain more`) }) })
      assert.ok(lessons[lessons.length - 1].mustKnow.length > 0, `${at}: "Must know" is empty`)
    } else if (part.heading === 'One-minute recap') {
      assert.ok(recap === null && theory === null, `${at}: one recap, before the theory question`)
      recap = parseBlocks(part.lines, at)
      assert.ok(recap.length > 0, `${at}: an empty recap`)
    } else if (part.heading === 'Theory practice') {
      assert.ok(recap !== null && theory === null, `${at}: one theory question, after the recap`)
      const body = part.lines.slice()
      while (body.length && !body[body.length - 1].trim()) body.pop()
      const nudge = /^> \*\*Practise this topic →\*\* \[\[NUDGE:(\d+)\]\]$/.exec(body.pop() ?? '')
      assert.ok(nudge && Number(nudge[1]) === number, `${at}: ends with this topic's practice link`)
      const start = body.findIndex(line => line.trim())
      assert.ok(start >= 0 && body[start].startsWith('**Question:** '), `${at}: starts with "**Question:**"`)
      const labelAt = body.findIndex(line => ANSWER_LABELS.some(label => line === label || line.startsWith(`${label} `)))
      assert.ok(labelAt > start, `${at}: an answer label follows the question`)
      const label = ANSWER_LABELS.find(candidate => body[labelAt] === candidate || body[labelAt].startsWith(`${candidate} `))
      const questionLines = [body[start].slice('**Question:** '.length), ...body.slice(start + 1, labelAt)]
      const answerLines = [...(body[labelAt] === label ? [] : [body[labelAt].slice(label.length + 1)]), ...body.slice(labelAt + 1)]
      theory = { question: parseBlocks(questionLines, `${at} question`), answerLabel: label,
        answerInline: body[labelAt] !== label, answer: parseBlocks(answerLines, `${at} answer`), nudge: Number(nudge[1]) }
      assert.ok(theory.question.length > 0 && theory.answer.length > 0, `${at}: a question and an answer`)
    } else assert.fail(`${at}: unexpected section`)
  }
  assert.ok(lessons.length > 0 && recap !== null && theory !== null, `${where}: lessons, a recap and a theory question`)
  return { number, title: plainInline(title), mustKnow, ...(introMore.length ? { introMore } : {}), lessons, recap, theory }
}

/** Write a parsed topic back out, for the round-trip test. Blank lines are not kept. */
function topicToMarkdown(topic) {
  const lines = [`## Topic ${topic.number}: ${topic.title}`, `**What you must know:** ${inlineToMarkdown(topic.mustKnow)}`,
    ...(topic.introMore ? blocksToMarkdown(topic.introMore) : [])]
  for (const lesson of topic.lessons) {
    lines.push(`### Lesson ${lesson.number}: ${lesson.title}`, '**Must know**', ...blocksToMarkdown(lesson.mustKnow))
    if (lesson.explainMore) lines.push('**Explain more**', ...blocksToMarkdown(lesson.explainMore))
  }
  lines.push('### One-minute recap', ...blocksToMarkdown(topic.recap), '### Theory practice')
  const question = blocksToMarkdown(topic.theory.question)
  lines.push(`**Question:** ${question[0]}`, ...question.slice(1))
  const answer = blocksToMarkdown(topic.theory.answer)
  if (topic.theory.answerInline) lines.push(`${topic.theory.answerLabel} ${answer[0]}`, ...answer.slice(1))
  else lines.push(topic.theory.answerLabel, ...answer)
  lines.push(`> **Practise this topic →** [[NUDGE:${topic.theory.nudge}]]`)
  return lines
}

/** T0.md: the cover lines, the outline table, the outcomes, how students are assessed and how to use the guide. */
function parseCover(source, where) {
  assert.ok(!source.includes('\r'), `${where}: carriage returns are not allowed`)
  const lines = source.replace(/\n+$/, '').split('\n')
  const heads = lines.map((line, index) => [line, index]).filter(([line]) => line.startsWith('## '))
  assert.deepEqual(heads.map(([line]) => line),
    ['## Course outline', '## Course outcomes', '## How you are assessed', '## How to use this guide'], `${where}: the four sections`)
  const between = (from, to) => lines.slice(heads[from][1] + 1, to === undefined ? undefined : heads[to][1])
  const cover = lines.slice(0, heads[0][1]).filter(line => line.trim())
  assert.ok(/^# .+ Study Guide by CampusIntell$/.test(cover[0]), `${where}: the title line`)
  const outline = parseBlocks(between(0, 1), `${where} outline`)
  assert.ok(outline.length === 1 && outline[0].type === 'table', `${where}: the outline is one table`)
  const outcomes = parseBlocks(between(1, 2), `${where} outcomes`)
  assert.ok(outcomes.length === 2 && outcomes[0].type === 'paragraph' && outcomes[1].type === 'list' && outcomes[1].ordered,
    `${where}: an outcomes line and a numbered list`)
  const assessed = parseBlocks(between(2, 3), `${where} assessed`)
  assert.ok(assessed.length === 1 && assessed[0].type === 'list' && !assessed[0].ordered, `${where}: assessment is a list`)
  const howTo = parseBlocks(between(3), `${where} how to use`)
  assert.ok(howTo.length === 1 && howTo[0].type === 'list', `${where}: how to use is a list`)
  for (const list of [outcomes[1], assessed[0], howTo[0]]) {
    assert.ok(list.items.every(item => !item.blocks), `${where}: flat lists only`)
  }
  return { cover, outline: outline[0], outcomesIntro: outcomes[0].text, outcomes: outcomes[1].items.map(item => item.text),
    assessment: assessed[0].items.map(item => item.text), howToUse: howTo[0].items.map(item => item.text) }
}

function coverToMarkdown(cover) {
  return [...cover.cover, '## Course outline', ...blocksToMarkdown([cover.outline]), '## Course outcomes',
    inlineToMarkdown(cover.outcomesIntro), ...cover.outcomes.map((text, index) => `${index + 1}. ${inlineToMarkdown(text)}`),
    '## How you are assessed', ...cover.assessment.map(text => `- ${inlineToMarkdown(text)}`),
    '## How to use this guide', ...cover.howToUse.map(text => `- ${inlineToMarkdown(text)}`)]
}

/** Source lines as the round trip compares them: no blank lines, no trailing spaces, escapes resolved, two spaces
 *  per list level. */
function normalizedSource(source) {
  const out = []
  let indents = []
  let fenced = false
  for (const raw of source.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (line.trim().startsWith('```')) { fenced = !fenced; out.push('```'); continue }
    if (fenced) { out.push(raw); continue }
    if (!line.trim()) continue
    const indent = indentOf(line)
    let text = line.trim()
    if (text.startsWith('|')) {
      // Cells are compared trimmed and separators as ---, like the writer.
      const cells = tableCells(text, 'normalise')
      text = cells.every(cell => /^:?-{3,}:?$/.test(cell)) ? `| ${cells.map(() => '---').join(' | ')} |`
        : `| ${cells.map(cell => cell.replace(/\\([\\*_`[\]#>\-+.!()])/g, '$1')).join(' | ')} |`
      out.push(text); continue
    }
    text = text.replace(/\\([\\*_|`[\]#>\-+.!()])/g, '$1')
    while (indents.length && indents[indents.length - 1] > indent) indents.pop()
    if (indent > 0 && (indents.length === 0 || indents[indents.length - 1] < indent)) indents.push(indent)
    const depth = indent === 0 ? 0 : indents.length
    if (indent === 0) indents = []
    out.push('  '.repeat(depth) + text)
  }
  return out
}

/** The same normalisation for written-out lines (escapes are not written, list levels are already two spaces). */
const normalizedWritten = lines => lines.map(line => line.replace(/\s+$/, ''))

module.exports = { ANSWER_LABELS, blocksToMarkdown, blocksToPlain, coverToMarkdown, inlineToMarkdown, normalizedSource,
  normalizedWritten, parseBlocks, parseCover, parseInline, parseTopic, plainInline, topicToMarkdown }
