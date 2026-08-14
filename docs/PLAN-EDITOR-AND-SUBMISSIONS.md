# Plan: question editor, submissions, and the rest of the gaps

A design plan, not built code. Covers a GUI question editor, a way to collect
questions from the family (anonymously or attributed), and every other gap worth
naming while we're here.

## Before anything else: two things to decide

**1. This reverses a stated non-goal.** README §Non-goals says "no
question-authoring UI", and that exclusion is why Phase 0 fit in two days. It is
a reasonable thing to change your mind about — the constraint bought its value
already — but the README and the spec should be updated in the same commit that
starts this work, or the next person will read them as contradictory.

**2. None of this should ship close to the party.** The editor's whole job is
writing to the content file, which is the one file the live game reads. The
spec's own instruction for the last two days is *no new code*, and it is right.
If the brunch is weeks away, build it. If it is days away, this plan is
post-party work and the current YAML-plus-`docs/CONTENT.md` path is what runs
the event.

---

# Part 1 — The question editor

## The principle that keeps this safe

**The YAML file stays the source of truth. The editor is a view over it, not a
database in front of it.**

Everything already depends on the file being real: hot reload, the git history,
`docs/CONTENT.md`, the ability to fix a typo from a terminal at 9:15 on a
Sunday, and the printed-question-list fallback. An editor that owns the content
in a database and *exports* YAML would quietly break all of that. So: the editor
reads the file, writes the file, and the file is what the server plays.

This also means the editor can be wrong, or broken, or half-finished, and the
party still runs.

## Where it lives

A fourth route, `/edit` — desktop-first, keyboard-first, behind the same
`GM_PASSPHRASE` gate as `/host`.

It is explicitly **not** part of the run-day path and should say so on screen.
Typing is fine here; that rule ("nothing may require typing during play") is
about `/host`, not about the afternoon you spend writing questions.

## What it does

- **Round list** — reorder by drag, add, duplicate, delete, and set
  `title`, `defaultPoints`, `restrictTo`, `timerSeconds`.
- **Item list** per round, with a per-round-type form:
  - `manual` — prompt, answer, note, points, media
  - `multipleChoice` — prompt, options (add/remove/reorder), correct letter as a
    radio next to each option rather than a letter typed by hand, answer, note
  - `board` — the grid, editable as a grid: categories as columns, clues as
    cells, value/prompt/answer/wager per cell
- **Live validation** against the *same* Zod `configSchema` the server uses.
  One schema, two consumers. Never a second copy of the rules.
- **Asset drop** — drag a photo onto an item, it uploads and sets `media.image`.
- **Preview on the TV** — see below; this is the feature that makes the editor
  worth building at all.

## Writing YAML without destroying it

The sample content is heavily commented, and those comments are documentation
(`restrictTo` explains *why* it exists, the sound cues explain when they fire).
A naive `YAML.stringify(model)` deletes all of it.

`server/content.ts` already parses with `YAML.parseDocument` and a `LineCounter`
for line-referenced errors. Extend that: keep the `Document` AST, mutate nodes
in place, and `doc.toString()` on save. Untouched nodes keep their comments,
their quoting style and their key order. Only genuinely new nodes get generated
formatting.

Round-trip test to write on day one, before any UI: parse the real
`content/anniversary.yaml`, change nothing, serialise, and assert the output is
byte-identical to the input. If that test cannot pass, the approach is wrong and
better to know immediately.

## Not clobbering a hand edit

The file can change under the editor — someone editing in vim, a git pull, or
the second browser window the host left open.

- `GET /api/content` returns the parsed model **and** a hash of the file bytes.
- `PUT /api/content` sends the hash back. Mismatch → `409`, and the editor says
  "the file changed on disk" with a choice to reload or overwrite. Never a
  silent last-write-wins.
- Save writes to a temp file and renames, the same way `Session.rewrite` does,
  so a crash mid-save cannot leave a half-written content file.
