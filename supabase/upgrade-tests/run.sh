#!/usr/bin/env bash
set -euo pipefail

# pgTAP's regular suite sees only the final schema. This harness uses the
# Supabase CLI's migration boundary to test the real SQL file against Phase A.
# It resets only the local database and restores the latest migrations on exit.
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd -- "$script_dir/../.."

phase_a_version=20260915100000
phase_b_version=20260918190000
phase_c_slice_one_version=20260923100000

restore_current_local_database() {
  local prior_status=$?
  trap - EXIT
  if ! DO_NOT_TRACK=1 supabase db reset --local --no-seed; then
    printf 'Could not restore the local database to current migrations.\n' >&2
    exit 1
  fi
  exit "$prior_status"
}
trap restore_current_local_database EXIT

printf 'Testing migration over existing all-null Phase A profiles...\n'
DO_NOT_TRACK=1 supabase db reset --local --version "$phase_a_version" \
  --sql-paths ./upgrade-tests/phase_a_profiles.sql
DO_NOT_TRACK=1 supabase migration up --local
DO_NOT_TRACK=1 supabase test db --local \
  supabase/upgrade-tests/upgrade_success.test.sql

for legacy_field in department level semester; do
  printf 'Testing rejection with a non-null legacy %s...\n' "$legacy_field"
  DO_NOT_TRACK=1 supabase db reset --local --version "$phase_a_version" \
    --sql-paths ./upgrade-tests/phase_a_profiles.sql \
    --sql-paths "./upgrade-tests/legacy_${legacy_field}.sql"

  if DO_NOT_TRACK=1 supabase migration up --local >/dev/null 2>&1; then
    printf 'Migration unexpectedly accepted a non-null legacy %s.\n' \
      "$legacy_field" >&2
    exit 1
  fi
  # The assertions distinguish the intended first-statement guard failure
  # from a later error: no new object or history row may survive, and the
  # field-specific legacy value must still be present.
  DO_NOT_TRACK=1 supabase test db --local \
    supabase/upgrade-tests/upgrade_abort.test.sql
done

printf 'Testing atomic rollback of a late Phase C migration failure...\n'
DO_NOT_TRACK=1 supabase db reset --local --version "$phase_b_version" \
  --sql-paths ./upgrade-tests/course_registry_failure.sql

if phase_c_failure=$(DO_NOT_TRACK=1 supabase migration up --local 2>&1); then
  printf 'Course registry migration unexpectedly accepted incomplete mappings.\n' \
    >&2
  exit 1
fi

if [[ "$phase_c_failure" != *"Expected exactly 38 approved course applicability rows"* ]]; then
  printf '%s\n' "$phase_c_failure" >&2
  printf 'Course registry migration failed before its final integrity guard.\n' \
    >&2
  exit 1
fi

DO_NOT_TRACK=1 supabase test db --local \
  supabase/upgrade-tests/course_registry_abort.test.sql

printf 'Testing direct upgrade from committed Phase C Slice 1...\n'
DO_NOT_TRACK=1 supabase db reset --local \
  --version "$phase_c_slice_one_version"
DO_NOT_TRACK=1 supabase migration up --local
DO_NOT_TRACK=1 supabase test db --local \
  supabase/upgrade-tests/institutional_catalogue_upgrade.test.sql

printf 'Testing atomic rollback of a late catalogue correction failure...\n'
DO_NOT_TRACK=1 supabase db reset --local \
  --version "$phase_c_slice_one_version" \
  --sql-paths ./upgrade-tests/institutional_catalogue_failure.sql

if catalogue_failure=$(DO_NOT_TRACK=1 supabase migration up --local 2>&1); then
  printf 'Catalogue correction unexpectedly accepted incomplete mappings.\n' \
    >&2
  exit 1
fi

if [[ "$catalogue_failure" != *"Expected exactly 196 institutional applicability rows"* ]]; then
  printf '%s\n' "$catalogue_failure" >&2
  printf 'Catalogue correction failed before its final integrity guard.\n' \
    >&2
  exit 1
fi

DO_NOT_TRACK=1 supabase test db --local \
  supabase/upgrade-tests/institutional_catalogue_abort.test.sql

printf 'All seven local upgrade scenarios passed.\n'
