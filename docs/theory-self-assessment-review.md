# Theory self-assessment review handoff

- Repository: `Teetoh861/Campusintel`
- Feature branch: `feat/theory-self-assessment`
- Worktree: `/private/tmp/campusintel-theory-self-assessment`
- Base: `01240136764cfc953da1d2ebd0e023e3c6cbd01f` (`origin/develop`)
- Target: PRD v1.4 §4.4, self-assessed launch experience for 25 October 2026.

Status: independent review returned FAIL on one Medium finding (M1, student
answers sent to the server) plus five Low cleanups. All six are remediated
below; independent re-review is pending.

The source worktree was clean on `develop` at
`ff444ba4ac518d54fc843763743fe72a138cc10b`. The approved workflow fetched
`origin/develop` and created this isolated feature at the expected base above.
The source worktree was not fast-forwarded or edited. All implementation
changes remain unstaged and uncommitted.

## Review scope and behavior

- The course hub links to `/courses/[slug]/theory` only when at least one
  published question has a usable published model answer
  (`learning.theoryPractice`, computed from the same publication read and the
  same theory projection as the practice page). Each such question has an
  independent typed draft and assessment. Questions without a published model
  answer remain reading material on the hub.
- Course Detail and Theory practice share `theoryDisplayNumbers`. Labels are
  computed over every published theory question, including reading-only ones,
  so a question keeps the same Q number on both pages.
- The Theory practice page is `noindex, nofollow`.
- The initial page sends only question identity, revision, prompt, optional exam
  tip and display number to client components. Official answers and rubrics are
  returned only by a successful `POST /api/theory-practice` submission.
- Blank, whitespace-only and near-empty answers are valid. The answer is a
  browser-only draft limited to 20,000 UTF-16 code units by the textarea; the
  optional reflection is limited to 4,000. Neither is ever transmitted.
- The disclosure request is `{ courseSlug, itemId, publishedRevision }` only.
  The client builds it from those three fields, so no extra property can reach
  the wire. The server schema is strict: any `answer` field, even blank, is
  refused with 400 before session or publication work. The streamed JSON body
  is limited to 1 KiB (`THEORY_BODY_MAX_BYTES`); a full draft is refused with
  413. Tests prove a 20,000-character draft never appears in the request URL,
  headers or body, both at the client function and from the real component
  through a stubbed `fetch`.
- Submission checks trusted origin, live cookie-bound session, page continuity
  token, completed profile, central course identity and current publication.
  Stale question revisions and withdrawn answers refuse the reveal while the
  browser retains the draft. A second session check catches an account or
  session switch during content reads. Refreshed cookies and private/no-store
  response headers are preserved.
- `read_published_managed_content` remains the sole publication authority.
  Its existing SQL boundary excludes drafts, withdrawn content and dependent
  model answers/rubrics bound to another theory revision. There are no direct
  managed-table reads, elevated clients, static-answer fallbacks or SQL changes.
- Official model and rubric bodies render verbatim as React text. There is no
  HTML injection, generation, correctness judgment or AI call.
- Authored rubrics currently use `{ body: string }`. Explicit authored list
  items and indented continuation lines become self-review entries; the full
  original rubric is also displayed. Unstructured prose remains one whole-rubric
  review entry. No criteria, weights or official numerical marking scheme are
  synthesized. Students choose Covered / Partly covered / Not yet covered for
  each entry. The displayed self-score counts those selections and explicitly
  does not calculate rubric marks.
- Without an authored rubric, students compare with the model answer and may
  record a reflection. There is no generated checklist or numerical score.
- Completion and score summaries explicitly identify student self-assessment
  and state that judgments are not verified or AI graded.
- Drafts, reflections and ratings remain in memory on the page; written text
  never leaves it. Closing a
  question preserves its mounted state. Refreshing, navigating away, changing
  the published question revision or changing the page session discards it.
  The page states that written answers and reflections stay on the page, are
  never sent to CampusIntell and are not saved to attempt history.

## Study instrumentation

The existing Vercel Analytics transport is reused. Both event names and their
payload builders are part of the shared `lib/analytics/product-events.ts`
contract (no other active branch touches that file):

