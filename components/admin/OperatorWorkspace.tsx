// components/admin/OperatorWorkspace.tsx — Interactive course-to-publication workflow over server-owned RPC routes.
'use client'
import { useRef, useState } from 'react'
import { ContentForm } from './ContentForm'
import { ContentHistory } from './ContentHistory'
import { ContentList } from './ContentList'
import { CoursePicker } from './CoursePicker'
import { EditorApiError, fetchOperatorCourses, fetchOperatorHistory, fetchOperatorItems, sendEditorMutation } from '@/lib/operator/editor-client'
import type { ReactElement } from 'react'
import type { ContentMutation, InstitutionalCourse, ManagedHistory, ManagedItem, RepositoryCourse } from '@/lib/operator/editor-contract'

type Props = { repositories: RepositoryCourse[]; institutional: InstitutionalCourse[] }
type Notice = { tone: 'success' | 'error'; text: string }

function actionMessage(action: ContentMutation['action']): string {
  if (action === 'create') return 'Draft created.'
  if (action === 'revise') return 'New revision saved. The published revision has not changed.'
  if (action === 'review') return 'Review decision recorded.'
  if (action === 'publish') return 'Approved revision published.'
  if (action === 'unpublish') return 'Content unpublished. History is preserved.'
  return 'Content action recorded.'
}

