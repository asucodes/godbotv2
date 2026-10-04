// agents/agent.mjs — ONE agent instance per villager. Own body, own model
// calls, own conversation history (its context window — nothing shared), own
// memory. Two-tier mind, for efficiency:
//   Tier 1 (routine): JEV picks the activity, the executor carries it out
//   deterministically — zero reasoning-model calls for the mundane Minecraft
//   of walking, mining, whimsical builds, resting.
//   Tier 2 (mind): the OpenRouter reasoning model wakes only when it is
//   actually needed — conversation, a human's word, a conflict or blocked
//   plan, a dispute. Its history is its own; free will lives at both tiers.
import { generateText, stepCountIs } from 'ai'
import { CONFIG } from '../config.mjs'
import { model, cooldownFor, geminiCallOptions } from '../llm/provider.mjs'
import { jevAsk } from '../llm/jev.mjs'
import { createTools } from './tools.mjs'
import { createExecutor } from './executor.mjs'
import { systemPrompt } from './prompts.mjs'
import { log } from '../obs/logger.mjs'

export function createAgent({ persona, body, claims, memory, resolveDispute }) {
  const name = body.username
  const history = [] // CoreMessage[] — this agent's own context window
  const inbox = []
  let busy = false
  let lastAmbient = 0
  let llmBlockedUntil = 0 // quota/rate pause — minds do not hammer a dead API
  const recentPositions = [] // stuck detection

  const tools = createTools({ body, claims, memory, resolveDispute })
  const executor = createExecutor({ body, claims, persona })
  const system = systemPrompt(name, persona, { claims })

  function memoryBlock() {
    const parts = []
    if (memory.rollup) parts.push(`Your life so far (older days, summarized):\n${memory.rollup}`)
    if (memory.durable.length) parts.push(`Things you remember clearly:\n${memory.durable.map((d) => `- ${d.line}`).join('\n')}`)
    return parts.join('\n\n')
  }

  // --- Tier 2: the mind (reasoning model + full tool loop) ----------------------
  async function llmWake(reason, messages = []) {
    // quota pause: answer in character from the persona instead of hammering
    // a rate-limited API — a villager is never silent, just simple-minded now
    if (Date.now() < llmBlockedUntil) {
      if (messages.length) {
        const line = persona.ambient?.[Math.floor(Math.random() * (persona.ambient?.length || 1))] || 'Hmm?'
        await body.say(line)
        log('agent', 'llm-paused-canned', { user: name, reason })
      }
      return
    }
    const snap = body.snapshot()
    history.push({
      role: 'user',
      content: [
        `[${reason}]`,
        messages.length ? messages.map((m) => `${m.from} said to you: "${m.text}"`).join('\n') : null,
        `You sense: ${JSON.stringify(snap)}`,
        memoryBlock(),
        `What do you do? Choose tools freely — work, wander, talk, claim, rest, or nothing. Act, in character.`,
      ].filter(Boolean).join('\n'),
    })

    let result
    try {
      result = await generateText({
        model: model(),
        system,
        messages: history,
        tools,
        temperature: CONFIG.llm.temperature,
        maxOutputTokens: CONFIG.llm.maxOutputTokens,
        stopWhen: stepCountIs(CONFIG.llm.maxToolSteps),
        providerOptions: geminiCallOptions,
      })
    } catch (e) {
      const cooldown = cooldownFor(e)
      if (cooldown) {
        llmBlockedUntil = Date.now() + cooldown
        log('system', 'llm-pause', { user: name, cooldownMs: cooldown, error: e.message.slice(0, 120) })
      } else {
        log('system', 'llm-error', { user: name, error: e.message.slice(0, 160) })
      }
      if (messages.length) {
        const line = persona.ambient?.[Math.floor(Math.random() * (persona.ambient?.length || 1))] || 'Hmm?'
        await body.say(line)
      }
      return
    }

    history.push(...result.response.messages)
    log('agent', 'llm-wake', {
      user: name, reason,
      steps: result.steps?.length ?? 0,
      tools: (result.toolCalls || []).map((c) => c.toolName),
      text: result.text?.slice(0, 160) || '',
    })

    await rollupIfNeeded()
  }

  // --- Tier 1: JEV + nerves (no reasoning-model calls) ----------------------------
  async function routineWake(reason) {
    const snap = body.snapshot()
    let action = 'wander'
    try {
      const out = await jevAsk({
        action: {
          type: 'choice',
          instructions: `What should ${name} (${persona.role}, hobby: ${persona.mineTarget || 'general work'}) do next? Recent: ${reason}. Inventory: ${snap.inventory.slice(0, 6).join(', ') || 'empty'}.`,
          criteria: {
            mine: `dig ${executor.mineTarget} nearby`,
            wander: 'stroll somewhere close',
            explore: 'travel out and look at the land',
            build: 'place a small whim-work (post, cairn, bench, bed)',
            decorate: 'add lanterns or flowers nearby',
            rest: 'pause and breathe',
            chat: 'seek company or murmur a line',
          },
        },
      }, {
        name, role: persona.role, pos: snap.position, isNight: snap.isNight,
        entitiesNearby: (snap.entities || []).length, claimsHeld: claims.byOwner(name).length,
        reason,
      })
      action = out.action || 'wander'
    } catch (e) {
      log('jev', 'error', { user: name, error: e.message }) // fall back to wandering
    }

    // self-preservation comes before any chore: drowning, buried, or rooted
    // to one spot for three wakes — climb out to the surface first
    const posKey = `${snap.position.x},${snap.position.y},${snap.position.z}`
    recentPositions.push(posKey)
    if (recentPositions.length > 3) recentPositions.shift()
    const stuck = recentPositions.length === 3 && recentPositions.every((k) => k === posKey)
    if (snap.inWater || stuck) {
      log('agent', 'self-rescue', { user: name, inWater: snap.inWater, stuck })
      await body.surfaceTp(snap.position.x + 3, snap.position.z + 3)
      recentPositions.length = 0
      memory.remember('I got stuck and climbed back to the surface.')
      return
    }

    const run = executor.actions[action] || executor.actions.wander
    const result = await run(snap)
    log('agent', 'routine', { user: name, action, ...result })

    // ambient in-character line: costs nothing, keeps the villager visible
    const now = Date.now()
    if (result.ambient && persona.ambient?.length && now - lastAmbient > 4 * 60 * 1000) {
      const line = persona.ambient[Math.floor(Math.random() * persona.ambient.length)]
      await body.say(line)
      lastAmbient = now
      log('agent', 'says', { user: name, message: line, via: 'canned' })
    }

    // escalation: the routine layer hit a conflict — wake the mind on it
    if (result.escalate) {
      log('agent', 'escalate', { user: name, action, reason: result.escalate })
      await llmWake(`${reason}. While you ${action}, your instincts hit a snag: ${result.escalate}`)
    }
  }

  // --- context hygiene -----------------------------------------------------------
  async function rollupIfNeeded() {
    if (history.length <= CONFIG.llm.maxHistoryMessages) return
    if (Date.now() < llmBlockedUntil) return // do not spend quota on housekeeping
    const keep = Math.floor(CONFIG.llm.maxHistoryMessages / 2)
    const old = history.splice(0, history.length - keep)
    const transcript = old
      .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 200)}`)
      .join('\n')
    try {
      const r = await generateText({
        model: model(),
        system: 'Summarize what happened to this Minecraft villager in first person, as durable memories ("I built...", "Mason owes me...", "I fell in the ravine..."). 120 words max. Keep names, promises, grudges, unfinished projects.',
        messages: [{ role: 'user', content: `Existing memories:\n${memory.rollup || '(none)'}\n\nNew events:\n${transcript}` }],
        maxOutputTokens: 300,
        providerOptions: geminiCallOptions,
      })
      memory.setRollup(r.text.trim())
      log('agent', 'memory-rollup', { user: name, pruned: old.length })
    } catch (e) {
      log('system', 'rollup-error', { user: name, error: e.message })
    }
  }

  // --- the wake router -------------------------------------------------------------
  async function wake(reason) {
    if (busy) return
    busy = true
    try {
      const messages = inbox.splice(0)
      if (messages.length) await llmWake(reason, messages) // talk → mind
      else await routineWake(reason)                        // chores → JEV + nerves
    } catch (e) {
      log('system', 'agent-error', { user: name, error: e.message })
    } finally {
      busy = false
      if (inbox.length) setTimeout(() => wake('something happened'), 1200)
    }
  }

  // Chat arrives from the bus: humans and other villagers.
  function hear({ from, text }) {
    body.hear({ from, text }) // lands in the next snapshot too
    inbox.push({ from, text })
    log('agent', 'heard', { user: name, from, text })
    // direct address wakes the agent promptly; background chatter waits for cadence
    if (text.toLowerCase().includes(name.toLowerCase()) || from === CONFIG.world.humanName) {
      setTimeout(() => wake(`you were addressed by ${from}`), 1500 + Math.random() * 2500)
    }
  }

  // Free-will cadence: jittered self-wake, forever.
  function live() {
    const w = CONFIG.world
    const next = (w.wakeMinSec + Math.random() * (w.wakeMaxSec - w.wakeMinSec)) * 1000
    setTimeout(async () => {
      await wake('time passes')
      live()
    }, next)
  }

  return { name, wake, hear, live, get busy() { return busy } }
}
