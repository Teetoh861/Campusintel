# Orientation quiz, phase 1

Players enter through `/orientation`, or the active quiz card on their Dashboard. Operators use `/admin/orientation`. Both routes reuse the normal account guards. Quiz admission also checks the live, confirmed account and completed profile in the database.

## Import

Keep the real question pack outside version control. The root object has `title` (up to 100 characters), `kind` (`official` or `practice`), and `questions`.

Each question has `category` (`orientation`, `general`, or `campusintell`), `spare` (boolean), `prompt` (up to 240 characters), and `options`. Each of its two to four options has `text` (up to 120 characters) and `correct` (boolean). Exactly one option must be correct, and option text must be distinct. Each category needs five main questions. There must also be at least three spares, all from the general or CampusIntell categories and independent of the talks. Any unused spare can replace any main question. Main questions keep their source order; spares follow them. At most 45 questions are accepted.

Validate without credentials or a database:

```sh
node scripts/orientation/import.cjs validate /path/to/private-pack.json
```

For an import, supply `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `ORIENTATION_OPERATOR_EMAIL`, and `ORIENTATION_OPERATOR_PASSWORD` through the process environment. The script never reads a repository environment file. Use an explicit event UUID and the local project's URL:

```sh
node scripts/orientation/import.cjs import /path/to/private-pack.json --event-id UUID --url http://127.0.0.1:54321
```

The signed-in operator is checked again inside the import function. Repeating the same UUID and checked pack returns the existing event; a different pack under that UUID is refused. Imports create a draft. Hosted targets additionally require HTTPS and `--allow-hosted`; phase 1 verification uses only local targets.

## Run and switch off

Choose the imported quiz, preview its questions, enter and save a prize for each winning position, and open the lobby. The number of prizes sets the number of winners; at least one saved prize is required before Start. The host displays and reads out the six-digit PIN. The local QR encoder includes it in the URL fragment. Players confirm their first name and surname before entering. The joining poster at `/admin/orientation/poster` prints a QR and link with no PIN; the host reads the PIN aloud. Play needs no projector. The optional big screen is last in phase 2, if time allows.

Start, Next, and Skip carry the current round ID. Skip voids that round and uses any unused independent spare. A skipped round contributes no score or answer time. Next waits for the current deadline. End becomes available after the fifteenth question closes. An exact tie requires Start draw when its positions would receive different saved prize names, including a position with no prize. Ties wholly inside identical prizes need no draw, and ties outside the prizes need no draw. One host action resolves every affected group and records its full order, the operator and the time. The frozen correct counts and times stay unchanged; the draw supplies the final positions. Ties needing no draw keep their shared position on phones, the host and staff lookup. Prize names and the prize list can be edited until End. End freezes their snapshot with the final scores, including while a draw is pending. Winners see their awarded position, full name, prize and claim code.

Operators can collect on the host screen or `/orientation/collect`. The host can also add a confirmed account by email to this event's staff list. No email is sent and no account role changes. Assigned staff can only look up and collect this event's codes; they cannot preview questions or run the game. They see the matched name, winning position, prize and collection status. Wrong codes show `No winner with this code.` Host and staff collection share the same atomic receipt, including who collected it and when. Repeating a collection leaves that first receipt unchanged. Removing a staff account immediately revokes future access.

Switch off moves the event to `off`, stopping joining and play. This is terminal for that event; import a new event UUID for another run. Existing winners can still see their prize status. There is no environment switch, editor, restart command, or automatic record deletion in phase 1. Practice and official events have separate rows and data; the rehearsal workflow and retention cleanup are deferred to phase 2.

## Timing and polling

Start schedules a ten-second countdown before question 1’s four-second get-ready. The first answer window therefore opens fourteen seconds after Start. Each later round has a shared four-second get-ready period. Every answer window lasts exactly fifteen seconds. No question is included in the phone response during the initial countdown, and phones switch to two-second polling as soon as Start is observed. The database records `clock_timestamp()` after the event, round, and player locks and accepts only `opens_at <= accepted_at < closes_at`. A retry returns the first stored choice, including after the deadline. Scores count correct answers; only their elapsed time breaks ties. Correct counts and times are frozen before the one-time draw; recorded draw orders supply positions for the affected ties.

Phones poll approximately every five seconds in the lobby and every two seconds live, with jitter and one request in flight. Inactive events and switched-off play stop polling; an uncollected winner keeps checking for the collection receipt until it arrives; reload the Dashboard or follow the QR link when the host opens a new lobby. The countdown uses server timestamps and a monotonic browser clock. Get-ready uses the response receipt as its baseline so outbound polling delay cannot enable options early; the closing countdown conservatively charges the full request round trip. The initial ten-second countdown gives five-second lobby polls time to move onto the live cadence before question 1 opens. Network failures can still prevent a phone receiving an update; reconnecting never extends an answer deadline.

Each poll sends the existing selected HttpOnly session cookie to a same-origin route. The server forwards only its access token to one PostgREST RPC. PostgREST verifies the token; SQL rechecks the live session, account, setup, or operator role. Polling does not refresh a token or call Supabase Auth. An expired session asks the user to sign in. Responses are private and uncacheable.

## Checks

Run the focused non-database tests with the repository TypeScript loader:

```sh
node --require ./lib/auth/test-loader.cjs scripts/dev-workflow/run-tests.cjs scripts/orientation/pack.test.cjs lib/orientation/transport.test.cjs lib/orientation/poll-server.test.cjs components/orientation/owner-changes.test.cjs
```

Database tests are opt-in. Wait for the shared stack to be released for this worktree and apply its migrations before running them. Never point this fixture at hosted data. It creates disposable local accounts, sessions, and events, and removes them afterwards. `ORIENTATION_DB_CONTAINER` can name the released local database container; its default is `supabase_db_Campusintel`.

```sh
ORIENTATION_DB_TEST=1 node --require ./lib/auth/test-loader.cjs scripts/dev-workflow/run-tests.cjs lib/orientation/orientation.database.test.cjs lib/orientation/security.database.test.cjs lib/orientation/ties.database.test.cjs
supabase test db
```

The database tests cover boundary predicates, locks crossing the deadline, competing answer retries, competing Next and Skip commands, replacement spares, late admission, hidden names, ranking, final draws, prize editing and freezing, the ten-second start, private claims, staff email assignment and revocation, collection replay, event isolation, and account/role restrictions. Their accelerated fifteen-question fixture is additional to the required manual three-account game; it does not replace a rehearsal on real phones.

## Local game checklist

After the stack is released, use the synthetic pack with every correct answer at A. Run the normal sign-in and setup for an operator and three players, with a separate confirmed staff account. Save two named prizes before Start.

Player A answers A on odd-numbered questions and B on even-numbered questions. Player B answers B throughout. Player C joins at question 2 and answers B throughout. After question n, A has ceil(n / 2) correct; B and C have zero. Before the draw the scores are 8, 0, 0 and ranks are 1, 2, 2. After the draw the chosen player has position 2 and the other has position 3. Only A has any correct-answer time. The tie at the two-prize cut-off needs one recorded draw.

Change a prize during play, then verify the final prize matches that change and cannot be edited after End. Add the staff account by email. Check a winning code on the staff phone against that winner's phone, then collect it and retry collection. Verify the same receipt on host and staff, with the original actor and time. Record each score, position, prize, code match and receipt result. Use the same checks whenever the game is rehearsed again.

## Initial local verification — 27 November 2026, base 36e4ef1

The full fifteen-question game passed with an operator, three players and separate event staff, using the normal sign-in and profile forms. Player C joined at question 2. Question 5 used a general spare in place of an orientation question. A connection loss during question 4 recovered with one locked answer and live polling cadence.

| Player | Answers | Correct | Correct-answer time | Position |
| --- | ---: | ---: | ---: | ---: |
| A | 15 | 8 | 6,508,497 microseconds | 1 |
| B | 15 | 0 | 0 | 2 |
| C | 14 | 0 | 0 | 2 |

The ledger was calculated independently from accepted and opening timestamps and compared with every stored score and position. The cut-off draw was recorded once. The first prize was edited during play and froze as `Book voucher and notebook`; the second was `CampusIntell tote bag`. Winner and staff views matched on name, position, prize and claim code. A wrong code, a non-staff account and another event were refused. Collection after Switch off updated the winner's phone; host replay preserved the original staff member and timestamp. Disposable accounts and events were removed. No real question pack was imported.

Checks: 29 focused tests passed; all 12 quiz runtime database tests passed; the SQL database suite passed 6,293 checks across 61 files. The app suite completed across 243 files with 1,813 passes, 230 optional skips and no failures, after retrying 97 files cancelled by an interrupted long run in smaller batches. Phone and staff layouts were reviewed at 375 px, and the host at 1280 px; host results require normal vertical scrolling. The PIN-free poster QR was decoded independently and its single-page print reviewed.

At that initial base, the normal production build was blocked: Turbopack rejects existing internal Google-font imports; the Webpack alternative compiles, then fails its generated route type check on the unchanged optional default props argument in `app/profile-selection/page.tsx:49`. The full TypeScript check reports that same existing page. The local game used Webpack's experimental compile mode and `next start`, with normal CSP enforced; this is runtime evidence, not a passing full production build. No setup code or build configuration was changed to bypass those failures.

Phase 2 remains unbuilt: the rehearsal workflow, 300-player load test, sign-up/email limit changes, event-record cleanup and full device/browser matrix. The optional big screen is last, only if time allows. The load test must include the actual same-origin polling proxy and PostgREST token verification path.

## Follow-up on base 4a41161

The merged Dashboard retains both the quiz card and the tester-only selection link from Batch 1. Local font files and the new profile-selection screen are inherited unchanged from develop. Old generated build output was archived and Next route types regenerated before the standard checks.

The prize tie policy now covers internal winning ties, the cut-off, and multiple independent groups in one atomic draw. Identical saved prize names need no draw when all tied players receive that prize. Prize versus no prize still requires a draw. Each affected group stores its candidates, starting position, prize outcomes and complete drawn order. Replays reuse that record and the original claim codes. Final score counts and times remain frozen; every phone, host result and staff lookup uses the same final position projection.

New opt-in database tests cover the different-prize internal tie, identical-prize winners, identical prizes crossing the cut-off, ties below the prizes, unequal correct-answer times, and concurrent multi-group draws. These require EST's explicit release of the shared stack before execution. The focused non-database checks, including the merged Dashboard, passed all 60 tests. The standard `pnpm exec tsc --noEmit` and normal `pnpm build` both passed on this base; no alternate bundler or skipped check was used. A clean-base failure comparison was unnecessary because neither failed. The multi-group host screen and matching phone/staff winner screens were reviewed at 1280 px and 375 px respectively, with no horizontal overflow. The database tests ran on base ae6406e, below.

## Verification on base ae6406e — 28 November 2026

The branch moved onto develop ae6406e (Batch 2), which changes none of the quiz files. The six migrations are renumbered 20261128100000 to 20261128100500 so they apply after Batch 2's 20261127300000 to 20261127300200; no file referred to the old numbers. A local reset applied every migration in order.

The SQL suite passed 6,321 checks across 62 files, and all 17 opt-in database tests passed: five tie tests, seven quiz runtime tests and five security tests.

The three-account game was repeated with a tie inside the winners, on the normal `next build` output served by `next start`. Start refuses more prizes than players, so two prizes were saved before Start; after Player C joined at question 2, the host edited the first prize and added a third during question 6. Scores finished 8, 0, 0, so B and C tied exactly for positions 2 and 3, which carry different prizes. End planned one draw group (positions 2–3, two winning places) and the phones showed the pending draw. One recorded host draw placed B second and C third. Every phone, the host and the staff lookup then showed the same positions, names, prizes and claim codes, while the frozen results kept the shared rank 1, 2, 2. Late joining, the spare at question 5, offline recovery at question 4, staff checks, collection after Switch off and the receipt replay passed as before. Phones and staff were reviewed at 375 px and the host at 1280 px.

| Player | Answers | Correct | Correct-answer time | Final position | Prize |
| --- | ---: | ---: | ---: | ---: | --- |
| A | 15 | 8 | 6,644,588 microseconds | 1 | Book voucher and notebook |
| B | 15 | 0 | 0 | 2 (drawn) | CampusIntell tote bag |
| C | 14 | 0 | 0 | 3 (drawn) | Campus water bottle |

The repository verifier passed the application tests (1,828 passes, 240 optional skips), the workflow tests (43), `pnpm exec tsc --noEmit`, `pnpm build`, the landing page check and whitespace. Its database row was blocked only because the stack had already been stopped, after the SQL suite above passed on the same files. The copy checker passed 15 of 15 and reads 31 quiz files. A TypeScript rerun on base 4a41161 had crashed with SIGSEGV under heavy machine load; it did not recur here.
