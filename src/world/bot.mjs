// world/bot.mjs — the body. One mineflayer bot per agent: walking, teleport as
// open transport, real digging with drop pickup, physical block placement from
// inventory only, real crafting. No /setblock, /give or /fill anywhere.
// Survives disconnects with bounded auto-reconnect.
import mineflayer from 'mineflayer'
import { Vec3 } from 'vec3'
import { pathfinder, Movements, goals } from 'mineflayer-pathfinder'

const { GoalNear, GoalBlock } = goals
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

  function bind(bot) {
    bot.loadPlugin(pathfinder)
    bot.on('chat', (from, text) => {
      if (from === username) return
      state.heardChat.push({ from, text, at: Date.now() })
      if (state.heardChat.length > 30) state.heardChat.splice(0, state.heardChat.length - 30)
    })
    bot.on('error', (e) => log('body', 'error', { user: username, error: e.message }))
    bot.on('kicked', (reason) => log('body', 'kicked', { user: username, reason: String(reason).slice(0, 200) }))
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
  async function equip(itemName) {
    const b = bot()
    const held = b.heldItem
    if (held && held.name === itemName) return
    const item = b.inventory.items().find((i) => i.name === itemName || i.name === itemName.replace(/^minecraft:/, ''))
    if (!item) throw new Error(`no ${itemName} in inventory`)
    await b.equip(item, 'hand')
  }

  // Dig a block, then walk over the drops so they actually enter inventory.
  async function digBlock(x, y, z, { timeout = 30000 } = {}) {
    const b = bot()
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
      timeOfDay, isNight: timeOfDay != null ? (timeOfDay > 13000 && timeOfDay < 23000) : null,
      groundNearby: [...new Set(nearby)],
      entities,
      inventory: inventory(),
      heardChat: state.heardChat.map((c) => ({ from: c.from, text: c.text })),
    }
  }

  function hear(msg) { state.heardChat.push({ ...msg, at: Date.now() }) }

  return {
    username, bot, ready, snapshot, inventory,
    say, hear, equip, moveTo, walkTo, follow, tpTo, digBlock, placeBlock, craftItem,
  }
}