- Every save is a hot reload, so the editor must surface what the server says
  about it — including the refusal.

**The refusal matters.** `Session.reloadContent` already rejects a structural
change to a round that is in play (see `docs/STATE-OF-PLAY.md`). The editor
should not let the host discover this by having a save bounce: if a round is
currently live, grey out add/remove/reorder *for that round*, with the reason
inline. Rewording stays available, because rewording is always safe.

## Assets

This is the first write path in the server — today nothing outside
`server/session.ts` writes to disk, and there are no `POST` routes at all. Treat
it as a boundary:

- `POST /api/assets` — multipart, host-only.
- Accept images and audio only, sniffed by content, not by file extension.
- Generate the stored filename yourself from a slug plus a short hash. Never
  join a client-supplied name onto a path.
- Cap the size (10 MB is generous for a TV image).
- Offer to downscale on upload. A 12 MP phone photo is 4 MB of nothing over
  wifi; 2000px wide is more than a 1080p set can show.
- Never delete an asset because an item stopped referencing it. Orphans are
  cheap; a deleted wedding photo is not.

## Preview on the TV

The single most useful thing the editor can do, and the reason it beats a text
editor: a **Preview on the TV** button that renders the item on the display
without touching the session.

Rehearsal today means playing the round for real, which writes events and moves
scores. Preview must not:

- It is a separate socket message and a separate display state, not a
  `ROUND_EVENT`. Nothing enters the event log.
- The display must show it is a preview — a border and a word — so a preview
  left up during the party cannot be mistaken for live play.
- Leaving preview restores whatever the display was showing.

This is also how you check the thing the checklist keeps insisting on: that the
picture reads from the sofa.

## Deliberately not doing

No rich text. No image editing beyond a resize. No live collaborative editing
(one host, one file — the 409 is the whole concurrency story). No content
database. No authoring of *entrants* here; that lives on `/host` where the
onboarding already is.

## Rough size

| Piece | |
|---|---|
| AST-preserving read/write + round-trip test | 1 day |
| Round and item CRUD, per-type forms, validation | 2 days |
| Asset upload + resize | half a day |
| Preview channel | half a day |
| Board grid editor | 1 day |

Call it **a week**, and the board editor is the part to cut if you need to.

---

# Part 2 — Submissions

## The problem this actually solves

The project's stated critical path is not code: it is content collection across
five households, gated on people answering a text message. A submission flow is
the only feature here that attacks that directly — everything else in this
document is polish by comparison.

## Two intake paths, because the LAN is not enough

The engine is LAN-only and offline by design. Relatives at home are on neither.
So:

**1. Import (pre-party, the important one).** The spec already says to send a
Google Form on day one. Keep doing that, and add
`node scripts/import-submissions.mjs form-export.csv`, which maps columns to
submissions and drops them into the pile. No cloud service, no runtime internet,
no new dependency — a CSV that someone downloads and drops in a folder. This
respects every non-goal and solves the real problem.

**2. Devices on the day (nice, cuttable).** `/submit` on the LAN, reusing the
Phase 3 `/play` seam. Guests add a question or a photo while the coffee is
going. Genuinely fun, and it is the thing the phones are actually good for —
unlike buzzing in, which they do not need to do.

## Attribution: four modes, not two

You asked for anonymous and entrant-labelled. In practice there are four, and
the distinctions carry real weight:

| Mode | Who can see the author | What it is for |
|---|---|---|
| `blind` | **Nobody. The author is never stored.** | Confessions, opinions, "the most embarrassing thing about Dad". |
| `host` | The host only, never the display | Lets the engine keep the submitter from scoring on their own question. |
| `reveal` | Hidden until the host reveals, then on the TV | **"Who said it?"** — the whole round type, for free. |
| `public` | Everyone, always | "Lucy's question for Grandad". |

Three notes on this:

