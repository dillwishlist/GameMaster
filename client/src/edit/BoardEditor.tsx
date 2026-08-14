/**
 * The `board` grid, edited as a grid: categories across the top, clues down.
 *
 * Two things make this different from the other two round types.
 *
 * 1. A board's questions live under `categories[].clues[]`, not `items`, and
 *    the edit API's item operations only address `items`. So every change here
 *    is one `setRoundField` carrying the whole `categories` block. That is also
 *    why comments written *inside* a board grid by hand do not survive an edit
 *    made here, while comments elsewhere in the file do — the block is
 *    regenerated, the rest of the document is not touched.
 * 2. Adding or removing a clue is a structural change, and the server refuses a
 *    hot reload that restructures a round already under way. `setRoundField` is
 *    not on the API's blocked list, so nothing would stop the save — it is this
 *    form that has to stop it, or the host saves happily and the game quietly
 *    keeps playing the old file.
 */

import { useState } from 'react';
import { NumberField, RowTools, TextField } from './Fields.js';
import { MediaPicker } from './MediaPicker.js';
import { previewMedia } from './ItemEditor.js';
import { categoriesOf } from './types.js';
import type { BoardCategory, EditOp, EditRound, PreviewPayload } from './types.js';

/** The schema's limits, so the host is never offered an edit that cannot save. */
const MAX_COLUMNS = 8;
const MAX_ROWS = 8;

interface Cell {
  category: number;
  clue: number;
}

