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
  // The remaining courses that already had published questions.
  { code: 'GST111', contentKey: 'use-of-english', migration: '20261106110000_official_bank_gst111.sql',
    expected: { published: 100, kept: 0, retired: 100, added: 650, bank: 650 } },
  { code: 'BUA202', contentKey: 'principles-business-administration-2', migration: '20261106110100_official_bank_bua202.sql',
    expected: { published: 385, kept: 5, retired: 380, added: 694, bank: 699 } },
  { code: 'BUA204', contentKey: 'quantitative-analysis-management', migration: '20261106110200_official_bank_bua204.sql',
    expected: { published: 136, kept: 79, retired: 57, added: 691, bank: 770 } },
  { code: 'BUA216', contentKey: 'introduction-financial-management', migration: '20261106110300_official_bank_bua216.sql',
    expected: { published: 111, kept: 0, retired: 111, added: 1099, bank: 1099 } },
]

module.exports = { IMPORTS }
