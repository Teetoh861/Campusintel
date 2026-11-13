// scripts/managed-content/official-banks.test.cjs — The official bank source, conversion and import plans.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const { buildManifest } = require('./source-manifest.cjs')
const { convertQuestion, loadBanks, loadIdentityMap, planImport } = require('./official-banks.cjs')

const SOURCE = path.join(__dirname, 'official-banks/source')
const banks = loadBanks()

test('every committed bank matches MANIFEST.csv: 27 courses, 20,988 questions', () => {
  assert.equal(banks.size, 27)
  assert.equal([...banks.values()].reduce((sum, bank) => sum + bank.questions.length, 0), 20988)
})

test('conversion changes no text: options keep their order and the answer letter becomes its index', () => {
  for (const bank of banks.values()) {
    const raw = JSON.parse(fs.readFileSync(path.join(SOURCE, bank.file), 'utf8'))
    raw.questions.forEach((question, index) => {
      const { payload } = bank.questions[index]
      const letters = Object.keys(question.options)
      assert.deepEqual(payload, {
        prompt: question.question, options: letters.map(letter => question.options[letter]),
        correctOption: letters.indexOf(question.answer), section: question.topic, explanation: question.explanation,
      })
    })
  }
})

test('a question with an unknown answer letter or out-of-order options is refused', () => {
  const question = { question: 'Q', options: { a: 'One', b: 'Two' }, answer: 'b', topic: 'T', explanation: 'E' }
  assert.equal(convertQuestion(question, 'ok').correctOption, 1)
  assert.throws(() => convertQuestion({ ...question, answer: 'c' }, 'bad'), /answer letter/)
  assert.throws(() => convertQuestion({ ...question, options: { b: 'Two', a: 'One' } }, 'bad'), /lettered/)
  assert.throws(() => convertQuestion({ ...question, explanation: ' ' }, 'bad'), /explanation/)
})

test('a bank that differs from MANIFEST.csv by one byte is refused before use', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'official-banks-'))
  try {
    fs.cpSync(SOURCE, copy, { recursive: true })
    const file = path.join(copy, banks.get('ENT211').file)
    const bytes = fs.readFileSync(file)
    bytes[bytes.length - 2] ^= 1
    fs.writeFileSync(file, bytes)
    assert.throws(() => loadBanks(copy), /SHA-256 differs/)
  } finally {
    fs.rmSync(copy, { recursive: true, force: true })
  }
})

test('the identity map keeps only the approved answer-key changes', () => {
  const rows = loadIdentityMap()
  assert.equal(rows.length, 227)
  assert.deepEqual(rows.filter(row => row.change.includes('answer-key')).map(row => `${row.course}:${row.bank_id}`).sort(),
    ['BUA204:PQ-238', 'BUA204:PQ-269', 'BUA205:PQ-043'])
  assert.throws(() => loadIdentityMap(undefined, ['BUA204:PQ-269', 'BUA204:PQ-238']), /BUA205 PQ-043: answer-key change/)
})

test('planning batch 1 reproduces the audited counts for every course', () => {
  const manifest = buildManifest()
  const identity = loadIdentityMap()
  const audited = {
    'ACC-CM201': ['financial-accounting-1', { published: 150, kept: 1, retired: 149, added: 502, bank: 503 }],
    BUA201: ['principles-business-administration', { published: 390, kept: 1, retired: 389, added: 634, bank: 635 }],
    BUA205: ['leadership-governance', { published: 210, kept: 141, retired: 69, added: 547, bank: 688 }],
    ENT211: ['entrepreneurship-innovation', { published: 50, kept: 0, retired: 50, added: 620, bank: 620 }],
  }
  for (const [code, [contentKey, expected]] of Object.entries(audited)) {
    const plan = planImport({ code, contentKey, migration: 'x', expected }, manifest, banks, identity)
    assert.deepEqual(plan.counts, expected, code)
    assert.equal(new Set([...plan.keep.map(row => row.itemId), ...plan.add.map(row => row.itemId)]).size, expected.bank)
    assert.ok(plan.add.every(row => row.sourceKey.startsWith(`bank:${code}:`)), code)
    assert.throws(() => planImport({ code, contentKey, migration: 'x', expected: { ...expected, retired: 0 } },
      manifest, banks, identity), /counts differ from the audit/)
  }
})

test('the ordering rule: only writes of CBT questions must precede the banks, not reads that filter on them', () => {
  const { writesCbtQuestions } = require('./official-banks.cjs')
  assert.equal(writesCbtQuestions("update public.managed_content_items set published_revision = 2 where kind = 'cbt_question';"), true)
  assert.equal(writesCbtQuestions("insert into public.managed_content_items (kind) values ('cbt_question');"), true)
  assert.equal(writesCbtQuestions("select * from public.managed_content_items i where i.kind <> 'cbt_question' order by i.id;"), false)
  assert.equal(writesCbtQuestions("update public.managed_content_items set position = 1 where kind = 'note';"), false)
  // Every bank migration is a CBT writer, and so is no migration that sorts after the first bank.
  const directory = require('node:path').join(__dirname, '../../supabase/migrations')
  const names = require('node:fs').readdirSync(directory).sort()
  const firstBank = names.find(name => /_official_bank_(?!rows)/.test(name))
  const later = names.filter(name => name > firstBank && !/_official_bank_/.test(name))
  assert.ok(later.includes('20261110090000_course_overview_revisions.sql') && later.includes('20261112110000_study_guide_notes.sql'))
  for (const name of later) {
    assert.equal(writesCbtQuestions(require('node:fs').readFileSync(require('node:path').join(directory, name), 'utf8')), false, name)
  }
})