export function BoardEditor({
  round,
  assets,
  passphrase,
  edit,
  onPreview,
}: {
  round: EditRound;
  assets: string[];
  passphrase: string | undefined;
  edit: (op: EditOp) => void;
  onPreview: (payload: PreviewPayload) => void;
}) {
  const categories = categoriesOf(round);
  const [selected, setSelected] = useState<Cell | null>(null);

  const write = (next: BoardCategory[]) =>
    edit({ op: 'setRoundField', roundId: round.id, field: 'categories', value: next });

  /** Every mutation is "clone, change one thing, write the block back". */
  const mutate = (fn: (draft: BoardCategory[]) => void) => {
    const draft = structuredClone(categories) as BoardCategory[];
    fn(draft);
    write(draft);
  };

  const rows = Math.max(1, ...categories.map((c) => c.clues?.length ?? 0));
  const current =
    selected && categories[selected.category]?.clues?.[selected.clue] ? selected : null;
  const clue = current ? categories[current.category].clues![current.clue] : null;

  return (
    <div className="board-editor">
      {round.inPlay && (
        <p className="inline-warning">
          This board is on the TV right now — squares are addressed by position, so adding or removing one would move
          the round underneath itself. Rewording a clue is safe.
        </p>
      )}

      <div className="board-grid" style={{ ['--cols' as string]: String(Math.max(1, categories.length)) }}>
        {categories.map((category, c) => (
          <div key={c} className="board-col">
            <div className="board-cat">
              <input
                className="field-input"
                value={String(category.name ?? '')}
                placeholder="Category"
                onChange={(e) =>
                  mutate((draft) => {
                    draft[c].name = e.target.value;
                  })
                }
              />
              <RowTools
                onDelete={
                  categories.length > 1
                    ? () => {
                        if (!confirm(`Delete the whole "${category.name ?? 'unnamed'}" column and its clues?`)) return;
                        setSelected(null);
                        mutate((draft) => {
                          draft.splice(c, 1);
                        });
                      }
                    : undefined
                }
                disabled={round.inPlay}
                deleteTitle="Delete this category"
              >
                {/* Columns move sideways, so they get their own arrows rather
                    than the up/down pair every other list here uses. */}
                <button
                  className="mini"
                  title="Move this column left"
                  disabled={round.inPlay || c === 0}
                  onClick={() =>
                    mutate((draft) => {
                      [draft[c - 1], draft[c]] = [draft[c], draft[c - 1]];
                    })
                  }
                >
                  ‹
                </button>
                <button
                  className="mini"
                  title="Move this column right"
                  disabled={round.inPlay || c === categories.length - 1}
                  onClick={() =>
                    mutate((draft) => {
                      [draft[c], draft[c + 1]] = [draft[c + 1], draft[c]];
                    })
                  }
                >
                  ›
                </button>
              </RowTools>
            </div>

            {Array.from({ length: rows }, (_, r) => {
              const cell = category.clues?.[r];
              if (!cell) return <div key={r} className="board-cell empty" />;
              const isSelected = current?.category === c && current.clue === r;
              return (
                <button
                  key={r}
                  className={`board-cell ${isSelected ? 'selected' : ''} ${cell.prompt ? '' : 'blank'}`}
                  onClick={() => setSelected({ category: c, clue: r })}
                >
                  <b>{cell.value ?? '—'}</b>
                  {cell.wager ? <span className="wager-dot" title="Daily double">★</span> : null}
                  <span className="board-cell-text">{String(cell.prompt ?? 'empty clue')}</span>
                </button>
              );
            })}

            <button
              className="mini board-add"
              disabled={round.inPlay || (category.clues?.length ?? 0) >= MAX_ROWS}
              onClick={() =>
                mutate((draft) => {
                  const clues = draft[c].clues ?? (draft[c].clues = []);
                  const last = clues[clues.length - 1];
                  // Values normally step down a column, so guess the next one
                  // rather than making the host type 100, 200, 300 by hand.
                  const step = clues.length > 1 ? Number(clues[1].value ?? 200) - Number(clues[0].value ?? 100) : 100;
                  clues.push({ value: Number(last?.value ?? 0) + (step || 100), prompt: 'New clue' });
                })
              }
            >
              + Clue
            </button>
          </div>
        ))}

        {categories.length < MAX_COLUMNS && (
          <button
            className="mini board-add-col"
            disabled={round.inPlay}
            onClick={() =>
              mutate((draft) => {
                draft.push({ name: 'New category', clues: [{ value: 100, prompt: 'New clue' }] });
              })
            }
          >
            + Category
          </button>
        )}
      </div>

      {clue && current ? (
        <article className="item-card">
          <header className="item-head">
            <span className="item-no">
              {categories[current.category].name || 'Category'} · {clue.value ?? '—'}
            </span>
            <RowTools
              onDelete={
                (categories[current.category].clues?.length ?? 0) > 1
                  ? () => {
                      if (!confirm('Delete this clue?')) return;
                      setSelected(null);
                      mutate((draft) => {
                        draft[current.category].clues!.splice(current.clue, 1);
                      });
                    }
                  : undefined
              }
              disabled={round.inPlay}
              deleteTitle="Delete this clue"
            >
              <button
                className="mini preview"
                disabled={!String(clue.prompt ?? '').trim()}
                onClick={() =>
                  onPreview({
                    prompt: String(clue.prompt ?? ''),
                    answer: clue.answer ? String(clue.answer) : undefined,
                    media: previewMedia(clue),
                  })
                }
                title="Put this clue on the television without playing the round"
              >
                ▶ Preview on TV
              </button>
            </RowTools>
          </header>

          <div className="field-row">
            <NumberField
              label="Value"
              min={1}
              value={typeof clue.value === 'number' ? clue.value : null}
              onChange={(v) =>
                mutate((draft) => {
                  const target = draft[current.category].clues![current.clue];
                  if (v === '') delete target.value;
                  else target.value = v;
                })
              }
            />
            <label className="field narrow wager-field">
              <span className="field-label">Daily double</span>
              <input
                type="checkbox"
                checked={Boolean(clue.wager)}
                onChange={(e) =>
                  mutate((draft) => {
                    const target = draft[current.category].clues![current.clue];
                    if (e.target.checked) target.wager = true;
                    else delete target.wager;
                  })
                }
              />
              <span className="field-hint">The TV never shows which square it is.</span>
            </label>
          </div>

          <TextField
            label="Clue"
            required
            multiline
            value={clue.prompt === undefined ? '' : String(clue.prompt)}
            onChange={(v) =>
              mutate((draft) => {
                draft[current.category].clues![current.clue].prompt = v;
              })
            }
          />

          <div className="field-row">
            <TextField
              label="Answer"
              multiline
              value={clue.answer === undefined ? '' : String(clue.answer)}
              onChange={(v) =>
                mutate((draft) => {
                  const target = draft[current.category].clues![current.clue];
                  if (v === '') delete target.answer;
                  else target.answer = v;
                })
              }
              hint="Held back from the TV until you tap Reveal."
            />
            <TextField
              label="Note"
              multiline
              value={clue.note === undefined ? '' : String(clue.note)}
              onChange={(v) =>
                mutate((draft) => {
                  const target = draft[current.category].clues![current.clue];
                  if (v === '') delete target.note;
                  else target.note = v;
                })
              }
              hint="Host-only."
            />
          </div>

          <div className="field-row">
            <MediaPicker
              label="Picture"
              kind="image"
              value={clue.media?.image}
              assets={assets}
              passphrase={passphrase}
              onChange={(ref) =>
                mutate((draft) => {
                  const target = draft[current.category].clues![current.clue];
                  const media = { ...(target.media ?? {}) };
                  if (ref === '') delete media.image;
                  else media.image = ref;
                  if (Object.keys(media).length === 0) delete target.media;
                  else target.media = media;
                })
              }
            />
          </div>
        </article>
      ) : (
        <p className="hint">Pick a square to edit its clue.</p>
      )}

      {/* Said out loud, because it is the one place this editor gives something
          up that the rest of the file keeps. */}
      <p className="field-hint">
        A board is written back as one block, so any edit here re-formats the whole grid and drops comments written
        inside it by hand. The rest of the file — and its comments — are left alone.
      </p>
    </div>
  );
}
