import { useState } from 'react';

/**
 * Faces are the primary key of this UI. A pre-literate player finds herself by
 * photo, and the host taps the right person without reading. Names are
 * secondary everywhere they appear together.
 *
 * `initial:X` is the generated fallback, so an entrant created in a hurry still
 * has something face-shaped and colour-coded to aim at.
 */
export function Avatar({
  src,
  name,
  color,
  className = '',
}: {
  src: string;
  name: string;
  color: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const initial = src.startsWith('initial:') ? src.slice('initial:'.length) : [...name.trim()][0] ?? '?';

  if (!src || src.startsWith('initial:') || failed) {
    return (
      <div className={`avatar avatar-initial ${className}`} style={{ background: color }} aria-hidden>
        {initial.toUpperCase()}
      </div>
    );
  }

  return (
    <img
      className={`avatar ${className}`}
      style={{ borderColor: color }}
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
    />
  );
}
