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
| `board` / Jeopardy round type, with wagers | Done |
| Sound cues (synthesized, no downloads) | Done |
| Session replay / export (`npm run replay`) | Done |
| CI on Node 20 and 22 | Done |
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

## The adversarial review, and what came of it

The Phase 0 core was reviewed specifically for "what fails mid-party, with no
do-over". Findings and their resolution, so nobody re-litigates them:

| # | Finding | Status |
|---|---|---|
| 1 | **A single malformed event permanently bricked the log.** `append` persisted before reducing, so an event the reducer rejected was written anyway — after which every undo threw and the server would not restart. Confirmed with a repro. | **Fixed.** Reduce first, write second. Plus a tolerant rebuild so a log that already contains one still opens. |
| 2 | **A throw in a socket handler killed the process.** Only `dispatch` was guarded; socket.io does not contain listener exceptions. | **Fixed.** All handlers wrapped, `pushAll` moved inside the content-reload try, and process-level guards added. |
| 3 | **A one-character YAML typo silently zeroed the TV scoreboard.** Points are recomputed from the log, so a round that stops resolving takes its points with it — and a round-scoped validation failure doesn't even set `contentError`. | **Fixed.** A reload that would orphan an already-played round is refused, with the reason on the host view. |
| 4 | **Unknown socket roles failed open to `host`**, handing unrevealed answers to any client that sent a typo. | **Fixed.** Fails closed to `display`; re-`hello` now leaves the previous room. |
| 6 | Same-second session ids sorted such that resume picked the *older* log. | **Fixed.** Sorted by mtime. |
| 7 | The header comment promised an fsync that `appendFileSync` doesn't do, and `rewrite` could lose the whole log. | **Fixed.** Real fsync on append, temp-file-and-rename for rewrite. |
| 5 | `manual` offered a Reveal button for an image-only item, but `sanitizeDisplayView` cannot hide `media` — the room sees it the whole time. | **Fixed** (reveal no longer advertised for media alone). The sanitizer's contract is now documented: it sees the top-level `answer` and **top-level** `extra` keys only — `delete` is shallow, so secrets nested inside an `extra` sub-object *will* ship to the TV. |
| 8 | Minors: awards emitted from `init` are dropped; `ENTRANT_REMOVE` leaves a `lastDelta` entry; `reset()` has a dead listener-copy loop. | **Open, deliberately.** None reachable by current round types; all noted here rather than fixed under time pressure. |

Verified clean by the same review: replay determinism, reducer purity (no
mutation, including nested `roundStates`), undo/redo semantics including across
round switches, crash recovery from torn and shortened logs, authorization on
every mutating socket command, and memory growth over a session.

One structural note from it worth keeping: the core hands a plugin its own
`roundStates[id]` without a defensive copy, so a round type *could* mutate
shared state. None do. If a future one does, `replay` would mask it and only
the incremental path would diverge — which is the nastiest possible bug shape
here. Worth a line in the plugin contract if a third-party type ever lands.

## Gotchas already paid for

Things that cost time once. Don't rediscover them.

- **`ack?.(f())` short-circuits the whole expression** when `ack` is undefined,
  so `f()` never runs. This silently disabled the undo button — the host view
  emits without an acknowledgement callback. Do the work on its own line, then
  acknowledge. Unit tests did not catch it; `npm run smoke` did.
- **The server serves `dist/client`, not source.** After changing anything under
  `client/`, run `npm run build` or you will be testing the previous bundle and
  concluding, wrongly, that your feature doesn't render. `npm run dev` avoids
  this; `npm start` rebuilds.
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

## What to do next, in order

1. **Rehearse Phase 0 end-to-end with real content and a second person.** This
   outranks every remaining feature. If rehearsal finds problems, fix those
   instead of building anything below.
2. Collect the actual content — photos, trivia, the wedding pictures. This runs
   through five households and it is the real critical path. Placeholders exist
   so the game is playable without it; a great game needs it.
3. **Host-side timer controls** — a start/stop button for a countdown on a
   charades round. The server side, the event, and the display countdown all
   exist already; only the host button is missing. Smallest useful next task.
4. The three open minors from the review (table above), if anyone is bored.
5. Only then: Phase 3 (self-join, device submission, extracted plugin SDK).

## What not to build

No user accounts, no cloud, no runtime internet dependency, no question
authoring UI, no analytics, no multi-room, no native apps, no AI question
generation.

And: **no bespoke round type for a party game.** Charades, musical chairs,
pin-the-tail and the rest are `manual` plus a good prompt. See the header of
`server/roundTypes/manual.ts`.
