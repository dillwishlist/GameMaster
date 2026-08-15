/**
 * The editing model: the document as loaded, plus the operations not yet saved.
 *
 * There is exactly one way to change anything — `edit(op)` — and it does two
 * things with the same operation: appends it to the queue that will be sent to
 * the server, and applies it to the local copy so the screen updates. Both
 * halves therefore obey identical rules (an empty string removes a key,
 * positions are resolved as the ops run in order), which is why `applyLocally`
 * below is a deliberate mirror of `applyOp` in server/editor/contentDoc.ts
 * rather than a convenient approximation. If the two disagree, the host sees
 * one thing on screen and another in the file.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchContent, saveContent } from './api.js';
import type { ContentModel, EditOp, EditRound } from './types.js';

export interface SaveFailure {
  status: number;
  message: string;
  detail?: string;
}

export interface Editor {
  model: ContentModel | null;
  /** Unsaved operations, oldest first. Empty means "nothing to save". */
  ops: EditOp[];
  loading: boolean;
  loadError: string | null;
  /** The passphrase gate said no. */
  forbidden: boolean;
  saving: boolean;
  /** Set briefly after a save so the host gets a confirmation, not just silence. */
  justSaved: boolean;
  saveError: SaveFailure | null;
  edit: (op: EditOp) => void;
  save: () => void;
  reload: () => void;
  dismissError: () => void;
}

