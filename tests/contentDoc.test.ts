import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as YAML from 'yaml';
import { applyOps, EditError, loadContentDoc, saveContentDoc, SERIALISE } from '../server/editor/contentDoc.js';
import { loadContent } from '../server/content.js';

const REAL_CONTENT = path.resolve('content/anniversary.yaml');
const REAL_BOARD = path.resolve('content/jeopardy.yaml');

function scratch(text: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gamemaster-edit-'));
  const file = path.join(dir, 'game.yaml');
  writeFileSync(file, text);
  return file;
}

function edited(file: string, ops: Parameters<typeof applyOps>[1]): string {
  const { doc } = loadContentDoc(file);
  applyOps(doc, ops);
  return saveContentDoc(file, doc);
}

describe('the round trip', () => {
  // This is the go/no-go for the whole editor. If parsing and re-serialising
  // the real content file cannot come back byte-identical, the approach is
  // wrong — and every comment in that file is documentation somebody wrote on
  // purpose.
  it.each([REAL_CONTENT, REAL_BOARD])('re-serialises %s byte for byte', (file) => {
    const original = readFileSync(file, 'utf8');
    const { doc } = loadContentDoc(file);
    expect(doc.toString(SERIALISE)).toBe(original);
  });

  it('keeps every comment and value from a hand-styled file it has never seen', () => {
    // A file the host wrote themselves will not match the editor's flow-collection
    // spacing, and that is fine — saving normalises the spacing. What must
    // survive is everything a person put there on purpose.
    const file = scratch(`# A game somebody wrote by hand.
title: Hand Written

rounds:
  # The opening round. Do not move this.
  - id: opener
    type: manual
    title: "Double quoted on purpose"
    restrictTo: [lucy]
    items:
      - prompt: First      # trailing note
        answer: One
      - prompt: Second
        media: {image: assets/x.png}
`);
    const { doc } = loadContentDoc(file);
    const after = saveContentDoc(file, doc);

    expect(after).toContain('# A game somebody wrote by hand.');
    expect(after).toContain('# The opening round. Do not move this.');
    expect(after).toContain('# trailing note');
    expect(after).toContain('"Double quoted on purpose"');
    expect(YAML.parse(after)).toEqual(YAML.parse(readFileSync(file, 'utf8')));
    expect(YAML.parse(after).rounds[0].items[1].media).toEqual({ image: 'assets/x.png' });
  });

  it('keeps the comments around an untouched round', () => {
    const file = scratch(readFileSync(REAL_CONTENT, 'utf8'));
    const after = edited(file, [{ op: 'setRoundField', roundId: 'welcome', field: 'title', value: 'Hello' }]);

    // The kids-round explains why restrictTo exists. Editing a different round
    // must not cost that explanation.
    expect(after).toContain('# Only Lucy can score here.');
    expect(after).toContain('# A cue plays when the display *lands on* an item');
    expect(after).toContain("title: 'Hello'");
  });

  it('moves a question together with the comment attached to it', () => {
    const file = scratch(`title: Test
rounds:
  - id: r
    type: manual
    title: Round
    items:
      - prompt: First
      # This note belongs to the second question.
      - prompt: Second
        note: Wait for the laugh
`);
    const after = edited(file, [{ op: 'moveItem', roundId: 'r', from: 1, to: 0 }]);
    const lines = after.split('\n');
    const comment = lines.findIndex((l) => l.includes('belongs to the second'));
    const second = lines.findIndex((l) => l.includes('prompt: Second'));
    const first = lines.findIndex((l) => l.includes('prompt: First'));

    expect(comment).toBeLessThan(second);
    expect(second).toBeLessThan(first);
  });
});

