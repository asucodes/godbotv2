// society/bus.mjs — the town square. Every chat line in the world flows
// through here exactly once and reaches agent inboxes: named agents hear it
// directly, unaddressed lines land with one random villager (so chatter chains
// instead of dying), and the human's words always wake whoever they touch.
// All agents also passively see chat in their senses — the bus decides who is
// *addressed* by it.
import { CONFIG } from '../config.mjs'
import { isServerNoise } from '../world/bot.mjs'

export function createBus({ agents }) {
  const names = agents.map((a) => a.name)
  let duty = 0 // rotating duty officer for unaddressed lines — bounds model calls

  function route(username, message) {
    if (isServerNoise(message)) return { deliveredTo: [] } // command feedback is not conversation
    const lower = message.toLowerCase()
    const named = names.filter((n) => lower.includes(n.toLowerCase()))
    if (username === CONFIG.world.humanName) {
      // the supreme commander is always heard — but the free model quota is
      // finite: tagged bots respond; an unaddressed line lands with the duty
      // officer; "everyone" summons the whole village
      let targets = named.length ? named : [names[duty++ % names.length]]
      if (!named.length && /\beveryone\b|all of you|assemble/i.test(lower)) targets = names
      for (const a of agents) {
        if (targets.includes(a.name)) a.hear({ from: username, text: message })
      }
      return { deliveredTo: targets }
    }
    const targets = named.length ? named : [names[Math.floor(Math.random() * names.length)]]
    for (const a of agents) {
      if (targets.includes(a.name)) a.hear({ from: username, text: message })
    }
    return { deliveredTo: targets }
  }

  return { route, humanName: CONFIG.world.humanName }
}
