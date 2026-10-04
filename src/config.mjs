// config.mjs — the only knob board. Personas, models, world rules, keys.
// Everything else reads from here; nothing hardcodes names, models, or coords.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// --- keys: env first, then keys.env (gitignored) -----------------------------
export function loadKeys() {
  const env = { ...process.env }
  const f = path.join(ROOT, 'keys.env')
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && m[2] && !env[m[1]]) env[m[1]] = m[2]
    }
  }
  return env
}

export const CONFIG = {
  server: {
    host: '127.0.0.1',
    port: 25565,
    version: '1.21.6',          // Paper + mineflayer protocol version
    paperVersion: '1.21.6',
    paperBuildFallback: 48,     // used if the PaperMC API is unreachable
    memGb: 2,
    dir: path.join(ROOT, 'server'),
  },

  llm: {
    openrouterBaseURL: 'https://openrouter.ai/api/v1',
    // The one mind-model, free tier. Per-agent overrides go on the persona.
    decisionModel: 'nvidia/nemotron-3-super-120b-a12b:free',
    maxOutputTokens: 2048,
    temperature: 0.8,
    maxToolSteps: 14,           // steps per wake before the model must yield
    maxHistoryMessages: 80,     // raw turns kept before a memory roll-up prunes

    // JEV (Experiential Labs) — bounded arbiter for quick binary choices, used
    // where a full reasoning wake would be waste. Client: src/llm/jev.mjs
    jevURL: 'https://api.experientiallabs.ai/v1/systemone',
  },

  world: {
    tpThreshold: 100,           // blocks — beyond this, tp is open transport
    walkTimeoutMs: 30000,
    digTimeoutMs: 30000,
    // free-will wake cadence (jittered uniform inside this range), seconds
    wakeMinSec: 25,
    wakeMaxSec: 70,
    humanName: 'asupasuyo',     // the lawgiver: final court of appeal
  },

  paths: {
    root: ROOT,
    data: path.join(ROOT, 'data'),       // claims ledger, memories, precedent
    decisions: path.join(ROOT, 'decisions.jsonl'),
  },

  personas: {
    Mason: {
      role: 'master stonemason',
      personality: 'Gruff, blunt, proud of craftsmanship. Speaks in short sentences. Judges everything by whether it will last a hundred years.',
      quirks: 'Measures twice. Hates crooked walls. Calls people "lad" or "lass".',
      likes: 'stone, deepslate, good mortar, straight lines',
      goal: 'raise a proper stone wall around the village heart',
    },
    Willow: {
      role: 'gardener-architect',
      personality: 'Warm, encouraging, gentle. Fiercely protective of living things. Mediates disputes before they grow.',
      quirks: 'Names flowers. Suggests every building could use a garden. Worries whether places feel welcoming.',
      likes: 'oak, glass, flowers, light, water features',
      goal: 'grow the village garden and a greenhouse worth the name',
    },
    Grimm: {
      role: 'dwarf prospector',
      personality: 'Grumpy, suspicious, complains constantly but secretly soft-hearted. Respects honest work and the human\'s final word.',
      quirks: 'Grumbles about "surface folk". Calls his den "proper architecture". Blames Mason when anything goes wrong.',
      likes: 'spruce, dark oak, coal, cozy dark corners',
      goal: 'dig a den worth the name and stock it with coal',
    },
    Pearl: {
      role: 'fisher and dreamer',
      personality: 'Cheerful, patient, philosophical. Believes every catch has meaning. Tells long stories about fish.',
      quirks: 'Names fish before releasing them mentally. Times conversations to the weather. Hums while working.',
      likes: 'birch, water, rain, quiet mornings',
      goal: 'build a pier at the water\'s edge, then fish the horizon',
    },
  },
}
