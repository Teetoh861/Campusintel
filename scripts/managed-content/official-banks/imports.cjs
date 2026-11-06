// scripts/managed-content/official-banks/imports.cjs — Which official banks are imported, in what order, by which
// generated migration. Each entry also states the audited counts (REPORT.md table), which the generator must reproduce.
// Migrations sort after every other migration; regenerate with later timestamps if one is added before them.

/** @type {{code: string, contentKey: string, migration: string,
 *   expected: {published: number, kept: number, retired: number, added: number, bank: number}}[]} */
const IMPORTS = [
  // Batch 1: Business Administration 200 Level, First Semester.
  { code: 'ACC-CM201', contentKey: 'financial-accounting-1', migration: '20261106100000_official_bank_acc_cm201.sql',
    expected: { published: 150, kept: 1, retired: 149, added: 502, bank: 503 } },
  { code: 'BUA201', contentKey: 'principles-business-administration', migration: '20261106100100_official_bank_bua201.sql',
    expected: { published: 390, kept: 1, retired: 389, added: 634, bank: 635 } },
  { code: 'BUA205', contentKey: 'leadership-governance', migration: '20261106100200_official_bank_bua205.sql',
    expected: { published: 210, kept: 141, retired: 69, added: 547, bank: 688 } },
  { code: 'ENT211', contentKey: 'entrepreneurship-innovation', migration: '20261106100300_official_bank_ent211.sql',
    expected: { published: 50, kept: 0, retired: 50, added: 620, bank: 620 } },
]

module.exports = { IMPORTS }
