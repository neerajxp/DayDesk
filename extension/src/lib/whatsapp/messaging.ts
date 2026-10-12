/**
 * The message the WhatsApp tab sends to the background worker.
 *
 * Content scripts on web.whatsapp.com cannot call the helper themselves — the
 * page's CSP and CORS apply to them — so they hand messages to the background
 * worker, which holds the pairing token and the loopback host permission.
 */

export interface ChatMessagePayload {
  readonly chat: string;
  readonly sender: string;
  readonly text: string;
  readonly isFromMe: boolean;
  /** ISO timestamp. */
  readonly sentAt: string;
}

export interface DeliverRequest {
  readonly type: 'daydesk:whatsapp:deliver';
  readonly messages: readonly ChatMessagePayload[];
}

export type DeliverResponse =
  | { readonly ok: true; readonly accepted: number; readonly added: number; readonly linked: number }
  | { readonly ok: false; readonly error: string };

export function isDeliverRequest(value: unknown): value is DeliverRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'daydesk:whatsapp:deliver' &&
    Array.isArray((value as { messages?: unknown }).messages)
  );
}
