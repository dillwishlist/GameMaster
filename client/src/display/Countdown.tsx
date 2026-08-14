import { useEffect, useState } from 'react';
import type { TimerView } from '../../../shared/types.js';

/**
 * The server sends an absolute `endsAt` taken from the event timestamp, never a
 * remaining-seconds count, so the display and the host agree even if one of
 * them reconnects halfway through.
 */
export function Countdown({ timer }: { timer: TimerView }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!timer.running) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [timer.running, timer.endsAt]);

  const remaining = Math.max(0, timer.endsAt - now);
  const seconds = Math.ceil(remaining / 1000);
  const fraction = timer.durationMs > 0 ? remaining / timer.durationMs : 0;

  return (
    <div className={`countdown ${remaining === 0 ? 'done' : ''}`}>
      <div className="countdown-bar" style={{ width: `${Math.min(100, fraction * 100)}%` }} />
      <span className="countdown-value">{seconds}</span>
    </div>
  );
}
