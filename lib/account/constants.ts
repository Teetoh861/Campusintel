// Public destinations/copy only; lifecycle authorization lives on the server.
import { ACCOUNT_DELETION_GRACE_DAYS } from './deletion-policy.cjs'

export { ACCOUNT_DELETION_GRACE_DAYS }
export const ACCOUNT_DELETION_PATH = '/account/deletion'
export const ACCOUNT_DELETION_SCHEDULED_STATE = 'deletion-scheduled'
export const ACCOUNT_DELETION_SCHEDULED_PATH = `/login?state=${ACCOUNT_DELETION_SCHEDULED_STATE}`
export const ACCOUNT_MESSAGES = {
  scheduled: `Your account is scheduled for deletion. To cancel, sign in within ${ACCOUNT_DELETION_GRACE_DAYS} days and choose “Yes, keep my account”.`,
  expired: 'The deletion deadline has passed. This account can no longer be restored.',
  excluded: 'Operator accounts and accounts with governed audit history require an operations review.',
  passwordInvalid: 'Your current password could not be verified.',
} as const
