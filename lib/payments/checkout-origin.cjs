const BACHS_CHECKOUT_ORIGIN = 'https://checkout.bachs.io'
const SANDBOX_CHECKOUT_ORIGIN = 'https://sandbox-checkout.bachs.io'

/** Select a fixed hosted origin from the key prefix; never include any key material in the result.
 * The adapter validates the full key first. Keyless builds retain the live form-action policy.
 * @param {string | undefined} apiKey
 */
function bachsCheckoutOrigin(apiKey) {
  return apiKey?.startsWith('sk_sandbox_') ? SANDBOX_CHECKOUT_ORIGIN : BACHS_CHECKOUT_ORIGIN
}

module.exports = { BACHS_CHECKOUT_ORIGIN, bachsCheckoutOrigin }
