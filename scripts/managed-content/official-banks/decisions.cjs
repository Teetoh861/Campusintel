// scripts/managed-content/official-banks/decisions.cjs — Owner decisions that the official bank import relies on.
// Approved on 6 Nov 2026 against Campusintel-worktrees/bank-audit-evidence/REPORT.md section H.

/** Changed questions whose correct option was reworded. Any other answer-key change is refused by the generator. */
const APPROVED_ANSWER_KEY_CHANGES = ['BUA204:PQ-269', 'BUA204:PQ-238', 'BUA205:PQ-043']

/** The owner's official course list (from students' course forms, 7 Nov 2026). Its titles override the bank documents
 *  everywhere; `catalogue` is the catalogue's title where it differs, which the course's import replaces (and its
 *  rollback restores). An import refuses a catalogue that holds any other title. */
const OFFICIAL_COURSES = {
  ACC101: { title: 'Introduction to Financial Accounting I', level: '100-level', semesters: ['first-semester'], units: 3 },
  ACS101: { title: 'Introduction to Actuarial Science', level: '100-level', semesters: ['first-semester'], units: 3 },
  AMS101: { title: 'Principles of Management', level: '100-level', semesters: ['first-semester'], units: 2 },
  AMS103: { title: 'Introduction to Computer', level: '100-level', semesters: ['first-semester'], units: 2 },
  BUA101: { title: 'Introduction to Business I', level: '100-level', semesters: ['first-semester'], units: 2 },
  ECO101: { title: 'Principles of Economics I', level: '100-level', semesters: ['first-semester'], units: 2 },
  ECO201: { title: 'Introduction to Microeconomics', level: '200-level', semesters: ['first-semester'], units: 2 },
  FIN101: { title: 'Introduction to Finance', level: '100-level', semesters: ['first-semester'], units: 3 },
  FIN216: { title: 'Fundamentals of Deposit Insurance', level: '200-level', semesters: ['second-semester'], units: 2 },
  'FIN-CM209': { title: 'Elements of Banking', catalogue: 'Element of Banking', level: '200-level',
    semesters: ['first-semester', 'second-semester'], units: 3 },
  INS101: { title: 'Introduction to Insurance', level: '100-level', semesters: ['first-semester'], units: 3 },
  'LAG-ACS209': { title: 'Business Statistics I', level: '200-level', semesters: ['first-semester'], units: 2 },
  'LAG-ACS213': { title: 'Mathematics for Business', level: '200-level', semesters: ['first-semester'], units: 2 },
  'LAG-BUA111': { title: 'Principles of Marketing', level: '100-level', semesters: ['first-semester'], units: 2 },
  'LAG-BUA123': { title: 'Marketing Communication', level: '100-level', semesters: ['first-semester'], units: 2 },
  'LAG-BUA125': { title: 'Managerial Economics', level: '100-level', semesters: ['first-semester'], units: 2 },
  PUL101: { title: 'Legal Methods I', level: '100-level', semesters: ['first-semester'], units: 3 },
  SOC101: { title: 'Introduction to Sociology I', level: '100-level', semesters: ['first-semester'], units: 2 },
  'TAX-CM223': { title: 'Business Taxation II', level: '200-level', semesters: ['second-semester'], units: 3 },
  BUA216: { title: 'Introduction to Financial Management', level: '200-level', semesters: ['second-semester'], units: 3 },
}

/** Exam length for the new courses: 50 questions; 40 minutes where the bank has calculation questions, 30 otherwise
 *  (owner's list, 7 Nov 2026). LAG-BUA111: 40, because its 18 flagged questions are real calculations (market share,
 *  market potential, CTR, CPM, CPC, ROAS, a least-squares trend). */
const EXAM_QUESTIONS = 50
const EXAM_MINUTES = {
  AMS101: 30, BUA101: 30, 'LAG-BUA123': 30, PUL101: 30, SOC101: 30,
  ACC101: 40, ACS101: 40, AMS103: 40, ECO101: 40, ECO201: 40, FIN101: 40, FIN216: 40, 'FIN-CM209': 40, INS101: 40,
  'LAG-ACS209': 40, 'LAG-ACS213': 40, 'LAG-BUA125': 40, 'TAX-CM223': 40, 'LAG-BUA111': 40,
}

module.exports = { APPROVED_ANSWER_KEY_CHANGES, EXAM_MINUTES, EXAM_QUESTIONS, OFFICIAL_COURSES }
