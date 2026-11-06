// scripts/managed-content/official-banks/imports.cjs — Which official banks are imported, in what order, by which
// generated migration. Each entry also states the audited counts (REPORT.md table), which the generator must reproduce.
// Migrations sort after every other migration; regenerate with later timestamps if one is added before them.

/** @type {{code: string, contentKey: string, migration: string,
 *   expected: {published: number, kept: number, retired: number, added: number, bank: number}}[]} */
const IMPORTS = []

module.exports = { IMPORTS }
