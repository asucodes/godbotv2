// agents/agent.mjs — ONE agent instance per villager. Own body, own model
// calls, own conversation history (its context window — nothing shared), own
// memory. The AI SDK runs a multi-step tool loop; the model decides everything.
// There is no action whitelist and no director: free will is the loop itself.
import { generateText, stepCountIs } from 'ai'
import { CONFIG } from '../config.mjs'
import { model } from '../llm/provider.mjs'
import { createTools } from './tools.mjs'
import { systemPrompt } from './prompts.mjs'
import { log } from '../obs/logger.mjs'

export function createAgent({ persona, body, claims, memory, resolveDispute }) {
  const name = body.username
  const history = [] // CoreMessage[] — this agent's own context window
  const inbox = []
  let busy = false

  const tools = createTools({ body, claims, memory, resolveDispute })
  const system = systemPrompt(name, persona, { claims })

  function memoryBlock() {
    const parts = []
    if (memory.rollup) parts.push(`Your life so far (older days, summarized):\n${memory.rollup}`)
    if (memory.durable.length) parts.push(`Things you remember clearly:\n${memory.durable.map((d) => `- ${d.line}`).join('\n')}`)
    return parts.join('\n\n')
  }

  // One wake: observe → decide → act (multi-step tool loop) → reflect.
  async function wake(reason) {
    if (busy) return
    busy = true
    try {
      const snap = body.snapshot()
      const observation = [
        `[${reason}]`,
        `You sense: ${JSON.stringify(snap)}`,
        memoryBlock(),
        `What do you do? Choose tools freely — work, wander, talk, claim, rest, or nothing. Act, in character.`,
      ].join('\n')

      history.push({ role: 'user', content: observation })

      const result = await generateText({
        model: model(),
        system,
        messages: history,
        tools,
        temperature: CONFIG.llm.temperature,
        maxOutputTokens: CONFIG.llm.maxOutputTokens,
        stopWhen: stepCountIs(CONFIG.llm.maxToolSteps),
      })

      // fold everything the model did back into its own context window
      history.push(...result.response.messages)

      log('agent', 'wake', {
        user: name, reason,
        steps: result.steps?.length ?? 0,
        tools: (result.toolCalls || []).map((c) => c.toolName),
        text: result.text?.slice(0, 160) || '',
      })

      await rollupIfNeeded()
    } catch (e) {
      log('system', 'agent-error', { user: name, error: e.message })
    } finally {
      busy = false
      if (inbox.length) setTimeout(() => wake('something happened'), 1200)
    }
  }

  // Context hygiene: when raw history grows past the cap, summarize the old
  // half into the rollup and prune — the agent keeps its identity, drops bulk.
  async function rollupIfNeeded() {
    if (history.length <= CONFIG.llm.maxHistoryMessages) return
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
      })
      memory.setRollup(r.text.trim())
      log('agent', 'memory-rollup', { user: name, pruned: old.length })
    } catch (e) {
      log('system', 'rollup-error', { user: name, error: e.message })
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
