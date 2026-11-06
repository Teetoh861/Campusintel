// lib/student-copy/student-copy.test.cjs — Copy guard: no word or phrase from docs/student-copy.md rule 2 reaches a
// student. Checks rendered text (JSX text, visible attributes, sentence-like strings), never code names or comments.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { BANNED, bannedPhrases, studentFiles, visibleTextIn } = require('./scan.cjs')

const ROOT = process.cwd()

test('no student-facing text uses a word or phrase from rule 2', () => {
  const breaches = bannedPhrases(studentFiles(ROOT))
  assert.deepEqual(breaches.map(b => `${b.file}:${b.line} [${b.label}] ${b.text}`), [])
})

test('the guard reads the screens students use', () => {
  const files = studentFiles(ROOT)
  for (const file of ['app/courses/[slug]/theory/SelfAssessment.tsx', 'app/courses/[slug]/quiz/IntroScreen.tsx',
    'app/courses/ai-practice/[courseId]/PersonalPractice.tsx', 'app/access/page.tsx', 'app/login/LoginForm.tsx',
    'components/dashboard/PrimaryCards.tsx', 'lib/landing/content.ts', 'lib/entitlements/presentation.ts',
    'lib/ai-practice/contract.ts']) assert.ok(files.includes(file), file)
  assert.equal(files.some(file => /(?:^|\/)admin\/|^lib\/data\/|\.test\./.test(file)), false)
})

test('visible text is caught wherever a student reads it', () => {
  const source = `
    const TITLE = 'Model answer'
    export const COPY = { lede: 'AI questions for you' }
    export function View({ tone }) {
      return <section aria-label="Server status">
        <h2>{tone === 'a' ? 'Your self-assessment' : 'Done'}</h2>
        <p>Your work is saved to CampusIntell.</p>
        <p>{\`\${1} graded answers\`}</p>
      </section>
    }`
  const labels = visibleTextIn(source, 'view.tsx')
    .flatMap(({ text }) => BANNED.filter(({ pattern }) => pattern.test(text)).map(({ label }) => label))
  assert.deepEqual([...new Set(labels)].sort(),
    ['AI', 'graded', 'model answer', 'saved or sent to CampusIntell', 'self-assessment', 'server'].sort())
})

test('a short literal rendered as JSX text is checked too, such as {\'AI\'}', () => {
  const source = `export function View({ on }) {
      return <p>{'AI'} {on ? 'AI' : 'Campus Bot'} {on && 'AI'} {('AI')} <>{'AI'}</></p>
    }`
  const found = visibleTextIn(source, 'view.tsx').filter(({ text }) => BANNED.find(b => b.label === 'AI').pattern.test(text))
  assert.equal(found.length, 5)
})

test('code names, comments, imports and non-visible values are ignored', () => {
  const source = `
    // The server grades the attempt; AI output is unverified.
    /* model answer and database notes */
    import { serverClient } from '@/lib/supabase/server'
    import 'server-only'
    type Status = 'graded' | 'unverified'
    const graded = useRef(false)
    if (outcome.status === 'graded') finish()
    const map = { graded: 1, 'database': 2 }
    console.error('database unavailable')
    throw new Error('AI provider error')
    export function View() {
      return <div className="server-card" data-state="graded" id="ai-heading">Ready</div>
    }`
  assert.deepEqual(visibleTextIn(source, 'view.tsx').map(entry => entry.text), ['Ready'])
})

test('Campus Bot sets carry the one label from rule 6', () => {
  const { PERSONAL_PRACTICE_DISCLAIMER } = require('../ai-practice/contract.ts')
  assert.equal(PERSONAL_PRACTICE_DISCLAIMER, 'Made by Campus Bot from your notes.')
})
