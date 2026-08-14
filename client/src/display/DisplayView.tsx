import { useEffect, useRef } from 'react';
import type { DisplayState } from '../../../shared/types.js';
import { useConnection } from '../lib/connection.js';
import { Avatar } from '../components/Avatar.js';
import { Countdown } from './Countdown.js';
import '../styles/display.css';

/**
 * The TV. Assume a 1080p living-room set, viewed from across a room, with
 * sunlight on it and a toddler in front of it.
 *
 * Everything here is big, high contrast, and inside a 5% safe margin for
 * overscan. Test it on the actual television, not on the laptop screen.
 */
export function DisplayView() {
  const { state, status } = useConnection<DisplayState>('display', 'display');

  if (!state) {
    return (
      <div className="display display-waiting">
        <h1>GameMaster</h1>
        <p>{status === 'offline' ? 'Waiting for the server…' : 'Connecting…'}</p>
      </div>
    );
  }

  const round = state.round;
  const options = (round?.extra as { options?: { label: string; text: string }[] } | undefined)?.options;
  const correctLabel = (round?.extra as { correctLabel?: string } | undefined)?.correctLabel;

  return (
    <div className="display">
      <Chime state={state} />

      <header className="display-header">
        <h1>{state.roundTitle ?? state.gameTitle}</h1>
        {round && (
          <span className="display-progress">
            {round.itemIndex + 1} / {round.itemCount}
          </span>
        )}
      </header>

      <main className="display-main">
        {!round && (
          <div className="display-card">
            <h2>{state.gameTitle}</h2>
            <p>{state.phase === 'scores' ? 'Scores on the board' : 'Get ready…'}</p>
          </div>
        )}

        {round && (
          <>
            {/* With a picture the prompt is a caption above it — the baby-photo
                round is display-led, and the picture is the question. */}
            <p className={`display-prompt ${round.media?.image ? 'with-image' : ''}`}>{round.prompt}</p>
            {round.media?.image && <img className="display-image" src={round.media.image} alt="" />}

            {options && (
              <ol className="display-options">
                {options.map((o) => (
                  <li key={o.label} className={round.revealed && o.label === correctLabel ? 'correct' : ''}>
                    <b>{o.label}</b> {o.text}
                  </li>
                ))}
              </ol>
            )}

            {/* `answer` is absent from this payload entirely until the host
                reveals — the server strips it, so it is never in the DOM. */}
            {round.revealed && round.answer && <p className="display-answer">{round.answer}</p>}

            {round.timer && <Countdown timer={round.timer} />}
          </>
        )}
      </main>

      <footer className="display-leaderboard">
        {state.leaderboard.map((row) => (
          <div
            key={row.id}
            className={`lb-row ${row.dimmed ? 'dimmed' : ''} ${row.delta ? 'flash' : ''}`}
            style={{ ['--entrant-color' as string]: row.color }}
          >
            <Avatar src={row.avatar} name={row.displayName} color={row.color} className="lb-avatar" />
            <span className="lb-name">{row.displayName}</span>
            <span className="lb-score">{row.score}</span>
            {row.delta ? <span className="lb-delta">{row.delta > 0 ? `+${row.delta}` : row.delta}</span> : null}
          </div>
        ))}
      </footer>
    </div>
  );
}

/**
 * Sound rides the HDMI cable, so cues play through the TV. Browsers block
 * autoplay until the page has been interacted with — clicking the display
 * window once after fullscreening it is on the run-day checklist.
 */
function Chime({ state }: { state: DisplayState }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const lastSrc = useRef<string | undefined>(undefined);
  const src = state.round?.media?.audio;

  useEffect(() => {
    if (!src || src === lastSrc.current) return;
    lastSrc.current = src;
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    void audio.play().catch(() => {
      /* autoplay blocked — click the display window once */
    });
  }, [src]);

  return src ? <audio ref={audioRef} src={src} preload="auto" /> : null;
}