- **`blind` has to mean it.** Not "hidden in the UI" — not stored. If the author
  is in the file, a host will eventually read it aloud by accident, and a
  reviewer already proved that anything present in a display payload can be
  found. The editor should say, once, plainly: *anonymous cannot be undone, and
  you will not be able to stop the submitter scoring on their own question.*
  That is the honest trade and the host should make it knowingly.
- **`reveal` maps exactly onto machinery that already exists.** The author goes
  in the item's `answer` field; `sanitizeDisplayView` already strips `answer`
  until the host reveals. A "Who Said It?" round becomes a `manual` round that
  the importer writes for you, and no new round type is needed — which is the
  rule the whole project is built on.
- These are per-submission, not per-round. A single round can mix them.

## Moderation, because of the cake

Nothing a guest submits reaches the TV without the host approving it. The
reasoning is already written down for self-join — *otherwise you get three
entrants named "poop" before the cake arrives* — and it applies with more force
to free text that will be projected at a grandparent.

Submissions land in a **review queue** in the editor: approve, edit, reject,
assign to a round.

## Where submissions live

`content/submissions.yaml` — content, not session state.

They are authored material, like questions. They do **not** belong in the event
log: the log is what happened during play, it is replayed on every undo, and
mixing authored content into it would mean an undo could delete someone's
submission. Files stay files.

```yaml
submissions:
  - id: sub-0007
    kind: question          # question | photo | quote | answer
    text: 'What did Dad reverse into on the 1998 holiday?'
    answer: 'A gatepost'
    media: { image: assets/sub-0007.jpg }
    attribution: reveal     # blind | host | reveal | public
    entrantId: the-swans    # absent entirely when attribution is `blind`
    receivedAt: 2026-08-02T10:14:00Z
    source: form            # form | device
    status: pending         # pending | approved | rejected | used
```

## Turning submissions into rounds

In the editor: filter to approved, select several, "make a round". It writes a
normal round into the content file — after which the submissions are just
questions and nothing about play is special. The round is editable, hand-
editable, and printable like any other.

For `reveal` submissions the generated round writes the author into `answer`,
which is the "Who Said It?" round building itself.

## The one engine change: per-item exclusion

`host`, `reveal` and `public` submissions all want the same thing — **the person
who wrote the question should not be able to win points on it.**

Today `restrictTo` is per *round* (`server/roundTypes/contract.ts` exposes
`ctx.restrictTo`). This needs to be per *item*, and it needs to express "everyone
except" as well as "only these".

Suggested shape, additive and backward-compatible:

```yaml
items:
  - prompt: 'Whose baby photo?'
    answer: 'David'
    exclude: [the-swans]     # they submitted it
```

Implementation notes:

- `RoundContext` gains the effective per-item scope, so round types keep calling
  `canScore(...)` and get the right answer without knowing why.
- `manual` and `board` both need it; `board`'s "item" is the open square.
- The host view already greys out-of-scope tiles — it just needs the scope to
  change per item rather than per round.
- This touches the plugin contract, so it is a versioned change and
  `docs/CONTENT.md` and the README round-type section both need updating.

Note the honest limitation: **`blind` submissions cannot exclude their author**,
because nothing knows who they are. That is the cost of real anonymity, not a
bug to fix later.

## Rough size

| Piece | |
|---|---|
| Submission model, storage, importer script | 1 day |
| Review queue + "make a round" in the editor | 1 day |
| Per-item exclusion (contract, two round types, host view, docs) | 1 day |
| `/submit` device flow with moderation | 1–2 days |

---

# Part 3 — Everything else that is missing

Ranked by what it costs the room, not by effort. The top group are the ones a
guest would actually notice.

