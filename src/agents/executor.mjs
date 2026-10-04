// agents/executor.mjs — the nerves. Deterministic execution of routine JEV
// decisions: zero model calls. These are the "a lot of Minecraft decisions"
// that never reach the OpenRouter mind. Anything that goes wrong — blocked
// path, empty ore field, land owned by someone else, an audience for chat —
// escalates back up as a conflict for the reasoning model.
import { log } from '../obs/logger.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Small deterministic build whims, in cells relative to an anchor. Real
// placement, real blocks — just no LLM shaping. The big model still does all
// commissioned/creative architecture.
const WHIM_BUILDS = [
  { name: 'lantern post', cells: [{ dx: 0, dy: 0, dz: 0, block: 'oak_fence' }, { dx: 0, dy: 1, dz: 0, block: 'oak_fence' }, { dx: 0, dy: 2, dz: 0, block: 'lantern' }] },
  { name: 'cairn', cells: [{ dx: 0, dy: 0, dz: 0, block: 'cobblestone' }, { dx: 0, dy: 1, dz: 0, block: 'mossy_cobblestone' }, { dx: 0, dy: 2, dz: 0, block: 'cobblestone' }] },
  { name: 'bench', cells: [{ dx: 0, dy: 0, dz: 0, block: 'oak_slab' }, { dx: 1, dy: 0, dz: 0, block: 'oak_slab' }, { dx: 0, dy: 1, dz: 0, block: 'lantern' }] },
  { name: 'flower bed', cells: [{ dx: 0, dy: 0, dz: 0, block: 'oak_leaves' }, { dx: 1, dy: 0, dz: 0, block: 'poppy' }, { dx: 2, dy: 0, dz: 0, block: 'dandelion' }] },
]

export function createExecutor({ body, claims, persona }) {
  const name = body.username

  // JEV's mining target follows the persona's trade — no model needed to know
  // a dwarf digs coal and a mason digs stone.
  const mineTarget = persona.mineTarget || 'stone'

  function pickWhimSite() {
    const b = body.bot()
    const p = b.entity.position.floored()
    for (let t = 0; t < 6; t++) {
      const x = p.x + Math.floor(Math.random() * 12 - 6)
      const z = p.z + Math.floor(Math.random() * 12 - 6)
      // never build inside someone else's claim — that is a conflict, not a veto
      const inside = claims.list().filter((c) =>
        x >= c.rect.x1 && x <= c.rect.x2 && z >= c.rect.z1 && z <= c.rect.z2 && c.owner !== name)
      if (!inside.length) return { x, y: p.y, z }
    }
    return null
  }

  const actions = {
    async mine(snap) {
      const b = body.bot()
      const target = b.registry.blocksByName[mineTarget]
      if (!target) return { ok: false, escalate: `unknown block ${mineTarget}` }
      let dug = 0
      for (let i = 0; i < 4; i++) {
        const found = b.findBlocks({ matching: target.id, maxDistance: 24, count: 1 })
        if (!found.length) break
        const r = await body.digBlock(found[0].x, found[0].y, found[0].z)
        if (!r.ok) return { ok: dug > 0, escalate: `cannot reach the ${mineTarget}: ${r.error}` }
        dug++
      }
      if (!dug) return { ok: false, escalate: `no ${mineTarget} within 24 blocks — would need to travel` }
      return { ok: true, note: `dug ${dug} ${mineTarget}` }
    },

    async wander() {
      const b = body.bot()
      const p = b.entity.position
      const tx = p.x + Math.floor(Math.random() * 40 - 20)
      const tz = p.z + Math.floor(Math.random() * 40 - 20)
      try { await body.moveTo(tx, p.y, tz, { timeout: 20000, tpThreshold: Infinity }); return { ok: true, note: 'strolled around' } }
      catch { return { ok: false, escalate: 'the way is blocked — needs a decision how to get through' } }
    },

    async explore() {
      const b = body.bot()
      const p = b.entity.position
      const ang = Math.random() * Math.PI * 2
      const dist = 60 + Math.random() * 60 // up to ~120: honest travel
      const tx = Math.round(p.x + Math.cos(ang) * dist)
      const tz = Math.round(p.z + Math.sin(ang) * dist)
      await body.tpTo(tx, p.y + 2, tz)
      return { ok: true, note: `explored out to ${tx},${tz}` }
    },

    async build() {
      const site = pickWhimSite()
      if (!site) return { ok: false, escalate: 'ground here belongs to others — would need to ask or move on' }
      const whim = WHIM_BUILDS[Math.floor(Math.random() * WHIM_BUILDS.length)]
      let placed = 0
      for (const c of whim.cells) {
        const r = await body.placeBlock(site.x + c.dx, site.y + c.dy, site.z + c.dz, c.block)
        if (r.ok) placed++
      }
      if (!placed) return { ok: false, escalate: 'could not place even one block of a ' + whim.name }
      return { ok: true, note: `built a ${whim.name} (${placed}/${whim.cells.length} blocks)` }
    },

    async decorate() {
      const site = pickWhimSite()
      if (!site) return { ok: false, escalate: 'ground here belongs to others' }
      const item = Math.random() < 0.5 ? 'lantern' : 'poppy'
      let placed = 0
      for (let i = 0; i < 3; i++) {
        const r = await body.placeBlock(site.x + i, site.y, site.z, item)
        if (r.ok) placed++
      }
      return placed ? { ok: true, note: `placed ${placed} ${item}s` } : { ok: false, escalate: 'could not decorate here' }
    },

    async rest() {
      await sleep(8000 + Math.random() * 8000)
      return { ok: true, note: 'rested a while' }
    },

    // Social is the mind's job. JEV only detects the opportunity: if someone
    // is around, escalate the wake to the reasoning model; else an in-character
    // canned line keeps the villager alive at zero cost.
    async chat(snap) {
      const audience = (snap.entities || []).filter((e) => e.dist <= 12)
      if (audience.length) return { ok: false, escalate: 'someone is near and a chat was chosen' }
      return { ok: true, ambient: true, note: 'murmured to the open air' }
    },
  }

  return { actions, mineTarget }
}
