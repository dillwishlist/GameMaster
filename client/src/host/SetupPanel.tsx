import { useState } from 'react';
import type { Entrant, HostState } from '../../../shared/types.js';
import type { GameEventInput } from '../../../shared/events.js';
import { Avatar } from '../components/Avatar.js';

/**
 * Host onboarding: the only path into the game that has to exist.
 *
 * The host creates entrants here before play, picking a face from
 * ./content/avatars. No device, no join code, no lobby. A two-year-old does not
 * have a phone; player self-join is Phase 3 and is expected to be cut.
 *
 * Typing happens here and only here — before the game starts, never during it.
 */
export function SetupPanel({
  state,
  dispatch,
  command,
  onClose,
}: {
  state: HostState;
  dispatch: (event: GameEventInput) => void;
  command: (name: 'undo' | 'redo' | 'resetSession') => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<Entrant | null>(null);
  const [name, setName] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);

  const add = () => {
    const displayName = name.trim();
    if (!displayName) return;
    dispatch({ type: 'ENTRANT_ADD', entrant: { id: makeId(displayName, state.entrants), displayName } });
    setName('');
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet setup" onClick={(e) => e.stopPropagation()}>
        <header className="setup-header">
          <h2>Who is playing?</h2>
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </header>

        <div className="setup-add">
          <input
            value={name}
            placeholder="Name, team or pair"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            autoCapitalize="words"
          />
          <button className="btn btn-primary" onClick={add} disabled={!name.trim()}>
            Add
          </button>
        </div>

        <ul className="setup-list">
          {state.entrants.map((entrant) => (
            <li key={entrant.id} className={entrant.active ? '' : 'inactive'}>
              <button className="setup-face" onClick={() => setEditing(editing?.id === entrant.id ? null : entrant)}>
                <Avatar src={entrant.avatar} name={entrant.displayName} color={entrant.color} />
              </button>
              <div className="setup-meta">
                <strong>{entrant.displayName}</strong>
                <span>
                  {entrant.members.length > 1 ? `${entrant.members.length} members · ` : ''}
                  {entrant.score} pt
                </span>
              </div>
              <button
                className="btn"
                onClick={() =>
                  dispatch({ type: 'ENTRANT_UPDATE', entrantId: entrant.id, patch: { active: !entrant.active } })
                }
                title="Drop-outs stay in the log but leave the board"
              >
                {entrant.active ? 'Sit out' : 'Rejoin'}
              </button>
              <button className="btn btn-danger" onClick={() => dispatch({ type: 'ENTRANT_REMOVE', entrantId: entrant.id })}>
                Remove
              </button>
            </li>
          ))}
        </ul>

        {editing && (
          <div className="setup-avatars">
            <h3>Face for {editing.displayName}</h3>
            <div className="avatar-choices">
              {state.avatarChoices.map((choice) => (
                <button
                  key={choice}
                  className={editing.avatar === choice ? 'chosen' : ''}
                  onClick={() => dispatch({ type: 'ENTRANT_UPDATE', entrantId: editing.id, patch: { avatar: choice } })}
                >
                  <img src={choice} alt="" />
                </button>
              ))}
              <button
                onClick={() =>
                  dispatch({
                    type: 'ENTRANT_UPDATE',
                    entrantId: editing.id,
                    patch: { avatar: `initial:${[...editing.displayName][0]?.toUpperCase() ?? '?'}` },
                  })
                }
              >
                <span className="avatar avatar-initial" style={{ background: editing.color }}>
                  {[...editing.displayName][0]?.toUpperCase()}
                </span>
              </button>
            </div>
            {state.avatarChoices.length === 0 && (
              <p className="hint">
                Drop photos into <code>content/avatars/</code> and they appear here.
              </p>
            )}
          </div>
        )}

        <footer className="setup-footer">
          <p className="hint">
            Session <code>{state.sessionId}</code> · every tap is logged and undoable.
          </p>
          {confirmReset ? (
            <button className="btn btn-danger" onClick={() => { command('resetSession'); setConfirmReset(false); }}>
              Tap again to wipe all scores
            </button>
          ) : (
            <button className="btn" onClick={() => setConfirmReset(true)}>
              Start fresh session
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

/** Stable, readable ids so `restrictTo: [lucy]` in the content file matches. */
function makeId(displayName: string, existing: Entrant[]): string {
  const base =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'entrant';
  if (!existing.some((e) => e.id === base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!existing.some((e) => e.id === candidate)) return candidate;
  }
}
