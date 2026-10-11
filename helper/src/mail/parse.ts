/**
 * Mapping from IMAP wire shapes to DayDesk rows.
 *
 * Pure functions only — everything here is driven by plain objects so it can be
 * tested without a server. Mail headers are attacker-controlled input, so
 * every field is treated as optional and coerced rather than trusted.
 */

import type { MailAddress } from '../types/mail.js';
import type { MessageInsert } from '../store/messages.js';

/** The subset of an imapflow envelope that DayDesk reads. */
export interface RawAddress {
  readonly name?: string | undefined;
  readonly address?: string | undefined;
}

export interface RawEnvelope {
  readonly date?: Date | string | undefined;
  readonly subject?: string | undefined;
  readonly messageId?: string | undefined;
  readonly from?: readonly RawAddress[] | undefined;
  readonly to?: readonly RawAddress[] | undefined;
  readonly cc?: readonly RawAddress[] | undefined;
}

/** The subset of an imapflow bodyStructure node that DayDesk reads. */
export interface RawBodyNode {
  readonly type?: string | undefined;
  readonly disposition?: string | undefined;
  readonly childNodes?: readonly RawBodyNode[] | undefined;
}

export interface RawFetchedMessage {
  readonly uid: number;
  readonly envelope?: RawEnvelope | undefined;
  readonly flags?: ReadonlySet<string> | readonly string[] | undefined;
  readonly size?: number | undefined;
  readonly internalDate?: Date | string | undefined;
  readonly bodyStructure?: RawBodyNode | undefined;
}

const SNIPPET_LENGTH = 200;

export function toMailAddress(raw: RawAddress | undefined): MailAddress | null {
  const address = raw?.address?.trim();
  if (!address) return null;
  return { name: raw?.name?.trim() ?? '', address };
}

export function toMailAddresses(raw: readonly RawAddress[] | undefined): readonly MailAddress[] {
  if (!raw) return [];
  return raw.map(toMailAddress).filter((addr): addr is MailAddress => addr !== null);
}

function toIsoString(value: Date | string | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toFlagArray(flags: RawFetchedMessage['flags']): readonly string[] {
  if (!flags) return [];
  return Array.isArray(flags) ? [...flags] : [...(flags as ReadonlySet<string>)];
}

/**
 * Walk a body structure looking for a part that presents as an attachment.
 *
 * Inline images carry a disposition of "inline" and are not counted — only
 * explicit attachments, which is what the paperclip in the list should mean.
 */
export function detectAttachments(node: RawBodyNode | undefined): boolean {
  if (!node) return false;
  if (node.disposition?.toLowerCase() === 'attachment') return true;
  return (node.childNodes ?? []).some(detectAttachments);
}

/** Collapse whitespace and truncate for the list preview line. */
export function makeSnippet(text: string | null | undefined, maxLength = SNIPPET_LENGTH): string {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Build an insertable row from a FETCH result.
 *
 * `internalDate` falls back to the envelope date and then to now, because it is
 * the sort key for the whole list and a null there would strand the message.
 */
export function toMessageInsert(fetched: RawFetchedMessage): MessageInsert {
  const envelope = fetched.envelope;
  const flags = toFlagArray(fetched.flags);
  const internalDate =
    toIsoString(fetched.internalDate) ?? toIsoString(envelope?.date) ?? new Date().toISOString();

  return {
    uid: fetched.uid,
    messageId: envelope?.messageId?.trim() ?? null,
    subject: envelope?.subject?.trim() ?? '',
    from: toMailAddress(envelope?.from?.[0]),
    to: toMailAddresses(envelope?.to),
    cc: toMailAddresses(envelope?.cc),
    date: toIsoString(envelope?.date),
    internalDate,
    size: fetched.size ?? 0,
    flags,
    isSeen: flags.includes('\\Seen'),
    isFlagged: flags.includes('\\Flagged'),
    hasAttachments: detectAttachments(fetched.bodyStructure),
    snippet: '',
  };
}