| Event | Trigger | Properties |
| --- | --- | --- |
| `theory_answer_submitted` | Server accepts a disclosure request and returns current feedback | `course_slug`, `has_rubric` |
| `theory_self_assessment_completed` | Student finishes review, once per mounted assessment | `course_slug`, `has_rubric`, `covered_points`, `partly_covered_points`, `revisit_points` |

Answers, reflections, question wording, user IDs, session IDs, cookies and
continuity tokens are excluded from these event payloads. The server transport
receives only a fixed non-identifying user-agent header, following the existing
auth-event pattern. Analytics failures cannot block assessment. Browser event
delivery remains subject to the existing analytics availability and blocking.
There is no durable theory attempt store in the existing infrastructure; the
CBT attempt schema/RPC has not been repurposed.

Known counting limitation (accepted for launch): `theory_answer_submitted` is
recorded once per accepted POST. "Try this question again" legitimately counts
again, and a signed-in student who replays the request directly is counted on
every replay; there is no rate limit or deduplication. Read it as disclosures,
not distinct students or attempts. `theory_self_assessment_completed` is
browser-side, counted once per mounted assessment, and like any client event
can be sent by a student directly. Neither event carries content or identity,
so the limitation affects only analytics interpretation. No deduplication
subsystem is added in this change.

## Entitlement integration for Claude Code

No entitlement, AI, Account, profile, payment, OTP, operator editor or managed
content authority files were modified. Existing production files changed:

- the course hub page (theory-practice link, shown only when practicable) and
  its section renderer (shared numbering);
- `lib/courses/read-model.ts`, which adds `learning.theoryPractice` from the
  publication rows it already reads (no extra read);
- `lib/analytics/product-events.ts`, which registers the two theory events.

Apply the entitlement task's authoritative policy to both the new theory page
and `POST /api/theory-practice`. The shared integration point for published
theory reads is
`lib/theory-practice/published.ts:getTheoryPracticeForVerifiedStudent`, which
already delegates central course resolution to
`getStudentCourseBySlugForVerifiedStudent` on the same verified client. If that
read model gains an entitlement outcome, adapt the theory result/UI/API mapping
to that contract during integration. Current behavior follows the base branch's
existing account, profile and publication boundaries. This change adds no
separate entitlement decision, subscription state or quota consumption.

## Verification

Runtime: Node 22.23.2, pnpm 9.15.9. Dependencies were installed with the committed
lockfile; no package or lockfile changes.

- Focused server/API checks: 21 passed.
- Focused new UI/page checks plus existing course-detail checks: 17 passed.
- `pnpm exec tsc --noEmit`: passed.
- Real Chrome checks with repository CSS and Hanken Grotesk: 27 passed at
  320×568, 390×844, 834×1194, 1200×800 and 1440×900, including live resize and
  long unbroken model-answer text. Native Enter submission, required point
  decisions, editing, retry focus and failure recovery passed; no runtime or
  hydration errors remained.
- Full repository verifier and browser evidence: final results are recorded in
  the generated review package's accompanying verification report.

Remediation verification (Node 22.23.2, pnpm 9.15.9):

- Focused suites (theory route, client, schema, publication, submit,
  experience, page, Course Detail, read model, product events): 70 passed.
  They cover: a 20,000-character draft absent from the request URL, headers
  and body at the client and from the real component through a stubbed
  `fetch`; `answer` fields (blank, short, full, non-string) refused with 400
  or 413 and no publication read or event; the identity-only request reaching
  feedback after session and publication checks; stale, foreign and withdrawn
  feedback refused; shared numbering on both pages; the hub link hidden
  without a usable model answer and for rubric-only questions; `noindex,
  nofollow` on the practice page; focus on reveal and completion, required
  point decisions and draft retention after a refused disclosure.
