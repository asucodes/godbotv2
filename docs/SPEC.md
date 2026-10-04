# Godbot v2 — Product & Behavior Spec

This document is the contract for what Godbot v2 **is**. Every feature below is a
requirement, not a nice-to-have. `PLAN.md` tracks which of these are built.

## 1. What Godbot v2 is

A live Minecraft **autonomous multi-agent society**: several villager agents with
genuinely independent LLM minds who live in a shared world — walk it, mine it,
build in it, claim land on it, talk to each other and to the human — with **free
will**, real physical work (no cheats), and one neutral moderator mind that
settles disputes between them.

v1's flaws we are explicitly killing:

| v1 (dead)                                          | v2 (required)                                              |
| -------------------------------------------------- | ---------------------------------------------------------- |
| Cline SDK (broken, scraped entirely)               | A real agent SDK with tool-calling (Vercel AI SDK)          |
| One shared 600ms LLM queue, tiny models            | Each agent calls frontier reasoning models on its own       |
| Stateless think-cycles, no memory                  | Every agent owns its context window and remembers its life  |
| `/setblock`, `/give`, `/fill` — blocks teleported in| Real mining, inventory, crafting, physical block placement  |
| Hardcoded action whitelist + cooldowns             | Free will: the model chooses from open-ended tools          |
| Land-claim / conflict code written but never wired | A dedicated moderator agent enforces territory, live        |
| Windows-only launcher, committed server dir + exe  | Cross-platform provisioner; server and binaries never in git|
| Fixed flat-world y=-60 assumptions everywhere      | Works on any terrain the agents are standing on             |

## 2. Agents

### 2.1 One instance per villager

Each villager is its own **agent instance** with:

- its own mineflayer bot (body) and its own event loop;
- its own **conversation history** (context window) managed by the agent SDK —
  nothing is shared between agents' minds;
- its own persona (role, personality, quirks, speech style) loaded from config;
- its own tool set and its own decision loop. No global director, no shared
  queue: agents run concurrently and only meet through the world and chat.

### 2.2 Frontier reasoning, unrestricted

- Decision-making uses a **frontier reasoning model on Groq** (best available
  reasoning model; configurable per-agent in config). Ambient chat may use a
  cheaper model, but no agent is ever limited to a crippled model.
- **No model is restricted from doing anything.** There is no hardcoded action
  whitelist, no "you may only build in this box", no cooldown-gated behavior
  script. Agents are given world state, tools, and their persona — and choose.
  Safety comes from the SDK's tool schemas and the moderator, not from strings
  of regexes deciding what an agent may hear or do.

### 2.3 Free will

An agent's default state is autonomous. Each agent, on its own cadence:

1. observes the world (position, surroundings, inventory, health, time, weather,
   nearby entities, recent chat it heard);
2. decides — via the reasoning model — what it wants to do next;
3. executes that decision with tools, possibly over many steps;
4. reflects (its actions and outcomes go back into its own context window).

Agents may wander far, start projects no one asked for, abandon them, gossip,
trade, mine all night, or ignore a command if it is out of character. The human
can always give orders, but free will is the default, not the fallback.

## 3. The world: real work, no cheats

- **Survival rules for agents.** Blocks are obtained by mining (`bot.dig`),
  items via crafting, blocks placed physically (`bot.placeBlock`). No
  `/setblock`, `/give`, `/fill`, or `/tp` issued *as a cheat* by agents.
- **Movement:** agents walk with pathfinding for normal distances. For long
  journeys (> 100 blocks) they may **teleport** (server-side `/tp` as a
  transport convenience, openly, not hidden as block manipulation).
- Buildings must be **actually constructed**: agents gather the materials
  first (mine or receive them), walk to the site, and place blocks one by one,
  visible to any player watching. A build that runs out of planks gets more
  planks — by chopping, mining, or asking a neighbor.
- The world is a real survival server (resources exist, day/night runs). Agents
  have health and hunger; death is possible and is an event they remember.

## 4. Society, territory, and the moderator

### 4.1 Chat

All in-game chat flows through a message bus. Every agent hears what is said
near it and decides for itself whether/how to respond. Agents talk to each
other in character; their chat history lives in their own context.

### 4.2 Land claims

Agents can claim territory for a build, a home, or a project. Claims are a
shared, inspectable ledger (who owns what rectangle, since when, why).

### 4.3 The Moderator agent

- One dedicated **moderator agent** — a separate agent instance with its own
  context window and its own model calls — exists above the villagers.
- When two agents want the same land, or disagree about shared resources,
  boundaries, or griefing, the dispute goes to the moderator.
- The moderator hears both sides (their arguments are delivered into its
  context), rules, and the ruling is **enforced by the system** (claims ledger
  updated; agents are told and expected to comply).
- The human is the final court of appeal: any human message during an open
  dispute overrides the moderator.

## 5. The human

- Joins the world as a player and talks in chat. Agents recognize the human by
  name and treat direct orders as high-priority — but stay in character.
- The human can ask agents to build, follow, stop, explain themselves, or rule
  on a dispute (overriding the moderator).
- No special command grammar is required; agents parse intent themselves.

## 6. Infrastructure

- **Server:** a fresh Paper (current stable) server, provisioned automatically —
  jar download, EULA, JRE detection/download, startup, readiness detection.
  Nothing server-side (jars, worlds, logs) is ever committed to git.
- **Cross-platform:** pure Node.js + npm. Runs on Windows, Linux, macOS. No
  `where.exe`, no PowerShell-only paths, no committed binaries.
- **Launcher:** one command (`npm start`) provisions the server if missing,
  boots it, waits for readiness, then starts the society.
- **Observability:** every agent decision, tool call, and moderator ruling is
  logged (JSONL) and visible on a live local dashboard (SSE, not page refresh),
  colored by actor: agent / moderator / tool / system.
- **Keys:** Groq API key from env or `keys.env` (gitignored). Never committed.

## 7. Non-goals (for v2.0)

- No multiplayer across machines (localhost world; the human is local).
- No economy system beyond agents exchanging items/chat.
- No training or fine-tuning; everything is prompted.
- No web UI for controlling agents; the game chat is the interface.
