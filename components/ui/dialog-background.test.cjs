// components/ui/dialog-background.test.cjs — Every shared dialog surface (Dialog, AlertDialog, Sheet, Drawer) renders on a
// solid background from the design tokens by default, so no window can show the page through it. The shadcn
// `bg-background` utility resolved to an undefined token (hsl(var(--background))) and rendered transparent.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const ROOT = path.join(__dirname, '..', '..')

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

/** The custom properties defined on the top-level :root of the stylesheets the root layout loads (where portals live). */
function rootTokens() {
  const layout = fs.readFileSync(path.join(ROOT, 'app/layout.tsx'), 'utf8')
  const loaded = [...layout.matchAll(/^import '([^']+\.css)'/gm)]
    .map(m => fs.readFileSync(path.join(ROOT, 'app', m[1]), 'utf8')).join('\n')
  const tokens = new Map()
  for (const block of loaded.matchAll(/^:root\s*\{([\s\S]*?)\n\}/gm)) {
    for (const m of block[1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) tokens.set(m[1], m[2].trim())
  }
  return tokens
}

/** Tailwind colour utilities for the student and ci palettes, as `bg-<name>` → CSS value. */
function backgroundUtilities() {
  const config = fs.readFileSync(path.join(ROOT, 'tailwind.config.ts'), 'utf8')
  const utilities = new Map()
  for (const palette of ['ci', 'student']) {
    const block = new RegExp(`\\n\\s{8}${palette}: \\{([\\s\\S]*?)\\n\\s{8}\\}`).exec(config)
    assert.ok(block, `the ${palette} palette is in the Tailwind config`)
    for (const m of block[1].matchAll(/'?([\w-]+)'?: '([^']+)'/g)) utilities.set(`bg-${palette}-${m[1]}`, m[2])
  }
  return utilities
}

/** Follows var() through the loaded tokens to a literal colour; throws on an undefined token. */
function resolve(value, tokens, seen = []) {
  const ref = /^var\((--[\w-]+)\)$/.exec(value)
  if (!ref) return value
  assert.ok(tokens.has(ref[1]), `${ref[1]} is defined on :root in a loaded stylesheet (${[...seen, ref[1]].join(' → ')})`)
  return resolve(tokens.get(ref[1]), tokens, [...seen, ref[1]])
}

/** Fails unless the dialog element's background utility resolves to an opaque colour. */
function assertSolidBackground(html, label) {
  const element = /<div[^>]*role="(?:alert)?dialog"[^>]*class="([^"]*)"|<div[^>]*class="([^"]*)"[^>]*role="(?:alert)?dialog"/.exec(html)
  assert.ok(element, `${label}: a dialog element is rendered`)
  const classes = (element[1] ?? element[2]).split(/\s+/)
  const backgrounds = classes.filter(name => /^bg-/.test(name))
  assert.equal(backgrounds.length, 1, `${label}: exactly one background utility (${backgrounds.join(', ') || 'none'})`)
  assert.notEqual(backgrounds[0], 'bg-background', `${label}: not the undefined shadcn token`)
  const utility = backgroundUtilities().get(backgrounds[0])
  assert.ok(utility, `${label}: ${backgrounds[0]} is a design-token colour`)
  const colour = resolve(utility, rootTokens()).toLowerCase()
  assert.ok(!/transparent|rgba|hsla|\/\s*0?\.\d|^#[0-9a-f]{8}$/.test(colour), `${label}: ${backgrounds[0]} is opaque (${colour})`)
  return classes
}

const h = React.createElement

test('the shared Dialog, AlertDialog, Sheet and Drawer render on a solid token background by default', async () => withInlinePortal(async () => {
  const { Dialog, DialogContent, DialogTitle, DialogDescription } = require('./dialog.tsx')
  const { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } = require('./alert-dialog.tsx')
  const { Sheet, SheetContent, SheetTitle, SheetDescription } = require('./sheet.tsx')
  const body = (Title, Description) => [h(Title, { key: 't' }, 'Title'), h(Description, { key: 'd' }, 'Body')]
  assertSolidBackground(renderToStaticMarkup(h(Dialog, { open: true }, h(DialogContent, null, ...body(DialogTitle, DialogDescription)))), 'Dialog')
  assertSolidBackground(renderToStaticMarkup(h(AlertDialog, { open: true },
    h(AlertDialogContent, null, ...body(AlertDialogTitle, AlertDialogDescription)))), 'AlertDialog')
  for (const side of ['top', 'right', 'bottom', 'left']) {
    assertSolidBackground(renderToStaticMarkup(h(Sheet, { open: true }, h(SheetContent, { side }, ...body(SheetTitle, SheetDescription)))),
      `Sheet (${side})`)
  }
}))

test('the Drawer content default is the same solid token background', () => {
  const source = fs.readFileSync(path.join(__dirname, 'drawer.tsx'), 'utf8')
  const content = /const DrawerContent[\s\S]*?className=\{cn\(\s*'([^']*)'/.exec(source)
  assert.ok(content, 'DrawerContent has a default class list')
  const backgrounds = content[1].split(/\s+/).filter(name => /^bg-/.test(name))
  assert.deepEqual(backgrounds, ['bg-student-surface'])
  assert.ok(backgroundUtilities().has('bg-student-surface'))
})

test('the plan windows keep the solid background and the practice dialogs keep their own styling', async () => withInlinePortal(async () => {
  const { Dialog, DialogContent, DialogTitle, DialogDescription } = require('./dialog.tsx')
  const { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } = require('./alert-dialog.tsx')
  const plan = assertSolidBackground(renderToStaticMarkup(h(Dialog, { open: true }, h(DialogContent, { className: 'student-plan-dialog' },
    h(DialogTitle, null, 'Free pass'), h(DialogDescription, null, 'Body')))), 'plan dialog (free pass, Semester → Session)')
  assert.ok(plan.includes('student-plan-dialog'))
  const practice = assertSolidBackground(renderToStaticMarkup(h(Dialog, { open: true },
    h(DialogContent, { className: 'student-practice-dialog z-[70] motion-reduce:!animate-none' },
      h(DialogTitle, null, 'Report'), h(DialogDescription, null, 'Body')))), 'practice report dialog')
  assert.ok(practice.includes('student-practice-dialog'))
  const confirm = assertSolidBackground(renderToStaticMarkup(h(AlertDialog, { open: true },
    h(AlertDialogContent, { className: 'student-practice-dialog z-[70] motion-reduce:!animate-none' },
      h(AlertDialogTitle, null, 'Submit'), h(AlertDialogDescription, null, 'Body')))), 'practice confirmation')
  assert.ok(confirm.includes('student-practice-dialog'))
  const css = fs.readFileSync(path.join(ROOT, 'styles/student-app.css'), 'utf8')
  assert.match(css, /\.student-practice-dialog \{[^}]*background: var\(--student-surface\);/, 'the practice dialog keeps its own surface')
  assert.doesNotMatch(/\.student-plan-dialog \{[^}]*\}/.exec(css)[0], /background/, 'the plan dialog does not override the shared background')
}))
