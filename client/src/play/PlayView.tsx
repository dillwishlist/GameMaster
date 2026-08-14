import type { PlayerState } from '../../../shared/types.js';
import { useConnection } from '../lib/connection.js';

/**
 * Phase 3, and expected to be cut.
 *
 * Player devices are an enhancement, never a dependency: the game is fully
 * playable with the host tablet and the TV alone. This route exists so the
 * seam is visible and honest — it connects, it receives a `PlayerState`, and
 * it does nothing else. Self-join, avatars from the phone camera, host
 * approval and device submission all live behind it.
 */
export function PlayView() {
  const { state } = useConnection<PlayerState>('player', 'player');

  return (
    <div className="play">
      <h1>{state?.gameTitle ?? 'GameMaster'}</h1>
      {state?.entrantId ? (
        <p className="play-score">
          {state.displayName}: <strong>{state.score}</strong>
        </p>
      ) : (
        <p className="play-note">
          Player devices aren’t part of this build. Everything happens on the host’s tablet and the TV — find your face
          on the screen.
        </p>
      )}
    </div>
  );
}
