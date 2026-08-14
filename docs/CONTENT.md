# Writing the content

The questions are the game. The software is finished; the content is not, and
it is the only thing on the critical path — it runs through however many
households have to answer a text message. Start collecting today.

This is the whole reference. You do not need to know TypeScript to use it.

- Copy [`docs/template.yaml`](template.yaml) to `content/my-game.yaml` and edit it.
- [`content/anniversary.yaml`](../content/anniversary.yaml) is a complete worked game.
- Run `npm start` and edit the file while it is running. It reloads as you save.

## Where things live

```
content/
  my-game.yaml         your game. Any name; .yaml or .yml
  assets/              pictures and sounds you refer to from the game file
    baby-01.jpg
    cue-fanfare.wav
  avatars/             the faces the host picks from on the Players screen
    avatar-a.svg
```

Two path rules, and they are annoyingly different — copy them from the template
rather than reasoning about them:

| Where | Write it like this | |
|---|---|---|
| A round's `media:` | `assets/baby-01.jpg` | relative to `content/`, **no** leading slash |
| An entrant's `avatar:` | `/content/avatars/avatar-a.svg` | a path from the site root, **with** the leading slash |

If you have more than one `.yaml` in `content/`, the server plays the
alphabetically first one. To play a specific file: `GM_CONTENT=content/my-game.yaml npm start`.
No real photos yet? `node scripts/make-placeholders.mjs` draws stand-ins, and
`node scripts/make-sounds.mjs` generates the sound cues. Drop the real files
over the same names later.

## The shape of a game file

```yaml
title: 'Lucy’s 5th Birthday' # required — shown on the TV before the first round
entrants: [...] # optional — seeds the player list
rounds: [...] # required — at least one
```

### `entrants` (optional)

Seeds the Players screen on a fresh session, so you are not typing names into an
iPad while people are arriving, and so `restrictTo` ids resolve. The host can
add, rename, re-face and remove everyone on the day; nothing here is locked.

```yaml
entrants:
  - id: the-swans # required. lowercase, no spaces. `restrictTo` uses this
    displayName: 'Team Swan' # required. what the room sees
    avatar: /content/avatars/avatar-b.svg # optional. leave it out for a coloured initial
    color: '#2f7de6' # optional. their leaderboard colour
    members: # optional. who is on the team, for your reference
      - { name: 'Ada' } # each member: name required, avatar optional
      - { name: 'Ben' }
```

### `rounds` (required)

Rounds play in the order you list them, and the host can jump to any round from
a dropdown at any time. Every round has these, whatever its type:

