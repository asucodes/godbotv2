// llm/jev.mjs — JEV (Experiential Labs) client. JEV is a bounded arbiter: it
// answers fixed-choice questions with logged probabilities, cheaply and
// deterministically. In v2 the reasoning model holds free will; JEV is the
// cheap referee for small binary choices where a full wake would be waste
// (e.g. "should this wake end now?"). Never used to restrict an agent — only
// to offer nudges the agent's own mind can weigh.
import { CONFIG, loadKeys } from '../config.mjs'
import { log } from '../obs/logger.mjs'

const keys = loadKeys()

export async function jevAsk(questions, state) {
  const res = await fetch(CONFIG.llm.jevURL, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + keys.JEV_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state, model: 'jev-latest', questions }),
  })
  if (!res.ok) throw new Error(`JEV ${res.status}: ${(await res.text()).slice(0, 120)}`)
  const json = await res.json()
  const out = {}
  for (const k of Object.keys(json.answers || {})) out[k] = json.answers[k].choice
  log('jev', 'decision', { questions: Object.keys(questions), ...out })
  return out
}
