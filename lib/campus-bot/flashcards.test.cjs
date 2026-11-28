// lib/campus-bot/flashcards.test.cjs — Make flashcards (owner decision B5): every guard on the model's cards is
// deterministic. Plain text only, within length, a meaning that says something, no repeated term, and a term the notes
// sent with the request contain; at most 10 cards in order, and fewer than 4 left is no set.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { notesWords, readFlashcards, termInNotes } = require('./flashcards.ts')
const { notesContextFromTopic } = require('./notes-context.ts')

const notes = notesContextFromTopic('Introduction to Management', [
  { heading: 'Functions of management', body: 'Planning means deciding in advance what to do. Organising arranges people '
    + 'and resources. Fayol’s principles include unity of command and the scalar chain. Leading motivates staff, and '
    + 'controlling compares results with plans. Profit = Revenue - Cost.' },
  { heading: 'Levels of management', body: 'Top managers set strategy, middle managers turn it into plans, and '
    + 'supervisors direct the daily work of operatives. Span of control is the number of people one manager directs.' },
])
const card = (term, meaning = `What ${term} means in these notes.`) => ({ term, meaning })
const GOOD = ['Planning', 'Organising', 'Unity of command', 'Scalar chain', 'Span of control', 'Top managers',
  'Supervisors', 'Controlling', 'Leading', 'Middle managers', 'Profit = Revenue - Cost', 'Fayol’s principles']
const read = cards => readFlashcards({ cards }, notes)

test('8 grounded cards come back as they were written, in order, with no guard fired', () => {
  const cards = GOOD.slice(0, 8).map(term => card(term))
  assert.deepEqual(read(cards), { cards, guards: [], dropped: [] })
})

test('each field becomes plain text: emoji and bold markers go, whitespace is collapsed', () => {
  const result = read([card('**Planning** \u{1F4DD}', 'Deciding   in advance\nwhat to do. \u{2705}'),
    ...GOOD.slice(1, 4).map(term => card(term))])
  assert.deepEqual(result.cards[0], { term: 'Planning', meaning: 'Deciding in advance what to do.' })
  assert.deepEqual(result.guards.sort(), ['bold-removed', 'emoji-removed'])
  assert.deepEqual(result.dropped, [])
  // A formula keeps its symbols exactly as the notes give them.
  assert.equal(read(GOOD.slice(7, 11).map(term => card(term))).cards[3].term, 'Profit = Revenue - Cost')
})

test('a card with an empty side is dropped', () => {
  const result = read([card('Planning', '   '), card('\u{1F4DD}', 'An emoji alone is no term.'),
    ...GOOD.slice(1, 5).map(term => card(term))])
  assert.equal(result.cards.length, 4)
  assert.deepEqual(result.dropped.map(drop => [drop.term, drop.guard]), [['Planning', 'empty-side'], ['', 'empty-side']])
})

test('a term over 80 characters or a meaning over 200 is dropped; exactly 80 and 200 are kept', () => {
  const longTerm = `Planning ${'and organising '.repeat(6)}`.trim()
  assert.ok(longTerm.length > 80)
  const result = read([card(longTerm), card('Planning', 'm'.repeat(201)), card('Organising', 'm'.repeat(200)),
    ...GOOD.slice(2, 5).map(term => card(term))])
  assert.deepEqual(result.dropped.map(drop => drop.guard), ['too-long', 'too-long'])
  assert.equal(result.cards[0].meaning.length, 200)
  const exact = 'Planning organising leading controlling supervisors managers strategy plans work'
  assert.equal(exact.length, 80)
  assert.equal(read([card(exact), ...GOOD.slice(0, 3).map(term => card(term))]).cards[0].term, exact)
})

test('a meaning that only repeats the term is dropped, whatever its case or end punctuation', () => {
  const result = read([card('Planning', 'planning.'), card('Unity of command', 'Unity of Command'),
    ...GOOD.slice(4, 8).map(term => card(term))])
  assert.deepEqual(result.dropped.map(drop => drop.guard), ['meaning-repeats-term', 'meaning-repeats-term'])
  assert.equal(result.cards.length, 4)
})

