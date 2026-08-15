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
| Timers, host-controlled | Done |
| `board` / Jeopardy round type, with wagers | Done |
| Sound cues (synthesized, no downloads) | Done |
| Session replay / export (`npm run replay`) | Done |
| CI on Node 20 and 22 | Done |
| Question editor at `/edit` | Done — on branch `claude/question-editor`, see [`EDITOR.md`](EDITOR.md) |
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
| 6 | Same-second session ids sorted such that resume picked the *older* log. | **Fixed.** Ordered by the timestamp and counter in the id itself — an mtime sort ties and was caught failing in CI. |
| 7 | The header comment promised an fsync that `appendFileSync` doesn't do, and `rewrite` could lose the whole log. | **Fixed.** Real fsync on append, temp-file-and-rename for rewrite. |
| 5 | `manual` offered a Reveal button for an image-only item, but `sanitizeDisplayView` cannot hide `media` — the room sees it the whole time. | **Fixed** (reveal no longer advertised for media alone). The sanitizer's contract is now documented: it sees the top-level `answer` and **top-level** `extra` keys only — `delete` is shallow, so secrets nested inside an `extra` sub-object *will* ship to the TV. |
| 8 | Minors: awards emitted from `init` are dropped; `ENTRANT_REMOVE` leaves a `lastDelta` entry; `reset()` has a dead listener-copy loop. | **Open, deliberately.** None reachable by current round types; all noted here rather than fixed under time pressure. |

Verified clean by the same review: replay determinism, reducer purity (no
mutation, including nested `roundStates`), undo/redo semantics including across
round switches, crash recovery from torn and shortened logs, authorization on
every mutating socket command, and memory growth over a session.

### The second review — the board type, the replay tool

A separate pass covered the newer code the first review excluded. It fuzzed
hard and could not break the properties that matter: 60,000 random board states
never leaked a prompt, response or note to the TV before reveal (the daily
double is genuinely unspottable from the sofa); 200,000 malformed events never
made `reduce` throw or mutate a frozen state; 400 random logs replayed
identically and matched an incremental fold.

What it did find:

| Finding | Status |
|---|---|
| **A structural YAML edit mid-board repointed the open square** and pushed an already-played answer, revealed, onto the TV. Squares are addressed by position, and the workflow that triggers it is the one RUNDAY recommends. | **Fixed** — a reload that changes the number of questions in a round already in play is refused. Rewording still works live. |
| A wager survived CANCEL and CLOSE and silently re-applied, so a 500 square could come round again worth 1500. | Fixed |
| A timer started with the grid up could never be stopped. | Fixed |
| `Number()` coercion meant `OPEN {category: null}` opened the top-left square rather than being ignored. | Fixed |
| `npm run replay` rendered a board round as one meaningless line and blamed the host's content file for it. | Fixed |
| `npm run replay` died with a raw stack trace on a log the live server opens fine. | Fixed |

It also judged the board tests a good happy-path suite that missed the things
that would cost the party — no mutation guard, no malformed-event coverage, a
determinism test that compared two full replays (trivially equal for any
implementation, mutating or not), and no board round anywhere in the replay
tests. Those gaps are now filled.

One structural note from it worth keeping: the core hands a plugin its own
`roundStates[id]` without a defensive copy, so a round type *could* mutate
shared state. None do. If a future one does, `replay` would mask it and only
the incremental path would diverge — which is the nastiest possible bug shape
here. Worth a line in the plugin contract if a third-party type ever lands.

### The third review — the client, driven in a real browser

The one flagged as unread has now landed and been acted on. It drove both views
in Chromium and found fifteen confirmed issues. Fixed:

