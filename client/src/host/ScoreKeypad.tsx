import { useState } from 'react';
import type { Entrant } from '../../../shared/types.js';

/**
 * The escape hatch. Never let the host be trapped by the software's opinion of
 * the score: any score can be set to any number, by hand, in two taps.
 *
 * A keypad rather than a text field, because nothing on the host screen may
 * require typing during play.
 */
export function ScoreKeypad({
  entrant,
  onSet,
  onNudge,
  onClose,
}: {
  entrant: Entrant;
  onSet: (score: number) => void;
  onNudge: (delta: number) => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState<string | null>(null);
  const shown = typed === null ? String(entrant.score) : typed || '0';

  const digit = (d: string) => setTyped((t) => ((t ?? '') + d).slice(0, 4));

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet keypad" onClick={(e) => e.stopPropagation()}>
        <header>
          <strong>{entrant.displayName}</strong>
          <span className="keypad-value">{shown}</span>
        </header>

        <div className="keypad-nudge">
          {[-5, -1, +1, +5].map((n) => (
            <button key={n} onClick={() => onNudge(n)}>
              {n > 0 ? `+${n}` : n}
            </button>
          ))}
        </div>

        <div className="keypad-grid">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => digit(d)}>
              {d}
            </button>
          ))}
          <button onClick={() => setTyped((t) => (t ? t.slice(0, -1) : ''))}>⌫</button>
          <button onClick={() => digit('0')}>0</button>
          <button onClick={() => setTyped((t) => ((t ?? '').startsWith('-') ? (t ?? '').slice(1) : `-${t ?? ''}`))}>
            ±
          </button>
        </div>

        <div className="keypad-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={typed === null || typed === '' || typed === '-'}
            onClick={() => {
              const value = Number(typed);
              if (Number.isFinite(value)) onSet(value);
              onClose();
            }}
          >
            Set score
          </button>
        </div>
      </div>
    </div>
  );
}