- `pnpm exec tsc --noEmit`: passed.
- Full verifier: application tests 807 passed, 0 failed, 33 skipped; workflow
  tests 26 passed; TypeScript, production build, diff whitespace and database
  tests passed; managed-content parity skipped as expected. Result: PASS.
  A first verifier run reported one failing application test out of 807. Files
  were edited while that run was in progress (a whitespace fix and a test
  title); the verifier does not retain per-test output. An immediate
  application-suite rerun passed 807/807, and the final full verifier above
  ran on the unchanged final source.
- The 27 Chrome checks were not re-run for this remediation. The submission,
  focus and draft-retention code paths are unchanged apart from the request
  payload; visible changes are limited to the hub link condition, question
  labels and the privacy notice wording.

The first database run found that the local backup lacked the already-committed
base migration `20261016140000_ai_practice_uploads.sql`. It was applied locally
before final verification. No migration file or hosted database was changed.

One verification retry stalled in the unchanged AI parser isolation suite.
That suite passed all 9 tests when run alone; only the stalled verifier's own
processes were stopped before restarting the standard verifier. No AI-domain
file was changed. The final verifier report is the acceptance evidence.

Reproduce repository verification:

```sh
node scripts/dev-workflow/cli.cjs verify
node scripts/dev-workflow/cli.cjs review
```

The verifier's managed-content parity gate is expected to skip: no managed
content sources or generated SQL artifacts changed. Its database gate is
required because the change adds an API route. Existing managed-content SQL
tests cover question/answer/rubric publication and theory-revision binding.

Browser checks use actual theory components and repository CSS in an isolated
React fixture with mocked API responses. They verify native keyboard and form
behavior and responsive layout; they do not replace live account/publication
checks. Those boundaries are covered by service/API tests and existing SQL
tests. No production data or hosted service is used for browser fixtures.

## Independent reviewer checklist

1. Inspect the complete working-tree patch including every untracked file.
2. Check that no answer or rubric enters the initial client props/RSC payload.
3. Exercise typed, blank, whitespace-only and short submissions; confirm the
   request body never contains the answer and any `answer` field is refused.
4. Withdraw the model answer or revise the theory question after opening a
   practice page; confirm submission refuses stale feedback and retains the draft.
5. Check authored list rubrics and plain-prose rubrics without inventing marks;
   verify model-answer-only questions have no fabricated scoring criteria.
6. Check session expiry/switching, incomplete profiles, cross-origin requests,
   oversized bodies and private response/cookie propagation.
7. Check keyboard entry, required per-point decisions, focus after reveal and
   completion, retry, independent question drafts and phone/desktop overflow.
8. Integrate the entitlement policy at both new entry points before release.

## Exact changed-file inventory

Modified:

- `app/courses/[slug]/course-detail.test.cjs`
- `app/courses/[slug]/page.tsx`
- `app/courses/[slug]/sections.tsx`
- `lib/analytics/product-events.test.cjs`
- `lib/analytics/product-events.ts`
- `lib/courses/read-model.test.cjs`
- `lib/courses/read-model.ts`

Added:

- `app/api/theory-practice/route.test.cjs`
- `app/api/theory-practice/route.ts`
- `app/courses/[slug]/theory/SelfAssessment.tsx`
- `app/courses/[slug]/theory/TheoryAttempt.tsx`
- `app/courses/[slug]/theory/experience.test.cjs`
- `app/courses/[slug]/theory/loading.tsx`
- `app/courses/[slug]/theory/page.test.cjs`
- `app/courses/[slug]/theory/page.tsx`
- `app/courses/[slug]/theory/presentation.ts`
- `docs/theory-self-assessment-review.md`
- `lib/theory-practice/client.test.cjs`
- `lib/theory-practice/client.ts`
- `lib/theory-practice/contract.ts`
- `lib/theory-practice/events.ts`
- `lib/theory-practice/fixtures.cjs`
- `lib/theory-practice/numbering.ts`
- `lib/theory-practice/practice.test.cjs`
- `lib/theory-practice/projection.ts`
- `lib/theory-practice/published.test.cjs`
- `lib/theory-practice/published.ts`
- `lib/theory-practice/rubric.ts`
- `lib/theory-practice/submit.test.cjs`
- `lib/theory-practice/submit.ts`

Total: 30 files (7 modified, 23 added). No files are deleted or staged.
