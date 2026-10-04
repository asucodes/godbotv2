// society/claims.mjs — the territory ledger: who owns what land, since when,
// why. Persisted to data/claims.json. Same file also carries the inter-agent
// contract ledger (promises: "planks for cobble"), which the moderator will
// enforce once Phase 4 lands.
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../config.mjs'

export function createClaims() {
  const file = path.join(CONFIG.paths.data, 'claims.json')
  let db = { claims: {}, contracts: [] }
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) } } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const save = () => fs.writeFileSync(file, JSON.stringify(db, null, 2))

  const overlaps = (a, b) =>
    a.x1 <= b.x2 && b.x1 <= a.x2 && a.z1 <= b.z2 && b.z1 <= a.z2

  return {
    file,
    // Claim land. Returns { ok, conflictWith? } — a conflict is an honest fact
    // the agent must deal with socially (dispute → moderator), not a refusal.
    claim(name, x1, z1, x2, z2, reason) {
      const rect = { x1: Math.min(x1, x2), z1: Math.min(z1, z2), x2: Math.max(x1, x2), z2: Math.max(z1, z2) }
      if (Math.abs(rect.x2 - rect.x1) * Math.abs(rect.z2 - rect.z1) > 2500)
        return { ok: false, error: 'claim too large (max 50x50)' }
      for (const [id, c] of Object.entries(db.claims)) {
        if (overlaps(rect, c.rect)) return { ok: false, conflictWith: c.owner, theirs: c }
      }
      const id = `plot-${Math.random().toString(36).slice(2, 8)}`
      db.claims[id] = { owner: name, rect, reason, since: new Date().toISOString() }
      save()
      return { ok: true, id, rect }
    },
    release(name, id) {
      const c = db.claims[id]
      if (!c || c.owner !== name) return { ok: false, error: 'not yours' }
      delete db.claims[id]
      save()
      return { ok: true }
    },
    byOwner(name) {
      return Object.entries(db.claims).filter(([, c]) => c.owner === name).map(([id, c]) => ({ id, ...c }))
    },
    list() { return Object.entries(db.claims).map(([id, c]) => ({ id, ...c })) },

    // --- contracts (Phase 4.5 ledger; moderator enforces later) ---------------
    addContract(from, to, promise, consideration) {
      const id = `pact-${Math.random().toString(36).slice(2, 8)}`
      db.contracts.push({ id, from, to, promise, consideration, status: 'open', since: new Date().toISOString() })
      save()
      return id
    },
    contractsFor(name) {
      return db.contracts.filter((c) => c.from === name || c.to === name)
    },
  }
}
