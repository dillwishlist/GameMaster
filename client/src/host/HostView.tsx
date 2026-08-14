import { useEffect, useMemo, useState } from 'react';
import type { Entrant, HostState } from '../../../shared/types.js';
import type { RoundEvent } from '../../../shared/events.js';
import { useConnection, useWakeLock } from '../lib/connection.js';
import { BoardGrid, boardHostExtra } from './BoardGrid.js';
import { EntrantTile } from './EntrantTile.js';
import { ScoreKeypad } from './ScoreKeypad.js';
import { SetupPanel } from './SetupPanel.js';
import { PassphraseGate, usePassphrase } from './PassphraseGate.js';
import '../styles/host.css';

/**
 * The most important screen in the project. Designed for someone standing up,
 * holding a tablet, talking to a room, occasionally holding a child.
 *
 * It is also the wifi-failure fallback: the same layout has to work in a window
 * on the laptop with a mouse and a keyboard, because if the iPad drops off the
 * network the party does not stop — the host sits down instead.
 */
export function HostView() {
  useWakeLock();
  const { passphrase, save, required } = usePassphrase();
  const { state, status, error, dispatch, command } = useConnection<HostState>('host', 'host', passphrase);

  const [keypadFor, setKeypadFor] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [deductMode, setDeductMode] = useState(false);

  const round = state?.round ?? null;
  const roundId = state?.currentRoundId ?? null;

  const roundEvent = useMemo(
    () => (event: RoundEvent) => {
      if (roundId) dispatch({ type: 'ROUND_EVENT', roundId, event });
    },
    [dispatch, roundId],
  );

  const award = (entrant: Entrant, points: number) => {
    // With no round selected the host can still award — the escape hatch has to
    // work before the first round and after the last one.
    if (roundId) roundEvent({ type: 'AWARD', entrantId: entrant.id, points });
    else dispatch({ type: 'AWARD_POINTS', entrantId: entrant.id, points });
  };

  useHostKeys(state, { roundEvent, command, award });

  if (status === 'denied' || (required && !passphrase)) {
    return <PassphraseGate error={error} onSubmit={save} />;
  }
  if (!state) {
    return <div className="host-loading">Connecting…{status === 'offline' ? ' (server unreachable)' : ''}</div>;
  }

  const points = Number((round?.extra as { points?: number } | undefined)?.points ?? state.defaultPoints ?? 1);
  const awards = (round?.extra as { awards?: Record<string, number> } | undefined)?.awards ?? {};
  const note = (round?.extra as { note?: string } | undefined)?.note;
  const options = (round?.extra as { options?: { label: string; text: string }[] } | undefined)?.options;
  const correctLabel = (round?.extra as { correctLabel?: string } | undefined)?.correctLabel;
  const board = boardHostExtra(round);
  const entrants = state.entrants.filter((e) => e.active);
  const keypadEntrant = state.entrants.find((e) => e.id === keypadFor) ?? null;

  return (
    <div className={`host ${status === 'offline' ? 'host-offline' : ''}`}>
      <header className="host-top">
        <select
          className="round-picker"
          value={state.currentRoundId ?? ''}
          onChange={(e) => dispatch({ type: 'ROUND_SELECT', roundId: e.target.value || null })}
        >
          <option value="">— Scores / between rounds —</option>
          {state.rounds.map((r) => (
            <option key={r.id} value={r.id} disabled={Boolean(r.error)}>
              {r.title}
              {r.error ? ' (broken)' : ''}
            </option>
          ))}
        </select>

        {round && (
          <span className="host-progress">
            {round.itemIndex + 1} / {round.itemCount}
          </span>
        )}

        <span className={`host-dot ${status === 'ready' ? 'ok' : 'bad'}`} title={`Connection: ${status}`} />
        <span className="host-dot-label">{state.displaysConnected > 0 ? 'TV ✓' : 'no TV'}</span>

        <button className="btn" onClick={() => setSetupOpen(true)}>
          Players
        </button>
      </header>

      {state.contentError && (
        <div className="host-banner">Content file has an error — still using the last good version:<pre>{state.contentError}</pre></div>
      )}
      {state.rounds.some((r) => r.error) && (
        <div className="host-banner subtle">
          {state.rounds.filter((r) => r.error).map((r) => (
            <div key={r.id}>
              <strong>{r.id}</strong>: {r.error}
            </div>
          ))}
        </div>
      )}

      <main className="host-main">
        {/* The board owns its whole panel — grid, clue card and answer — because
            on a board the prompt only exists once a square is open. */}
        {round && board ? (
          <BoardGrid round={round} onEvent={roundEvent} />
        ) : round ? (
          <>
            <p className="host-prompt">{round.prompt}</p>
            {options && (
              <ol className="host-options">
                {options.map((o) => (
                  <li key={o.label} className={o.label === correctLabel ? 'correct' : ''}>
                    <b>{o.label}</b> {o.text}
                  </li>
                ))}
              </ol>
            )}
            {round.answer && (
              <p className={`host-answer ${round.revealed ? 'shown' : ''}`}>
                <span className="host-answer-label">Answer</span> {round.answer}
              </p>
            )}
            {note && <p className="host-note">{note}</p>}
            {round.media?.image && <img className="host-thumb" src={round.media.image} alt="" />}
          </>
        ) : (
          <p className="host-prompt dim">Pick a round above, or tap a face to adjust a score.</p>
        )}
      </main>

      <section className="host-tiles" style={{ ['--tile-count' as string]: String(entrants.length) }}>
        {entrants.map((entrant, i) => (
          <EntrantTile
            key={entrant.id}
            index={i}
            entrant={entrant}
            points={points}
            awarded={awards[entrant.id] ?? 0}
            disabled={Boolean(state.restrictTo && !state.restrictTo.includes(entrant.id))}
            deductMode={deductMode}
            onAward={(p) => award(entrant, p)}
            onEditScore={() => setKeypadFor(entrant.id)}
          />
        ))}
        {entrants.length === 0 && (
          <button className="btn btn-primary host-empty" onClick={() => setSetupOpen(true)}>
            Add the players →
          </button>
        )}
      </section>

      <footer className="host-transport">
        {/* A board has no linear order, so these two mean "back out of this
            square" and "done with this square". Relabelled rather than hidden:
            a button that moves the round must say what it does. */}
        <button className="btn big" disabled={!round?.can.prev} onClick={() => roundEvent({ type: 'PREV' })}>
          {board ? '‹ Wrong square' : '‹ Prev'}
        </button>
        <button
          className={`btn big ${round?.revealed ? '' : 'btn-primary'}`}
          // On a board there is nothing to reveal until a square is open. Other
          // round types keep the button live: `manual` reveals media too.
          disabled={!round || (Boolean(board) && !round.can.reveal)}
          onClick={() => roundEvent({ type: round?.revealed ? 'HIDE' : 'REVEAL' })}
        >
          {round?.revealed ? 'Hide' : 'Reveal'}
        </button>
        <button className="btn big" disabled={!round?.can.next} onClick={() => roundEvent({ type: 'NEXT' })}>
          {board ? 'Done ›' : 'Next ›'}
        </button>
        <button className={`btn big ${deductMode ? 'btn-danger' : ''}`} onClick={() => setDeductMode((d) => !d)}>
          {deductMode ? '− Deduct' : '+ Award'}
        </button>
        <button className="btn big btn-undo" disabled={!state.canUndo} onClick={() => command('undo')}>
          ↩ Undo
        </button>
        <button className="btn big" disabled={!state.canRedo} onClick={() => command('redo')}>
          ↪
        </button>
        <button className="btn big" onClick={() => dispatch({ type: 'ROUND_SELECT', roundId: nextRoundId(state) })}>
          {nextRoundId(state) ? 'Next round »' : 'Final scores'}
        </button>
      </footer>

      {keypadEntrant && (
        <ScoreKeypad
          entrant={keypadEntrant}
          onSet={(score) => dispatch({ type: 'SET_SCORE', entrantId: keypadEntrant.id, score })}
          onNudge={(delta) => dispatch({ type: 'AWARD_POINTS', entrantId: keypadEntrant.id, points: delta })}
          onClose={() => setKeypadFor(null)}
        />
      )}
      {setupOpen && (
        <SetupPanel state={state} dispatch={dispatch} command={command} onClose={() => setSetupOpen(false)} />
      )}
    </div>
  );
}

