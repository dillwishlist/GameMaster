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

  useEffect(() => {
    const socket = io({ transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    const sayHello = () => {
      socket.emit('hello', { role, passphrase }, (res: { ok: boolean; error?: string }) => {
        if (res?.ok) {
          setStatus('ready');
          setError(null);
        } else {
          setStatus('denied');
          setError(res?.error ?? 'Rejected by server');
        }
      });
    };

    socket.on('connect', sayHello);
    socket.on('disconnect', () => setStatus('offline'));
    socket.on('connect_error', () => setStatus('offline'));
    socket.on(channel, (next: T) => setState(next));

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [role, channel, passphrase]);

  const dispatch = useCallback((event: GameEventInput) => {
    socketRef.current?.emit('dispatch', event);
  }, []);

  const command = useCallback((name: 'undo' | 'redo' | 'resetSession') => {
    socketRef.current?.emit(name);
  }, []);

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
