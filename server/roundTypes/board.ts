/**
 * `board` — the Jeopardy round. Categories across the top, point values down,
 * a contestant picks a square and the host taps it open.
 *
 * This is the one party game that genuinely is not `manual` plus content. The
 * reason is the scoring rule, not the grid: in Jeopardy the stake belongs to
 * the *square*, and a wrong answer costs exactly what a right one pays. A
 * `manual` round has one `points` value for the item the host is standing on,
 * so it cannot express "that square is worth 400 to whoever is brave". Once the
 * stake lives on the square, the grid, the consumed-square bookkeeping and the
 * wager follow.
 *
 * Everything else is deliberately `manual`'s interaction: the host taps a face
 * to award, long-presses (or flips the deduct switch) to take the same amount
 * away, and no player device is involved. That is the same adjudication path
 * the rest of the game uses, so there is nothing new to learn at 3pm on a
 * Sunday.
 *
 * The room must never learn which square hides a wager before it is opened —
 * that is the only surprise the format has — so the display's copy of the grid
 * carries point values and nothing else. See `projectDisplay`.
 */

import { z } from 'zod';
import type { EntrantId, TimerView } from '../../shared/types.js';
import { defineRoundType } from './contract.js';
import type { RoundEvent } from '../../shared/events.js';
import { canScore, mediaSchema, resolveMedia } from './manual.js';

/** Beyond this a grid stops being readable from a sofa, on a TV, in daylight. */
const MAX_COLUMNS = 8;
const MAX_ROWS = 8;

const boardClueSchema = z
  .object({
    /** What the square is worth. Paid on a right answer, charged on a wrong one. */
    value: z.number({ required_error: 'every clue needs a `value` — what the square is worth' }).int().positive(),
    prompt: z.string().min(1),
    answer: z.string().optional(),
    media: mediaSchema.optional(),
    /** Host-only aside, never sent to the TV. */
    note: z.string().optional(),
    /**
     * Daily-double square: the host sets the stake by hand before adjudicating.
     * Ignored — but still accepted — by a host who never taps the wager row, so
     * marking a square costs nothing if the feature goes unused on the day.
     */
    wager: z.boolean().optional(),
  })
  .strict();

const boardCategorySchema = z
  .object({
    name: z.string().min(1),
    clues: z.array(boardClueSchema).min(1).max(MAX_ROWS, `at most ${MAX_ROWS} clues fit down a TV screen`),
  })
  .strict();

export const boardConfigSchema = z
  .object({
    categories: z
      .array(boardCategorySchema)
      .min(1, 'a board needs at least one category')
      .max(MAX_COLUMNS, `at most ${MAX_COLUMNS} categories fit across a TV screen`),
    defaultPoints: z.number().optional(),
    /** Optional per-square countdown the host starts by hand. */
    timerSeconds: z.number().positive().optional(),
  })
  .strict();

export type BoardConfig = z.infer<typeof boardConfigSchema>;
export type BoardClue = z.infer<typeof boardClueSchema>;

export interface BoardState {
  /** Keys of squares the room has finished with, in the order they went. */
  consumed: string[];
  /** The open square, or null when the grid is up. */
  open: string | null;
  revealed: boolean;
  /** squareKey → entrantId → points, for host feedback only. Scores live in core. */
  awards: Record<string, Record<EntrantId, number>>;
  /** squareKey → host-set stake, overriding the square's value. Wager squares only. */
  wagers: Record<string, number>;
  timer?: TimerView;
}

interface Cell {
  key: string;
  categoryIndex: number;
  clueIndex: number;
  categoryName: string;
  clue: BoardClue;
}

function keyOf(categoryIndex: number, clueIndex: number): string {
  return `${categoryIndex}:${clueIndex}`;
}

function cellAt(config: BoardConfig, categoryIndex: number, clueIndex: number): Cell | undefined {
  const category = config.categories[categoryIndex];
  const clue = category?.clues[clueIndex];
  if (!category || !clue) return undefined;
  return { key: keyOf(categoryIndex, clueIndex), categoryIndex, clueIndex, categoryName: category.name, clue };
}

function cellByKey(config: BoardConfig, key: string | null): Cell | undefined {
  if (!key) return undefined;
  const [c, r] = key.split(':').map(Number);
  return cellAt(config, c, r);
}

/**
 * The square named by an event, or undefined if the event points at nothing.
 *
 * The indices must actually be numbers. Coercing with `Number()` would accept
 * `null`, `''`, `[]` and `false` — every one of them is 0, and every one of
 * them passes `Number.isInteger` — so a malformed tap would open the top-left
 * clue in front of the room instead of doing nothing. The host client sends
 * numbers; anything else names no square.
 */
function cellFromEvent(config: BoardConfig, event: RoundEvent): Cell | undefined {
  const { category, clue } = event;
  if (typeof category !== 'number' || typeof clue !== 'number') return undefined;
  if (!Number.isInteger(category) || !Number.isInteger(clue)) return undefined;
  return cellAt(config, category, clue);
}

