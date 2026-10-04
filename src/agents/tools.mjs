// agents/tools.mjs — the capability surface. Tools are the boundary of free
// will: anything not here does not exist physically. Every tool maps to a real
// mineflayer action — no server-command cheats (except tp, which is open
// transport). Zod schemas are the contract the model must satisfy.
import { tool } from 'ai'
import { z } from 'zod'
import { CONFIG } from '../config.mjs'
import { log } from '../obs/logger.mjs'

export function createTools({ body, claims, memory, resolveDispute }) {
  const name = body.username
  const w = CONFIG.world

  const logTool = (toolName, input, result) => log('tool', toolName, { user: name, input, result: summarize(result) })
  const summarize = (r) => typeof r === 'string' ? r.slice(0, 140) : JSON.stringify(r).slice(0, 140)

  return {
    say: tool({
      description: 'Say something in village chat, in character, under 100 chars.',
      inputSchema: z.object({ text: z.string().describe('what to say') }),
      execute: async ({ text }) => {
        const clean = text.replace(/^["'\s]+|["'\s]+$/g, '') // models love wrapping speech in quotes
        await body.say(clean)
        logTool('say', { text: clean }, 'ok')
        return 'spoken'
      },
    }),

    move_to: tool({
      description: `Walk somewhere near you (pathfinding). For journeys over ${w.tpThreshold} blocks use tp_to instead.`,
      inputSchema: z.object({ x: z.number(), z: z.number(), y: z.number().optional().describe('omit to stay at your current ground level') }),
      execute: async ({ x, y, z }) => {
        try { await body.moveTo(x, y ?? body.bot().entity.position.y, z, { timeout: w.walkTimeoutMs, tpThreshold: Infinity }); logTool('move_to', { x, z }, 'arrived'); return 'arrived' }
        catch (e) { logTool('move_to', { x, z }, e.message); return `could not walk there: ${e.message}` }
      },
    }),

    tp_to: tool({
      description: `Teleport to coordinates. Open transport for long journeys (>${w.tpThreshold} blocks). Use it to travel, never to cheat.`,
      inputSchema: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      execute: async ({ x, y, z }) => {
        await body.tpTo(x, y, z); logTool('tp_to', { x, y, z }, 'arrived'); return 'arrived'
      },
    }),

    follow: tool({
      description: `Follow a player or villager for a while.`,
      inputSchema: z.object({ name: z.string() }),
      execute: async ({ name }) => {
        try { await body.follow(name, { timeout: w.walkTimeoutMs }); return 'following — they moved, you moved' }
        catch (e) { return `could not follow: ${e.message}` }
      },
    }),

    dig_block: tool({
      description: 'Dig a specific block. Takes real time; the drops walk into your inventory.',
      inputSchema: z.object({ x: z.number(), y: z.number(), z: z.number() }),
      execute: async ({ x, y, z }) => {
        const r = await body.digBlock(x, y, z, { timeout: w.digTimeoutMs })
        logTool('dig_block', { x, y, z }, r)
        return r.ok ? `dug ${r.block}` : `failed: ${r.error}`
      },
    }),

    mine_nearby: tool({
      description: 'Find and dig the nearest blocks of a type within ~24 blocks (e.g. "stone", "oak_log", "coal_ore"). Digs up to a few and collects drops.',
      inputSchema: z.object({ block: z.string().describe('block id like stone, oak_log, coal_ore'), max: z.number().min(1).max(12).default(4) }),
      execute: async ({ block, max }) => {
        const b = body.bot()
        const target = b.registry.blocksByName[block.replace(/^minecraft:/, '')]
        if (!target) return `unknown block ${block}`
        let dug = 0
        for (let i = 0; i < max; i++) {
          const found = b.findBlocks({ matching: target.id, maxDistance: 24, count: 1 })
          if (!found.length) break
          const p = found[0]
          const r = await body.digBlock(p.x, p.y, p.z, { timeout: w.digTimeoutMs })
          if (!r.ok) { if (i === 0) return `failed: ${r.error}`; break }
          dug++
        }
        logTool('mine_nearby', { block, max }, `dug ${dug}`)
        return dug ? `dug ${dug} ${block}` : `no ${block} within 24 blocks`
      },
    }),

    place_block: tool({
      description: 'Place a block you are carrying at coordinates. Physical placement — you must be within reach.',
      inputSchema: z.object({ x: z.number(), y: z.number(), z: z.number(), block: z.string().describe('item name you hold, e.g. oak_planks') }),
      execute: async ({ x, y, z, block }) => {
        const r = await body.placeBlock(x, y, z, block)
        logTool('place_block', { x, y, z, block }, r)
        return r.ok ? `placed ${block}` : `failed: ${r.error}`
      },
    }),

    craft_item: tool({
      description: 'Craft items from your inventory (uses a nearby crafting table if the recipe needs one).',
      inputSchema: z.object({ item: z.string().describe('e.g. oak_planks, crafting_table, wooden_pickaxe'), count: z.number().min(1).max(64).default(1) }),
      execute: async ({ item, count }) => {
        const r = await body.craftItem(item, count)
        logTool('craft_item', { item, count }, r)
        return r.ok ? `crafted ${count} ${item}` : `failed: ${r.error}`
      },
    }),

    equip: tool({
      description: 'Hold an item from your inventory (pickaxe, sword, food...).',
      inputSchema: z.object({ item: z.string() }),
      execute: async ({ item }) => {
        try { await body.equip(item); return `holding ${item}` } catch (e) { return `failed: ${e.message}` }
      },
    }),

    scan_surroundings: tool({
      description: 'Look around carefully: your position, health, inventory, nearby entities and terrain.',
      inputSchema: z.object({}),
      execute: async () => { const s = body.snapshot(); return JSON.stringify(s) },
    }),

    claim_land: tool({
      description: 'Claim a rectangular plot of land for a reason. Fails honestly if someone already holds overlapping land.',
      inputSchema: z.object({ x1: z.number(), z1: z.number(), x2: z.number(), z2: z.number(), reason: z.string() }),
      execute: async (input) => {
        const r = claims.claim(name, input.x1, input.z1, input.x2, input.z2, input.reason)
        logTool('claim_land', input, r)
        if (r.ok) return `claimed ${r.id} (x${r.rect.x1}..${r.rect.x2}, z${r.rect.z1}..${r.rect.z2})`
        return r.conflictWith
          ? `CONFLICT: that land is already held by ${r.conflictWith} (${r.theirs.reason}). Offer to report the dispute or pick elsewhere.`
          : `failed: ${r.error}`
      },
    }),

    release_land: tool({
      description: 'Give up one of your claimed plots.',
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const r = claims.release(name, id)
        return r.ok ? `released ${id}` : `failed: ${r.error}`
      },
    }),

    check_claims: tool({
      description: 'See the village land ledger — every claim, owner and reason.',
      inputSchema: z.object({}),
      execute: async () => {
        const all = claims.list()
        return all.length ? all.map((c) => `${c.id}: ${c.owner} x${c.rect.x1}..${c.rect.x2} z${c.rect.z1}..${c.rect.z2} — ${c.reason}`).join('\n') : 'no claims yet'
      },
    }),

    report_dispute: tool({
      description: 'Escalate a dispute to the moderator (land, resources, behavior). State your side honestly; both sides will be heard.',
      inputSchema: z.object({ against: z.string().describe('the other villager\'s name'), topic: z.string(), argument: z.string().describe('your side of it, in character') }),
      execute: async (input) => {
        logTool('report_dispute', input, 'filed')
        const r = resolveDispute ? await resolveDispute(name, input) : { ruling: 'The moderator will hear this case soon.' }
        log('moderator', 'ruling-delivered', { user: name, topic: input.topic, ruling: r.ruling })
        return `Dispute filed. The moderator rules: ${r.ruling}`
      },
    }),

    remember: tool({
      description: 'Write a durable memory line you will still know after this moment (grudges, promises, projects, what someone did).',
      inputSchema: z.object({ line: z.string() }),
      execute: async ({ line }) => { memory.remember(line); return 'remembered' },
    }),

    idle: tool({
      description: 'Rest in place for a while. Sometimes the right move is to do nothing.',
      inputSchema: z.object({ seconds: z.number().min(1).max(120).default(15) }),
      execute: async ({ seconds }) => { await new Promise((r) => setTimeout(r, seconds * 1000)); return 'rested' },
    }),
  }
}
