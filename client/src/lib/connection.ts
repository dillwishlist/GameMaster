import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientRole, GameEventInput } from '../../../shared/events.js';

export type ConnectionStatus = 'connecting' | 'ready' | 'denied' | 'offline';

export interface Connection<T> {
  state: T | null;
  status: ConnectionStatus;
  error: string | null;
  dispatch: (event: GameEventInput) => void;
  command: (name: 'undo' | 'redo' | 'resetSession') => void;
}

/**
 * One socket per view. Reconnection is socket.io's job; ours is to re-say hello
 * afterwards and to keep rendering the last known state while the link is down,
 * so a wifi blip looks like a frozen screen rather than a blank one.
 */
export function useConnection<T>(role: ClientRole, channel: string, passphrase?: string): Connection<T> {
  const [state, setState] = useState<T | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  /** Set once `hello` has been acknowledged. Nothing may be sent before it. */
  const greeted = useRef(false);
  /**
   * Commands the host issued while the link was down or unproven. Held here
   * rather than in socket.io's own send buffer, which flushes on CONNECT —
   * before `hello` runs — so the server rejects the lot as "not the host" and,
   * because nothing asks for an acknowledgement, does so invisibly.
   */
  const queued = useRef<{ name: string; args: unknown[] }[]>([]);

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    // `args` is spread rather than passed as one value: `undo` and friends take
    // their acknowledgement as the *first* argument, so handing them an explicit
    // `undefined` payload would shift the callback out of the server's reach and
    // silently break them — which is how the undo button died once already.
    const send = (name: string, args: unknown[]) => {
      // A tap that goes unacknowledged is a point that never happened, so the
      // host has to see it. 2s is long enough not to cry wolf on a slow phone
      // and short enough that they notice before the next question.
      socket.timeout(2000).emit(name, ...args, (err: unknown, res?: { ok?: boolean }) => {
        if (err) {
          // The socket still believes it is connected — this is the wifi
          // dropping without a TCP reset, which is exactly the iPad case.
          setStatus('offline');
          return;
        }
        setStatus(res && res.ok === false ? 'offline' : 'ready');
      });
    };

    const sayHello = () => {
      greeted.current = false;
      socket.emit('hello', { role, passphrase }, (res: { ok: boolean; error?: string }) => {
        if (res?.ok) {
          greeted.current = true;
          setStatus('ready');
          setError(null);
          // Only now is the server willing to hear from us.
          const pending = queued.current;
          queued.current = [];
          for (const item of pending) send(item.name, item.args);
        } else {
          setStatus('denied');
          setError(res?.error ?? 'Rejected by server');
        }
      });
    };

    socket.on('connect', sayHello);
    socket.on('disconnect', () => {
      greeted.current = false;
      setStatus('offline');
    });
    socket.on('connect_error', () => setStatus('offline'));
    socket.on(channel, (next: T) => {
      setState(next);
      // Any inbound push proves the link is alive. Without this the indicator
      // can stay red after the wifi comes back, because the acknowledgement it
      // was waiting on had already timed out and will never arrive.
      setStatus((current) => (current === 'denied' ? current : 'ready'));
    });

    return () => {
      socket.close();
      socketRef.current = null;
      greeted.current = false;
      queued.current = [];
    };
  }, [role, channel, passphrase]);

  const enqueue = useCallback((name: string, args: unknown[]) => {
    const socket = socketRef.current;
    if (!socket || !socket.connected || !greeted.current) {
      queued.current.push({ name, args });
      setStatus('offline');
      return;
    }
    socket.timeout(2000).emit(name, ...args, (err: unknown, res?: { ok?: boolean }) => {
      if (err) {
        setStatus('offline');
        return;
      }
      setStatus(res && res.ok === false ? 'offline' : 'ready');
    });
  }, []);

  const dispatch = useCallback((event: GameEventInput) => enqueue('dispatch', [event]), [enqueue]);

  const command = useCallback((name: 'undo' | 'redo' | 'resetSession') => enqueue(name, []), [enqueue]);

  return { state, status, error, dispatch, command };
}

/**
 * Keep the tablet awake. Safari drops the lock when the tab is backgrounded, so
 * re-acquire on visibility change. The run-day checklist also says to turn off
 * auto-lock — belt and braces, because a locked iPad mid-round is a dead party.
 */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const wakeLock = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<any> } }).wakeLock;
        if (!wakeLock) return;
        const next = await wakeLock.request('screen');
        if (cancelled) void next.release();
        else lock = next;
      } catch {
        // Denied or unsupported. The checklist covers it.
      }
    };

    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);
}
