/**
 * `/edit` — the question editor.
 *
 * Deliberately not part of the run-day path. The YAML file stays the source of
 * truth: this screen reads it, sends operations back, and the file is what the
 * server plays. That is what keeps it safe to be half-finished — the party runs
 * off the file whatever happens here.
 *
 * It is also the one screen in the project where typing is fine. The rule that
 * nothing may require typing is about `/host` on a Sunday afternoon, not about
 * the evening spent writing the questions, and the strip at the bottom of this
 * screen says so.
 */

import { useEffect, useState } from 'react';
import type { HostState } from '../../../shared/types.js';
import { useConnection } from '../lib/connection.js';
import { PassphraseGate, usePassphrase } from '../host/PassphraseGate.js';
import { RoundList } from './RoundList.js';
import { RoundEditor } from './RoundEditor.js';
import { usePreviewChannel } from './preview.js';
import { useEditor } from './useEditor.js';
import '../styles/edit.css';

export function EditView() {
  const { passphrase, save: savePassphrase, required } = usePassphrase();
  const editor = useEditor(passphrase);
  const preview = usePreviewChannel(passphrase);
  /**
   * The host channel, for the two things only the live server knows: whether a
   * television is actually connected to preview onto, and whether the round
   * being edited has gone live since the file was loaded.
   */
  const { state: host, status } = useConnection<HostState>('host', 'host', passphrase);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const model = editor.model;

  // Follow the file: a round that was deleted, or a first load, has to leave a
  // valid selection behind or the right-hand pane renders nothing at all.
  useEffect(() => {
    if (!model) return;
    setSelectedId((current) => {
      if (current && model.rounds.some((r) => r.id === current)) return current;
      return model.rounds[0]?.id ?? null;
    });
  }, [model]);

  if (editor.forbidden || status === 'denied' || (required && !passphrase)) {
    return <PassphraseGate error={passphrase ? 'That passphrase was refused.' : null} onSubmit={savePassphrase} />;
  }

  if (!model) {
    return (
      <div className="host-loading">
        {editor.loading ? 'Loading the content file…' : (editor.loadError ?? 'No content')}
        {editor.loadError && !editor.loading && (
          <button className="btn" onClick={editor.reload}>
            Try again
          </button>
        )}
      </div>
    );
  }

  const round = model.rounds.find((r) => r.id === selectedId) ?? null;
  const dirty = editor.ops.length > 0;
  // The file is the truth, but the session decides what is live, and it can go
  // live while this page is open.
  const liveRoundId = host?.currentRoundId ?? null;

  return (
    <div className="edit">
      <header className="edit-top">
        <input
          className="edit-title"
          value={model.title}
          onChange={(e) => editor.edit({ op: 'setTitle', value: e.target.value })}
          title="The game title, shown on the TV before the first round"
        />

        <span className={`host-dot ${status === 'ready' ? 'ok' : 'bad'}`} title={`Connection: ${status}`} />
        <span className="host-dot-label">{(host?.displaysConnected ?? 0) > 0 ? 'TV ✓' : 'no TV'}</span>

        <span className={`save-state ${dirty ? 'dirty' : ''}`}>
          {editor.saving
            ? 'Saving…'
            : dirty
              ? `${editor.ops.length} unsaved change${editor.ops.length === 1 ? '' : 's'}`
              : editor.justSaved
                ? 'Saved'
                : 'No changes'}
        </span>
        <button className="btn btn-primary" disabled={!dirty || editor.saving} onClick={editor.save}>
          Save to file
        </button>
      </header>

      {preview.showing && (
        <div className="preview-bar">
          <strong>On the television now:</strong> <span className="preview-prompt">{preview.showing}</span>
          <button className="btn btn-danger" onClick={preview.clear}>
            Stop preview
          </button>
        </div>
      )}

      {editor.saveError && (
        <div className={`edit-banner ${editor.saveError.status === 422 ? 'invalid' : ''}`}>
          <div className="edit-banner-head">
            <strong>
              {editor.saveError.status === 409
                ? 'Not saved — something else moved'
                : editor.saveError.status === 422
                  ? 'Not saved — the game could not load that'
                  : 'Not saved'}
            </strong>
            <span className="row-tools">
              {editor.saveError.status === 409 && (
                <button
                  className="mini"
                  onClick={() => {
                    if (dirty && !confirm('Reload from disk? Your unsaved changes are lost.')) return;
                    editor.reload();
                  }}
                >
                  Reload from disk
                </button>
              )}
              <button className="mini" onClick={editor.dismissError}>
                Dismiss
              </button>
            </span>
          </div>
          <pre>{editor.saveError.message}</pre>
          {/* The edits are still in the queue: fix the field the message points
              at and press Save again. Nothing has been lost. */}
          <p className="field-hint">
            {editor.saveError.detail ?? 'Nothing was written.'} Your {editor.ops.length} change
            {editor.ops.length === 1 ? '' : 's'} {editor.ops.length === 1 ? 'is' : 'are'} still here — fix it and save
            again.
          </p>
        </div>
      )}

      <div className="edit-body">
        <RoundList model={model} selectedId={selectedId} onSelect={setSelectedId} edit={editor.edit} />

        <main className="edit-pane">
          {round ? (
            <RoundEditor
              model={model}
              round={{ ...round, inPlay: round.inPlay || round.id === liveRoundId }}
              passphrase={passphrase}
              edit={editor.edit}
              onPreview={preview.show}
            />
          ) : (
            <p className="hint">Pick a round on the left.</p>
          )}
        </main>
      </div>

      <footer className="edit-foot">
        <span>
          Editing <code>{model.file}</code> — the file the game plays. Typing is fine here; the no-typing rule is about
          the host view during play.
        </span>
        <span className="field-hint">
          Every save is a hot reload, and the file keeps the comments you wrote around what you did not touch.
        </span>
      </footer>
    </div>
  );
}