export function useEditor(passphrase: string | undefined): Editor {
  const [model, setModel] = useState<ContentModel | null>(null);
  const [ops, setOps] = useState<EditOp[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState<SaveFailure | null>(null);
  /** Guards against a save landing after the component has gone. */
  const alive = useRef(true);
  const modelRef = useRef<ContentModel | null>(null);
  const opsRef = useRef<EditOp[]>([]);
  const savingRef = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    modelRef.current = model;
    opsRef.current = ops;
  }, [model, ops]);

  const load = useCallback(() => {
    setLoading(true);
    fetchContent(passphrase)
      .then((next) => {
        if (!alive.current) return;
        setModel(next);
        setOps([]);
        setLoadError(null);
        setForbidden(false);
        setSaveError(null);
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        if (err instanceof ApiError && err.status === 403) setForbidden(true);
        setLoadError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => alive.current && setLoading(false));
  }, [passphrase]);

  useEffect(load, [load]);

  const edit = useCallback((op: EditOp) => {
    setModel((current) => (current ? applyLocally(current, op) : current));
    setOps((current) => append(current, op));
    setJustSaved(false);
  }, []);

  const save = useCallback(() => {
    // Through refs rather than the state values: this callback must not be torn
    // down and rebuilt on every keystroke, and a save started from a stale
    // closure would send the wrong hash and get a 409 for no reason.
    const current = modelRef.current;
    const pending = opsRef.current;
    if (!current || pending.length === 0 || savingRef.current) return;

    savingRef.current = true;
    setSaving(true);
    setSaveError(null);

    saveContent(current.hash, pending, passphrase)
      .then((next) => {
        if (!alive.current) return;
        // The server's model is authoritative — it carries the new hash, the
        // freshly listed assets, and any round that has since gone in or out of
        // play. The operations that produced it are done with.
        setModel(next);
        setOps([]);
        setJustSaved(true);
      })
      .catch((err: unknown) => {
        if (!alive.current) return;
        // 409 and 422 both mean "not saved", so the queue is kept: the host
        // fixes what the message complains about and saves again with their
        // afternoon's typing intact.
        if (err instanceof ApiError) setSaveError({ status: err.status, message: err.message, detail: err.detail });
        else setSaveError({ status: 0, message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => {
        savingRef.current = false;
        if (alive.current) setSaving(false);
      });
  }, [passphrase]);

  // The browser's own "leave site?" dialog is the only thing that can stop a
  // closed tab taking an afternoon of questions with it.
  useEffect(() => {
    if (ops.length === 0) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [ops.length]);

  return {
    model,
    ops,
    loading,
    loadError,
    forbidden,
    saving,
    justSaved,
    saveError,
    edit,
    save,
    reload: load,
    dismissError: () => setSaveError(null),
  };
}

/* -------------------------------------------------------------------------- */
/* The operation queue                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Identity of a "set this field" operation. Two ops with the same key overwrite
 * the same place in the document, so only the last one matters — otherwise
 * typing a twelve-word prompt sends twelve operations for one field.
 */
function keyOf(op: EditOp): string | null {
  switch (op.op) {
    case 'setTitle':
      return 'title';
    case 'setRoundField':
      return `round:${op.roundId}:${op.field}`;
    case 'setItemField':
      return `item:${op.roundId}:${op.index}:${op.path.join('.')}`;
    case 'setCategoryName':
      return `category:${op.roundId}:${op.category}`;
    case 'setClueField':
      return `clue:${op.roundId}:${op.category}:${op.clue}:${op.path.join('.')}`;
    default:
      return null;
  }
}

/**
 * Only ever collapses against the *last* operation. Reaching further back would
 * mean reasoning about whether an intervening add or move had shifted the
 * indices the earlier op refers to, and getting that wrong writes a prompt into
 * the wrong question.
 */
function append(queue: EditOp[], op: EditOp): EditOp[] {
  const key = keyOf(op);
  const last = queue[queue.length - 1];
  if (key && last && keyOf(last) === key) return [...queue.slice(0, -1), op];
  return [...queue, op];
}

/* -------------------------------------------------------------------------- */
/* Applying an operation to the local copy                                    */
/* -------------------------------------------------------------------------- */

/** Round-level keys that live beside `id` in the file rather than in the config. */
const ROUND_FIELDS = new Set(['title', 'restrictTo', 'defaultPoints']);

function applyLocally(model: ContentModel, op: EditOp): ContentModel {
  switch (op.op) {
    case 'setTitle':
      return { ...model, title: op.value };

    case 'setRoundField':
      return mapRound(model, op.roundId, (round) => setRoundField(round, op.field, op.value));

    case 'addRound': {
      const rounds = [...model.rounds];
      rounds.splice(clamp(op.index, rounds.length), 0, roundFromRaw(op.round));
      return { ...model, rounds };
    }

    case 'removeRound':
      return { ...model, rounds: model.rounds.filter((r) => r.id !== op.roundId) };

    case 'moveRound': {
      const rounds = [...model.rounds];
      const from = rounds.findIndex((r) => r.id === op.roundId);
      if (from < 0) return model;
      const [round] = rounds.splice(from, 1);
      rounds.splice(clamp(op.toIndex, rounds.length), 0, round);
      return { ...model, rounds };
    }

    case 'setItemField':
      return mapItems(model, op.roundId, (items) =>
        items.map((item, i) =>
          i === op.index ? (setPath(item as Record<string, unknown>, op.path, op.value) as typeof item) : item,
        ),
      );

    case 'addItem':
      return mapItems(model, op.roundId, (items) => {
        const next = [...items];
        next.splice(clamp(op.index, next.length), 0, op.item);
        return next;
      });

    case 'removeItem':
      return mapItems(model, op.roundId, (items) => items.filter((_, i) => i !== op.index));

    case 'moveItem':
      return mapItems(model, op.roundId, (items) => {
        const next = [...items];
        const [item] = next.splice(op.from, 1);
        if (item === undefined) return items;
        next.splice(clamp(op.to, next.length), 0, item);
        return next;
      });

    // A board's questions live two levels down, so the same four moves happen
    // twice: once for the columns, once for the clues inside one column.
    case 'setCategoryName':
      return mapCategories(model, op.roundId, (categories) =>
        categories.map((category, i) => (i === op.category ? { ...category, name: op.value } : category)),
      );

    case 'addCategory':
      return mapCategories(model, op.roundId, (categories) => {
        const next = [...categories];
        next.splice(clamp(op.index, next.length), 0, op.category);
        return next;
      });

    case 'removeCategory':
      return mapCategories(model, op.roundId, (categories) => categories.filter((_, i) => i !== op.index));

    case 'moveCategory':
      return mapCategories(model, op.roundId, (categories) => {
        const next = [...categories];
        const [category] = next.splice(op.from, 1);
        if (category === undefined) return categories;
        next.splice(clamp(op.to, next.length), 0, category);
        return next;
      });

    case 'setClueField':
      return mapClues(model, op.roundId, op.category, (clues) =>
        clues.map((clue, i) => (i === op.clue ? setPath(clue, op.path, op.value) : clue)),
      );

    case 'addClue':
      return mapClues(model, op.roundId, op.category, (clues) => {
        const next = [...clues];
        next.splice(clamp(op.index, next.length), 0, op.clue);
        return next;
      });

    case 'removeClue':
      return mapClues(model, op.roundId, op.category, (clues) => clues.filter((_, i) => i !== op.index));

    case 'moveClue':
      return mapClues(model, op.roundId, op.category, (clues) => {
        const next = [...clues];
        const [clue] = next.splice(op.from, 1);
        if (clue === undefined) return clues;
        next.splice(clamp(op.to, next.length), 0, clue);
        return next;
      });

    default:
      return model;
  }
}

function mapRound(model: ContentModel, roundId: string, fn: (round: EditRound) => EditRound): ContentModel {
  return { ...model, rounds: model.rounds.map((r) => (r.id === roundId ? fn(r) : r)) };
}

function mapItems(
  model: ContentModel,
  roundId: string,
  fn: (items: Record<string, unknown>[]) => Record<string, unknown>[],
): ContentModel {
  return mapRound(model, roundId, (round) => {
    const items = Array.isArray(round.config.items) ? (round.config.items as Record<string, unknown>[]) : [];
    return { ...round, config: { ...round.config, items: fn(items) } };
  });
}

function mapCategories(
  model: ContentModel,
  roundId: string,
  fn: (categories: Record<string, unknown>[]) => Record<string, unknown>[],
): ContentModel {
  return mapRound(model, roundId, (round) => {
    const categories = Array.isArray(round.config.categories)
      ? (round.config.categories as Record<string, unknown>[])
      : [];
    return { ...round, config: { ...round.config, categories: fn(categories) } };
  });
}

function mapClues(
  model: ContentModel,
  roundId: string,
  category: number,
  fn: (clues: Record<string, unknown>[]) => Record<string, unknown>[],
): ContentModel {
  return mapCategories(model, roundId, (categories) =>
    categories.map((entry, i) => {
      if (i !== category) return entry;
      const clues = Array.isArray(entry.clues) ? (entry.clues as Record<string, unknown>[]) : [];
      return { ...entry, clues: fn(clues) };
    }),
  );
}

function setRoundField(round: EditRound, field: string, value: unknown): EditRound {
  const cleared = value === '' || value === undefined;
  if (ROUND_FIELDS.has(field)) {
    if (field === 'title') return { ...round, title: cleared ? '' : String(value) };
    if (field === 'restrictTo') return { ...round, restrictTo: cleared ? null : (value as string[]) };
    return { ...round, defaultPoints: cleared ? null : Number(value) };
  }
  const config = { ...round.config };
  if (cleared) delete config[field];
  else config[field] = value;
  return { ...round, config };
}

/** A round the host just added exists only in the file's terms until it is saved. */
function roundFromRaw(raw: Record<string, unknown>): EditRound {
  const { id, type, title, restrictTo, defaultPoints, ...config } = raw;
  return {
    id: String(id),
    type: String(type),
    title: String(title ?? ''),
    restrictTo: Array.isArray(restrictTo) ? (restrictTo as string[]) : null,
    defaultPoints: typeof defaultPoints === 'number' ? defaultPoints : null,
    config,
    // Nothing can be in play that the server has not seen yet.
    inPlay: false,
  };
}

/**
 * Set or delete a nested key. Deleting the last key of a sub-object removes the
 * sub-object too, because `media: {}` is both noise in the file and a strict
 * schema failure on the next load — the same pruning the server does.
 */
function setPath(obj: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const [head, ...rest] = path;
  const next = { ...obj };
  if (rest.length === 0) {
    if (value === '' || value === undefined) delete next[head];
    else next[head] = value;
    return next;
  }
  const child = setPath((next[head] as Record<string, unknown> | undefined) ?? {}, rest, value);
  if (Object.keys(child).length === 0) delete next[head];
  else next[head] = child;
  return next;
}

function clamp(index: number, length: number): number {
  if (!Number.isFinite(index)) return length;
  return Math.min(length, Math.max(0, Math.trunc(index)));
}
