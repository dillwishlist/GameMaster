import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registerEditorRoutes } from '../server/editor/routes.js';
import { loadContent } from '../server/content.js';

/**
 * The editor API against a throwaway copy of the real content, because the
 * interesting cases are all about what it refuses to write.
 */
let server: Server;
let base: string;
let contentDir: string;
let contentFile: string;
let inPlay: string | null = null;

beforeAll(async () => {
  contentDir = mkdtempSync(path.join(tmpdir(), 'gamemaster-api-'));
  cpSync(path.resolve('content'), contentDir, { recursive: true });
  contentFile = path.join(contentDir, 'anniversary.yaml');

  const app = express();
  registerEditorRoutes(app, {
    contentFile,
    contentDir,
    isRoundInPlay: (roundId) => roundId === inPlay,
    isAuthorised: () => true,
  });

  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => {
  server?.close();
});

async function get() {
  const res = await fetch(`${base}/api/content`);
  return { status: res.status, body: (await res.json()) as Record<string, never> };
}

async function put(hash: string | undefined, ops: unknown[]) {
  const res = await fetch(`${base}/api/content`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hash, ops }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, never> };
}

describe('the editor API', () => {
  it('hands over the whole game, with the round types it understands', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.title).toBe('40th Anniversary Games');
    expect((body.rounds as unknown as { id: string }[]).map((r) => r.id)).toContain('baby-photos');
    expect(body.roundTypes as unknown as string[]).toEqual(
      expect.arrayContaining(['manual', 'multipleChoice', 'board']),
    );
    expect(body.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('saves an edit and leaves the comments alone', async () => {
    const { body: before } = await get();
    const { status, body } = await put(before.hash, [
      { op: 'setItemField', roundId: 'baby-photos', index: 0, path: ['answer'], value: 'David, aged two' },
    ]);

    expect(status).toBe(200);
    expect(body.saved).toBe(true);
    expect(body.hash).not.toBe(before.hash);

    const text = readFileSync(contentFile, 'utf8');
    expect(text).toContain('David, aged two');
    expect(text).toContain('# Only Lucy can score here.');
    expect(loadContent(contentFile).brokenRounds).toEqual({});
  });

  it('refuses a save from a page that has gone stale', async () => {
    const { body } = await get();
    // Someone edits the file by hand while the editor is open.
    writeFileSync(contentFile, `${readFileSync(contentFile, 'utf8')}\n# touched by hand\n`);

    const { status, body: err } = await put(body.hash, [
      { op: 'setRoundField', roundId: 'welcome', field: 'title', value: 'Clobbered' },
    ]);

    expect(status).toBe(409);
    expect(String(err.error)).toMatch(/changed on disk/);
    expect(readFileSync(contentFile, 'utf8')).not.toContain('Clobbered');
  });

  it('refuses to restructure a round that is on the TV, but allows rewording it', async () => {
    inPlay = 'baby-photos';
    const { body } = await get();

    const structural = await put(body.hash, [{ op: 'removeItem', roundId: 'baby-photos', index: 0 }]);
    expect(structural.status).toBe(409);
    expect(String(structural.body.error)).toMatch(/on the TV right now/);

    // Rewording is exactly what hot reload is for, so it must still work.
    const reword = await put(body.hash, [
      { op: 'setItemField', roundId: 'baby-photos', index: 0, path: ['prompt'], value: 'Whose baby is this one?' },
    ]);
    expect(reword.status).toBe(200);
    inPlay = null;
  });

  it('will not write a file the game could not load', async () => {
    const { body } = await get();
    const before = readFileSync(contentFile, 'utf8');

    const { status, body: err } = await put(body.hash, [
      // C is not one of this item's options any more than Z is.
      { op: 'setItemField', roundId: 'how-well', index: 0, path: ['correct'], value: 'Z' },
    ]);

    expect(status).toBe(422);
    expect(String(err.error)).toMatch(/must be one of/);
    expect(String(err.detail)).toMatch(/not saved/);
    // The gate is that nothing reached the disk.
    expect(readFileSync(contentFile, 'utf8')).toBe(before);
  });

  it('reports a round the game cannot use rather than hiding it', async () => {
    const text = readFileSync(contentFile, 'utf8');
    writeFileSync(
      contentFile,
      `${text}\n  - id: mystery\n    type: musicalChairs\n    title: 'Musical Chairs'\n`,
    );
    const { body } = await get();
    expect(Object.keys(body.brokenRounds)).toContain('mystery');
    writeFileSync(contentFile, text);
  });
});

describe('asset upload', () => {
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
      '05fe02fea7b5f2ad0000000049454e44ae426082',
    'hex',
  );

  it('stores an image and hands back a content-relative ref', async () => {
    const res = await fetch(`${base}/api/assets?name=Nan%20and%20Grandad.PNG`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: png,
    });
    const body = (await res.json()) as { ref: string };

    expect(res.status).toBe(200);
    expect(body.ref).toMatch(/^assets\/nan-and-grandad-[0-9a-f]{6}\.png$/);
    expect(readFileSync(path.join(contentDir, body.ref)).equals(png)).toBe(true);
  });

  it('decides the type from the bytes, not from what the client claims', async () => {
    const res = await fetch(`${base}/api/assets?name=totally-an-image.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('#!/bin/sh\nrm -rf /\n'),
    });
    expect(res.status).toBe(415);
  });

  it('generates the filename, so a crafted name cannot escape the assets folder', async () => {
    const res = await fetch(`${base}/api/assets?name=${encodeURIComponent('../../../etc/passwd')}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: png,
    });
    const body = (await res.json()) as { ref: string };

    expect(res.status).toBe(200);
    expect(body.ref).not.toContain('..');
    expect(body.ref).toMatch(/^assets\/etc-passwd-[0-9a-f]{6}\.png$/);
  });
});