| # | Gap | Why it matters | Size |
|---|---|---|---|
| 1 | **The final scores screen is weak.** The climax of the party renders the winner as a small strip at the bottom while the centre says "Scores on the board". | This is the last thing anyone sees. It should be a reveal — a podium, the winner's face, and a beat before it lands. | half a day |
| 2 | **A paused countdown drifts between host and TV.** `TimerView` sends `endsAt`; a display that reconnects during a pause computes a different number. | Two clocks disagreeing in front of the room. Needs `remainingMs` in the payload. | 2 hours |
| 3 | **A broken image is a silent gap.** Both screens render nothing, and the TV *also* shrinks the prompt because `media.image` is truthy. | The host finds out at the same moment the room does. Needs a visible placeholder and a host-side warning. | 2 hours |
| 4 | **No tie-break.** The replay tool reports draws correctly; the game has no way to settle one. | A tie at a family party is a real outcome and someone will want it broken. A sudden-death `manual` item is content, but the leaderboard should at least *show* a draw as a draw. | half a day |
| 5 | **No favicon or `apple-touch-icon`.** | The checklist tells the host to bookmark `/host` on the iPad home screen. That bookmark currently has no icon. | 1 hour |
| 6 | **Entrant colours are not colour-blind safe.** The palette is picked for variety, and colour is load-bearing on the leaderboard. | ~8% of men cannot reliably separate the red and green tiles. Faces carry most of the identity, so this is a polish item, but it is a real one. | 2 hours |
| 7 | **Escape closes nothing**; the keypad's backspace discards the score rather than editing it; deduct mode survives a round change. | Small host-side papercuts, all found by review. | 2 hours |
| 8 | **No practice mode.** Rehearsal writes real events to a real session. | `--fresh` and "start fresh session" cover it, but a mode that plays without persisting would make rehearsal free. | half a day |
| 9 | **Player self-join** (Phase 3, expected to be cut). | Only worth it if `/submit` gets built — at which point phones are already in the room and the marginal cost is small. | 1–2 days |
| 10 | **`buzzer` round type** (needs devices). | The one genuinely new round type worth having, and the only party mechanic that `manual` plus content cannot fake — first-in lockout needs a clock nobody can argue with. | 1–2 days |
| 11 | **Extract the plugin SDK** (Phase 3). | Only pays off with a third-party round type to prove it. The registry is the seam; it does not need to move yet. | 1 day |
| 12 | Minor known-open reducer items (awards from `init` dropped, `lastDelta` retained after removal, dead listener loop in `reset()`). | None reachable today; listed so they are not rediscovered. | 1 hour |

---

# Suggested order

1. **Nothing, if the party is close.** Rehearse instead.
2. Final-scores screen, timer drift, broken-image placeholder, favicon (#1–3, #5).
   Half a day together, and they are the ones a guest notices.
3. The importer and the submission model (Part 2, path 1) — because it feeds the
   real critical path and needs no UI at all to be useful.
4. The editor (Part 1), with the round-trip test first.
5. Per-item exclusion, then the review queue.
6. `/submit`, self-join and `buzzer` as one device-shaped push, or not at all.

# Risks worth naming now

- **Comment-preserving YAML round-tripping is the technical risk.** Prove it on
  day one with the byte-identical test. If it fails, fall back to the editor
  owning only the structured fields and refusing files it cannot round-trip —
  better than silently eating the documentation.
- **The editor becoming the source of truth by accident.** Every feature that
  cannot be expressed in the file is a step toward this. If something cannot be
  written to YAML, it does not belong in the editor.
- **Anonymity leaking through the host view.** `blind` must not store the
  author; a "hidden in the UI" implementation will eventually be read aloud.
- **The first write path.** Asset upload is the first time this server writes
  something a client sent. Filename generation, content sniffing and a size cap
  are not optional, even on a LAN.
- **Scope creep into a CMS.** The test for every proposed editor feature: does
  it help the quizmaster get the questions in before Sunday? If not, it is a
  different product.

# Open questions

1. **How far away is the party?** It changes the order of everything above.
2. **Is the Google Form already out?** If yes, the importer should be built
   against its real column names rather than a guessed schema.
3. **Do you want `/submit` at all**, or is the form plus the editor enough? It
   is the difference between a week and two.
