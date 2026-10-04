# Godbot v2

A live Minecraft **autonomous multi-agent society** — villager agents with
independent LLM minds (own context windows, frontier reasoning on Groq) who
walk, mine, build, claim land, and argue, with a moderator agent that settles
their disputes. Real survival work: agents dig, craft, and place every block
themselves. No cheats, no scripted cooldowns — free will.

**v1 is dead.** The Cline SDK is scraped, the committed 82 MB exe is gone, the
broken land-claim code is replaced by a real moderator agent. See
[docs/SPEC.md](docs/SPEC.md) for the full contract and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how it's built.

## Status

Early development — see [PLAN.md](PLAN.md) for the build order and what's done.

## Run (once Phase 1 lands)

```
npm install
npm start        # provisions Paper server, boots it, starts the society
```

Needs Node.js 22+ and a Groq API key in `keys.env` (copy from
`keys.env.example`) or the `GROQ_API_KEY` environment variable.

Join the world at `localhost:25565`, talk to the villagers in chat.
Dashboard: http://localhost:3600
