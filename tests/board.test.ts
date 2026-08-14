import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventInput, RoundEvent } from '../shared/events.js';
import type { EntrantId } from '../shared/types.js';
import type { GameContent } from '../server/content.js';
import { loadContent } from '../server/content.js';
import type { GameState } from '../server/game/state.js';
import { emptyState, reduce as reduceGame, replay } from '../server/game/state.js';
import { makeRoundContext } from '../server/game/roundContext.js';
import { projectDisplay, projectHost } from '../server/game/projection.js';
import type { BoardState } from '../server/roundTypes/board.js';
import { boardRoundType } from '../server/roundTypes/board.js';
import { manualInit } from '../server/roundTypes/manual.js';

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

interface DisplayExtra {
  /** No `wager` key here, ever — see the secrecy describe below. */
  categories: { name: string; clues: { value: number; consumed: boolean }[] }[];
  open: { category: string; value: number; wager: boolean } | null;
  response?: string;
}

function displayExtra(state: ReturnType<typeof play>): DisplayExtra {
  return projectDisplay(state, content).round?.extra as unknown as DisplayExtra;
}

const jeopardyRound = content.rounds[0];

/** Freeze a value and everything under it, so a stray write throws here. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

/**
 * Drives the round type the way a live session does — one event at a time, each
 * handed the state the previous one returned — with every state frozen first.
 * The core passes `state.roundStates[id]` straight into `reduce` with no
 * defensive copy, so anything the reducer writes in place is written into the
 * session's own history. `play()` cannot show that: it rebuilds from empty.
 */
function fold(...events: RoundEvent[]): { state: BoardState; scores: Record<EntrantId, number> } {
  const game = play();
  const scores: Record<EntrantId, number> = {};
  const config = jeopardyRound.config as never;
  let state = deepFreeze(boardRoundType.init(config, makeRoundContext(game, jeopardyRound, 0).ctx));

  for (const [i, event] of events.entries()) {
    const { ctx, drainAwards } = makeRoundContext(game, jeopardyRound, 1_700_000_000_000 + i);
    state = deepFreeze(boardRoundType.reduce(state, event, config, ctx));
    for (const a of drainAwards()) scores[a.entrantId] = (scores[a.entrantId] ?? 0) + a.points;
  }
  return { state, scores };
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
      ...board(
        { type: 'OPEN', category: 0, clue: 1 },
        { type: 'AWARD', entrantId: 'lucy' },
        { type: 'CLOSE' },
        { type: 'OPEN', category: 0, clue: 2 },
        { type: 'SET_WAGER', points: 1500 },
      ),
    );

    // Fold the core reducer by hand, keeping every state it produced, and check
    // each one still equals a fresh replay of the log up to that point. This
    // test used to compare two full replays of the same log, which is true of
    // any implementation whatsoever — including one that mutates the state it
    // was handed. The damage from that shows up only in the states left behind
    // the write, which is exactly what the live session and undo hold on to.
    const snapshots: GameState[] = [];
    let live = emptyState();
    for (const event of full) {
      live = reduceGame(live, event, content);
      snapshots.push(live);
    }
    snapshots.forEach((snapshot, i) => expect(snapshot).toEqual(replay(full.slice(0, i + 1), content)));

    const undone = replay(full.slice(0, -1), content);
    expect(hostExtra(undone).points).toBe(500);
    expect(undone.entrants.find((e) => e.id === 'lucy')?.score).toBe(400);
  });

  it('never writes into the state it was handed — the core passes it in uncopied', () => {
    // A `state.consumed.push(...)` here would corrupt the live session and undo
    // while every `play()` test above stayed green, because those all rebuild
    // from empty. Frozen state turns that into a loud TypeError instead.
    const { state, scores } = fold(
      { type: 'OPEN', category: 0, clue: 0 },
      { type: 'REVEAL' },
      { type: 'AWARD', entrantId: 'lucy' },
      { type: 'CLOSE' },
      { type: 'OPEN', category: 0, clue: 2 },
      { type: 'SET_WAGER', points: 1500 },
      { type: 'TIMER_START', seconds: 30 },
      { type: 'AWARD', entrantId: 'swans', points: -1500 },
      { type: 'TIMER_STOP' },
      { type: 'NEXT' },
      { type: 'OPEN', category: 1, clue: 0 },
      { type: 'CANCEL' },
      { type: 'REOPEN', category: 0, clue: 0 },
    );

    expect(state.consumed).toEqual(['0:2']);
    expect(state.open).toBe('0:0');
    expect(scores).toEqual({ lucy: 100, swans: -1500 });
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

  it('forgets the wager when the host backs out, so the square is worth 500 again', () => {
    // CANCEL means "wrong square, leave it in play". A stake that outlived it
    // would leave the square mined: it comes round again later and quietly pays
    // triple to whoever picks it, with the printed 500 still on the TV.
    const state = play(
      { type: 'OPEN', category: 0, clue: 2 },
      { type: 'SET_WAGER', points: 1500 },
      { type: 'CANCEL' },
      { type: 'OPEN', category: 0, clue: 2 },
      { type: 'AWARD', entrantId: 'swans' },
    );
    expect(hostExtra(state).points).toBe(500);
    expect(displayExtra(state).open).toMatchObject({ value: 500 });
    expect(state.entrants.find((e) => e.id === 'swans')?.score).toBe(500);
  });

  it('forgets the wager when the square is spent, so a reopen starts fresh', () => {
    const state = play(
      { type: 'OPEN', category: 0, clue: 2 },
      { type: 'SET_WAGER', points: 9999 },
      { type: 'CLOSE' },
      { type: 'REOPEN', category: 0, clue: 2 },
    );
    expect(hostExtra(state).points).toBe(500);
  });
});

