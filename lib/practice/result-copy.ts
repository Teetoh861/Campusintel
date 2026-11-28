// Shared owner-approved wording for a score without answer access (today's side of the copy switch; see
// accessCopy() in lib/entitlements/presentation.ts for the wording once plans are on sale).
import { accessCopy } from '@/lib/entitlements/presentation'

export const ANSWERS_ACCESS_LINE = accessCopy(false).answersLine
