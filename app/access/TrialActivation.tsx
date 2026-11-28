'use client'
// app/access/TrialActivation.tsx — The free pass offer's scope on Plan & Access: a refusal from FreePassStart withdraws
// every piece of offer text at once. (The pass itself is started from FreePassStart's modal.)
import { createContext, useContext, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

// Whether the pass is still on offer on this page. A refusal withdraws it at once, so nothing on the page keeps
// describing or advertising a pass this account cannot start; the next render no longer offers it at all.
export const PassOffer = createContext<{ withdrawn: boolean; withdraw(): void } | null>(null)

/** The part of the page that may mention the offer. */
export function PassOfferScope({ children }: { children: ReactNode }): ReactElement {
  const [withdrawn, setWithdrawn] = useState(false)
  return <PassOffer.Provider value={{ withdrawn, withdraw: () => setWithdrawn(true) }}>{children}</PassOffer.Provider>
}

/** Offer text: shown until a refusal withdraws the offer. */
export function WhileOffered({ children }: { children: ReactNode }): ReactNode {
  return useContext(PassOffer)?.withdrawn ? null : children
}
