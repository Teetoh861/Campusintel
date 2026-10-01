// Materials (/materials) — account-gated general request surface.
import { StudentAccessGate } from '@/components/auth/StudentAccessGate'
import { MaterialsClient } from './MaterialsClient'

// Account-gated per student; never prerender or share across viewers.
export const dynamic = 'force-dynamic'

/** Cross the student account boundary before the material request form renders. */
export default function MaterialsPage() {
  return <StudentAccessGate returnPath="/materials"><MaterialsClient /></StudentAccessGate>
}
