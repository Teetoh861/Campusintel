// scripts/managed-content/official-banks/decisions.cjs — Owner decisions that the official bank import relies on.
// Approved on 6 Nov 2026 against Campusintel-worktrees/bank-audit-evidence/REPORT.md section H.

/** Changed questions whose correct option was reworded. Any other answer-key change is refused by the generator. */
const APPROVED_ANSWER_KEY_CHANGES = ['BUA204:PQ-269', 'BUA204:PQ-238', 'BUA205:PQ-043']

/** Decision 3: these courses take the title in the bank document. The catalogue title is the one replaced; the import
 *  refuses a catalogue that holds anything else. */
const BANK_TITLES = {
  BUA216: { catalogue: 'Introduction to Financial Management' },
  'FIN-CM209': { catalogue: 'Element of Banking' },
  PUL101: { catalogue: 'Legal Methods I' },
}

module.exports = { APPROVED_ANSWER_KEY_CHANGES, BANK_TITLES }
