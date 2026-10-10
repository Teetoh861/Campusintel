# Question report foundation

This foundation adds no student or operator UI and does not change assessment
behavior. Future surfaces can submit the exact managed identity they displayed.

`POST /api/question-reports` accepts strict JSON:

```json
{
  "courseId": "canonical-public-courses-uuid",
  "itemId": "managed-content-item-uuid",
  "revision": 1,
  "questionId": "stable-cbt-question-uuid",
  "attemptId": "optional-owned-attempt-uuid",
  "note": "Optional plain text, at most 1000 Unicode code points"
}
```

The IDs shown are placeholders; actual selectors must be UUIDs. For theory,
omit `questionId` and `attemptId` or supply null. Notes that are omitted, null,
empty or whitespace-only become null. The note limit applies before trimming.
Text is stored as plain text without interpreting HTML or Markdown.

The request requires the existing same-origin JSON protections, live cookie
session and `x-campus-account-continuity` header from the server-rendered page.
It accepts no reporter ID, status, kind or other unknown properties. The
database derives the reporter from `auth.uid()` and validates every selector.
There must be a publication event for that exact item/revision; replacement
or withdrawal does not make a previously published revision ineligible.

Attempt context is optional. If supplied, it must identify the reporter's
same-course durable attempt with the exact item, stable question UUID and
revision in its immutable snapshot. Inconsistent context is rejected, including
on retries. No attempt state or managed content is written by reporting.

Successful responses contain only `status` and `reportId`: `reported` (201)
or `already-reported` (200). Deduplication is permanent per reporter/item/revision,
including after disposition. Retries preserve the original note and attempt
context. Errors return `invalid-request` (400, or the established request
protection status), `signed-out` (401), `session-changed` (409), `limited` (429)
or `unavailable` (503), without database details or content payloads.

Because an authenticated caller could enumerate many published items, a small
rolling cap accepts at most 20 new reports per account per hour. It reuses the
existing advisory-lock limiter pattern over report rows, without modifying
the auth limiter schema. Duplicates return their original identity even when
the cap is exhausted. The unique constraint remains the durable dedupe rule.

All report tables have RLS and no direct API-role grants or policies. The narrow
authenticated RPCs follow managed-content's live-account/operator boundaries:

- `submit_question_report(course UUID, item UUID, revision integer,
  question UUID?, attempt UUID?, note text?)` derives and validates ownership.
- `list_question_reports(status?, course UUID?, limit = 100, offset = 0)` is
  operator-only, with a maximum page size of 500. It provides canonical course
  ID/content key, exact question context, note, status and timestamps. It omits
  reporter identity, profiles, email, phone and question/answer payloads. Existing
  operator managed-content history can inspect the referenced revision separately.
- `disposition_question_report(report UUID, status)` is operator-only and accepts
  `resolved` or `dismissed` for an open report. It records operator identity and
  timestamp, preserving the original row/evidence. Same-status retries return
  `unchanged`; a different terminal disposition returns `conflict`; missing
  reports return `not-found`. Invalid status selectors raise a sanitized invalid
  argument error. Disposition does not edit the question.
- `question_report_metrics(course UUID?)` is operator-only. It returns all-time
  `cbtReportCount`, `theoryReportCount`, `attemptCount` and
  `cbtReportsPer1000Attempts`, including terminal reports and all durable started
  attempts, finished or unfinished. The rate is
  `1000 * CBT report rows / quiz_attempts rows`, or null for zero attempts.
  Theory has only a separate report count, with no fabricated denominator.

Database functions recheck the live session; operator authorization reads the
existing server-owned profile role. Future queue consumers can use these RPCs
with the ordinary cookie-bound client. No service-role table access, separate
admin application or external analytics integration is needed.
