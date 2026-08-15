/**
 * One question of a `manual` or `multipleChoice` round.
 *
 * The fields are exactly the ones `docs/CONTENT.md` lists for the type, and no
 * others — the round schemas are `.strict()`, so a key this form invents is a
 * round that will not load. The purpose of the whole screen is that the host
 * never has to open that document to know what a round type accepts.
 */

import { NumberField, RowTools, TextField } from './Fields.js';
import { MediaPicker } from './MediaPicker.js';
import type { EditItem, EditOp, EditRound, PreviewPayload } from './types.js';
import { assetUrl } from './types.js';

const LETTERS = 'ABCDEFGH';
/** The schema's own bounds; enforced here so the host is never offered an illegal edit. */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = LETTERS.length;

export function ItemEditor({
  round,
  index,
  item,
  count,
  assets,
  passphrase,
  edit,
  onPreview,
}: {
  round: EditRound;
  index: number;
  item: EditItem;
  count: number;
  assets: string[];
  passphrase: string | undefined;
  edit: (op: EditOp) => void;
  onPreview: (payload: PreviewPayload) => void;
}) {
  const set = (path: string[], value: unknown) =>
    edit({ op: 'setItemField', roundId: round.id, index, path, value });

  const options = Array.isArray(item.options) ? item.options : [];
  const correctIndex = LETTERS.indexOf(String(item.correct ?? '').trim().toUpperCase());
  const isChoice = round.type === 'multipleChoice';

  /**
   * Options are written back as a whole list, and `correct` travels with them:
   * it is stored as a letter, so deleting option B silently promotes C's text
   * into the right answer unless the letter is fixed in the same breath.
   */
  const writeOptions = (next: string[], nextCorrect: number) => {
    set(['options'], next);
    const letter = LETTERS[Math.max(0, Math.min(nextCorrect, next.length - 1))];
    if (letter !== item.correct) set(['correct'], letter);
  };

  return (
    <article className="item-card">
      <header className="item-head">
        <span className="item-no">Q{index + 1}</span>
        <RowTools
          onUp={index > 0 ? () => edit({ op: 'moveItem', roundId: round.id, from: index, to: index - 1 }) : undefined}
          onDown={
            index < count - 1 ? () => edit({ op: 'moveItem', roundId: round.id, from: index, to: index + 1 }) : undefined
          }
          onDelete={count > 1 ? () => edit({ op: 'removeItem', roundId: round.id, index }) : undefined}
          disabled={round.inPlay}
          deleteTitle="Delete this question"
        >
          <button
            className="mini preview"
            onClick={() =>
              onPreview({
                prompt: String(item.prompt ?? ''),
                answer: previewAnswer(item, isChoice, correctIndex, options),
                media: previewMedia(item),
              })
            }
            disabled={!String(item.prompt ?? '').trim()}
            title="Put this on the television without playing the round"
          >
            ▶ Preview on TV
          </button>
        </RowTools>
      </header>

      <TextField label="Prompt" value={item.prompt} required multiline onChange={(v) => set(['prompt'], v)} />

      {isChoice && (
        <div className="options">
          <span className="field-label">
            Options <em className="req">2 to 8 — the radio marks the right one</em>
          </span>
          {options.map((option, i) => (
            <div key={i} className="option-row">
              <label className="option-correct" title="This is the correct answer">
                <input
                  type="radio"
                  name={`correct-${round.id}-${index}`}
                  checked={correctIndex === i}
                  onChange={() => set(['correct'], LETTERS[i])}
                />
                <b>{LETTERS[i]}</b>
              </label>
              <input
                className="field-input"
                value={option}
                onChange={(e) => {
                  const next = [...options];
                  next[i] = e.target.value;
                  set(['options'], next);
                }}
              />
              <RowTools
                onUp={
                  i > 0
                    ? () => {
                        const next = [...options];
                        [next[i - 1], next[i]] = [next[i], next[i - 1]];
                        writeOptions(next, correctIndex === i ? i - 1 : correctIndex === i - 1 ? i : correctIndex);
                      }
                    : undefined
                }
                onDown={
                  i < options.length - 1
                    ? () => {
                        const next = [...options];
                        [next[i], next[i + 1]] = [next[i + 1], next[i]];
                        writeOptions(next, correctIndex === i ? i + 1 : correctIndex === i + 1 ? i : correctIndex);
                      }
                    : undefined
                }
                onDelete={
                  options.length > MIN_OPTIONS
                    ? () => {
                        const next = options.filter((_, j) => j !== i);
                        writeOptions(next, correctIndex > i ? correctIndex - 1 : correctIndex === i ? 0 : correctIndex);
                      }
                    : undefined
                }
                deleteTitle={options.length > MIN_OPTIONS ? 'Remove this option' : 'A question needs two options'}
              />
            </div>
          ))}
          <button
            className="mini"
            disabled={options.length >= MAX_OPTIONS}
            onClick={() => writeOptions([...options, ''], correctIndex < 0 ? 0 : correctIndex)}
          >
            + Option
          </button>
          {correctIndex < 0 && <p className="field-error">No correct option chosen — this round will not load.</p>}
        </div>
      )}

      <div className="field-row">
        <TextField
          label={isChoice ? 'Answer (the story behind it, read on reveal)' : 'Answer'}
          value={item.answer}
          multiline
          onChange={(v) => set(['answer'], v)}
          hint="Held back from the TV until you tap Reveal."
        />
        <TextField
          label="Note"
          value={item.note}
          multiline
          onChange={(v) => set(['note'], v)}
          hint="Host-only. Nobody else sees it."
        />
        <NumberField
          label="Points"
          value={typeof item.points === 'number' ? item.points : null}
          placeholder={String(round.defaultPoints ?? 1)}
          onChange={(v) => set(['points'], v)}
        />
      </div>

      <div className="field-row">
        <MediaPicker
          label="Picture"
          kind="image"
          value={item.media?.image}
          assets={assets}
          passphrase={passphrase}
          onChange={(ref) => set(['media', 'image'], ref)}
        />
        <MediaPicker
          label="Sound cue"
          kind="audio"
          value={item.media?.audio}
          assets={assets}
          passphrase={passphrase}
          onChange={(ref) => set(['media', 'audio'], ref)}
        />
      </div>
    </article>
  );
}

/**
 * The preview channel renders a `manual`-shaped payload — a prompt, a picture
 * and an answer — so the option list is not drawn. Folding the correct option
 * into the answer line keeps the preview honest about what the host will read
 * out, rather than showing a question with no visible answer at all.
 */
function previewAnswer(item: EditItem, isChoice: boolean, correctIndex: number, options: string[]): string | undefined {
  if (!isChoice) return item.answer ? String(item.answer) : undefined;
  const correct = correctIndex >= 0 ? `${LETTERS[correctIndex]}. ${options[correctIndex] ?? ''}` : undefined;
  return [correct, item.answer].filter(Boolean).join(' — ') || undefined;
}

/** Refs in the file are content-relative; the TV needs a URL. */
export function previewMedia(item: { media?: { image?: string; audio?: string } }): PreviewPayload['media'] {
  const image = assetUrl(item.media?.image);
  const audio = assetUrl(item.media?.audio);
  return image || audio ? { image, audio } : undefined;
}