test('a term already used is dropped, compared without case', () => {
  const result = read([card('Planning'), card('PLANNING', 'Another meaning of the same term.'), card('planning'),
    ...GOOD.slice(1, 4).map(term => card(term))])
  assert.deepEqual(result.cards.map(kept => kept.term), ['Planning', 'Organising', 'Unity of command', 'Scalar chain'])
  assert.deepEqual(result.dropped.map(drop => drop.guard), ['repeated-term', 'repeated-term'])
})

test('a term must name only what the notes sent contain: each word of 3 or more letters, any case or punctuation', () => {
  const words = notesWords(notes)
  assert.ok(termInNotes('unity of command', words), 'case is ignored, and "of" is too short to matter')
  assert.ok(termInNotes('Fayol’s principles', words), 'a possessive ’s is ignored')
  assert.ok(termInNotes("Fayol's principles", words), 'with either apostrophe')
  assert.ok(termInNotes('Fayol principles', words), 'and the notes’ possessive matches the bare name')
  assert.ok(termInNotes('Scalar chain (Fayol)', words), 'punctuation is ignored')
  assert.ok(termInNotes('Levels of management', words), 'a heading is part of the notes sent')
  assert.ok(termInNotes('Introduction to management', words), 'as is the topic title')
  assert.ok(termInNotes('Profit = Revenue - Cost', words), 'a formula from the notes')
  assert.equal(termInNotes('Management by objectives', words), false, 'objectives is not in these notes')
  assert.ok(termInNotes('Planned', words), 'simple endings (fix round A1): planned is planning')
  assert.equal(termInNotes('Budgeting', words), false, 'a word the notes never use')
  assert.equal(termInNotes('SWOT analysis', words), false)
  const result = read([card('Management by objectives'), card('SWOT analysis'), ...GOOD.slice(0, 4).map(term => card(term))])
  assert.deepEqual(result.dropped.map(drop => [drop.term, drop.guard]),
    [['Management by objectives', 'term-not-in-notes'], ['SWOT analysis', 'term-not-in-notes']])
  assert.equal(result.cards.length, 4)
})

test('a passage left off to fit the prompt does not count: only the notes sent ground a term', () => {
  const first = { passages: notes.passages.slice(0, 1) }
  const cards = ['Planning', 'Organising', 'Leading', 'Span of control', 'Controlling'].map(term => card(term))
  const result = readFlashcards({ cards }, first)
  assert.deepEqual(result.dropped.map(drop => drop.term), ['Span of control'])
})

test('12 good cards: the first 10 are kept, in order', () => {
  const result = read(GOOD.map(term => card(term)))
  assert.deepEqual(result.cards.map(kept => kept.term), GOOD.slice(0, 10))
  assert.deepEqual(result.guards, ['over-ten-cards'])
  assert.deepEqual(result.dropped.map(drop => [drop.term, drop.guard]),
    [[GOOD[10], 'over-ten-cards'], [GOOD[11], 'over-ten-cards']])
})

test('dropped cards do not use up the 10: the next good card takes the place', () => {
  const result = read([card('SWOT analysis'), ...GOOD.slice(0, 11).map(term => card(term))])
  assert.equal(result.cards.length, 10)
  assert.equal(result.cards[0].term, 'Planning')
})

test('3 cards left after the guards is no set: nothing to show, so the reply fails and is not charged', () => {
  const result = read([...GOOD.slice(0, 3).map(term => card(term)), card('SWOT analysis'), card('Planning')])
  assert.deepEqual(result.cards, [])
  assert.ok(result.guards.includes('too-few-cards'))
  assert.equal(read([]).cards.length, 0, 'the empty list the notes are too thin for')
  assert.equal(read(GOOD.slice(0, 4).map(term => card(term))).cards.length, 4, 'while 4 is a set')
})

