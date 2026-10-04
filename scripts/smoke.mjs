// scripts/smoke.mjs — verify both API keys with one call each.
// Run: node scripts/smoke.mjs
import { generateText } from 'ai'
import { CONFIG, loadKeys } from '../src/config.mjs'
import { jevAsk } from '../src/llm/jev.mjs'

const keys = loadKeys()
let failed = false

// --- Gemini / agent mind -------------------------------------------------------
console.log(`[1/2] Gemini — ${CONFIG.llm.decisionModel}`)
try {
  if (!keys.GEMINI_API_KEY || keys.GEMINI_API_KEY.startsWith('paste')) throw new Error('key not pasted into keys.env yet')
  const r = await generateText({
    model: (await import('../src/llm/provider.mjs')).model(),
    system: 'You are a Minecraft villager named Mason, a gruff stonemason. Answer with one short spoken line, in character, no markdown.',
    messages: [{ role: 'user', content: 'A traveler asks: is the village safe at night?' }],
    maxOutputTokens: 100,
  })
  console.log('  OK — Mason says: ' + JSON.stringify(r.text))
} catch (e) {
  failed = true
  console.log('  FAIL — ' + e.message)
}

// --- JEV -----------------------------------------------------------------------
console.log('[2/2] JEV — ' + CONFIG.llm.jevURL)
try {
  if (!keys.JEV_API_KEY || keys.JEV_API_KEY.startsWith('paste')) throw new Error('key not pasted into keys.env yet')
  const out = await jevAsk(
    { mood: { type: 'choice', instructions: 'How does the villager feel right now?', criteria: { happy: 'Content and social', restless: 'Wants to work or move', weary: 'Tired, low energy' } } },
    { name: 'Mason', timeOfDay: 'morning', recentEvent: 'finished a wall segment' },
  )
  console.log('  OK — JEV says: ' + JSON.stringify(out))
} catch (e) {
  failed = true
  console.log('  FAIL — ' + e.message)
}

process.exit(failed ? 1 : 0)
