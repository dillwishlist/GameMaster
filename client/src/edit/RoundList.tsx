/**
 * The rounds, down the left. Play order top to bottom, which is the order the
 * file lists them in and the order the host's dropdown will show on the day.
 *
 * Broken rounds are listed here too, at the bottom. They are the only thing in
 * the file that is invisible in the game — quarantined at load, absent from the
 * round picker — so an editor that showed only the working ones would be
 * hiding the one thing the host most needs to know about.
 */

import { useState } from 'react';
import type { ContentModel, EditOp } from './types.js';
import { questionCount } from './types.js';

export function RoundList({
  model,
  selectedId,
  onSelect,
  edit,
}: {
  model: ContentModel;
  selectedId: string | null;
  onSelect: (id: string) => void;
  edit: (op: EditOp) => void;
}) {
  const [newType, setNewType] = useState('manual');
  const broken = Object.entries(model.brokenRounds);

  const addRound = () => {
    const round = newRound(newType, model);
    edit({ op: 'addRound', index: model.rounds.length, round });
    onSelect(String(round.id));
  };

  return (
    <nav className="round-list">
      <ol>
        {model.rounds.map((round, index) => (
          <li key={round.id} className={round.id === selectedId ? 'selected' : ''}>
            <button className="round-pick" onClick={() => onSelect(round.id)}>
              <strong>{round.title || <em>untitled</em>}</strong>
              <span className="round-meta">
                {round.type} · {questionCount(round)} {questionCount(round) === 1 ? 'question' : 'questions'}
                {round.inPlay && <span className="badge live">on the TV</span>}
                {round.restrictTo?.length ? <span className="badge">restricted</span> : null}
              </span>
            </button>
            <span className="row-tools">
              <button
                className="mini"
                disabled={index === 0}
                title="Move up"
                onClick={() => edit({ op: 'moveRound', roundId: round.id, toIndex: index - 1 })}
              >
                ↑
              </button>
              <button
                className="mini"
                disabled={index === model.rounds.length - 1}
                title="Move down"
                onClick={() => edit({ op: 'moveRound', roundId: round.id, toIndex: index + 1 })}
              >
                ↓
              </button>
              <button
                className="mini danger"
                // The server refuses to delete the round on the TV, so the
                // button says why instead of bouncing off a 409.
                disabled={round.inPlay || model.rounds.length === 1}
                title={
                  round.inPlay
                    ? 'This round is on the TV right now'
                    : model.rounds.length === 1
                      ? 'A game needs at least one round'
                      : 'Delete this round'
                }
                onClick={() => {
                  if (!confirm(`Delete "${round.title}" and its ${questionCount(round)} questions?`)) return;
                  edit({ op: 'removeRound', roundId: round.id });
                }}
              >
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>

      <div className="round-add">
        <select value={newType} onChange={(e) => setNewType(e.target.value)}>
          {model.roundTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        <button className="btn" onClick={addRound}>
          + Round
        </button>
      </div>

      {broken.length > 0 && (
        <section className="broken">
          <h3>Broken — not in the game</h3>
          {broken.map(([id, error]) => (
            <div key={id} className="broken-round">
              <div className="broken-head">
                <code>{id}</code>
                <button
                  className="mini danger"
                  title="Remove this round from the file"
                  onClick={() => {
                    if (!confirm(`Delete the broken round "${id}" from the file?`)) return;
                    edit({ op: 'removeRound', roundId: id });
                  }}
                >
                  ✕
                </button>
              </div>
              <pre>{error}</pre>
            </div>
          ))}
          <p className="field-hint">
            These are quarantined at load: the rest of the game plays, but the host cannot select them. Fix them in{' '}
            <code>{model.file}</code>, or delete them here.
          </p>
        </section>
      )}
    </nav>
  );
}

/**
 * A new round arrives complete enough to load: an id nothing else uses, and one
 * valid question. Anything less and the very next save is a validation error
 * the host did not ask for.
 */
function newRound(type: string, model: ContentModel): Record<string, unknown> {
  const taken = new Set([...model.rounds.map((r) => r.id), ...Object.keys(model.brokenRounds)]);
  let id = 'new-round';
  for (let n = 2; taken.has(id); n++) id = `new-round-${n}`;

  const base = { id, type, title: 'New round' };
  if (type === 'board') {
    return { ...base, categories: [{ name: 'Category', clues: [{ value: 100, prompt: 'New clue' }] }] };
  }
  if (type === 'multipleChoice') {
    return {
      ...base,
      items: [{ prompt: 'New question', options: ['First option', 'Second option'], correct: 'A' }],
    };
  }
  return { ...base, items: [{ prompt: 'New question' }] };
}
