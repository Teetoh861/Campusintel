// lib/student-copy/scan.cjs — Extracts the text a student can read from TSX/TS source, for the copy guard test.
// Reads JSX text, visible JSX attribute values (aria-label, title, alt, placeholder, a component's title or description
// props…, however the value is written), values of visible prop names in objects, and sentence-like string literals. Skips comments, identifiers,
// imports, object keys, type positions, CSS classes, URLs, console calls and thrown errors.
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

/** Phrases from docs/student-copy.md rule 2 that must never reach a student. */
const BANNED = [
  { label: 'AI', pattern: /\bAI\b/ },
  { label: 'model answer', pattern: /\bmodel answers?\b/i },
  { label: 'self-assessment', pattern: /\bself[- ]assess(?:ment|ed)?\b/i },
  { label: 'unverified', pattern: /\bunverified\b/i },
  { label: 'not verified', pattern: /\bnot (?:yet )?verified\b/i },
  { label: 'graded', pattern: /\bgraded\b/i },
  { label: 'attempt history', pattern: /\battempt history\b/i },
  { label: 'saved or sent to CampusIntell', pattern: /\b(?:saved|sent) (?:to|with) (?:your )?CampusIntell?\b/i },
  { label: 'database', pattern: /\bdatabases?\b/i },
  { label: 'server', pattern: /\bservers?\b/i },
  { label: 'Discovery Pass', pattern: /\bDiscovery Pass\b/i },
]

/** JSX attributes whose values a student never reads. */
const HIDDEN_ATTRIBUTES = new Set([
  'className', 'href', 'id', 'key', 'type', 'name', 'variant', 'size', 'src', 'role', 'method', 'action', 'rel',
  'target', 'htmlFor', 'autoComplete', 'inputMode', 'pattern', 'side', 'align', 'as', 'tone', 'icon', 'kind',
  'mode', 'state', 'status', 'testId', 'sizes', 'priority', 'loading', 'strategy', 'encType', 'form', 'lang',
  'dir', 'scope', 'headers', 'accept', 'capture', 'media', 'fill', 'stroke', 'viewBox', 'd', 'style', 'event',
  'returnTo', 'next', 'courseId', 'slug', 'path', 'value', 'defaultValue', 'aria-controls', 'aria-describedby',
  'aria-labelledby', 'aria-live', 'aria-hidden', 'aria-current', 'aria-haspopup', 'aria-expanded', 'tabIndex',
])

/** Prop names whose values a student reads, also when written in an object (`{ title: 'AI' }`) and spread or passed on. */
const VISIBLE_PROPS = new Set([
  'aria-label', 'ariaLabel', 'aria-valuetext', 'aria-roledescription', 'aria-placeholder', 'title', 'alt', 'placeholder',
  'label', 'description', 'body', 'lede', 'heading', 'subtitle', 'caption', 'summary', 'hint', 'tooltip', 'message',
])

const NON_VISIBLE_CALLS = /^(?:console\.\w+|super|require|import|fetch|cookies|headers|redirect|notFound|permanentRedirect|logEvent|logServerEvent|track\w*|new Error|new TypeError|new RangeError|Error|captureException|cn|clsx|twMerge|cva|encodeURIComponent|URL|new URL|URLSearchParams|new URLSearchParams|searchParams\.get|[\w.]*\.(?:get|set|has|delete|append|from|rpc|select|eq|neq|in|is|order|limit|match|insert|update|upsert|channel|getItem|setItem|removeItem|addEventListener|removeEventListener|dispatchEvent|querySelector|querySelectorAll|startsWith|endsWith|includes|split|replace|replaceAll|padStart|toLocaleString|toLocaleDateString|toLocaleTimeString|localeCompare|test|exec|query))$/

