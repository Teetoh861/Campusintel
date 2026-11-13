// scripts/managed-content/study-guides/imports.cjs — The study guides imported as course notes, in migration order.
// practice: 'by-number' (guide topic N opens bank topic N), 'none', or { [guideTopic]: [bank topic labels] }; a topic
// with several bank topics gets one button per topic, named after it. namedTopics lists the guide topics whose single
// button is named too, because they share its bank topic with other guide topics.
// replacesNotes: the number of notes the course publishes today, all of which the guide replaces (unpublished through
// the publish history, republished by a rollback). The course's own theory questions and their answers stay published.
// newCourse: the course has no repository identity yet; the import creates it and links its catalogue course.
const GUIDE_IMPORTS = [
  // GST 111 Communication in English: the pilot. Its 15 guide topics are its 15 bank topics, in the same order.
  { code: 'GST111', contentKey: 'use-of-english', guide: 'study_guide_gst111', migration: '20261111100000_study_guide_gst111.sql',
    practice: 'by-number' },

  // The other guides, in code order. Their migrations follow 20261113090000_study_guide_imports.sql.
  // ACC-CM201 Financial Accounting I: replaces 10 topic notes and 10 calculator tricks; its 20 theory questions stay.
  { code: 'ACC-CM201', contentKey: 'financial-accounting-1', guide: 'study_guide_acc_cm201',
    migration: '20261113100000_study_guide_acc_cm201.sql', practice: 'by-number', replacesNotes: 20 },
  // ACC 101: 8 guide topics over 15 bank topics. Every bank topic has one button.
  { code: 'ACC101', contentKey: 'introduction-financial-accounting-1', guide: 'study_guide_acc101',
    migration: '20261113100100_study_guide_acc101.sql',
    practice: {
      1: ['Nature, scope and objectives of accounting', 'Users and qualitative characteristics', 'Branches of accounting'],
      2: ['Elements and the accounting equation', 'Double-entry principles', 'Capital and revenue classification'],
      3: ['Source documents and books of prime entry', 'Ledger accounts and types of accounts'],
      4: ['Accounting concepts, conventions and limitations'],
      5: ['Cash book and bank reconciliation'],
      6: ['Trial balance and correction of errors'],
      7: ['Accruals, prepayments and other adjustments', 'Depreciation of non-current assets', 'Bad debts and doubtful debt provisions'],
      8: ['Final accounts of a sole trader'],
    } },
  // ACC 121 Introduction to Cost Accounting: no bank, so notes and theory only. Its catalogue course (Insurance and
  // Actuarial Science, 100 level, second semester) has no repository course yet; the import creates and links it.
  { code: 'ACC121', contentKey: 'introduction-cost-accounting', guide: 'study_guide_acc121',
    migration: '20261113100200_study_guide_acc121.sql', practice: 'none',
    newCourse: { title: 'Introduction to Cost Accounting', level: '100-level', semesters: ['second-semester'] } },
  { code: 'ACS101', contentKey: 'introduction-actuarial-science', guide: 'study_guide_acs101',
    migration: '20261113100300_study_guide_acs101.sql', practice: 'by-number' },
  { code: 'AMS101', contentKey: 'principles-management', guide: 'study_guide_ams101',
    migration: '20261113100400_study_guide_ams101.sql', practice: 'by-number' },
  // BUA 101: topics 1 to 7 match the bank by number; lesson 7.3 (the organising function: structure and teams) also
  // covers the bank's "Organization and Teamwork", so topic 7 opens both. Topic 10 (e-business) has no bank topic.
  { code: 'BUA101', contentKey: 'introduction-business-1', guide: 'study_guide_bua101',
    migration: '20261113100500_study_guide_bua101.sql',
    practice: {
      1: ['Developing a Business Mindset'],
      2: ['Understanding Basic Economics'],
      3: ['The Global Marketplace'],
      4: ['Business Ethics and Corporate Social Responsibility'],
      5: ['Forms of Business Ownership'],
      6: ['Entrepreneurship and Small-Business Ownership'],
      7: ['Management Roles, Functions and Skills', 'Organization and Teamwork'],
      8: ['Production Systems'],
      9: ['Employee Motivation'],
      10: [],
    } },
  { code: 'BUA201', contentKey: 'principles-business-administration', guide: 'study_guide_bua201',
    migration: '20261113100600_study_guide_bua201.sql', practice: 'by-number', replacesNotes: 10 },
  { code: 'BUA205', contentKey: 'leadership-governance', guide: 'study_guide_bua205',
    migration: '20261113100700_study_guide_bua205.sql', practice: 'by-number', replacesNotes: 10 },
  // ECO 101: 10 guide topics over 8 bank topics. Topics 5, 6 and 7 share "Demand and Supply Analysis", which holds the
  // bank's elasticity, utility and indifference-curve questions, so each of the three names it on its button.
  { code: 'ECO101', contentKey: 'principles-economics-1', guide: 'study_guide_eco101',
    migration: '20261113100800_study_guide_eco101.sql',
    practice: {
      1: ['Nature of Economic Science'],
      2: ['Methodology of Economics'],
      3: ['Major Areas of Specialization in Economics'],
      4: ['Historical Development of Economic Thought'],
      5: ['Demand and Supply Analysis'],
      6: ['Demand and Supply Analysis'],
      7: ['Demand and Supply Analysis'],
      8: ['Production and the Firm'],
      9: ['Partial Equilibrium Analysis'],
      10: ['Market Structures'],
    },
    namedTopics: [5, 6, 7] },
  { code: 'ENT211', contentKey: 'entrepreneurship-innovation', guide: 'study_guide_ent211',
    migration: '20261113100900_study_guide_ent211.sql', practice: 'by-number', replacesNotes: 10 },
  { code: 'FIN-CM209', contentKey: 'elements-banking', guide: 'study_guide_fin_cm209',
    migration: '20261113101000_study_guide_fin_cm209.sql', practice: 'by-number' },
  { code: 'FIN101', contentKey: 'introduction-finance', guide: 'study_guide_fin101',
    migration: '20261113101100_study_guide_fin101.sql', practice: 'by-number' },
  { code: 'LAG-ACS209', contentKey: 'business-statistics-1', guide: 'study_guide_lag_acs209',
    migration: '20261113101200_study_guide_lag_acs209.sql', practice: 'by-number' },
  { code: 'LAG-ACS213', contentKey: 'mathematics-business', guide: 'study_guide_lag_acs213',
    migration: '20261113101300_study_guide_lag_acs213.sql', practice: 'by-number' },
  { code: 'LAG-BUA111', contentKey: 'principles-marketing', guide: 'study_guide_lag_bua111',
    migration: '20261113101400_study_guide_lag_bua111.sql', practice: 'by-number' },
  { code: 'LAG-BUA123', contentKey: 'marketing-communication', guide: 'study_guide_lag_bua123',
    migration: '20261113101500_study_guide_lag_bua123.sql', practice: 'by-number' },
  { code: 'LAG-BUA125', contentKey: 'managerial-economics', guide: 'study_guide_lag_bua125',
    migration: '20261113101600_study_guide_lag_bua125.sql', practice: 'by-number' },
  // PUL 101: the guide's titles differ from the bank's, but its 9 topics are the bank's 9 topics in the same order.
  { code: 'PUL101', contentKey: 'legal-methods-1', guide: 'study_guide_pul101',
    migration: '20261113101700_study_guide_pul101.sql', practice: 'by-number' },
]

// BUA 323 waits: its guide covers weeks 1 to 4 only, so its source is committed and parsed but not imported.
const GUIDES_WAITING = ['BUA323']

module.exports = { GUIDE_IMPORTS, GUIDES_WAITING }
