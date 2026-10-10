# Authenticated mutation boundary

The shared boundary owns request mechanics, live identity, rendered-session
continuity, and response-cookie preservation. Domain authorization and mutation
semantics remain separate.

- `readAuthRequest(request, schema, { maxBytes? })` uses the configured canonical
  origin and exact trusted Vercel Preview origin. It rejects cross-site/same-site
  Fetch Metadata, requires `application/json`, reads bounded bytes, decodes UTF-8
  fatally, parses JSON, and applies the supplied schema. Auth defaults to 4 KiB;
  quiz writes retain 16 KiB and editor writes retain 280 KiB. The editor wrapper
  retains its sanitized error type without implementing a second parser.
- `getLiveSessionContext(response?)` creates the cookie-bound client and uses
  the existing authoritative user validation followed by session claims. Render
  callers may omit the response; route callers supply their own response.
- `getAuthenticatedMutationContext(response, renderedToken)` additionally checks
  the existing HMAC continuity token against that live user and session. It
  returns ready, signed-out, session-changed, or unavailable. It accepts no client
  user ID or role. Identity continuity does not grant domain authorization.
- `finalizeMutationResponse(response, body, status)` retains the headers,
  including cookie rotations/clears, produced for that same request. It must not
  salvage an unverified login/confirmation transfer; those routes deliberately
  discard such a transfer on validation failure.

The operator render authorizes a live context against the protected profile
role and issues its continuity token. The mounted workspace freezes the token;
all mutation requests, including both restore steps, carry it. A changed account
or session returns HTTP 409 with `status: session-changed` before a domain write.
The workspace stops further writes and offers a full reload, rather than a
course-only refresh that would leave the old token bound to the draft. Database
operator authorization and managed-content versions remain authoritative.

Account-page logout freezes the page's existing token. Navigation's session
lookup can request logout presentation context with
`x-campus-logout-context: true`; only that request receives an opaque
`continuityToken` alongside signed-in status. Legacy plain status and continuity
comparison responses remain unchanged. No user ID, session ID, or role is sent.
This context is established while presenting the control, never minted on a
logout click. A stale logout returns session-changed without revoking the live
account or consuming its recovery grant. The client reconciles with a reload.
Already signed-out logout keeps the existing cleanup/acknowledgment behavior.

Logout finalizes every exception through its response-bound headers. Legitimate
Auth clearing/rotation changes survive SDK errors and unexpected failures.

Existing student mutation checks still use the same live-session and continuity
primitives. This step does not change quiz start/record/finish behavior, retry
algorithms, profile updates, bookmark reconciliation, report deduplication,
managed-content versions, recovery authorization, or login session transfer.
No generic mutation retry or idempotency mechanism is introduced.
