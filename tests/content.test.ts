import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ContentError, contentWarnings, loadContent, resolveContentFile } from '../server/content.js';

function write(yaml: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'gamemaster-content-'));
  const file = path.join(dir, 'game.yaml');
  writeFileSync(file, yaml);
  return file;
}

const GOOD = `
title: Test Game
entrants:
  - id: lucy
    displayName: Lucy
rounds:
  - id: photos
    type: manual
    title: Whose Baby
    defaultPoints: 2
    items:
      - prompt: Whose baby photo?
        answer: David
  - id: quiz
    type: multipleChoice
    title: Trivia
    items:
      - prompt: Where did they meet?
        options: [Bus, Lab]
        correct: B
`;

describe('content loading', () => {
  it('loads rounds and validates each type’s config', () => {
    const content = loadContent(write(GOOD));
    expect(content.title).toBe('Test Game');
    expect(content.rounds.map((r) => r.id)).toEqual(['photos', 'quiz']);
    expect(content.rounds[0].defaultPoints).toBe(2);
    expect(content.entrants[0].id).toBe('lucy');
  });

  it('points at the line when the YAML is wrong', () => {
    const file = write(`
title: Test Game
rounds:
  - id: photos
    type: manual
    title: Whose Baby
    items:
      - answer: David
`);
    // `prompt` is missing on the item — the error must name the file and a line
    // close enough to fix at 9:15 on a Sunday.
    expect(() => loadContent(file)).toThrow(ContentError);
    try {
      loadContent(file);
    } catch (err) {
      expect(String(err)).toMatch(/game\.yaml:\d+/);
      expect(String(err)).toMatch(/prompt/);
    }
  });

  it('rejects a multipleChoice answer letter that has no option', () => {
    const file = write(`
title: Test Game
rounds:
  - id: quiz
    type: multipleChoice
    title: Trivia
    items:
      - prompt: Where?
        options: [Bus, Lab]
        correct: D
`);
    expect(() => loadContent(file)).toThrow(/must be one of A, B/);
  });

  it('quarantines one broken round instead of losing the whole game', () => {
    const file = write(`
title: Test Game
rounds:
  - id: photos
    type: manual
    title: Whose Baby
    items:
      - prompt: Whose baby photo?
        answer: David
  - id: mystery
    type: musicalChairs
    title: Musical Chairs
`);
    const content = loadContent(file);
    expect(content.rounds.map((r) => r.id)).toEqual(['photos']);
    expect(content.brokenRounds.mystery).toMatch(/Unknown round type/);
  });

  it('refuses duplicate round ids', () => {
    const file = write(`
title: Test Game
rounds:
  - id: photos
    type: manual
    title: One
    items: [{ prompt: a }]
  - id: photos
    type: manual
    title: Two
    items: [{ prompt: b }]
`);
    expect(() => loadContent(file)).toThrow(/duplicate round ids: photos/);
  });

  it('warns when restrictTo names an entrant nobody creates', () => {
    const file = write(`
title: Test Game
rounds:
  - id: kids
    type: manual
    title: Just For Lucy
    restrictTo: [lucy]
    items: [{ prompt: How many grandchildren? }]
`);
    const warnings = contentWarnings(loadContent(file), path.dirname(file));
    expect(warnings.join('\n')).toMatch(/restricted to entrant "lucy"/);
  });

  it('warns about a missing image rather than finding out on the TV', () => {
    const file = write(`
title: Test Game
rounds:
  - id: photos
    type: manual
    title: Whose Baby
    items:
      - prompt: Whose baby photo?
        media: { image: assets/nope.jpg }
`);
    const warnings = contentWarnings(loadContent(file), path.dirname(file));
    expect(warnings.join('\n')).toMatch(/missing asset: assets\/nope\.jpg/);
  });

  it('finds the content file without being told which one', () => {
    const file = write(GOOD);
    expect(resolveContentFile(path.dirname(file))).toBe(file);
  });
});
