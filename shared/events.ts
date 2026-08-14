/**
 * The event log. Everything that happens in a session is one of these,
 * appended in order. Current state is a pure reduction over the log, which is
 * what buys undo, crash recovery and after-the-fact replay.
 *
 * Two rules keep that property true:
 *   1. No event may carry a value the reducer cannot recompute — put the
 *      timestamp in the event, never read the clock inside a reducer.
 *   2. Round types never mutate score. They call `ctx.awardPoints`, which is
 *      collected and applied by the core reducer, so every point movement is
 *      one code path and every point movement is undoable.
 */

import type { AssetRef, EntrantId, GamePhase, Member, RoundId } from './types.js';

export interface EntrantSeed {
  id: EntrantId;
  displayName: string;
  members?: Member[];
  avatar?: AssetRef;
  color?: string;
}

/** Round-type-specific event. The plugin's `reduce` interprets `type`. */
export interface RoundEvent {
  type: string;
  [key: string]: unknown;
}

interface Base {
  /** Epoch ms, stamped once on append and never recomputed. */
  at: number;
  /** Monotonic within a session, starting at 1. */
  seq: number;
}

export type GameEvent = Base &
  (
    | { type: 'SESSION_START'; sessionId: string; gameTitle: string }
    | { type: 'ENTRANT_ADD'; entrant: EntrantSeed }
    | {
        type: 'ENTRANT_UPDATE';
        entrantId: EntrantId;
        patch: Partial<Pick<EntrantSeed, 'displayName' | 'avatar' | 'color' | 'members'>> & {
          active?: boolean;
        };
      }
    | { type: 'ENTRANT_REMOVE'; entrantId: EntrantId }
    | { type: 'AWARD_POINTS'; entrantId: EntrantId; points: number; reason?: string }
    | { type: 'SET_SCORE'; entrantId: EntrantId; score: number }
    | { type: 'ROUND_SELECT'; roundId: RoundId | null }
    | { type: 'ROUND_EVENT'; roundId: RoundId; event: RoundEvent }
    | { type: 'SET_PHASE'; phase: GamePhase }
  );

export type GameEventInput = DistributiveOmit<GameEvent, 'at' | 'seq'>;

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/* -------------------------------------------------------------------------- */
/* Socket protocol                                                            */
/* -------------------------------------------------------------------------- */

export type ClientRole = 'host' | 'display' | 'player';

/** Commands a client may send. Only `host` may send anything but `hello`. */
export interface ClientCommands {
  hello: (payload: { role: ClientRole; passphrase?: string }, ack: (res: HelloResult) => void) => void;
  dispatch: (event: GameEventInput, ack?: (res: CommandResult) => void) => void;
  undo: (ack?: (res: CommandResult) => void) => void;
  redo: (ack?: (res: CommandResult) => void) => void;
  /** Wipe the session and start a fresh log. Host confirms in the UI first. */
  resetSession: (ack?: (res: CommandResult) => void) => void;
}

export interface HelloResult {
  ok: boolean;
  error?: string;
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}
