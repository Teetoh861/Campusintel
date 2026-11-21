// scripts/entitlements/course-selection.cjs — The course-selection and semester-calendar commands of the operator tool
// (20261026100000_course_selection_lock.sql). Each command maps to one service-role function; every change names an
// actor and a reason, and the database records it. Dates are Lagos calendar days (YYYY-MM-DD).
//   selection-status --user <uuid>
//   selection-change --user <uuid> --department <key> --level <key> --semester <key> --expected-revision <n>
//       [--allow-empty] --actor <name> --reason <text>
//   calendar
//   term-set --session <YYYY/YYYY> --semester <key> --resumes-on <YYYY-MM-DD> --actor <name> --reason <text>
//   term-extend --session <YYYY/YYYY> --semester <key> --department <key|all> --last-day <YYYY-MM-DD>
//       --actor <name> --reason <text>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SESSION = /^[0-9]{4}\/[0-9]{4}$/
const DAY = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/

function day(value, name) {
  const parsed = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`--${name} must be a calendar day (YYYY-MM-DD)`)
  }
  return value
}

/**
 * The function and body for a course-selection command, or null when the command is not one of these.
 * `required(opts, name, pattern)`, `integer(opts, name)` and `note()` are the tool's own validators.
 */
function courseSelectionCall(command, opts, { required, integer, note }) {
  switch (command) {
    case 'selection-status':
      return { fn: 'admin_course_selection_status', body: { p_user_id: required(opts, 'user', UUID) } }
    case 'selection-change':
      return { fn: 'admin_change_course_selection', body: { p_user_id: required(opts, 'user', UUID),
        p_department_key: required(opts, 'department', KEY), p_level_key: required(opts, 'level', KEY),
        p_period_key: required(opts, 'semester', KEY), p_expected_revision: integer(opts, 'expected-revision'),
        p_allow_empty: opts['allow-empty'] === true, ...note() } }
    case 'calendar': return { fn: 'admin_academic_calendar', body: {} }
    case 'term-set':
      return { fn: 'admin_set_academic_term', body: { p_session_label: required(opts, 'session', SESSION),
        p_period_key: required(opts, 'semester', KEY),
        p_resumes_on: day(required(opts, 'resumes-on', DAY), 'resumes-on'), ...note() } }
    case 'term-extend':
      return { fn: 'admin_set_department_end', body: { p_session_label: required(opts, 'session', SESSION),
        p_period_key: required(opts, 'semester', KEY), p_department_key: required(opts, 'department', KEY),
        p_last_day: day(required(opts, 'last-day', DAY), 'last-day'), ...note() } }
    default: return null
  }
}

module.exports = { courseSelectionCall }
