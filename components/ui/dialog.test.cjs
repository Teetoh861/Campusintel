// components/ui/dialog.test.cjs — The shared Dialog close control: a 44px target around the same 16px icon, name and semantics,
// a keyboard focus indicator backed by a token the loaded stylesheets actually define, and the one consumer whose first row
// sits under it (CommandDialog) reserving that column.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

/** Radix portals render nothing on the server; render their children inline so the content markup can be read. */
async function withInlinePortal(run) {
  const load = Module._load
  Module._load = function(name, ...args) {
    if (name === '@radix-ui/react-portal') {
      const Portal = ({ children }) => children
      return { Portal, Root: Portal }
    }
    return load.call(this, name, ...args)
  }
  try { return await withTsx(run) } finally { Module._load = load }
}

const closeButton = html => /<button type="button" class="([^"]*)"[^>]*>(<svg[^>]*class="([^"]*)"[^>]*>[\s\S]*?<\/svg>)<span class="sr-only">Close<\/span><\/button>/.exec(html)

// The focus-visible outline classes the close control carries, and the single token they resolve to.
const FOCUS_CLASSES = ['focus-visible:outline', 'focus-visible:outline-2', 'focus-visible:-outline-offset-2', 'focus-visible:outline-student-focus', 'focus-visible:opacity-100']
const FOCUS_TOKEN = '--student-focus'

test('the Dialog close control exposes a 44×44 target around a 16px icon with its name, focus outline and position intact', async () => withInlinePortal(async () => {
  const { Dialog, DialogContent, DialogTitle, DialogDescription } = require('./dialog.tsx')
  const html = renderToStaticMarkup(React.createElement(Dialog, { open: true },
    React.createElement(DialogContent, null,
      React.createElement(DialogTitle, null, 'Title'), React.createElement(DialogDescription, null, 'Body'))))
  const match = closeButton(html)
  assert.ok(match, 'one close button carries the sr-only name after the content')
  const classes = match[1].split(/\s+/)
  for (const expected of ['absolute', 'right-0.5', 'top-0.5', 'inline-flex', 'h-11', 'w-11', 'items-center', 'justify-center', 'hover:opacity-100', ...FOCUS_CLASSES]) {
    assert.ok(classes.includes(expected), `close button keeps ${expected}`)
  }
  for (const blind of ['focus:ring-ring', 'focus:ring-2', 'focus:ring-offset-2', 'focus:outline-none', 'ring-offset-background']) {
    assert.ok(!classes.includes(blind), `${blind} resolved to no loaded token and is gone`)
  }
  assert.ok(!classes.some(name => /^focus:/.test(name)), 'pointer focus is left to the browser; only keyboard focus-visible draws the outline')
  assert.ok(!classes.some(name => /^(h|w)-(4|5|6|8)$/.test(name)), 'the box is no longer the icon size')
  const icon = match[3].split(/\s+/)
  assert.ok(icon.includes('h-4') && icon.includes('w-4'), 'the X icon stays 16px')
  assert.match(match[2], /aria-hidden="true"/)
  assert.equal((html.match(/sr-only">Close</g) || []).length, 1, 'exactly one close control')
  assert.match(html, /role="dialog"[^>]*aria-describedby/, 'dialog semantics unchanged')
}))

test('the close focus outline resolves to a colour the root layout actually loads, unlike the shadcn ring tokens', () => {
  const root = path.join(__dirname, '..', '..')
  const layout = fs.readFileSync(path.join(root, 'app/layout.tsx'), 'utf8')
  const sheets = [...layout.matchAll(/^import '([^']+\.css)'/gm)].map(m => fs.readFileSync(path.join(root, 'app', m[1]), 'utf8'))
  assert.ok(sheets.length >= 2, 'the root layout imports its stylesheets')
  const loaded = sheets.join('\n')
  // Tailwind maps outline-student-focus to var(--student-focus); the token must be defined on :root in a loaded sheet.
  const config = fs.readFileSync(path.join(root, 'tailwind.config.ts'), 'utf8')
  assert.match(config, /focus: 'var\(--student-focus\)'/, 'the student.focus colour utility reads the shared token')
  // Several sheets open their own :root block; the token and the colour it aliases must share one of them.
  const rootBlocks = [...loaded.matchAll(/:root\s*\{([\s\S]*?)\n\}/g)].map(m => m[1])
  const owner = rootBlocks.find(block => new RegExp(`${FOCUS_TOKEN}: var\\(--ci-brand-blue\\)`).test(block))
  assert.ok(owner, `${FOCUS_TOKEN} is defined on :root for every portal, not only inside the Student surface`)
  assert.match(owner, /--ci-brand-blue: #1E75BC/, 'and it resolves to the approved brand blue')
  assert.ok(!/--ring:/.test(loaded) && !/--background:/.test(loaded), 'the shadcn ring/offset tokens are not loaded anywhere, which is why focus:ring-ring drew nothing')
  // The outline sits inside the 44px box: nothing for an overflow-clipping consumer to cut off.
  assert.ok(FOCUS_CLASSES.includes('focus-visible:-outline-offset-2'))
})

test('every DialogContent consumer inherits the same close control without overlays of its own', async () => withInlinePortal(async () => {
  const { Dialog } = require('./dialog.tsx')
  const { CommandDialog } = require('./command.tsx')
  const html = renderToStaticMarkup(React.createElement(CommandDialog, { open: true }, React.createElement('p', null, 'Palette')))
  const match = closeButton(html)
  assert.ok(match, 'CommandDialog renders the shared close control')
  assert.ok(match[1].split(/\s+/).includes('h-11'))
  for (const expected of FOCUS_CLASSES) assert.ok(match[1].split(/\s+/).includes(expected), `CommandDialog close keeps ${expected}`)
  assert.equal(Dialog.displayName, 'Dialog')
}))

// Tailwind's spacing scale for the classes the contract is written in.
const PX = { 'right-0.5': 2, 'w-11': 44, 'pr-12': 48 }

test('CommandDialog reserves the shared close target\'s column on its input row, and only inside the dialog', async () => withInlinePortal(async () => {
  const { Command, CommandDialog, CommandInput } = require('./command.tsx')
  const html = renderToStaticMarkup(React.createElement(CommandDialog, { open: true }, React.createElement(CommandInput, { placeholder: 'Search' })))
  const close = closeButton(html)
  assert.ok(close, 'the shared close control is present and unchanged')
  const closeClasses = close[1].split(/\s+/)
  for (const expected of ['absolute', 'right-0.5', 'top-0.5', 'h-11', 'w-11']) assert.ok(closeClasses.includes(expected), expected)
  assert.ok(close[3].split(/\s+/).includes('h-4'), 'the X stays 16px')
  assert.match(html, /role="dialog"[^>]*class="[^"]*\bp-0\b/, 'the content has no padding of its own, so only the row can reserve the space')
  const root = /<div[^>]*class="([^"]*)"[^>]*cmdk-root=""/.exec(html)
  assert.ok(root, 'the Command root inside the dialog')
  // Static markup escapes the ampersand in the arbitrary variant; the class is `[&_[cmdk-input-wrapper]]:pr-12`.
  assert.ok(root[1].split(/\s+/).includes('[&amp;_[cmdk-input-wrapper]]:pr-12'), 'the dialog composition pads the cmdk input wrapper on the right')
  const closeColumn = PX['right-0.5'] + PX['w-11']
  assert.ok(PX['pr-12'] >= closeColumn, `the reserved ${PX['pr-12']}px covers the ${closeColumn}px the close target spans from the right edge`)
  assert.match(html, /<div class="flex items-center border-b px-3" cmdk-input-wrapper=""><svg[\s\S]*?<\/svg><input class="flex h-11 w-full/,
    'the input wrapper and input keep their own classes; the reservation comes from the dialog scope')
  assert.doesNotMatch(renderToStaticMarkup(React.createElement(Command, null, React.createElement(CommandInput, { placeholder: 'Search' }))), /pr-12/,
    'a standalone Command input is not padded')
}))
