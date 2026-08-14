/**
 * The whole server. One Node process, three views, no database.
 *
 * Run it with `npm start`. It binds 0.0.0.0 because the iPad cannot reach
 * localhost, prints its LAN URL and a QR code, and serves every asset from
 * disk — the party works with the router up and the internet down.
 */

import { createServer } from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Server as SocketServer, type Socket } from 'socket.io';
import chokidar from 'chokidar';

import type { ClientRole, GameEventInput } from '../shared/events.js';
import { ContentError, contentWarnings, loadContent, resolveContentFile, type GameContent } from './content.js';
import { projectDisplay, projectHost, projectPlayer } from './game/projection.js';
import { Session } from './session.js';
import { printBanner } from './net.js';

const PORT = Number(process.env.GM_PORT ?? 4000);
const CONTENT_DIR = path.resolve(process.env.GM_CONTENT_DIR ?? 'content');
const DATA_DIR = path.resolve(process.env.GM_DATA_DIR ?? 'data');
const CLIENT_DIR = path.resolve('dist/client');
const PASSPHRASE = process.env.GM_PASSPHRASE ?? '';
/** `npm start -- --fresh` ignores any resumable session. */
const FRESH = process.argv.includes('--fresh');

/* -------------------------------------------------------------------------- */
/* Content                                                                    */
/* -------------------------------------------------------------------------- */

const contentFile = resolveContentFile(CONTENT_DIR, process.env.GM_CONTENT);
let content: GameContent = loadContent(contentFile);
/** Last hot-reload failure. Shown on the host view; never fatal mid-party. */
let contentError: string | null = null;

for (const warning of contentWarnings(content, CONTENT_DIR)) console.warn(`[content] ${warning}`);
for (const [id, error] of Object.entries(content.brokenRounds)) console.warn(`[content] round "${id}" unusable:\n${error}`);

/* -------------------------------------------------------------------------- */
/* Session                                                                    */
/* -------------------------------------------------------------------------- */

let { session, resumed } = FRESH
  ? { session: Session.create(DATA_DIR, content), resumed: false }
  : Session.resumeOrCreate(DATA_DIR, content);

/** Set below, once `io` exists — appending seeds pushes state to nobody yet. */
let unsubscribe: () => void = () => {};

/* -------------------------------------------------------------------------- */
/* HTTP                                                                       */
/* -------------------------------------------------------------------------- */

const app = express();
const http = createServer(app);
const io = new SocketServer(http, { serveClient: false });

app.get('/api/config', (_req, res) => {
  res.json({ passphraseRequired: PASSPHRASE.length > 0 });
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, session: session.id, events: session.eventCount, contentFile });
});

// Content assets: images, audio, avatars. Read-only, served straight off disk.
app.use('/content', express.static(CONTENT_DIR, { maxAge: '1h' }));

if (existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR));
  app.get(/^\/(host|display|play)(\/.*)?$/, (_req, res) => {
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });
  app.get('/', (_req, res) => res.redirect('/host'));
} else {
  app.get('*', (_req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send('Client not built. Run `npm run build` (or use `npm run dev` for the Vite dev server).');
  });
}

/* -------------------------------------------------------------------------- */
/* Sockets                                                                    */
/* -------------------------------------------------------------------------- */

unsubscribe = session.onChange(pushAll);

/**
 * Seed the entrants declared in the content file, so `restrictTo: [lucy]`
 * resolves and the host isn't typing names into an iPad while guests arrive.
 * Only on a fresh session — a resumed one already has them, edits and all.
 */
if (!resumed) {
  for (const seed of content.entrants) session.append({ type: 'ENTRANT_ADD', entrant: seed });
}

interface SocketData {
  role: ClientRole;
  entrantId: string | null;
}

