// lib/entitlements/sms.ts — SMS provider selection for trial activation codes.
// Termii is the approved provider. Without a complete, valid Termii configuration every deployment fails closed:
// trial activation reports itself as unavailable and no code is ever generated.
import 'server-only'
import { appendFile } from 'node:fs/promises'
import { isVerifiedLocalEnvironment } from '@/lib/ai-practice/entitlement'
import { createTermiiProvider, readTermiiConfig } from './termii'

type Env = Readonly<Record<string, string | undefined>>

/** `failed` only when the provider positively rejected the message; anything ambiguous is `unknown`. */
export type SmsDelivery = 'sent' | 'failed' | 'unknown'

export type SmsProvider = {
  id: string
  send(to: string, body: string, signal: AbortSignal): Promise<SmsDelivery>
}

export type SmsConfig =
  | { status: 'enabled'; provider: SmsProvider }
  | { status: 'disabled'; reason: 'not-configured' | 'unsupported-provider' | 'missing-setting' | 'invalid-setting' }

/**
 * Development only: append each message to a local JSONL file so a developer can read the code. Selectable only
 * in a verified local environment (development/test NODE_ENV and a loopback database), so a hosted build can
 * never select it.
 */
function localOutbox(path: string): SmsProvider {
  return {
    id: 'local-outbox',
    async send(to, body) {
      try {
        await appendFile(path, JSON.stringify({ at: new Date().toISOString(), to, body }) + '\n', { mode: 0o600 })
        return 'sent'
      } catch { return 'failed' }
    },
  }
}

/** Read the provider selection once per request. Unknown or unapproved providers disable sending. */
export function readSmsConfig(env: Env = process.env, transport: typeof fetch = fetch): SmsConfig {
  const provider = env.ENTITLEMENT_SMS_PROVIDER
  if (provider === undefined || provider.trim() === '') return { status: 'disabled', reason: 'not-configured' }
  if (provider === 'termii') {
    const termii = readTermiiConfig(env)
    return termii.status === 'ok' ? { status: 'enabled', provider: createTermiiProvider(termii.config, transport) }
      : { status: 'disabled', reason: termii.status }
  }
  if (provider === 'local-outbox') {
    if (!isVerifiedLocalEnvironment(env)) return { status: 'disabled', reason: 'unsupported-provider' }
    const path = env.ENTITLEMENT_SMS_LOCAL_OUTBOX
    if (!path || !path.startsWith('/')) return { status: 'disabled', reason: 'missing-setting' }
    return { status: 'enabled', provider: localOutbox(path) }
  }
  return { status: 'disabled', reason: 'unsupported-provider' }
}

/** The one message a student receives. It names the product and warns against sharing the code. */
export function trialCodeMessage(code: string, minutes: number): string {
  return `CampusIntell trial code: ${code}. It expires in ${minutes} minutes. Never share this code with anyone.`
}
