// obs/logger.mjs — JSONL decision log. Every event records WHO decided:
// 'agent' | 'moderator' | 'tool' | 'body' | 'system'. Dashboard (Phase 6)
// streams this same feed over SSE.
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../config.mjs'

fs.mkdirSync(path.dirname(CONFIG.paths.decisions), { recursive: true })

export function log(actor, type, data = {}) {
  const e = { t: new Date().toISOString(), actor, type, ...data }
  fs.appendFileSync(CONFIG.paths.decisions, JSON.stringify(e) + '\n')
  return e
}
