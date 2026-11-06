// app/payment-terms/page.test.cjs — The Payment terms page renders the approved text: the price table, the plans line,
// every section, and each "message us" as the app's message-us link (WhatsApp when configured, else Help & Support).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

async function render(number) {
  return withTsx(async () => {
    const original = Module._load
    try {
      Module._load = function(name, ...args) {
        if (name === 'next/link') return { __esModule: true, default: ({ href, prefetch, ...props }) =>
          React.createElement('a', { href, ...props }) }
        if (name === '@/lib/whatsapp') return { whatsAppChatUrl: () => number ? `https://wa.me/${number}` : null }
        return original.call(this, name, ...args)
      }
      return renderToStaticMarkup(require('./page.tsx').default())
    } finally { Module._load = original }
  })
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

test('the price table and the plans line come first', async () => {
  const html = await render(null)
  const words = text(html)
  assert.match(words, /Payment terms Semester Session \(both semesters\) Standard ₦4,000 ₦7,000 Plus ₦6,000 ₦11,000 Both plans include/)
  assert.match(html, /<th scope="col"[^>]*>Semester<\/th>/)
  assert.match(html, /<th scope="row"[^>]*>Plus<\/th>/)
  assert.match(words, /Plus gives you twice as much Campus Bot\. GST courses are always free\./)
})

test('every section in order, ending with Changes; no older wording', async () => {
  const words = text(await render(null))
  const order = ['Paying', 'When your plan starts', 'How long it lasts', 'Your courses', 'Campus Bot has a 5-hour limit',
    'Your account', 'Refunds', 'Wrong amount', 'Changes'].map(heading => words.indexOf(heading))
  assert.ok(order.every((position, index) => position > 0 && (index === 0 || position > order[index - 1])), JSON.stringify(order))
  assert.match(words, /Paid too much\? Your plan starts and we refund the extra\. Paid too little\? It’s refunded in full\./)
  assert.match(words, /A plan you’ve already paid for keeps its price and end date\.$/)
  assert.doesNotMatch(words, /5–7 working days|Our mistakes|PENDING|Help & Support$/)
})

test('each "message us" is the message-us link: WhatsApp when configured, otherwise Help & Support', async () => {
  const chat = await render('2348000000000')
  assert.equal((chat.match(/<a href="https:\/\/wa\.me\/2348000000000" target="_blank" rel="noopener noreferrer"[^>]*>message us<\/a>/g) || []).length, 3)
  const fallback = await render(null)
  assert.equal((fallback.match(/<a href="\/contact"[^>]*>message us<\/a>/g) || []).length, 3)
})
