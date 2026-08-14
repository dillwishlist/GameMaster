# GameMaster

A self-hosted, LAN-only engine for running live competitive games in a room
full of people. The quizmaster drives play from a tablet, a TV shows the
audience view, and player devices are optional — because a two-year-old does
not have a phone.

```
                 ┌──────────────────┐
   iPad Safari → │  /host           │  control surface   [over wifi]
                 ├──────────────────┤
   Laptop     →  │  /display        │  → HDMI → TV       [local, wired]
                 ├──────────────────┤
   Phones     →  │  /play/:code     │  optional, Phase 3
                 └────────┬─────────┘
                          │ WebSocket
                 ┌────────┴─────────┐
                 │  GameMaster srv  │  authoritative state
                 │  + content files │  + JSON persistence
                 └──────────────────┘
                   runs on the laptop
```

## Quick start

```bash
npm install
npm start
```

The terminal prints three URLs and a QR code:

- **`/display`** on `localhost` — open it on the laptop, drag it to the TV on
  an **extended** (not mirrored) desktop, fullscreen it.
- **`/host`** on the LAN address — open it on the iPad. Scan the QR code.
- **`/host`** on `localhost` — the same control surface in a laptop window.
  Leave it open. It is the wifi-down fallback and it costs nothing.

Then work down [`docs/RUNDAY.md`](docs/RUNDAY.md), which is not optional.

| Command | |
|---|---|
| `npm start` | Build the client and serve everything on port 4000 |
| `npm run dev` | Server plus Vite dev server with hot reload |
| `npm run check` | Everything below, in one go — run this before pushing |
| `npm test` | Unit tests: reducer, projections, content validation |
| `npm run smoke` | Boot the real server and play a round through real sockets |
| `npm run typecheck` | Type-check the client and the server separately |
| `npm run build` | Build the client bundle into `dist/client` |
| `npm run replay` | Turn a finished session log into a readable transcript — see [`docs/AFTER-THE-PARTY.md`](docs/AFTER-THE-PARTY.md) |

Environment: `GM_PORT` (4000), `GM_CONTENT` (a specific content file),
`GM_CONTENT_DIR` (`./content`), `GM_DATA_DIR` (`./data`), `GM_PASSPHRASE`
(unset = no gate on `/host`). `npm start -- --fresh` ignores a resumable
session.

## What it does today

Phase 0 is complete, and Phase 0 alone runs the party:

- **Host onboarding.** The host creates entrants on the tablet and picks a face
  from `content/avatars/`. No join flow, no lobby, no device.
- **`manual` round type.** A prompt, optional media, and a grid of faces. Tap
  to award, long-press to deduct.
- **`multipleChoice` round type**, host-adjudicated.
- **Event-sourced state** with undo, redo, per-event persistence and crash
  recovery.
- **Manual score override** on every entrant, always.
- **YAML content** with hot reload and line-referenced validation errors.
- **Display view** with prompt, media, answers-on-reveal and a live
  leaderboard.

