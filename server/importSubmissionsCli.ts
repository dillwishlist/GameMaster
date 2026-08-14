/**
 * The command line around `importCsv`. Kept separate from the logic so the
 * interesting parts stay unit-testable and this file stays about arguments and
 * what gets printed.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadContent, resolveContentFile } from './content.js';
import {
  ATTRIBUTIONS,
  importCsv,
  loadSubmissions,
  saveSubmissions,
  SubmissionError,
  type Attribution,
} from './submissions.js';

const HELP = `
Import form responses as submissions.

  node scripts/import-submissions.mjs <export.csv> [options]

  --attribution=<mode>  blind | host | reveal | public       (default: host)
                          blind   nobody ever knows who wrote it
                          host    only you; lets the engine stop the submitter
                                  scoring on their own question
                          reveal  hidden until you reveal it — "Who said it?"
                          public  shown on the TV
  --text="<heading>"    the column holding the question
  --answer="<heading>"  the column holding the answer
  --by="<heading>"      the column holding the submitter's name
  --out=<file>          default: content/submissions.yaml
  --content=<file>      the game file, used to match names to entrants
  --dry-run             print what would be added, write nothing
`;

function flag(name: string): string | undefined {
  const found = process.argv.find((a) => a.startsWith(`--${name}=`));
  return found?.slice(name.length + 3);
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help')) {
    console.log(HELP.trim());
    return args.length === 0 ? 1 : 0;
  }

  const csvPath = args.find((a) => !a.startsWith('--'));
  if (!csvPath) {
    console.error('Which CSV? Pass the file exported from the form.');
    return 1;
  }
  if (!existsSync(csvPath)) {
    console.error(`No such file: ${csvPath}`);
    return 1;
  }

  const attribution = (flag('attribution') ?? 'host') as Attribution;
  if (!ATTRIBUTIONS.includes(attribution)) {
    console.error(`--attribution must be one of ${ATTRIBUTIONS.join(', ')}`);
    return 2;
  }

  const contentDir = process.env.GM_CONTENT_DIR ?? 'content';
  const out = flag('out') ?? path.join(contentDir, 'submissions.yaml');

  // Entrants are only used to link a name to an id; a missing game file is a
  // warning, not a failure, because importing before the roster exists is a
  // perfectly reasonable order to do things in.
  let entrants: { id: string; displayName: string }[] = [];
  try {
    const contentFile = flag('content') ?? resolveContentFile(contentDir, process.env.GM_CONTENT);
    entrants = loadContent(contentFile).entrants.map((e) => ({ id: e.id, displayName: e.displayName }));
  } catch {
    console.warn('! No game file read, so names cannot be matched to entrants yet.');
  }

  const existing = loadSubmissions(out);
  const result = importCsv(readFileSync(csvPath, 'utf8'), existing, {
    attribution,
    entrants,
    columns: { text: flag('text'), answer: flag('answer'), by: flag('by') },
  });

  console.log(`Read ${path.relative(process.cwd(), csvPath)}`);
  console.log(`  question column : ${result.columns.text}`);
  if (result.columns.answer) console.log(`  answer column   : ${result.columns.answer}`);
  if (result.columns.by) console.log(`  name column     : ${result.columns.by}`);
  console.log(`  attribution     : ${attribution}`);
  console.log('');

  for (const warning of dedupe(result.warnings)) console.warn(`! ${warning}`);
  if (result.warnings.length) console.log('');

  if (result.added.length === 0) {
    console.log(result.skipped > 0 ? `Nothing new — all ${result.skipped} rows were already imported.` : 'Nothing to import.');
    return 0;
  }

  for (const submission of result.added) {
    const who = submission.by ? ` — ${submission.by}${submission.entrantId ? ` (${submission.entrantId})` : ''}` : '';
    console.log(`  + ${truncate(submission.text)}${who}`);
  }
  console.log('');

  if (args.includes('--dry-run')) {
    console.log(`Dry run: ${result.added.length} would be added, ${result.skipped} already there.`);
    return 0;
  }

  saveSubmissions(out, [...existing, ...result.added]);
  console.log(
    `Added ${result.added.length} to ${path.relative(process.cwd(), out)}` +
      (result.skipped ? `, skipped ${result.skipped} already there.` : '.'),
  );
  console.log('They are all `status: pending` — nothing reaches the TV until you say so.');
  return 0;
}

function truncate(text: string): string {
  return text.length > 68 ? `${text.slice(0, 65)}...` : text;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof SubmissionError ? err.message : err);
    process.exit(1);
  });
