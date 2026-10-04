// launcher.mjs — cross-platform provisioner + runner. Works on Windows, Linux,
// macOS with nothing but Node 22+. Provisions a fresh Paper server (jar, EULA,
// server.properties, ops.json with offline UUIDs so the bots are opped), finds
// or downloads a JRE 21, boots the server, waits for readiness, then starts the
// society. Nothing server-side is committed to git.
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { CONFIG, loadKeys } from './config.mjs'

const ROOT = CONFIG.paths.root
const SERVER = CONFIG.server.dir
const RUNTIME = path.join(ROOT, 'runtime')
const say = (s) => console.log('[godbot] ' + s)
const die = (s) => { console.error('[godbot] FATAL: ' + s); process.exit(1) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- offline-mode UUID (md5 v3 of "OfflinePlayer:<name>") so bots can be opped
function offlineUuid(name) {
  const h = createHash('md5').update('OfflinePlayer:' + name).digest()
  h[6] = (h[6] & 0x0f) | 0x30
  h[8] = (h[8] & 0x3f) | 0x80
  const s = h.toString('hex')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

async function download(url, dest, label) {
  say(`downloading ${label}...`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) die(`download failed (${res.status}) for ${label}`)
  const out = fs.createWriteStream(dest)
  await new Promise((resolve, reject) => {
    Readable.fromWeb(res.body).pipe(out)
    out.on('error', reject)
    out.on('finish', resolve)
  })
}

function portUp(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const s = net.connect({ port, host, timeout: 1500 })
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => resolve(false))
    s.on('timeout', () => { s.destroy(); resolve(false) })
  })
}

// Resolve the current Paper build for the configured version via the Fill v3
// API (v2 is retired and answers 410); fall back to the pinned build if the
// API is unreachable.
async function paperJarUrl() {
  const v = CONFIG.server.paperVersion
  try {
    const res = await fetch(`https://fill.papermc.io/v3/projects/paper/versions/${v}/builds/latest`)
    if (res.ok) {
      const data = await res.json()
      const url = data.downloads?.['server:default']?.url
      if (url) return url
    }
  } catch { /* offline API — fall through */ }
  const base = `https://fill.papermc.io/v3/projects/paper/versions/${v}`
  return `${base}/builds/${CONFIG.server.paperBuildFallback}/downloads/paper-${v}-${CONFIG.server.paperBuildFallback}.jar`
}

// Find Java 21 on PATH (any OS), else download the right Temurin JRE and
// extract with `tar`, which handles zip (modern Windows) and tar.gz (unix).
function findJava21() {
  const bin = process.platform === 'win32' ? 'where.exe' : 'which'
  const r = spawnSync(bin, ['java'], { encoding: 'utf8' })
  if (r.status !== 0) return null
  const cand = r.stdout.split(/\r?\n/)[0].trim()
  const v = spawnSync(cand, ['-version'], { encoding: 'utf8' })
  return (v.stderr || '').includes('"21.') ? cand : null
}

