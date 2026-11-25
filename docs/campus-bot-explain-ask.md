# Campus Bot Explain and Ask Campus Bot

Two Campus Bot features (owner decisions of 16 November 2026), built by
`supabase/migrations/20261117100000_campus_bot_explain_ask.sql` and `lib/campus-bot/`.

- **Explain.** Under a question the student has finished: after they answer it in topic practice, and on every question
  (answered or left out) in the answer review of a graded exam. Campus Bot says why the official answer is right and why
  the student's choice is wrong, from CampusIntell's notes for the course, and names the notes topic it used. Never
  during a running exam, never on a free pass exam (score only), never for a question the student has not finished.
- **Ask Campus Bot.** "Ask a question" in the Campus Bot area of a notes topic page (and of the topic a free pass
  pinned): a chat about that topic, answered from its notes in short replies. When the notes do not cover a question,
  the reply says so first, then answers generally. A reply may ask a check question ("Quick check", or "Try another"
  after a marked answer); the reply to the student's answer opens with a **Correct** or **Not quite** badge, and after
  Not quite it starts "The answer is …". A reply may add one memory trick when the notes support it. Blocked in a course
  while an exam runs there. It never reads a question bank or an answer key.

Both are **off** until the human review below signs off.

## Switches and settings

All settings live in `private.campus_bot_settings` and change through `scripts/entitlements/ops.cjs` (every change needs
`--actor` and `--reason` and is audited). Pages read the switches through `get_campus_bot_features()`.

| Setting | Launch value | Command |
| --- | --- | --- |
| Explain, Ask Campus Bot, topic sets | off, off, off | `campus-bot-feature --feature explain\|ask\|topic-sets --state on\|off` |
| Free pass explanations / messages | 5 / 10 per pass | `campus-bot-reply-limits --pass-explanations <n> --pass-messages <n>` |
| Platform explanations / messages per UTC day | 3,000 / 10,000 | `campus-bot-reply-limits --daily-explanations <n> --daily-messages <n>` |
| Undelivered replies per student per UTC day | 20 | `campus-bot-reply-limits --undelivered-per-day <n>` |
| Writer / checker | Haiku 5.5 / Sonnet 5.5 | `campus-bot-writer --model haiku`, `campus-bot-checker --model sonnet` |
| Per-request caps (read / written tokens) | explain 8,000 / 800; explain-check 4,000 / 2,000; chat 14,000 / 800 | `campus-bot-cap --step explain\|explain-check\|chat` |
| Calculation courses | the 16 with 40-minute exams (below) | `campus-bot-course --course <key> --calculation on\|off` |
| Kept chat reply, reservation | 10 minutes, 180 seconds | database only |

`campus-bot-status` prints all of it with today's request counts and what is saved.

The provider is the existing Campus Bot configuration (`AI_PRACTICE_ENABLED`, `ANTHROPIC_API_KEY`). Without it the
pages offer neither feature; explanations already saved are still served.

## Funding, limits and charges

- **Paid plan or free month:** the student's existing Campus Bot windows (5 hours and a week, the tier's tokens),
  shared with practice sets. Charged from the provider's own report: (read + 5 x written) x the writer's weight
  (Haiku = 1). On a calculation course the check is charged at the **writer's** weight too; the platform absorbs the
  difference (owner decision).
- **Free pass:** 5 explanations and 10 messages per pass, counted, not metered: on GST practice and notes, and Ask on
  the topic the pass pinned. An explanation counts when it is first delivered to the student, whether it was written
  for them or saved earlier for someone else (`private.campus_bot_pass_explanations`, per pass and per question
  revision and option); reading it again is free.
- **No Campus Bot:** the student sees the Campus Bot notice: subscribe when plans are on sale, the free pass when they
  can still start one, otherwise "Campus Bot is included with a plan." (The free month button joins once Early Access
  is in develop.)
