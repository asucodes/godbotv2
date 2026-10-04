// world/bot.mjs — the body. One mineflayer bot per agent: walking, teleport as
// open transport, real digging with drop pickup, physical block placement from
// inventory only, real crafting. No /setblock, /give or /fill anywhere.
// Survives disconnects with bounded auto-reconnect.
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'
import pathfinderPkg from 'mineflayer-pathfinder'

const { pathfinder, Movements, goals } = pathfinderPkg
const { GoalNear } = goals
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const AIR = new Set(['air', 'cave_air', 'void_air'])

export function createBody({ username, host, port, version, onEvent = () => {}, log = () => {} }) {
  const state = {
    bot: null,
    ready: null,
    closed: false,
    reconnects: 0,
    maxReconnects: 10,
    heardChat: [], // [{ from, text, at }] — fed to senses
  }
  const opts = { host, port, username, version, auth: 'offline' }
  // Paper echoes command feedback into chat (and TLauncher appends ']'). These
  // are not conversation — reacting to them wastes reasoning-model calls.
  const SERVER_NOISE = /^(Teleported |Set the world spawn|Killed |Gamemode|Given |Placed |Filled |Summoned |Weather |Time set|Effect |Enchanting|Difficulty |Saved the game|Set own gamemode)/

  function bind(bot) {
    bot.loadPlugin(pathfinder)
    // creative mode for now (per design decision): every body enforces it at
    // spawn. Bots are opped via ops.json, so the command sticks.
    bot.once('spawn', () => { try { bot.chat(`/gamemode creative ${username}`) } catch {} })
    bot.on('chat', (from, text) => {
      if (from === username || SERVER_NOISE.test(text)) return
      state.heardChat.push({ from, text, at: Date.now() })
      if (state.heardChat.length > 30) state.heardChat.splice(0, state.heardChat.length - 30)
    })
    bot.on('error', (e) => log('body', 'error', { user: username, error: e.message }))
    bot.on('kicked', (reason) => log('body', 'kicked', { user: username, reason: JSON.stringify(reason).slice(0, 200) }))
    bot.on('end', () => { if (!state.closed) reconnect() })
  }

  function reconnect() {
    if (state.closed || state.reconnects >= state.maxReconnects) {
      log('body', 'gave-up', { user: username, reconnects: state.reconnects })
      return
    }
    state.reconnects++
    const backoff = Math.min(5000 * state.reconnects, 60000)
    log('body', 'reconnecting', { user: username, attempt: state.reconnects, backoffMs: backoff })
    setTimeout(() => {
      if (state.closed) return
      state.bot = mineflayer.createBot(opts)
      bind(state.bot)
      state.ready = new Promise((resolve, reject) => {
        state.bot.once('spawn', () => { state.reconnects = 0; resolve() })
        state.bot.once('error', reject)
      })
    }, backoff)
  }

  function connect() {
    state.bot = mineflayer.createBot(opts)
    bind(state.bot)
    state.ready = new Promise((resolve, reject) => {
      state.bot.once('spawn', resolve)
      state.bot.once('error', reject)
    })
  }
  connect()

  const emit = (type, data) => onEvent(type, { user: username, ...data })
  const bot = () => state.bot

  // --- transport -----------------------------------------------------------------
  async function tpTo(x, y, z) {
    const b = bot()
    const moved = new Promise((r) => b.once('forcedMove', r))
    b.chat(`/tp ${username} ${x} ${y} ${z}`)
    await Promise.race([moved, sleep(3000)])
    b.entity.velocity.set(0, 0, 0)
    await sleep(150)
    emit('tp', { to: { x, y, z } })
  }

  // Walk for normal distances; tp (openly, logged) when the journey is long.
  async function moveTo(x, y, z, { timeout = 30000, tpThreshold = 100 } = {}) {
    const b = bot()
    const p = b.entity.position
    const dist = Math.sqrt((p.x - x) ** 2 + (p.z - z) ** 2)
    if (dist > tpThreshold) { await tpTo(Math.floor(x), Math.floor(y), Math.floor(z)); return }
    const movements = new Movements(b)
    b.pathfinder.setMovements(movements)
    await Promise.race([
      b.pathfinder.goto(new GoalNear(Math.floor(x), Math.floor(y), Math.floor(z), 1)),
      sleep(timeout).then(() => { b.pathfinder.stop(); throw new Error(`walk to ${x},${y},${z} timed out`) }),
    ])
  }

  async function walkTo(x, z, opts = {}) {
    const b = bot()
    const y = b.entity.position.y // stay at own ground level unless told otherwise
    return moveTo(x, y, z, opts)
  }

  async function follow(name, { timeout = 20000 } = {}) {
    const b = bot()
    const target = b.players[name]?.entity
    if (!target) throw new Error(`cannot see ${name}`)
    const p = target.position
    return moveTo(p.x, p.y, p.z, { timeout })
  }

  // --- real work ------------------------------------------------------------------
  // Creative-mode inventory: the legitimate way a creative body obtains a
  // stack (not a server cheat — it is the creative mechanic itself).
  async function creativeGive(itemName) {
    const b = bot()
    if (!b.game || b.game.gameMode !== 'creative') return false
    try {
      const item = b.registry.itemsByName[itemName.replace(/^minecraft:/, '')]
      if (!item) return false
      const empty = b.inventory.slots.findIndex((s, i) => i > 44 || !s) // hotbar/main first empty
      const slot = empty >= 0 && empty < 45 ? empty : 36
      await b.creative.setInventorySlot(slot, { type: item.id, count: 64 })
      await sleep(200)
      return true
    } catch { return false }
  }

  async function equip(itemName) {
    const b = bot()
    const held = b.heldItem
    const want = itemName.replace(/^minecraft:/, '')
    if (held && held.name === want) return
    let item = b.inventory.items().find((i) => i.name === want)
    if (!item && (await creativeGive(want))) item = b.inventory.items().find((i) => i.name === want)
    if (!item) throw new Error(`no ${itemName} in inventory`)
    await b.equip(item, 'hand')
  }

  // Dig a block, then walk over the drops so they actually enter inventory.
  async function digBlock(x, y, z, { timeout = 30000 } = {}) {
    const b = bot()
    // never dig the block supporting our own feet — that is how villagers
    // end up at the bottom of a one-block shaft
    const feet = b.entity.position.floored()
    if (x === feet.x && y === feet.y - 1 && z === feet.z) {
      try { await moveTo(x + 2, feet.y, z, { timeout: 8000 }) } catch {}
    }
    const target = b.blockAt(new Vec3(x, y, z))
    if (!target || AIR.has(target.name)) return { ok: false, error: 'nothing to dig there' }
    const p = b.entity.position
    const dist = p.distanceTo(new Vec3(x, y, z))
    if (dist > 5) await moveTo(x, y + 1, z)
    await b.lookAt(new Vec3(x + 0.5, y + 0.5, z + 0.5), true)
    await Promise.race([
      (async () => { await b.dig(target); })(),
      sleep(timeout).then(() => { throw new Error('dig timed out') }),
    ])
    // pick up what it dropped
    let collected = 0
    for (let i = 0; i < 10; i++) {
      const drop = b.nearestEntity((e) => e.name === 'item' &&
        e.position.distanceTo(new Vec3(x, y, z)) < 4)
      if (!drop) break
      try { await b.collectEntity?.(drop) } catch {}
      if (drop.isValid === false) { collected++; continue }
      await moveTo(drop.position.x, drop.position.y, drop.position.z, { timeout: 8000 })
      await sleep(300)
      if (drop.isValid === false) collected++
    }
    emit('dug', { at: { x, y, z }, block: target.name })
    return { ok: true, block: target.name, dropsCollected: collected }
  }

  // Place a block you are holding, physically, against a neighboring block.
  async function placeBlock(x, y, z, itemName) {
    const b = bot()
    const dest = new Vec3(x, y, z)
    const existing = b.blockAt(dest)
    if (existing && !AIR.has(existing.name)) return { ok: false, error: `${existing.name} already there` }
    await equip(itemName)
    // stand within reach if too far
    const p = b.entity.position
    if (p.distanceTo(dest) > 4.5) await moveTo(x, y + 1, z)
    // find an adjacent solid block to place against
    const dirs = [[0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]
    for (const [dx, dy, dz] of dirs) {
      const ref = b.blockAt(dest.offset(dx, dy, dz))
      if (!ref || AIR.has(ref.name)) continue
      try {
        await b.lookAt(dest.offset(0.5, 0.5, 0.5), true)
        await b.placeBlock(ref, new Vec3(-dx, -dy, -dz).plus(new Vec3(0.5, 0.5, 0.5)).floored())
        await sleep(120)
        const now = b.blockAt(dest)
        if (now && !AIR.has(now.name)) { emit('placed', { at: { x, y, z }, block: itemName }); return { ok: true, block: itemName } }
      } catch { /* try next face */ }
    }
    return { ok: false, error: 'no reachable face — stand closer or clear the way' }
  }

  // Real crafting. Needs ingredients; needs a crafting table within reach for
  // recipes that require one (we look for one nearby, we do not spawn one).
  async function craftItem(itemName, count = 1) {
    const b = bot()
    const item = b.registry.itemsByName[itemName.replace(/^minecraft:/, '')]
    if (!item) return { ok: false, error: `unknown item ${itemName}` }
    let recipes = b.recipesFor(item.id, null, count)
    if (!recipes.length) {
      const table = b.findBlock({ matching: b.registry.blocksByName.crafting_table.id, maxDistance: 16 })
      if (table) {
        await moveTo(table.position.x, table.position.y + 1, table.position.z, { timeout: 15000 })
        recipes = b.recipesFor(item.id, null, count, table)
      }
    }
    if (!recipes.length) return { ok: false, error: `no recipe or missing ingredients for ${itemName}` }
    try { await b.craft(recipes[0], count) } catch (e) { return { ok: false, error: e.message } }
    emit('crafted', { item: itemName, count })
    return { ok: true, item: itemName, count }
  }

  async function say(text) {
    bot().chat(String(text).slice(0, 240))
    emit('chat', { msg: text })
  }

  // Where a connected player/villager actually is right now.
  function playerPos(name) {
    const b = bot()
    const p = b.players[name]?.entity?.position
    return p ? { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) } : null
  }

  // Self-rescue: teleport high, read the terrain column once the chunks
  // arrive, then land on the surface. Used when a body is stuck, drowning,
  // or lost underground — open transport, honestly logged.
  async function surfaceTp(x, z) {
    const b = bot()
    x = Math.floor(x); z = Math.floor(z)
    await tpTo(x, 140, z)
    let surfaceY = null
    for (let t = 0; t < 10 && surfaceY == null; t++) {
      await sleep(700)
      for (let y = 130; y > -64; y--) {
        const blk = b.blockAt(new Vec3(x, y, z))
        if (blk && !AIR.has(blk.name)) { surfaceY = y; break }
      }
    }
    if (surfaceY == null) { await tpTo(x, 80, z); return false }
    await tpTo(x, surfaceY + 1, z)
    emit('rescued', { to: { x, y: surfaceY + 1, z } })
    return true
  }

  // Deliver goods the vanilla way: stand next to the player and drop the
  // items at their feet. Creative give covers the stock; no /give to the player.
  async function tossItem(itemName, count = 1) {
    const b = bot()
    await equip(itemName.replace(/^minecraft:/, ''))
    const item = b.inventory.items().find((i) => i.name === itemName.replace(/^minecraft:/, ''))
    if (!item) return { ok: false, error: `no ${itemName} to hand over` }
    const n = Math.min(count, item.count)
    await b.toss(item.type, null, n)
    emit('tossed', { item: itemName, count: n })
    return { ok: true, item: itemName, count: n }
  }

  // --- senses ---------------------------------------------------------------
  function inventory() {
    const b = bot()
    const counts = new Map()
    for (const item of b.inventory.items()) counts.set(item.name, (counts.get(item.name) || 0) + item.count)
    return [...counts.entries()].map(([name, count]) => `${name} x${count}`)
  }

  function snapshot() {
    const b = bot()
    const p = b.entity.position
    const timeOfDay = b.time && b.time.timeOfDay != null ? b.time.timeOfDay : null
    const entities = b.entities && Object.values(b.entities)
      .filter((e) => e.type === 'mob' || e.type === 'player')
      .map((e) => ({ name: e.username || e.displayName || e.name, dist: Math.round(e.position.distanceTo(p)) }))
      .filter((e) => e.dist <= 24)
      .slice(0, 12)
    // quick look at the ground around us
    const nearby = []
    for (let dx = -2; dx <= 2; dx += 2) for (let dz = -2; dz <= 2; dz += 2) {
      const bl = b.blockAt(new Vec3(Math.floor(p.x) + dx, Math.floor(p.y) - 1, Math.floor(p.z) + dz))
      if (bl) nearby.push(bl.name)
    }
    return {
      position: { x: Math.round(p.x), y: Math.round(p.y), z: Math.round(p.z) },
      health: b.health, food: b.food,
      inWater: !!b.entity.isInWater,
      timeOfDay, isNight: timeOfDay != null ? (timeOfDay > 13000 && timeOfDay < 23000) : null,
      groundNearby: [...new Set(nearby)],
      entities,
      inventory: inventory(),
      heardChat: state.heardChat.map((c) => ({ from: c.from, text: c.text })),
    }
  }

  function hear(msg) { state.heardChat.push({ ...msg, at: Date.now() }) }

  return {
    username, bot,
    get ready() { return state.ready },
    snapshot, inventory,
    say, hear, equip, moveTo, walkTo, follow, tpTo, digBlock, placeBlock, craftItem,
    playerPos, tossItem, surfaceTp,
  }
}
