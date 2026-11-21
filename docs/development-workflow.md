<!-- docs/development-workflow.md — Operator commands and safety gates for feature work. -->
# CampusIntel development workflow

Use Node 22 and pnpm 9. Run these commands inside a Campusintel Git worktree.
The commands verify the Git origin is `Teetoh861/Campusintel` and the package
identity is `campusintel`; a similarly named folder is insufficient.

1. **Start from a clean source worktree:**
   `node scripts/dev-workflow/cli.cjs start feature/my-change`
   This fetches current `origin/develop`, creates a new branch and an isolated
   sibling worktree under `../Campusintel-worktrees/`, then prints its path and
   base SHA. For a chosen location, add `--worktree /absolute/path`.
2. **Implement in the printed worktree.** Install dependencies there with
   `pnpm install --frozen-lockfile` if needed.
3. **Verify:** `node scripts/dev-workflow/cli.cjs verify`. The summary shows
   application and workflow tests, TypeScript, build, tracked and untracked
   whitespace, and the optional checks. Use `verify --db` or
   `verify --content` to force an optional check.
4. **Generate the review package:** `node scripts/dev-workflow/cli.cjs review`.
   Its printed temporary directory contains `summary.md` and `review.patch`.
   The patch includes committed and working-tree changes plus every nonignored
   untracked file. The command never stages files. It rejects sensitive paths
   and common credential signatures; inspect the package before sharing it.
5. **Human review, then stage, commit, and push manually.** Open a PR into
   `develop`. PR CI repeats the checks and starts a local database only when
   the changed paths require SQL tests. Vercel deployment is separate.
6. **After a human merges the PR,** use a different clean Campusintel worktree
   to run `node scripts/dev-workflow/cli.cjs cleanup feature/my-change`.
   Cleanup fetches `origin/develop`, requires the feature tip to be an ancestor
   of it, fast-forwards local `develop`, and removes only the merged local
   worktree and branch. The caller can be on any clean non-feature branch;
   branch deletion checks updated local `develop`, which matches fetched
   `origin/develop`. For a pushed feature, cleanup temporarily uses local
   `develop` as its deletion upstream and restores the original upstream if
   cleanup fails. Move ignored private files such as `.env.local` out of the
   feature worktree first; cleanup refuses to remove them. It leaves remote
   branches alone.

The verifier runs managed-content generation/parity checks for changes under
`lib/data/`, `scripts/managed-content/`, or the generated seed/parity SQL files.
It runs local Supabase tests for those changes and for `supabase/`,
`lib/supabase/`, `lib/auth/`, `lib/managed-content/`, `lib/quiz-attempts/`,
`lib/operator/`, `lib/bookmarks/`, `lib/profile/`, `app/api/`, or the course
registry. Start a local database with `supabase db start` before verifying such
work. A missing service is reported as **BLOCKED**; a running service whose
SQL tests fail is reported as **FAIL**. Both make verification exit nonzero.
