// scripts/managed-content/study-guides/manifest.test.cjs — The committed guide sources are exactly the files the
// SHA-256 manifest lists: a changed, missing or extra file stops the build.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { MANIFEST_PATH, SOURCE_DIR, checkManifest, sourceDigests } = require('../study-guides.cjs')

test('the manifest lists every committed guide file with its SHA-256', () => {
  const manifest = checkManifest()
  assert.equal(manifest.algorithm, 'sha256')
  assert.equal(Object.keys(manifest.files).length, 203, '20 covers and 183 topics')
  assert.ok(Object.keys(manifest.files).every(name => /^[A-Z][A-Z0-9-]+\/T\d+\.md$/.test(name)), 'markdown only')
  assert.ok(Object.values(manifest.files).every(digest => /^[0-9a-f]{64}$/.test(digest)))
  assert.equal(fs.readdirSync(SOURCE_DIR).length, 20)
})

test('a changed, missing or extra source file is refused', () => {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'study-guides-'))
  try {
    fs.cpSync(SOURCE_DIR, copy, { recursive: true })
    checkManifest(copy, MANIFEST_PATH)
    const file = path.join(copy, 'GST111', 'T1.md')
    fs.appendFileSync(file, '\nA changed line.\n')
    assert.throws(() => checkManifest(copy, MANIFEST_PATH), /differ from/)
    fs.cpSync(path.join(SOURCE_DIR, 'GST111', 'T1.md'), file)
    fs.writeFileSync(path.join(copy, 'GST111', 'T16.md'), '## Topic 16: Extra\n')
    assert.throws(() => checkManifest(copy, MANIFEST_PATH), /differ from/)
    fs.rmSync(path.join(copy, 'GST111', 'T16.md'))
    fs.rmSync(path.join(copy, 'GST111', 'T15.md'))
    assert.throws(() => checkManifest(copy, MANIFEST_PATH), /differ from/)
    assert.equal(Object.keys(sourceDigests(copy)).length, 202)
  } finally { fs.rmSync(copy, { recursive: true, force: true }) }
})
