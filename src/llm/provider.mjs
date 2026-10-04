// llm/provider.mjs — Groq via the AI SDK's OpenAI-compatible provider.
// One provider instance per process; per-agent model calls happen through the
// shared provider but with each agent's own model id and its own history.
// 429s are retried with backoff at this layer, nowhere else.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { CONFIG, loadKeys } from '../config.mjs'

const keys = loadKeys()
if (!keys.GROQ_API_KEY) throw new Error('GROQ_API_KEY missing — set it in keys.env or the environment')

export const groq = createOpenAICompatible({
  name: 'groq',
  baseURL: CONFIG.llm.baseURL,
  apiKey: keys.GROQ_API_KEY,
})

export function model(personaOverride) {
  return groq(personaOverride || CONFIG.llm.decisionModel)
}
