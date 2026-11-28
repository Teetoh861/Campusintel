BUA 300L First Semester catalog correction, prepared on 20 October 2026.

The approved source is the updated `CampusIntell-Master-Course-Catalog.docx`,
Business Administration rows 34-41 (Year 3, First Semester). Its SHA-256 is
`8318c07bbb7a65731cb34b380d33c338d396b0aba99f530a8703d766bca0d8db`.
The source labels itself Version 1.1; the earlier PDF editions contain the
superseded five-course offering.

| Code | Approved title | Source units |
| --- | --- | --- |
| BUA303 | Management Theory | 3 |
| BUA305 | Financial Management | 3 |
| BUA313 | Innovation Management | 2 |
| BUA321 | Business Start-Up | 2 |
| BUA323 | Supply Chain Management | 2 |
| BUS254 | Principles of Marketing | 2 |
| BUA319 | E-Commerce | 2 |
| BUA310 | Production & Operation Management | 2 |

Units are documented as source evidence. No units field or schema change is
introduced because `institutional_courses` has no units column.

The isolated branch `fix/bua-300l-catalog-correction` starts at `457602759695f57d1cd43e9df9a5d2d0f6c98f91`,
the fetched `origin/develop` head. The forward migration
`20261020100000_bua_300l_catalogue_correction.sql` performs one atomic block:

- Check the existing five fixed identities and their exact BUA/300L/First Semester mappings.
- Refuse unexpected mappings, conflicting new course codes or occupied reserved UUIDs.
- Add five institutional identities at UUID suffixes 150-154, with no repository content links and `is_free = false`.
- Assign BUA303 a new UUID ending in 150; retain the BUA302 UUID ending in 145.
- Remove only the BUA302 and BUA325 mappings for this selection, preserving both institutional records.
- Add the five new mappings and verify the exact eight-code result. BUA319, BUA321 and BUA323 retain their UUIDs and mappings.

The seeded totals become 154 institutional identities and 267 applicability
rows. The other 259 applicability rows, all 15 repository identities, the
11 confirmed content links and 32 faculty-wide GST mappings stay intact.
FBA311 and CIL318 are not introduced. Previous migrations, application
behavior, question banks and entitlement rules are unchanged.

Changed files are the migration, this report, the new
`supabase/tests/bua_300l_catalogue.test.sql`,
`supabase/tests/bua_300l_profile_selection.test.sql` and
`lib/courses/catalogue-upgrade.database.test.cjs`, plus updated expectations in
`supabase/tests/catalogue_v1_1.test.sql`,
`supabase/tests/course_registry_schema.test.sql` and
`supabase/tests/course_registry_access.test.sql`.

The focused SQL tests fail against the predecessor offering (five courses),
then pass after the migration. The full local SQL suite passes 1,380
assertions across 29 files. Of these, 22 assertions specifically cover the
new catalog and profile-selection behavior. A confirmed student with a live
session saves real BUA/300L/First Semester reference IDs and sees exactly
the eight approved identities, with no invented content availability.
Switching that profile to BUA 100L/200L retains its existing courses and
free GST classifications. Second Semester and another department do not
inherit the BUA 300L offering; the student's entitlement is unchanged.

Four additional database tests replay the actual migration against populated
predecessor data in transactions that roll back. They verify unchanged
historical BUA302/BUA325 uploads and generation references, a later BUA302
content link, unrelated offerings (including mappings of retired identities
elsewhere), profiles, usage records and an active entitlement grant. They
also verify refusal of an extra offering, an existing BUA303 code and an
occupied new UUID. Run them explicitly against a local test container with
`BUA_CATALOGUE_DB_TEST=1 BUA_CATALOGUE_DB_CONTAINER=supabase_db_<isolated-project> node --test lib/courses/catalogue-upgrade.database.test.cjs`.

Application validation passes 887 tests across 124 files, with 55 opt-in
tests skipped in the general run; the four new migration replay tests were
run separately and all pass. All 26 workflow tests pass. TypeScript and the
standard Next.js production build pass under Node 22. The initial sandbox
run blocked parser process sampling/local HTTP ports; the successful rerun
used the required local process/port permissions. Dependencies were installed
from the existing cache using the frozen lockfile and offline mode.

Historical references retain their original meanings: BUA302 never becomes
Management Theory, and neither old course donates content or personal
history to BUA303. The old identities remain readable in the institutional
catalog but no longer belong to this active student selection. Existing
foreign keys continue to resolve. A hosted database with manually changed
identities, mappings or reserved UUIDs will stop at the preflight guard and
require explicit reconciliation before deployment. Hosted data has not been
inspected, so the presence or absence of such history is unverified.

All database execution used a separate local project,
`CampusintelBua300lCatalog`, on port 56822. No hosted database changes,
commits, pushes or merges were performed.
