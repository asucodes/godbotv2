// llm/provider.mjs — Google Gemini via the AI SDK's Google provider.
// One provider instance per process; per-agent model calls happen through the
// shared provider but with each agent's own model id and its own history.
// Model: gemini-2.5-flash (generous free-tier rate limits; see config.mjs).
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { CONFIG, loadKeys } from '../config.mjs'

const keys = loadKeys()
if (!keys.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing — paste it into keys.env')

export const google = createGoogleGenerativeAI({ apiKey: keys.GEMINI_API_KEY })

export function model(personaOverride) {
  return google(personaOverride || CONFIG.llm.decisionModel)
}

// Gemini burns maxOutputTokens on hidden thinking by default, truncating the
// visible reply. Villagers act, not ponder — disable it at the call site via
// these provider options.
export const geminiCallOptions = {
  google: { thinkingConfig: { thinkingBudget: 0 } },
}

// True when an error means "stop calling the model for a while" (quota, credit,
// rate limit) rather than "retry this one call".
export function isQuotaError(e) {
  return /rate limit|quota|resource_exhausted|credit|402|429/i.test(String(e?.message || e))
}

// How long the mind should pause after this error. Quota errors are long
// (5 min); transient demand spikes only merit a short breath.
export function cooldownFor(e) {
  const msg = String(e?.message || e)
  if (isQuotaError(e)) return CONFIG.llm.errorCooldownMs
  if (/high demand|unavailable|overloaded|503|timeout/i.test(msg)) return CONFIG.llm.transientCooldownMs
  return 0
}