const TEMURIN = {
  win32: { url: 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jre/hotspot/normal/eclipse', ext: 'zip' },
  linux: { url: 'https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jre/hotspot/normal/eclipse', ext: 'tar.gz' },
  darwin: { url: 'https://api.adoptium.net/v3/binary/latest/21/ga/aarch64/jre/hotspot/normal/eclipse', ext: 'tar.gz' },
}

async function ensureJava() {
  const java = findJava21()
  if (java) { say('java 21: ' + java); return java }
  say('no Java 21 on PATH — downloading Temurin JRE...')
  const t = TEMURIN[process.platform]
  if (!t) die('Java 21 required and no Temurin build for ' + process.platform)
  fs.mkdirSync(RUNTIME, { recursive: true })
  const archive = path.join(RUNTIME, 'jre21.' + t.ext)
  await download(t.url, archive, 'Temurin JRE 21')
  say('extracting JRE...')
  // Windows' GNU tar (Git Bash) can't read zip; its native bsdtar can. On unix
  // plain tar handles tar.gz. PowerShell Expand-Archive is the last resort.
  let ok = false
  if (process.platform === 'win32') {
    ok = spawnSync('C:\\Windows\\System32\\tar.exe', ['-xf', archive, '-C', RUNTIME]).status === 0
    if (!ok) ok = spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -Force '${archive}' '${RUNTIME}'`]).status === 0
  } else {
    ok = spawnSync('tar', ['-xf', archive, '-C', RUNTIME]).status === 0
  }
  if (!ok) die('JRE extraction failed')
  fs.unlinkSync(archive)
  const jdk = fs.readdirSync(RUNTIME).find((d) => fs.existsSync(path.join(RUNTIME, d, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')))
  if (!jdk) die('JRE not found after extraction')
  const javaPath = path.join(RUNTIME, jdk, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')
  say('java 21 (downloaded): ' + javaPath)
  return javaPath
}

function provisionServer() {
  fs.mkdirSync(SERVER, { recursive: true })
  fs.writeFileSync(path.join(SERVER, 'eula.txt'), 'eula=true\n')
  fs.writeFileSync(path.join(SERVER, 'server.properties'), [
    `server-port=${CONFIG.server.port}`,
    'online-mode=false',
    'gamemode=creative',
    'difficulty=normal',
    'motd=Godbot v2 — a living village',
    'spawn-protection=0',
    'view-distance=10',
    'level-type=minecraft\\:normal',
    '',
  ].join('\n'))
  const ops = [...Object.keys(CONFIG.personas), CONFIG.world.humanName].map((name) => ({
    uuid: offlineUuid(name), name, level: 4, bypassesPlayerLimit: true,
  }))
  fs.writeFileSync(path.join(SERVER, 'ops.json'), JSON.stringify(ops, null, 2))
}

async function ensureServer() {
  const jar = path.join(SERVER, 'paper.jar')
  if (!fs.existsSync(jar)) {
    await download(await paperJarUrl(), jar, `Paper ${CONFIG.server.paperVersion}`)
  } else say('paper.jar present')
  provisionServer()
}

async function startServer(java) {
  if (await portUp(CONFIG.server.port)) { say('server already up on ' + CONFIG.server.port); return null }
  say('starting Minecraft server (first boot generates the world — be patient)...')
  const log = fs.openSync(path.join(SERVER, 'server.log'), 'a')
  const err = fs.openSync(path.join(SERVER, 'server.err'), 'a')
  const child = spawn(java, [`-Xms${CONFIG.server.memGb}G`, `-Xmx${CONFIG.server.memGb}G`, '-jar', 'paper.jar', '--nogui'],
    { cwd: SERVER, stdio: ['ignore', log, err] })
  const t0 = Date.now()
  for (;;) {
    await sleep(2000)
    if (await portUp(CONFIG.server.port)) { say('server is UP on ' + CONFIG.server.port); break }
    if (child.exitCode !== null) die(`server exited with ${child.exitCode} — see server/server.log`)
    if (Date.now() - t0 > 300000) die('server did not come up in 5 minutes — see server/server.log')
  }
  return child
}

const kids = []
function track(p) { kids.push(p); p.once('exit', () => { const i = kids.indexOf(p); if (i >= 0) kids.splice(i, 1) }) }

async function main() {
  const keys = loadKeys()
  if (!keys.OPENROUTER_API_KEY) {
    die('missing OPENROUTER_API_KEY — paste it into keys.env (see keys.env.example)')
  }
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    say('node_modules missing — run `npm install` first'); process.exit(1)
  }
  const java = await ensureJava()
  await ensureServer()
  const server = await startServer(java)
  if (server) track(server)

  say('launching the society — the villagers are on their own now')
  const society = spawn(process.execPath, [path.join(ROOT, 'src', 'society.mjs')], { stdio: 'inherit' })
  track(society)
  society.on('exit', (c) => process.exit(c ?? 0))
}

main().catch((e) => die(e.stack || e.message))

process.on('SIGINT', () => {
  say('shutting down — stopping society and server...')
  for (const k of kids) { try { k.kill() } catch {} }
  setTimeout(() => process.exit(0), 1500)
})
