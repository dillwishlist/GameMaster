/**
 * The editor's HTTP surface.
 *
 * This is the first place the server writes something a client sent, so the
 * rules are explicit:
 *
 *  - **Validate before writing.** Ops are applied to an in-memory document,
 *    serialised, and run through the same validator the game uses at load time.
 *    Only a document that would actually load reaches the disk. A content file
 *    the server cannot parse is a party that does not start.
 *  - **Never clobber.** Every save carries the hash of the file the editor was
 *    looking at. If the bytes on disk have moved — a hand edit, a git pull, a
 *    second browser window — the save is refused rather than merged blindly.
 *  - **Never fight the live game.** `Session.reloadContent` refuses a structural
 *    change to a round that is in play. The editor asks the same question first
 *    so the host is told before they type, not after they save.
 */

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import express from 'express';
import { ContentError, parseContent, type GameContent } from '../content.js';
import { knownRoundTypeIds } from '../roundTypes/index.js';
import { applyOps, EditError, hashOf, loadContentDoc, saveContentDoc, type EditOp } from './contentDoc.js';

export interface EditorDeps {
  contentFile: string;
  contentDir: string;
  /** True when the host has this round open right now. */
  isRoundInPlay: (roundId: string) => boolean;
  /** Whether a request may edit. Same gate as the host view. */
  isAuthorised: (req: Request) => boolean;
}

/** Ops that move questions around, as opposed to rewording them. */
const STRUCTURAL: EditOp['op'][] = [
  'addItem',
  'removeItem',
  'moveItem',
  'removeRound',
  // A board addresses squares by column and row, so adding or removing either
  // shifts the same way an item index does.
  'addCategory',
  'removeCategory',
  'moveCategory',
  'addClue',
  'removeClue',
  'moveClue',
];

const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/** Sniffed from the bytes, never trusted from the filename or the client. */
const MAGIC: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', test: (b) => b.subarray(0, 6).toString('ascii').startsWith('GIF8') },
  { ext: 'webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { ext: 'wav', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WAVE' },
  { ext: 'mp3', test: (b) => b.subarray(0, 3).toString('ascii') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { ext: 'svg', test: (b) => b.subarray(0, 400).toString('utf8').trim().toLowerCase().startsWith('<svg') },
];

export function registerEditorRoutes(app: Express, deps: EditorDeps): void {
  const guard = (req: Request, res: Response): boolean => {
    if (deps.isAuthorised(req)) return true;
    res.status(403).json({ error: 'Not the host' });
    return false;
  };

  app.get('/api/content', (req, res) => {
    if (!guard(req, res)) return;
    try {
      res.json(readModel(deps));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put('/api/content', express.json({ limit: '2mb' }), (req, res) => {
    if (!guard(req, res)) return;

    const body = req.body as { hash?: string; ops?: EditOp[] };
    const ops = Array.isArray(body?.ops) ? body.ops : null;
    if (!ops) {
      res.status(400).json({ error: 'Expected { hash, ops }' });
      return;
    }

    try {
      const current = loadContentDoc(deps.contentFile);

      if (body.hash && body.hash !== current.hash) {
        res.status(409).json({
          error:
            'The content file changed on disk since this page loaded — someone edited it by hand, or another window saved. Reload to see it.',
          hash: current.hash,
        });
        return;
      }

      const blocked = ops.find(
        (op) => STRUCTURAL.includes(op.op) && 'roundId' in op && deps.isRoundInPlay(String(op.roundId)),
      );
      if (blocked) {
        res.status(409).json({
          error:
            'That round is on the TV right now. Questions are addressed by position, so adding or removing one would move the round underneath itself. Reword freely; restructure between rounds.',
        });
        return;
      }

      const before = parseContent(current.text, deps.contentFile);
      applyOps(current.doc, ops);

      // The gate: serialise, validate, and only then write. `parseContent`
      // is the same function the server calls when it loads the game.
      const text = current.doc.toString({ lineWidth: 0 });
      let validated: GameContent;
      try {
        validated = parseContent(text, deps.contentFile);
      } catch (err) {
        res.status(422).json({
          error: err instanceof ContentError ? err.message : String(err),
          detail: 'The edit was not saved.',
        });
        return;
      }

      // A round whose config fails validation is *quarantined* rather than
      // fatal — `parseContent` drops it into `brokenRounds` so one bad round
      // cannot take the game down. That is right at load time and wrong here:
      // it would let the editor save an edit that quietly deletes a round from
      // the game. Refuse anything that breaks a round that currently works.
      const newlyBroken = Object.entries(validated.brokenRounds).filter(([id]) => !(id in before.brokenRounds));
      if (newlyBroken.length > 0) {
        const [id, why] = newlyBroken[0];
        res.status(422).json({
          error: `That would stop round "${id}" loading:\n${why}`,
          detail: 'The edit was not saved.',
        });
        return;
      }

      saveContentDoc(deps.contentFile, current.doc);
      res.json({ ...model(validated, hashOf(text), deps), saved: true });
    } catch (err) {
      const status = err instanceof EditError ? 400 : 500;
      res.status(status).json({ error: String(err instanceof Error ? err.message : err) });
    }
  });

  /**
   * Asset upload. Raw body rather than multipart: one file per request, the
   * filename is generated here, and the type is decided by looking at the
   * bytes. Nothing the client sends is ever joined onto a path.
   */
  app.post(
    '/api/assets',
    // `type: () => true` rather than a matcher: a `fetch` with a Buffer body
    // sends no content-type at all, and the bytes are what we trust anyway.
    express.raw({ type: () => true, limit: MAX_ASSET_BYTES }),
    (req, res) => {
      if (!guard(req, res)) return;

      const bytes = req.body as Buffer;
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
        res.status(400).json({ error: 'Empty upload' });
        return;
      }

      const kind = MAGIC.find((m) => m.test(bytes));
      if (!kind) {
        res.status(415).json({ error: 'Only images and audio, and the file has to actually be one' });
        return;
      }

      const dir = path.join(deps.contentDir, 'assets');
      mkdirSync(dir, { recursive: true });

      const name = `${slug(String(req.query.name ?? 'upload'))}-${randomBytes(3).toString('hex')}.${kind.ext}`;
      writeFileSync(path.join(dir, name), bytes);

      // Content-relative, which is what the YAML wants.
      res.json({ ref: `assets/${name}`, bytes: bytes.length });
    },
  );
}

function readModel(deps: EditorDeps) {
  const { text } = loadContentDoc(deps.contentFile);
  return model(parseContent(text, deps.contentFile), hashOf(text), deps);
}

/**
 * What the editor sees. Round configs are handed over as-is — the editor forms
 * are written per round type, and the schema stays the single validator.
 */
function model(content: GameContent, hash: string, deps: EditorDeps) {
  return {
    hash,
    file: path.relative(process.cwd(), content.sourceFile),
    title: content.title,
    entrants: content.entrants,
    roundTypes: knownRoundTypeIds(),
    brokenRounds: content.brokenRounds,
    rounds: content.rounds.map((round) => ({
      id: round.id,
      type: round.type,
      title: round.title,
      restrictTo: round.restrictTo ?? null,
      defaultPoints: round.defaultPoints ?? null,
      config: round.config,
      inPlay: deps.isRoundInPlay(round.id),
    })),
    assets: listAssets(deps.contentDir),
  };
}

function listAssets(contentDir: string): string[] {
  const dir = path.join(contentDir, 'assets');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|gif|webp|svg|wav|mp3)$/i.test(f))
    .sort()
    .map((f) => `assets/${f}`);
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'asset'
  );
}
