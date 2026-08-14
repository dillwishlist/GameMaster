/**
 * The shapes the editor speaks over the wire.
 *
 * Deliberately a hand-written mirror of `server/editor/contentDoc.ts` rather
 * than an import: the client bundle must not reach into the server tree, where
 * that file pulls in `node:fs` and `node:crypto`. These nine operations are the
 * whole API — if the server's union grows, this one follows it by hand.
 */

/** A single edit. The client sends a list; the server applies them in order. */
export type EditOp =
  | { op: 'setTitle'; value: string }
  | { op: 'setRoundField'; roundId: string; field: string; value: unknown }
  | { op: 'addRound'; index: number; round: Record<string, unknown> }
  | { op: 'removeRound'; roundId: string }
  | { op: 'moveRound'; roundId: string; toIndex: number }
  | { op: 'setItemField'; roundId: string; index: number; path: string[]; value: unknown }
  | { op: 'addItem'; roundId: string; index: number; item: Record<string, unknown> }
  | { op: 'removeItem'; roundId: string; index: number }
  | { op: 'moveItem'; roundId: string; from: number; to: number };

export interface EntrantSeed {
  id: string;
  displayName: string;
  avatar?: string;
  color?: string;
}

export interface MediaRef {
  image?: string;
  audio?: string;
}

/** One question in a `manual` or `multipleChoice` round. */
export interface EditItem {
  prompt?: string;
  answer?: string;
  note?: string;
  points?: number;
  media?: MediaRef;
  /** `multipleChoice` only. */
  options?: string[];
  /** `multipleChoice` only: the letter of the right option. */
  correct?: string;
  [key: string]: unknown;
}

export interface BoardClue {
  value?: number;
  prompt?: string;
  answer?: string;
  note?: string;
  wager?: boolean;
  media?: MediaRef;
  [key: string]: unknown;
}

export interface BoardCategory {
  name?: string;
  clues?: BoardClue[];
  [key: string]: unknown;
}

/**
 * A round as the editor sees it. `config` is whatever the round type's schema
 * accepted — `items` for the two linear types, `categories` for a board — and
 * is handed over untouched so the forms here stay the only thing that knows the
 * per-type field names.
 */
export interface EditRound {
  id: string;
  type: string;
  title: string;
  restrictTo: string[] | null;
  defaultPoints: number | null;
  config: Record<string, unknown>;
  /** True when this round is the one on the TV right now. */
  inPlay: boolean;
}

export interface ContentModel {
  hash: string;
  file: string;
  title: string;
  entrants: EntrantSeed[];
  roundTypes: string[];
  /** Round id → the validation error that quarantined it. Invisible in the game. */
  brokenRounds: Record<string, string>;
  rounds: EditRound[];
  /** Content-relative refs: `assets/baby-01.svg`. */
  assets: string[];
}

/** What the editor pushes at the television. Never an event, never logged. */
export interface PreviewPayload {
  prompt: string;
  answer?: string;
  media?: MediaRef;
}

export function itemsOf(round: EditRound): EditItem[] {
  return Array.isArray(round.config.items) ? (round.config.items as EditItem[]) : [];
}

export function categoriesOf(round: EditRound): BoardCategory[] {
  return Array.isArray(round.config.categories) ? (round.config.categories as BoardCategory[]) : [];
}

/** How many questions a round holds, whatever shape it stores them in. */
export function questionCount(round: EditRound): number {
  if (round.type === 'board') return categoriesOf(round).reduce((n, c) => n + (c.clues?.length ?? 0), 0);
  return itemsOf(round).length;
}

/**
 * Content-relative refs become URLs under /content. Mirrors `resolveAsset` in
 * server/game/roundContext.ts — the preview payload bypasses the round types,
 * so nothing else is going to resolve these for us.
 */
export function assetUrl(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  if (/^(https?:)?\/\//.test(ref) || ref.startsWith('/')) return ref;
  return `/content/${ref.replace(/^\.\//, '')}`;
}
