import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Session } from '../server/session.js';
import type { GameContent } from '../server/content.js';

const content: GameContent = {
  title: 'Test Game',
  entrants: [],
  brokenRounds: {},
  sourceFile: 'test.yaml',
  rounds: [
    {
      id: 'photos',
      type: 'manual',
      title: 'Whose Baby',
      defaultPoints: 1,
      config: { items: [{ prompt: 'Whose baby photo?', answer: 'David' }] },
    },
  ],
};

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gamemaster-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  /* Temp dirs are small and the OS reaps them; nothing to do. */
});

function score(session: Session, id: string): number {
  return session.state.entrants.find((e) => e.id === id)?.score ?? 0;
}

describe('session', () => {
  it('persists every event as it happens', () => {
    const dir = tempDir();
    const session = Session.create(dir, content);
    session.append({ type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } });
    session.append({ type: 'AWARD_POINTS', entrantId: 'lucy', points: 2 });

    const lines = readFileSync(session.file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3); // SESSION_START + 2
    expect(JSON.parse(lines[2]).type).toBe('AWARD_POINTS');
  });

  it('undoes the wrong face and redoes it', () => {
    const dir = tempDir();
    const session = Session.create(dir, content);
    session.append({ type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } });
    session.append({ type: 'ENTRANT_ADD', entrant: { id: 'swans', displayName: 'Team Swan' } });
    session.append({ type: 'AWARD_POINTS', entrantId: 'swans', points: 1 });
    expect(score(session, 'swans')).toBe(1);

    expect(session.undo()).toBe(true);
    expect(score(session, 'swans')).toBe(0);

    expect(session.redo()).toBe(true);
    expect(score(session, 'swans')).toBe(1);

    // A new event after an undo abandons the redo branch.
    session.undo();
    session.append({ type: 'AWARD_POINTS', entrantId: 'lucy', points: 1 });
    expect(session.canRedo).toBe(false);
    expect(score(session, 'lucy')).toBe(1);
    expect(score(session, 'swans')).toBe(0);
  });

  it('never undoes past the start of the session', () => {
    const dir = tempDir();
    const session = Session.create(dir, content);
    expect(session.canUndo).toBe(false);
    expect(session.undo()).toBe(false);
  });

  it('keeps undone events in a sidecar for the post-party replay', () => {
    const dir = tempDir();
    const session = Session.create(dir, content);
    session.append({ type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } });
    session.undo();

    const sidecar = readFileSync(path.join(dir, `session-${session.id}.undone.jsonl`), 'utf8');
    expect(JSON.parse(sidecar.trim()).type).toBe('ENTRANT_ADD');
  });

  it('resumes the most recent session after a crash', () => {
    const dir = tempDir();
    const first = Session.create(dir, content);
    first.append({ type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } });
    first.append({ type: 'AWARD_POINTS', entrantId: 'lucy', points: 4 });

    // Laptop dies here. New process, same data directory.
    const { session: resumed, resumed: didResume } = Session.resumeOrCreate(dir, content);
    expect(didResume).toBe(true);
    expect(resumed.id).toBe(first.id);
    expect(score(resumed, 'lucy')).toBe(4);
  });

  it('survives a half-written last line', () => {
    const dir = tempDir();
    const session = Session.create(dir, content);
    session.append({ type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } });
    session.append({ type: 'AWARD_POINTS', entrantId: 'lucy', points: 2 });

    // Simulate a torn write: the power went out mid-append.
    writeFileSync(session.file, `${readFileSync(session.file, 'utf8')}{"type":"AWARD_POI`);

    const { session: resumed } = Session.resumeOrCreate(dir, content);
    expect(score(resumed, 'lucy')).toBe(2);
  });

  it('replays the same log against edited content', () => {
    const dir = tempDir();
    const session = Session.create(dir, content);
    session.append({ type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } });
    session.append({ type: 'ROUND_SELECT', roundId: 'photos' });
    session.append({ type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'lucy' } });
    expect(score(session, 'lucy')).toBe(1);

    // The host fixed a typo in the question mid-party and bumped the points.
    session.reloadContent({
      ...content,
      rounds: [{ ...content.rounds[0], defaultPoints: 3 }],
    });

    // Points already awarded are recomputed from the new content — the log is
    // the truth, and the log says "award the round default".
    expect(score(session, 'lucy')).toBe(3);
  });

  it('starts a fresh session without touching the old log', () => {
    const dir = tempDir();
    const first = Session.create(dir, content);
    first.append({ type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } });
    first.append({ type: 'AWARD_POINTS', entrantId: 'lucy', points: 9 });

    const fresh = first.reset();
    expect(score(fresh, 'lucy')).toBe(0);
    expect(readFileSync(first.file, 'utf8')).toContain('AWARD_POINTS');
  });
});
