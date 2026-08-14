import { useEffect, useMemo, useState } from 'react';
import type { Entrant, HostRoundView, HostState } from '../../../shared/types.js';
import type { RoundEvent } from '../../../shared/events.js';
import { useConnection, useWakeLock } from '../lib/connection.js';
import { BoardGrid, boardHostExtra } from './BoardGrid.js';
import { EntrantTile } from './EntrantTile.js';
import { ScoreKeypad } from './ScoreKeypad.js';
import { SetupPanel } from './SetupPanel.js';
import { PassphraseGate, usePassphrase } from './PassphraseGate.js';
import { Countdown } from '../display/Countdown.js';
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
  const keyPoints = Number((round?.extra as { points?: number } | undefined)?.points ?? state?.defaultPoints ?? 1);

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

  // Removing an entrant closes their keypad; without clearing the id, re-adding
  // them — or an Undo that brings them back — reopened the sheet unprompted
  // over the whole host screen.
  useEffect(() => {
    if (keypadFor && state && !state.entrants.some((e) => e.id === keypadFor)) setKeypadFor(null);
  }, [state, keypadFor]);

  useHostKeys(state, {
    roundEvent,
    command,
    award,
    // The shortcuts exist for the wifi-down fallback, so they have to agree
    // with the buttons beside them — same points, same deduct switch.
    points: keyPoints,
    deductMode,
    // A modal is open: the host is typing a name, not playing.
    suspended: setupOpen || keypadFor !== null,
  });

  if (status === 'denied' || (required && !passphrase)) {
    // The first connect happens before /api/config answers, so the server
    // denies it and sets an error. Showing that on the untouched form reads as
    // "the passphrase is broken" on run day.
    return <PassphraseGate error={passphrase ? error : null} onSubmit={save} />;
  }
  if (!state) {
    return <div className="host-loading">Connecting…{status === 'offline' ? ' (server unreachable)' : ''}</div>;
  }

  const points = Number((round?.extra as { points?: number } | undefined)?.points ?? state.defaultPoints ?? 1);
  const awards = (round?.extra as { awards?: Record<string, number> } | undefined)?.awards ?? {};
  const note = (round?.extra as { note?: string } | undefined)?.note;
  const timerSeconds = (round?.extra as { timerSeconds?: number } | undefined)?.timerSeconds;
  const options = (round?.extra as { options?: { label: string; text: string }[] } | undefined)?.options;
  const correctLabel = (round?.extra as { correctLabel?: string } | undefined)?.correctLabel;
  const board = boardHostExtra(round);
  const entrants = state.entrants.filter((e) => e.active);
  // Derived from the id, so removing an entrant closes the sheet — but
  // re-adding them, or an Undo that brings them back, used to reopen it
  // unprompted over the whole host screen. Clearing the id on close settles it.
  const keypadEntrant = state.entrants.find((e) => e.id === keypadFor) ?? null;

  return (
    <div className={`host ${status === 'offline' ? 'host-offline' : ''}`}>
      <header className="host-top">
        <select
          className="round-picker"
          value={state.currentRoundId ?? ''}
          onChange={(e) => {
            // Hand focus back, or the next arrow key steps the dropdown and
            // silently changes round instead of moving to the next question.
            e.currentTarget.blur();
            dispatch({ type: 'ROUND_SELECT', roundId: e.target.value || null });
          }}
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
            <TimerControl round={round} timerSeconds={timerSeconds} onEvent={roundEvent} />
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

/**
 * The clock is theatre. Nothing expires on its own and no points move when it
 * hits zero — the host still decides, which is why this is a button and not a
 * behaviour. Only appears for a round whose content sets `timerSeconds`.
 */
function TimerControl({
  round,
  timerSeconds,
  onEvent,
}: {
  round: HostRoundView;
  timerSeconds: number | undefined;
  onEvent: (event: RoundEvent) => void;
}) {
  if (!timerSeconds) return null;
  const running = Boolean(round.timer?.running);

  return (
    <div className="host-timer">
      <button className={`btn ${running ? 'btn-danger' : ''}`} onClick={() => onEvent({ type: running ? 'TIMER_STOP' : 'TIMER_START' })}>
        {running ? '■ Stop' : `▶ Start ${timerSeconds}s`}
      </button>
      {round.timer && <Countdown timer={round.timer} />}
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
    points: number;
    deductMode: boolean;
    suspended: boolean;
  },
): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!state || actions.suspended) return;

      const entrants = state.entrants.filter((en) => en.active);

      // Matched on `code`, not `key`: with shift held, Digit1 arrives as "!"
      // on every common layout, so a `key` test silently made shift-to-deduct
      // dead code and fell through to the switch below.
      const digit = /^Digit([1-9])$/.exec(e.code);
      if (digit) {
        const entrant = entrants[Number(digit[1]) - 1];
        const magnitude = Math.abs(actions.points);
        if (entrant) actions.award(entrant, e.shiftKey || actions.deductMode ? -magnitude : magnitude);
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          actions.roundEvent({ type: state.round?.revealed ? 'HIDE' : 'REVEAL' });
          break;
        // Gated on what the transport itself allows. On a board these are
        // "consume this square" and "back out of it", so an arrow key pressed
        // out of habit would throw the open clue away in front of the room.
        case 'ArrowRight':
          if (state.round?.can.next) actions.roundEvent({ type: 'NEXT' });
          break;
        case 'ArrowLeft':
          if (state.round?.can.prev) actions.roundEvent({ type: 'PREV' });
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
