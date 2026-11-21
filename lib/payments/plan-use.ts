// lib/payments/plan-use.ts — Plan use the refund rules count and the attempt tables cannot show: notes topics read and
// theory answers revealed (Campus Bot sets are recorded by the database when they are delivered). One service-role
// call, record_plan_use (20261103100000_campus_bot_limits.sql), which re-derives the student from the session, checks
// under A2's read opening that the course is readable now and that the reference is one of its published items, and
// writes the marker. Free (GST) courses and students without a paid plan are not counted ('not-counted'), which is not a
// failure. Anything else is a failure: callers show nothing they would have shown with it.
import 'server-only'
import { z } from 'zod'
import { call } from './rpc'
import type { PaymentRpc } from './rpc'
import { createServiceRpc } from './server'

export type PlanUseKind = 'notes-topic' | 'theory-reveal'
export type PlanUseInput = { sessionId: string; kind: PlanUseKind; courseId: string; ref: string }
/** True when the use is recorded (or is not counted); false when it could not be recorded. */
export type PlanUseRecorder = (input: PlanUseInput) => Promise<boolean>

const answer = z.object({ state: z.enum(['recorded', 'not-counted', 'signed-out', 'not-allowed']) }).passthrough()

export function planUseRecorder(rpc: PaymentRpc): PlanUseRecorder {
  return async ({ sessionId, kind, courseId, ref }) => {
    try {
      const result = await call(rpc, 'record_plan_use', { p_session_id: sessionId, p_kind: kind, p_course_id: courseId,
        p_ref: ref }, answer)
      return result.state === 'recorded' || result.state === 'not-counted'
    } catch (error) {
      console.error('payments: plan use not recorded', error instanceof Error ? error.name : 'unknown')
      return false
    }
  }
}

/** The production recorder: service-role calls to the database. */
export function defaultPlanUseRecorder(): PlanUseRecorder {
  return planUseRecorder(createServiceRpc())
}
