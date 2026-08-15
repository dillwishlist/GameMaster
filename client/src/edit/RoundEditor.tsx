/**
 * One round: the fields every round has, then the per-type question forms.
 *
 * The round-level rules that bite are handled here rather than left to a save
 * failure — `restrictTo` is picked from the real entrant list because a typed
 * id that matches nobody is a round where nobody can score, and `id` is shown
 * but not editable because renaming one mid-party takes the points scored
 * there with it.
 */

import { NumberField, TextField } from './Fields.js';
import { ItemEditor } from './ItemEditor.js';
import { BoardEditor } from './BoardEditor.js';
import { itemsOf } from './types.js';
import type { ContentModel, EditItem, EditOp, EditRound, PreviewPayload } from './types.js';

/** Types whose schema accepts a countdown. A type that does not is not offered one. */
const TIMED_TYPES = new Set(['manual', 'multipleChoice', 'board']);

export function RoundEditor({
  model,
  round,
  passphrase,
  edit,
  onPreview,
}: {
  model: ContentModel;
  round: EditRound;
  passphrase: string | undefined;
  edit: (op: EditOp) => void;
  onPreview: (payload: PreviewPayload) => void;
}) {
  const items = itemsOf(round);
  const restrictTo = round.restrictTo ?? [];
  const timerSeconds = round.config.timerSeconds;
  const setField = (field: string, value: unknown) => edit({ op: 'setRoundField', roundId: round.id, field, value });

  const toggleEntrant = (id: string) => {
    const next = restrictTo.includes(id) ? restrictTo.filter((e) => e !== id) : [...restrictTo, id];
    // An empty list is not "no restriction" — it is a round nobody can score
    // in. Clearing the last one removes the key instead.
    setField('restrictTo', next.length ? next : '');
  };

  return (
    <div className="round-editor">
      <header className="round-editor-head">
        <TextField label="Round title" value={round.title} required onChange={(v) => setField('title', v)} />
        <span className="round-id" title="Renaming this mid-party loses the points scored in the round, so it is not editable here.">
          <span className="field-label">id</span>
          <code>{round.id}</code>
        </span>
        <span className="round-id">
          <span className="field-label">type</span>
          <code>{round.type}</code>
        </span>
      </header>

      {round.inPlay && (
        <p className="inline-warning">
          This round is on the TV right now — rewording is fine, adding or removing questions is not.
        </p>
      )}

      <div className="field-row">
        <NumberField
          label="Points per tap"
          value={round.defaultPoints}
          placeholder="1"
          onChange={(v) => setField('defaultPoints', v)}
        />
        {(TIMED_TYPES.has(round.type) || timerSeconds !== undefined) && (
          <NumberField
            label="Timer (seconds)"
            min={1}
            value={typeof timerSeconds === 'number' ? timerSeconds : null}
            placeholder="none"
            onChange={(v) => setField('timerSeconds', v)}
          />
        )}
        <div className="field restrict">
          <span className="field-label">
            Who can score {restrictTo.length === 0 && <em className="req">everyone</em>}
          </span>
          <div className="chips">
            {model.entrants.map((entrant) => (
              <button
                key={entrant.id}
                className={`chip ${restrictTo.includes(entrant.id) ? 'on' : ''}`}
                onClick={() => toggleEntrant(entrant.id)}
                title={entrant.id}
              >
                {entrant.displayName}
              </button>
            ))}
            {model.entrants.length === 0 && <span className="field-hint">No entrants in the file to restrict to.</span>}
          </div>
          <span className="field-hint">
            Picked from the file's entrants, never typed: an id that matches nobody is a round where nobody can score.
          </span>
        </div>
      </div>

      {round.type === 'board' ? (
        <BoardEditor round={round} assets={model.assets} passphrase={passphrase} edit={edit} onPreview={onPreview} />
      ) : items.length === 0 && !Array.isArray(round.config.items) ? (
        <p className="inline-warning">
          This round type stores its questions somewhere this editor does not know about. Edit <code>{model.file}</code>{' '}
          by hand for it.
        </p>
      ) : (
        <>
          {items.map((item, index) => (
            <ItemEditor
              key={index}
              round={round}
              index={index}
              item={item}
              count={items.length}
              assets={model.assets}
              passphrase={passphrase}
              edit={edit}
              onPreview={onPreview}
            />
          ))}
          <button
            className="btn add-item"
            disabled={round.inPlay}
            title={round.inPlay ? 'This round is on the TV — add questions between rounds' : undefined}
            onClick={() =>
              edit({ op: 'addItem', roundId: round.id, index: items.length, item: newItem(round.type) })
            }
          >
            + Question
          </button>
        </>
      )}
    </div>
  );
}

/**
 * A new question is born valid. An empty prompt fails the schema, so a blank
 * one would mean the next save is a 422 the host did not cause — placeholder
 * text they overtype is kinder than an error they have to decode.
 */
function newItem(type: string): EditItem {
  if (type === 'multipleChoice') {
    return { prompt: 'New question', options: ['First option', 'Second option'], correct: 'A' };
  }
  return { prompt: 'New question' };
}
