/**
 * Tests for the after-the-party replay.
 *
 * These build session logs by hand rather than by driving a `Session`, because
 * the interesting properties are about *time* (when the party started, how long
 * it ran) and about damage (a torn final line, a content file edited since).
 * Writing the JSONL directly is the only way to control both.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventInput } from '../shared/events.js';
import type { GameContent } from '../server/content.js';
import { ReplayError, buildSummary, formatSummary, runCli } from '../server/replay.js';

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
      config: {
        items: [
          { prompt: 'Whose baby photo?', answer: 'David' },
          { prompt: 'And this one?', answer: 'Jennifer' },
        ],
      },
    },
    {
      id: 'trivia',
      type: 'multipleChoice',
      title: 'How Well Do You Know Them',
      defaultPoints: 2,
      config: {
        items: [{ prompt: 'What year did they marry?', options: ['1983', '1985', '1987'], correct: 'B' }],
      },
    },
  ],
};

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'gamemaster-replay-'));
}

const START = Date.parse('2026-08-14T15:30:00Z');
const MINUTE = 60_000;

/** Write a log whose timestamps march forward one minute per event. */
function writeLog(dir: string, id: string, inputs: GameEventInput[], opts: { torn?: boolean } = {}): string {
  const file = path.join(dir, `session-${id}.jsonl`);
  const lines = inputs.map((input, i) => {
    const event = { ...input, at: START + i * MINUTE, seq: i + 1 } as GameEvent;
    return `${JSON.stringify(event)}\n`;
  });
  // A torn write: the power went out halfway through appending the last event.
  writeFileSync(file, lines.join('') + (opts.torn ? '{"type":"AWARD_POI' : ''));
  return file;
}

function writeUndone(dir: string, id: string, inputs: GameEventInput[]): void {
  const lines = inputs.map((input, i) => `${JSON.stringify({ ...input, at: START + i * MINUTE, seq: i + 1 })}\n`);
  writeFileSync(path.join(dir, `session-${id}.undone.jsonl`), lines.join(''));
}

/** A realistic little party: two rounds, an undo, a hand-set score. */
function partyLog(dir: string, id = '20260814-153000'): string {
  const file = writeLog(dir, id, [
    { type: 'SESSION_START', sessionId: id, gameTitle: 'Test Game' },
    { type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } },
    { type: 'ENTRANT_ADD', entrant: { id: 'swans', displayName: 'Team Swan' } },
    { type: 'ROUND_SELECT', roundId: 'photos' },
    { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'lucy' } },
    { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'NEXT' } },
    { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'swans' } },
    { type: 'ROUND_SELECT', roundId: 'trivia' },
    { type: 'ROUND_EVENT', roundId: 'trivia', event: { type: 'AWARD', entrantId: 'swans' } },
    { type: 'SET_SCORE', entrantId: 'lucy', score: 5 },
    { type: 'ROUND_SELECT', roundId: null },
  ]);
  writeUndone(dir, id, [{ type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'lucy' } }]);
  return file;
}