/** What this square pays — the host's wager if one is set, else the printed value. */
function stakeOf(state: BoardState, cell: Cell): number {
  return cell.clue.wager ? (state.wagers[cell.key] ?? cell.clue.value) : cell.clue.value;
}

function boardInit(): BoardState {
  return { consumed: [], open: null, revealed: false, awards: {}, wagers: {} };
}

/**
 * Round state reaches a plugin as an opaque blob the core stored under a round
 * id, so nothing in the type system stops another round type's state arriving
 * here. Nothing does today — a content reload rebuilds `roundStates` from
 * empty, so a round whose type changed re-inits before its first event — but a
 * round type that throws on unfamiliar state takes the whole session down with
 * it. One shape check makes `reduce` and both projections total; the round
 * starts over rather than wedging the host.
 */
function asBoardState(state: BoardState): BoardState {
  const candidate = state as Partial<BoardState> | null | undefined;
  const looksRight =
    !!candidate && Array.isArray(candidate.consumed) && !!candidate.awards && !!candidate.wagers;
  return looksRight ? state : boardInit();
}

/**
 * Same shape as `manual`'s award ledger, six lines rather than a shared helper:
 * the key here is a square, not an item index, and threading that difference
 * through `manual` would cost more than the duplication does.
 */
function addAward(
  awards: BoardState['awards'],
  key: string,
  entrantId: EntrantId,
  points: number,
): BoardState['awards'] {
  const forCell = { ...(awards[key] ?? {}) };
  forCell[entrantId] = (forCell[entrantId] ?? 0) + points;
  if (forCell[entrantId] === 0) delete forCell[entrantId];
  return { ...awards, [key]: forCell };
}

function close(state: BoardState, consume: boolean): BoardState {
  if (!state.open) return state;
  const consumed = consume && !state.consumed.includes(state.open) ? [...state.consumed, state.open] : state.consumed;
  // The stake belongs to this visit to the square, not to the square forever.
  // Both ways out of a square come through here, and both need it gone: after
  // CANCEL the square is back in play at its printed value, and after CLOSE a
  // deliberate REOPEN starts from the printed value too. A wager that survived
  // would sit on the board as a mine — the room reads 500 off the TV, the host
  // taps a face, and it pays 1500 to whoever happened to pick it.
  const wagers = { ...state.wagers };
  delete wagers[state.open];
  return { ...state, open: null, revealed: false, consumed, wagers, timer: undefined };
}

function totalClues(config: BoardConfig): number {
  return config.categories.reduce((n, c) => n + c.clues.length, 0);
}

function rowCount(config: BoardConfig): number {
  return config.categories.reduce((n, c) => Math.max(n, c.clues.length), 0);
}

/**
 * One-tap wager amounts: every distinct value on the board, plus double the
 * biggest square. Typing a number on a tablet while a room waits is the thing
 * this avoids; the host can still use the per-entrant keypad for anything odd.
 */
function wagerPresets(config: BoardConfig): number[] {
  const values = new Set<number>();
  for (const category of config.categories) for (const clue of category.clues) values.add(clue.value);
  const sorted = [...values].sort((a, b) => a - b);
  const top = sorted[sorted.length - 1] ?? 0;
  return [...sorted, top * 2].filter((v) => v > 0);
}

