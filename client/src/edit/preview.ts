/**
 * The preview channel: put a question on the actual television without playing
 * it. Nothing enters the event log and no score moves — the server keeps the
 * preview beside the session rather than in it, and the display marks it.
 *
 * It rides the connection the editor already holds. `useConnection.send` exists
 * for exactly this: a message that is neither an event nor a session command,
 * so it has no business going through `dispatch`, but equally no business
 * opening a second host socket to say one word.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PreviewPayload } from './types.js';

export interface PreviewChannel {
  /** The prompt currently on the TV, or null. Drives the stop-preview bar. */
  showing: string | null;
  show: (payload: PreviewPayload) => void;
  clear: () => void;
}

export function usePreviewChannel(send: (name: string, ...args: unknown[]) => void): PreviewChannel {
  const [showing, setShowing] = useState<string | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;

  const show = useCallback((payload: PreviewPayload) => {
    sendRef.current('preview', payload);
    setShowing(payload.prompt);
  }, []);

  const clear = useCallback(() => {
    sendRef.current('preview', null);
    setShowing(null);
  }, []);

  /**
   * A preview left on the TV by a closed tab would sit there through the party,
   * so leaving takes it down. This has to happen on `beforeunload` rather than
   * in an unmount cleanup: React tears effects down in the order they were
   * declared, so by the time this hook's cleanup ran the connection it was
   * about to speak through would already be closed.
   *
   * It is best effort either way — a socket write on the way out may not flush,
   * which is precisely why the display draws a permanent marker rather than
   * trusting this.
   */
  useEffect(() => {
    if (!showing) return;
    const onUnload = () => sendRef.current('preview', null);
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [showing]);

  return { showing, show, clear };
}
