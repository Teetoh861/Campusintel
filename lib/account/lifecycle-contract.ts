import { z } from 'zod'

const restricted = z.object({
  status: z.enum(['scheduled', 'expired']), deadline: z.string().datetime({ offset: true }), requestId: z.string().uuid(),
}).strict()

export const lifecycleSchema = z.union([
  z.object({ status: z.literal('active'), deletionAllowed: z.boolean() }).strict(),
  restricted,
  z.object({ status: z.literal('signed-out') }).strict(),
])
export type AccountLifecycle = z.infer<typeof lifecycleSchema>
