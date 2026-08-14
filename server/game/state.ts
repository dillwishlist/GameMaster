/**
 * Core state and reduction. Pure: same log + same content ⇒ same state, every
 * time. Nothing in this file may read the clock, the filesystem, or a random
 * number — that property is what makes undo, crash recovery and replay work.
 */

import type { Entrant, EntrantId, GamePhase, RoundId } from '../../shared/types.js';
import type { GameEvent } from '../../shared/events.js';
import type { GameContent } from '../content.js';
import { getRoundType } from '../roundTypes/index.js';
import { makeRoundContext } from './roundContext.js';

export interface GameState {
  sessionId: string;
  gameTitle: string;
  phase: GamePhase;
  entrants: Entrant[];
  currentRoundId: RoundId | null;
  /** roundId → the round type's own state blob. */
  roundStates: Record<RoundId, unknown>;
  /** For the display's score-change flash. Keyed by entrant. */
  lastDelta: Record<EntrantId, { points: number; seq: number }>;
  /** Sequence number of the last event applied. */
  seq: number;
}

export const PALETTE = [
  '#e6402f',
  '#2f7de6',
  '#22a06b',
  '#e0961f',
  '#8b5cf6',
  '#e0479e',
  '#0d9aa6',
  '#b45309',
  '#4f46e5',
  '#65a30d',
];

export function emptyState(): GameState {
  return {
    sessionId: '',
    gameTitle: '',
    phase: 'lobby',
    entrants: [],
    currentRoundId: null,
    roundStates: {},
    lastDelta: {},
    seq: 0,
  };
}

export function replay(events: GameEvent[], content: GameContent): GameState {
  return events.reduce((state, event) => reduce(state, event, content), emptyState());
}

export function reduce(state: GameState, event: GameEvent, content: GameContent): GameState {
  const next = applyEvent(state, event, content);
  return next === state ? state : { ...next, seq: event.seq };
}

function applyEvent(state: GameState, event: GameEvent, content: GameContent): GameState {
  switch (event.type) {
    case 'SESSION_START':
      return { ...state, sessionId: event.sessionId, gameTitle: event.gameTitle };

    case 'ENTRANT_ADD': {
      if (state.entrants.some((e) => e.id === event.entrant.id)) return state;
      const seed = event.entrant;
      const entrant: Entrant = {
        id: seed.id,
        displayName: seed.displayName,
        members: seed.members?.length ? seed.members : [{ name: seed.displayName }],
        avatar: seed.avatar ?? initialAvatar(seed.displayName),
        color: seed.color ?? PALETTE[state.entrants.length % PALETTE.length],
        score: 0,
        active: true,
      };
      return { ...state, entrants: [...state.entrants, entrant] };
    }

    case 'ENTRANT_UPDATE':
      return mapEntrant(state, event.entrantId, (e) => ({
        ...e,
        ...event.patch,
        members: event.patch.members?.length ? event.patch.members : e.members,
      }));

    case 'ENTRANT_REMOVE':
      return { ...state, entrants: state.entrants.filter((e) => e.id !== event.entrantId) };

    case 'AWARD_POINTS':
      return award(state, event.entrantId, event.points, event.seq);

    case 'SET_SCORE': {
      const current = state.entrants.find((e) => e.id === event.entrantId);
      if (!current) return state;
      return award(state, event.entrantId, event.score - current.score, event.seq);
    }

    case 'SET_PHASE':
      return { ...state, phase: event.phase };

    case 'ROUND_SELECT': {
      if (event.roundId === null) return { ...state, currentRoundId: null, phase: 'scores' };
      const round = content.rounds.find((r) => r.id === event.roundId);
      if (!round) return state;
      const roundType = getRoundType(round.type);
      if (!roundType) return state;

      const withState =
        state.roundStates[round.id] === undefined
          ? {
              ...state.roundStates,
              [round.id]: roundType.init(round.config as never, makeRoundContext(state, round, event.at).ctx),
            }
          : state.roundStates;

      return { ...state, currentRoundId: round.id, phase: 'playing', roundStates: withState };
    }

    case 'ROUND_EVENT': {
      const round = content.rounds.find((r) => r.id === event.roundId);
      if (!round) return state;
      const roundType = getRoundType(round.type);
      if (!roundType) return state;

      const { ctx, drainAwards } = makeRoundContext(state, round, event.at);
      const before = state.roundStates[round.id] ?? roundType.init(round.config as never, ctx);
      const after = roundType.reduce(before as never, event.event, round.config as never, ctx);

      let next: GameState = { ...state, roundStates: { ...state.roundStates, [round.id]: after } };
      for (const a of drainAwards()) next = award(next, a.entrantId, a.points, event.seq);
      return next;
    }

    default:
      return state;
  }
}

function award(state: GameState, entrantId: EntrantId, points: number, seq: number): GameState {
  if (!points || !state.entrants.some((e) => e.id === entrantId)) return state;
  return {
    ...mapEntrant(state, entrantId, (e) => ({ ...e, score: e.score + points })),
    lastDelta: { ...state.lastDelta, [entrantId]: { points, seq } },
  };
}

function mapEntrant(state: GameState, id: EntrantId, fn: (e: Entrant) => Entrant): GameState {
  if (!state.entrants.some((e) => e.id === id)) return state;
  return { ...state, entrants: state.entrants.map((e) => (e.id === id ? fn(e) : e)) };
}

/**
 * The fallback avatar. Rendered client-side as a coloured disc with a letter,
 * so an entrant created in a hurry still has a face-shaped thing to tap.
 */
export function initialAvatar(displayName: string): string {
  const letter = [...displayName.trim()][0]?.toUpperCase() ?? '?';
  return `initial:${letter}`;
}
