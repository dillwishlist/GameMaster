/**
 * `manual` — the universal base type. Build nothing else until this is solid.
 *
 * Display shows a prompt and optional media. The host sees the prompt, the
 * answer, and the grid of entrant faces; the host taps a face to award.
 *
 * READ THIS BEFORE ADDING A ROUND TYPE. This one type already covers
 * free-for-all shout-outs, charades, the baby-photo round, pin-the-tail,
 * musical chairs, relay races and sing-along judging — anything where a human
 * decides who won and taps a face. Those are *content*, not code. Do not write
 * a bespoke `musical-chairs` module.
 */

import { z } from 'zod';
import type { EntrantId, TimerView } from '../../shared/types.js';
import { defineRoundType, type RoundContext } from './contract.js';
import type { RoundEvent } from '../../shared/events.js';

export const mediaSchema = z
  .object({
    image: z.string().optional(),
    audio: z.string().optional(),
  })
  .strict();

export const manualItemSchema = z
  .object({
    prompt: z.string().min(1),
    answer: z.string().optional(),
    media: mediaSchema.optional(),
    /** Overrides the round's defaultPoints for this item. */
    points: z.number().optional(),
    /** Host-only aside: "wait for the laugh before revealing". */
    note: z.string().optional(),
  })
  .strict();

export const manualConfigSchema = z
  .object({
    items: z.array(manualItemSchema).min(1),
    defaultPoints: z.number().optional(),
    /** Optional countdown the host can start per item. */
    timerSeconds: z.number().positive().optional(),
  })
  .strict();

export type ManualConfig = z.infer<typeof manualConfigSchema>;
export type ManualItem = z.infer<typeof manualItemSchema>;

export interface ManualState {
  index: number;
  revealed: boolean;
  /** itemIndex → entrantId → points awarded so far, for host feedback only. */
  awards: Record<string, Record<EntrantId, number>>;
  timer?: TimerView;
}

export function manualInit(): ManualState {
  return { index: 0, revealed: false, awards: {} };
}

/**
 * Shared by `manual` and `multipleChoice`; the latter is a thin specialization
 * of exactly this behaviour with a different display rendering.
 */
export function manualReduce<S extends ManualState, C extends { items: unknown[]; timerSeconds?: number }>(
  state: S,
  event: RoundEvent,
  config: C,
  ctx: RoundContext,
  itemPoints: (index: number) => number,
): S {
  const lastIndex = config.items.length - 1;

  switch (event.type) {
    case 'NEXT':
      if (state.index >= lastIndex) return state;
      return { ...state, index: state.index + 1, revealed: false, timer: undefined };

    case 'PREV':
      if (state.index <= 0) return state;
      return { ...state, index: state.index - 1, revealed: false, timer: undefined };

    case 'GOTO': {
      const index = clamp(Number(event.index ?? 0), 0, lastIndex);
      return { ...state, index, revealed: false, timer: undefined };
    }

    case 'REVEAL':
      return { ...state, revealed: true };

    case 'HIDE':
      return { ...state, revealed: false };

    case 'AWARD': {
      const entrantId = String(event.entrantId ?? '');
      if (!entrantId || !canScore(entrantId, ctx)) return state;
      const points = typeof event.points === 'number' ? event.points : itemPoints(state.index);
      if (points === 0) return state;
      ctx.awardPoints(entrantId, points);
      return { ...state, awards: addAward(state.awards, state.index, entrantId, points) };
    }

    case 'TIMER_START': {
      const seconds = typeof event.seconds === 'number' ? event.seconds : config.timerSeconds;
      if (!seconds) return state;
      return { ...state, timer: ctx.timer.start(seconds * 1000) };
    }

    case 'TIMER_STOP':
      return { ...state, timer: ctx.timer.stop(state.timer) };

    /**
     * Phase 3 seam: player devices will emit this. Nothing does yet, and
     * `manual` has nothing to do with it, but the case exists so that adding
     * device submission later is a change to one round type, not to the
     * event plumbing.
     */
    case 'PLAYER_SUBMIT':
      return state;

    default:
      return state;
  }
}

export function canScore(entrantId: EntrantId, ctx: RoundContext): boolean {
  if (!ctx.entrants.some((e) => e.id === entrantId && e.active)) return false;
  return ctx.restrictTo === null || ctx.restrictTo.includes(entrantId);
}

function addAward(
  awards: Record<string, Record<EntrantId, number>>,
  index: number,
  entrantId: EntrantId,
  points: number,
): Record<string, Record<EntrantId, number>> {
  const key = String(index);
  const forItem = { ...(awards[key] ?? {}) };
  forItem[entrantId] = (forItem[entrantId] ?? 0) + points;
  if (forItem[entrantId] === 0) delete forItem[entrantId];
  return { ...awards, [key]: forItem };
}

function clamp(n: number, lo: number, hi: number): number {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : lo;
}

export const manualRoundType = defineRoundType<ManualConfig, ManualState>({
  id: 'manual',
  configSchema: manualConfigSchema,

  init: () => manualInit(),

  reduce: (state, event, config, ctx) =>
    manualReduce(state, event, config, ctx, (i) => config.items[i]?.points ?? ctx.defaultPoints),

  projectHost: (state, config, ctx) => {
    const item = config.items[state.index];
    return {
      kind: 'manual',
      prompt: item?.prompt ?? '',
      answer: item?.answer,
      media: resolveMedia(item, ctx),
      itemIndex: state.index,
      itemCount: config.items.length,
      revealed: state.revealed,
      timer: state.timer,
      extra: {
        note: item?.note,
        points: item?.points ?? ctx.defaultPoints,
        awards: state.awards[String(state.index)] ?? {},
        timerSeconds: config.timerSeconds,
      },
      can: {
        prev: state.index > 0,
        next: state.index < config.items.length - 1,
        reveal: Boolean(item?.answer) || Boolean(item?.media?.image),
        award: true,
      },
    };
  },

  projectDisplay: (state, config, ctx) => {
    const item = config.items[state.index];
    return {
      kind: 'manual',
      prompt: item?.prompt ?? '',
      answer: item?.answer,
      media: resolveMedia(item, ctx),
      itemIndex: state.index,
      itemCount: config.items.length,
      revealed: state.revealed,
      timer: state.timer,
    };
  },
});

export function resolveMedia(item: { media?: { image?: string; audio?: string } } | undefined, ctx: RoundContext) {
  if (!item?.media) return undefined;
  const image = ctx.assets.resolve(item.media.image);
  const audio = ctx.assets.resolve(item.media.audio);
  if (!image && !audio) return undefined;
  return { image, audio };
}
