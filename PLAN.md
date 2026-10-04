# Godbot v2 — Build Plan & Progress Tracker

The living roadmap. Each phase lists its deliverables; a checkbox means **done,
verified, and pushed**. Update this file in the same commit as the work it
describes. Phases are ordered; items inside a phase can proceed in parallel.

Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Phase 0 — Repo & contract (baseline)

- [x] Scrape v1: no Cline SDK, no committed binaries, no committed server dir
- [x] `docs/SPEC.md` — product & behavior contract
- [x] `docs/ARCHITECTURE.md` — stack, modules, agent loop, tools, moderator
- [x] `PLAN.md` — this tracker
- [x] Repo skeleton: README, `.gitignore`, `package.json`, clean git history
- [x] Push to `git@github.com:asucodes/godbotv2.git`

## Phase 1 — Foundation (world + bodies)

- [ ] `src/config.mjs` — personas, model ids, world rules (single knob board)
- [ ] Key loading: env / `keys.env` → `GROQ_API_KEY`
- [ ] `src/world/bot.mjs` — mineflayer wrapper: connect, spawn-detection, walk
      (pathfinder), `tp_to` for > 100 blocks, `dig_block`, `place_block`
      (inventory-only), `craft`, `equip`
- [ ] `src/launcher.mjs` — cross-platform provisioner: fetch current Paper jar,
      accept EULA, find/download JRE 21, boot server, detect readiness
      (Windows/Linux/macOS, no PowerShell-only paths)
- [ ] `npm start` boots server + society end-to-end on a clean machine
- [ ] Acceptance: 1 bot connects to fresh server, walks 50 blocks, digs a
      block, places it, without any `/setblock`-style command

## Phase 2 — Agent runtime (minds)

- [ ] Provider wrapper: Groq via `createOpenAICompatible`, retry/backoff on 429,
      model id from config (frontier reasoning model)
- [ ] `src/agents/agent.mjs` — one instance per villager; own AI SDK
      conversation history; multi-step `generateText` tool loop
- [ ] `src/agents/tools.mjs` — zod tool schemas wired to `world/bot.mjs`
- [ ] `src/agents/prompts.mjs` — system prompt from persona + world rules
- [ ] `src/world/sense.mjs` — compact world observation (position, inventory,
      health, hunger, time, nearby entities, heard chat)
- [ ] Free-will wake loop: jittered idle timer → sense → decide → act
- [ ] Acceptance: one agent lives alone for 10 minutes — walks, mines, builds
      something small from materials it gathered, all via tool calls, and its
      history shows it remembering earlier decisions

## Phase 3 — Society

- [ ] `src/society/bus.mjs` — chat routing, mention detection, heard-chat feed
      into agent senses
- [ ] In-character chat tool (`say`) + human recognition (lawgiver priority)
- [ ] `src/society/claims.mjs` — land-claim ledger (owner, bounds, reason, time)
- [ ] Territory tools: `claim_land`, `release_land`, `check_claims`
- [ ] `src/society/memory.mjs` — context hygiene: roll-up of old turns into
      durable memory lines, pruning
- [ ] Acceptance: 4 villagers coexist 30 minutes — chat with each other,
      respond to the human, claim separate land, no shared context leaks

## Phase 4 — Moderator & disputes

- [ ] `src/agents/moderator.mjs` — separate agent instance, own context + model
- [ ] `report_dispute` tool; dispute intake in bus; both parties' arguments
      delivered into moderator context
- [ ] Moderator questioning (whispers to parties), ruling broadcast, ledger
      enforcement
- [ ] Human override: lawgiver message during open dispute is final
- [ ] Acceptance: staged land conflict between two agents is heard and ruled;
      ruling appears in ledger and dashboard; human override works

## Phase 5 — Real building & survival depth

- [ ] `src/build/plan.mjs` — blueprint validation (bounds, duplicates, support)
- [ ] Gather-then-build pipeline: material list → real gathering (mine/chop/
      craft) → block-by-block physical placement → sense-based verification
- [ ] Long-journey transport: auto-`tp_to` beyond 100 blocks (logged)
- [ ] Survival stakes: health/hunger in senses; death handling as memorable event
- [ ] Acceptance: a villager commissioned to "build a cottage" gathers the
      wood itself and a player can watch every block go in; verify report is
      honest (read-back, not assumed)

## Phase 6 — Observability & polish

- [ ] `src/obs/logger.mjs` — JSONL decisions log (agent | moderator | tool | system)
- [ ] `src/obs/dashboard.mjs` — SSE dashboard on :3600 (no meta-refresh), actor colors
- [ ] Model/token usage per decision visible on dashboard
- [ ] README for end users (one-command run, keys, chat examples)
- [ ] Acceptance: full demo run — fresh clone → `npm start` → join world →
      talk, order a build, witness a dispute → all visible on dashboard

## Phase 4.5 — Community features (adopted 2026-10-05)

- [ ] **Session persistence & crash recovery** — agents auto-reconnect after a
      disconnect; on restart each resumes from its saved memory roll-up, so the
      village keeps living across restarts
- [ ] **Moderator precedent (case law)** — every ruling is written to a
      precedent ledger that the moderator and agents can cite; village law
      emerges from play
- [ ] **Signs as world-persistent communication** — agents write real MC signs
      (claim markers, offers, memorials); visible to players, readable by agents
- [ ] **Live world map on the dashboard** — top-down render of claims (colored
      plots), build sites, and agent positions over SSE
- [ ] **Chronicler agent** — a seventh mind that watches the decision log and
      writes the village chronicle (markdown + dashboard feed)
- [ ] **Gossip with distortion** — relayed chat is paraphrased naturally by the
      receiving agent's model; rumors degrade in transit
- [ ] **Contracts between agents** — "planks for cobble" promise ledger,
      enforced socially and by the moderator

## Backlog (post-2.0)

- [ ] Night danger: mob defense makes walls/torches/shelter matter (declined
      for 2.0, revisit)
- [ ] Group commissions: several villagers split one large build
- [ ] Per-agent voice/model differentiation (cheap chat lane per persona)
- [ ] Two villages: trade, rivalry, contested borders
- [ ] Reputation system: agents that ignore rulings become known for it
- [ ] Village meetings: convene tool, moderator chairs open debate
- [ ] Replay system: time-scrubber over the decision log + map
- [ ] Automated eval harness: scripted headless scenarios (land conflict,
      griefing bot, resource shortage)
- [ ] Unit tests for plan validator, memory rollup

---

## Decisions log

| Date       | Decision                                                       |
| ---------- | -------------------------------------------------------------- |
| 2026-10-05 | Scrape `@cline/sdk` entirely; adopt Vercel AI SDK for agents   |
| 2026-10-05 | Groq frontier reasoning models for decisions; per-agent calls   |
| 2026-10-05 | Free will: no action whitelist; tools are the only boundary     |
| 2026-10-05 | Moderator agent for land conflicts; human is final appeal       |
| 2026-10-05 | Survival physics: no `/setblock`/`/give` cheats for agents      |
| 2026-10-05 | TP allowed as transport for > 100 blocks, logged                |
| 2026-10-05 | Fresh Paper server provisioned at runtime; nothing server-side  |
|            | in git; cross-platform launcher                                 |
