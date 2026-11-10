// scripts/managed-content/study-guides/imports.cjs — The study guides imported as course notes, in migration order.
// practice: 'by-number' (guide topic N opens bank topic N), 'none', or { [guideTopic]: [bank topic labels] }; a topic
// with several bank topics gets one button per topic, named after it.
const GUIDE_IMPORTS = [
  // GST 111 Communication in English: the pilot. Its 15 guide topics are its 15 bank topics, in the same order.
  { code: 'GST111', contentKey: 'use-of-english', guide: 'study_guide_gst111', migration: '20261111100000_study_guide_gst111.sql',
    practice: 'by-number' },
]

module.exports = { GUIDE_IMPORTS }
