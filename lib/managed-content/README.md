<!-- lib/managed-content/README.md — Managed content storage and publication foundation. -->

# Managed content foundation

`public.courses.id` is the only course foreign key for verified learning content.
Institutional catalogue rows, applicability, `is_shared`, and `is_free` do not
own copies of content. A shared course therefore has one set of managed items.

Each item has a durable identity and a family: course overview, note, CBT
question, theory question, model answer, or rubric. Model answers and rubrics
reference a theory question in the same course. CBT items carry the existing
`questionId` UUID as `question_id`; revising their wording never changes it.
`source_key` retains course-local repository identifiers, including the numeric
theory IDs in the seeded content.

Revisions are append-only. A review records its decision for one revision.
Publishing points an item at an approved revision and records an event; editing
does not move that pointer. Republishing an earlier reviewed revision provides
rollback, and unpublishing clears the pointer while retaining history. Every
edit, review, publish, and unpublish call requires the item's previous
`lock_version`; a stale call fails instead of overwriting another operator.
Rejecting the currently published revision atomically unpublishes it and
records that withdrawal beside the rejection decision.

An answer or rubric review records the exact theory revision it evaluated.
Its publication carries that binding. The student read boundary includes the
dependent item only while the theory question publishes that same revision.
After theory wording changes, an operator can deliberately review and publish
the dependent content again for the new revision, even when its own wording
does not change. Unique indexes keep one course overview per repository course
and one model answer and one rubric per theory item; notes and questions remain
multi-item families.

The database tables have RLS with no browser-facing policy or table grants.
Authenticated callers use the narrow functions in
`20261002100000_operator_managed_content.sql`. Each function checks the live
Auth session; operator functions also read `public.profiles.role` from the
database. `read_published_managed_content(course_uuid)` returns only published
revisions, and hides linked answers/rubrics while their parent question is
unpublished or publishes a different revision. `getPublishedManagedContent`
adds an application-side live Auth check and validates the returned shape.
Student pages do not call it yet.

The operator workspace at `/admin` discovers repository identities and
institutional catalogue entries separately. Its guarded route uses the
existing mutation functions, plus `provision_repository_content` for atomic
link creation and `get_managed_content_history` for operator-only revision,
review, and publication inspection. Provisioned `content_key` values derive
from the new repository UUID, not catalogue code or title. Similar catalogue
aliases are not merged automatically.

A newly provisioned repository key has no code-backed student page in this
branch. The later content cutover must define how that linked catalogue course
is presented to students until its managed content becomes readable there.

## Repository content seed

`scripts/managed-content/generate.cjs` derives the seed migration and database
parity snapshots from the committed course, quiz, theory, and topic-note data.
Run it with `--check` to detect stale generated artifacts. The seed uses
`public.courses.id`, keeps every CBT `questionId` as `question_id`, and stores
numeric theory identity in `source_key`. Model answers reference their theory
item and publish against theory revision one. Source rubrics do not exist, so
none are seeded.

Course overviews keep the source overview prose, syllabus topics, exam focus,
key takeaways, and formula cards as structured fields. Topic notes keep their
key points and exam tips; calculator tricks remain notes with a distinct type,
example, and optional formula. The editor preserves these structured fields
when revising the title or body. A later editor slice will need controls for
changing the structured fields themselves.

Each seeded item has one approved and published revision with the reserved
`00000000-0000-4000-8000-000000000042` migration actor. That UUID is not an
Auth account. The database-owner-only replay function skips records proven to
be the same migration-owned item, including records edited later by operators;
it cannot be called through browser API roles.

Course route slugs, catalogue labels, credits, flags, textbooks, resource
metadata, and assessment settings remain outside managed learning content.
The quiz bank's section list and order, sampling limit, and timer are still
code-backed assessment settings. The later student cutover must provide those
settings separately before replacing the current quiz read path.

The later student cutover must replace code-backed reads deliberately and add
entitlement checks where required. Content payloads are plain text/structured
data; rendering should escape them through React rather than injecting HTML.