Deliberately not built: the Jeopardy-style `board` type (Phase 2), player
self-join and device submission (Phase 3), and an extracted plugin SDK
(Phase 3). See [Phasing](#phasing).

## The two invariants

Everything here bends to these. If a change breaks one, the change is wrong.

1. **No-device play is first-class.** The game is fully playable with only the
   host tablet and the TV. Player phones are an enhancement, never a
   dependency.
2. **The host can always fix it by hand.** Every automated scoring path has a
   manual override. If a round type misbehaves mid-party, the host taps a face,
   adds a point, and play continues.

A third follows from them: **the host view must work on the laptop too.** If
the wifi drops, the iPad is gone and the party stops — unless the host can sit
down at the laptop and keep going. Test that path by turning the wifi off
during a rehearsal, not by reading this paragraph.

## Content

Content is files, not a UI. There is no authoring screen and there is not going
to be one. Put a `.yaml` file in `./content/` — see
[`content/anniversary.yaml`](content/anniversary.yaml) for a complete worked
example, [`docs/CONTENT.md`](docs/CONTENT.md) for the full field-by-field guide,
and [`docs/template.yaml`](docs/template.yaml) for a starter to copy.

```yaml
title: '40th Anniversary Games'

entrants: # optional; seeds the roster so `restrictTo` ids resolve
  - id: lucy
    displayName: Lucy
    avatar: /content/avatars/avatar-d.svg

rounds:
  - id: baby-photos
    type: manual
    title: 'Whose Baby Is This?'
    defaultPoints: 1
    items:
      - prompt: 'Whose baby photo?'
        media: { image: assets/baby-01.jpg }
        answer: 'David'

  - id: kids-round
    type: manual
    title: 'Just For Lucy'
    restrictTo: [lucy] # only these entrants can score
    items:
      - prompt: 'How many grandchildren?'
        answer: 'Three — four in November!'
```

The file hot-reloads while the server runs, so you can edit questions during
rehearsal. **A typo never takes the game down**: the host view shows the error
and the last good version keeps playing.

Images and audio go in `content/assets/`, faces in `content/avatars/`. Run
`node scripts/make-placeholders.mjs` to generate stand-ins so you can rehearse
before the real photos arrive, then drop the real files over the same names.

## Round types

> **Read this before you write one.**
>
> `manual` — a prompt, optional media, and a human deciding who won — already
> covers free-for-all shout-outs, charades, the baby-photo round,
> pin-the-tail-on-the-donkey, musical chairs, relay races, sing-along judging,
> and every other party game anyone has suggested so far. Those are **content**,
> not code. Do not build a bespoke `musical-chairs` module.

A round type is a module in `server/roundTypes/` implementing this contract
(see [`server/roundTypes/contract.ts`](server/roundTypes/contract.ts)):

```ts
interface RoundType<Config, State> {
  id: string;
  configSchema: ZodSchema<Config>;
  init(config, ctx): State;
  reduce(state, event, config, ctx): State;
  projectHost(state, config, ctx): HostRoundView;
  projectDisplay(state, config, ctx): DisplayRoundView;
  projectPlayer?(state, config, entrantId, ctx): PlayerRoundView; // Phase 3
  displaySecrets?: string[];
}
```

Register it in `server/roundTypes/index.ts`. Two rules:

- **Never touch a score directly.** Call `ctx.awardPoints(entrantId, n)`. Awards
  are collected during `reduce` and applied by the core reducer, which is why
  every point is undoable and why scoring lives in one place.
- **Never read the clock in `reduce`.** Use `ctx.now`, the timestamp of the
  event being reduced, and `ctx.timer`, which derives from it. A reducer that
  reads `Date.now()` breaks replay, and replay is what makes undo and crash
  recovery work.

Roadmap, not built: `board` (Jeopardy), `buzzer`, `wager`, `ordering`,
`pictionary`, `speedRound`.

## How it works

One Node process serves three views over the local network. The server holds
authoritative state; clients render what they are pushed and send commands
back.

**State is event-sourced.** The server keeps an append-only log and derives
current state by reduction. This is not architecture for its own sake — it buys
three things that matter while a room full of people watches:

- **Undo.** Pop the last event, replay. The host *will* tap the wrong face.
- **Crash recovery.** Every event is written to `data/session-<id>.jsonl` before
  it is acknowledged. On boot the server resumes the most recent session.
- **Debuggability.** After the party you can replay exactly what happened,
  including what was undone.

Three projections are derived and pushed:

| Projection | Consumer | Rule |
|---|---|---|
| `HostState` | `/host` | Sees everything, including answers |
| `DisplayState` | `/display` | **Never contains an unrevealed answer.** Enforced at the projection boundary in `server/game/projection.ts`, not in the view — otherwise the answer is in the DOM and someone will find it |
| `PlayerState` | `/play` | Per-entrant; sees only its own submission state |

Stack: Node 20+, TypeScript, Vite + React, `socket.io`, no database. Boring on
purpose. Everything is served from disk, so it works with the router up and the
internet down.

## Phasing

- **Phase 0 — runs the party. ✅ Done.** Server, event log, persistence, resume,
  entrants with host onboarding, `manual`, host view, display view, YAML with
  hot reload, host view usable on the laptop.
- **Phase 1 — cheap wins.** `multipleChoice` ✅, timers ✅, sound cues over HDMI
  ✅, round title cards ✅.
- **Phase 2 — the fun one.** `board` / Jeopardy. Wagers if there is room.
  Build it only after Phase 0 has been rehearsed end-to-end with real content.
- **Phase 3 — after the party.** Player self-join and device submission, an
  extracted and documented plugin SDK, session export and replay.

### The critical path is not code

Content collection has human latency and it runs through five households. Baby
photos, trivia submissions, the wedding photos for the display — all of it
depends on other people answering a text message. **Send the form and the photo
request today.** If it comes back full on day 6, no amount of Phase 2 saves you.
If it comes back full on day 2, even a bare Phase 0 makes a great game.

## Non-goals

No user accounts, no cloud services, no internet dependency at runtime, no
question-authoring UI, no analytics, no multi-room support, no auth beyond an
optional host passphrase, no mobile-native apps, no AI question generation.
