# State of play

Where the project actually is, what is safe to assume, and what to do next.
Written so that work can stop at any moment and resume cleanly.

Last updated: 2026-08-14.

## Status

**Phase 0 is done, tested and rehearsable.** The engine can run the party today:
open `/display` on the TV, open `/host` on the iPad, and play. Everything since
Phase 0 is additive.

- Branch: `claude/gamemaster-framework-spec-ocsy07`
- PR: [#1](https://github.com/dillwishlist/GameMaster/pull/1) → `main`
- `main` is an **empty root commit**, created only so the work had a base branch
  to be reviewed against. The repository had no commits before this work.

Verify everything in one command:

```bash
npm run check      # typecheck + unit tests + end-to-end smoke test
```

## What exists

| Area | State |
|---|---|
| Event log, persistence, resume, undo/redo | Done |
| `manual` round type | Done |
| `multipleChoice` round type (host-adjudicated) | Done |
| Host view (tiles, transport, undo, score override, setup) | Done |
| Display view (prompt, media, options, leaderboard) | Done |
| YAML content, hot reload, line-referenced errors | Done |
| Host view usable on the laptop (wifi-down fallback) | Done |
| Timers | Server-side done; no host button to start one yet |
| `board` / Jeopardy round type | See "In flight" |
| Player self-join, device submission | Not built — Phase 3, expected to be cut |
| Extracted plugin SDK | Not built — Phase 3 |

## The rules that must not be broken

These are load-bearing. A change that violates one is wrong even if it passes.

1. **No-device play is first-class.** The game must stay fully playable with
   only the host tablet and the TV.
2. **The host can always fix it by hand.** Every scoring path keeps a manual
   override.
3. **The host view must work in a laptop window.** That is the wifi-down
   fallback and it is the difference between a hiccup and a stopped party.
4. **Unrevealed answers never leave the server.** Enforced in
   `sanitizeDisplayView` (`server/game/projection.ts`), not in the view. Round
   types are not trusted to withhold their own answers.
5. **Round types never touch scores** — they call `ctx.awardPoints`, which the
   core reducer applies. One code path, everything undoable.
6. **Reducers never read the clock.** Use `ctx.now` (the event's timestamp).
   Replay determinism is what makes undo and crash recovery work.

## Gotchas already paid for

Things that cost time once. Don't rediscover them.

- **`ack?.(f())` short-circuits the whole expression** when `ack` is undefined,
  so `f()` never runs. This silently disabled the undo button — the host view
  emits without an acknowledgement callback. Do the work on its own line, then
  acknowledge. Unit tests did not catch it; `npm run smoke` did.
- **Positional `grid-template-rows` breaks when a child renders conditionally.**
  The host layout has optional error banners, so the flexible row landed on the
  wrong child. The host is a flex column now; keep it that way.
- **Flex rows stretch avatars into ellipses.** `.avatar` is `width: 100%`, so
  any flex context needs `flex: 0 0 auto` and explicit dimensions.
- **Grid items default to `min-width: auto`**, which let the leaderboard shove
  the whole display past the TV's safe margin. `.display > * { min-width: 0 }`.
- **The server loads the alphabetically-first `.yaml` in `./content`.** A file
  named `TEMPLATE.yaml` there would hijack the default game. Templates live in
  `docs/`.
- **The iPad cannot reach `localhost`.** The server binds `0.0.0.0` and prints
  the LAN URL and a QR code.
- **Session ids are second-granular**, so `Session.create` de-duplicates the
  filename — otherwise two sessions started in the same second share a log and
  the first is truncated.
- Piped Node output is block-buffered: a process killed by a signal loses it.
  Log to a file when debugging a spawned server.

## Where things live

```
shared/          types + event union — the contract between server and client
server/
  index.ts       express + socket.io, static assets, content watch, banner
  session.ts     event log, persistence, undo/redo, resume
  content.ts     YAML load, Zod validation, line-referenced errors, warnings
  game/state.ts  the pure reducer — no clock, no fs, no randomness
  game/projection.ts   host/display/player projections + the secrecy boundary
  roundTypes/    contract.ts, manual.ts, multipleChoice.ts, index.ts (registry)
client/src/
  host/          HostView + tiles, keypad, setup panel, passphrase gate
  display/       DisplayView + countdown
  play/          Phase 3 stub
  styles/        base.css, host.css, display.css
content/         anniversary.yaml + assets/ + avatars/
scripts/         make-placeholders.mjs, smoke.mjs
tests/           game, session, content
docs/            RUNDAY.md (the checklist), this file
```

## In flight

Four parallel tracks were started after Phase 0 landed. Each owns a disjoint
set of files; none of them commit — commits are made centrally after review.

1. **`board` / Jeopardy round type** — server type, host and display grids,
   sample `content/jeopardy.yaml`, tests. Wagers are a stretch goal.
2. **CI** — `.github/workflows/ci.yml` running typecheck, tests, smoke and
   build on Node 20 and 22, plus a PR template.
3. **Session replay/export** — `server/replay.ts` + `scripts/replay.mjs`,
   turning a finished log into a readable transcript and final scores.
4. **Sound cues and the content guide** — synthesized WAV cues, `docs/CONTENT.md`
   for the quizmaster, `docs/template.yaml`.

If this document still says "in flight" and the work is not in the repo, the
run was interrupted: check `git status`, keep what passes `npm run check`, and
discard the rest.

## What to do next, in order

1. **Rehearse Phase 0 end-to-end with real content and a second person.** This
   outranks every remaining feature. If rehearsal finds problems, fix those
   instead of building anything below.
2. Collect the actual content — photos, trivia, the wedding pictures. This runs
   through five households and it is the real critical path. Placeholders exist
   so the game is playable without it; a great game needs it.
3. Finish or land the four tracks above.
4. Host-side timer controls (start/stop a countdown for a charades round). The
   server side and the display countdown already exist.
5. Only then: Phase 3 (self-join, device submission, extracted plugin SDK).

## What not to build

No user accounts, no cloud, no runtime internet dependency, no question
authoring UI, no analytics, no multi-room, no native apps, no AI question
generation.

And: **no bespoke round type for a party game.** Charades, musical chairs,
pin-the-tail and the rest are `manual` plus a good prompt. See the header of
`server/roundTypes/manual.ts`.
