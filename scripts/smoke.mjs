/**
 * End-to-end smoke test: boots the real server, connects a real host socket and
 * a real display socket, and plays a few items.
 *
 * The unit tests cover the reducer and the projection boundary; this covers the
 * wiring between them — which is the part that fails at 9:15 on a Sunday.
 *
 *   node scripts/smoke.mjs
 *
 * Exits non-zero on the first failed check. Safe to run any time: it uses its
 * own port and a throwaway data directory, so it never touches a live session.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { io } from 'socket.io-client';

// Overridable so a busy port doesn't block a run, and so two smoke tests can
// run side by side on one machine.
const PORT = Number(process.env.GM_SMOKE_PORT ?? 4321);
const dataDir = mkdtempSync(path.join(tmpdir(), 'gamemaster-smoke-'));
const failures = [];

function check(label, condition) {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}`);
    failures.push(label);
  }
}

const server = spawn(process.execPath, ['--import', 'tsx', 'server/index.ts'], {
  env: { ...process.env, GM_PORT: String(PORT), GM_DATA_DIR: dataDir, GM_PASSPHRASE: '' },
  stdio: ['ignore', 'pipe', 'inherit'],
});

const serverOutput = [];
server.stdout.on('data', (chunk) => serverOutput.push(String(chunk)));

/** Wait for a state push that satisfies `predicate`, or fail loudly. */
function until(socket, channel, predicate, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), 5000);
    const onState = (state) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off(channel, onState);
      resolve(state);
    };
    socket.on(channel, onState);
  });
}

function connect(role, channel) {
  const socket = io(`http://localhost:${PORT}`, { transports: ['websocket'] });
  const ready = new Promise((resolve, reject) => {
    socket.on('connect', () => socket.emit('hello', { role }, (res) => (res.ok ? resolve() : reject(new Error(res.error)))));
    socket.on('connect_error', reject);
  });
  return { socket, ready, next: (predicate, label) => until(socket, channel, predicate, label) };
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/api/health`);
      if (res.ok) return res.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server never became healthy');
}

try {
  const health = await waitForServer();
  check('server boots and reports healthy', health.ok);

  const host = connect('host', 'host');
  const display = connect('display', 'display');
  await Promise.all([host.ready, display.ready]);

  let hostState = await host.next(() => true, 'initial host state');
  const displayState = await display.next(() => true, 'initial display state');
  check('host sees the seeded entrants', hostState.entrants.length > 0);
  check('display shows the leaderboard', displayState.leaderboard.length === hostState.entrants.filter((e) => e.active).length);

  const round = hostState.rounds.find((r) => r.id === 'baby-photos');
  check('sample content has the baby-photo round', Boolean(round));

  host.socket.emit('dispatch', { type: 'ROUND_SELECT', roundId: 'baby-photos' });
  hostState = await host.next((s) => s.currentRoundId === 'baby-photos', 'round selected');
  const hidden = await display.next((s) => s.round?.kind === 'manual', 'display shows the round');

  check('host can see the answer', typeof hostState.round.answer === 'string' && hostState.round.answer.length > 0);
  check('display payload has no answer before reveal', !JSON.stringify(hidden).includes(hostState.round.answer));

  host.socket.emit('dispatch', { type: 'ROUND_EVENT', roundId: 'baby-photos', event: { type: 'REVEAL' } });
  const revealed = await display.next((s) => s.round?.revealed === true, 'display reveal');
  check('display gets the answer after reveal', revealed.round.answer === hostState.round.answer);

  const target = hostState.entrants[0];
  host.socket.emit('dispatch', {
    type: 'ROUND_EVENT',
    roundId: 'baby-photos',
    event: { type: 'AWARD', entrantId: target.id },
  });
  const scored = await display.next((s) => s.leaderboard.some((r) => r.id === target.id && r.score === 1), 'award lands');
  check('a tap on a face moves the score on the TV', Boolean(scored));

  host.socket.emit('undo');
  const undone = await display.next((s) => s.leaderboard.some((r) => r.id === target.id && r.score === 0), 'undo lands');
  check('undo puts the point back', Boolean(undone));

  host.socket.emit('dispatch', { type: 'SET_SCORE', entrantId: target.id, score: 42 });
  const fixed = await display.next((s) => s.leaderboard.some((r) => r.id === target.id && r.score === 42), 'manual score');
  check('the host can always fix the score by hand', Boolean(fixed));

  // A display socket must not be able to drive the game.
  await new Promise((resolve) => {
    display.socket.emit('dispatch', { type: 'AWARD_POINTS', entrantId: target.id, points: 100 }, (res) => {
      check('a display client cannot award points', res && res.ok === false);
      resolve();
    });
  });

  host.socket.close();
  display.socket.close();
} catch (err) {
  console.error(`  ✗ ${err.message}`);
  failures.push(err.message);
} finally {
  server.kill('SIGTERM');
  rmSync(dataDir, { recursive: true, force: true });
}

if (failures.length) {
  // Without this the server's own startup output is collected and thrown away,
  // so a boot failure in CI reads as "never became healthy" with no cause.
  if (serverOutput.length) console.error(`\n--- server output ---\n${serverOutput.join('')}`);
  console.error(`\nsmoke test FAILED: ${failures.length} check(s)\n`);
  process.exit(1);
}
console.log('\nsmoke test passed — server, host and display all agree\n');
