import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  importCsv,
  loadSubmissions,
  parseCsv,
  saveSubmissions,
  submissionId,
  SubmissionError,
} from '../server/submissions.js';

const ENTRANTS = [
  { id: 'mum-dad', displayName: 'Mum & Dad' },
  { id: 'lucy', displayName: 'Lucy' },
  { id: 'the-swans', displayName: 'Team Swan' },
];

const FORM = `Timestamp,Your name,Your question for the happy couple,The answer
02/08/2026 10:14:00,Lucy,How many grandchildren?,"Three — four in November!"
02/08/2026 11:02:00,Team Swan,"Where did they meet, exactly?",A chemistry lab
03/08/2026 09:30:00,Aunt Ruth,What was the first dance?,True by Spandau Ballet
`;

function scratchFile(): string {
  return path.join(mkdtempSync(path.join(tmpdir(), 'gm-subs-')), 'submissions.yaml');
}

describe('reading a form export', () => {
  it('works out which column is which', () => {
    const result = importCsv(FORM, [], { attribution: 'host', entrants: ENTRANTS });

    expect(result.columns).toEqual({
      text: 'Your question for the happy couple',
      answer: 'The answer',
      by: 'Your name',
      receivedAt: 'Timestamp',
    });
    expect(result.added).toHaveLength(3);
    expect(result.added[0].text).toBe('How many grandchildren?');
    expect(result.added[0].answer).toBe('Three — four in November!');
  });

  it('keeps a comma inside a quoted answer', () => {
    // People write commas, and a split(',') would mangle the longest and
    // funniest answers.
    const result = importCsv(FORM, [], { attribution: 'host', entrants: ENTRANTS });
    expect(result.added[1].text).toBe('Where did they meet, exactly?');
  });

  it('links a name to an entrant, and says so when it cannot', () => {
    const result = importCsv(FORM, [], { attribution: 'host', entrants: ENTRANTS });

    expect(result.added[0].entrantId).toBe('lucy');
    expect(result.added[1].entrantId).toBe('the-swans');
    // Aunt Ruth is not playing, so her question cannot be scoped away from her.
    expect(result.added[2].entrantId).toBeUndefined();
    expect(result.warnings.join(' ')).toMatch(/Aunt Ruth.*cannot be excluded/);
  });

  it('does not guess an entrant from a first name that could be either', () => {
    const result = importCsv(
      'Timestamp,Your name,Question\n1,David,Whose car is greener?\n',
      [],
      { attribution: 'host', entrants: ENTRANTS },
    );
    // "David" is one half of "Mum & Dad"; silently picking them would attach a
    // submission to the wrong people.
    expect(result.added[0].entrantId).toBeUndefined();
  });

  it('refuses to guess when nothing looks like a question', () => {
    expect(() => importCsv('A,B\n1,2\n', [], { attribution: 'host' })).not.toThrow();
    expect(() => importCsv('Timestamp\n1\n', [], { attribution: 'host' })).toThrow(SubmissionError);
  });
});

describe('anonymity', () => {
  it('never stores the author of a blind submission', () => {
    const result = importCsv(FORM, [], { attribution: 'blind', entrants: ENTRANTS });

    for (const submission of result.added) {
      expect(submission.by).toBeUndefined();
      expect(submission.entrantId).toBeUndefined();
    }
    expect(JSON.stringify(result.added)).not.toContain('Lucy');
    expect(result.warnings.join(' ')).toMatch(/no way to recover it later/);
  });

  it('keeps the author out of a blind id, so it cannot be guessed back', () => {
    // A hash over a name is reversible when the pool of names is one family.
    const withName = submissionId({ text: 'q', receivedAt: 't', by: 'Lucy', attribution: 'blind' });
    const without = submissionId({ text: 'q', receivedAt: 't', attribution: 'blind' });
    expect(withName).toBe(without);

    // For every other mode the author is part of the identity, so two people
    // asking the same question are two submissions.
    const a = submissionId({ text: 'q', receivedAt: 't', by: 'Lucy', attribution: 'host' });
    const b = submissionId({ text: 'q', receivedAt: 't', by: 'Ruth', attribution: 'host' });
    expect(a).not.toBe(b);
  });

  it('will not save a blind submission that somehow has an author', () => {
    const file = scratchFile();
    expect(() =>
      saveSubmissions(file, [
        // Hand-edited, or written by a future bug.
        { id: 'sub-1', kind: 'question', text: 'q', attribution: 'blind', by: 'Lucy', source: 'form', status: 'pending' },
      ]),
    ).not.toThrow();

    // The schema is the gate on the way back in, which is where it matters:
    // the file is a thing humans edit.
    expect(() => loadSubmissions(file)).toThrow(/blind but still carries an author/);
  });
});

describe('importing twice', () => {
  it('adds only the new rows the second time', () => {
    const first = importCsv(FORM, [], { attribution: 'host', entrants: ENTRANTS });
    expect(first.added).toHaveLength(3);

    // Friday's export: the same three, plus the two households who finally replied.
    const fuller = `${FORM}04/08/2026 18:00:00,Lucy,What colour is the car?,Green\n`;
    const second = importCsv(fuller, first.added, { attribution: 'host', entrants: ENTRANTS });

    expect(second.skipped).toBe(3);
    expect(second.added).toHaveLength(1);
    expect(second.added[0].text).toBe('What colour is the car?');
  });

  it('survives a round trip through the file', () => {
    const file = scratchFile();
    const { added } = importCsv(FORM, [], { attribution: 'reveal', entrants: ENTRANTS });
    saveSubmissions(file, added);

    const reloaded = loadSubmissions(file);
    expect(reloaded).toEqual(added);
    expect(readFileSync(file, 'utf8')).toContain('no author stored');
  });

  it('starts every submission pending, so nothing reaches the TV unasked', () => {
    const { added } = importCsv(FORM, [], { attribution: 'public', entrants: ENTRANTS });
    expect(added.every((s) => s.status === 'pending')).toBe(true);
  });
});

describe('the CSV reader', () => {
  it('handles quotes, embedded newlines and doubled quotes', () => {
    const rows = parseCsv('a,b\n"line one\nline two","he said ""hello"""\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['line one\nline two', 'he said "hello"'],
    ]);
  });

  it('copes with CRLF and a leading byte-order mark', () => {
    const rows = parseCsv('﻿Timestamp,Question\r\n1,Why?\r\n');
    expect(rows[0]).toEqual(['Timestamp', 'Question']);
    expect(rows[1]).toEqual(['1', 'Why?']);
  });

  it('drops the blank rows a spreadsheet export leaves at the end', () => {
    expect(parseCsv('a,b\n1,2\n,\n\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
