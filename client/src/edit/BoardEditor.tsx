/**
 * The `board` grid, edited as a grid: categories across the top, clues down.
 *
 * A board addresses its questions by column and row rather than by a flat
 * index, so it has its own half of the edit API — `setClueField`, `addClue`,
 * `moveCategory` and the rest. They splice the same YAML nodes the item
 * operations do, which is what keeps a comment written beside one clue when the
 * clue next to it is reworded.
 *
 * Adding, removing or reordering anything here is structural, and the server
 * refuses a structural change to a round that is on the TV — squares are
 * addressed by position, so moving one would move the round underneath itself
 * and could put an already-played answer on the screen. This form disables
 * those controls for the same reason, so the host is told before they type
 * rather than after they save.
 */

import { useState } from 'react';
import { NumberField, RowTools, TextField } from './Fields.js';
import { MediaPicker } from './MediaPicker.js';
import { previewMedia } from './ItemEditor.js';
import { categoriesOf } from './types.js';
import type { EditOp, EditRound, PreviewPayload } from './types.js';

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

  // A deleted square leaves the panel below pointing at nothing.
  const current = selected && categories[selected.category]?.clues?.[selected.clue] ? selected : null;
  const clue = current ? categories[current.category].clues![current.clue] : null;
  const setClue = (path: string[], value: unknown) =>
    current && edit({ op: 'setClueField', roundId: round.id, category: current.category, clue: current.clue, path, value });

  const rows = Math.max(1, ...categories.map((c) => c.clues?.length ?? 0));

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
                onChange={(e) => edit({ op: 'setCategoryName', roundId: round.id, category: c, value: e.target.value })}
              />
              <RowTools
                onDelete={
                  categories.length > 1
                    ? () => {
                        if (!confirm(`Delete the whole "${category.name ?? 'unnamed'}" column and its clues?`)) return;
                        setSelected(null);
                        edit({ op: 'removeCategory', roundId: round.id, index: c });
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
                  onClick={() => {
                    setSelected(null);
                    edit({ op: 'moveCategory', roundId: round.id, from: c, to: c - 1 });
                  }}
                >
                  ‹
                </button>
                <button
                  className="mini"
                  title="Move this column right"
                  disabled={round.inPlay || c === categories.length - 1}
                  onClick={() => {
                    setSelected(null);
                    edit({ op: 'moveCategory', roundId: round.id, from: c, to: c + 1 });
                  }}
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
                edit({
                  op: 'addClue',
                  roundId: round.id,
                  category: c,
                  index: category.clues?.length ?? 0,
                  clue: { value: nextValue(category.clues), prompt: 'New clue' },
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
              edit({
                op: 'addCategory',
                roundId: round.id,
                index: categories.length,
                category: { name: 'New category', clues: [{ value: 100, prompt: 'New clue' }] },
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
              onUp={
                current.clue > 0
                  ? () => {
                      edit({ op: 'moveClue', roundId: round.id, category: current.category, from: current.clue, to: current.clue - 1 });
                      setSelected({ category: current.category, clue: current.clue - 1 });
                    }
                  : undefined
              }
              onDown={
                current.clue < (categories[current.category].clues?.length ?? 0) - 1
                  ? () => {
                      edit({ op: 'moveClue', roundId: round.id, category: current.category, from: current.clue, to: current.clue + 1 });
                      setSelected({ category: current.category, clue: current.clue + 1 });
                    }
                  : undefined
              }
              onDelete={
                (categories[current.category].clues?.length ?? 0) > 1
                  ? () => {
                      if (!confirm('Delete this clue?')) return;
                      setSelected(null);
                      edit({ op: 'removeClue', roundId: round.id, category: current.category, index: current.clue });
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
              onChange={(v) => setClue(['value'], v)}
            />
            <label className="field narrow wager-field">
              <span className="field-label">Daily double</span>
              <input
                type="checkbox"
                checked={Boolean(clue.wager)}
                // Unticking removes the key rather than writing `wager: false`,
                // which would read as a deliberate setting to the next human.
                onChange={(e) => setClue(['wager'], e.target.checked ? true : '')}
              />
              <span className="field-hint">The TV never shows which square it is.</span>
            </label>
          </div>

          <TextField
            label="Clue"
            required
            multiline
            value={clue.prompt === undefined ? '' : String(clue.prompt)}
            onChange={(v) => setClue(['prompt'], v)}
          />

          <div className="field-row">
            <TextField
              label="Answer"
              multiline
              value={clue.answer === undefined ? '' : String(clue.answer)}
              onChange={(v) => setClue(['answer'], v)}
              hint="Held back from the TV until you tap Reveal."
            />
            <TextField
              label="Note"
              multiline
              value={clue.note === undefined ? '' : String(clue.note)}
              onChange={(v) => setClue(['note'], v)}
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
              onChange={(ref) => setClue(['media', 'image'], ref)}
            />
          </div>
        </article>
      ) : (
        <p className="hint">Pick a square to edit its clue.</p>
      )}
    </div>
  );
}

/**
 * Values normally step down a column, so a new square guesses the next one
 * rather than making the host type 100, 200, 300 by hand.
 */
function nextValue(clues: { value?: number }[] | undefined): number {
  if (!clues || clues.length === 0) return 100;
  const step = clues.length > 1 ? Number(clues[1].value ?? 200) - Number(clues[0].value ?? 100) : 100;
  return Number(clues[clues.length - 1].value ?? 0) + (step || 100);
}
