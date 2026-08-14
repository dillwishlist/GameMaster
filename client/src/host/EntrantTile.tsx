import { useRef } from 'react';
import type React from 'react';
import type { Entrant } from '../../../shared/types.js';
import { Avatar } from '../components/Avatar.js';

const LONG_PRESS_MS = 550;
/** Beyond this, the finger is scrolling or wandering, not tapping a face. */
const DRAG_CANCEL_PX = 40;

/**
 * The tap target that decides the game. Minimum 88pt, photo first, score
 * visible without reading a name.
 *
 * Tap awards. Long-press deducts — as does a tap while the host has flipped
 * the deduct switch, because a long-press is hard to land while holding a
 * child and talking to a room.
 */
export function EntrantTile({
  entrant,
  points,
  awarded,
  disabled,
  deductMode,
  onAward,
  onEditScore,
  index,
}: {
  entrant: Entrant;
  points: number;
  awarded: number;
  disabled: boolean;
  deductMode: boolean;
  onAward: (points: number) => void;
  onEditScore: () => void;
  index: number;
}) {
  const timer = useRef<number | null>(null);
  const longPressed = useRef(false);
  const dragged = useRef(false);
  const origin = useRef<{ x: number; y: number } | null>(null);

  const clear = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    longPressed.current = false;
    dragged.current = false;
    origin.current = { x: e.clientX, y: e.clientY };
    timer.current = window.setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(20);
      onAward(-Math.abs(points));
    }, LONG_PRESS_MS);
  };

  /**
   * Touch pointers get implicit capture, so `pointerleave` never fires while a
   * finger is down and `pointerup` is retargeted back to this tile — a swipe
   * that merely began on a face used to score. Distance travelled is the
   * reliable signal: `pointerup` does not always carry usable coordinates,
   * but `pointermove` always does.
   */
  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!origin.current) return;
    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;
    if (dx * dx + dy * dy > DRAG_CANCEL_PX * DRAG_CANCEL_PX) {
      dragged.current = true;
      clear();
    }
  };

  const end = () => {
    clear();
    origin.current = null;
    if (disabled || longPressed.current || dragged.current) return;
    onAward(deductMode ? -Math.abs(points) : Math.abs(points));
  };

  return (
    <div className={`tile ${disabled ? 'tile-disabled' : ''} ${deductMode ? 'tile-deduct' : ''}`}>
      <button
        className="tile-main"
        style={{ borderColor: entrant.color }}
        disabled={disabled}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={clear}
        onPointerCancel={clear}
        onContextMenu={(e) => e.preventDefault()}
      >
        <Avatar src={entrant.avatar} name={entrant.displayName} color={entrant.color} className="tile-avatar" />
        <span className="tile-name">{entrant.displayName}</span>
        {awarded !== 0 && <span className="tile-awarded">{awarded > 0 ? `+${awarded}` : awarded}</span>}
        <span className="tile-index" aria-hidden>
          {index < 9 ? index + 1 : ''}
        </span>
      </button>
      <button className="tile-score" onClick={onEditScore} title="Set this score by hand">
        {entrant.score}
      </button>
    </div>
  );
}
