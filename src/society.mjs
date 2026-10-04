// society.mjs — composition root: spawn bodies, wake the minds, wire the town
// square. Each villager is a fully independent agent (own context window, own
// model calls, own memory); they meet only through the world and the bus.
// Run: node src/society.mjs   (or `npm start`, which boots the server first)
import { CONFIG, loadKeys } from './config.mjs'
import { createBody } from './world/bot.mjs'
import { createAgent } from './agents/agent.mjs'
import { createBus } from './society/bus.mjs'
import { createClaims } from './society/claims.mjs'
import { createMemory } from './society/memory.mjs'
import { log } from './obs/logger.mjs'

const keys = loadKeys()
if (!keys.GEMINI_API_KEY) {
  console.error('GEMINI_API_KEY missing — paste it into keys.env')
  process.exit(1)
}

const s = CONFIG.server
const bodies = {}
const agents = {}

// --- bodies ---------------------------------------------------------------------
for (const name of Object.keys(CONFIG.personas)) {
  bodies[name] = createBody({
    username: name, host: s.host, port: s.port, version: s.version,
    onEvent: (t, d) => log('body', t, d),
    log,
  })
}
await Promise.all(Object.values(bodies).map((b) => b.ready))
log('system', 'all-spawned', { bots: Object.keys(bodies) })
console.log('bodies spawned:', Object.keys(bodies).join(', '))

// --- society ---------------------------------------------------------------------
const claims = createClaims()

// Phase 4 seats the real moderator agent; until then disputes are heard but
// answered honestly that the court is not yet in session.
const resolveDispute = async (from, { against, topic }) => {
  log('moderator', 'dispute-filed', { from, against, topic })
  return { ruling: 'The moderator is not yet seated. Settle this like neighbors for now.' }
}

const memories = {}
for (const name of Object.keys(CONFIG.personas)) memories[name] = createMemory(name)

for (const [name, persona] of Object.entries(CONFIG.personas)) {
  agents[name] = createAgent({ persona, body: bodies[name], claims, memory: memories[name], resolveDispute })
}

const bus = createBus({ agents: Object.values(agents) })

// Chat flows through the bus exactly once (first bot is the listening ear;
// every bot still passively collects chat into its own senses).
const ear = bodies[Object.keys(bodies)[0]].bot()
ear.on('chat', (username, message) => {
  if (username === ear.username) return
  log('system', 'chat', { username, message })
  bus.route(username, message)
})

// --- let them live ------------------------------------------------------------------
let delay = 4000
for (const a of Object.values(agents)) {
  setTimeout(() => a.wake('you wake up in the village. It is a new day.'), delay)
  delay += 8000
  a.live()
}

log('system', 'ready', { bots: Object.keys(agents), claims: claims.file })
console.log('SOCIETY RUNNING — the villagers are on their own. Ctrl+C to stop.')
