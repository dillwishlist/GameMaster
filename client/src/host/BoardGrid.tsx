import type { HostRoundView } from '../../../shared/types.js';
import type { RoundEvent } from '../../../shared/events.js';
import '../styles/board.css';

/**
 * The host's half of the Jeopardy board: the grid a contestant picks from, and
 * the clue card the host reads and adjudicates against.
 *
 * Two screens, one component, because the host only ever sees one of them at a
 * time and a second panel would push the entrant faces off the bottom of the
 * iPad — and the faces are how points get awarded.
 *
 * Every square is a full-height button rather than a cell with a button in it:
 * this is tapped while standing up, talking, holding a child. Used squares stay
 * tappable and say so ("↺"), because the host must never be trapped by the
 * software's opinion of which questions are finished.
 */

export interface BoardCellView {
  value: number;
  consumed: boolean;
  wager: boolean;
}

export interface BoardCategoryView {
  name: string;
  clues: BoardCellView[];
}

export interface BoardHostExtra {
  categories: BoardCategoryView[];
  rows: number;
  open: {
    categoryIndex: number;
    clueIndex: number;
    category: string;
    value: number;
    wager: boolean;
  } | null;
  wagerPresets: number[];
  remaining: number;
  note?: string;
  points: number;
}

export function boardHostExtra(round: HostRoundView | null): BoardHostExtra | null {
  if (round?.kind !== 'board') return null;
  return round.extra as unknown as BoardHostExtra;
}

export function BoardGrid({ round, onEvent }: { round: HostRoundView; onEvent: (event: RoundEvent) => void }) {
  const board = boardHostExtra(round);
  if (!board) return null;

  return board.open ? (
    <ClueCard round={round} board={board} onEvent={onEvent} />
  ) : (
    <Grid board={board} onEvent={onEvent} />
  );
}

function Grid({ board, onEvent }: { board: BoardHostExtra; onEvent: (event: RoundEvent) => void }) {
  return (
    <div className="board-host" style={{ ['--board-cols' as string]: String(board.categories.length) }}>
      <div className="board-head">
        {board.categories.map((category, col) => (
          <div key={col} className="board-cat">
            {category.name}
          </div>
        ))}
      </div>

      <div className="board-body">
        {Array.from({ length: board.rows }, (_, row) =>
          board.categories.map((category, col) => {
            const cell = category.clues[row];
            if (!cell) return <div key={`${col}:${row}`} className="board-cell board-blank" />;
            return (
              <button
                key={`${col}:${row}`}
                className={`board-cell ${cell.consumed ? 'used' : ''}`}
                onClick={() => onEvent({ type: cell.consumed ? 'REOPEN' : 'OPEN', category: col, clue: row })}
                title={cell.consumed ? 'Put this square back into play' : `${category.name} for ${cell.value}`}
              >
                {cell.consumed ? <span className="board-reopen">↺</span> : cell.value}
                {/* Only the host ever sees this marker. The room finds out when
                    the square opens, which is the whole point of a wager. */}
                {!cell.consumed && cell.wager && <span className="board-wager-mark">★</span>}
              </button>
            );
          }),
        )}
      </div>

      <p className="board-hint">
        {board.remaining > 0
          ? `${board.remaining} square${board.remaining === 1 ? '' : 's'} left — tap the one they picked. ↺ puts a used square back.`
          : 'Board cleared. ↺ puts a square back if you need one.'}
      </p>
    </div>
  );
}

function ClueCard({
  round,
  board,
  onEvent,
}: {
  round: HostRoundView;
  board: BoardHostExtra;
  onEvent: (event: RoundEvent) => void;
}) {
  const open = board.open!;

  return (
    <div className="board-host board-open">
      <div className="board-open-head">
        <span className="board-open-cat">{open.category}</span>
        <span className={`board-open-value ${open.wager ? 'wager' : ''}`}>
          {board.points}
          {open.wager && <span className="board-open-wager-tag">wager</span>}
        </span>
      </div>

      <p className="host-prompt">{round.prompt}</p>

      {round.answer && (
        <p className={`host-answer ${round.revealed ? 'shown' : ''}`}>
          <span className="host-answer-label">Answer</span> {round.answer}
        </p>
      )}
      {board.note && <p className="host-note">{board.note}</p>}
      {round.media?.image && <img className="host-thumb" src={round.media.image} alt="" />}

      {open.wager && (
        <div className="board-wagers">
          <span className="board-wagers-label">Stake</span>
          {board.wagerPresets.map((amount) => (
            <button
              key={amount}
              className={`btn board-wager ${amount === board.points ? 'chosen' : ''}`}
              onClick={() => onEvent({ type: 'SET_WAGER', points: amount })}
            >
              {amount}
            </button>
          ))}
        </div>
      )}

      <div className="board-open-actions">
        <button className="btn big" onClick={() => onEvent({ type: 'CANCEL' })}>
          ‹ Wrong square
        </button>
        <button className="btn big btn-primary" onClick={() => onEvent({ type: 'CLOSE' })}>
          Done — back to board
        </button>
      </div>

      <p className="board-hint">
        Tap a face below for +{board.points}. Long-press (or flip to Deduct) to take {board.points} away.
      </p>
    </div>
  );
}