function nextRoundId(state: HostState): string | null {
  const playable = state.rounds.filter((r) => !r.error);
  const index = playable.findIndex((r) => r.id === state.currentRoundId);
  return playable[index + 1]?.id ?? null;
}

/**
 * Keyboard shortcuts exist for one reason: the wifi-down fallback, where the
 * host is sitting at the laptop with a keyboard instead of holding the iPad.
 */
function useHostKeys(
  state: HostState | null,
  actions: {
    roundEvent: (event: RoundEvent) => void;
    command: (name: 'undo' | 'redo' | 'resetSession') => void;
    award: (entrant: Entrant, points: number) => void;
  },
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!state) return;

      const entrants = state.entrants.filter((en) => en.active);
      if (/^[1-9]$/.test(e.key)) {
        const entrant = entrants[Number(e.key) - 1];
        if (entrant) actions.award(entrant, e.shiftKey ? -1 : 1);
        return;
      }
      switch (e.key) {
        case ' ':
          e.preventDefault();
          actions.roundEvent({ type: state.round?.revealed ? 'HIDE' : 'REVEAL' });
          break;
        case 'ArrowRight':
          actions.roundEvent({ type: 'NEXT' });
          break;
        case 'ArrowLeft':
          actions.roundEvent({ type: 'PREV' });
          break;
        case 'u':
        case 'z':
          actions.command('undo');
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, actions]);
}
