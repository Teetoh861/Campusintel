const assert = require('node:assert/strict')

/** Existing flow tests focus on domain outcomes; validate and separate the new diagnostic metadata. */
function authResult(body) {
  if (!body || typeof body !== 'object' || !Object.hasOwn(body, 'reference')) return body
  assert.match(body.reference, /^[A-HJ-NP-Z2-9]{8}$/)
  const { reference, ...outcome } = body
  return outcome
}

function authMessage(message) {
  return typeof message === 'string' ? message.replace(/ Reference: [A-HJ-NP-Z2-9]{8}$/, '') : message
}
module.exports = { authResult, authMessage }
