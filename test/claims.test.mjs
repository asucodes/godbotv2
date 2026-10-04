// test/claims.test.mjs — the ledger is pure bookkeeping, so it gets real tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CONFIG } from '../src/config.mjs'
import { createClaims } from '../src/society/claims.mjs'

function tempClaims() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'godbot-test-'))
  const orig = CONFIG.paths.data
  CONFIG.paths.data = dir
  const claims = createClaims()
  CONFIG.paths.data = orig
  return claims
}

test('claim, overlap conflict, release', async (t) => {
  const claims = tempClaims()
  const a = claims.claim('Mason', 0, 0, 10, 10, 'a wall')
  assert.equal(a.ok, true)
  const b = claims.claim('Grimm', 5, 5, 15, 15, 'a den')
  assert.equal(b.ok, false)
  assert.equal(b.conflictWith, 'Mason')
  const c = claims.claim('Grimm', 11, 11, 20, 20, 'a den')
  assert.equal(c.ok, true)
  assert.equal(claims.release('Grimm', 'nope').ok, false)
  assert.equal(claims.release('Grimm', c.id).ok, true)
  assert.equal(claims.list().length, 1)
})

test('rect normalization and size cap', async (t) => {
  const claims = tempClaims()
  const a = claims.claim('Willow', 10, 10, 0, 0, 'garden') // reversed corners
  assert.equal(a.ok, true)
  assert.deepEqual(a.rect, { x1: 0, z1: 0, x2: 10, z2: 10 })
  const huge = claims.claim('Pearl', 0, 0, 500, 500, 'the sea')
  assert.equal(huge.ok, false)
})

test('contracts ledger', async (t) => {
  const claims = tempClaims()
  const id = claims.addContract('Grimm', 'Willow', '40 cobblestone', '20 oak planks')
  assert.equal(claims.contractsFor('Grimm')[0].id, id)
  assert.equal(claims.contractsFor('Willow')[0].status, 'open')
})
