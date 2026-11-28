'use client'
import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { quizQrPath } from '@/lib/orientation/qr'
import { quizButton } from './parts'
/** Printable venue entry carries no PIN; the host reads the PIN aloud separately. */
export function JoinPoster() {
  const [url,setUrl] = useState('')
  useEffect(() => { setUrl(window.location.origin + '/orientation') },[])
  const qr = url ? quizQrPath(url) : null
  return <><button className={quizButton + ' orientation-print-control mb-6 max-w-sm'} onClick={() => window.print()}><Printer size={20} aria-hidden="true" />Print poster</button>
    <section id="orientation-poster" className="mx-auto grid max-w-2xl justify-items-center gap-8 text-center">
      <p className="text-2xl font-bold">CampusIntell</p><h1 className="text-4xl font-bold leading-tight">Join the orientation quiz</h1>
      {qr ? <svg role="img" aria-label="Open the orientation quiz" viewBox="0 0 45 45" width="360" height="360" className="max-w-full bg-white text-student-text-primary" shapeRendering="crispEdges"><path d={qr} fill="currentColor" /></svg> : <p role="status">Preparing the joining link…</p>}
      <a className="flex min-h-11 max-w-full items-center break-all text-2xl font-semibold" href={url || undefined}>{url}</a><p className="text-xl">PIN from the host</p>
    </section>
    <style>{'@media print {body * {visibility:hidden!important} #orientation-poster,#orientation-poster * {visibility:visible!important} #orientation-poster {position:absolute;inset:0;margin:0;max-width:none;padding:32px} .orientation-print-control {display:none!important}}'}</style>
  </>
}
