import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventInput, RoundEvent } from '../shared/events.js';
import type { GameContent } from '../server/content.js';
import { loadContent } from '../server/content.js';
import { replay } from '../server/game/state.js';
import { projectDisplay, projectHost } from '../server/game/projection.js';

/**
 * The `board` round. The three things worth protecting here are the ones a
 * reader would otherwise have to trust: the stake comes from the square rather
 * than the round, a used square stays used across a round switch, and the
 * clue's answer is not in the display payload before the host reveals it.
 */

const content: GameContent = {
  title: 'Board Test',
  entrants: [],
  brokenRounds: {},
  sourceFile: 'test.yaml',
  rounds: [
    {
      id: 'jeopardy',
      type: 'board',
      title: 'Family Jeopardy',
      defaultPoints: 1,
      config: {
        categories: [
          {
            name: 'Holidays',
            clues: [
              { value: 100, prompt: 'Where in 1998?', answer: 'Skegness' },
              { value: 400, prompt: 'Whose hat?', answer: 'Grandma’s hat' },
              { value: 500, prompt: 'Name every campsite.', answer: 'Nobody can', wager: true },
            ],
          },
          {
            name: 'Who Said It',
            clues: [{ value: 100, prompt: '“I am not lost.”', answer: 'Dad' }],
          },
        ],
      },
    },
    {
      id: 'photos',
      type: 'manual',
      title: 'Whose Baby',
      defaultPoints: 1,
      config: { items: [{ prompt: 'Whose baby photo?', answer: 'David' }] },
    },
  ],
};

const env = {
  canUndo: true,
  canRedo: false,
  avatarChoices: [],
  contentError: null,
  displaysConnected: 1,
};

function log(...inputs: GameEventInput[]): GameEvent[] {
  return inputs.map((input, i) => ({ ...input, at: 1_700_000_000_000 + i, seq: i + 1 }) as GameEvent);
}

const twoPlayers: GameEventInput[] = [
  { type: 'SESSION_START', sessionId: 's1', gameTitle: 'Board Test' },
  { type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } },
  { type: 'ENTRANT_ADD', entrant: { id: 'swans', displayName: 'Team Swan' } },
];

/** Sugar so a test reads as the taps the host actually makes. */
function board(...events: RoundEvent[]): GameEventInput[] {
  return events.map((event) => ({ type: 'ROUND_EVENT', roundId: 'jeopardy', event }));
}

function play(...events: RoundEvent[]) {
  return replay(log(...twoPlayers, { type: 'ROUND_SELECT', roundId: 'jeopardy' }, ...board(...events)), content);
}

interface HostExtra {
  categories: { name: string; clues: { value: number; consumed: boolean; wager: boolean }[] }[];
  open: { category: string; value: number; wager: boolean } | null;
  points: number;
  remaining: number;
  awards: Record<string, number>;
}

function hostExtra(state: ReturnType<typeof play>): HostExtra {
  return projectHost(state, content, env).round?.extra as unknown as HostExtra;
}

