# Operator create intents

The active create draft generates `createIntentId` with `crypto.randomUUID()` on
the first valid create submission. It retains that UUID after uncertain transport
or server failures and uses it for manual retries. A synchronous create guard
also prevents a second in-flight submit; database correctness does not depend on
that guard. Confirmed success with an item ID clears the intent before the next
deliberate create. No automatic retry is performed.

Changing fields within an unresolved draft does not mint another identity. If
the original request committed, changed reuse returns a sanitized 409 conflict.
The create-specific recovery control reloads course content and resets the
draft; it retires the conflicting intent without retrying the POST. The next
deliberate submission uses a new UUID.

Selecting an existing item, clicking New content, or selecting/reloading a
course explicitly abandons the prior create draft. A draft generation also
rejects callbacks from an abandoned form. New content remounts the form, so its
fields reset along with its intent. Ordinary version conflicts keep their
existing item/version reload behavior. The UUID lives in client memory, not
persisted browser storage; a full reload ends the draft context.

Only the strict `create` contract accepts the UUID. Live Auth, rendered-session
continuity and live operator authorization remain independent requirements.

`create_managed_content_once` derives its actor using `require_live_operator`.
The private RLS-protected receipt table has a primary key on `(actor_id,
intent_id)` and a unique, deferred foreign key to the created item. Its JSONB
request contains the course UUID, kind, nullable parent UUID, and validated
payload. JSONB comparison ignores object key order and JSON formatting; text
content is not silently trimmed or otherwise rewritten.

Receipt, item, and immutable revision one commit together. A unique-key conflict
waits for the transaction using that same actor/intent and then returns its item
ID if the request matches, or raises the existing conflict SQLSTATE otherwise.
The first insertion alone generates the CBT question UUID. There is no expiry,
receipt update path, global lock, or payload-only content deduplication.

Existing singleton indexes still reject distinct intents for an occupied
overview/answer/rubric. Old imported rows need no receipt and retain their
identities and workflow. The legacy create RPC is owner-only; authenticated
runtime callers must use the intent boundary.

Local concurrency and lost-response acceptance:

```sh
OPERATOR_CREATE_DB_TEST=1 node --require ./lib/auth/test-loader.cjs --test lib/operator/create-database.test.cjs
```
