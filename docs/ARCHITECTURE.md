# Godbot v2 — Architecture

## 1. Stack

| Layer            | Choice                                   | Why |
| ---------------- | ---------------------------------------- | --- |
| Runtime          | Node.js 22+ (ESM)                        | mineflayer is Node-native; ESM everywhere |
| Minecraft client | `mineflayer` + `mineflayer-pathfinder`   | proven protocol client, real dig/place/walk |
| Agent runtime    | **Vercel AI SDK (`ai`)**                 | real tool-calling agent loop, per-agent message history (own context window), `stopWhen`/step control, works with any OpenAI-compatible endpoint |
| LLM provider     | **Groq** via `createOpenAICompatible`    | OpenAI-compatible API; frontier reasoning models; fast; free tier exists. v1's Cline SDK is scraped — it does not appear anywhere in v2 |
| Server           | Paper (current stable)                   | provisioned at runtime by the launcher, never committed |
| Dashboard        | Express + SSE                            | live decision feed without page refresh |
| Validation       | `zod`                                    | tool parameter schemas shared by SDK and code |

The Cline SDK (`@cline/sdk`) from v1 is **removed entirely**. It is not a
dependency, not referenced, not shipped.

## 2. Layout

```
godbotv2/
  src/
    config.mjs          personas, models, world rules — the only place with knobs
    launcher.mjs        provision server (jar/JRE/EULA), boot it, wait ready, start society
    society.mjs         composition root: spawn bodies, create agents + moderator, wire bus
    world/
      bot.mjs           mineflayer wrapper: connect, walk, tp, dig, place, craft, sense
      sense.mjs         snapshots the world into compact text for the model's context
    agents/
      agent.mjs         ONE agent instance per villager: own AI SDK conversation, tool loop
      moderator.mjs     the moderator agent: own context, hears disputes, rules
      tools.mjs         zod-defined tools exposed to every agent (move, mine, build, chat, claim…)
      prompts.mjs       system prompts assembled from persona + world rules
    society/
      bus.mjs           chat routing, mentions, dispute intake
      claims.mjs        land-claim ledger (who owns what, since when, why)
      memory.mjs        per-agent long-term memory lines folded into context
    obs/
      logger.mjs        JSONL decision log (actor: agent|moderator|tool|system)
      dashboard.mjs     SSE dashboard on :3600
  server/               provisioned at runtime; gitignored except .gitkeep
  docs/
    SPEC.md             the contract (what v2 must do)
    ARCHITECTURE.md     this file
  PLAN.md               build order + progress tracker
```

## 3. The agent loop (core of the system)

Each villager runs one `Agent` instance. Nothing about an agent's mind is
global — not its model calls, not its history, not its tools.

```
                ┌──────────────────────────────────────────────┐
                │                 Agent instance               │
   events ────► │  inbox ──────────────┐                       │
   (chat,       │                      ▼                       │
   damage,      │  ┌─────────────────────────────┐             │
   deaths,      │  │ system prompt               │             │
   timers)      │  │  = persona + world rules    │             │
                │  │    + senses + memory        │             │
                │  ├─────────────────────────────┤             │
                │  │ own conversation history    │  ← context  │
                │  │ (AI SDK CoreMessage[])      │    window   │
                │  ├─────────────────────────────┤             │
                │  │ tools (zod schemas):        │             │
                │  │  move_to, tp_to, dig_block, │             │
                │  │  place_block, craft, chat,  │             │
                │  │  claim_land, check_claims,  │             │
                │  │  report_dispute, sleep …    │             │
                │  └──────────┬──────────────────┘             │
                └─────────────┼────────────────────────────────┘
                              ▼
                     generateText({ model, messages, tools,
                                    stopWhen: stepCountIs(N) })
                              │  tool calls execute against the
                              ▼  body (mineflayer bot) and their
                                 results append to history
```

Rules of the loop:

1. **The model decides.** No code path picks actions from regexes. `generateText`
   runs a multi-step tool loop; the model may call any tool, in any order,
   including "do nothing" (`idle`).
