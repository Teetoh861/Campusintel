// Node timers can fire about 1 ms early; allow 2 ms at elapsed-time floors.
const EARLY_TIMER_TOLERANCE_MS = 2

module.exports = { EARLY_TIMER_TOLERANCE_MS }
