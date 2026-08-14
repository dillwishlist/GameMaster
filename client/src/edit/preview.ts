/**
 * The preview channel: put a question on the actual television without playing
 * it. Nothing enters the event log and no score moves — the server keeps the
 * preview beside the session rather than in it, and the display marks it.
 *
 * Why this opens its own socket. `useConnection` is the project's one socket
 * hook and this view uses it (see EditView) for the host state — whether a TV
 * is even connected, and which round is live. But its surface is `dispatch` and
 * `command`, both of which write to the session, and `preview` deliberately
 * does neither, so there is no method on it that can carry this message. Rather
 * than widen the hook that the run-day views depend on, the editor — which is
 * explicitly not on the run-day path — opens a second, clearly separate
 * connection whose only job is this one write. `forceNew` is load-bearing:
 * without it socket.io hands back the *same* socket `useConnection` is using,
 * and whichever hook unmounted first would close the other's connection.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { PreviewPayload } from './types.js';

export interface PreviewChannel {
  /** The prompt currently on the TV, or null. Drives the stop-preview bar. */
  showing: string | null;
  show: (payload: PreviewPayload) => void;
  clear: () => void;
}

export function usePreviewChannel(passphrase: string | undefined): PreviewChannel {
  const socketRef = useRef<Socket | null>(null);
  const greeted = useRef(false);
  /** Held while the socket is still saying hello; the server rejects anything sent before. */
  const queued = useRef<PreviewPayload | null | undefined>(undefined);
  const [showing, setShowing] = useState<string | null>(null);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'], forceNew: true });
    socketRef.current = socket;

    socket.on('connect', () => {
      greeted.current = false;
      socket.emit('hello', { role: 'host', passphrase }, (res: { ok: boolean }) => {
        if (!res?.ok) return;
        greeted.current = true;
        if (queued.current !== undefined) {
          socket.emit('preview', queued.current);
          queued.current = undefined;
        }
      });
    });
    socket.on('disconnect', () => {
      greeted.current = false;
    });

    return () => {
      // A preview left on the TV by a closed tab would sit there through the
      // party, so leaving the editor takes it down.
      if (greeted.current) socket.emit('preview', null);
      socket.close();
      socketRef.current = null;
      greeted.current = false;
      queued.current = undefined;
      setShowing(null);
    };
  }, [passphrase]);

  const send = useCallback((payload: PreviewPayload | null) => {
    const socket = socketRef.current;
    if (socket && greeted.current) socket.emit('preview', payload);
    else queued.current = payload;
    setShowing(payload ? payload.prompt : null);
  }, []);

  const show = useCallback((payload: PreviewPayload) => send(payload), [send]);
  const clear = useCallback(() => send(null), [send]);

  // Best effort on a hard close of the tab: the socket may not flush, which is
  // exactly why the display draws a permanent marker rather than trusting this.
  useEffect(() => {
    if (!showing) return;
    const onUnload = () => socketRef.current?.emit('preview', null);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [showing]);

  return { showing, show, clear };
}
