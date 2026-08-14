# The question editor

A screen for writing the game, at `/edit`. Open it on a laptop, not the iPad —
this is the afternoon-before tool, not a run-day one.

```bash
npm start          # then http://localhost:4000/edit
```

If `GM_PASSPHRASE` is set, the editor asks for it once, the same as `/host`.

## The one thing to understand

**The YAML file is still the source of truth.** The editor reads
`content/<game>.yaml`, writes it back, and that file is what the game plays.
Nothing is hidden in a database.

That means everything you already had still works:

- Hand-edit the file in a text editor whenever you prefer. The editor will pick
  the change up; it just refuses to save over it blindly (see below).
- `git diff` shows exactly what changed, in a file a human can read.
- The comments you wrote stay where you put them. Editing one round does not
  disturb another round's notes, and moving a question takes its comment along.
- If the editor breaks, nothing about the game is affected.

Saving normalises the *spacing* inside inline lists and maps — `[a, b]` becomes
`[ a, b ]` — because one serialiser has one opinion about style. Comments,
quoting, key order and values are untouched. The shipped content files are
already stored in that style, so saving them produces no spurious diff.

## What it will not let you do

Three refusals, all deliberate. Each one is a message on screen, not a silent
failure.

**"The content file changed on disk."** You loaded the editor, then something
else changed the file — a hand edit, a `git pull`, another browser window. The
save is refused rather than overwriting work you cannot see. Reload and redo.

**"That round is on the TV right now."** You cannot add, remove or reorder
questions in a round that is currently in play. Questions are addressed by
position, so inserting one would shift every question after it: the clue on the
TV would silently become a different one, and on a board an already-played
answer can appear in front of the room. **Rewording is always allowed** — that
is the whole point of hot reload. Restructure between rounds.

**"That would stop round X loading."** The edit was checked against the same
validator the game uses at startup, and it would have broken that round. The
file on disk is untouched; fix the field and save again.

The last one is why the editor is safe to use during setup: a save either
produces a file the game can load, or it does not happen.

## Preview on the TV

Every question has a **Preview on TV** button. It puts that question on the
display without playing it — no event is written, no score moves, and the
session log is untouched.

This is the cheap way to check the thing the run-day checklist keeps insisting
on: that the picture reads from the sofa, and that the prompt is short enough to
be legible across a room. Use it on the real television.

A preview is marked as one on screen, so a preview left up during the party is
obvious rather than convincing. Stop it with the same control.

## Pictures and sound

Drag a file onto a question, or pick one already in `content/assets`. Uploads
are stored under `content/assets` with a generated filename, and the file type
is decided by looking at the bytes rather than trusting the extension.

Images are shown large on a TV; see the sizing note in
[`CONTENT.md`](CONTENT.md). Sound cues are worth using twice in a game, not
twenty times.

## What it deliberately does not do

No rich text, no image editing, no collaborative editing — one host, one file.
Entrants are still created on `/host`, where the onboarding already lives,
because that is where you will be standing when people arrive.

It also does not author *submissions*; that is designed in
[`PLAN-EDITOR-AND-SUBMISSIONS.md`](PLAN-EDITOR-AND-SUBMISSIONS.md) and not
built.

## If you would rather not use it

Then don't. [`CONTENT.md`](CONTENT.md) documents every field, `template.yaml` is
a starter, and the file is plain YAML. The editor is a convenience, and the
project is arranged so that it stays one.
