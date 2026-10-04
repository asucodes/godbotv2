// llm/provider.mjs — OpenRouter via the AI SDK's OpenAI-compatible provider.
// One provider instance per process; per-agent model calls happen through the
// shared provider but with each agent's own model id and its own history.
// Model: nvidia/nemotron-3-super-120b-a12b:free (see config.mjs).
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { CONFIG, loadKeys } from '../config.mjs'

const keys = loadKeys()
if (!keys.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY missing — paste it into keys.env')

export const openrouter = createOpenAICompatible({
  name: 'openrouter',
  baseURL: CONFIG.llm.openrouterBaseURL,
  apiKey: keys.OPENROUTER_API_KEY,
  headers: {
    'HTTP-Referer': 'http://localhost', // OpenRouter attribution headers
    'X-Title': 'godbotv2',
  },
})

export function model(personaOverride) {
  return openrouter.chatModel(personaOverride || CONFIG.llm.decisionModel)
}
