/**
 * CLI wrapper for the session replay. All of the logic lives in
 * `server/replay.ts` so that it is typechecked and unit-tested; this file exists
 * only so that reading a log back is one command and not a paragraph of flags.
 *
 *   node scripts/replay.mjs                          most recent session in ./data
 *   node scripts/replay.mjs data/session-<id>.jsonl
 *   node scripts/replay.mjs --json                   machine-readable summary
 *   node scripts/replay.mjs --help
 *
 * It spawns `node --import tsx server/replay.ts`, the same way `npm start`
 * spawns the server, rather than importing the TypeScript itself — one way of
 * running TypeScript in this repo, not two.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = path.resolve(fileURLToPath(new URL('../server/replay.ts', import.meta.url)));

const child = spawn(process.execPath, ['--import', 'tsx', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('error', (err) => {
  console.error(`Could not start the replay: ${err.message}`);
  process.exit(1);
});

// Report the child's fate as our own, so `... --json | jq` and shell `&&` both
// behave the way the caller expects.
child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
