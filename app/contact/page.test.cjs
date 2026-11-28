const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const titles = ['Report a wrong question or answer', "Something isn't working", 'Ask about my subscription']
const selection = {
  department: { id: 'department', label: 'Business Administration', isActive: true },
  academicLevel: { id: 'level', label: '200 Level', isActive: true },
  academicPeriod: { id: 'semester', label: 'First Semester', isActive: true },
}

async function render(profile, number = '2348000000000') {
  return withTsx(async () => {
    const load = Module._load
    try {
      Module._load = function(name, ...args) {
        if (name === '@/lib/profile/student-profile') return { getCurrentStudentProfile: async () => profile }
        if (name === '@/lib/whatsapp') return { whatsAppChatUrl: message => number
          ? `https://wa.me/${number}?text=${encodeURIComponent(message)}` : null }
        return load.call(this, name, ...args)
      }
      return renderToStaticMarkup(await require('./page.tsx').default())
    } finally { Module._load = load }
  })
}

const links = html => [...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)]
  .map(match => new URL(match[1].replaceAll('&amp;', '&').replaceAll('&#x27;', "'")))

test('public support has three reasons, each with the existing WhatsApp number and email prefilled', async () => {
  const html = await render({ status: 'signed-out' })
  assert.match(html, /<h1[^>]*>Contact &amp; Support<\/h1>/)
  assert.doesNotMatch(html, /Your courses are set from|Request a change|your-courses|200 Level/)
  assert.equal((html.match(/<h2\b/g) || []).length, 3)
  const urls = links(html)
  assert.equal(urls.length, 6)
  for (const [index, title] of titles.entries()) {
    const [whatsapp, email] = urls.slice(index * 2, index * 2 + 2)
    assert.equal(whatsapp.origin + whatsapp.pathname, 'https://wa.me/2348000000000')
    assert.ok(whatsapp.searchParams.get('text').startsWith('Hello CampusIntell,'))
    assert.equal(email.pathname, 'hello@campusintell.com')
    assert.equal(email.searchParams.get('subject'), title)
    assert.equal(email.searchParams.get('body'), whatsapp.searchParams.get('text'))
  }
  assert.equal(new Set(urls.filter(url => url.protocol === 'mailto:').map(url => url.searchParams.get('body'))).size, 3)
})

test('selection change shows and prefills only this student’s verified academic details', async () => {
  const own = { ...selection, department: { ...selection.department, label: 'Finance & Banking' } }
  const html = await render({ status: 'complete', firstName: 'Adaeze', selection: own })
  assert.match(html, /id="your-courses"/)
  assert.match(html, /Your courses are set from/)
  assert.match(html, /Finance &amp; Banking/)
  assert.match(html, /Request a change/)
  const [whatsapp, email] = links(html)
  const message = whatsapp.searchParams.get('text')
  assert.ok(message.includes('Finance & Banking · 200 Level · First Semester'))
  assert.equal(email.searchParams.get('body'), message)
  assert.equal(email.searchParams.get('subject'), 'Request a change to my courses')
  assert.doesNotMatch(message, /Adaeze|department_id|session|student@/)
})

test('unknown or unsaved selections stay neutral, and a saved selection without a name is still shown', async () => {
  for (const status of ['incomplete', 'unavailable', 'missing-profile', 'session-changed']) {
    assert.doesNotMatch(await render({ status }), /Your courses are set from|your-courses|200 Level/)
  }
  assert.match(await render({ status: 'incomplete', selection }), /Your courses are set from/)
  const html = await render({ status: 'signed-out' }, null)
  assert.doesNotMatch(html, /wa\.me/)
  assert.equal(links(html).length, 3, 'email remains available when WhatsApp is not configured')
})
