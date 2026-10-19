// Site-wide presentation contract: text actions have no decorative forward arrows.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const postcss = require('postcss')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const { withTsx } = require('../../lib/test/tsx-loader.cjs')

const root = path.resolve(__dirname, '../..')
const forwardIcon = name => /(?:Arrow|Chevron).*(?:Right|Forward)|(?:Right|Forward).*(?:Arrow|Chevron)|MoveRight/.test(name)
const forwardGlyph = /[→⇒➜⟶➡›»⮕⟹⟾➔➝➞➟➠➢➤➥❯〉⏩▶]|&(?:rarr|rightarrow|rsaquo|raquo);|&#(?:8594|8658|8250|187|x2192|x21d2|x203a|xbb);/iu
const submenuOwners = new Map([
  ['components/ui/context-menu.tsx', 'ContextMenuPrimitive.SubTrigger'],
  ['components/ui/dropdown-menu.tsx', 'DropdownMenuPrimitive.SubTrigger'],
  ['components/ui/menubar.tsx', 'MenubarPrimitive.SubTrigger'],
])

function files(directory) {
  return fs.readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const file = `${directory}/${entry.name}`
    return entry.isDirectory() ? files(file) : [file]
  })
}

function within(node, source, predicate) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && predicate(parent.openingElement.tagName.getText(source))) return true
    if (ts.isJsxSelfClosingElement(parent) && predicate(parent.tagName.getText(source))) return true
  }
  return false
}

test('every application surface keeps decorative forward icons, action glyphs and CSS indicators out of CTAs', () => {
  const failures = []
  for (const file of [...files('app'), ...files('components')].filter(file => /\.[jt]sx?$/.test(file) && !/\.test\./.test(file))) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const imports = new Map()
    function visit(node) {
      const report = message => failures.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${message}`)
      if (ts.isImportSpecifier(node)) {
        const name = (node.propertyName || node.name).text
        imports.set(node.name.text, name)
        if (forwardIcon(name) && !(submenuOwners.has(file) && name === 'ChevronRight')) report(`forward icon import ${name}`)
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source).split('.').at(-1)
        const name = imports.get(tag) || tag
        const submenuIndicator = name === 'ChevronRight' && within(node, source, owner => owner === submenuOwners.get(file))
        if (forwardIcon(name) && !submenuIndicator) report(`decorative forward icon ${name}`)
      }
      if ((ts.isJsxText(node) || ts.isStringLiteralLike(node)) && forwardGlyph.test(node.text) &&
          within(node, source, tag => /^(?:a|button|Link|Button)$|(?:Link|Button|Card|Action)$/.test(tag))) report('forward glyph in an action')
      if ((ts.isPropertyAssignment(node) || ts.isPropertySignature(node) || ts.isJsxAttribute(node)) && node.name?.getText(source) === 'withArrow') report('obsolete decorative-arrow option')
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  for (const file of [...files('styles'), ...files('app'), ...files('components')].filter(file => file.endsWith('.css'))) {
    postcss.parse(fs.readFileSync(path.join(root, file), 'utf8')).walkDecls(declaration => {
      if (!['content', 'background', 'background-image', 'mask', 'mask-image'].includes(declaration.prop)) return
      const value = declaration.value.replace(/\\([a-f\d]{1,6})\s?/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      if (forwardGlyph.test(value) || /(?:arrow|chevron)[-_]?(?:right|forward)|(?:right|forward)[-_]?(?:arrow|chevron)/i.test(value)) {
        failures.push(`${file}:${declaration.source.start.line}: CSS forward indicator`)
      }
    })
  }
  assert.deepEqual(failures, [], failures.join('\n'))
})

test('pagination and breadcrumbs use text while retaining their accessible navigation semantics', () => withTsx(() => {
  const { PaginationNext, PaginationPrevious } = require('../ui/pagination.tsx')
  const { BreadcrumbSeparator } = require('../ui/breadcrumb.tsx')
  const next = renderToStaticMarkup(React.createElement(PaginationNext, { href: '/courses?page=2' }))
  assert.match(next, /href="\/courses\?page=2"/)
  assert.match(next, /aria-label="Go to next page"/)
  assert.match(next, />Next<\/span>/)
  assert.doesNotMatch(next, /<svg\b/)
  const previous = renderToStaticMarkup(React.createElement(PaginationPrevious, { href: '/courses?page=1' }))
  assert.match(previous, /aria-label="Go to previous page"/)
  assert.match(previous, /lucide-chevron-left/)
  const separator = renderToStaticMarkup(React.createElement(BreadcrumbSeparator))
  assert.match(separator, /role="presentation" aria-hidden="true"/)
  assert.match(separator, />\/<\/li>/)
}))

test('carousel forward control has a visible label in both orientations; backward navigation keeps its icon', () => withTsx(() => {
  const { Carousel, CarouselNext, CarouselPrevious } = require('../ui/carousel.tsx')
  for (const orientation of ['horizontal', 'vertical']) {
    const html = renderToStaticMarkup(React.createElement(Carousel, { orientation },
      React.createElement(CarouselPrevious), React.createElement(CarouselNext)))
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(match => match[0])
    assert.equal(buttons.length, 2)
    assert.match(buttons[0], /lucide-arrow-left/)
    assert.match(buttons[0], /Previous slide/)
    assert.match(buttons[1], />Next slide<\/button>/)
    assert.doesNotMatch(buttons[1], /<svg\b|sr-only|rotate-90/)
    assert.match(buttons[1], /disabled=""/, 'unavailable forward navigation stays disabled')
  }
}))

test('calendar next-month control uses visible text and preserves the date-picker accessibility label', () => withTsx(() => {
  const { Calendar } = require('../ui/calendar.tsx')
  const html = renderToStaticMarkup(React.createElement(Calendar, { month: new Date(2026, 9, 1) }))
  const next = html.match(/<button\b[^>]*aria-label="Go to next month"[^>]*>[\s\S]*?<\/button>/)?.[0]
  assert.ok(next)
  assert.match(next, />Next<\/span>/)
  assert.doesNotMatch(next, /<svg\b/)
  assert.match(html, /lucide-chevron-left/, 'actual previous-month navigation keeps its back icon')
}))
