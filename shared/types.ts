/**
 * Types shared by the server and all three client views.
 *
 * Nothing in here may import from `server/` or `client/` — this module is the
 * contract between them.
 */

export type EntrantId = string;
export type RoundId = string;

/** A reference to a file under ./content. Always a server-relative URL path. */
export type AssetRef = string;

export interface Member {
  name: string;
  avatar?: AssetRef;
  /** Set only if this member joined from a phone. Phase 3. */
  deviceId?: string;
}

export interface Entrant {
  id: EntrantId;
  displayName: string;
  /** 1 = individual, 2 = pair, n = team. */
  members: Member[];
  /** Photo, drawing, or a generated initial. Never empty — see `initialAvatar`. */
  avatar: AssetRef;
  color: string;
  score: number;
  /** False for mid-game drop-outs: kept in the log, hidden from play. */
  active: boolean;
}

export interface MediaRef {
  image?: AssetRef;
  audio?: AssetRef;
}

export interface Round {
  id: RoundId;
  /** Round type plugin id. */
  type: string;
  title: string;
  /** Validated by the plugin's `configSchema`. */
  config: unknown;
  /** Scope a round to a subset of entrants. */
  restrictTo?: EntrantId[];
  defaultPoints?: number;
}

export type GamePhase = 'lobby' | 'playing' | 'scores';

/* -------------------------------------------------------------------------- */
/* Round views                                                                */
/* -------------------------------------------------------------------------- */

/**
 * What the host sees for the current round. Includes answers.
 */
export interface HostRoundView {
  kind: string;
  /** Rendered above the tiles, big enough to read aloud at arm's length. */
  prompt: string;
  /** The answer, always present for the host. */
  answer?: string;
  media?: MediaRef;
  itemIndex: number;
  itemCount: number;
  revealed: boolean;
  /** Round-type specific extras (options, board grid, ...). */
  extra?: Record<string, unknown>;
  /** Transport affordances the round type supports right now. */
  can: {
    prev: boolean;
    next: boolean;
    reveal: boolean;
    award: boolean;
  };
  timer?: TimerView;
}

/**
 * What the room sees. MUST NOT contain an unrevealed answer — see
 * `sanitizeDisplayView` in server/game/projection.ts, which is the enforcement
 * point. Do not rely on the view to hide things.
 */
export interface DisplayRoundView {
  kind: string;
  prompt: string;
  /** Present only once `revealed` is true. */
  answer?: string;
  media?: MediaRef;
  itemIndex: number;
  itemCount: number;
  revealed: boolean;
  extra?: Record<string, unknown>;
  timer?: TimerView;
}

/** Phase 3 seam. Nothing emits or consumes this yet. */
export interface PlayerRoundView {
  kind: string;
  prompt: string;
  submitted?: string;
  options?: { label: string; text: string }[];
  locked: boolean;
}

export interface TimerView {
  /** Epoch ms the timer expires at, taken from the event timestamp. */
  endsAt: number;
  durationMs: number;
  running: boolean;
}

/* -------------------------------------------------------------------------- */
/* Projections pushed to clients                                              */
/* -------------------------------------------------------------------------- */

export interface RoundSummary {
  id: RoundId;
  type: string;
  title: string;
  /** True when this round type could not be loaded — host sees why. */
  error?: string;
}

export interface HostState {
  sessionId: string;
  gameTitle: string;
  phase: GamePhase;
  entrants: Entrant[];
  rounds: RoundSummary[];
  currentRoundId: RoundId | null;
  /** Entrants allowed to score in the current round. Null = everyone. */
  restrictTo: EntrantId[] | null;
  defaultPoints: number;
  round: HostRoundView | null;
  canUndo: boolean;
  canRedo: boolean;
  /** Avatar files found under ./content/avatars, for the onboarding picker. */
  avatarChoices: AssetRef[];
  contentError: string | null;
  displaysConnected: number;
}

export interface DisplayState {
  gameTitle: string;
  phase: GamePhase;
  /** Ordered by score, descending. */
  leaderboard: LeaderboardRow[];
  roundTitle: string | null;
  round: DisplayRoundView | null;
}

export interface LeaderboardRow {
  id: EntrantId;
  displayName: string;
  avatar: AssetRef;
  color: string;
  score: number;
  /** Set for a beat after the score changes, so the view can flash it. */
  delta?: number;
  /** True when this entrant is out of scope for the current round. */
  dimmed?: boolean;
}

export interface PlayerState {
  gameTitle: string;
  entrantId: EntrantId | null;
  displayName: string | null;
  score: number;
  round: PlayerRoundView | null;
}