describe('board: playing a square', () => {
  it('opens, reveals, awards the square’s value, and consumes it on close', () => {
    const opened = play({ type: 'OPEN', category: 0, clue: 1 });
    expect(hostExtra(opened).open).toMatchObject({ category: 'Holidays', value: 400 });
    expect(projectHost(opened, content, env).round?.prompt).toBe('Whose hat?');

    const revealed = play({ type: 'OPEN', category: 0, clue: 1 }, { type: 'REVEAL' });
    expect(projectDisplay(revealed, content).round?.revealed).toBe(true);

    const awarded = play(
      { type: 'OPEN', category: 0, clue: 1 },
      { type: 'REVEAL' },
      { type: 'AWARD', entrantId: 'lucy' },
    );
    // The stake comes from the square, not from the round's defaultPoints.
    expect(awarded.entrants.find((e) => e.id === 'lucy')?.score).toBe(400);
    expect(hostExtra(awarded).awards.lucy).toBe(400);

    const closed = play(
      { type: 'OPEN', category: 0, clue: 1 },
      { type: 'AWARD', entrantId: 'lucy' },
      { type: 'CLOSE' },
    );
    expect(hostExtra(closed).open).toBeNull();
    expect(hostExtra(closed).categories[0].clues[1].consumed).toBe(true);
    expect(hostExtra(closed).remaining).toBe(3);
  });

  it('deducts the square’s value on a wrong answer — that is the whole format', () => {
    const state = play(
      { type: 'OPEN', category: 0, clue: 1 },
      { type: 'AWARD', entrantId: 'swans', points: -400 },
      { type: 'AWARD', entrantId: 'lucy' },
    );
    expect(state.entrants.find((e) => e.id === 'swans')?.score).toBe(-400);
    expect(state.entrants.find((e) => e.id === 'lucy')?.score).toBe(400);
  });

  it('refuses to reopen a consumed square by accident, but reopens it on request', () => {
    const stuck = play(
      { type: 'OPEN', category: 0, clue: 0 },
      { type: 'CLOSE' },
      { type: 'OPEN', category: 0, clue: 0 },
    );
    expect(hostExtra(stuck).open).toBeNull();

    const rescued = play(
      { type: 'OPEN', category: 0, clue: 0 },
      { type: 'CLOSE' },
      { type: 'REOPEN', category: 0, clue: 0 },
    );
    expect(hostExtra(rescued).open).toMatchObject({ value: 100 });
    expect(hostExtra(rescued).categories[0].clues[0].consumed).toBe(false);
  });

  it('backs out of a mis-picked square without using it up', () => {
    const state = play({ type: 'OPEN', category: 1, clue: 0 }, { type: 'CANCEL' });
    expect(hostExtra(state).open).toBeNull();
    expect(hostExtra(state).categories[1].clues[0].consumed).toBe(false);
    expect(hostExtra(state).remaining).toBe(4);
  });

  it('ignores a square that is not on the board', () => {
    expect(hostExtra(play({ type: 'OPEN', category: 9, clue: 9 })).open).toBeNull();
    expect(hostExtra(play({ type: 'OPEN', category: 1, clue: 3 })).open).toBeNull();
  });

  it('keeps consumed squares across a round switch', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'jeopardy' },
        ...board({ type: 'OPEN', category: 0, clue: 0 }, { type: 'CLOSE' }),
        { type: 'ROUND_SELECT', roundId: 'photos' },
        { type: 'ROUND_SELECT', roundId: 'jeopardy' },
      ),
      content,
    );
    expect(hostExtra(state).categories[0].clues[0].consumed).toBe(true);
    expect(hostExtra(state).remaining).toBe(3);
  });

  it('lets the host award by hand with no square open, so nobody is stuck', () => {
    const state = play({ type: 'AWARD', entrantId: 'lucy' });
    expect(state.entrants.find((e) => e.id === 'lucy')?.score).toBe(1);
  });

  it('is a pure reduction: truncating the log is exactly undo', () => {
    const full = log(
      ...twoPlayers,
      { type: 'ROUND_SELECT', roundId: 'jeopardy' },
      ...board({ type: 'OPEN', category: 0, clue: 1 }, { type: 'AWARD', entrantId: 'lucy' }, { type: 'CLOSE' }),
    );
    expect(replay(full, content)).toEqual(replay(full, content));
    const undone = replay(full.slice(0, -1), content);
    expect(hostExtra(undone).open).toMatchObject({ value: 400 });
    expect(undone.entrants.find((e) => e.id === 'lucy')?.score).toBe(400);
  });
});

