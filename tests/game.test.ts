import { describe, expect, it } from 'vitest';
import type { GameEvent, GameEventInput } from '../shared/events.js';
import type { GameContent } from '../server/content.js';
import { replay } from '../server/game/state.js';
import { projectDisplay, projectHost, sanitizeDisplayView } from '../server/game/projection.js';
import { getRoundType } from '../server/roundTypes/index.js';

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
          { prompt: 'And this one?', answer: 'Jennifer', points: 3 },
        ],
      },
    },
    {
      id: 'kids',
      type: 'manual',
      title: 'Just For Lucy',
      restrictTo: ['lucy'],
      defaultPoints: 1,
      config: { items: [{ prompt: 'How many grandchildren?', answer: 'Three' }] },
    },
    {
      id: 'quiz',
      type: 'multipleChoice',
      title: 'Trivia',
      defaultPoints: 2,
      config: {
        items: [{ prompt: 'Where did they meet?', options: ['Bus', 'Lab'], correct: 'B', answer: '1983' }],
      },
    },
    {
      id: 'faces',
      type: 'manual',
      title: 'Who Is This?',
      defaultPoints: 1,
      // The picture *is* the question: no answer text, nothing left to reveal.
      config: { items: [{ prompt: 'Who is this?', media: { image: 'photos/1938.jpg' } }] },
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

/** Stamps `at`/`seq` the way Session.append does, so tests read like a log. */
function log(...inputs: GameEventInput[]): GameEvent[] {
  return inputs.map((input, i) => ({ ...input, at: 1_700_000_000_000 + i, seq: i + 1 }) as GameEvent);
}

const twoPlayers: GameEventInput[] = [
  { type: 'SESSION_START', sessionId: 's1', gameTitle: 'Test Game' },
  { type: 'ENTRANT_ADD', entrant: { id: 'lucy', displayName: 'Lucy' } },
  { type: 'ENTRANT_ADD', entrant: { id: 'swans', displayName: 'Team Swan' } },
];

describe('scoring', () => {
  it('awards the round default and the per-item override', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'photos' },
        { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'lucy' } },
        { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'NEXT' } },
        { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'lucy' } },
      ),
      content,
    );
    expect(state.entrants.find((e) => e.id === 'lucy')?.score).toBe(4);
  });

  it('deducts on a negative award', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'photos' },
        { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'swans', points: -2 } },
      ),
      content,
    );
    expect(state.entrants.find((e) => e.id === 'swans')?.score).toBe(-2);
  });

  it('refuses to score an entrant outside restrictTo', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'kids' },
        { type: 'ROUND_EVENT', roundId: 'kids', event: { type: 'AWARD', entrantId: 'swans' } },
        { type: 'ROUND_EVENT', roundId: 'kids', event: { type: 'AWARD', entrantId: 'lucy' } },
      ),
      content,
    );
    expect(state.entrants.find((e) => e.id === 'swans')?.score).toBe(0);
    expect(state.entrants.find((e) => e.id === 'lucy')?.score).toBe(1);
  });

  it('lets the host set a score by hand, whatever the round says', () => {
    const state = replay(
      log(...twoPlayers, { type: 'SET_SCORE', entrantId: 'swans', score: 17 }),
      content,
    );
    expect(state.entrants.find((e) => e.id === 'swans')?.score).toBe(17);
  });

  it('is a pure reduction: replaying a truncated log is exactly undo', () => {
    const full = log(
      ...twoPlayers,
      { type: 'ROUND_SELECT', roundId: 'photos' },
      { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'lucy' } },
      { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'swans' } },
    );
    const after = replay(full, content);
    const undone = replay(full.slice(0, -1), content);

    expect(after.entrants.find((e) => e.id === 'swans')?.score).toBe(1);
    expect(undone.entrants.find((e) => e.id === 'swans')?.score).toBe(0);
    expect(undone.entrants.find((e) => e.id === 'lucy')?.score).toBe(1);
    // Replaying twice must give the same answer, or crash recovery is a lie.
    expect(replay(full, content)).toEqual(after);
  });
});

