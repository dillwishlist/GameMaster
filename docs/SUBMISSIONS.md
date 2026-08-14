# Collecting questions from the family

The hard part of this project was never the code. It is getting baby photos and
trivia out of five households, and it runs at the speed of people answering a
text message.

The engine is LAN-only and your relatives are not on your LAN, so the path that
works is the boring one: send a form, export a CSV, import it.

```bash
npm run import-submissions -- responses.csv
```

Run it again whenever a fuller export arrives. Rows already imported are
skipped, so the usual pattern — export on Tuesday, export again on Friday when
the last two households finally reply — adds only what is new.

## Who is allowed to know who wrote it

Four modes, and the differences matter more than they look.

| `--attribution=` | Who can see the author | Use it for |
|---|---|---|
| `blind` | **Nobody, ever.** The name is not stored at all | Confessions, opinions, "the most embarrassing thing about Dad" |
| `host` *(default)* | You, never the TV | Ordinary questions — it lets the engine stop the submitter scoring on their own question |
| `reveal` | Hidden until you reveal it, then on the TV | **"Who said it?"** — the round builds itself |
| `public` | Everyone, always | "Lucy's question for Grandad" |

Two things worth being clear about:

**`blind` really means blind.** The name is not written to the file, and it is
not in the id either — a hash over a name is trivially reversible when the pool
of names is one family. If a name column is detected, the importer tells you it
is being dropped and that there is no way back.

**The cost of `blind` is that the author can still score on their own
question**, because nothing knows who they are. That is a genuine trade, not a
gap to be fixed later. If you want the exclusion, use `host`.

## When the columns are not guessed right

The importer looks at the headings and works out which column is the question,
the answer, the name and the timestamp. It prints what it picked. If it picks
wrong:

```bash
npm run import-submissions -- responses.csv \
  --text="Your question for the happy couple" \
  --answer="The answer" \
  --by="Your name"
```

`--dry-run` prints what it would add and writes nothing.

## What you get

`content/submissions.yaml` — a normal content file you can edit by hand:

```yaml
submissions:
  - id: sub-1bd878a1
    kind: question
    text: How many grandchildren?
    answer: Three — four in November!
    attribution: host
    by: Lucy
    entrantId: lucy          # matched to an entrant, so they can be excluded
    receivedAt: 02/08/2026 10:14:00
    source: form
    status: pending
```

**Everything arrives `pending`.** Nothing a guest wrote reaches the television
until you change that, which is the same reasoning as approving self-joined
players: otherwise you get three entrants named "poop" before the cake arrives.
Set `status` to `approved`, `rejected` or `used` as you go.

A name that does not match an entrant is kept as `by` with no `entrantId`, and
the importer says so — an aunt who submitted a question but is not playing is
perfectly normal, it just means there is nobody to exclude.

## Turning them into a round

By hand, for now: copy the text and answer into a `manual` round in your game
file (see [`CONTENT.md`](CONTENT.md)). For a `reveal` submission the author's
name *is* the answer, which is the whole "Who said it?" round.

Doing this from the editor — a review queue with an approve button and a "make
a round from these" — is designed in
[`PLAN-EDITOR-AND-SUBMISSIONS.md`](PLAN-EDITOR-AND-SUBMISSIONS.md) and not
built. Neither is per-question exclusion, which is what `entrantId` is being
collected for: `restrictTo` is per-round today.
