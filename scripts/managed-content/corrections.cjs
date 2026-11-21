// scripts/managed-content/corrections.cjs — Approved content corrections made after the repository seed.
// The seed migration stays as committed: the generator rebuilds it from the source with these corrections undone,
// and each correction's own migration moves the seeded text to the corrected text. Source files hold the corrected text.

/** One field change on one source item, applied by `migration`. */
const CORRECTIONS = [
  // 2026-11-04, owner-approved: practice has no timer, so theory exam tips carry no time advice.
  ...[
    ['theory:3', 'Include the formula AND explain what costs are deducted. Give an example if time permits.',
      'Include the formula AND explain what costs are deducted. Give an example.'],
    ['theory:9', 'State that capitalization STOPS, expense the interest, and explain the logic. Mention the exception about brief delays if time allows.',
      'State that capitalization STOPS, expense the interest, and explain the logic. Mention the exception about brief delays.'],
    ['theory:13', 'List and explain three clearly. State the direction of the difference (cashbook higher/lower). Mention one or two additional reasons if time allows.',
      'List and explain three clearly. State the direction of the difference (cashbook higher/lower). Mention one or two additional reasons.'],
  ].map(([sourceKey, seeded, corrected]) => ({
    migration: '20261104110000_theory_exam_tip_corrections.sql',
    courseId: '40000000-0000-4000-8000-000000000007', kind: 'theory_question', sourceKey, field: 'examTip', seeded, corrected,
  })),
]

module.exports = { CORRECTIONS }
