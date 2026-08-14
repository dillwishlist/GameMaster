/**
 * The event log and its persistence.
 *
 * Every append is fsync'd to ./data/session-<id>.jsonl before it is
 * acknowledged. That is deliberately unsophisticated: at party scale the write
 * cost is irrelevant, and it means a laptop that dies mid-round comes back with
 * every point intact.
 *
 * Undo pops the last event and replays. Redo pushes it back. The host will tap
 * the wrong face — this is the feature that makes that a non-event.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import type { GameEvent, GameEventInput } from '../shared/events.js';
import type { GameContent } from './content.js';
import { emptyState, reduce, type GameState } from './game/state.js';

export class Session {
  private events: GameEvent[] = [];
  /** Popped by undo, replayed by redo. Cleared by any new append. */
  private undone: GameEvent[] = [];
  private listeners = new Set<() => void>();

  state: GameState;
  readonly file: string;

  private constructor(
    readonly id: string,
    private dataDir: string,
    private content: GameContent,
    events: GameEvent[],
  ) {
    this.file = path.join(dataDir, `session-${id}.jsonl`);
    this.events = events;
    this.state = this.rebuild(this.events, this.content);
  }

  /**
   * Fold the log into state, skipping any event that throws on the way through.
   *
   * `append` makes it very hard for such an event to reach the log at all, but
   * this is the second lock on the same door: a log written by an older build,
   * or one hand-edited at 9:15 on a Sunday, must still open. Refusing to start
   * because of one bad line is the worst possible response.
   */
  private rebuild(events: GameEvent[], content: GameContent): GameState {
    return events.reduce((state, event) => {
      try {
        return reduce(state, event, content);
      } catch (err) {
        console.warn(`[gamemaster] skipping unreducible event #${event?.seq ?? '?'}: ${String(err)}`);
        return state;
      }
    }, emptyState());
  }

  static create(dataDir: string, content: GameContent, requestedId = newSessionId()): Session {
    mkdirSync(dataDir, { recursive: true });
    // Ids are second-granular, so two sessions started in the same second would
    // otherwise share a file and the first one's log would be truncated.
    let id = requestedId;
    for (let n = 2; existsSync(path.join(dataDir, `session-${id}.jsonl`)); n++) id = `${requestedId}-${n}`;

    const session = new Session(id, dataDir, content, []);
    writeFileSync(session.file, '');
    session.append({ type: 'SESSION_START', sessionId: id, gameTitle: content.title });
    return session;
  }

  /** Resume the most recent session, or start a new one if there isn't one. */
  static resumeOrCreate(dataDir: string, content: GameContent): { session: Session; resumed: boolean } {
    const latest = latestSessionFile(dataDir);
    if (!latest) return { session: Session.create(dataDir, content), resumed: false };

    const id = path.basename(latest).replace(/^session-|\.jsonl$/g, '');
    const events = readLog(latest);
    if (events.length === 0) return { session: Session.create(dataDir, content), resumed: false };

    return { session: new Session(id, dataDir, content, events), resumed: true };
  }

  get eventCount(): number {
    return this.events.length;
  }

  get canUndo(): boolean {
    // Never undo past SESSION_START: there is no useful state on the far side.
    return this.events.length > 1;
  }

  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  append(input: GameEventInput): GameEvent {
    const event = { ...input, at: Date.now(), seq: this.events.length + 1 } as GameEvent;

    // Reduce BEFORE anything is recorded. If the event is malformed, or a round
    // type throws on it, this must be a no-op the host can tap past — not a
    // permanent entry in the log. An event that only fails on the way *out* of
    // `reduce` would be persisted anyway, and from then on every undo and every
    // restart replays it and throws: one bad tap, and the server will not come
    // back up. That is the exact mid-party failure this whole design exists to
    // prevent, so the write happens last.
    const next = reduce(this.state, event, this.content);

    this.events.push(event);
    this.undone = [];
    writeEvent(this.file, event);
    this.state = next;
    this.emit();
    return event;
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const popped = this.events.pop() as GameEvent;
    this.undone.push(popped);
    // Keep the undone event on disk in a sidecar so the post-party replay still
    // shows what actually happened in the room, including the mistakes.
    writeEvent(path.join(this.dataDir, `session-${this.id}.undone.jsonl`), popped);
    this.rewrite();
    this.state = this.rebuild(this.events, this.content);
    this.emit();
    return true;
  }

  redo(): boolean {
    const event = this.undone[this.undone.length - 1];
    if (!event) return false;
    // Same ordering rule as `append`: the content may have been edited since
    // this event was undone, so reducing it can fail now even though it didn't
    // when it was first applied.
    const next = reduce(this.state, event, this.content);
    this.undone.pop();
    this.events.push(event);
    writeEvent(this.file, event);
    this.state = next;
    this.emit();
    return true;
  }

  /**
   * Content changed on disk: replay the same log against the new content.
   *
   * Returns null on success, or a message explaining why the reload was
   * refused. Points are not stored — they are recomputed from the log every
   * time — so a round that stops resolving takes every point it ever awarded
   * with it. A one-character typo in a round id would silently zero the
   * scoreboard on the TV, mid-party, with nothing on the host view to explain
   * it. Refusing the reload and showing the host an error is the kinder
   * failure: the last good content keeps playing.
   */
  reloadContent(content: GameContent): string | null {
    const known = new Set(content.rounds.map((r) => r.id));
    const orphaned = [
      ...new Set(
        this.events
          .filter((e) => e.type === 'ROUND_EVENT' || (e.type === 'ROUND_SELECT' && e.roundId !== null))
          .map((e) => (e as { roundId: string }).roundId)
          .filter((id) => !known.has(id)),
      ),
    ];

    if (orphaned.length > 0) {
      return (
        `Refusing to reload: ${orphaned.map((id) => `"${id}"`).join(', ')} ` +
        `${orphaned.length === 1 ? 'has' : 'have'} already been played this session, and ` +
        `${orphaned.length === 1 ? 'is' : 'are'} not in the file any more. ` +
        `Reloading would wipe the points scored there. Put the round id back, or start a fresh session.`
      );
    }

    /**
     * Round types address their content by position — `manual` by item index,
     * `board` by "category:clue". So inserting or deleting a question in a
     * round that is already under way moves every question after it: the clue
     * on the TV silently becomes a different one, and on a board the answer to
     * an already-played square can appear, revealed, in front of the room.
     *
     * Editing the *words* is safe and is the whole point of hot reload —
     * that's what the run-day checklist tells the host to do. Adding or
     * removing questions mid-round is not, so it is refused rather than
     * quietly applied.
     */
    const restructured = content.rounds.filter(
      (round) =>
        this.state.roundStates[round.id] !== undefined &&
        arrayShapeChanged(this.contentFor(round.id), round.config),
    );

    if (restructured.length > 0) {
      return (
        `Refusing to reload: ${restructured.map((r) => `"${r.title}"`).join(', ')} ` +
        `${restructured.length === 1 ? 'is' : 'are'} already in play, and the number of questions changed. ` +
        `Questions are addressed by position, so this would move the round underneath itself — ` +
        `on a board it can put an answer on the TV. Edit the wording freely; ` +
        `add or remove questions between rounds, or start a fresh session.`
      );
    }

    // Only commit once the replay has succeeded — assigning first would leave
    // the session reducing new events against content its state doesn't match.
    const next = this.rebuild(this.events, content);
    this.content = content;
    this.state = next;
    this.emit();
    return null;
  }

  /** Start over with a fresh log. The old session file is left on disk. */
  reset(): Session {
    const fresh = Session.create(this.dataDir, this.content);
    for (const listener of this.listeners) fresh.onChange(listener);
    fresh.emit();
    return fresh;
  }

  private contentFor(roundId: string): unknown {
    return this.content.rounds.find((r) => r.id === roundId)?.config;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  /**
   * Write the whole log after an undo. Via a temp file and a rename, because a
   * truncate-then-write that dies halfway loses the entire session — and undo
   * is precisely the moment the host reaches for when something has already
   * gone wrong.
   */
  private rewrite(): void {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, this.events.map((e) => `${JSON.stringify(e)}\n`).join(''));
    renameSync(temp, this.file);
  }
}