describe('board: the timer', () => {
  function timer(state: ReturnType<typeof play>) {
    return projectHost(state, content, env).round?.timer;
  }

  it('runs a countdown on the open square and takes it away with the square', () => {
    const running = play({ type: 'OPEN', category: 0, clue: 0 }, { type: 'TIMER_START', seconds: 30 });
    expect(timer(running)).toMatchObject({ running: true, durationMs: 30_000 });
    expect(projectDisplay(running, content).round?.timer).toMatchObject({ running: true });

    const stopped = play(
      { type: 'OPEN', category: 0, clue: 0 },
      { type: 'TIMER_START', seconds: 30 },
      { type: 'TIMER_STOP' },
    );
    expect(timer(stopped)).toMatchObject({ running: false });

    const closed = play(
      { type: 'OPEN', category: 0, clue: 0 },
      { type: 'TIMER_START', seconds: 30 },
      { type: 'CLOSE' },
    );
    expect(timer(closed)).toBeUndefined();

    const cancelled = play(
      { type: 'OPEN', category: 0, clue: 0 },
      { type: 'TIMER_START', seconds: 30 },
      { type: 'CANCEL' },
    );
    expect(timer(cancelled)).toBeUndefined();
  });

  it('ignores a timer started with the grid up — nothing in the round could stop it', () => {
    // CLOSE and CANCEL are the only things that clear a timer, and both return
    // early with no square open, so a countdown started on the grid used to sit
    // there expired next to the board for the rest of the round.
    const onTheGrid = play({ type: 'TIMER_START', seconds: 30 });
    expect(timer(onTheGrid)).toBeUndefined();
    expect(projectDisplay(onTheGrid, content).round?.timer).toBeUndefined();

    const swattedAt = play({ type: 'TIMER_START', seconds: 30 }, { type: 'CLOSE' }, { type: 'CANCEL' });
    expect(timer(swattedAt)).toBeUndefined();
  });
});

