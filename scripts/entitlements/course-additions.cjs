// One student's extra semester course. Service-only, audited commands; never a global plan or a payment integration.
// course-add --user <uuid> --course <institutional uuid> --term <uuid> --expected-profile-revision <n>
//   --request <uuid> --actor <name> --reason <text>
// course-status --user <uuid>
// course-revoke --user <uuid> --addition <uuid> --expected-revision <n> --actor <name> --reason <text>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Map validated operator input onto one narrow service-only function. */
function courseAdditionCall(command, opts, { required, integer, note }) {
  const revision = (name, minimum) => {
    const value = integer(opts, name)
    if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`--${name} must be a valid revision`)
    return value
  }
  switch (command) {
    case 'course-add': return { fn: 'admin_add_student_course', body: {
      p_user_id: required(opts, 'user', UUID), p_institutional_course_id: required(opts, 'course', UUID),
      p_term_id: required(opts, 'term', UUID), p_expected_profile_revision: revision('expected-profile-revision', 0),
      p_idempotency_key: required(opts, 'request', UUID), ...note(),
    } }
    case 'course-status': return { fn: 'admin_student_course_status', body: { p_user_id: required(opts, 'user', UUID) } }
    case 'course-revoke': return { fn: 'admin_revoke_student_course', body: {
      p_user_id: required(opts, 'user', UUID), p_addition_id: required(opts, 'addition', UUID),
      p_expected_revision: revision('expected-revision', 1), ...note(),
    } }
    default: return null
  }
}

module.exports = { courseAdditionCall }
