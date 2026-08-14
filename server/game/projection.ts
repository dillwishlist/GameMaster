/**
 * Projections. Three consumers, three views of the same state.
 *
 * The important one is `projectDisplay`. An unrevealed answer must never leave
 * the server for the display client — if it does, it is in the DOM and someone
 * in the room will find it. `sanitizeDisplayView` below is the enforcement
 * point, and it runs on every display projection regardless of what the round
 * type returned. Round types are not trusted to hide their own answers.
 */

import type {
  DisplayRoundView,
  DisplayState,
  Entrant,
  EntrantId,
  HostState,
  LeaderboardRow,
  PlayerState,
  Round,
} from '../../shared/types.js';
import type { GameContent } from '../content.js';
import { getRoundType, type RoundType } from '../roundTypes/index.js';
import { makeRoundContext } from './roundContext.js';
import type { GameState } from './state.js';

export interface ProjectionEnv {
  canUndo: boolean;
  canRedo: boolean;
  avatarChoices: string[];
  contentError: string | null;
  displaysConnected: number;
}

function currentRound(state: GameState, content: GameContent): Round | null {
  if (!state.currentRoundId) return null;
  return content.rounds.find((r) => r.id === state.currentRoundId) ?? null;
}

export function projectHost(state: GameState, content: GameContent, env: ProjectionEnv): HostState {
  const round = currentRound(state, content);
  const roundType = round ? getRoundType(round.type) : undefined;

  let view = null;
  if (round && roundType) {
    const { ctx } = makeRoundContext(state, round, Date.now());
    const roundState = state.roundStates[round.id] ?? roundType.init(round.config as never, ctx);
    view = roundType.projectHost(roundState as never, round.config as never, ctx);
  }

  return {
    sessionId: state.sessionId,
    gameTitle: state.gameTitle || content.title,
    phase: state.phase,
    entrants: state.entrants,
    rounds: content.rounds.map((r) => ({ id: r.id, type: r.type, title: r.title })).concat(
      Object.entries(content.brokenRounds).map(([id, error]) => ({ id, type: '?', title: id, error })),
    ),
    currentRoundId: state.currentRoundId,
    restrictTo: round?.restrictTo ?? null,
    defaultPoints: round?.defaultPoints ?? 1,
    round: view,
    canUndo: env.canUndo,
    canRedo: env.canRedo,
    avatarChoices: env.avatarChoices,
    contentError: env.contentError,
    displaysConnected: env.displaysConnected,
  };
}

export function projectDisplay(state: GameState, content: GameContent): DisplayState {
  const round = currentRound(state, content);
  const roundType = round ? getRoundType(round.type) : undefined;

  let view: DisplayRoundView | null = null;
  if (round && roundType) {
    const { ctx } = makeRoundContext(state, round, Date.now());
    const roundState = state.roundStates[round.id] ?? roundType.init(round.config as never, ctx);
    view = sanitizeDisplayView(roundType.projectDisplay(roundState as never, round.config as never, ctx), roundType);
  }

  return {
    gameTitle: state.gameTitle || content.title,
    phase: state.phase,
    leaderboard: leaderboard(state, round),
    roundTitle: round?.title ?? null,
    round: view,
  };
}

export function projectPlayer(state: GameState, content: GameContent, entrantId: EntrantId | null): PlayerState {
  const entrant = state.entrants.find((e) => e.id === entrantId) ?? null;
  const round = currentRound(state, content);
  const roundType = round ? getRoundType(round.type) : undefined;

  let view = null;
  if (round && roundType?.projectPlayer && entrant) {
    const { ctx } = makeRoundContext(state, round, Date.now());
    const roundState = state.roundStates[round.id] ?? roundType.init(round.config as never, ctx);
    view = roundType.projectPlayer(roundState as never, round.config as never, entrant.id, ctx);
  }

  return {
    gameTitle: state.gameTitle || content.title,
    entrantId: entrant?.id ?? null,
    displayName: entrant?.displayName ?? null,
    score: entrant?.score ?? 0,
    round: view,
  };
}

/**
 * Strip anything the room must not see yet. Always runs — a round type that
 * forgets to withhold its answer is a bug that stops here rather than on the TV.
 *
 * It reaches exactly two places, and a round type author must put every secret
 * in one of them:
 *   1. the top-level `answer` field;
 *   2. top-level keys of `extra` named in the round type's `displaySecrets`.
 * Nothing else is touched. `media` ships to the TV as soon as the item appears,
 * so a picture can be the question but never the answer, and the `delete` in the
 * loop below is shallow — a secret nested inside an `extra` sub-object goes
 * straight to the screen. Hoist it to a top-level `extra` key instead.
 */
export function sanitizeDisplayView(view: DisplayRoundView, roundType: RoundType<any, any>): DisplayRoundView {
  if (view.revealed) return view;

  const { answer: _withheld, extra, ...rest } = view;
  let safeExtra = extra;
  if (extra && roundType.displaySecrets?.length) {
    safeExtra = { ...extra };
    for (const key of roundType.displaySecrets) delete safeExtra[key];
  }
  return safeExtra === undefined ? rest : { ...rest, extra: safeExtra };
}

function leaderboard(state: GameState, round: Round | null): LeaderboardRow[] {
  const restrictTo = round?.restrictTo ?? null;
  return state.entrants
    .filter((e) => e.active)
    .map((e: Entrant): LeaderboardRow => {
      return {
        id: e.id,
        displayName: e.displayName,
        avatar: e.avatar,
        color: e.color,
        score: e.score,
        // `reduce` clears lastDelta at the start of every event, so whatever is
        // in here belongs to the event just applied and to no other.
        delta: state.lastDelta[e.id],
        dimmed: restrictTo ? !restrictTo.includes(e.id) : false,
      };
    })
    .sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));
}
