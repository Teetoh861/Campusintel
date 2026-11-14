# Student copy and screen rules

Read this before writing any text or building any screen a student will see in CampusIntell.

1. Write only what the student needs for the task on that screen. Never explain how CampusIntell works.
2. Never show internal or process words: AI (say Campus Bot), model answer, self-assessment, unverified, not verified, graded, attempt history, saved or sent to CampusIntell, database, server, Discovery Pass.
3. Match the mode. Practice has no timer, so it gets no time advice. Time tips appear only in timed exams.
4. Keep it short. Headings are short and read naturally, body text is one sentence, and buttons name the action ("Show answer", "Start exam").
5. Use a confident tone with no disclaimers or caveats. Legal pages (Payment terms, Privacy policy) are the only exception.
6. Campus Bot sets made from a student's own notes carry one label: "Made by Campus Bot from your notes."
7. Never tell students how to use a screen; the layout should make it obvious.
8. Headings must read naturally. Never drop words to save space.
9. A message belongs on the screen where its action happened, and goes away once the student does something else.
10. One card per kind of study, with one line per choice and its action. Lists of topics live on the page the card opens, and questions come one at a time.
11. Keep each screen simple: one clear way to do each thing, and no extra steps, choices or controls the task doesn't need.

`lib/student-copy/student-copy.test.cjs` checks rule 2 only: it fails when text students see contains a word or phrase from that rule.