export const boardRoundType = defineRoundType<BoardConfig, BoardState>({
  id: 'board',
  configSchema: boardConfigSchema,

  /**
   * The response travels in `extra` because the display renders it inside the
   * clue card, as one unit with the category and the value. It is also set on
   * `answer`, which the projection boundary strips unconditionally — two locks
   * on the one string that must never reach the TV early.
   */
  displaySecrets: ['response'],

  init: () => boardInit(),

  reduce: (given, event, config, ctx) => {
    const state = asBoardState(given);

    switch (event.type) {
      case 'OPEN': {
        const cell = cellFromEvent(config, event);
        // A used square ignores a stray tap; the host reopens it deliberately.
        if (!cell || state.consumed.includes(cell.key)) return state;
        return { ...state, open: cell.key, revealed: false, timer: undefined };
      }

      /** The host is never trapped: any square can be put back into play. */
      case 'REOPEN': {
        const cell = cellFromEvent(config, event);
        if (!cell) return state;
        return {
          ...state,
          open: cell.key,
          revealed: false,
          consumed: state.consumed.filter((k) => k !== cell.key),
          timer: undefined,
        };
      }

      /** Done with this square — it goes dark and the grid comes back. */
      case 'CLOSE':
      case 'NEXT':
        return close(state, true);

      /** Opened the wrong square. Back out and leave it in play. */
      case 'CANCEL':
      case 'PREV':
        return close(state, false);

      case 'REVEAL':
        return state.open ? { ...state, revealed: true } : state;

      case 'HIDE':
        return state.revealed ? { ...state, revealed: false } : state;

      case 'SET_WAGER': {
        const cell = cellByKey(config, state.open);
        if (!cell?.clue.wager) return state;
        const points = Math.round(Number(event.points));
        if (!Number.isFinite(points) || points <= 0) return state;
        return { ...state, wagers: { ...state.wagers, [cell.key]: points } };
      }

      case 'AWARD': {
        const entrantId = String(event.entrantId ?? '');
        if (!entrantId || !canScore(entrantId, ctx)) return state;
        const cell = cellByKey(config, state.open);
        // With no square open the faces still work, at the round's default
        // points. Invariant 2: the host fixes a score without leaving the round.
        const stake = cell ? stakeOf(state, cell) : ctx.defaultPoints;
        const points = typeof event.points === 'number' ? event.points : stake;
        if (!Number.isFinite(points) || points === 0) return state;
        ctx.awardPoints(entrantId, points);
        return { ...state, awards: addAward(state.awards, state.open ?? '', entrantId, points) };
      }

      case 'TIMER_START': {
        // The countdown belongs to an open square. Started on the grid it would
        // be unstoppable: CLOSE and CANCEL are the only things that clear a
        // timer and both return early with nothing open, so an expired clock
        // would sit beside the board — on the host *and* the TV — for the rest
        // of the round.
        if (!state.open) return state;
        const seconds = typeof event.seconds === 'number' ? event.seconds : config.timerSeconds;
        if (!seconds) return state;
        return { ...state, timer: ctx.timer.start(seconds * 1000) };
      }

      case 'TIMER_STOP':
        return { ...state, timer: ctx.timer.stop(state.timer) };

      /** Phase 3 seam, same as every other round type. Nothing emits this yet. */
      case 'PLAYER_SUBMIT':
        return state;

      default:
        return state;
    }
  },

  projectHost: (given, config, ctx) => {
    const state = asBoardState(given);
    const cell = cellByKey(config, state.open);
    const total = totalClues(config);
    const stake = cell ? stakeOf(state, cell) : ctx.defaultPoints;

    return {
      kind: 'board',
      prompt: cell?.clue.prompt ?? '',
      answer: cell?.clue.answer,
      media: resolveMedia(cell?.clue, ctx),
      // No linear order on a board — read this as "squares gone, of squares".
      itemIndex: Math.min(state.consumed.length, Math.max(total - 1, 0)),
      itemCount: total,
      revealed: state.revealed,
      timer: state.timer,
      extra: {
        categories: config.categories.map((category, c) => ({
          name: category.name,
          clues: category.clues.map((clue, r) => ({
            value: clue.value,
            consumed: state.consumed.includes(keyOf(c, r)),
            wager: Boolean(clue.wager),
          })),
        })),
        rows: rowCount(config),
        open: cell
          ? {
              categoryIndex: cell.categoryIndex,
              clueIndex: cell.clueIndex,
              category: cell.categoryName,
              value: cell.clue.value,
              wager: Boolean(cell.clue.wager),
            }
          : null,
        wagerPresets: wagerPresets(config),
        remaining: total - state.consumed.length,
        note: cell?.clue.note,
        // Consumed by the host's entrant tiles: what one tap is worth right now.
        points: stake,
        awards: state.awards[state.open ?? ''] ?? {},
        timerSeconds: config.timerSeconds,
      },
      can: {
        // On the grid there is nothing to step through — a contestant picks.
        // With a square open these become "back out" and "done with it".
        prev: Boolean(cell),
        next: Boolean(cell),
        reveal: Boolean(cell?.clue.answer),
        award: true,
      },
    };
  },

  projectDisplay: (given, config, ctx) => {
    const state = asBoardState(given);
    const cell = cellByKey(config, state.open);

    return {
      kind: 'board',
      prompt: cell?.clue.prompt ?? '',
      answer: cell?.clue.answer,
      media: resolveMedia(cell?.clue, ctx),
      itemIndex: Math.min(state.consumed.length, Math.max(totalClues(config) - 1, 0)),
      itemCount: totalClues(config),
      revealed: state.revealed,
      timer: state.timer,
      extra: {
        // Values and used/unused only. No prompt, no answer, and no `wager`
        // flag: which square is the daily double is the format's one surprise.
        categories: config.categories.map((category, c) => ({
          name: category.name,
          clues: category.clues.map((clue, r) => ({
            value: clue.value,
            consumed: state.consumed.includes(keyOf(c, r)),
          })),
        })),
        rows: rowCount(config),
        open: cell
          ? {
              category: cell.categoryName,
              // Once it is open the room may as well see the stake.
              value: stakeOf(state, cell),
              wager: Boolean(cell.clue.wager),
            }
          : null,
        // Stripped by the projection boundary until `revealed`.
        response: cell?.clue.answer,
      },
    };
  },
});
