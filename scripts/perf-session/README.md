# Student request identity measurements

`fetch-trace.cjs` is the load-time audit tracer, extended only with selected column names (no filter values) so the course reader’s selection recheck can be distinguished from the initial profile read. `call-budget.cjs` ports the audit’s dependency-depth counter, including its 0.5 ms tolerance.

The identity budget is **two calls in a row**. The proxy keeps its existing lifecycle check and restricted-account redirects, including navigations that reuse the root layout. The render calls Auth `getUser` once alongside `read_student_context`; neither result is used until the cookie JWT, remote user and database session match. Local session data supplies only the transport token, never identity. Passing that token explicitly to Auth avoids the SDK mutex serializing the independent reads. A claims/JWKS verification also runs alongside them. Identity calls made after page data starts are included, so moving a duplicate check later cannot hide a regression. Course-list/profile selection rechecks and content authorization remain page-owned work.

The render client and verified snapshot use React `cache()`. A cached scope marker opts clients into this path only when React is actually providing a request cache. Route handlers and response-bound mutation clients retain fresh checks. No request identity is handed down in a header; the proxy’s replaced path header is only a routing hint for the render’s lifecycle recheck.

Apply `20261029163000_student_request_context.sql` before starting the updated application. Use an isolated Supabase project and real cookie jars for a complete full-plan student (`ada`) and a complete free student (`bola`), both BA / 200 Level / First Semester. The users JSON is a private local file containing `{ "ada": { "cookie": "..." }, "bola": { "cookie": "..." } }`; never commit it. The course ID is the local Financial Accounting I repository UUID. The harness measures all 16 student route cases, including open/locked course states and redirects.

Preload the tracer when starting a production build (use the same build tool, environment and port for before/after):

```sh
FETCH_TRACE_FILE=/absolute/path/after.jsonl NODE_OPTIONS="--require $PWD/scripts/perf-session/fetch-trace.cjs" pnpm start --port 3134
```

Run a live regression, which requests every page rather than trusting a saved result:

```sh
PERF_SESSION_TRACE=/absolute/path/after.jsonl \
PERF_SESSION_USERS=/absolute/path/users.json \
PERF_SESSION_COURSE=local-repository-uuid \
PERF_SESSION_RESULTS=/absolute/path/after.json \
node --test scripts/perf-session/identity-budget.test.cjs
```

Without those fixture variables the live-server test is explicitly skipped; its counter tests and `lib/auth/render-session.test.cjs` still run without a database. The latter executes React’s real server cache with a fresh test dispatcher per request, checks concurrent header/profile/page reads and account isolation, and proves response-bound checks stay fresh.

For baseline measurements without enforcing the new budget:

```sh
node scripts/perf-session/measure.cjs --trace=/absolute/path/before.jsonl --users=/absolute/path/users.json --course=local-repository-uuid --out=/absolute/path/before.json --runs=3
```

Each page gets one warm-up and at least three samples. Results contain server time, complete-request call depth/total and identity depth/total, plus raw request-linked calls. Local timings depend on other machine activity; call counts are the acceptance measure. Browsers, Docker and Supabase must not run below 20% on battery.
