/**
 * Rules for chat messages (WhatsApp).
 *
 * Chat is not email: no subject, no sender bulk-ness, short informal text, and
 * the request is usually the whole message ("pls pay the electricity bill
 * today"). So one message yields at most one task, its title is the message's
 * first sentence, and relative words like "today" count as dates even without
 * a "due" keyword.
 *
 * Only messages from chats the user chose to watch ever reach this function —
 * the WhatsApp tab filters before sending anything.
 */

import type { TaskCandidate, TaskKind } from '../types/tasks.js';
import { addDays, findAmount, findDueDate, findFirstDate, startOfDay, toDateKey } from './dates.js';
import { looksLikeDeadline, matchActionKind, payeeIn, payObjectIn, truncate } from './extract.js';

export interface ChatInput {
  readonly text: string;
  readonly chatName: string;
  readonly sender: string;
  /** Your own messages only count when explicitly marked ("todo: …"). */
  readonly isFromMe: boolean;
  readonly sentAt: Date;
}

const MAX_TITLE_CHARS = 90;
const MAX_TEXT_CHARS = 2_000;

/**
 * Bump whenever the chat rules change. Stored messages checked by an older
 * version are checked again (see chatScan.ts), so a better rule also catches
 * messages that arrived before it existed. Safe: saving is idempotent and never
 * revives a finished or dismissed task.
 */
export const CHAT_RULES_VERSION = 2;

/**
 * "Pay pseg 25$ today", "pay Ramesh" — a bare instruction to pay someone.
 * Idioms that are not payments ("pay attention", "pay a visit") are excluded.
 */
const IMPERATIVE_PAY =
  /^\s*(?:(?:please|pls|plz|kindly)\s+)?pay\s+(?!(?:attention|heed|respects?|tribute|a\s+visit|back|off|up|homage)\b)\S/i;

/**
 * A message that opens with an unambiguous action verb is an instruction:
 * "call the plumber tomorrow", "book train tickets". Only verbs that are rarely
 * used to open small talk — "get" and "check" are left out on purpose.
 */
const ACTION_START =
  /^\s*(?:call|send|book|buy|renew|submit|collect|pick\s+up|drop\s+off|transfer|deposit|file|schedule|cancel|order|bring|fill|recharge|top\s+up|return|apply\s+for|email|reply\s+to|remind)\b/i;

/** Tokens that end a payee's name in "pay <payee> <amount> <when>". */
const PAYEE_STOP =
  /^(?:[$€£₹\d].*|rs\.?|inr|usd|today|tonight|tomorrow|tmrw|by|on|before|for|at|this|next|asap|now|via|through|using|in|from|amount|of|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)$/i;
const MAX_PAYEE_WORDS = 5;

/** "Pay pseg 25$ today" → "pseg"; "pay the plumber 500 rs" → "the plumber". */
function payeeAfterPay(text: string): string | null {
  const rest = /\bpay\s+(.+)$/is.exec(text)?.[1] ?? '';
  const words: string[] = [];
  for (const raw of rest.split(/\s+/)) {
    const word = raw.replace(/[.,;:!?]+$/, '');
    if (!word || PAYEE_STOP.test(word) || words.length >= MAX_PAYEE_WORDS) break;
    words.push(word);
    if (raw !== word) break; // punctuation ends the name
  }
  return words.length > 0 ? words.join(' ') : null;
}

/** "todo: …", "Reminder - …", "remind me to …" — the user saying "this is a task". */
const MARKER =
  /^\s*(?:todo|to-do|to\s+do|task|reminder|remind\s+me(?:\s+to)?|action(?:\s+item)?|note\s+to\s+self)\s*[:\-–—]?\s+(.+)$/is;

/** Words that turn a chat message into a request of you. */
const REQUEST =
  /\b(?:please|pls|plz|kindly|can\s+you|could\s+you|would\s+you|don'?t\s+forget|do\s+not\s+forget|remember\s+to|make\s+sure|need\s+you\s+to|you\s+need\s+to|you\s+have\s+to|you\s+must|need\s+(?:a|an|the|to)\b)/i;

const RELATIVE_DAY = /\b(today|tonight|tomorrow|tmrw)\b/i;

function dueDateIn(text: string, sentAt: Date): string | null {
  // A chat message is one request, so an explicit date in it is its deadline —
  // "pay the rent on 1st Nov" needs no "due".
  const due = findDueDate(text, sentAt) ?? findFirstDate(text, sentAt);
  if (due) return due;
  // In chat, "pay the bill today" is a deadline even with no "due"/"by".
  const relative = RELATIVE_DAY.exec(text)?.[1]?.toLowerCase();
  if (!relative) return null;
  const isTomorrow = relative === 'tomorrow' || relative === 'tmrw';
  return toDateKey(addDays(startOfDay(sentAt), isTomorrow ? 1 : 0));
}

function firstSentence(text: string): string {
  const [sentence = text] = text.split(/(?<=[.!?])\s+|\n/);
  const trimmed = sentence.replace(/[.!?]+$/, '').trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function classify(text: string): TaskKind | 'vetoed' | null {
  const action = matchActionKind(text);
  if (action) return action.isVetoed ? 'vetoed' : action.kind;
  if (IMPERATIVE_PAY.test(text)) return 'pay';
  if (REQUEST.test(text) || ACTION_START.test(text)) return 'todo';
  return null;
}

export function extractChatTask(input: ChatInput): TaskCandidate | null {
  const text = input.text.replace(/[ \t]+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
  if (!text) return null;

  const marked = MARKER.exec(text)?.[1]?.trim();
  if (input.isFromMe && !marked) return null;

  const body = marked ?? text;
  const dueDate = dueDateIn(body, input.sentAt);

  let kind = classify(body);
  if (kind === 'vetoed') return null;
  if (!kind && marked) kind = 'todo';
  if (!kind && dueDate && looksLikeDeadline(body)) kind = 'deadline';
  if (!kind) return null;

  // Most specific first: "pay … to Sharma ji", then "pay the electricity bill",
  // then a bare "pay pseg".
  const payee = kind === 'pay' ? payeeIn(body) : null;
  const payObject = kind === 'pay' && !payee ? payObjectIn(body) : null;
  const barePayee = kind === 'pay' && !payee && !payObject ? payeeAfterPay(body) : null;
  const title = payee
    ? `Pay ${payee.replace(/\s+(?:for\s+)?(?:by|before|on)\b.*$/i, '')}`
    : payObject
      ? `Pay ${payObject}`
      : barePayee
        ? `Pay ${barePayee}`
        : firstSentence(body);

  return {
    kind,
    title: truncate(title, MAX_TITLE_CHARS),
    dueDate,
    amount: kind === 'pay' || kind === 'cheque' ? findAmount(body) : null,
  };
}
