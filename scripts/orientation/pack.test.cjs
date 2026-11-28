const { test } = require('node:test')
const assert = require('node:assert/strict')
const { validatePack } = require('./pack.cjs')
const { practicePack } = require('./fixtures.cjs')

test('accept fifteen main questions, five in each category, plus three independent spares',() => {
  const value = validatePack(practicePack())
  assert.equal(value.questions.length,18)
  assert.equal(value.questions.filter(q => !q.spare).length,15)
})
for (const length of [0,1,5]) test(`reject ${length} options`,() => {
  const value = practicePack(); value.questions[0].options = Array.from({ length },(_,i) => ({ text: `Choice ${i}`,correct: i === 0 }))
  assert.throws(() => validatePack(value))
})
for (const length of [2,3,4]) test(`accept ${length} distinct options with exactly one correct`,() => {
  const value = practicePack(); value.questions[0].options = Array.from({ length },(_,i) => ({ text: `Choice ${i}`,correct: i === 1 }))
  assert.equal(validatePack(value).questions[0].options.length,length)
})
for (const count of [0,2]) test(`reject ${count} correct options`,() => {
  const value = practicePack(); value.questions[0].options.forEach((q,i) => { q.correct = i < count })
  assert.throws(() => validatePack(value))
})
test('reject missing mains, missing spares, category imbalance, duplicate choices and unknown fields',() => {
  const cases = [p => p.questions.splice(0,1),p => p.questions.splice(15,1),
    p => { p.questions[0].category = 'general' },p => { p.questions[0].options[1].text = p.questions[0].options[0].text },
    p => { p.questions[0].answer = 0 }]
  for (const change of cases) { const value = practicePack(); change(value); assert.throws(() => validatePack(value)) }
})
test('reject oversized/control content without disclosing it in CLI diagnostics',() => {
  for (const prompt of ['x'.repeat(241),'bad\u0000text']) { const value = practicePack(); value.questions[0].prompt = prompt; assert.throws(() => validatePack(value)) }
})

test('spares may all be general or CampusIntell; none may depend on the orientation talks',() => {
  for (const category of ['general','campusintell']) {
    const value = practicePack(); value.questions.filter(q => q.spare).forEach(q => { q.category = category })
    assert.equal(validatePack(value).questions.length,18)
  }
  const invalid = practicePack(); invalid.questions[15].category = 'orientation'
  assert.throws(() => validatePack(invalid))
})