| Field | | |
|---|---|---|
| `id` | **required** | Unique, lowercase, no spaces. See the warning under [Hot reload](#hot-reload-and-typos) before renaming one mid-party |
| `type` | **required** | `manual` or `multipleChoice` |
| `title` | **required** | The round title, shown on the TV |
| `restrictTo` | optional | List of entrant ids allowed to score. See [`restrictTo`](#restrictto) |
| `defaultPoints` | optional, default `1` | Points per tap in this round |

Everything else depends on the type, and **there are no other keys**. A stray or
misspelled one is rejected — `Unrecognized key(s) in object: 'itms'` — rather
than silently ignored, so you find out at rehearsal instead of on the TV.

## `manual`

A prompt on the TV, an optional picture or sound, and you deciding who won. Tap
a face to award, long-press to deduct. This is the type you will use for almost
everything — see [Party games are `manual` rounds](#party-games-are-manual-rounds).

| Field | | |
|---|---|---|
| `items` | **required** | The list of prompts. At least one |
| `defaultPoints` | optional, default `1` | Points per tap |
| `timerSeconds` | optional | Puts a countdown of this many seconds on the round, which **you** start and stop by hand. Nothing expires on its own — the clock is theatre, you still decide |

Each entry in `items`:

| Field | | |
|---|---|---|
| `prompt` | **required** | Shown large on the TV. The question, or the instruction for the game |
| `answer` | optional | Shown on the TV **only when you tap Reveal**. Until then it is not sent to the display at all, so it cannot be found by peeking at the screen |
| `media.image` | optional | A picture, shown immediately — it is not hidden until reveal. See [Pictures](#pictures) |
| `media.audio` | optional | A sound cue, played on arrival at this item. See [Sound cues](#sound-cues) |
| `points` | optional | Overrides `defaultPoints` for this one item |
| `note` | optional | A host-only aside on your tablet. Nobody else sees it |

```yaml
- id: baby-photos
  type: manual
  title: 'Whose Baby Is This?'
  defaultPoints: 1
  items:
    - prompt: 'Whose baby photo?'
      media: { image: assets/baby-01.jpg }
      answer: 'David'
      note: 'Wait for the laugh before revealing.'
    - prompt: 'And this one?'
      media: { image: assets/baby-02.jpg }
      answer: 'Grandad — yes, really'
      points: 3
```

The Reveal button needs something to reveal: an item with no `answer` and no
`media.image` has nothing to show, so Reveal does nothing on it. That is fine
and normal for a charades prompt.

## `multipleChoice`

Options on the TV, host-adjudicated: you tap the face of whoever called it out
correctly. Same fields as `manual` at round level (`items`, `defaultPoints`,
`timerSeconds`), plus two on each item.

| Field | | |
|---|---|---|
| `prompt` | **required** | The question |
| `options` | **required** | 2 to 8 answers, in a list. Labelled A, B, C … on the TV in the order you write them |
| `correct` | **required** | The **letter** of the right option — `A`, `B`, `C` … Not the text of it. A letter with no matching option is rejected with `must be one of A, B` |
| `answer` | optional | An extra line read out on reveal — the story behind the answer |
| `media.image` / `media.audio` | optional | As above |
| `points` | optional | Overrides `defaultPoints` for this item |
| `note` | optional | Host-only aside |

```yaml
- id: how-well
  type: multipleChoice
  title: 'How Well Do You Know Them?'
  defaultPoints: 2
  items:
    - prompt: 'Where did David and Jennifer meet?'
      options: ['A bus stop', 'A wedding', 'A chemistry lab', 'A queue for chips']
      correct: C
      answer: 'Second-year practical, 1983'
```

The correct option is withheld from the TV until you reveal, then highlighted.

## `board`

Jeopardy. A grid of categories across the top and clue values down each one. A
contestant picks a square, you tap it, the clue goes up on the TV, and you
adjudicate exactly as in a `manual` round — tap the face of whoever got it.

The difference is the stakes: **a right answer pays the square's value and a
wrong answer costs it** (long-press a face, or flip the Award/Deduct switch).
That is what makes the bottom of a column worth playing for.

| Field | | |
|---|---|---|
| `categories` | **required** | Up to 8. Each has a `name` and a list of `clues` |
| `categories[].name` | **required** | The column heading on the TV |
| `categories[].clues` | **required** | Up to 8 per column. Columns need not be the same length — a short one leaves a gap on the board, not an error |
| `clues[].value` | **required** | What the square is worth. Paid on a right answer, taken on a wrong one |
| `clues[].prompt` | **required** | The clue |
| `clues[].answer` | optional | The response. Host-only until you reveal |
| `clues[].wager` | optional | Marks a daily double. You set the stake by hand before awarding, from one-tap presets. The TV never shows which square it is |
| `clues[].media.image` | optional | As above |
| `clues[].note` | optional | Host-only aside |
| `timerSeconds` | optional | Round level. Adds a countdown you start by hand once a square is open |

```yaml
- id: family-board
  type: board
  title: 'Family Jeopardy'
  categories:
    - name: 'Holidays'
      clues:
        - value: 100
          prompt: 'The caravan site where Dad reversed into the gatepost.'
          answer: 'Sandy Balls — and yes, that is its real name'
        - value: 200
          prompt: 'The only country the whole family has been to together.'
          answer: 'France, 2007'
          wager: true
```

See [`../content/jeopardy.yaml`](../content/jeopardy.yaml) for a full board.

Two things worth knowing before the day:

- Squares are addressed by **position**, so **adding or removing a clue while
  the board is in play is refused** — it would move the round underneath
  itself and could put an already-played answer on the TV. Reword freely;
  restructure between rounds. The host view tells you if you try.
- Tapped the wrong square? **Wrong square** backs out and leaves it in play.
  **Done** consumes it. A consumed square can still be reopened — you are
  never stuck.

## Party games are `manual` rounds

**This is the section people skip and then ask for a new feature.**

`manual` is a prompt on a screen and a human deciding who won. That is what a
party game *is*. Musical chairs, pin-the-tail, a relay across the garden, a
sing-along, a treasure hunt, a dance-off, guess-the-sweets — every one of them
is a `manual` round with a good prompt. Write it as content. Nobody needs to
write code, and there will never be a `musical-chairs` round type.

The prompt is doing two jobs at once: it is the instruction on the TV that gets
everyone moving, and it is your prompt card while you referee. Write it big and
plain. Put the rules you will forget in `note`, where only you see them.

### Musical chairs

```yaml
- id: musical-chairs
  type: manual
  title: 'Musical Chairs'
  defaultPoints: 2
  items:
    - prompt: 'MUSICAL CHAIRS — eight chairs, everyone up!'
      note: 'Phone on the speaker. Stop the music on a chorus. Chairs out one at a time.'
    - prompt: 'Round 2 — six chairs'
      note: 'Two points to whoever is left. Tap their face.'
    - prompt: 'FINAL — two chairs, one winner'
      points: 5
      answer: 'Champion of the sofa.'
```

Three items, so you tap Next between rounds and the TV keeps up with where you
are. Points go up as the field narrows.

### Pin the tail on the donkey

```yaml
- id: pin-the-tail
  type: manual
  title: 'Pin The Tail'
  defaultPoints: 1
  timerSeconds: 30
  items:
    - prompt: 'PIN THE TAIL — three spins, then point at the donkey'
      media: { image: assets/donkey.jpg }
      note: 'Under-6s get one spin. Award a point for closest, not just a hit.'
    - prompt: 'Grown-ups’ turn. Blindfolds on.'
      points: 2
      note: 'They will be worse. That is the entertainment.'
```

The picture on the TV is the crowd's view of what is happening across the room.
The 30-second timer is there to hurry a dithering uncle along; you start it.

### Charades

```yaml
- id: charades
  type: manual
  title: 'Charades'
  defaultPoints: 1
  timerSeconds: 45
  items:
    - prompt: 'Act it out: THE WEDDING PHOTO'
      note: 'Give it to whoever gets the room laughing, not whoever shouts first.'
    - prompt: 'Act it out: DAD’S DRIVING'
    - prompt: 'Act it out: FEEDING THE CAT'
```

Careful with this one: **`prompt` goes on the TV**, so written as above the
whole room can read the word. That is fine for the version everyone actually
plays at a family party — the fun is watching Dad, not guessing. If you want a
real guessing game, invert it: put `Act it out. Come and get your word from me.`
in `prompt` and the word itself in `note`, which only your tablet shows. Either
way there is no `answer` — there is nothing to reveal.

### Relay race, judged outside

```yaml
- id: garden-relay
  type: manual
  title: 'The Garden Relay'
  defaultPoints: 3
  items:
    - prompt: 'EGG AND SPOON — to the apple tree and back'
      note: 'Line them up at the patio door. Toddlers get a head start and nobody minds.'
    - prompt: 'Results'
      answer: '1st: 3 points. 2nd: 2 points. Everyone who finished: 1 point.'
      note: 'Award from here — tap every face that finished.'
```

The last item exists purely so the scoring rule is on the TV while you tap
faces. That is a normal thing to do and it stops arguments.

## `restrictTo`

```yaml
- id: kids-round
  type: manual
  title: 'Just For Lucy'
  restrictTo: [lucy] # only Lucy can score in this round
  items:
    - prompt: 'How many grandchildren?'
      answer: 'Three — four in November!'
```

Everyone else's tile greys out on your tablet and cannot be awarded. This is not
about cheating — it is that a helpful adult *will* shout the answer to the
four-year-old's question, and without `restrictTo` your thumb can hand them the
point before you have thought about it. Use it for any round that belongs to the
children.

The ids must match the `entrants` ids exactly. If they do not, the server prints
a warning at boot and on every reload:

```
[content] Round "kids-round" is restricted to entrant "lucy", which is not in
the content file's entrants list.
```

Read it. A round restricted to an entrant who does not exist is a round where
**nobody can score at all**, and you will discover that with the room watching.

## Hot reload and typos

Save the file and the game picks it up immediately — no restart, no lost points.
Scores survive a reload: the server replays everything that has happened against
the new file. Edit questions during the rehearsal, and during the party if you
have to.

**A typo never takes the game down.** If the file will not parse, the host view
shows the error with the file and line number and the last good version keeps
playing. Fix it, save, and it reloads by itself. Nobody in the room notices.

```
content/my-game.yaml:14 (rounds.2.items.0) — Required
content/my-game.yaml:31 — Tabs are not allowed as indentation at line 31
```

One broken round does not take the others down either: it is quarantined, listed
as broken on the host view, and the rest of the game plays.

Three things worth knowing:

- **Do not rename a round `id` mid-party.** Points awarded in that round were
  recorded against the old id; on the next reload they have nowhere to go and
  they vanish from the scores. Rewriting a prompt, an answer or a whole item
  list is completely safe. Renaming an `id` is not.
- **Never use tabs to indent.** YAML forbids them and it is the single most
  common error. Two spaces per level.
- **Quote any text containing a colon or starting with a quote**, e.g.
  `prompt: 'Question: who?'`. An unquoted colon is a YAML parse error.

## Pictures

They are shown across a 1080p television, viewed from a sofa, quite possibly
with sunlight on the screen.

- **Roughly 1600×1200, and no smaller than 1200 wide.** A phone photo straight
  off the camera roll is already fine; a picture pulled off a website at
  400 pixels wide is a blurry mess on a TV.
- Landscape or square is best. A tall portrait photo is letterboxed with big
  bars either side; it still works, it just fills less of the screen.
- `.jpg` for photos, `.png` or `.svg` for anything with text or flat colour.
- Keep files under a few MB each. It is all served off the laptop's disk, so
  size costs load time, not bandwidth, but a 40MB scan is still a stutter.
- Scans of old photos: crop the white border off before the party, not during.
- **A picture is visible as soon as the item comes up** — it is not hidden until
  Reveal. If the picture *is* the answer, put it on its own item after the
  question, rather than expecting Reveal to unveil it.

The server prints a warning at boot for any picture the file refers to that is
not actually there:

```
[content] Round "baby-photos" references a missing asset: assets/baby-07.jpg
```

Read those warnings. They are the cheapest bug you will ever fix.

## Sound cues

The laptop's sound goes down the HDMI cable, so cues come out of the television.
`node scripts/make-sounds.mjs` generates four into `content/assets/`:

| File | |
|---|---|
| `cue-correct.wav` | Bright two-note chime |
| `cue-wrong.wav` | Soft comedic sag. Deliberately gentle — there are toddlers in the room |
| `cue-fanfare.wav` | A second and a half of arpeggio and chord, for the final scores |
| `cue-times-up.wav` | Two soft descending bells |

Attach one to an item like a picture:

```yaml
- prompt: 'Raise a glass.'
  media: { image: assets/wedding-1985.svg, audio: assets/cue-fanfare.wav }
  answer: 'To David and Jennifer.'
```

How it actually behaves, which decides where cues are worth using:

- A cue plays **when the display lands on that item** — not when you reveal, and
  not when you award a point. It marks an arrival: the toast, the start of the
  children's round, the moment the last question comes up.
- It plays when the audio file **differs from the last one played**. The same
  file twice with nothing in between will not fire a second time. If you want a
  cue at two different moments, use two different files.
- **Two cues in a whole game is about right.** A chime on every question is
  exhausting in a small room, and it slows you down. `anniversary.yaml` uses
  exactly two: one to turn the room towards Lucy, one for the toast.
- Sound needs one click inside the display window after you fullscreen it —
  browsers block audio until then. It is on the run-day checklist for this
  reason. If a cue is silent on the day, that click is what you forgot.
- Any `.wav`, `.mp3` or `.m4a` in `content/assets/` works, so a two-second clip
  of the birthday girl's favourite song is a legitimate cue. Keep them short:
  the game waits for nobody, and the file plays to the end regardless.

## Before you call the file finished

- [ ] Every round has more items than you think you need. Rounds run short.
- [ ] Every `restrictTo` id matches an `entrants` id — no warning at boot.
- [ ] Every picture exists — no missing-asset warning at boot.
- [ ] You have played every round to its last item, on the actual TV. That is
      the first item on [`docs/RUNDAY.md`](RUNDAY.md), and it is where you find
      the answer you fat-fingered.
