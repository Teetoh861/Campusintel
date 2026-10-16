// scripts/ai-practice/diagnose.cjs — Diagnose the AI provider configuration without a billable request.
// Default: fully offline checks plus a TLS handshake that sends no credential. Never prints secret values.
// --probe-model additionally asks the Models API whether this key can see the configured model. That call
// is not a generation and is not billed, but it does use the key, so run it only with the owner's approval.
//   node -r ./lib/auth/test-loader.cjs scripts/ai-practice/diagnose.cjs [--probe-model]
const fs = require('node:fs')
const path = require('node:path')
const tls = require('node:tls')
const Anthropic = require('@anthropic-ai/sdk').default
const { readAiPracticeConfig } = require('../../lib/ai-practice/config.ts')
const { classifyAnthropicError } = require('../../lib/ai-practice/anthropic.ts')
const { formatProviderDiagnostic } = require('../../lib/ai-practice/provider.ts')
const { PRICED_ANTHROPIC_MODELS } = require('../../lib/ai-practice/pricing.ts')

const API_HOST = 'api.anthropic.com'
const TLS_TIMEOUT_MS = 8000
const PROBE_TIMEOUT_MS = 15000
// Variables the SDK reads on its own; any of them can redirect or alter the request.
const SDK_OVERRIDES = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_CUSTOM_HEADERS', 'ANTHROPIC_LOG',
  'HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS']

const out = line => process.stdout.write(`${line}\n`)

/** Shape only: length, character classes and prefix family. The value itself is never printed. */
function describeKey(key) {
  if (!key) return 'absent'
  const family = /^sk-ant-api\d+-/.test(key) ? 'standard API key prefix'
    : key.startsWith('sk-ant-') ? `non-standard sk-ant-${key.slice(7).split('-')[0]}- prefix (not proof of invalidity)`
      : 'unrecognized prefix'
  return [`length=${key.length}`, family, key !== key.trim() ? 'EDGE WHITESPACE' : 'no edge whitespace',
    /^["']|["']$/.test(key) ? 'QUOTED' : 'unquoted', /^[A-Za-z0-9_-]+$/.test(key) ? 'url-safe charset' : 'UNEXPECTED CHARACTERS']
    .join('; ')
}

function tlsReach() {
  return new Promise(resolve => {
    const socket = tls.connect({ host: API_HOST, port: 443, servername: API_HOST, timeout: TLS_TIMEOUT_MS }, () => {
      resolve(`ok (${socket.getProtocol()}, certificate ${socket.authorized ? 'trusted' : 'UNTRUSTED'})`)
      socket.end()
    })
    socket.on('timeout', () => { resolve('TIMEOUT'); socket.destroy() })
    socket.on('error', error => resolve(`FAILED (${error.code ?? error.name})`))
  })
}

async function probe(config) {
  const client = new Anthropic({ apiKey: config.apiKey, timeout: PROBE_TIMEOUT_MS, maxRetries: 0 })
  try {
    const model = await client.models.retrieve(config.model)
    return `ok: key authenticated and can see ${model.id}`
  } catch (error) {
    const failure = classifyAnthropicError(error)
    return formatProviderDiagnostic(failure.code, failure.diagnostic)
  }
}

async function main() {
  const envFile = path.resolve(__dirname, '../../.env.local')
  const loaded = fs.existsSync(envFile)
  if (loaded) process.loadEnvFile(envFile)
  const config = readAiPracticeConfig(process.env)
  const model = process.env.AI_PRACTICE_ANTHROPIC_MODEL ?? 'claude-sonnet-5-5 (default)'
  out(`.env.local: ${loaded ? 'loaded' : 'absent'}`)
  out(`config: ${config.status}${config.status === 'disabled' ? ` (${config.reason})` : ''}`)
  out(`model: ${model}; priced=${PRICED_ANTHROPIC_MODELS.includes(config.model ?? model)}`)
  out(`ANTHROPIC_API_KEY: ${describeKey(process.env.ANTHROPIC_API_KEY)}`)
  const overrides = SDK_OVERRIDES.filter(name => process.env[name] !== undefined)
  out(`SDK-affecting overrides: ${overrides.length ? overrides.join(', ') : 'none'}`)
  const sdkManifest = path.resolve(__dirname, '../../node_modules/@anthropic-ai/sdk/package.json')
  out(`SDK: @anthropic-ai/sdk ${JSON.parse(fs.readFileSync(sdkManifest, 'utf8')).version}`)
  out(`TLS to ${API_HOST}: ${await tlsReach()}`)
  if (!process.argv.includes('--probe-model')) {
    out('model probe: skipped (pass --probe-model, with owner approval, for a non-billable Models API check)')
    return
  }
  if (config.status !== 'enabled') { out('model probe: skipped, configuration is not enabled'); return }
  out(`model probe: ${await probe(config)}`)
}

main().catch(error => {
  process.stderr.write(`diagnose failed: ${error instanceof Error ? error.name : 'unknown error'}\n`)
  process.exitCode = 1
})
