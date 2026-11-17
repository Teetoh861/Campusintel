# Campus Bot Explain and Ask Campus Bot

Two Campus Bot features (owner decisions of 16 November 2026), built by
`supabase/migrations/20261117100000_campus_bot_explain_ask.sql` and `lib/campus-bot/`.

- **Explain.** Under a question the student has finished: after they answer it in topic practice, and on every question
  (answered or left out) in the answer review of a graded exam. Campus Bot says why the official answer is right and why
  the student's choice is wrong, from CampusIntell's notes for the course, and names the notes topic it used. Never
  during a running exam, never on a free pass exam (score only), never for a question the student has not finished.
- **Ask Campus Bot.** "Ask a question" in the Campus Bot area of a notes topic page (and of the topic a free pass
  pinned): a chat about that topic, answered from its notes in short replies. When the notes do not cover a question,
  the reply says so first, then answers generally. Blocked in a course while an exam runs there. It never reads a
  question bank or an answer key.

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
  the topic the pass pinned.
- **No Campus Bot:** the student sees the Campus Bot notice: subscribe when plans are on sale, the free pass when they
  can still start one, otherwise "Campus Bot is included with a plan." (The free month button joins once Early Access
  is in develop.)
- **Reserve, then settle.** A request reserves its worst case at its caps before the provider is called; only a
  delivered explanation or reply is charged. Nothing is charged for "not covered", a failed check, a timeout, a refusal
  or an unusable reply, or for a reservation the server never settled (released after 180 seconds).
- **One at a time:** one explanation and one message in flight per student; a second tap answers "busy". The database
  takes the same per-student lock as practice sets, so windows open and reserve one request at a time.

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

The chat lives in the page: nothing a student types is stored. Each message is sent with at most the 6 latest turns
(600 characters each) and is at most 500 characters. Email addresses and Nigerian phone numbers are removed before
anything is sent. A delivered reply is kept for 10 minutes, so a retry of the same message (after a lost connection)
gets it free; a job deletes it every minute after that.

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

## Refund rule (owner to decide)

Today one delivered Campus Bot reply on a paid course (`refund_campus_bot_replies_allowed = 0`) ends the 48-hour refund
right, and practice sets, explanations (including saved ones read) and chat replies all count as `campus-bot-reply`
plan use. The smallest change that ends it after the **first set or 10 replies**, with no new plan-use kind and no
change to existing rows:

1. `private.payment_policy`: add `refund_campus_bot_sets_allowed integer not null default 0`, and set
   `refund_campus_bot_replies_allowed = 9`.
2. `private.refund_assessment`: count `campus-bot-reply` events whose `ref` starts with `explain:` or `chat:` as
   replies, and the others (practice sets, whose `ref` is the set's id) as sets; refuse when either count is above its
   allowance.

## For "Practise this topic"

Its builder reuses: `private.campus_bot_topic_context(user, course, item, at, max chars)` (the topic rule: a readable
published note, or the free pass's pinned topic as pinned), `private.campus_bot_exam_open(user, course, at)`,
`lib/campus-bot/notes-context.ts` (passages into a prompt), `lib/campus-bot/model-call.ts` (the one provider call shape),
the step names in `lib/campus-bot/steps.ts`, the `topic_sets` switch, `CampusBotArea` on the topic pages and
`CampusBotStatus` for its states.
