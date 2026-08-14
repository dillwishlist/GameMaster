/**
 * Content is files, not a UI. `./content/<game>.yaml` is parsed, validated with
 * Zod, and hot-reloaded while the server runs — during rehearsal you will be
 * editing questions constantly.
 *
 * Validation errors are reported with the file and line, because a YAML error
 * at 9:15 on a Sunday needs to point at the line, not at a Zod path.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import * as YAML from 'yaml';
import { z } from 'zod';
import type { Round } from '../shared/types.js';
import { getRoundType, knownRoundTypeIds } from './roundTypes/index.js';

const entrantSeedSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  avatar: z.string().optional(),
  color: z.string().optional(),
  members: z
    .array(z.object({ name: z.string().min(1), avatar: z.string().optional() }))
    .optional(),
});

const roundSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    title: z.string().min(1),
    restrictTo: z.array(z.string()).optional(),
    defaultPoints: z.number().optional(),
  })
  .passthrough();

const contentSchema = z.object({
  title: z.string().min(1),
  entrants: z.array(entrantSeedSchema).optional(),
  rounds: z.array(roundSchema).min(1),
});

export interface GameContent {
  title: string;
  entrants: z.infer<typeof entrantSeedSchema>[];
  rounds: Round[];
  /** Rounds whose type is unknown or whose config failed validation. */
  brokenRounds: Record<string, string>;
  sourceFile: string;
}

export class ContentError extends Error {}

/** Pick the content file: the one named, else the only .yaml in ./content. */
export function resolveContentFile(dir: string, requested?: string): string {
  if (requested) {
    const p = path.isAbsolute(requested) ? requested : path.resolve(requested);
    if (!existsSync(p)) throw new ContentError(`Content file not found: ${p}`);
    return p;
  }
  if (!existsSync(dir)) throw new ContentError(`No content directory at ${dir}`);
  const candidates = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (candidates.length === 0) throw new ContentError(`No .yaml files in ${dir}`);
  candidates.sort();
  return path.join(dir, candidates[0]);
}

/** A parsed document plus the offset→line index used for error messages. */
interface Source {
  doc: YAML.Document;
  lineCounter: YAML.LineCounter;
  file: string;
}

export function loadContent(file: string): GameContent {
  const raw = readFileSync(file, 'utf8');
  const lineCounter = new YAML.LineCounter();
  const doc = YAML.parseDocument(raw, { lineCounter });
  const src: Source = { doc, lineCounter, file };

  if (doc.errors.length > 0) {
    const e = doc.errors[0];
    const pos = e.linePos?.[0];
    throw new ContentError(`${rel(file)}${pos ? `:${pos.line}` : ''} — ${e.message}`);
  }

  const data = doc.toJS();
  const parsed = contentSchema.safeParse(data);
  if (!parsed.success) {
    throw new ContentError(formatZodError(parsed.error, src));
  }

  const rounds: Round[] = [];
  const brokenRounds: Record<string, string> = {};

  parsed.data.rounds.forEach((r, i) => {
    const { id, type, title, restrictTo, defaultPoints, ...config } = r;
    const roundType = getRoundType(type);
    if (!roundType) {
      brokenRounds[id] = `Unknown round type "${type}". Known types: ${knownRoundTypeIds().join(', ')}`;
      return;
    }
    const cfg = roundType.configSchema.safeParse({ ...config, defaultPoints });
    if (!cfg.success) {
      brokenRounds[id] = formatZodError(cfg.error, src, ['rounds', i]);
      return;
    }
    rounds.push({ id, type, title, config: cfg.data, restrictTo, defaultPoints });
  });

  if (rounds.length === 0) {
    const why = Object.entries(brokenRounds)
      .map(([id, msg]) => `  - ${id}: ${msg}`)
      .join('\n');
    throw new ContentError(`No usable rounds in ${rel(file)}:\n${why}`);
  }

  const dupes = duplicates(rounds.map((r) => r.id));
  if (dupes.length) throw new ContentError(`${rel(file)} — duplicate round ids: ${dupes.join(', ')}`);

  return {
    title: parsed.data.title,
    entrants: parsed.data.entrants ?? [],
    rounds,
    brokenRounds,
    sourceFile: file,
  };
}

/**
 * Warn about content that parses but will disappoint at the party: a
 * `restrictTo` naming an entrant nobody created, or a missing image.
 */
export function contentWarnings(content: GameContent, contentDir: string): string[] {
  const warnings: string[] = [];
  const entrantIds = new Set(content.entrants.map((e) => e.id));

  for (const round of content.rounds) {
    for (const id of round.restrictTo ?? []) {
      if (!entrantIds.has(id)) {
        warnings.push(
          `Round "${round.id}" is restricted to entrant "${id}", which is not in the content file's entrants list. ` +
            `If the host doesn't create an entrant with that exact id, nobody can score in that round.`,
        );
      }
    }
    for (const ref of collectAssetRefs(round.config)) {
      const p = path.resolve(contentDir, ref);
      if (!existsSync(p)) warnings.push(`Round "${round.id}" references a missing asset: ${ref}`);
    }
  }
  return warnings;
}

function collectAssetRefs(value: unknown, out: string[] = []): string[] {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    value.forEach((v) => collectAssetRefs(v, out));
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    if ((k === 'image' || k === 'audio') && typeof v === 'string') out.push(v);
    else collectAssetRefs(v, out);
  }
  return out;
}

/* -------------------------------------------------------------------------- */

function formatZodError(err: z.ZodError, src: Source, prefix: (string | number)[] = []): string {
  return err.issues
    .map((issue) => {
      const fullPath = [...prefix, ...issue.path];
      const line = lineOf(src, fullPath);
      const where = `${rel(src.file)}${line ? `:${line}` : ''}`;
      const at = fullPath.length ? ` (${fullPath.join('.')})` : '';
      return `${where}${at} — ${issue.message}`;
    })
    .join('\n');
}

/**
 * Line number for a value path, falling back to the nearest ancestor that has
 * one. A missing `answer:` key has no node of its own, so the caller gets the
 * line of the item it belongs to — which is what you want when fixing it.
 */
function lineOf(src: Source, valuePath: (string | number)[]): number | null {
  for (let i = valuePath.length; i >= 0; i--) {
    const node = src.doc.getIn(valuePath.slice(0, i), true);
    if (YAML.isNode(node) && node.range) {
      return src.lineCounter.linePos(node.range[0]).line;
    }
  }
  return null;
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) (seen.has(v) ? dupes : seen).add(v);
  return [...dupes];
}

function rel(file: string): string {
  return path.relative(process.cwd(), file) || file;
}
