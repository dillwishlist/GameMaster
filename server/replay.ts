/**
 * Session replay and export — the after-the-party tool.
 *
 * The log in `data/session-<id>.jsonl` is the only record of who actually won.
 * It is also, as JSON, unreadable to everybody who was in the room. This module
 * turns one back into the other: a ranked scoreboard, a transcript of every
 * round and item in the order the room saw them, and a count of the mistakes.
 *
 * Two design choices are worth the words:
 *
 *   - It replays the log **event by event** through the same `reduce` the server
 *     uses, rather than re-implementing scoring. Point movements are then read
 *     off as score deltas between the state before and after each event, so this
 *     file knows nothing about how any round type awards, and a round type added
 *     later shows up in the transcript for free.
 *   - It never refuses to run. A content file edited since the party, a round id
 *     that no longer exists, a log with a torn final line — all of them degrade
 *     to "we know less about this bit" rather than to a stack trace. Six months
 *     later the log is the artefact you still have and the YAML is the thing
 *     somebody tidied up.
 *
 * The mistake counts are not self-flagellation. A round with a pile of undos and
 * hand-set scores behind it is how you find out that a round type misbehaved.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { EntrantId, RoundId } from '../shared/types.js';
import type { GameEvent } from '../shared/events.js';
import { ContentError, loadContent, resolveContentFile, type GameContent } from './content.js';
import { emptyState, reduce, type GameState } from './game/state.js';
import { latestSessionFile } from './session.js';

/* -------------------------------------------------------------------------- */
/* The summary shape — this is also exactly what `--json` prints               */
/* -------------------------------------------------------------------------- */

export interface ScoreRow {
  /** 1-based. Equal scores share a rank, so a draw reads as a draw. */
  rank: number;
  entrantId: EntrantId;
  displayName: string;
  score: number;
  /** True for everyone on rank 1 — there can be more than one. */
  winner: boolean;
}

export interface AwardRow {
  at: number;
  entrantId: EntrantId;
  displayName: string;
  points: number;
}

export interface ItemReplay {
  /** Index into the round's `items`, as the log recorded it. */
  index: number;
  /** Null when the content file no longer has an item at this index. */
  prompt: string | null;
  answer: string | null;
  awards: AwardRow[];
}

export interface RoundReplay {
  roundId: RoundId;
  /** The content file's title today, or the raw id if it is gone. */
  title: string;
  type: string | null;
  /** False when the content file no longer describes this round. */
  known: boolean;
  items: ItemReplay[];
  pointsAwarded: number;
}

/** A score moved outside a round: the host fixing it by hand. */
export interface AdjustmentRow {
  at: number;
  type: 'AWARD_POINTS' | 'SET_SCORE';
  entrantId: EntrantId;
  displayName: string;
  /** The delta actually applied, so a SET_SCORE reads as the swing it caused. */
  points: number;
  /** Present for SET_SCORE: the number the host typed. */
  score?: number;
}

export interface ReplaySummary {
  sessionId: string;
  logFile: string;
  /** The title the game ran under, taken from SESSION_START. */
  gameTitle: string;
  /** The content file's title today. Null if it could not be loaded. */
  contentTitle: string | null;
  contentFile: string | null;
  /** True when the content no longer matches what the log was played against. */
  contentChanged: boolean;
  /** Why the content could not be loaded, if it could not be. */
  contentError: string | null;
  startedAt: number | null;
  endedAt: number | null;
  durationMs: number;
  eventCount: number;
  scores: ScoreRow[];
  rounds: RoundReplay[];
  adjustments: AdjustmentRow[];
  corrections: {
    /** Lines in the `.undone.jsonl` sidecar: taps the host took back. */
    undone: number;
    /** SET_SCORE events: scores typed in by hand. */
    setScore: number;
    /** Lines neither file could parse. Almost always one torn final write. */
    unreadableLines: number;
  };
  /** Anything worth saying out loud that is not an error. */
  warnings: string[];
}

/** Thrown for the things a human can fix: no log to read, no such file. */
export class ReplayError extends Error {}

