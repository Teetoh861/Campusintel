// scripts/ai-practice/demo.cjs — Local demonstration of AI upload-to-practice generation.
// Mock mode (default) never touches the network. Live mode makes exactly one bounded Claude request.
//   node -r ./lib/auth/test-loader.cjs scripts/ai-practice/demo.cjs
//   node -r ./lib/auth/test-loader.cjs scripts/ai-practice/demo.cjs --live [--file notes.txt] [--out result.json]
// Live mode reads .env.local (AI_PRACTICE_ENABLED=true and ANTHROPIC_API_KEY) and never prints values.
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { AI_PRACTICE_LIMITS, PERSONAL_PRACTICE_DISCLAIMER } = require('../../lib/ai-practice/contract.ts')
const { createConfiguredProvider, readAiPracticeConfig } = require('../../lib/ai-practice/config.ts')
const { worstCaseCostUsd } = require('../../lib/ai-practice/pricing.ts')
const { generatePracticeSet } = require('../../lib/ai-practice/service.ts')
const { toPersonalPracticeItems } = require('../../lib/ai-practice/practice-boundary.ts')
const { formatProviderDiagnostic } = require('../../lib/ai-practice/provider.ts')
const { createFixtureProvider, fixtureText } = require('../../lib/ai-practice/fixtures/fixture-provider.cjs')

const COURSE = { courseId: 'demo-principles-of-marketing', code: 'DEMO 201', title: 'Principles of Marketing' }
// Live evaluation is deliberately small: one request, three questions.
const LIVE_QUESTION_COUNT = 3

const out = line => process.stdout.write(`${line}\n`)
const request = (extractedText, fileName, questionCount) =>
  ({ course: COURSE, source: { documentId: randomUUID(), fileName, extractedText }, questionCount })

function report(label, outcome) {
  out(`\n=== ${label}`)
  out(`status: ${outcome.status}${outcome.status === 'generated' ? '' : ` (${outcome.reason})`}` +
    (outcome.providerError ? ` provider error: ${outcome.providerError}` : ''))
  // Private operator detail: HTTP status, documented error type, request id, transport code. No secret or message.
  if (outcome.providerDiagnostic) out(`diagnostic: ${formatProviderDiagnostic(outcome.providerError, outcome.providerDiagnostic)}`)
  if (outcome.status === 'generated') {
    const { set } = outcome
    out(`set: origin=${set.origin} visibility=${set.visibility} verification=${set.verification}`)
    out(`source: ${set.source.fileName} sha256=${set.source.sha256.slice(0, 12)}... passages=${set.source.passageCount}`)
    out(`generation: ${set.generation.provider}/${set.generation.model} confidence=${set.generation.confidence} ` +
      `kept=${set.questions.length} rejected=${set.generation.rejectedQuestionCount}`)
    out(`disclaimer: ${PERSONAL_PRACTICE_DISCLAIMER}`)
    toPersonalPracticeItems(set).forEach((item, index) => {
      out(`\n${index + 1}. [${item.section}] ${item.question}`)
      item.options.forEach((option, optionIndex) =>
        out(`   ${optionIndex === item.correctAnswer ? '*' : ' '} ${String.fromCharCode(65 + optionIndex)}. ${option}`))
      out(`   grounded in ${set.questions[index].grounding.passageId}: "${item.sourceQuote}"`)
    })
  }
  if (outcome.usage) {
    const u = outcome.usage
    const cost = u.estimatedCostUsd === null ? 'unknown (unpriced model)' : `$${u.estimatedCostUsd.toFixed(6)}`
    out(`\nusage: input=${u.inputTokens} output=${u.outputTokens} cache_read=${u.cacheReadInputTokens} ` +
      `cache_write=${u.cacheCreationInputTokens} duration=${u.durationMs}ms cost=${cost}`)
  }
}

async function mock() {
  out('MOCK MODE: no network calls; token usage is illustrative fixture data, not a measurement.')
  const notes = fixtureText('marketing-mix-notes.txt')
  const reply = JSON.parse(fixtureText('marketing-mix.response.json'))
  const deps = provider => ({ provider, timeoutMs: 5_000 })
  report('Grounded notes', await generatePracticeSet(request(notes, 'week-3-notes.txt', 5),
    deps(createFixtureProvider(reply))))
  const unrelated = { assessment: { ...reply.assessment, relatedToCourse: false, assessmentNote: 'A recipe.' },
    questions: [] }
  report('Unrelated upload', await generatePracticeSet(request(fixtureText('unrelated-recipe.txt'), 'jollof.txt', 5),
    deps(createFixtureProvider(unrelated))))
  report('Too-short upload', await generatePracticeSet(request('Marketing mix = 4Ps.', 'stub.txt', 5),
    deps(createFixtureProvider(reply))))
  report('Provider not configured', await generatePracticeSet(request(notes, 'week-3-notes.txt', 5), deps(null)))
}

/** Load repo-root .env.local into this process without overriding the shell or echoing any value. */
function loadLocalEnv() {
  const file = path.resolve(__dirname, '../../.env.local')
  if (!fs.existsSync(file)) return 'absent'
  process.loadEnvFile(file)
  return 'loaded'
}

async function live(fileArg, outPath) {
  const envFile = loadLocalEnv()
  const config = readAiPracticeConfig(process.env)
  out(`env: .env.local ${envFile}; ANTHROPIC_API_KEY ${process.env.ANTHROPIC_API_KEY ? 'present' : 'absent'}; ` +
    `config ${config.status}${config.status === 'disabled' ? ` (${config.reason})` : ''}`)
  if (config.status !== 'enabled') {
    out('LIVE MODE BLOCKED: generation is not enabled and configured. No request was made.')
    process.exitCode = 2
    return
  }
  const file = fileArg ? path.resolve(fileArg) : null
  if (file && path.extname(file).toLowerCase() !== '.txt') throw new Error('--file accepts extracted .txt only')
  const text = file ? fs.readFileSync(file, 'utf8') : fixtureText('marketing-mix-notes.txt')
  out(`LIVE MODE: one request to ${config.model}, ${LIVE_QUESTION_COUNT} questions, ` +
    `max ${AI_PRACTICE_LIMITS.maxOutputTokens} output tokens, worst-case cost $${worstCaseCostUsd(config.model).toFixed(3)}.`)
  const provider = createConfiguredProvider(config)
  const outcome = await generatePracticeSet(
    request(text, file ? path.basename(file) : 'week-3-notes.txt', LIVE_QUESTION_COUNT),
    { provider, timeoutMs: config.timeoutMs })
  report('Live evaluation', outcome)
  // The outcome holds no key, prompt or source text; it is kept for offline quality review.
  if (outPath) fs.writeFileSync(path.resolve(outPath), `${JSON.stringify(outcome, null, 2)}\n`)
}

async function main() {
  const args = process.argv.slice(2)
  const fileIndex = args.indexOf('--file')
  const outIndex = args.indexOf('--out')
  if (args.includes('--live')) {
    await live(fileIndex >= 0 ? args[fileIndex + 1] : undefined, outIndex >= 0 ? args[outIndex + 1] : undefined)
  }
  else await mock()
}

main().catch(error => {
  // Fixed message only: errors can carry request details.
  process.stderr.write(`demo failed: ${error instanceof Error ? error.name : 'unknown error'}\n`)
  process.exitCode = 1
})
