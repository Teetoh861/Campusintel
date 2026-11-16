// Public destinations/copy only; lifecycle authorization lives on the server.
import { ACCOUNT_DELETION_GRACE_DAYS } from './deletion-policy.cjs'

export { ACCOUNT_DELETION_GRACE_DAYS }
export const ACCOUNT_DELETION_PATH = '/account/deletion'
export const ACCOUNT_DELETION_SCHEDULED_STATE = 'deletion-scheduled'
export const ACCOUNT_DELETION_SCHEDULED_PATH = `/login?state=${ACCOUNT_DELETION_SCHEDULED_STATE}`
export const ACCOUNT_MESSAGES = {
  scheduled: `Your account is scheduled for deletion. To cancel, sign in within ${ACCOUNT_DELETION_GRACE_DAYS} days and choose “Keep your account”.`,
  expired: 'This account can’t be restored. The deadline to keep it has passed.',
  excluded: 'This account can’t be deleted here. Message us for help.',
  passwordInvalid: 'Incorrect password.',
} as const