test('an answer that is not a list of cards is no answer at all', () => {
  for (const json of [null, 'cards', [], {}, { cards: 'Planning' }, { cards: [{ term: 'Planning' }] },
    { cards: [{ term: 'Planning', meaning: 42 }] }, { cards: [null] }, { cards: ['Planning'] }]) {
    assert.equal(readFlashcards(json, notes), null, JSON.stringify(json))
  }
})

// Fix round A1: the owner's live review dropped five good cards as term-not-in-notes. The notes below are quoted from
// the published guides (GST 111 topics 1 and 3, ECO 101 topic 2).
const listening = notesContextFromTopic('Listening Skills', [{ heading: 'Strategies for effective listening',
  body: 'Seven strategies, in this order: Eye contact: maintaining eye contact with your lecturer is the beginning of '
    + 'effective listening. Concentrate on content; repress emotional attachment; avoid distractions.' }])
const stress = notesContextFromTopic('Speaking Skills II: The Syllable, Stress and Intonation', [{ heading: 'Predicting stress',
  body: 'Syntactic criterion: in noun-verb (and noun-adjective) pairs, the noun takes stress on the first syllable. '
    + 'Compound noun vs noun phrase: a compound noun is stressed on the first element; a noun phrase on the second.' }])
const methodology = notesContextFromTopic('Methodology of Economics', [{ heading: 'Hypotheses, theories and graphs',
  body: 'Scientific method: observation → hypothesis formulation → testing → theory development. The slope is the '
    + 'marginal rate of transformation (MRT) and measures the rise over the run.' }])

test('A1: the five cards the live review dropped now pass the notes check', () => {
  const cases = [[listening, 'Eye contact (first listening strategy)'], [stress, 'Noun-verb stress pattern'],
    [stress, 'Compound noun versus noun phrase'], [methodology, 'Hypothesis versus theory'], [methodology, 'Slope formula']]
  for (const [topic, term] of cases) {
    assert.ok(termInNotes(term, notesWords(topic)), term)
    assert.equal(readFlashcards({ cards: [card(term), card('Concentrate on content'), card('Avoid distractions'),
      card('Eye contact'), card('Noun phrase'), card('Theory development')] }, topic).dropped
      .filter(drop => drop.term === term).length, 0, `${term} is kept`)
  }
})

test('A1: brackets, label words, simple endings and one missing word in three, but an invented term is still dropped', () => {
  const words = notesWords(listening)
  assert.ok(termInNotes('Listening strategies', words), 'strategy matches strategies, listening matches listening')
  assert.ok(termInNotes('Eye contact (anything at all)', words), 'words in brackets are not checked')
  assert.ok(termInNotes('Eye contact definition', words), 'a label word is not checked')
  assert.ok(termInNotes('Repress emotional reactions', words), 'three words may miss one')
  assert.equal(termInNotes('Emotional reactions', words), false, 'two words may miss none')
  assert.equal(termInNotes('Inflation targeting', words), false, 'a term the topic never mentions is dropped')
  assert.deepEqual(readFlashcards({ cards: [card('Inflation targeting'), card('Eye contact'), card('Concentrate on content'),
    card('Avoid distractions'), card('Repress emotional attachment')] }, listening).dropped.map(drop => [drop.term, drop.guard]),
    [['Inflation targeting', 'term-not-in-notes']])
})

test('A2: the live review’s 15 cards: the first 10 are kept', () => {
  const terms = ['Eye contact', 'Concentrate on content', 'Avoid distractions', 'Repress emotional attachment', 'Effective listening',
    'Seven strategies', 'Strategies for effective listening', 'Listening Skills', 'Your lecturer', 'Emotional attachment',
    'Maintaining eye contact', 'The beginning', 'Distractions', 'Content', 'Lecturer']
  const result = readFlashcards({ cards: terms.map(term => card(term)) }, listening)
  assert.deepEqual(result.cards.map(kept => kept.term), terms.slice(0, 10))
  assert.ok(result.guards.includes('over-ten-cards'))
})
