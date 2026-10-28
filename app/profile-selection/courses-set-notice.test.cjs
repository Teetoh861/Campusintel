// app/profile-selection/courses-set-notice.test.cjs — The locked message and its one action: WhatsApp with a generic
// message when a number is configured (D10), otherwise Help & Support. No personal data is ever in the link.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

async function render(number) {
  return withTsx(async () => {
    const original = Module._load
    const saved = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER
    try {
      if (number === undefined) delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER
      else process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = number
      Module._load = function(name, ...args) {
        if (name === 'next/link') return { __esModule: true, default: props => React.createElement('a',
          { href: props.href, 'data-internal': '' }, props.children) }
        return original.call(this, name, ...args)
      }
      for (const key of Object.keys(require.cache)) if (/lib[/\\]whatsapp\.ts$|CoursesSetNotice\.tsx$/.test(key)) delete require.cache[key]
      const { CoursesSetNotice } = require('./CoursesSetNotice.tsx')
      return renderToStaticMarkup(React.createElement(CoursesSetNotice))
    } finally {
      Module._load = original
      if (saved === undefined) delete process.env.NEXT_PUBLIC_WHATSAPP_NUMBER; else process.env.NEXT_PUBLIC_WHATSAPP_NUMBER = saved
    }
  })
}

test('the locked copy is exactly as approved', async () => {
  const html = await render('2349018750976')
  assert.match(html, /Your courses are set for this semester\. Need a change\?/)
  assert.match(html, />Message us</)
  assert.match(html, /role="status"/)
})

test('with a configured number, Message us opens WhatsApp with the generic message only', async () => {
  const html = await render('2349018750976')
  const href = /href="([^"]+)"/.exec(html)[1].replace(/&amp;/g, '&')
  const url = new URL(href)
  assert.equal(url.origin + url.pathname, 'https://wa.me/2349018750976')
  assert.equal(url.searchParams.get('text'), 'Hello CampusIntell, I need a change to my courses for this semester.')
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="noopener noreferrer"/)
  assert.doesNotMatch(href, /@|uuid|student|department|level/i)
})

test('without a usable number, Message us goes to Help & Support instead of an inert link', async () => {
  for (const number of [undefined, '', '+234 901 875 0976', 'abc']) {
    const html = await render(number)
    assert.match(html, /<a href="\/contact" data-internal="">Message us<\/a>/, String(number))
    assert.doesNotMatch(html, /wa\.me/)
  }
})
