// society/memory.mjs — per-agent memory: durable lines the agent wrote itself
// (`remember` tool) plus a roll-up of old conversation turns, persisted to
// data/memory/<name>.json so a restarted agent resumes as the same person.
import fs from 'node:fs'
import path from 'node:path'
import { CONFIG } from '../config.mjs'

export function createMemory(name) {
  const file = path.join(CONFIG.paths.data, 'memory', `${name}.json`)
  let mem = { durable: [], rollup: '' }
  try { mem = { ...mem, ...JSON.parse(fs.readFileSync(file, 'utf8')) } } catch {}
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(mem, null, 2)) } catch {} }

  return {
    file,
    get durable() { return mem.durable },
    get rollup() { return mem.rollup },
    remember(line) {
      mem.durable.push({ line, t: new Date().toISOString() })
      if (mem.durable.length > 40) mem.durable.splice(0, mem.durable.length - 40)
      save()
    },
    setRollup(text) { mem.rollup = text; save() },
  }
}
