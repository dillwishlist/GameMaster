# Run-day checklist

A live event has a pre-flight. Work down this list on the morning, in order.
None of it is optional and none of it is interesting — that is the point.

The question editor at `/edit` is a prep tool, not a run-day one. Nothing below
needs it, and it is the one screen you should not have open while the game is
running.

## The day before

- [ ] `npm start` and play **every round to the last item** with a second
      person. Not a skim: actually tap the faces.
- [ ] Every image in the content file appears on the TV. The server prints a
      warning for missing assets at boot — read it.
- [ ] Test the exact HDMI cable, the exact adapter and the exact TV. Not a
      similar cable. Not a different input.
- [ ] Check the display on the actual television from where people will sit.
      If you cannot read the leaderboard from the sofa, fix it now.
- [ ] Charge the iPad. Charge the laptop.
- [ ] Print the fallback: the question list and a paper scoreboard.

## Ninety minutes before

- [ ] Laptop on **wall power**.
- [ ] Sleep and screensaver **off**. Not "5 minutes" — off.
- [ ] **Do Not Disturb on.** A text preview on the TV mid-round is a
      memorable way to ruin a surprise.
- [ ] Displays set to **extended**, not mirrored. You need the laptop screen
      free for yourself.
- [ ] `npm start`. Note the LAN URL it prints.
- [ ] Drag the `/display` window to the TV, fullscreen it (`⌃⌘F` / `F11`).
- [ ] **Click once inside the display window.** Browsers block sound until the
      page has been interacted with, and the sound cues ride the HDMI cable.
- [ ] TV on the right input, volume up if you are using sound.
- [ ] iPad: auto-lock **off**, on the same wifi, host URL open and bookmarked.
      Scan the QR code in the terminal to get there.
- [ ] Open `/host` in a **second window on the laptop** as well, and leave it
      open. This is the wifi-down fallback and it costs nothing to have ready.

## Five minutes before

- [ ] Players screen: everyone in the room has a tile, with the right face.
      Add the neighbours who turned up unexpectedly.
- [ ] Scores all zero. If they are not, Players → Start fresh session.
- [ ] Host view says **TV ✓** in the top bar. If it says "no TV", the display
      window is not connected — reload it.

## If something goes wrong

| Symptom | Do this |
|---|---|
| iPad drops off the wifi | Sit down at the laptop and use the `/host` window already open there. Everything works, including keyboard shortcuts. |
| Wrong face tapped | **Undo.** It is the big button and it is always safe. |
| Score is wrong and you don't know why | Tap the score bubble on the tile and set the number by hand. Do not fight the software in front of the room. |
| A round misbehaves | Pick a different round from the dropdown and carry on. Come back to it or don't. |
| Content file has a typo | The host view shows the error and **keeps playing the last good version**. Fix the file when you get a minute; it reloads by itself. |
| You want to edit a question mid-game | Reword anything you like — that reloads live. **Adding or removing questions in a round already in play is refused**, with a message saying so: questions are addressed by position, so it would move the round underneath itself. Do that between rounds. |
| Laptop dies completely | Restart it and run `npm start`. The session resumes with every point intact. |
| Everything dies | The printed question list and the paper scoreboard. This is why they are in the room. |

## Keyboard shortcuts (laptop host)

| Key | Does |
|---|---|
| `1`–`9` | Award a point to the 1st–9th player tile |
| `Shift` + `1`–`9` | Deduct |
| `Space` | Reveal / hide |
| `←` `→` | Previous / next item |
| `u` or `z` | Undo |

## After the party

The full event log is in `data/session-<id>.jsonl`, including a sidecar of
everything that was undone. Keep it. It is the only record of who actually won.

```bash
npm run replay          # final scores and a readable transcript of the game
```

See [`docs/AFTER-THE-PARTY.md`](AFTER-THE-PARTY.md).