describe('board: wagers', () => {
  it('stakes the host’s amount instead of the square’s value', () => {
    const state = play(
      { type: 'OPEN', category: 0, clue: 2 },
      { type: 'SET_WAGER', points: 1500 },
      { type: 'AWARD', entrantId: 'swans' },
    );
    expect(state.entrants.find((e) => e.id === 'swans')?.score).toBe(1500);
    expect(hostExtra(state).points).toBe(1500);
  });

  it('ignores a wager on a square that is not one, and a nonsense amount', () => {
    const notAWager = play({ type: 'OPEN', category: 0, clue: 0 }, { type: 'SET_WAGER', points: 1500 });
    expect(hostExtra(notAWager).points).toBe(100);

    const nonsense = play({ type: 'OPEN', category: 0, clue: 2 }, { type: 'SET_WAGER', points: -5 });
    expect(hostExtra(nonsense).points).toBe(500);
  });
});

describe('board: the display never sees an unrevealed answer', () => {
  it('sends the grid but no clue text before a square is opened', () => {
    const display = projectDisplay(play(), content);
    const serialized = JSON.stringify(display);

    expect(serialized).not.toContain('Skegness');
    expect(serialized).not.toContain('Where in 1998?');
    // Which square hides the wager is the format's one surprise. The room must
    // not be able to spot it by reading the TV.
    expect(serialized).not.toContain('wager');
    expect((display.round?.extra as { categories: unknown[] }).categories).toHaveLength(2);
  });

  it('withholds the response until the host reveals, then sends it', () => {
    const hidden = projectDisplay(play({ type: 'OPEN', category: 0, clue: 0 }), content);
    expect(hidden.round?.prompt).toBe('Where in 1998?');
    expect(JSON.stringify(hidden)).not.toContain('Skegness');
    expect('answer' in (hidden.round ?? {})).toBe(false);
    expect((hidden.round?.extra as { response?: string }).response).toBeUndefined();

    const shown = projectDisplay(play({ type: 'OPEN', category: 0, clue: 0 }, { type: 'REVEAL' }), content);
    expect((shown.round?.extra as { response?: string }).response).toBe('Skegness');
  });

  it('hides the response again when the square closes', () => {
    const state = play({ type: 'OPEN', category: 0, clue: 0 }, { type: 'REVEAL' }, { type: 'CLOSE' });
    expect(projectDisplay(state, content).round?.revealed).toBe(false);
    expect(JSON.stringify(projectDisplay(state, content))).not.toContain('Skegness');
  });

  it('gives the host the answer immediately, revealed or not', () => {
    const state = play({ type: 'OPEN', category: 0, clue: 0 });
    expect(projectHost(state, content, env).round?.answer).toBe('Skegness');
  });
});

describe('board: content validation', () => {
  function write(yaml: string): string {
    const dir = mkdtempSync(path.join(tmpdir(), 'gamemaster-board-'));
    const file = path.join(dir, 'game.yaml');
    writeFileSync(file, yaml);
    return file;
  }

  it('loads a board written the way the sample file writes one', () => {
    const loaded = loadContent(
      write(`
title: Board Game
rounds:
  - id: b
    type: board
    title: Family Jeopardy
    categories:
      - name: Holidays
        clues:
          - value: 100
            prompt: Where in 1998?
            answer: Skegness
          - value: 200
            prompt: Whose hat?
            answer: Grandma's
            wager: true
`),
    );
    const cfg = loaded.rounds[0].config as { categories: { clues: { value: number; wager?: boolean }[] }[] };
    expect(cfg.categories[0].clues[0].value).toBe(100);
    expect(cfg.categories[0].clues[1].wager).toBe(true);
  });

  it('names the missing `value` and the line it is missing from', () => {
    const file = write(`
title: Board Game
rounds:
  - id: b
    type: board
    title: Family Jeopardy
    categories:
      - name: Holidays
        clues:
          - prompt: Where in 1998?
            answer: Skegness
`);
    expect(() => loadContent(file)).toThrow(/game\.yaml:\d+/);
    expect(() => loadContent(file)).toThrow(/value/);
  });

  it('says so plainly when a board has no categories', () => {
    expect(() =>
      loadContent(
        write(`
title: Board Game
rounds:
  - id: b
    type: board
    title: Family Jeopardy
    categories: []
`),
      ),
    ).toThrow(/at least one category/);
  });
});