describe('the display projection boundary', () => {
  it('withholds the answer until the host reveals it', () => {
    const before = replay(log(...twoPlayers, { type: 'ROUND_SELECT', roundId: 'photos' }), content);
    const hidden = projectDisplay(before, content);

    expect(hidden.round?.prompt).toBe('Whose baby photo?');
    // Not merely absent from the view — absent from the payload, so it is never
    // in the DOM for someone to find.
    expect(JSON.stringify(hidden)).not.toContain('David');
    expect('answer' in (hidden.round ?? {})).toBe(false);

    const after = replay(
      log(...twoPlayers, { type: 'ROUND_SELECT', roundId: 'photos' }, {
        type: 'ROUND_EVENT',
        roundId: 'photos',
        event: { type: 'REVEAL' },
      }),
      content,
    );
    expect(projectDisplay(after, content).round?.answer).toBe('David');
  });

  it('withholds a round type’s declared secrets too', () => {
    const state = replay(log(...twoPlayers, { type: 'ROUND_SELECT', roundId: 'quiz' }), content);
    const display = projectDisplay(state, content);

    expect((display.round?.extra as { options: unknown[] }).options).toHaveLength(2);
    expect((display.round?.extra as { correctLabel?: string }).correctLabel).toBeUndefined();
    expect(JSON.stringify(display)).not.toContain('1983');
  });

  it('strips secrets even from a round type that leaks them', () => {
    const leaky = {
      id: 'leaky',
      configSchema: {} as never,
      init: () => ({}),
      reduce: (s: unknown) => s,
      projectHost: () => ({}) as never,
      projectDisplay: () => ({}) as never,
      displaySecrets: ['correctLabel'],
    };
    const sanitized = sanitizeDisplayView(
      {
        kind: 'leaky',
        prompt: 'p',
        answer: 'THE ANSWER',
        itemIndex: 0,
        itemCount: 1,
        revealed: false,
        extra: { correctLabel: 'B', options: ['a', 'b'] },
      },
      leaky as never,
    );
    expect(JSON.stringify(sanitized)).not.toContain('THE ANSWER');
    expect(JSON.stringify(sanitized)).not.toContain('"B"');
    expect((sanitized.extra as { options: unknown[] }).options).toHaveLength(2);
  });

  it('offers no Reveal button when the picture is all there is to show', () => {
    const state = replay(log(...twoPlayers, { type: 'ROUND_SELECT', roundId: 'faces' }), content);

    // The photo is on the TV from the moment the item appears — sanitizing only
    // reaches `answer` and declared `extra` secrets — so a Reveal button here
    // would be a button that changes nothing in the room.
    expect(projectDisplay(state, content).round?.media?.image).toBe('/content/photos/1938.jpg');
    expect(projectHost(state, content, env).round?.can.reveal).toBe(false);
    expect(projectHost(state, content, env).round?.can.award).toBe(true);
  });

  it('gives the host the answer immediately, revealed or not', () => {
    const state = replay(log(...twoPlayers, { type: 'ROUND_SELECT', roundId: 'photos' }), content);
    expect(projectHost(state, content, env).round?.answer).toBe('David');
  });
});

describe('round state', () => {
  it('keeps each round’s position independently', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'photos' },
        { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'NEXT' } },
        { type: 'ROUND_SELECT', roundId: 'kids' },
        { type: 'ROUND_SELECT', roundId: 'photos' },
      ),
      content,
    );
    expect(projectHost(state, content, env).round?.itemIndex).toBe(1);
  });

  it('does not run off the end of a round', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'photos' },
        ...Array.from({ length: 6 }, () => ({
          type: 'ROUND_EVENT' as const,
          roundId: 'photos',
          event: { type: 'NEXT' },
        })),
      ),
      content,
    );
    expect(projectHost(state, content, env).round?.itemIndex).toBe(1);
  });

  it('hides the answer again when moving to the next item', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'photos' },
        { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'REVEAL' } },
        { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'NEXT' } },
      ),
      content,
    );
    expect(projectDisplay(state, content).round?.revealed).toBe(false);
  });

  it('ignores events for a round that is not in the content file', () => {
    const state = replay(
      log(...twoPlayers, { type: 'ROUND_EVENT', roundId: 'nope', event: { type: 'AWARD', entrantId: 'lucy' } }),
      content,
    );
    expect(state.entrants.find((e) => e.id === 'lucy')?.score).toBe(0);
  });
});