| Finding | What the room would have seen |
|---|---|
| **A wifi drop showed a green light for 46 seconds** while every tap was silently lost — packets stop with no TCP reset, which is exactly the iPad case, and socket.io doesn't notice until its ping cycle expires. | Now red in ~2s, and taps made during the outage are **queued and land on recovery** instead of vanishing. Verified with network emulation. |
| Taps made while disconnected were flushed by socket.io *before* `hello`, so the server rejected them as "not the host" — invisibly, because nothing asked for an acknowledgement. | Held in our own queue, flushed inside the hello ack. |
| **Keyboard awards were hard-coded to ±1**, so on a 2-point round the keyboard gave 1, on a 500-point Jeopardy square it gave 1, and with Deduct switched on it *added*. This is the wifi-down fallback path. | Uses the round's real points and honours the deduct switch. |
| `shift` to deduct was dead code — with shift held, Digit1 arrives as `!`, so the regex never matched. | Matched on `e.code`. |
| **Arrow keys were eaten by the round picker**: pick a round, press the arrow you use for "next question", and the round changed instead — twice meant two rounds skipped. On a board an arrow threw the open clue away. | Focus is released on change; arrows are gated on what the transport allows. |
| Typing a player's name played the game — keys fired straight through the open sheet, awarding points and flashing the answer on the TV. | Shortcuts suspended while a sheet is open. |
| **A long prompt was unreadable on both screens.** The centred-flex overflow trap put the first line 119px above an unscrollable panel — the host could not read the question they were about to ask. | `justify-content: safe center`. Verified at the 1280×800 fallback size. |
| **The TV silently dropped players off the leaderboard** — with a big roster the strip clipped, and because it is sorted by score, the people who vanished were the ones at the bottom. | Rows scale down instead. Verified with 15 entrants: none clipped. |
| A swipe that merely began on a face scored a point on touch (implicit pointer capture means `pointerleave` never fires). | Cancelled past 40px of travel; a real tap and a long-press still work. |
| The score keypad sprang back open by itself after an Undo; a fixed avatar never recovered; the passphrase gate accused the host of a wrong passphrase before they had typed one; board squares were 80px against a stated 88pt minimum. | All fixed. |

Confirmed solid by the same review: rapid tapping (5 taps = 5 points, mouse and
touch), server kill and return (frozen screen, not blank, then a clean resync),
display reconnect, no tile reordering under a finger, the fix-it-by-hand
invariant in the worst case it could construct, and layout at five viewport
sizes.

**Still open, from that review:** a paused countdown drifts between host and TV
(the fix is a server payload change — `TimerView` needs a `remainingMs`); a
broken round image leaves a silent gap on both screens; the keypad's backspace
discards the score rather than editing it; deduct mode survives a round change;
Escape closes nothing; and there is no favicon, so the iPad home-screen
bookmark the checklist asks for has no icon.

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
3. **Small, known, unfixed:** on a board round the host's "Start timer" button
   is visible while the grid is up, where it now does nothing. The server-side
   fix was the right one (a timer with no square open could never be stopped);
   hiding the button until a square is open is a one-line client follow-up.
4. The open minors from the first review (table above), if anyone is bored.
5. Only then: Phase 3 (self-join, device submission, extracted plugin SDK).

All three reviews have now reported and been acted on. The remaining known
issues are listed at the end of the client review section above — none of them
stops a party, and the two worth doing first are the paused-timer drift (needs
a server payload change) and a favicon.

## The editor

Built, on its own branch so it can be reverted without touching the engine. See
[`EDITOR.md`](EDITOR.md) for what it does and [`PLAN-EDITOR-AND-SUBMISSIONS.md`](PLAN-EDITOR-AND-SUBMISSIONS.md)
for why it is shaped this way.

The load-bearing decision: **the YAML file is still the source of truth**, and
the editor is a view over it. Hand-editing, `git diff`, hot reload and the
printed fallback all still work, and the editor can be broken while the party
runs. Every property the "no question-authoring UI" non-goal was protecting is
preserved, which is why removing that non-goal was safe.

Things learned building it, worth not rediscovering:

- **Byte-identical round-tripping needed the content normalised first.** The
  files mixed flow styles (`{ image: x }` padded, `[lucy]` not) and one
  serialiser has one opinion. They are stored in the editor's exact output
  style now, so saves produce no spurious diff.
- **`parseContent` quarantines a broken round rather than throwing.** Correct at
  load time — one bad round must not take the game down — and wrong as an
  editor gate, where it would let a save silently delete a round from the game.
  The gate compares broken rounds before and after.
- Board edits use their own node-level ops. Addressing a clue by column and row
  keeps the comment guarantee, which a whole-block rewrite would have broken.

## Planned, not built

The submission flow from the plan — anonymous, host-visible, revealed or
labelled attribution, with a CSV importer for the Google Form — is designed and
not started. Its one engine dependency is per-item scoring exclusion, since
`restrictTo` is per-round today.

## What not to build

No user accounts, no cloud, no runtime internet dependency, no question
authoring UI, no analytics, no multi-room, no native apps, no AI question
generation.

And: **no bespoke round type for a party game.** Charades, musical chairs,
pin-the-tail and the rest are `manual` plus a good prompt. See the header of
`server/roundTypes/manual.ts`.