/** Coordinate selection, editor requests, and explicit conflict recovery. */
export function OperatorWorkspace(initial: Props): ReactElement {
  const [catalogue, setCatalogue] = useState(initial)
  const [courseId, setCourseId] = useState<string | null>(null)
  const [loadedCourseId, setLoadedCourseId] = useState<string | null>(null)
  const [items, setItems] = useState<ManagedItem[]>([])
  const [itemId, setItemId] = useState<string | null>(null)
  const [history, setHistory] = useState<ManagedHistory | null>(null)
  const [parentHistory, setParentHistory] = useState<ManagedHistory | null>(null)
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [conflict, setConflict] = useState(false)
  const [denied, setDenied] = useState(false)
  const requestNumber = useRef(0)
  const activeCourse = useRef<string | null>(null)
  const courseReady = courseId !== null && loadedCourseId === courseId && !loading
  const selectedItem = courseReady ? items.find(item => item.item_id === itemId) ?? null : null
  const selectedCourse = catalogue.repositories.find(course => course.id === courseId)
  const institutionalName = catalogue.institutional.find(course => course.repository_course_id === courseId)

  function report(error: unknown): void {
    const problem = error instanceof EditorApiError ? error : new EditorApiError(503, 'The content service is unavailable.')
    if (problem.status === 401 || problem.status === 403) {
      activeCourse.current = null
      setDenied(true)
      setCatalogue({ repositories: [], institutional: [] })
      setLoadedCourseId(null)
      setItems([])
      setHistory(null)
      setParentHistory(null)
    }
    setConflict(problem.status === 409)
    setNotice({ tone: 'error', text: problem.message })
  }

  async function loadCourse(nextCourseId: string, nextItemId: string | null = null): Promise<boolean> {
    const ticket = ++requestNumber.current
    activeCourse.current = nextCourseId
    setLoading(true)
    setCourseId(nextCourseId)
    setLoadedCourseId(null)
    setItems([])
    setItemId(nextItemId)
    setHistory(null)
    setParentHistory(null)
    setConflict(false)
    setNotice(null)
    try {
      const nextItems = await fetchOperatorItems(nextCourseId)
      if (ticket !== requestNumber.current) return false
      setItems(nextItems)
      setLoadedCourseId(nextCourseId)
      if (nextItemId) {
        const selected = nextItems.find(item => item.item_id === nextItemId)
        if (selected) {
          if (!await loadHistory(selected, ticket)) return false
        } else setItemId(null)
      }
      return true
    } catch (error) { if (ticket === requestNumber.current) report(error); return false }
    finally { if (ticket === requestNumber.current) setLoading(false) }
  }

  async function loadHistory(item: ManagedItem, ticket = ++requestNumber.current): Promise<boolean> {
    setItemId(item.item_id)
    setHistory(null)
    setParentHistory(null)
    setLoading(true)
    setNotice(null)
    try {
      const [nextHistory, nextParent] = await Promise.all([
        fetchOperatorHistory(item.item_id),
        item.parent_item_id ? fetchOperatorHistory(item.parent_item_id) : Promise.resolve(null),
      ])
      if (ticket !== requestNumber.current) return false
      setHistory(nextHistory)
      setParentHistory(nextParent)
      return true
    } catch (error) { if (ticket === requestNumber.current) report(error); return false }
    finally { if (ticket === requestNumber.current) setLoading(false) }
  }

  async function mutate(input: ContentMutation): Promise<void> {
    if (busy || !courseReady || activeCourse.current !== courseId) return
    setBusy(true)
    setNotice(null)
    setConflict(false)
    try {
      const result = await sendEditorMutation(input)
      const refreshed = await loadCourse(courseId, result.itemId ?? itemId)
      setNotice(refreshed ? { tone: 'success', text: actionMessage(input.action) }
        : { tone: 'error', text: 'The action was recorded, but the latest view could not load. Select the course to reload.' })
    } catch (error) { report(error) }
    finally { setBusy(false) }
  }

  async function provision(course: InstitutionalCourse): Promise<void> {
    if (busy || !window.confirm(`Create one permanent repository identity for ${course.course_code} · ${course.display_title}? Only this catalogue row will be linked; unresolved aliases will remain separate. The student catalogue may show this course as unavailable until a student route supports its new content key.`)) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await sendEditorMutation({ action: 'provision', institutionalCourseId: course.id })
      const nextCatalogue = await fetchOperatorCourses()
      setCatalogue(nextCatalogue)
      const refreshed = result.repositoryCourseId ? await loadCourse(result.repositoryCourseId) : false
      setNotice(refreshed ? { tone: 'success', text: result.created ? 'Repository identity created and linked.'
        : 'This course was already linked; no new identity was created.' }
        : { tone: 'error', text: 'The identity was linked, but the course view could not load. Select the course to retry.' })
    } catch (error) { report(error) }
    finally { setBusy(false) }
  }

  async function restore(revision: number, parentRevision?: number): Promise<void> {
    if (busy || !courseReady || activeCourse.current !== courseId || !selectedItem) return
    setBusy(true)
    setNotice(null)
    let approved = false
    try {
      const result = await sendEditorMutation({ action: 'review', itemId: selectedItem.item_id,
        expectedLockVersion: selectedItem.lock_version, revision, decision: 'approved',
        ...(parentRevision ? { parentRevision } : {}) })
      approved = true
      if (!result.lockVersion) throw new EditorApiError(503, 'The new lock version is unavailable.')
      await sendEditorMutation({ action: 'publish', itemId: selectedItem.item_id,
        expectedLockVersion: result.lockVersion, revision })
      const refreshed = await loadCourse(courseId, selectedItem.item_id)
      setNotice(refreshed ? { tone: 'success', text: `Revision ${revision} restored. Later history remains available.` }
        : { tone: 'error', text: 'The restore was recorded, but the latest history could not load. Select the item again.' })
    } catch (error) {
      report(error)
      if (approved) setNotice({ tone: 'error', text: 'Approval was recorded, but publication did not complete. Reload history before continuing.' })
    } finally { setBusy(false) }
  }

  if (denied) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-900">
    Operator access is unavailable. Sign in with an operator account to continue.
  </div>

  return <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
    <CoursePicker repositories={catalogue.repositories} institutional={catalogue.institutional}
      selectedCourseId={courseId} busy={busy} onOpen={id => { void loadCourse(id) }} onProvision={course => { void provision(course) }} />
    <div className="min-w-0 space-y-6">
      {notice && <div role={notice.tone === 'error' ? 'alert' : 'status'}
        className={`rounded-lg border p-4 text-sm ${notice.tone === 'error' ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
        {notice.text}
        {conflict && courseId && <button type="button" onClick={() => { void loadCourse(courseId, itemId) }}
          className="ml-3 font-semibold underline">Reload latest version</button>}
      </div>}
      {!courseId ? <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-700">
        Select a repository course or provision an unlinked catalogue course to begin.
      </div> : <>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Repository content workspace</p>
          <h2 className="mt-1 text-2xl font-semibold text-blue-950">{institutionalName
            ? `${institutionalName.course_code} · ${institutionalName.display_title}` : selectedCourse?.content_key ?? 'Course'}</h2>
          <p className="mt-1 text-sm text-slate-700">Content identity: {selectedCourse?.content_key ?? 'Loading'}
            {selectedCourse?.is_shared === true ? ' · shared/general' : ''}</p>
          <p className="mt-2 text-xs text-slate-600">Published overview, theory, and CBT revisions reach student learning pages on their next request.</p>
        </div>
        {loading && <p role="status" className="rounded-md bg-white p-4 text-slate-700">Loading course content…</p>}
        {!loading && !courseReady && <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Managed content for this course has not loaded. Retry before editing or reviewing.
          <button type="button" onClick={() => { void loadCourse(courseId) }}
            className="ml-3 font-semibold underline focus:outline-none focus:ring-2 focus:ring-blue-700">Retry loading course</button>
        </div>}
        {courseReady && <ContentList items={items} selectedId={itemId} busy={busy}
          onSelect={item => { if (activeCourse.current === courseId && item.course_id === courseId) void loadHistory(item) }}
          onNew={() => { if (activeCourse.current !== courseId) return; ++requestNumber.current; setItemId(null); setHistory(null); setParentHistory(null) }} />}
        {courseReady && <ContentForm key={selectedItem ? `${selectedItem.item_id}:${selectedItem.lock_version}` : `new:${courseId}`}
          courseId={courseId} item={selectedItem} allItems={items} busy={busy}
          onSave={mutate} />}
        {courseReady && selectedItem && history && <ContentHistory key={`${selectedItem.item_id}:${selectedItem.lock_version}`}
          history={history} parentHistory={parentHistory} busy={busy} onAction={mutate} onRestore={restore} />}
      </>}
    </div>
  </div>
}
