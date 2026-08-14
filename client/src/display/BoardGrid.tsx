import type { DisplayRoundView } from '../../../shared/types.js';
import '../styles/board.css';

/**
 * The board as the room sees it. Two states: the grid everyone picks from, and
 * one clue filling the screen.
 *
 * The grid is the scoreboard of the round — people look at it to work out what
 * is left — so used squares go dark rather than disappearing, and the values
 * stay big enough to read from the far sofa.
 *
 * Nothing in this payload can leak: the server sends values and used-flags for
 * the grid, and the response only after the host reveals it. There is no
 * `wager` flag on a closed square, so nobody can spot the daily double by
 * looking at the TV. See `projectDisplay` in server/roundTypes/board.ts.
 */

interface DisplayCellView {
  value: number;
  consumed: boolean;
}

interface DisplayBoardExtra {
  categories: { name: string; clues: DisplayCellView[] }[];
  rows: number;
  open: { category: string; value: number; wager: boolean } | null;
  /** Absent until the host reveals — stripped at the projection boundary. */
  response?: string;
}

export function displayBoardExtra(round: DisplayRoundView | null): DisplayBoardExtra | null {
  if (round?.kind !== 'board') return null;
  return round.extra as unknown as DisplayBoardExtra;
}

export function BoardGrid({ round }: { round: DisplayRoundView }) {
  const board = displayBoardExtra(round);
  if (!board) return null;

  if (board.open) {
    return (
      <div className="board-tv-clue">
        <div className="board-tv-clue-head">
          <span>{board.open.category}</span>
          <span className="board-tv-clue-value">
            {board.open.value}
            {board.open.wager && <span className="board-tv-wager"> ★ wager</span>}
          </span>
        </div>

        <p className={`board-tv-prompt ${round.media?.image ? 'with-image' : ''}`}>{round.prompt}</p>
        {round.media?.image && <img className="display-image" src={round.media.image} alt="" />}

        {round.revealed && board.response && <p className="board-tv-response">{board.response}</p>}
      </div>
    );
  }

  return (
    <div className="board-tv" style={{ ['--board-cols' as string]: String(board.categories.length) }}>
      <div className="board-tv-head">
        {board.categories.map((category, col) => (
          <div key={col} className="board-tv-cat">
            {category.name}
          </div>
        ))}
      </div>
      <div className="board-tv-body">
        {Array.from({ length: board.rows }, (_, row) =>
          board.categories.map((category, col) => {
            const cell = category.clues[row];
            return (
              <div key={`${col}:${row}`} className={`board-tv-cell ${!cell || cell.consumed ? 'used' : ''}`}>
                {cell && !cell.consumed ? cell.value : ''}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