2. **Own context window.** The `messages` array belongs to the agent. Senses
   (position, inventory, health, nearby entities, heard chat) are folded in as
   compact observation messages; outcomes of tool calls come back as tool
   results. The agent remembers its own past decisions.
3. **Context hygiene.** A `memory.mjs` rollup summarizes old turns into durable
   memory lines (grudges, projects, promises) so the window stays small without
   losing identity. Long raw turns are pruned after summarization.
4. **Concurrency without stampede.** Agents run independently (no shared
   global queue like v1's 600 ms chain). Per-model rate limits are handled by
   retry-with-backoff inside the provider wrapper only.
5. **Free will cadence.** When idle, each agent wakes on a jittered timer,
   senses, and simply asks its model what to do. There is no whitelist of
   moods or hobbies gating behavior.

## 4. Tools (the boundary of free will)

Tools are the *capability* surface, not a restriction: anything not exposed as
a tool simply does not exist physically. All tools are real mineflayer actions —
no server-command cheats in the tool set.

- **Move:** `move_to(x,z)` (pathfinder walk), `tp_to(x,y,z)` (allowed and
  encouraged for > 100 blocks, logged as transport), `look_at`
- **Work:** `dig_block(x,y,z)`, `place_block(x,y,z,block)` (only blocks held in
  inventory), `craft(recipe,count)` (real crafting table logic), `equip(item)`
- **Sense:** `scan_surroundings`, `find_blocks(type,radius)`, `read_chest` / later
- **Social:** `say(text)`, `whisper(name,text)`
- **Territory:** `claim_land(x1,z1,x2,z2,reason)`, `release_land`, `check_claims`,
  `report_dispute(against,topic,argument)`
- **Self:** `idle(duration)`, `remember(line)` (write a durable memory line)

Placement with a block you do not own fails at the tool layer (normal survival
behavior), which the model experiences as a tool error and must plan around.
That is the honest physics — no `/give` escape hatch.

## 5. The Moderator

A second agent instance, same machinery, different prompt and tool set:

- **Input:** dispute records from `report_dispute` — both parties' claims and
  their stated arguments, plus claim-ledger facts.
- **Behavior:** it may ask each party questions (delivered as whispers), weigh
  the ledger and precedent in its own context, then rule.
- **Enforcement:** the ruling is applied to the claims ledger by the system and
  broadcast. Agents that repeatedly ignore rulings develop a reputation line in
  their memory that other agents can see — social, not hard-coded, pressure.
- **Appeal:** any human chat message while a dispute is open overrides the
  moderator; the human's word is written to the ledger as the final ruling.

## 6. Real building pipeline

1. Agent decides to build X (own initiative or commissioned in chat).
2. It picks a site (free terrain, respects claims — checked via `check_claims`,
   enforced socially and by the ledger), claims it.
3. It computes a material list from its blueprint and **gathers**: mines stone,
   chops wood, crafts planks — real inventory counts, real tool wear.
4. It walks to the site and places blocks one at a time with `place_block`,
   standing adjacent, visible to players.
5. On completion it verifies by reading back the blocks it placed (sense, not
   cheat) and reports honestly what stands and what doesn't.

A shared `build/plan.mjs` (v1's planner concept, kept) validates blueprints for
structural sanity before any block is touched: bounds, duplicates, support.
The LLM still designs; the plan check is arithmetic, not policy.

## 7. Observability

Same philosophy as v1, better plumbing: every decision event — agent wake, tool
call + result, model name, token use, moderator ruling, claim change — goes to
`decisions.jsonl` and is streamed to the dashboard over SSE. Actor classes:
`agent`, `moderator`, `tool`, `system`. The dashboard shows who decided what,
when, and on which model.

## 8. Configuration

`src/config.mjs` is the only knob board:

- villager personas (name, role, personality, quirks, materials preference)
- per-agent model id (default: best frontier reasoning model on Groq; ambient
  chat lane may name a cheaper one — cheap lane is an optimization, never a cage)
- world rules (server port, view distances, wake cadence bounds, tp threshold)
- moderator model + dispute timeout
- keys: `GROQ_API_KEY` from env or `keys.env` (gitignored)