export interface ReplayOptions {
  /** A specific log file. Defaults to the newest session in `dataDir`. */
  file?: string;
  dataDir?: string;
  /** Content to replay against. Tests pass this; the CLI loads it from disk. */
  content?: GameContent;
  contentDir?: string;
  contentFile?: string;
}

/* -------------------------------------------------------------------------- */
/* Reading the log                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Tolerant line-by-line parse, deliberately duplicated from the private
 * `readLog` in ./session.ts rather than exported from there: that function is on
 * the boot path of a live party and this one counts its failures instead of
 * warning about them. Two callers, two jobs, five lines each.
 */
function readLogLines(file: string): { events: GameEvent[]; unreadable: number } {
  const events: GameEvent[] = [];
  let unreadable = 0;

  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      events.push(JSON.parse(line) as GameEvent);
    } catch {
      // A torn last line means the laptop died mid-write. It is a fact about the
      // party, not a reason to refuse to print the scores.
      unreadable++;
    }
  }
  return { events, unreadable };
}

/** The sidecar of events the host undid. Present only if anything was undone. */
function undoneSidecar(logFile: string): { count: number; unreadable: number; lastAt: number | null } {
  const sidecar = logFile.replace(/\.jsonl$/, '.undone.jsonl');
  if (!existsSync(sidecar)) return { count: 0, unreadable: 0, lastAt: null };

  const { events, unreadable } = readLogLines(sidecar);
  const times = events.map((e) => e.at).filter((at): at is number => typeof at === 'number');
  return { count: events.length, unreadable, lastAt: times.length ? Math.max(...times) : null };
}

export function resolveLogFile(opts: ReplayOptions): string {
  if (opts.file) {
    if (!existsSync(opts.file)) throw new ReplayError(`No such session log: ${opts.file}`);
    return path.resolve(opts.file);
  }
  const dataDir = path.resolve(opts.dataDir ?? process.env.GM_DATA_DIR ?? 'data');
  const latest = latestSessionFile(dataDir);
  if (!latest) {
    throw new ReplayError(
      `No session logs in ${rel(dataDir)}. Sessions are written there while the server runs; ` +
        `pass a path if the log lives somewhere else.`,
    );
  }
  return path.resolve(latest);
}

/**
 * Content to replay against, or a usable stand-in. A missing or broken content
 * file loses the prompts and the round-type scoring, but the log still knows who
 * was awarded what by hand — printing that beats printing an exception.
 */
