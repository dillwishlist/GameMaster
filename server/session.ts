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

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { GameEvent, GameEventInput } from '../shared/events.js';
import type { GameContent } from './content.js';
import { reduce, replay, type GameState } from './game/state.js';

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
    this.state = replay(this.events, this.content);
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
    this.events.push(event);
    this.undone = [];
    appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    this.state = reduce(this.state, event, this.content);
    this.emit();
    return event;
  }

  undo(): boolean {
    if (!this.canUndo) return false;
    const popped = this.events.pop() as GameEvent;
    this.undone.push(popped);
    // Keep the undone event on disk in a sidecar so the post-party replay still
    // shows what actually happened in the room, including the mistakes.
    appendFileSync(path.join(this.dataDir, `session-${this.id}.undone.jsonl`), `${JSON.stringify(popped)}\n`);
    this.rewrite();
    this.state = replay(this.events, this.content);
    this.emit();
    return true;
  }

  redo(): boolean {
    const event = this.undone.pop();
    if (!event) return false;
    this.events.push(event);
    appendFileSync(this.file, `${JSON.stringify(event)}\n`);
    this.state = reduce(this.state, event, this.content);
    this.emit();
    return true;
  }

  /** Content changed on disk: replay the same log against the new content. */
  reloadContent(content: GameContent): void {
    this.content = content;
    this.state = replay(this.events, this.content);
    this.emit();
  }

  /** Start over with a fresh log. The old session file is left on disk. */
  reset(): Session {
    const fresh = Session.create(this.dataDir, this.content);
    for (const listener of this.listeners) fresh.onChange(listener);
    fresh.emit();
    return fresh;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private rewrite(): void {
    writeFileSync(this.file, this.events.map((e) => `${JSON.stringify(e)}\n`).join(''));
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
  const files = readdirSync(dataDir)
    .filter((f) => f.startsWith('session-') && f.endsWith('.jsonl') && !f.endsWith('.undone.jsonl'))
    .sort();
  return files.length ? path.join(dataDir, files[files.length - 1]) : null;
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