/**
 * True when the two configs differ in the length of any array — items,
 * categories, clues, options. Deliberately blind to everything else: rewording
 * a question, fixing a typo in an answer, adding a host note or swapping an
 * image all leave positions alone and must keep working mid-round.
 */
function arrayShapeChanged(before: unknown, after: unknown): boolean {
  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return true;
    return before.some((item, i) => arrayShapeChanged(item, after[i]));
  }
  if (isRecord(before) && isRecord(after)) {
    // Keys only on one side are an added or removed field, not a moved
    // question — the positions the round type counts on are unaffected.
    return Object.keys(before).some((key) => key in after && arrayShapeChanged(before[key], after[key]));
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Append one event and fsync it before returning. `appendFileSync` alone opens,
 * writes and closes without flushing to the platter, so a hard power cut could
 * lose the last few points despite the file looking right. At party scale the
 * cost of doing it properly is irrelevant.
 */
function writeEvent(file: string, event: GameEvent): void {
  const fd = openSync(file, 'a');
  try {
    writeSync(fd, `${JSON.stringify(event)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function newSessionId(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function latestSessionFile(dataDir: string): string | null {
  if (!existsSync(dataDir)) return null;
  // Ordered by the timestamp in the id and then the collision counter, not by
  // filename and not by mtime. Plain name order is wrong because '-' sorts
  // before '.', so `session-<id>-2.jsonl` comes *before* `session-<id>.jsonl`
  // — reset the game, reboot the laptop, and the pre-reset scores come back.
  // mtime is wrong too: two sessions started in the same millisecond tie, and
  // the winner is then whatever order the directory happens to be read in.
  const files = readdirSync(dataDir).filter(
    (f) => f.startsWith('session-') && f.endsWith('.jsonl') && !f.endsWith('.undone.jsonl'),
  );

  const sorted = files.sort((a, b) => {
    const [baseA, nA] = sessionSortKey(a);
    const [baseB, nB] = sessionSortKey(b);
    return baseA === baseB ? nA - nB : baseA < baseB ? -1 : 1;
  });

  return sorted.length ? path.join(dataDir, sorted[sorted.length - 1]) : null;
}

/**
 * `session-20260814-120000-2.jsonl` → `['20260814-120000', 2]`. The id is
 * zero-padded, so string order over the timestamp is chronological order.
 * Anything hand-named sorts by its own name, ahead of the generated ones.
 */
function sessionSortKey(fileName: string): [string, number] {
  const match = /^session-(\d{8}-\d{6})(?:-(\d+))?\.jsonl$/.exec(fileName);
  if (!match) return [fileName, 0];
  return [match[1], match[2] ? Number(match[2]) : 1];
}

function readLog(file: string): GameEvent[] {
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line, i) => {
      try {
        return JSON.parse(line) as GameEvent;
      } catch {
        // A torn last line means the laptop died mid-write. Drop it and carry
        // on rather than refusing to start five minutes before the toast.
        console.warn(`[gamemaster] ignoring unreadable event at ${file}:${i + 1}`);
        return null;
      }
    })
    .filter((e): e is GameEvent => e !== null);
}