describe('multipleChoice', () => {
  it('accepts a Phase 3 PLAYER_SUBMIT without scoring anything', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'ROUND_SELECT', roundId: 'quiz' },
        { type: 'ROUND_EVENT', roundId: 'quiz', event: { type: 'PLAYER_SUBMIT', entrantId: 'lucy', choice: 'B' } },
      ),
      content,
    );
    expect(state.entrants.find((e) => e.id === 'lucy')?.score).toBe(0);

    const roundType = getRoundType('multipleChoice')!;
    const view = roundType.projectPlayer!(state.roundStates.quiz as never, content.rounds[2].config as never, 'lucy', {
      entrants: state.entrants,
      restrictTo: null,
      defaultPoints: 2,
      now: 0,
      awardPoints: () => {},
      assets: { resolve: () => undefined },
      timer: { start: () => ({ endsAt: 0, durationMs: 0, running: false }), stop: () => undefined, clear: () => undefined },
    });
    expect(view.submitted).toBe('B');
  });
});

describe('entrants', () => {
  it('drops a sat-out entrant from the board but keeps the score', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'AWARD_POINTS', entrantId: 'swans', points: 3 },
        { type: 'ENTRANT_UPDATE', entrantId: 'swans', patch: { active: false } },
      ),
      content,
    );
    expect(projectDisplay(state, content).leaderboard.map((r) => r.id)).toEqual(['lucy']);
    expect(state.entrants.find((e) => e.id === 'swans')?.score).toBe(3);
  });

  it('gives every entrant a face, even one created in a hurry', () => {
    const state = replay(log(...twoPlayers), content);
    expect(state.entrants.every((e) => e.avatar.length > 0)).toBe(true);
    expect(state.entrants.find((e) => e.id === 'lucy')?.avatar).toBe('initial:L');
  });

  it('sorts the leaderboard by score', () => {
    const state = replay(
      log(...twoPlayers, { type: 'AWARD_POINTS', entrantId: 'swans', points: 5 }),
      content,
    );
    const board = projectDisplay(state, content).leaderboard;
    expect(board.map((r) => r.id)).toEqual(['swans', 'lucy']);
    expect(board[0].delta).toBe(5);
  });

  it('stops flashing a score change on the next tap, even one that does nothing', () => {
    const events = log(
      ...twoPlayers,
      { type: 'ROUND_SELECT', roundId: 'photos' },
      { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'NEXT' } },
      { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'AWARD', entrantId: 'lucy' } },
      // Already on the last item, so this changes nothing else in the state.
      { type: 'ROUND_EVENT', roundId: 'photos', event: { type: 'NEXT' } },
    );
    const rowFor = (n: number) =>
      projectDisplay(replay(events.slice(0, n), content), content).leaderboard.find((r) => r.id === 'lucy');

    expect(rowFor(events.length - 1)?.delta).toBe(3);
    // A dead key press still ends the flash; otherwise +3 sits on the TV for the
    // rest of the party.
    expect(rowFor(events.length)?.delta).toBeUndefined();
    expect(rowFor(events.length)?.score).toBe(3);
  });

  it('ignores a score smuggled into an entrant patch', () => {
    const state = replay(
      log(
        ...twoPlayers,
        { type: 'AWARD_POINTS', entrantId: 'lucy', points: 2 },
        // A host client can send anything; only the four editable fields and
        // `active` may land, because points move through the award path alone.
        {
          type: 'ENTRANT_UPDATE',
          entrantId: 'lucy',
          patch: { displayName: 'Lucy B', members: [], score: 99, id: 'swans' },
        } as GameEventInput,
      ),
      content,
    );
    const lucy = state.entrants.find((e) => e.id === 'lucy');
    expect(lucy?.score).toBe(2);
    expect(lucy?.displayName).toBe('Lucy B');
    // An empty members list is the host UI saying nothing about the roster.
    expect(lucy?.members).toEqual([{ name: 'Lucy' }]);
    expect(state.entrants.map((e) => e.id)).toEqual(['lucy', 'swans']);
  });
});
