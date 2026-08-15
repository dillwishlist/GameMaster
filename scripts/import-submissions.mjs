/**
 * Turn a form export into submissions.
 *
 *   node scripts/import-submissions.mjs responses.csv
 *   node scripts/import-submissions.mjs responses.csv --attribution=reveal
 *   node scripts/import-submissions.mjs responses.csv --text="Your question" --by="Your name"
 *
 * Safe to run again on a fuller export: rows already imported are skipped, so
 * the usual workflow — export on Tuesday, export again on Friday when the last
 * two households finally reply — adds only what is new.
 *
 * Runs the TypeScript directly with tsx, the same way `npm start` does.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(here, '..', 'server', 'importSubmissionsCli.ts');

const child = spawn(process.execPath, ['--import', 'tsx', entry, ...process.argv.slice(2)], {
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 0));