function resolveContent(opts: ReplayOptions): { content: GameContent; error: string | null } {
  if (opts.content) return { content: opts.content, error: null };

  try {
    const dir = path.resolve(opts.contentDir ?? process.env.GM_CONTENT_DIR ?? 'content');
    const file = resolveContentFile(dir, opts.contentFile ?? process.env.GM_CONTENT);
    return { content: loadContent(file), error: null };
  } catch (err) {
    const error = err instanceof ContentError ? err.message : String(err);
    return {
      content: { title: '', entrants: [], rounds: [], brokenRounds: {}, sourceFile: '' },
      error,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* The replay                                                                 */
/* -------------------------------------------------------------------------- */

interface RoundAccum {
  roundId: RoundId;
  /** Item indices in the order the room actually visited them. */
  order: number[];
  items: Map<number, ItemReplay>;
}

export function buildSummary(opts: ReplayOptions = {}): ReplaySummary {
  const logFile = resolveLogFile(opts);
  const { events, unreadable } = readLogLines(logFile);
  const { content, error: contentError } = resolveContent(opts);
  const sidecar = undoneSidecar(logFile);

  const sessionId = path.basename(logFile).replace(/^session-|\.jsonl$/g, '');
  const warnings: string[] = [];

  /** Every name an entrant has ever had, so a removed one still has a face. */
  const namesEverSeen = new Map<EntrantId, string>();
  const rounds: RoundAccum[] = [];
  const roundsById = new Map<RoundId, RoundAccum>();
  const adjustments: AdjustmentRow[] = [];
  const missingRounds = new Set<RoundId>();
  let setScoreCount = 0;

  const roundFor = (roundId: RoundId): RoundAccum => {
    let acc = roundsById.get(roundId);
    if (!acc) {
      acc = { roundId, order: [], items: new Map() };
      roundsById.set(roundId, acc);
      rounds.push(acc);
    }
    return acc;
  };

  const touchItem = (acc: RoundAccum, index: number): ItemReplay => {
    let item = acc.items.get(index);
    if (!item) {
      const { prompt, answer } = describeItem(content, acc.roundId, index);
      item = { index, prompt, answer, awards: [] };
      acc.items.set(index, item);
      acc.order.push(index);
    }
    return item;
  };

  let state: GameState = emptyState();

  for (const event of events) {
    const before = state;
    state = reduce(before, event, content);
    for (const e of state.entrants) namesEverSeen.set(e.id, e.displayName);

    const deltas = scoreDeltas(before, state);

    switch (event.type) {
      case 'ROUND_SELECT': {
        if (event.roundId === null) break;
        if (!content.rounds.some((r) => r.id === event.roundId)) missingRounds.add(event.roundId);
        // The round's own state only exists once the select has been reduced.
        touchItem(roundFor(event.roundId), itemIndexOf(state, event.roundId) ?? 0);
        break;
      }

      case 'ROUND_EVENT': {
        if (!content.rounds.some((r) => r.id === event.roundId)) missingRounds.add(event.roundId);
        const acc = roundFor(event.roundId);
        // Awards belong to the item that was on the TV when the host tapped,
        // which is the index *before* the event — a NEXT that also scores would
        // otherwise credit the wrong question.
        const shown = itemIndexOf(before, event.roundId) ?? itemIndexOf(state, event.roundId) ?? 0;
        const item = touchItem(acc, shown);
        for (const d of deltas) {
          item.awards.push({ at: event.at, entrantId: d.entrantId, displayName: d.displayName, points: d.points });
        }
        // A navigation event lands the room on a new item; record the arrival so
        // the transcript shows questions nobody scored on.
        const landed = itemIndexOf(state, event.roundId);
        if (landed !== null && landed !== shown) touchItem(acc, landed);
        break;
      }

      case 'SET_SCORE':
        setScoreCount++;
        for (const d of deltas) {
          adjustments.push({ at: event.at, type: 'SET_SCORE', ...d, score: event.score });
        }
        // A SET_SCORE that changed nothing still says the host went looking.
        if (deltas.length === 0) {
          adjustments.push({
            at: event.at,
            type: 'SET_SCORE',
            entrantId: event.entrantId,
            displayName: nameOf(namesEverSeen, event.entrantId),
            points: 0,
            score: event.score,
          });
        }
        break;

      case 'AWARD_POINTS':
        for (const d of deltas) adjustments.push({ at: event.at, type: 'AWARD_POINTS', ...d });
        break;

      default:
        break;
    }
  }

  if (contentError) {
    warnings.push(
      `Could not read the content file, so prompts and round titles are missing from this transcript:\n  ${contentError}`,
    );
  } else if (missingRounds.size > 0) {
    warnings.push(
      `The content file no longer has ${plural(missingRounds.size, 'round')} that this session played: ` +
        `${[...missingRounds].join(', ')}. Those rounds show ids instead of titles, and any points ` +
        `their round type awarded are not in these scores.`,
    );
  }

  const loggedTitle = state.gameTitle || firstGameTitle(events);
  const contentTitle = contentError ? null : content.title;
  const contentChanged = Boolean(contentTitle && loggedTitle && contentTitle !== loggedTitle) || missingRounds.size > 0;
  if (contentTitle && loggedTitle && contentTitle !== loggedTitle) {
    warnings.push(`The content file is called "${contentTitle}" now; the session was played as "${loggedTitle}".`);
  }

  const times = events.map((e) => e.at).filter((at): at is number => typeof at === 'number');
  const startedAt = times.length ? Math.min(...times) : null;
  // An undone event was appended before it was taken back, so the sidecar can
  // hold the true last thing that happened in the room.
  const endedAt = times.length ? Math.max(...times, sidecar.lastAt ?? -Infinity) : sidecar.lastAt;

  return {
    sessionId,
    logFile,
    gameTitle: loggedTitle,
    contentTitle,
    contentFile: contentError ? null : content.sourceFile || null,
    contentChanged,
    contentError,
    startedAt,
    endedAt,
    durationMs: startedAt !== null && endedAt !== null ? Math.max(0, endedAt - startedAt) : 0,
    eventCount: events.length,
    scores: rankScores(state),
    rounds: rounds.map((acc) => finishRound(acc, content)),
    adjustments,
    corrections: {
      undone: sidecar.count,
      setScore: setScoreCount,
      unreadableLines: unreadable + sidecar.unreadable,
    },
    warnings,
  };
}

function finishRound(acc: RoundAccum, content: GameContent): RoundReplay {
  const round = content.rounds.find((r) => r.id === acc.roundId);
  const items = acc.order.map((i) => acc.items.get(i)).filter((i): i is ItemReplay => i !== undefined);
  return {
    roundId: acc.roundId,
    title: round?.title ?? acc.roundId,
    type: round?.type ?? null,
    known: Boolean(round),
    items,
    pointsAwarded: items.reduce((sum, item) => sum + item.awards.reduce((s, a) => s + a.points, 0), 0),
  };
}

function rankScores(state: GameState): ScoreRow[] {
  const sorted = [...state.entrants].sort((a, b) => b.score - a.score || a.displayName.localeCompare(b.displayName));

  let rank = 0;
  let previousScore: number | null = null;
  return sorted.map((entrant, i) => {
    if (previousScore === null || entrant.score !== previousScore) rank = i + 1;
    previousScore = entrant.score;
    return {
      rank,
      entrantId: entrant.id,
      displayName: entrant.displayName,
      score: entrant.score,
      winner: rank === 1,
    };
  });
}

interface Delta {
  entrantId: EntrantId;
  displayName: string;
  points: number;
}

/**
 * Point movements caused by one event, read off the state rather than out of the
 * event. This is what keeps the transcript honest for round types this file has
 * never heard of: whatever moved a score, moved a score.
 */
function scoreDeltas(before: GameState, after: GameState): Delta[] {
  const previous = new Map(before.entrants.map((e) => [e.id, e.score]));
  const deltas: Delta[] = [];
  for (const entrant of after.entrants) {
    const points = entrant.score - (previous.get(entrant.id) ?? 0);
    if (points !== 0) deltas.push({ entrantId: entrant.id, displayName: entrant.displayName, points });
  }
  return deltas;
}

/**
 * The item a round is showing. Round state is an opaque blob by contract, so
 * this peeks for a numeric `index` and shrugs if there isn't one — a future
 * round type without a linear item list simply reports everything under item 0.
 */
function itemIndexOf(state: GameState, roundId: RoundId): number | null {
  const roundState = state.roundStates[roundId];
  if (roundState && typeof roundState === 'object') {
    const index = (roundState as { index?: unknown }).index;
    if (typeof index === 'number' && Number.isFinite(index)) return index;
  }
  return null;
}

/**
 * Prompt and answer for one item, straight out of the content file. Both round
 * types built so far keep `items` on their config; anything else, or an index
 * past the end of an edited file, yields nulls and the transcript says so.
 */
function describeItem(
  content: GameContent,
  roundId: RoundId,
  index: number,
): { prompt: string | null; answer: string | null } {
  const round = content.rounds.find((r) => r.id === roundId);
  const items = (round?.config as { items?: unknown[] } | undefined)?.items;
  const item = Array.isArray(items) ? items[index] : undefined;
  if (!item || typeof item !== 'object') return { prompt: null, answer: null };

  const { prompt, answer, options, correct } = item as {
    prompt?: unknown;
    answer?: unknown;
    options?: unknown;
    correct?: unknown;
  };

  // For a multiple-choice item the letter alone is meaningless a year later, so
  // spell the winning option out and append the elaboration if there is one.
  let answerText = typeof answer === 'string' ? answer : null;
  if (Array.isArray(options) && typeof correct === 'string') {
    const letter = correct.trim().toUpperCase();
    const chosen = options[letter.charCodeAt(0) - 65];
    const spelled = `${letter}. ${typeof chosen === 'string' ? chosen : '?'}`;
    answerText = answerText ? `${spelled} — ${answerText}` : spelled;
  }

  return { prompt: typeof prompt === 'string' ? prompt : null, answer: answerText };
}

function firstGameTitle(events: GameEvent[]): string {
  for (const event of events) if (event.type === 'SESSION_START') return event.gameTitle;
  return '';
}

function nameOf(names: Map<EntrantId, string>, id: EntrantId): string {
  return names.get(id) ?? id;
}

/* -------------------------------------------------------------------------- */
/* The human rendering                                                        */
/* -------------------------------------------------------------------------- */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Deliberately hand-rolled rather than `toLocaleString`: this output gets pasted
 * into messages and read out, and it should look the same on the laptop that ran
 * the party as on the one that reads the log back.
 */
function formatDateTime(at: number): string {
  const d = new Date(at);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${formatClock(at)}`;
}

function formatClock(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 1) return `${Math.round(ms / 1000)}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function signed(points: number): string {
  return points > 0 ? `+${points}` : String(points);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

export function formatSummary(summary: ReplaySummary): string {
  const out: string[] = [];
  const title = summary.gameTitle || summary.contentTitle || 'GameMaster session';

  out.push(title);
  out.push('='.repeat(title.length));
  out.push(`Session ${summary.sessionId}  ·  ${rel(summary.logFile)}`);

  if (summary.startedAt !== null && summary.endedAt !== null) {
    out.push(
      `Started ${formatDateTime(summary.startedAt)}  ·  finished ${formatClock(summary.endedAt)}  ·  ` +
        `ran ${formatDuration(summary.durationMs)}  ·  ${plural(summary.eventCount, 'event')}`,
    );
  } else {
    out.push(`${plural(summary.eventCount, 'event')}, none of them timestamped`);
  }

  for (const warning of summary.warnings) out.push('', `! ${warning}`);

  /* Final scores ---------------------------------------------------------- */

  out.push('', 'FINAL SCORES', '');
  if (summary.scores.length === 0) {
    out.push('  Nobody was ever added to this session.');
  } else {
    const width = Math.max(...summary.scores.map((s) => s.displayName.length));
    for (const row of summary.scores) {
      const marker = row.winner ? '*' : ' ';
      const leader = `${row.displayName} `.padEnd(width + 2, '.');
      out.push(`  ${marker} ${String(row.rank).padStart(2)}.  ${leader} ${String(row.score).padStart(3)}`);
    }
    out.push('', `  ${winnerLine(summary.scores)}`);
  }

  /* Transcript ------------------------------------------------------------ */

  out.push('', 'TRANSCRIPT');
  if (summary.rounds.length === 0) {
    out.push('', '  No rounds were played.');
  }

  // Say *why* a prompt is missing. "No longer in the content file" is a lie when
  // the whole file is unreadable, and the difference matters to whoever is
  // deciding whether to go looking for an older copy of the YAML.
  const missing = summary.contentError ? 'content file unreadable' : 'no longer in the content file';

  summary.rounds.forEach((round, i) => {
    const label = round.known ? round.title : `${round.roundId}  (${missing})`;
    out.push('', `  Round ${i + 1} — ${label}${round.type ? `  [${round.type}]` : ''}`);

    for (const item of round.items) {
      out.push(`    ${item.index + 1}. ${item.prompt ?? `(prompt ${missing})`}`);
      if (item.answer) out.push(`       answer: ${item.answer}`);
      if (item.awards.length === 0) {
        out.push('       nobody scored');
      } else {
        for (const award of item.awards) {
          out.push(`       ${formatClock(award.at)}  ${award.displayName}  ${signed(award.points)}`);
        }
      }
    }
    if (round.items.length === 0) out.push('    (selected, then nothing happened)');
  });

  /* Corrections ----------------------------------------------------------- */

  out.push('', 'CORRECTIONS');
  if (summary.adjustments.length === 0) {
    out.push('', '  No scores were touched by hand.');
  } else {
    out.push('');
    for (const adj of summary.adjustments) {
      const what =
        adj.type === 'SET_SCORE'
          ? `set to ${adj.score}${adj.points === 0 ? ' (no change)' : ` (${signed(adj.points)})`}`
          : `nudged ${signed(adj.points)}`;
      out.push(`  ${formatClock(adj.at)}  ${adj.displayName}  ${what}`);
    }
  }

  const { undone, setScore, unreadableLines } = summary.corrections;
  out.push('');
  out.push(
    `  ${plural(undone, 'event')} undone during play; ${plural(setScore, 'score')} set by hand` +
      (unreadableLines ? `; ${plural(unreadableLines, 'log line')} unreadable` : '') +
      '.',
  );
  if (undone > 0 || setScore > 0) {
    out.push('  A round with a lot of both behind it is a round worth re-reading before next time.');
  }

  out.push('');
  return out.join('\n');
}

function winnerLine(scores: ScoreRow[]): string {
  const winners = scores.filter((s) => s.winner);
  if (winners.length === 0) return 'No winner.';
  if (winners.length === scores.length && scores.length > 1) return 'Everybody drew. Nobody will accept this.';
  if (winners.length > 1) return `A draw at the top: ${winners.map((w) => w.displayName).join(' and ')}, ${winners[0].score}.`;
  return `Winner: ${winners[0].displayName}, ${plural(winners[0].score, 'point')}.`;
}

function rel(file: string): string {
  const relative = path.relative(process.cwd(), file);
  return relative && !relative.startsWith('..') ? relative : file;
}

/* -------------------------------------------------------------------------- */
/* CLI                                                                        */
/* -------------------------------------------------------------------------- */

const USAGE = `Replay a finished GameMaster session into something readable.

  node scripts/replay.mjs                      most recent session in ./data
  node scripts/replay.mjs data/session-<id>.jsonl
  node scripts/replay.mjs --json               machine-readable summary

Options
  --json               print the structured summary instead of the transcript
  --content <file>     replay against a specific content file
  --data-dir <dir>     where to look for session logs (default ./data)
  -h, --help           this

Environment: GM_DATA_DIR, GM_CONTENT_DIR, GM_CONTENT — the same variables the
server uses, so the tool reads whatever the party wrote.
`;

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Pure so the tests can drive it: nothing here writes to a stream. */
export function runCli(argv: string[]): CliResult {
  const opts: ReplayOptions = {};
  let json = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') return { stdout: USAGE, stderr: '', exitCode: 0 };
    if (arg === '--json') {
      json = true;
    } else if (arg === '--content' || arg === '--data-dir') {
      const value = argv[++i];
      if (value === undefined) return { stdout: '', stderr: `${arg} needs a path\n`, exitCode: 2 };
      if (arg === '--content') opts.contentFile = value;
      else opts.dataDir = value;
    } else if (arg.startsWith('-')) {
      return { stdout: '', stderr: `Unknown option: ${arg}\n\n${USAGE}`, exitCode: 2 };
    } else {
      opts.file = arg;
    }
  }

  try {
    const summary = buildSummary(opts);
    return {
      stdout: json ? `${JSON.stringify(summary, null, 2)}\n` : formatSummary(summary),
      stderr: '',
      exitCode: 0,
    };
  } catch (err) {
    if (err instanceof ReplayError) return { stdout: '', stderr: `${err.message}\n`, exitCode: 1 };
    throw err;
  }
}

/**
 * Run only when this file is the process entry point. `scripts/replay.mjs`
 * spawns it exactly the way `npm start` spawns the server; importing it from a
 * test must stay silent.
 */
function isEntryPoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return path.resolve(entry).endsWith(`${path.sep}server${path.sep}replay.ts`);
}

if (isEntryPoint()) {
  const result = runCli(process.argv.slice(2));
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