describe('board operations', () => {
  const board = `title: Board Game
rounds:
  - id: family-board
    type: board
    title: 'Family Jeopardy'
    categories:
      - name: Holidays
        clues:
          - value: 100
            prompt: 'The caravan site'
            answer: 'Sandy Balls'
          # Dad tells this story every year. Do not cut it.
          - value: 200
            prompt: 'The gatepost'
            answer: '1998'
      - name: 'Who Said It?'
        clues:
          - value: 100
            prompt: 'Who said it'
            answer: 'Mum'
`;

  it('edits one clue without disturbing the comment beside another', () => {
    const file = scratch(board);
    const after = edited(file, [
      { op: 'setClueField', roundId: 'family-board', category: 0, clue: 0, path: ['answer'], value: 'Sandy Balls, really' },
    ]);

    // The whole point of node-level ops: a board is two-dimensional, but the
    // comment guarantee is not allowed an exception because of that.
    expect(after).toContain('# Dad tells this story every year. Do not cut it.');
    expect(YAML.parse(after).rounds[0].categories[0].clues[0].answer).toBe('Sandy Balls, really');
  });

  it('moves a clue and takes its comment with it', () => {
    const file = scratch(board);
    const after = edited(file, [{ op: 'moveClue', roundId: 'family-board', category: 0, from: 1, to: 0 }]);
    const lines = after.split('\n');
    expect(lines.findIndex((l) => l.includes('Dad tells this story'))).toBeLessThan(
      lines.findIndex((l) => l.includes('gatepost')),
    );
    expect(YAML.parse(after).rounds[0].categories[0].clues.map((c: { value: number }) => c.value)).toEqual([200, 100]);
  });

  it('adds and removes clues and categories', () => {
    const file = scratch(board);
    edited(file, [
      { op: 'addClue', roundId: 'family-board', category: 1, index: 1, clue: { value: 200, prompt: 'New', answer: 'A' } },
      { op: 'addCategory', roundId: 'family-board', index: 2, category: { name: 'Pets', clues: [{ value: 100, prompt: 'p' }] } },
      { op: 'setCategoryName', roundId: 'family-board', category: 0, value: 'Holidays Abroad' },
    ]);
    const parsed = YAML.parse(readFileSync(file, 'utf8'));
    expect(parsed.rounds[0].categories.map((c: { name: string }) => c.name)).toEqual([
      'Holidays Abroad',
      'Who Said It?',
      'Pets',
    ]);
    expect(parsed.rounds[0].categories[1].clues).toHaveLength(2);

    edited(file, [{ op: 'removeCategory', roundId: 'family-board', index: 2 }]);
    expect(YAML.parse(readFileSync(file, 'utf8')).rounds[0].categories).toHaveLength(2);
  });

  it('refuses a clue or category that is not there', () => {
    const file = scratch(board);
    expect(() => edited(file, [{ op: 'removeClue', roundId: 'family-board', category: 0, index: 9 }])).toThrow(EditError);
    expect(() => edited(file, [{ op: 'removeCategory', roundId: 'family-board', index: 9 }])).toThrow(EditError);
  });

  it('keeps the real sample board loadable after an edit', () => {
    const file = scratch(readFileSync(REAL_BOARD, 'utf8'));
    edited(file, [
      { op: 'setClueField', roundId: 'family-board', category: 0, clue: 0, path: ['value'], value: 150 },
      { op: 'setClueField', roundId: 'family-board', category: 0, clue: 1, path: ['wager'], value: true },
    ]);
    const content = loadContent(file);
    expect(content.brokenRounds).toEqual({});
    const cfg = content.rounds.find((r) => r.id === 'family-board')?.config as {
      categories: { clues: { value: number; wager?: boolean }[] }[];
    };
    expect(cfg.categories[0].clues[0].value).toBe(150);
    expect(cfg.categories[0].clues[1].wager).toBe(true);
  });
});

