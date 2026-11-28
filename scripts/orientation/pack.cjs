// Checked private pack format. Neither this module nor its CLI prints question or answer content.
const { z } = require('zod')
const category = z.enum(['orientation', 'general', 'campusintell'])
const text = limit => z.string().trim().min(1).max(limit).refine(value => !/[\u0000-\u001f\u007f]/.test(value))
const option = z.object({ text: text(120), correct: z.boolean() }).strict()
const question = z.object({ category, spare: z.boolean(), prompt: text(240),
  options: option.array().min(2).max(4) }).strict().superRefine((value, ctx) => {
  if (value.options.filter(item => item.correct).length !== 1) ctx.addIssue({ code: 'custom', message: 'Exactly one correct option is required.' })
  if (new Set(value.options.map(item => item.text)).size !== value.options.length) ctx.addIssue({ code: 'custom', message: 'Options must be distinct.' })
})
const pack = z.object({ title: text(100), kind: z.enum(['official', 'practice']),
  questions: question.array().min(18).max(45) }).strict().superRefine((value, ctx) => {
  const spares = value.questions.filter(item => item.spare)
  if (spares.length < 3 || spares.some(item => item.category === 'orientation')) ctx.addIssue({ code: 'custom', message: 'At least three general or CampusIntell spares are required.' })
  if (value.questions.filter(item => !item.spare).length !== 15) ctx.addIssue({ code: 'custom', message: 'Fifteen main questions are required.' })
  for (const name of category.options) {
    if (value.questions.filter(item => !item.spare && item.category === name).length !== 5) {
      ctx.addIssue({ code: 'custom', message: 'Each category needs five main questions.' })
    }
  }
})
/** Validate the complete import, preserving the owner's main-question order. */
function validatePack(input) { return pack.parse(input) }
module.exports = { validatePack }
