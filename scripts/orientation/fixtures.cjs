// Synthetic local-only questions. No event content or credentials belong in this file.
const { randomUUID } = require('node:crypto')
/** A complete disposable pack; every right answer is A, making independent game calculations simple. */
function practicePack() {
  const categories = ['orientation','general','campusintell']
  const questions = Array.from({ length: 15 },(_,i) => ({ category: categories[Math.floor(i / 5)],spare: false,
    prompt: `Local check question ${i + 1}: choose the first option.`,
    options: [{ text: 'First option',correct: true },{ text: 'Second option',correct: false }] }))
  for (const category of ['general','general','campusintell']) questions.push({ category,spare: true,prompt: `Local spare for ${category}: choose the first option.`,
    options: [{ text: 'First option',correct: true },{ text: 'Second option',correct: false }] })
  return { title: 'Local orientation check ' + randomUUID().slice(0,8),kind: 'practice',questions }
}
module.exports = { practicePack }
