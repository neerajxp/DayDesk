/**
 * Live view of the WhatsApp watch list and tab status, shared by the header
 * pill and the sources sheet.
 */

import { useEffect, useState } from 'react';
import {
  CONNECTED_WITHIN_MS,
  onWhatsAppChange,
  readStatus,
  readWatchList,
  type WhatsAppStatus,
} from '../../lib/whatsapp/settings.js';

/** How often "connected" is re-evaluated as the tab's heartbeat ages. */
const RECHECK_MS = 15_000;

export interface WhatsAppState {
  readonly watchList: readonly string[];
  readonly status: WhatsAppStatus | null;
  readonly isConnected: boolean;
}

export function useWhatsAppState(): WhatsAppState {
  const [watchList, setWatchList] = useState<readonly string[]>([]);
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const load = (): void => {
      void readWatchList().then(setWatchList);
      void readStatus().then(setStatus);
    };
    load();
    return onWhatsAppChange(load);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RECHECK_MS);
    return () => clearInterval(timer);
  }, []);

  return { watchList, status, isConnected: status !== null && now - status.at < CONNECTED_WITHIN_MS };
}
