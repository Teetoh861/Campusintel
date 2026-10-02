// components/admin/ContentHistory.tsx — Operator-only revision inspection and deliberate workflow actions.
'use client'
import { useState } from 'react'
import type { ReactElement } from 'react'
import type { ContentMutation, ManagedHistory } from '@/lib/operator/editor-contract'

type Props = {
  history: ManagedHistory
  parentHistory: ManagedHistory | null
  busy: boolean
  onAction: (input: ContentMutation) => Promise<void>
  onRestore: (revision: number, parentRevision?: number) => Promise<void>
}

function dateLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? 'Unknown time' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** Inspect immutable history and act on the selected revision with its current lock. */
export function ContentHistory({ history, parentHistory, busy, onAction, onRestore }: Props): ReactElement {
  const item = history.item
  const [revision, setRevision] = useState(item.current_revision)
  const [note, setNote] = useState('')
  const [parentRevision, setParentRevision] = useState(parentHistory?.item.published_revision ?? parentHistory?.item.current_revision ?? 0)
  const selected = history.revisions.find(entry => entry.revision === revision)
  const latestReview = [...history.reviews].reverse().find(entry => entry.revision === revision)
  const dependent = item.kind === 'model_answer' || item.kind === 'rubric'
  const latestApproval = [...history.reviews].reverse().find(entry => entry.revision === revision && entry.decision === 'approved')
  const published = item.published_revision !== null
  const bindingMatches = !dependent || (item.published_parent_revision !== null &&
    item.published_parent_revision === parentHistory?.item.published_revision)
  const canPublish = item.approved_revision === revision &&
    (item.published_revision !== revision || (dependent && latestApproval?.parent_revision !== item.published_parent_revision))

  function review(decision: 'approved' | 'rejected'): void {
    if (decision === 'rejected' && !window.confirm(`Reject revision ${revision}? If it is published, students will stop seeing it immediately.`)) return
    if (dependent && !parentHistory) return
    void onAction({ action: 'review', itemId: item.id, expectedLockVersion: item.lock_version,
      revision, decision, note: note.trim() || undefined,
      ...(dependent ? { parentRevision } : {}) })
  }

  function publish(): void {
    if (!window.confirm(`Publish approved revision ${revision}? This changes the published-content boundary immediately.`)) return
    void onAction({ action: 'publish', itemId: item.id, expectedLockVersion: item.lock_version, revision })
  }

  function unpublish(): void {
    if (!window.confirm('Unpublish this content? Students will no longer see this item through the managed published-content boundary.')) return
    void onAction({ action: 'unpublish', itemId: item.id, expectedLockVersion: item.lock_version })
  }

  function restore(): void {
    if (!window.confirm(`Restore revision ${revision}? This will record a new approval and publication event without deleting later revisions.`)) return
    if (dependent && !parentHistory) return
    void onRestore(revision, dependent ? parentRevision : undefined)
  }

  return (
    <section aria-labelledby="content-history-heading" className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 id="content-history-heading" className="text-xl font-semibold text-blue-950">Review and history</h3>
      <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-800">Current draft: revision {item.current_revision}</span>
        <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-900">{item.approved_revision ? `Approved: revision ${item.approved_revision}` : 'No approved revision'}</span>
        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-900">{published ? `Published: revision ${item.published_revision}` : 'Unpublished'}</span>
        {published && item.current_revision !== item.published_revision && <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-900">Changed since publication</span>}
      </div>
      {dependent && !bindingMatches && published && <p role="status" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
        This publication is hidden because its theory revision no longer matches the published question. Review it against the current theory revision, then publish again.
      </p>}
      {dependent && !parentHistory && <p role="alert" className="mt-3 text-sm text-red-700">The linked theory history is unavailable. Review and restore are disabled.</p>}
      <div className="mt-5">
        <label htmlFor="history-revision" className="block text-sm font-medium text-slate-800">Inspect revision</label>
        <select id="history-revision" value={revision} onChange={event => setRevision(Number(event.target.value))}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900">
          {[...history.revisions].reverse().map(entry => <option key={entry.revision} value={entry.revision}>
            Revision {entry.revision}{entry.revision === item.current_revision ? ' · current' : ''}{entry.revision === item.published_revision ? ' · published' : ''}
          </option>)}
        </select>
        {selected && <>
          <p className="mt-2 text-xs text-slate-600">Saved {dateLabel(selected.authored_at)} · {latestReview ? `Latest review: ${latestReview.decision}` : 'Awaiting review'}</p>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-slate-950 p-4 text-sm text-slate-50">{JSON.stringify(selected.payload, null, 2)}</pre>
        </>}
      </div>
      {dependent && parentHistory && <div className="mt-4">
        <label htmlFor="history-parent-revision" className="block text-sm font-medium text-slate-800">Theory wording to review against</label>
        <select id="history-parent-revision" value={parentRevision} onChange={event => setParentRevision(Number(event.target.value))}
          className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900">
          {parentHistory.revisions.map(entry => <option key={entry.revision} value={entry.revision}>
            Theory revision {entry.revision}{entry.revision === parentHistory.item.published_revision ? ' · published' : ''}
          </option>)}
        </select>
        <p className="mt-1 text-xs text-slate-600">The published answer or rubric is visible only beside this exact theory revision.</p>
        {parentRevision !== parentHistory.item.published_revision && <p className="mt-1 text-sm text-amber-800">
          This theory revision is not currently published. The dependent content will remain hidden until it is published.
        </p>}
      </div>}
      <div className="mt-4">
        <label htmlFor="history-review-note" className="block text-sm font-medium text-slate-800">Review note (optional)</label>
        <textarea id="history-review-note" value={note} onChange={event => setNote(event.target.value)} rows={2} maxLength={2000}
          className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-slate-900" />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" disabled={busy || (dependent && !parentHistory)} onClick={() => review('approved')}
          className="rounded-md bg-blue-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Approve revision</button>
        <button type="button" disabled={busy || (dependent && !parentHistory)} onClick={() => review('rejected')}
          className="rounded-md border border-red-400 px-3 py-2 text-sm font-medium text-red-800 disabled:opacity-60">Reject revision</button>
        <button type="button" disabled={busy || !canPublish} onClick={publish}
          className="rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">Publish approved revision</button>
        {published && <button type="button" disabled={busy} onClick={unpublish}
          className="rounded-md border border-slate-400 px-3 py-2 text-sm font-medium text-slate-800 disabled:opacity-60">Unpublish</button>}
        {revision !== item.current_revision && revision !== item.published_revision && <button type="button" disabled={busy || (dependent && !parentHistory)} onClick={restore}
          className="rounded-md border border-blue-700 px-3 py-2 text-sm font-medium text-blue-900 disabled:opacity-60">Restore revision {revision}</button>}
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div><h4 className="font-semibold text-slate-900">Review decisions</h4>
          {history.reviews.length === 0 ? <p className="mt-2 text-sm text-slate-600">No reviews yet.</p> :
            <ol className="mt-2 space-y-2 text-sm">{[...history.reviews].reverse().map(entry => <li key={entry.lock_version} className="rounded-md border border-slate-200 p-3">
              <span className="font-medium capitalize">{entry.decision}</span> revision {entry.revision}
              {entry.parent_revision && ` for theory revision ${entry.parent_revision}`}
              <span className="block text-xs text-slate-600">{dateLabel(entry.reviewed_at)}</span>
              {entry.note && <p className="mt-1 whitespace-pre-wrap text-slate-700">{entry.note}</p>}
            </li>)}</ol>}</div>
        <div><h4 className="font-semibold text-slate-900">Publication events</h4>
          {history.publications.length === 0 ? <p className="mt-2 text-sm text-slate-600">Never published.</p> :
            <ol className="mt-2 space-y-2 text-sm">{[...history.publications].reverse().map(entry => <li key={entry.lock_version} className="rounded-md border border-slate-200 p-3">
              <span className="font-medium capitalize">{entry.action}</span>{entry.revision ? ` revision ${entry.revision}` : ''}
              {entry.parent_revision && ` for theory revision ${entry.parent_revision}`}
              {entry.previous_revision && ` · previously revision ${entry.previous_revision}`}
              <span className="block text-xs text-slate-600">{dateLabel(entry.acted_at)}</span>
            </li>)}</ol>}</div>
      </div>
    </section>
  )
}