io.on('connection', (socket: Socket) => {
  socket.on('hello', (payload: { role: ClientRole; passphrase?: string }, ack?: (r: unknown) => void) => {
    const role: ClientRole = payload?.role === 'display' || payload?.role === 'player' ? payload.role : 'host';

    if (role === 'host' && PASSPHRASE && payload?.passphrase !== PASSPHRASE) {
      ack?.({ ok: false, error: 'Wrong passphrase' });
      return;
    }

    const data = socket.data as SocketData;
    data.role = role;
    data.entrantId = null;
    void socket.join(role);
    ack?.({ ok: true });
    push(socket);
    if (role === 'display') pushAll();
  });

  socket.on('dispatch', (event: GameEventInput, ack?: (r: unknown) => void) => {
    if (!requireHost(socket, ack)) return;
    try {
      session.append(event);
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ ok: false, error: String(err) });
    }
  });

  // Do the work on its own line, then acknowledge. `ack?.(f())` would skip the
  // call entirely when the client didn't pass a callback — and the host view
  // doesn't, so undo would silently do nothing.
  socket.on('undo', (ack?: (r: unknown) => void) => {
    if (!requireHost(socket, ack)) return;
    const ok = session.undo();
    ack?.({ ok });
  });

  socket.on('redo', (ack?: (r: unknown) => void) => {
    if (!requireHost(socket, ack)) return;
    const ok = session.redo();
    ack?.({ ok });
  });

  socket.on('resetSession', (ack?: (r: unknown) => void) => {
    if (!requireHost(socket, ack)) return;
    unsubscribe();
    session = session.reset();
    unsubscribe = session.onChange(pushAll);
    for (const seed of content.entrants) session.append({ type: 'ENTRANT_ADD', entrant: seed });
    pushAll();
    ack?.({ ok: true });
  });

  socket.on('disconnect', pushAll);
});

function requireHost(socket: Socket, ack?: (r: unknown) => void): boolean {
  if ((socket.data as SocketData).role === 'host') return true;
  ack?.({ ok: false, error: 'Not the host' });
  return false;
}

function push(socket: Socket): void {
  const data = socket.data as SocketData;
  if (data.role === 'host') socket.emit('host', projectHost(session.state, content, env()));
  else if (data.role === 'display') socket.emit('display', projectDisplay(session.state, content));
  else socket.emit('player', projectPlayer(session.state, content, data.entrantId));
}

function pushAll(): void {
  io.to('host').emit('host', projectHost(session.state, content, env()));
  io.to('display').emit('display', projectDisplay(session.state, content));
  for (const socket of io.sockets.sockets.values()) {
    if ((socket.data as SocketData).role === 'player') push(socket);
  }
}

function env() {
  return {
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    avatarChoices: listAvatars(),
    contentError,
    displaysConnected: io.sockets.adapter.rooms.get('display')?.size ?? 0,
  };
}

function listAvatars(): string[] {
  const dir = path.join(CONTENT_DIR, 'avatars');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f))
    .sort()
    .map((f) => `/content/avatars/${f}`);
}

/* -------------------------------------------------------------------------- */
/* Content hot reload                                                         */
/* -------------------------------------------------------------------------- */

chokidar
  .watch(path.join(CONTENT_DIR, '*.{yaml,yml}'), { ignoreInitial: true })
  .on('all', () => {
    try {
      content = loadContent(contentFile);
      contentError = null;
      session.reloadContent(content);
      console.log(`[content] reloaded ${path.relative(process.cwd(), contentFile)}`);
      for (const warning of contentWarnings(content, CONTENT_DIR)) console.warn(`[content] ${warning}`);
    } catch (err) {
      // A typo in the YAML must never take the game down. Keep serving the last
      // good content and surface the error on the host view.
      contentError = err instanceof ContentError ? err.message : String(err);
      console.error(`[content] reload failed, keeping previous content:\n${contentError}`);
    }
    pushAll();
  });

/* -------------------------------------------------------------------------- */

http.listen(PORT, '0.0.0.0', () => {
  printBanner(PORT, {
    contentFile: path.relative(process.cwd(), contentFile),
    sessionId: session.id,
    resumed,
  });
});
