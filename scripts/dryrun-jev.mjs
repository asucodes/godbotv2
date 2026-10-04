// scripts/dryrun-jev.mjs — exercise the exact JEV decision call the agent's
// routine tier makes, with realistic state, without a running server.
// Confirms JEV returns valid actions our executor can dispatch.
// Run: node scripts/dryrun-jev.mjs
import { jevAsk } from '../src/llm/jev.mjs'

const CRITERIA = {
  mine: 'dig resources nearby',
  wander: 'stroll somewhere close',
  explore: 'travel out and look at the land',
  build: 'place a small whim-work (post, cairn, bench, bed)',
  decorate: 'add lanterns or flowers nearby',
  rest: 'pause and breathe',
  chat: 'seek company or murmur a line',
}
const VALID = new Set(Object.keys(CRITERIA))

const scenarios = [
  { name: 'Grimm', role: 'dwarf prospector', pos: { x: 12, y: -60, z: -4 }, isNight: false, entitiesNearby: 0, claimsHeld: 0, reason: 'time passes' },
  { name: 'Willow', role: 'gardener-architect', pos: { x: 3, y: -60, z: 8 }, isNight: false, entitiesNearby: 2, claimsHeld: 1, reason: 'time passes' },
  { name: 'Pearl', role: 'fisher and dreamer', pos: { x: -2, y: -60, z: 20 }, isNight: true, entitiesNearby: 0, claimsHeld: 0, reason: 'time passes' },
]

let failed = false
for (const [i, state] of scenarios.entries()) {
  try {
    const out = await jevAsk({
      action: {
        type: 'choice',
        instructions: `What should ${state.name} (${state.role}) do next? Recent: ${state.reason}.`,
        criteria: CRITERIA,
      },
    }, state)
    const ok = VALID.has(out.action)
    console.log(`[${i + 1}/${scenarios.length}] ${state.name} -> ${out.action} ${ok ? '(valid)' : '(INVALID — executor would fall back to wander)'} `)
    if (!ok) failed = true
  } catch (e) {
    failed = true
    console.log(`[${i + 1}/${scenarios.length}] ${state.name} -> FAIL: ${e.message}`)
  }
}
process.exit(failed ? 1 : 0)
