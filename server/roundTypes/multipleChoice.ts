/**
 * `multipleChoice` — Trivial Pursuit style, host-adjudicated.
 *
 * v1 is deliberately a thin specialization of `manual`: the same
 * tap-a-face interaction, a different display rendering. The host taps the
 * entrant who called it out, then awards.
 *
 * Device submission (entrants lock in a choice on their phone, scored
 * automatically, mixed with host-adjudicated entrants in the same round) is
 * Phase 3. The seams for it are here and are exercised by nothing:
 * `projectPlayer` below, and the `PLAYER_SUBMIT` case in `reduce`.
 */

import { z } from 'zod';
import type { EntrantId } from '../../shared/types.js';
import { defineRoundType, type RoundContext } from './contract.js';
import { manualInit, manualReduce, mediaSchema, resolveMedia, type ManualState } from './manual.js';

const LETTERS = 'ABCDEFGH';

const mcItemSchema = z
  .object({
    prompt: z.string().min(1),
    options: z.array(z.string().min(1)).min(2).max(LETTERS.length),
    /** The letter of the correct option: A, B, C ... */
    correct: z.string().min(1),
    /** Optional elaboration read out on reveal. */
    answer: z.string().optional(),
    media: mediaSchema.optional(),
    points: z.number().optional(),
    note: z.string().optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const valid = LETTERS.slice(0, item.options.length).split('');
    if (!valid.includes(item.correct.trim().toUpperCase())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['correct'],
        message: `must be one of ${valid.join(', ')} (got "${item.correct}")`,
      });
    }
  });

export const multipleChoiceConfigSchema = z
  .object({
    items: z.array(mcItemSchema).min(1),
    defaultPoints: z.number().optional(),
    timerSeconds: z.number().positive().optional(),
  })
  .strict();

export type MultipleChoiceConfig = z.infer<typeof multipleChoiceConfigSchema>;

export interface MultipleChoiceState extends ManualState {
  /** Phase 3: itemIndex → entrantId → chosen letter. Never written in v1. */
  submissions: Record<string, Record<EntrantId, string>>;
}

function correctLetter(item: { correct: string }): string {
  return item.correct.trim().toUpperCase();
}

function options(item: { options: string[] }) {
  return item.options.map((text, i) => ({ label: LETTERS[i], text }));
}

export const multipleChoiceRoundType = defineRoundType<MultipleChoiceConfig, MultipleChoiceState>({
  id: 'multipleChoice',
  configSchema: multipleChoiceConfigSchema,

  /** Withheld from the room until the host reveals. */
  displaySecrets: ['correctLabel'],

  init: () => ({ ...manualInit(), submissions: {} }),

  reduce: (state, event, config, ctx) => {
    if (event.type === 'PLAYER_SUBMIT') {
      const entrantId = String(event.entrantId ?? '');
      const choice = String(event.choice ?? '').toUpperCase();
      const item = config.items[state.index];
      if (!entrantId || !item || !options(item).some((o) => o.label === choice)) return state;
      const key = String(state.index);
      return {
        ...state,
        submissions: { ...state.submissions, [key]: { ...(state.submissions[key] ?? {}), [entrantId]: choice } },
      };
    }
    return manualReduce(state, event, config, ctx, (i) => config.items[i]?.points ?? ctx.defaultPoints);
  },

  projectHost: (state, config, ctx) => {
    const item = config.items[state.index];
    return {
      kind: 'multipleChoice',
      prompt: item?.prompt ?? '',
      answer: item ? `${correctLetter(item)}. ${item.options[LETTERS.indexOf(correctLetter(item))]}${item.answer ? ` — ${item.answer}` : ''}` : undefined,
      media: resolveMedia(item, ctx),
      itemIndex: state.index,
      itemCount: config.items.length,
      revealed: state.revealed,
      timer: state.timer,
      extra: {
        note: item?.note,
        points: item?.points ?? ctx.defaultPoints,
        awards: state.awards[String(state.index)] ?? {},
        options: item ? options(item) : [],
        correctLabel: item ? correctLetter(item) : undefined,
        timerSeconds: config.timerSeconds,
      },
      can: {
        prev: state.index > 0,
        next: state.index < config.items.length - 1,
        reveal: true,
        award: true,
      },
    };
  },

  projectDisplay: (state, config, ctx) => {
    const item = config.items[state.index];
    return {
      kind: 'multipleChoice',
      prompt: item?.prompt ?? '',
      answer: item?.answer,
      media: resolveMedia(item, ctx),
      itemIndex: state.index,
      itemCount: config.items.length,
      revealed: state.revealed,
      timer: state.timer,
      extra: {
        options: item ? options(item) : [],
        // Stripped by the projection boundary until `revealed`.
        correctLabel: item ? correctLetter(item) : undefined,
      },
    };
  },

  projectPlayer: (state, config, entrantId) => {
    const item = config.items[state.index];
    return {
      kind: 'multipleChoice',
      prompt: item?.prompt ?? '',
      options: item ? options(item) : [],
      submitted: state.submissions[String(state.index)]?.[entrantId],
      locked: state.revealed,
    };
  },
});

export function multipleChoiceLetters(): string {
  return LETTERS;
}

/** Exposed for the round context helper in tests. */
export type { RoundContext };
