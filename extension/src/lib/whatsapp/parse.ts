/**
 * Pure parsing of what WhatsApp Web puts in its DOM. No DOM access here, so
 * every rule is testable with plain strings; the content script does the
 * querying and hands the raw attributes over.
 *
 * Two attributes carry nearly everything, and both have been stable across
 * WhatsApp Web releases for years:
 *   - data-id on a message row:  "false_919876543210@c.us_3EB0C4…"
 *                                 (fromMe _ chat JID _ message id [_ participant])
 *   - data-pre-plain-text:       "[10:32 AM, 10/11/2026] Mom: "
 */

export interface MessageMeta {
  readonly isFromMe: boolean;
  /** Chat JID, e.g. "919876543210@c.us" or "120363…@g.us". */
  readonly chatJid: string;
}

export function parseDataId(dataId: string): MessageMeta | null {
  const match = /^(true|false)_([^_]+@[a-z.]+)_/.exec(dataId);
  if (!match) return null;
  return { isFromMe: match[1] === 'true', chatJid: match[2]! };
}

/** The phone digits in a one-to-one chat JID; null for groups and hidden (@lid) ids. */
export function phoneFromJid(jid: string): string | null {
  const match = /^(\d{7,15})@(?:c|s)\.whatsapp\.net$|^(\d{7,15})@c\.us$/.exec(jid);
  return match?.[1] ?? match?.[2] ?? null;
}

export interface PrePlain {
  readonly sentAt: Date | null;
  readonly sender: string;
}

/**
 * Parse "[10:32 AM, 10/11/2026] Mom: ".
 *
 * The date's order follows the browser locale (WhatsApp formats it that way):
 * month-first for en-US, day-first nearly everywhere else. A part above 12
 * settles it regardless.
 */
export function parsePrePlainText(attribute: string, locale: string): PrePlain {
  const match = /^\[([^,\]]+),\s*([^\]]+)\]\s*(.*?):\s*$/s.exec(attribute.trim() + ' ');
  if (!match) return { sentAt: null, sender: '' };

  const [, timePart = '', datePart = '', sender = ''] = match;
  return { sentAt: combine(parseDate(datePart, locale), parseTime(timePart)), sender: sender.trim() };
}

function parseDate(text: string, locale: string): { year: number; month: number; day: number } | null {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text.trim());
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };

  const parts = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/.exec(text.trim());
  if (!parts) return null;
  let first = Number(parts[1]);
  let second = Number(parts[2]);
  const year = parts[3]!.length === 2 ? 2000 + Number(parts[3]) : Number(parts[3]);

  const isMonthFirst = first > 12 ? false : second > 12 ? true : /^en-US\b/i.test(locale);
  if (!isMonthFirst) [first, second] = [second, first];
  return { year, month: first, day: second };
}

function parseTime(text: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2})[:.](\d{2})(?:\s*([ap])\.?\s*m\.?)?$/i.exec(text.trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'p' && hours < 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;
  return hours < 24 && minutes < 60 ? { hours, minutes } : null;
}

function combine(
  date: { year: number; month: number; day: number } | null,
  time: { hours: number; minutes: number } | null,
): Date | null {
  if (!date) return null;
  const result = new Date(date.year, date.month - 1, date.day, time?.hours ?? 12, time?.minutes ?? 0);
  return result.getMonth() === date.month - 1 && result.getDate() === date.day ? result : null;
}

// ── Watch list ──────────────────────────────────────────────────────────────

/** Compare phone numbers on their last 10 digits, so "+91 98765 43210" matches "9876543210". */
const PHONE_SUFFIX_DIGITS = 10;

export function digitsOf(text: string): string {
  return text.replace(/\D/g, '');
}

export function isPhoneEntry(entry: string): boolean {
  return /^[+\d\s().-]+$/.test(entry.trim()) && digitsOf(entry).length >= 7;
}

function samePhone(a: string, b: string): boolean {
  const left = digitsOf(a);
  const right = digitsOf(b);
  if (left.length < 7 || right.length < 7) return false;
  return left.slice(-PHONE_SUFFIX_DIGITS) === right.slice(-PHONE_SUFFIX_DIGITS);
}

export function normalizeEntry(entry: string): string {
  return entry.trim().replace(/\s+/g, ' ');
}

/** WhatsApp labels your own chat "Name (You)"; the watch list should not have to. */
export function cleanChatTitle(title: string): string {
  return normalizeEntry(title).replace(/\s*\((?:you|tú|vous|du|tu|você)\)$/i, '');
}

/**
 * The time label on a chat-list row, as a Date — only when it pins the
 * message to today ("10:32 AM") or yesterday. Older labels ("Monday",
 * "10/09/2026") return null: an old preview is not news.
 */
export function parseListTime(label: string, now: Date = new Date()): Date | null {
  const text = label.trim();
  const time = /^(\d{1,2})[:.](\d{2})(?:\s*([ap])\.?\s*m\.?)?$/i.exec(text);
  if (time) {
    let hours = Number(time[1]);
    const meridiem = time[3]?.toLowerCase();
    if (meridiem === 'p' && hours < 12) hours += 12;
    if (meridiem === 'a' && hours === 12) hours = 0;
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, Number(time[2]));
  }
  if (/^yesterday$/i.test(text)) return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0);
  return null;
}

/**
 * Is this chat on the watch list?
 *
 * Name entries match the chat title exactly (case-insensitive) — a watched
 * "Family" must not also pull in "Family Friends". Number entries match the
 * title when the contact is unsaved, or the chat's JID when it is saved under
 * a name.
 */
export function isWatched(entries: readonly string[], chat: { title: string; jid: string | null }): boolean {
  const title = cleanChatTitle(chat.title).toLowerCase();
  const phone = chat.jid ? phoneFromJid(chat.jid) : null;

  return entries.some((raw) => {
    const entry = normalizeEntry(raw);
    if (!entry) return false;
    if (isPhoneEntry(entry)) return samePhone(entry, chat.title) || (phone !== null && samePhone(entry, phone));
    return cleanChatTitle(entry).toLowerCase() === title;
  });
}
