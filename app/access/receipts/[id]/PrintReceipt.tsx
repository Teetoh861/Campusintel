'use client'
// app/access/receipts/[id]/PrintReceipt.tsx — Save or print the receipt with the browser's own print dialog.
import type { ReactElement } from 'react'

export function PrintReceipt({ className }: { className: string }): ReactElement {
  return <button type="button" onClick={() => window.print()} className={className}>Save or print</button>
}