function isSentenceLike(text) {
  const trimmed = text.trim()
  if (!/[A-Za-z]/.test(trimmed)) return false
  if (/^[a-z0-9_.:/@#?=&%-]+$/.test(trimmed)) return false
  if (/^(?:https?:|mailto:|tel:|\/|\.|#)/.test(trimmed)) return false
  return /\s/.test(trimmed) || /^[A-Z][a-z]/.test(trimmed)
}

/** Where a literal's value lands once parentheses, `as`, conditional branches and `&&`/`||`/`??` are passed through:
 *  the JSX expression, attribute or object property that receives it, or null. */
function landing(node) {
  let child = node
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression?.(parent)) continue
    if (ts.isConditionalExpression(parent) && parent.condition !== child) continue
    if (ts.isBinaryExpression(parent) && parent.right === child
        && /^(?:&&|\|\||\?\?)$/.test(ts.tokenToString(parent.operatorToken.kind) ?? '')) continue
    return parent
  }
  return null
}

/** True when a literal is rendered as a JSX child: `{'AI'}`, `{a ? 'AI' : 'x'}`, `{a && 'AI'}`, `{('AI')}`. Such text is
 *  checked whatever its shape, without the sentence-like shortcut that other string literals need. */
function isJsxChildText(node) {
  const parent = landing(node)
  return parent !== null && ts.isJsxExpression(parent) && (ts.isJsxElement(parent.parent) || ts.isJsxFragment(parent.parent))
}

/** The name of the property a literal is the value of, as written (`title`, `'aria-label'`), or null. */
function propertyName(name, source) {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name) ? name.text
    : name.getText(source)
}

/** True when a literal is the value of an attribute or prop a student reads, however it is written: `aria-label={'AI'}`,
 *  `placeholder={on ? 'graded' : 'Search'}`, `<Notice title={\`AI \${n}\`} />`, `{ title: 'AI' }`. Hidden attributes
 *  (className, href, data-*…) are left to isHiddenLiteral. */
function isVisiblePropText(node, source) {
  const parent = landing(node)
  if (parent === null) return false
  if (ts.isJsxAttribute(parent)) return true
  if (ts.isJsxExpression(parent) && ts.isJsxAttribute(parent.parent)) return true
  return ts.isPropertyAssignment(parent) && VISIBLE_PROPS.has(propertyName(parent.name, source))
}

function calleeText(call, source) {
  const expression = call.expression
  const text = expression.getText(source)
  return ts.isNewExpression(call) ? `new ${text}` : text
}

/** True when a string literal sits somewhere a student cannot see it. */
function isHiddenLiteral(node, source) {
  let child = node
  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent)) return true
    if (ts.isTypeNode(parent) && !ts.isTypeQueryNode(parent)) return true
    if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) && parent.name === child) return true
    if (ts.isElementAccessExpression(parent) && parent.argumentExpression === child) return true
    if (ts.isCaseClause(parent) && parent.expression === child) return true
    if (ts.isBinaryExpression(parent) && /^(?:===|!==|==|!=|in|instanceof)$/.test(parent.operatorToken.getText(source))) return true
    if (ts.isJsxAttribute(parent)) return HIDDEN_ATTRIBUTES.has(parent.name.getText(source)) || parent.name.getText(source).startsWith('data-')
    if ((ts.isCallExpression(parent) || ts.isNewExpression(parent)) && child !== parent.expression) {
      if (NON_VISIBLE_CALLS.test(calleeText(parent, source))) return true
    }
    if (ts.isThrowStatement(parent)) return true
    // An expression inside an attribute is hidden or visible by the attribute's name: className={on ? 'a' : 'b'}.
    if (ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent)) continue
    if (ts.isJsxExpression(parent) || ts.isReturnStatement(parent) || ts.isVariableDeclaration(parent)) return false
  }
  return false
}

/** Every piece of student-readable text in one TS/TSX file, with its line. */
function visibleText(file) {
  return visibleTextIn(fs.readFileSync(file, 'utf8'), file)
}

/** Every piece of student-readable text in TS/TSX source; `file` decides TSX parsing. */
function visibleTextIn(content, file) {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true, kind)
  const found = []
  const add = (node, text) => {
    const clean = text.replace(/\s+/g, ' ').trim()
    if (clean) found.push({ line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1, text: clean })
  }
  const visit = node => {
    if (ts.isJsxText(node)) add(node, node.text)
    else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      if (!isHiddenLiteral(node, source) && (isVisiblePropText(node, source) || isJsxChildText(node) || isSentenceLike(node.text))) {
        add(node, node.text)
      }
    } else if (ts.isTemplateExpression(node)) {
      const parts = [node.head.text, ...node.templateSpans.map(span => span.literal.text)].join(' … ')
      if (!isHiddenLiteral(node, source) && (isVisiblePropText(node, source) || isJsxChildText(node) || isSentenceLike(parts))) {
        add(node, parts)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

/** Breaches of rule 2 in the given files. */
function bannedPhrases(files) {
  const breaches = []
  for (const file of files) {
    for (const { line, text } of visibleText(file)) {
      for (const { label, pattern } of BANNED) {
        if (pattern.test(text)) breaches.push({ file, line, label, text })
      }
    }
  }
  return breaches
}

/** Source files whose text can reach a student. Excludes tests, operator and admin tools, unstyled UI primitives
 *  and course content (lib/data holds study material, which follows its syllabus, not these rules). */
function studentFiles(root) {
  const roots = ['app', 'components', 'lib']
  const excluded = /(?:^|\/)admin\/|^components\/ui\/|^lib\/(?:data|operator|test)\/|\.test\.|\.fixture\./
  const out = []
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const relative = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(relative)
      else if (/\.tsx?$/.test(entry.name) && !excluded.test(relative)) out.push(relative)
    }
  }
  for (const dir of roots) walk(dir)
  return out.sort()
}

module.exports = { BANNED, bannedPhrases, studentFiles, visibleText, visibleTextIn }
