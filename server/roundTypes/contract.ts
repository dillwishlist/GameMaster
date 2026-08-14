/**
 * The round type plugin contract.
 *
 * Keep this surface small. This is the extensibility story, and a fat interface
 * makes every new round type expensive. If you are tempted to add a method,
 * check first whether the round can be expressed as `manual` plus content —
 * most party games can.
 */

import type { ZodType } from 'zod';
import type {
  DisplayRoundView,
  Entrant,
  EntrantId,
  HostRoundView,
  PlayerRoundView,
  TimerView,
} from '../../shared/types.js';
import type { RoundEvent } from '../../shared/events.js';

export interface RoundContext {
  /** Active entrants, in display order. */
  entrants: Entrant[];
  /** Entrant ids allowed to score in this round. Null = everyone. */
  restrictTo: EntrantId[] | null;
  /** The round's `defaultPoints`, already defaulted to 1. */
  defaultPoints: number;

  /**
   * The only way a round type may move a score. Calls are collected during
   * `reduce` and applied by the core reducer, so scoring stays in one place
   * and stays undoable. Calling this outside `reduce` does nothing.
   */
  awardPoints(entrantId: EntrantId, points: number, reason?: string): void;

  assets: {
    /** Turn a content-relative ref into a URL the clients can fetch. */
    resolve(ref: string | undefined): string | undefined;
  };

  /**
   * Timers are derived from event timestamps, never from the wall clock, so a
   * replayed log produces the same timer state it did live.
   */
  timer: {
    start(durationMs: number): TimerView;
    stop(timer: TimerView | undefined): TimerView | undefined;
    clear(): undefined;
  };

  /** The timestamp of the event being reduced. Never call Date.now() in reduce. */
  now: number;
}

export interface RoundType<Config = unknown, State = unknown> {
  id: string;
  configSchema: ZodType<Config>;
  init(config: Config, ctx: RoundContext): State;
  reduce(state: State, event: RoundEvent, config: Config, ctx: RoundContext): State;
  projectHost(state: State, config: Config, ctx: RoundContext): HostRoundView;
  projectDisplay(state: State, config: Config, ctx: RoundContext): DisplayRoundView;
  /** Phase 3 seam. Nothing calls this yet. */
  projectPlayer?(state: State, config: Config, entrantId: EntrantId, ctx: RoundContext): PlayerRoundView;
  /**
   * Keys under `DisplayRoundView.extra` that must be withheld until the item is
   * revealed. `answer` is always withheld and does not need listing.
   */
  displaySecrets?: string[];
}

/** Helper so round type modules keep their generics without restating them. */
export function defineRoundType<Config, State>(rt: RoundType<Config, State>): RoundType<Config, State> {
  return rt;
}
