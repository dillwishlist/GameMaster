/**
 * Builds the `RoundContext` handed to a round type.
 *
 * `awardPoints` collects into a buffer rather than touching state directly, and
 * the core reducer drains it. That indirection is the whole reason scoring is
 * in exactly one place and every point is undoable.
 */

import type { EntrantId, Round, TimerView } from '../../shared/types.js';
import type { RoundContext } from '../roundTypes/contract.js';
import type { GameState } from './state.js';

export interface CollectedAward {
  entrantId: EntrantId;
  points: number;
  reason?: string;
}

export function makeRoundContext(
  state: GameState,
  round: Round,
  now: number,
): { ctx: RoundContext; drainAwards: () => CollectedAward[] } {
  let awards: CollectedAward[] = [];

  const ctx: RoundContext = {
    entrants: state.entrants.filter((e) => e.active),
    restrictTo: round.restrictTo ?? null,
    defaultPoints: round.defaultPoints ?? 1,
    now,

    awardPoints(entrantId, points, reason) {
      if (!Number.isFinite(points) || points === 0) return;
      awards.push({ entrantId, points, reason });
    },

    assets: { resolve: resolveAsset },

    timer: {
      start: (durationMs): TimerView => ({ endsAt: now + durationMs, durationMs, running: true }),
      stop: (timer) => (timer ? { ...timer, running: false, endsAt: Math.max(timer.endsAt, now) } : undefined),
      clear: () => undefined,
    },
  };

  return {
    ctx,
    drainAwards: () => {
      const drained = awards;
      awards = [];
      return drained;
    },
  };
}

/**
 * Content-relative refs become URLs under /content, which the server serves
 * read-only from the content directory. Absolute paths and full URLs pass
 * through untouched so an asset can live anywhere if it has to.
 */
export function resolveAsset(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('/')) return ref;
  return `/content/${ref.replace(/^\.\//, '')}`;
}
