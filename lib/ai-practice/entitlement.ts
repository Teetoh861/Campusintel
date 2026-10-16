// lib/ai-practice/entitlement.ts — Which server-issued AI grants this deployment honours.
// AI generation consumes a grant; it never creates one. Grants are issued only by trusted server code
// through public.issue_ai_allowance_grant (supabase/migrations/20261016140000_ai_practice_uploads.sql).
import 'server-only'
import type { AiGrantSource, AllowanceSummary } from './upload-contract'

type Env = Readonly<Record<string, string | undefined>>

// Trial grants are to come from phone-OTP trial activation (PRD 4.5) and Early Access grants from the shared
// entitlement service. Neither issuer exists in this branch, so production holds no grants and fails closed.
const PRODUCTION_GRANT_SOURCES: readonly AiGrantSource[] = ['trial', 'early_access']
// Next.js fixes NODE_ENV to "production" in every `next build` / `next start`, wherever it is hosted.
const LOCAL_NODE_ENVS = ['development', 'test']
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/** The database the server talks to is on this machine. A hosted deployment cannot satisfy this. */
function usesLoopbackDatabase(env: Env): boolean {
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '')
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      LOOPBACK_HOSTS.includes(url.hostname)
  } catch {
    return false
  }
}

/**
 * Whether this process is positively a local development or test run. Every condition must hold, so a
 * missing or unrecognised variable rejects: an unset VERCEL_ENV is never read as "not production".
 */
export function isVerifiedLocalEnvironment(env: Env = process.env): boolean {
  return LOCAL_NODE_ENVS.includes(env.NODE_ENV ?? '') && usesLoopbackDatabase(env) &&
    (env.VERCEL_ENV === undefined || env.VERCEL_ENV === 'development')
}

/**
 * Grant sources the server accepts. Test grants count only when AI_PRACTICE_ACCEPT_TEST_GRANTS is the
 * literal "true" and the process is a verified local environment, so a stray test grant can never admit
 * a request on any production build or hosted database.
 */
export function acceptedGrantSources(env: Env = process.env): AiGrantSource[] {
  const testGrants = env.AI_PRACTICE_ACCEPT_TEST_GRANTS === 'true' && isVerifiedLocalEnvironment(env)
  return testGrants ? [...PRODUCTION_GRANT_SOURCES, 'test'] : [...PRODUCTION_GRANT_SOURCES]
}

export const NOT_ENTITLED: AllowanceSummary = Object.freeze({ state: 'not-entitled', source: null, total: 0, used: 0,
  endsAt: null })

/** A grant from a source this deployment does not accept is shown exactly like no grant. */
export function effectiveAllowance(summary: AllowanceSummary, accepted: readonly AiGrantSource[]): AllowanceSummary {
  if (summary.state === 'not-entitled' || summary.source === null || !accepted.includes(summary.source)) return NOT_ENTITLED
  return summary
}
