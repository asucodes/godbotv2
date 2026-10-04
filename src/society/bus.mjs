// society/bus.mjs — the town square. Every chat line in the world flows
// through here exactly once and reaches agent inboxes: named agents hear it
// directly, unaddressed lines land with one random villager (so chatter chains
// instead of dying), and the human's words always wake whoever they touch.
// All agents also passively see chat in their senses — the bus decides who is
// *addressed* by it.
import { CONFIG } from '../config.mjs'

export function createBus({ agents }) {
  const names = agents.map((a) => a.name)

  function route(username, message) {
    const lower = message.toLowerCase()
    const named = names.filter((n) => lower.includes(n.toLowerCase()))
    const targets = named.length ? named : [names[Math.floor(Math.random() * names.length)]]
    for (const a of agents) {
      if (targets.includes(a.name)) a.hear({ from: username, text: message })
    }
    // the human's words always wake exactly the agents they reached
    return { deliveredTo: targets }
  }

  return { route, humanName: CONFIG.world.humanName }
}