describe('editing operations', () => {
  const base = `title: Test Game
rounds:
  - id: photos
    type: manual
    title: Whose Baby
    defaultPoints: 1
    items:
      - prompt: Whose baby photo?
        answer: David
      - prompt: And this one?
        answer: Jennifer
`;

  it('sets a nested field on an item that has no media yet', () => {
    const file = scratch(base);
    const after = edited(file, [
      { op: 'setItemField', roundId: 'photos', index: 0, path: ['media', 'image'], value: 'assets/a.jpg' },
    ]);
    expect(YAML.parse(after).rounds[0].items[0].media).toEqual({ image: 'assets/a.jpg' });
  });

  it('removes the whole media block when its last key is cleared', () => {
    const file = scratch(base);
    const withMedia = edited(file, [
      { op: 'setItemField', roundId: 'photos', index: 0, path: ['media', 'image'], value: 'assets/a.jpg' },
    ]);
    expect(withMedia).toContain('media');

    const cleared = edited(file, [
      { op: 'setItemField', roundId: 'photos', index: 0, path: ['media', 'image'], value: '' },
    ]);
    // An empty `media: {}` is noise in the file and fails the strict schema.
    expect(cleared).not.toContain('media');
  });

  it('clears an optional round field by removing the key, not writing null', () => {
    const file = scratch(base);
    const after = edited(file, [{ op: 'setRoundField', roundId: 'photos', field: 'defaultPoints', value: '' }]);
    expect(after).not.toContain('defaultPoints');
    expect(after).not.toContain('null');
  });

  it('adds, moves and removes items', () => {
    const file = scratch(base);
    edited(file, [{ op: 'addItem', roundId: 'photos', index: 1, item: { prompt: 'Middle', answer: 'M' } }]);
    expect(YAML.parse(readFileSync(file, 'utf8')).rounds[0].items.map((i: { prompt: string }) => i.prompt)).toEqual([
      'Whose baby photo?',
      'Middle',
      'And this one?',
    ]);

    edited(file, [{ op: 'moveItem', roundId: 'photos', from: 2, to: 0 }]);
    edited(file, [{ op: 'removeItem', roundId: 'photos', index: 2 }]);
    expect(YAML.parse(readFileSync(file, 'utf8')).rounds[0].items.map((i: { prompt: string }) => i.prompt)).toEqual([
      'And this one?',
      'Whose baby photo?',
    ]);
  });

  it('adds, moves and removes rounds', () => {
    const file = scratch(base);
    edited(file, [
      {
        op: 'addRound',
        index: 0,
        round: { id: 'welcome', type: 'manual', title: 'Welcome', items: [{ prompt: 'Hello' }] },
      },
    ]);
    expect(YAML.parse(readFileSync(file, 'utf8')).rounds.map((r: { id: string }) => r.id)).toEqual([
      'welcome',
      'photos',
    ]);

    edited(file, [{ op: 'moveRound', roundId: 'welcome', toIndex: 1 }]);
    expect(YAML.parse(readFileSync(file, 'utf8')).rounds.map((r: { id: string }) => r.id)).toEqual([
      'photos',
      'welcome',
    ]);

    edited(file, [{ op: 'removeRound', roundId: 'welcome' }]);
    expect(YAML.parse(readFileSync(file, 'utf8')).rounds.map((r: { id: string }) => r.id)).toEqual(['photos']);
  });

  it('refuses an operation naming a round that is not there', () => {
    const file = scratch(base);
    expect(() => edited(file, [{ op: 'removeRound', roundId: 'nope' }])).toThrow(EditError);
  });

  it('leaves the file exactly as it was when an operation fails', () => {
    const file = scratch(base);
    const before = readFileSync(file, 'utf8');
    expect(() =>
      edited(file, [
        { op: 'setRoundField', roundId: 'photos', field: 'title', value: 'Changed' },
        { op: 'removeItem', roundId: 'photos', index: 99 },
      ]),
    ).toThrow(EditError);
    // Ops are applied to the in-memory document and only written on success, so
    // a bad edit halfway through a batch cannot leave the file half-updated.
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('produces a file the real loader still accepts', () => {
    const file = scratch(readFileSync(REAL_CONTENT, 'utf8'));
    edited(file, [
      { op: 'setRoundField', roundId: 'charades', field: 'timerSeconds', value: 60 },
      { op: 'addItem', roundId: 'charades', index: 0, item: { prompt: 'Act it out: THE HONEYMOON' } },
      { op: 'setItemField', roundId: 'how-well', index: 0, path: ['correct'], value: 'A' },
    ]);

    const content = loadContent(file);
    expect(content.brokenRounds).toEqual({});
    const charades = content.rounds.find((r) => r.id === 'charades');
    expect((charades?.config as { timerSeconds: number }).timerSeconds).toBe(60);
    expect((charades?.config as { items: { prompt: string }[] }).items[0].prompt).toContain('HONEYMOON');
  });

  it('rejects an edit that would make the file invalid, at load time', () => {
    const file = scratch(base);
    edited(file, [{ op: 'setItemField', roundId: 'photos', index: 0, path: ['prompt'], value: '' }]);
    // Clearing a required field removes the key; the schema is what catches it,
    // which is why the API validates after applying and before saving.
    expect(() => loadContent(file)).toThrow(/prompt/);
  });
});
