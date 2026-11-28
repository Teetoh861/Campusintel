// lib/campus-bot/steps.ts — The names every Campus Bot request shares with the database: each kind of provider call
// has one row of per-request caps in private.campus_bot_request_caps, named by its step. The database copies the
// step's caps, the model and its weights onto the request at admission; the server then uses exactly those.
//
// "Practise this topic" reuses these: its writing call is the 'writing' step (the caps sets already use) and its
// check the 'check' step, unless the team gives it rows of its own.
export const CAMPUS_BOT_STEPS = {
  /** A practice set written from notes. */
  setWriting: 'writing',
  /** The sets' check step. */
  setCheck: 'check',
  /** One explanation of an answered question. */
  explain: 'explain',
  /** The stronger model's check of an explanation on a calculation course. */
  explainCheck: 'explain-check',
  /** One Ask Campus Bot reply. */
  chat: 'chat',
} as const

export type CampusBotStep = typeof CAMPUS_BOT_STEPS[keyof typeof CAMPUS_BOT_STEPS]

/** Bumped whenever a prompt or output shape in lib/campus-bot/prompts.ts changes, so saved output stays attributable. */
export const CAMPUS_BOT_PROMPT_VERSION = 'explain-ask-v1'