describe('board: events the host never meant to send', () => {
  it('ignores an OPEN that names no square, instead of opening one nobody picked', () => {
    // `Number(null)`, `Number('')`, `Number([])` and `Number(false)` are all 0
    // and all pass `Number.isInteger`, so a coercing lookup answers any of these
    // by putting the top-left clue on the TV. The real client sends numbers;
    // anything that is not one names no square at all.
    const nothings: RoundEvent[] = [
      { type: 'OPEN' },
      { type: 'OPEN', category: null, clue: null },
      { type: 'OPEN', category: true, clue: false },
      { type: 'OPEN', category: '', clue: '' },
      { type: 'OPEN', category: [], clue: [] },
      { type: 'OPEN', category: '0', clue: '0' },
      { type: 'OPEN', category: 0.5, clue: 0 },
      { type: 'OPEN', category: Number.NaN, clue: Number.NaN },
    ];

    for (const event of nothings) {
      const opened = play(event);
      expect(hostExtra(opened).open, `OPEN ${JSON.stringify(event)}`).toBeNull();
      expect(projectHost(opened, content, env).round?.prompt).toBe('');
      // REOPEN takes the same indices and un-consumes what it finds, so a
      // coerced 0:0 there would resurrect a square the room is done with.
      expect(hostExtra(play({ ...event, type: 'REOPEN' })).open).toBeNull();
    }
  });

  it('shrugs off a wager with no square, an unknown entrant, and a timer with no length', () => {
    const wagerOnTheGrid = play({ type: 'SET_WAGER', points: 1500 });
    expect(hostExtra(wagerOnTheGrid).open).toBeNull();
    // ...and it does not lie in wait for the wager square to be opened.
    const opened = play({ type: 'SET_WAGER', points: 1500 }, { type: 'OPEN', category: 0, clue: 2 });
    expect(hostExtra(opened).points).toBe(500);

    const ghost = play({ type: 'OPEN', category: 0, clue: 1 }, { type: 'AWARD', entrantId: 'nobody' });
    expect(ghost.entrants.every((e) => e.score === 0)).toBe(true);
    const nameless = play({ type: 'OPEN', category: 0, clue: 1 }, { type: 'AWARD' });
    expect(nameless.entrants.every((e) => e.score === 0)).toBe(true);

    // No `seconds` on the event and no `timerSeconds` in the config: there is
    // no countdown to start, and the host's clock stays off.
    const noLength = play({ type: 'OPEN', category: 0, clue: 0 }, { type: 'TIMER_START' });
    expect(projectHost(noLength, content, env).round?.timer).toBeUndefined();
  });

  it('does not throw when handed another round type’s state', () => {
    // Not reachable today — a content reload rebuilds `roundStates` from empty,
    // so a round that changed type re-inits before it sees an event. But a
    // round type that throws takes the session down with it, and the guard
    // costs one `Array.isArray`, so the door gets shut permanently.
    const foreign = manualInit() as unknown as BoardState;
    const { ctx } = makeRoundContext(play(), jeopardyRound, 1_700_000_000_000);
    const config = jeopardyRound.config as never;

    const recovered = boardRoundType.reduce(foreign, { type: 'OPEN', category: 0, clue: 0 }, config, ctx);
    expect(recovered.open).toBe('0:0');
    expect(boardRoundType.projectHost(foreign, config, ctx).extra?.remaining).toBe(4);
    expect(boardRoundType.projectDisplay(foreign, config, ctx).itemCount).toBe(4);
  });

  it('will not score for an entrant the round has locked out', () => {
    // `restrictTo` is enforced by `canScore`, borrowed from `manual` — a board
    // round is not exempt from a round scoped to half the room.
    const restricted: GameContent = {
      ...content,
      rounds: [{ ...jeopardyRound, restrictTo: ['lucy'] }, content.rounds[1]],
    };
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'jeopardy' },
        ...board(
          { type: 'OPEN', category: 0, clue: 1 },
          { type: 'AWARD', entrantId: 'swans' },
          { type: 'AWARD', entrantId: 'lucy' },
        ),
      ),
      restricted,
    );
    expect(state.entrants.find((e) => e.id === 'swans')?.score).toBe(0);
    expect(state.entrants.find((e) => e.id === 'lucy')?.score).toBe(400);
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

  it('keeps the daily double out of the grid mid-round, which is when the room is looking', () => {
    // The grid-up payload is the easy case and the one the room sees least of.
    // Squares go, a square is open, a stake is set — the grid itself must still
    // give nothing away, so these assert on `categories` rather than the whole
    // payload (an open square's stake is deliberately public).
    const played = play(
      { type: 'OPEN', category: 0, clue: 0 },
      { type: 'CLOSE' },
      { type: 'OPEN', category: 1, clue: 0 },
      { type: 'CLOSE' },
    );
    expect(JSON.stringify(displayExtra(played).categories)).not.toContain('wager');
    expect(displayExtra(played).categories[0].clues[0].consumed).toBe(true);

    const wagered = play({ type: 'OPEN', category: 0, clue: 2 }, { type: 'SET_WAGER', points: 1500 });
    const grid = JSON.stringify(displayExtra(wagered).categories);
    expect(grid).not.toContain('wager');
    // The stake would mark the square as surely as the flag does, so it must
    // not appear against the grid square either — only against the open one.
    expect(grid).not.toContain('1500');
    expect(displayExtra(wagered).open).toMatchObject({ value: 1500 });
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