- **Reserve, then settle.** A request reserves its worst case at its caps before the provider is called; only a
  delivered explanation or reply is charged, and never more than was reserved. The server bounds the whole prompt
  (instructions, notes, question or chat, and the reply's schema) by the input cap it was admitted with, leaving off
  the least relevant passages until it fits; a prompt that still could not fit is never sent. Nothing is charged for
  "not covered", a failed check, a timeout, a refusal or an unusable reply, or for a reservation the server never
  settled (released after 180 seconds).
- **Checked again at delivery.** A reply that finishes after the student lost access to the course, an exam opened
  in it, or their Campus Bot ended is not delivered or saved, and its reservation is released unpaid.
- **One at a time:** one explanation and one message in flight per student; a second tap answers "busy". The database
  takes the same per-student lock as practice sets, so windows open and reserve one request at a time. Reclaiming
  a reservation that was never settled never waits on another transaction: rows another one holds are skipped
  (`FOR UPDATE SKIP LOCKED`) and left to it, so students whose dead requests cross cannot deadlock.

## Saved explanations

An explanation holds no personal data, so it is saved once for everyone, keyed by the question's revision and the
option chosen (a question left out has its own). A later student with Campus Bot gets it with no provider call and no
charge. A corrected question is a new revision, so new attempts get a new explanation; attempts that showed the old
question keep theirs. Republishing or withdrawing a notes topic removes the explanations written from it, and the
course's "not covered" answers, which the change may now answer. On a calculation course the check runs once, before
an explanation is saved; a failed check is saved as "show the notes topic", so no generated text is ever shown for it.
`campus-bot-clear-explanations --course <key> --confirm` removes a course's saved explanations after a review finds a
problem; `campus-bot-explanations --course <key>` lists them with their questions.

## Chats

The chat lives in the page: nothing a student types is stored. Each message is sent with at most the 6 latest turns (600
characters each, and a Campus Bot turn's check question of up to 300) and is at most 500 characters. Email addresses and
Nigerian phone numbers are removed before anything is sent. A reply is marked only when the last Campus Bot turn sent
with it asked a check question; the server removes a verdict word or praise phrase the reply opens with and a label the
check question opens with. A check question whose answer is missing, or given away by the reply, is dropped; a memory
trick that alone gives it away is dropped instead (compared by the answer's words the question does not already hold, so
a question offering the answer as an option keeps both, unless one sentence of the reply pairs the answer with another
key word of the question: then the check question goes, or the memory trick if only it does). A reply with an ellipsis ("..." or
"…") is a failed reply, released and not charged. A check question that holds its own answer twice (whole words) is
dropped, and a memory trick with an ellipsis, a second sentence or bold first letters that do not pair up. A check
question is plain text: every bold marker in it is removed. A check question that asks two things, or is an open
question (no options) holding every word of its answer, is dropped. A word in a check question that marks stress with
capitals (REcord, preSENT) is written in lower case and the check kept; the check is dropped only if that leaves the same
option twice ("REcord or reCORD" would read "record or record"). In those
two answer guards (twice, and an open question holding it) a hyphenated compound is one word: "falling-rising" never
counts as the answer "falling", nor "labour-intensive" as "labour". A sentence of any reply that says "check question"
or "quick check" (whole words, any case) is removed, except a lead-in such as "Here's a quick check.", which stays when
a check question is shown; with no check question shown, a last sentence that announces one (let's, let us, let me,
I'll, I will, now or next, then check, test, quiz or try) is removed too. A reply left with nothing fails like one with
an ellipsis, released and not charged. Words are compared
by their simple forms (s, es, ies/y, ing, ed, al), so "emotions" in a reply echoes "emotional" in a question. A final
instruction in a check question ("Answer with a single word.") is removed, and a memory trick whose bold first letters do not match is
dropped. A reply that is only a lead-in to a question ("Here's one.") with no check question left after
the guards is a failed reply: released, not charged, and the student can try again. A marked reply is always from the
notes. Emoji are removed from every field (and from Explain). A reply may bold up to 3 key words with `**` and a memory
trick up to 4 (a check question none); a field whose markers do not pair up, or are too many, is shown without any,
and the page builds the bold from the parsed text. Bold is put back only on whole words (never "range" inside "arranged"),
except a memory trick's first letters. The check question's answer never leaves the server. A kept reply is
`{text, in_notes, verdict, check, memory_trick}` (20261123100000); the database still accepts `{text, in_notes}`, so the
migration is released before the code, and a reply kept that way reads as unmarked. A delivered reply is kept for 10
minutes, so a retry of the same message (after a lost connection) gets it free; a job deletes it every minute after
that. A retry is answered only for the course and topic it was asked about, and only after every check a new message
passes (access, an open exam, Campus Bot), so it gets what a new message would.

**The buttons under a reply** (owner decisions B5 and B6, 23 November 2026, mock 8). Under Campus Bot's newest turn:
Explain again, Make flashcards and Quiz me on this topic; in an empty chat only Make flashcards and Quiz me, after
flashcards only Quiz me, and no Explain again after a reply that only introduces its Quick check. Make flashcards needs
the topic's notes to have at least 150 words; Quiz me follows the area's own rule. None show while something is being
written or a notice is showing. Explain again and Make flashcards are chat requests in every way: the same admission,
funding, limits, caps, exam block, retry by request id, 10-minute keep, free pass message count and undelivered limit,
and one provider call per tap. The page sends the button's words as the message, so the student's turn shows them, and
names the action (`explain-again` or `flashcards`); the server ignores the words.

- **Explain again** sends the recent turns and a fixed message ("Please explain that again in a simpler way."). The reply
  is never marked (its verdict is `none`, whatever the model wrote) and never has a check question: one the model writes
  is removed, and a question that was waiting ends with the explanation, so the next message is an ordinary one. A reply
  that talks about the chat ("Your last reply…", "you said", "non-answer") fails, released and not charged. It is kept
  and charged as a chat reply.
- **Make flashcards** sends this topic's notes alone (no turns, no message) and asks for 8 to 10 cards, each a term and
  its meaning. Every field becomes plain text (emoji and bold markers removed, spacing collapsed), and a card is dropped
  when a side is empty, the term is over 80 characters or the meaning over 200, the meaning only repeats the term, the
  term repeats an earlier one (any case), or the term names something the notes sent don't contain (each of its words of
  3 or more letters must appear in them, ignoring case, punctuation, a possessive 's, words in brackets, label words
  such as versus, formula or pattern, and simple endings such as s, es, ies/y, ing, ed and al; a term of 3 or more such
  words may miss one). At most 10 are kept, in order;
  fewer than 4 left is a failed reply, released and not charged. The cards show one at a time as flip cards and last as
  long as the chat: there is no flashcards page. A kept set is `{cards: [{term, meaning}]}`, 4 to 10 cards
  (20261124100000); a retry whose kept reply is of the other kind (cards for a message, a reply for Make flashcards) is
  not found. The turns sent with later messages leave out flashcards and the turn that asked for them.
- **Quiz me on this topic** in the chat is the area's button: the same request id for the topic (kept in the tab), so a
  tap in each never writes two sets.

## What is sent to the provider

Course code and title, the notes passages, and for Explain the question, its options, the official answer, the official
explanation and the option chosen. For Ask, the topic's notes, the recent turns and the message. Never a name, email,
account, session or attempt id. Notes and student text are written as data blocks the model is told never to follow,
replies are structured (JSON) and shown as plain text only, and an explanation that names another option as correct is
discarded at no charge. Replies are capped at about 120 words (Explain) and 150 words (Ask) and cut at a sentence.

## Cost

Estimates from the guide sizes (183 topics, 17,700 characters on average) at 3.2 characters a token, Haiku 5.5 at
$0.10 / $0.50 and Sonnet 5.5 at $2 / $10 per million tokens. The review below measures the real figures.

| Request | Tokens in / out | Cost | Charged to the student |
| --- | --- | --- | --- |
| Explanation | 3,300 / 400 | $0.0005 | about 5,300 |
| Check (calculation courses) | 1,700 / 700 | $0.010 | about 5,200 (at the writer's weight) |
| Chat message | 6,000 / 350 | $0.0008 | about 7,750 |

## Calculation courses

The first list is every course whose exam runs 40 minutes (`lib/campus-bot/calculation-courses.test.cjs` holds the
migration's list to the exam configuration): ACC101, ACS101, AMS103, BUA203, BUA205, ECO101, ECO201, FIN-CM209,
FIN101, FIN216, INS101, LAG-ACS209, LAG-ACS213, LAG-BUA111, LAG-BUA125, TAX-CM223.

## Human review before launch

1. Deploy with every switch off (the migration's default).
2. On the test site's database, run the review in mock mode first; it reads a fixed sample and writes nothing:

   ```
   node -r ./lib/auth/test-loader.cjs scripts/campus-bot/review-samples.cjs \
     --courses use-of-english,principles-economics-1,mathematics-business,introduction-financial-accounting-1 \
     --questions 25 --topics 3 --out <folder>
   ```

3. With the owner's go-ahead only, run it live with a spending cap (`--live --max-usd 1`, at most 5; it needs
   `ANTHROPIC_API_KEY` and stops before a call's worst case would pass the cap). About 100 explanations, 40 checks and
   75 chat messages cost well under $1.
4. A reviewer opens the sheet and marks each row pass or fail: agrees with the official answer; uses only the notes;
   names the right topic; within length; working correct (calculation courses); a chat reply outside the notes says so;
   the injection and contact-details rows are refused or harmless.
5. Fix prompts or caps until the sheet passes, then switch the features on, on the test site first, and check the
   screens at phone width.
6. The owner signs off, then switches them on in production. "Quiz me on this topic" adds its own rows to the same sheet.

## Local checks with the stand-in provider

On a developer's machine only (`next dev`, a loopback database), `CAMPUS_BOT_FAKE_PROVIDER=true` replaces the provider
with a scripted stand-in. `CAMPUS_BOT_FAKE_SCRIPT=<file.json>` chooses what it does next, read on every call, for
example `{"explain":"not-covered","check":"fail","chat":"outside"}` (also `timeout`, `refused`, `invalid`, `long`,
`wrong-option`). Every `next build` / `next start` and every hosted deployment ignores both variables.

## Refunds

Owner decision of 17 Nov 2026: a paid student's 48-hour standard refund ends once they have more than 10 Campus Bot
replies (Explain and notes chat together) on paid courses; any delivered Campus Bot question set still ends it. Owner
decision of 23 Nov 2026: so does a delivered set of flashcards, as a question set does; the plan cards and the Payment
terms say so. Each
delivered explanation or chat reply on a paid course is plan use of kind `campus-bot-message`, dated when it was asked
for: a chat reply once per request (`chat:<request id>`), an explanation once per explanation shown
(`explain:<item>:<revision>:<option>`), so a retry, a reread or a saved explanation shown again never counts twice.
Sets keep `campus-bot-reply`, and a set of flashcards is one too, once per request (`flashcards:<request id>`), dated when
it was asked for (20261124100000). The allowance is `payment_policy.refund_campus_bot_messages_allowed` (10); the refund
check shows `campus_bot_sets` and `campus_bot_messages` apart ([Payments operations](payments-operations.md)).

## For "Practise this topic"

Its builder reuses: `private.campus_bot_topic_context(user, course, item, at, max chars)` (the topic rule: a readable
published note, or the free pass's pinned topic as pinned), `private.campus_bot_exam_open(user, course, at)`,
`lib/campus-bot/notes-context.ts` (passages into a prompt), `lib/campus-bot/model-call.ts` (the one provider call shape),
the step names in `lib/campus-bot/steps.ts`, the `topic_sets` switch, `CampusBotArea` on the topic pages and
`CampusBotStatus` for its states.
