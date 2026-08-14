/**
 * Editing the content file without destroying it.
 *
 * The YAML file stays the source of truth — hot reload, git history, editing it
 * by hand at 9:15 on a Sunday and the printed fallback all depend on the file
 * being real, not an export from somewhere else. So the editor is a view over
 * the file, and this module is the part that writes it back.
 *
 * Two rules follow from that, and they are why this is an operation log rather
 * than "send me the whole document and I'll re-serialise it":
 *
 *  1. **Comments are documentation.** `content/anniversary.yaml` explains why
 *     `restrictTo` exists and when a sound cue fires. `YAML.stringify(model)`
 *     deletes every word of it. Mutating the parsed `Document` in place leaves
 *     untouched nodes — and their comments, quoting and key order — exactly as
 *     the author wrote them.
 *  2. **Moving a question should move its comments with it.** An operation that
 *     splices the node itself does that for free. A whole-model rewrite cannot.
 */

import { createHash } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as YAML from 'yaml';

export class EditError extends Error {}

/**
 * How the editor writes YAML. Fixed, and shared with the round-trip test.
 *
 * `lineWidth: 0` stops long prompts being wrapped mid-sentence. Flow spacing is
 * whatever the library does by default — a file can style `[a, b]` and
 * `{ a: b }` differently by hand, but one serialiser has one opinion, so the
 * shipped content is stored in exactly this style. Saving a hand-styled file
 * normalises that spacing; comments, key order and quoting are untouched.
 */
export const SERIALISE: YAML.ToStringOptions = { lineWidth: 0 };

export interface ContentDoc {
  doc: YAML.Document;
  /** Hash of the bytes on disk, for detecting a concurrent edit. */
  hash: string;
  text: string;
}

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

export function loadContentDoc(file: string): ContentDoc {
  const text = readFileSync(file, 'utf8');
  const doc = YAML.parseDocument(text);
  if (doc.errors.length > 0) {
    throw new EditError(`${file} does not parse: ${doc.errors[0].message}`);
  }
  return { doc, hash: hashOf(text), text };
}

export function hashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

/**
 * Write via a temp file and a rename, the same way the event log does. A crash
 * halfway through a save must not leave a half-written content file — that is
 * the one file the live game reads.
 */
export function saveContentDoc(file: string, doc: YAML.Document): string {
  const text = doc.toString(SERIALISE);
  const temp = `${file}.tmp`;
  writeFileSync(temp, text);
  renameSync(temp, file);
  return text;
}

/* -------------------------------------------------------------------------- */
/* Applying operations                                                        */
/* -------------------------------------------------------------------------- */

export function applyOps(doc: YAML.Document, ops: EditOp[]): void {
  for (const op of ops) applyOp(doc, op);
}

function applyOp(doc: YAML.Document, op: EditOp): void {
  switch (op.op) {
    case 'setTitle':
      doc.setIn(['title'], op.value);
      return;

    case 'setRoundField': {
      const index = roundIndex(doc, op.roundId);
      // Clearing an optional field removes the key rather than writing `null`,
      // which would fail validation and read as deliberate to the next human.
      if (op.value === undefined || op.value === '') doc.deleteIn(['rounds', index, op.field]);
      else doc.setIn(['rounds', index, op.field], toNode(doc, op.value));
      return;
    }

    case 'addRound': {
      const rounds = seqAt(doc, ['rounds']);
      rounds.items.splice(clamp(op.index, rounds.items.length), 0, doc.createNode(op.round));
      return;
    }

    case 'removeRound': {
      const rounds = seqAt(doc, ['rounds']);
      rounds.items.splice(roundIndex(doc, op.roundId), 1);
      return;
    }

    case 'moveRound': {
      const rounds = seqAt(doc, ['rounds']);
      const from = roundIndex(doc, op.roundId);
      // Splice the node itself, so the round's comments travel with it.
      const [node] = rounds.items.splice(from, 1);
      rounds.items.splice(clamp(op.toIndex, rounds.items.length), 0, node);
      return;
    }

    case 'setItemField': {
      const path = ['rounds', roundIndex(doc, op.roundId), 'items', op.index, ...op.path];
      if (op.value === undefined || op.value === '') {
        doc.deleteIn(path);
        // A `media: {}` left behind by clearing its only key is noise in the
        // file and fails the strict schema on the next load.
        pruneEmptyParent(doc, path);
      } else {
        ensurePath(doc, path.slice(0, -1));
        doc.setIn(path, toNode(doc, op.value));
      }
      return;
    }

    case 'addItem': {
      const items = itemsOf(doc, op.roundId);
      items.items.splice(clamp(op.index, items.items.length), 0, doc.createNode(op.item));
      return;
    }

    case 'removeItem': {
      const items = itemsOf(doc, op.roundId);
      if (op.index < 0 || op.index >= items.items.length) throw new EditError(`No item ${op.index}`);
      items.items.splice(op.index, 1);
      return;
    }

    case 'moveItem': {
      const items = itemsOf(doc, op.roundId);
      if (op.from < 0 || op.from >= items.items.length) throw new EditError(`No item ${op.from}`);
      const [node] = items.items.splice(op.from, 1);
      items.items.splice(clamp(op.to, items.items.length), 0, node);
      return;
    }

    default: {
      const unknown = op as { op: string };
      throw new EditError(`Unknown edit operation "${unknown.op}"`);
    }
  }
}

/* -------------------------------------------------------------------------- */

function roundIndex(doc: YAML.Document, roundId: string): number {
  const rounds = seqAt(doc, ['rounds']);
  const index = rounds.items.findIndex((node) => {
    const id = YAML.isMap(node) ? node.get('id') : undefined;
    return id === roundId;
  });
  if (index < 0) throw new EditError(`No round with id "${roundId}"`);
  return index;
}

function itemsOf(doc: YAML.Document, roundId: string): YAML.YAMLSeq {
  return seqAt(doc, ['rounds', roundIndex(doc, roundId), 'items']);
}

function seqAt(doc: YAML.Document, path: (string | number)[]): YAML.YAMLSeq {
  const node = doc.getIn(path, true);
  if (!YAML.isSeq(node)) throw new EditError(`Expected a list at ${path.join('.')}`);
  return node;
}

/** Create intermediate maps so setting `media.image` works on an item with no `media`. */
function ensurePath(doc: YAML.Document, path: (string | number)[]): void {
  for (let i = 1; i <= path.length; i++) {
    const sub = path.slice(0, i);
    if (doc.getIn(sub, true) === undefined) doc.setIn(sub, doc.createNode({}));
  }
}

function pruneEmptyParent(doc: YAML.Document, path: (string | number)[]): void {
  const parentPath = path.slice(0, -1);
  if (parentPath.length === 0) return;
  const parent = doc.getIn(parentPath, true);
  if (YAML.isMap(parent) && parent.items.length === 0) doc.deleteIn(parentPath);
}

/**
 * Scalars are written as-is so YAML picks its own quoting; objects and arrays
 * go through `createNode` so they come out as proper nodes rather than a
 * stringified blob.
 */
function toNode(doc: YAML.Document, value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return doc.createNode(value);
}

function clamp(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.min(length, Math.max(0, Math.trunc(index)));
}
