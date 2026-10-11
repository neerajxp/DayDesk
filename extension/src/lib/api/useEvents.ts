/**
 * Live event stream from the helper.
 *
 * The socket is owned by the side panel, not the service worker — MV3 kills
 * service workers after ~30s idle, which would drop the connection. While the
 * panel is closed the helper raises OS notifications instead.
 *
 * Browsers cannot set an Authorization header on a WebSocket handshake, so the
 * token travels as a query parameter. That is acceptable over loopback.
 */

import { useEffect, useRef, useState } from 'react';
import type { ServerEvent } from './types.js';
import { HELPER_ORIGIN } from './client.js';

const RECONNECT_DELAY_MS = 3_000;

export function useEvents(token: string | null, onEvent: (event: ServerEvent) => void): boolean {
  const [isLive, setIsLive] = useState(false);
  // Keep the latest callback without resubscribing on every render.
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    if (!token) return;

    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = (): void => {
      if (disposed) return;

      const url = `${HELPER_ORIGIN.replace('http://', 'ws://')}/api/events?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);

      socket.onopen = () => setIsLive(true);

      socket.onmessage = (message) => {
        try {
          handler.current(JSON.parse(message.data as string) as ServerEvent);
        } catch {
          // A malformed frame is not worth tearing the connection down for.
        }
      };

      socket.onclose = () => {
        setIsLive(false);
        if (!disposed) retryTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };

      socket.onerror = () => socket?.close();
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [token]);

  return isLive;
}