describe('replay', () => {
  it('summarises a finished session', () => {
    const dir = tempDir();
    const file = partyLog(dir);
    const summary = buildSummary({ file, content });

    expect(summary.sessionId).toBe('20260814-153000');
    expect(summary.gameTitle).toBe('Test Game');
    expect(summary.eventCount).toBe(11);
    expect(summary.startedAt).toBe(START);
    expect(summary.endedAt).toBe(START + 10 * MINUTE);
    expect(summary.durationMs).toBe(10 * MINUTE);
    expect(summary.contentChanged).toBe(false);
  });

  it('ranks the final scores with the winner first', () => {
    const dir = tempDir();
    const summary = buildSummary({ file: partyLog(dir), content });

    // Team Swan: 1 (photos) + 2 (trivia). Lucy: 1, then set by hand to 5.
    expect(summary.scores).toEqual([
      { rank: 1, entrantId: 'lucy', displayName: 'Lucy', score: 5, winner: true },
      { rank: 2, entrantId: 'swans', displayName: 'Team Swan', score: 3, winner: false },
    ]);
  });

  it('shares a rank when the top is a draw', () => {
    const dir = tempDir();
    const file = writeLog(dir, '20260814-160000', [
      { type: 'SESSION_START', sessionId: 's', gameTitle: 'Test Game' },
      { type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } },
      { type: 'ENTRANT_ADD', entrant: { id: 'swans', displayName: 'Team Swan' } },
      { type: 'ENTRANT_ADD', entrant: { id: 'outlaws', displayName: 'The Out-laws' } },
      { type: 'AWARD_POINTS', entrantId: 'lucy', points: 4 },
      { type: 'AWARD_POINTS', entrantId: 'swans', points: 4 },
      { type: 'AWARD_POINTS', entrantId: 'outlaws', points: 1 },
    ]);

    const summary = buildSummary({ file, content });
    expect(summary.scores.map((s) => [s.displayName, s.rank, s.winner])).toEqual([
      ['Lucy', 1, true],
      ['Team Swan', 1, true],
      ['The Out-laws', 3, false],
    ]);
    expect(formatSummary(summary)).toContain('A draw at the top: Lucy and Team Swan, 4.');
  });

  it('lays the transcript out round by round and item by item', () => {
    const dir = tempDir();
    const summary = buildSummary({ file: partyLog(dir), content });

    expect(summary.rounds.map((r) => r.roundId)).toEqual(['photos', 'trivia']);

    const photos = summary.rounds[0];
    expect(photos.title).toBe('Whose Baby');
    expect(photos.pointsAwarded).toBe(2);
    expect(photos.items.map((i) => i.prompt)).toEqual(['Whose baby photo?', 'And this one?']);
    expect(photos.items[0].awards).toEqual([
      { at: START + 4 * MINUTE, entrantId: 'lucy', displayName: 'Lucy', points: 1 },
    ]);
    expect(photos.items[1].awards.map((a) => a.displayName)).toEqual(['Team Swan']);

    // The multiple-choice answer is spelled out; a bare letter means nothing
    // to somebody reading this next year.
    expect(summary.rounds[1].items[0].answer).toBe('B. 1985');
  });

  it('counts the mistakes: undone events and hand-set scores', () => {
    const dir = tempDir();
    const summary = buildSummary({ file: partyLog(dir), content });

    expect(summary.corrections).toEqual({ undone: 1, setScore: 1, unreadableLines: 0 });
    expect(summary.adjustments).toEqual([
      { at: START + 9 * MINUTE, type: 'SET_SCORE', entrantId: 'lucy', displayName: 'Lucy', points: 4, score: 5 },
    ]);
    expect(formatSummary(summary)).toContain('1 event undone during play; 1 score set by hand.');
  });

  it('reports no corrections when there is no sidecar', () => {
    const dir = tempDir();
    const file = writeLog(dir, '20260814-170000', [
      { type: 'SESSION_START', sessionId: 's', gameTitle: 'Test Game' },
      { type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } },
      { type: 'AWARD_POINTS', entrantId: 'lucy', points: 3 },
    ]);

    const summary = buildSummary({ file, content });
    expect(summary.corrections).toEqual({ undone: 0, setScore: 0, unreadableLines: 0 });
    expect(summary.adjustments).toHaveLength(1);
  });

  it('survives a torn final line and still prints the scores', () => {
    const dir = tempDir();
    const file = writeLog(
      dir,
      '20260814-180000',
      [
        { type: 'SESSION_START', sessionId: 's', gameTitle: 'Test Game' },
        { type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } },
        { type: 'AWARD_POINTS', entrantId: 'lucy', points: 2 },
      ],
      { torn: true },
    );

    const summary = buildSummary({ file, content });
    expect(summary.eventCount).toBe(3);
    expect(summary.corrections.unreadableLines).toBe(1);
    expect(summary.scores[0]).toMatchObject({ displayName: 'Lucy', score: 2, winner: true });
    expect(formatSummary(summary)).toContain('1 log line unreadable');
  });

  it('keeps going when the content file has changed since the party', () => {
    const dir = tempDir();
    // The host renamed the game and deleted the trivia round afterwards, and
    // trimmed the photo round down to one item.
    const edited: GameContent = {
      ...content,
      title: 'Test Game (2027 edition)',
      rounds: [{ ...content.rounds[0], config: { items: [{ prompt: 'Whose baby photo?', answer: 'David' }] } }],
    };

    const summary = buildSummary({ file: partyLog(dir), content: edited });

    expect(summary.contentChanged).toBe(true);
    expect(summary.warnings.join('\n')).toContain('trivia');
    expect(summary.warnings.join('\n')).toContain('played as "Test Game"');

    // The photo round still reads back. There is only one item now, so the NEXT
    // the host pressed on the night no longer goes anywhere and both awards land
    // on the surviving question — the log is the truth, the content is not.
    const photos = summary.rounds[0];
    expect(photos.items.map((i) => i.prompt)).toEqual(['Whose baby photo?']);
    expect(photos.items[0].awards.map((a) => a.displayName)).toEqual(['Lucy', 'Team Swan']);

    // The trivia round is listed by id with no prompt to show, and its points
    // are not in the scores — the log says "the round type awarded", and that
    // round type is gone.
    const trivia = summary.rounds[1];
    expect(trivia.known).toBe(false);
    expect(trivia.title).toBe('trivia');
    expect(trivia.items.map((i) => i.prompt)).toEqual([null]);
    expect(summary.scores.find((s) => s.entrantId === 'swans')?.score).toBe(1);

    expect(formatSummary(summary)).toContain('no longer in the content file');
  });

  it('still prints scores when the content file cannot be read at all', () => {
    const dir = tempDir();
    const summary = buildSummary({ file: partyLog(dir), contentDir: path.join(dir, 'nope') });

    expect(summary.contentError).toBeTruthy();
    expect(summary.contentTitle).toBeNull();
    // Only the hand-set score survives without a content file to score against.
    expect(summary.scores.find((s) => s.entrantId === 'lucy')?.score).toBe(5);
    expect(() => formatSummary(summary)).not.toThrow();
  });

  it('picks the most recent session when no file is given', () => {
    const dir = tempDir();
    writeLog(dir, '20260814-120000', [
      { type: 'SESSION_START', sessionId: 'old', gameTitle: 'Test Game' },
      { type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } },
    ]);
    writeLog(dir, '20260814-190000', [
      { type: 'SESSION_START', sessionId: 'new', gameTitle: 'Test Game' },
      { type: 'ENTRANT_ADD', entrant: { id: 'swans', displayName: 'Team Swan' } },
    ]);

    const summary = buildSummary({ dataDir: dir, content });
    expect(summary.sessionId).toBe('20260814-190000');
    expect(summary.scores.map((s) => s.entrantId)).toEqual(['swans']);
  });

  it('says so plainly when there are no sessions to replay', () => {
    const dir = tempDir();
    expect(() => buildSummary({ dataDir: dir, content })).toThrow(ReplayError);

    const result = runCli(['--data-dir', dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No session logs in');
    expect(result.stdout).toBe('');
  });

  it('fails cleanly on a log file that does not exist', () => {
    const result = runCli([path.join(tempDir(), 'session-nope.jsonl')]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('No such session log');
  });

  it('emits a structured summary under --json', () => {
    const dir = tempDir();
    const file = partyLog(dir);
    const result = runCli([file, '--json', '--content', path.join(dir, 'missing.yaml')]);

    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as ReturnType<typeof buildSummary>;
    expect(parsed.sessionId).toBe('20260814-153000');
    expect(parsed.corrections.undone).toBe(1);
    expect(parsed.scores[0].winner).toBe(true);
  });

  it('prints usage for --help and rejects nonsense flags', () => {
    expect(runCli(['--help']).stdout).toContain('node scripts/replay.mjs');
    expect(runCli(['--wat']).exitCode).toBe(2);
    expect(runCli(['--data-dir']).stderr).toContain('needs a path');
  });

  it('reads aloud: the human rendering has the parts a person looks for', () => {
    const dir = tempDir();
    const text = formatSummary(buildSummary({ file: partyLog(dir), content }));

    expect(text).toContain('Test Game');
    expect(text).toContain('FINAL SCORES');
    expect(text).toContain('Winner: Lucy, 5 points.');
    expect(text).toContain('TRANSCRIPT');
    expect(text).toContain('Round 1 — Whose Baby');
    expect(text).toContain('Whose baby photo?');
    expect(text).toContain('answer: David');
    expect(text).toContain('CORRECTIONS');
    // No JSON braces anywhere: this is meant to be read out, not parsed.
    expect(text).not.toContain('{"type"');
  });
});
