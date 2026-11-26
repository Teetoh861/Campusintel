// lib/landing/faq.test.cjs — The landing FAQ's dated answer: the answer an item gives at an instant (faq.ts), and that
// instant (content.ts), which must be the database's end of free access: the page is built once and reads no database.
// Run with lib/auth/test-loader.cjs preloaded.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { faqAnswer } = require('./faq.ts')
const { FREE_ACCESS_ENDS_AT, FREE_ACCESS_LAST_DAY, landingContent } = require('./content.ts')
const { formatFreeMonthDay } = require('../entitlements/presentation.ts')

const MIGRATIONS = path.join(__dirname, '../../supabase/migrations')
// The end of 30 December 2026 in Lagos (2026-12-31 00:00:00+01), an exclusive end.
const END = Date.parse('2026-12-30T23:00:00Z')
const FREE_ACCESS = 'Yes. GST courses are always free, and until 30 December you can get free access to all your courses.'
const FREE_PASS = 'Yes. GST courses are free, and a free pass lets you try your department courses.'
const tryIt = () => landingContent.faq.items.find(item => item.question === 'Can I try it before paying?')

test('an item gives its later answer from the instant on, and its first answer until then', () => {
  const item = { question: 'Can I try it?', answer: 'first', later: { from: '2026-12-30T23:00:00.000Z', answer: 'later' } }
  assert.equal(faqAnswer(item, END - 1), 'first', 'just before')
  assert.equal(faqAnswer(item, END), 'later', 'exactly at')
  assert.equal(faqAnswer(item, END + 1), 'later', 'just after')
  assert.equal(faqAnswer(item, Date.parse('2027-03-01T08:00:00Z')), 'later', 'months after')
  // The instant is compared as an instant, whatever offset it is written with.
  const lagos = { ...item, later: { ...item.later, from: '2026-12-31T00:00:00+01:00' } }
  assert.deepEqual([faqAnswer(lagos, END - 1), faqAnswer(lagos, END)], ['first', 'later'])
  // An item with no later answer gives the same answer at any time.
  for (const now of [0, END - 1, END, END + 1]) assert.equal(faqAnswer({ question: 'q', answer: 'always' }, now), 'always')
})

test('the answer on trying it offers free access until the end of 30 December, then the free pass', () => {
  const item = tryIt()
  assert.ok(item)
  assert.equal(faqAnswer(item, Date.parse('2026-12-01T08:00:00Z')), FREE_ACCESS, 'after a launch on 1 December')
  assert.equal(faqAnswer(item, END - 1), FREE_ACCESS, 'just before the end')
  assert.equal(faqAnswer(item, END), FREE_PASS, 'at the end')
  assert.equal(faqAnswer(item, END + 1), FREE_PASS, 'after it')
  // It is the only answer that changes on a date.
  assert.deepEqual(landingContent.faq.items.filter(entry => entry.later !== undefined), [item])
})

/** A Postgres timestamptz literal ('2026-12-31 00:00:00+01') as an ISO time that Date.parse reads. */
function isoTime(literal) {
  const parts = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/.exec(literal)
  assert.ok(parts, `a timestamptz literal: ${literal}`)
  return `${parts[1]}T${parts[2]}${parts[3]}:${parts[4] ?? '00'}`
}

test('the landing ends free access at the instant the database does, and names the day the app prints for it', () => {
  // Every end the migrations write into the policy row or check it against (early_access_claim_cutoff, the instant the
  // claim closes and every claim ends); the newest migration's is the one in force.
  const ends = fs.readdirSync(MIGRATIONS).filter(file => file.endsWith('.sql')).sort().flatMap(file =>
    [...fs.readFileSync(path.join(MIGRATIONS, file), 'utf8')
      .matchAll(/early_access_claim_cutoff(?: = timestamptz| timestamptz not null default) '([^']+)'/g)]
      .map(found => ({ file, value: found[1] })))
  const newest = ends.at(-1).file
  const values = [...new Set(ends.filter(end => end.file === newest).map(end => end.value))]
  assert.equal(values.length, 1, `${newest} gives one end`)
  assert.equal(Date.parse(FREE_ACCESS_ENDS_AT), Date.parse(isoTime(values[0])), `${newest}: ${values[0]}`)
  assert.equal(values[0], '2026-12-31 00:00:00+01', newest)
  assert.equal(Date.parse(FREE_ACCESS_ENDS_AT), END)
  // The last day the student screens print for that end is the day the landing names.
  assert.equal(formatFreeMonthDay(FREE_ACCESS_ENDS_AT), FREE_ACCESS_LAST_DAY)
  assert.equal(FREE_ACCESS_LAST_DAY, '30 December')
  assert.equal(tryIt().later.from, FREE_ACCESS_ENDS_AT)
})
