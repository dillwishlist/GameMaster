# After the party

The game is over, the TV is back on the news, and the only record of who
actually won is a file. This is how to read it.

## What is in `./data`

```
data/session-20260809-130211.jsonl          the log: one JSON event per line
data/session-20260809-130211.undone.jsonl   the sidecar: taps the host took back
```

The log is the whole game, in order: who was created, which round was picked,
every reveal, every point. State is never stored — it is recomputed by replaying
the log, which is why undo and crash recovery work at all, and why the log is a
complete record rather than a summary somebody remembered to write.

The sidecar holds events that were undone during play. They are kept
deliberately: the log alone shows the tidied-up version of the evening, and the
sidecar is the bit where the host tapped the wrong face.

Both files are per-machine and `.gitignore`d. **Keep them anyway.** Copy them off
the laptop with the photos. Six months from now the YAML will have been edited
and the scores will be a matter of opinion, but the log will still be exact.

## Reading it back

```bash
node scripts/replay.mjs                              # newest session in ./data
node scripts/replay.mjs data/session-20260809-130211.jsonl
node scripts/replay.mjs --json | jq '.scores'        # machine-readable
node scripts/replay.mjs --help
```

The default output is meant to be read out loud: the game's title and how long
it ran, the final scores ranked with the winner marked, then a transcript —
every round in order, every item within it, and who was awarded what, with the
time on the clock.

`--json` prints the same thing as a structured object: `scores` (ranked, with
`rank` shared on a draw), `rounds[].items[].awards`, `adjustments`, and
`corrections`. Pipe it at `jq` and settle the argument.

Useful flags and variables:

| | |
|---|---|
| `--content <file>` | Replay against a specific content file |
| `--data-dir <dir>` | Where the logs live (default `./data`) |
| `GM_DATA_DIR`, `GM_CONTENT_DIR`, `GM_CONTENT` | The same variables the server uses |

## The counts at the bottom

```
  3 events undone during play; 2 scores set by hand.
```

- **Undone** — lines in the sidecar. The host tapped something and took it back.
  A handful over an evening is a well-run party.
- **Set by hand** — `SET_SCORE` events, where the host opened the keypad and
  typed a number. Every automated scoring path has this override by design; it
  is invariant two.

Both are worth a look rather than a wince. A round with a pile of undos and
hand-set scores behind it is usually a round type that misbehaved, or a question
that turned out to be ambiguous in front of a room. That is the most useful
thing this file can tell you before the next one.

The transcript also prints a **corrections** section listing each hand-set score
with the swing it caused, so "why does Team Swan have four?" has an answer.

## When things don't line up

The tool never refuses to run, because the log is the artefact you still have
and the content file is the thing somebody tidied up afterwards.

- **The content file changed.** Renamed game, edited questions, a round deleted:
  it prints a `!` warning saying so and carries on. Rounds that no longer exist
  show their id instead of a title, and prompts that are gone say so. Note that
  points a deleted round type awarded are *not* in the recomputed scores — the
  log records "the round type awarded", and that round type is gone. If the
  scores matter, replay against the version of the YAML you actually played:
  `node scripts/replay.mjs --content old/anniversary.yaml`.
- **The content file is missing entirely.** Prompts and round scoring disappear;
  entrants, timings and hand-set scores still come out.
- **The last line is torn.** The laptop died mid-write. The line is skipped,
  counted in `corrections.unreadableLines`, and everything before it still
  prints — the same tolerance the server has when it resumes a session.
