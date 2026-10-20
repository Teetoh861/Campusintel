// lib/entitlements/phone.cjs — Nigerian mobile normalization and the keyed phone hash, shared by the app and the
// operator tool so an imported Early Access phone and a trial phone hash identically.
// Only Nigerian mobile numbers (+234 70x/71x/80x/81x/90x/91x) are accepted, so one number has one form
// and the uniqueness hash cannot be dodged by reformatting.
const { createHmac } = require('node:crypto')

const SEPARATORS = /[\s().-]/g
// 0700/0800/0900 are toll-free and premium ranges, never mobiles.
const NATIONAL_MOBILE = /^[789](?:0[1-9]|1\d)\d{7}$/

/**
 * `+234XXXXXXXXXX` plus the last three digits for display, or null when the input is not a Nigerian mobile.
 * @param {string} input
 * @returns {{ e164: string, hint: string } | null}
 */
function normalizeNigerianMobile(input) {
  let digits = input.trim().replace(SEPARATORS, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  if (!/^\d+$/.test(digits)) return null
  if (digits.startsWith('234')) digits = digits.slice(3)
  if (digits.startsWith('0')) digits = digits.slice(1)
  if (!NATIONAL_MOBILE.test(digits)) return null
  return { e164: `+234${digits}`, hint: digits.slice(-3) }
}

/**
 * Stable, keyed identity of a normalized phone number. Reformatting cannot change it; the key cannot be guessed.
 * @param {string} key
 * @param {string} e164
 * @returns {string}
 */
function phoneHash(key, e164) {
  return createHmac('sha256', key).update(`trial-phone:${e164}`, 'utf8').digest('hex')
}

module.exports = { normalizeNigerianMobile, phoneHash }
