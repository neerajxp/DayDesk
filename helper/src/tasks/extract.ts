/**
 * The rules engine: turns one email into zero or more task candidates.
 *
 * Runs entirely on this machine — no email content is sent anywhere. Rules are
 * deliberately conservative: a missed task can be added by hand in one tap,
 * but a feed full of false alarms teaches you to ignore the panel.
 *
 * Pure function of its input, so every rule is unit-testable with plain
 * strings.
 */

import type { TaskCandidate, TaskKind } from '../types/tasks.js';
import { findAmount, findDueDate } from './dates.js';

export interface ExtractInput {
  readonly subject: string;
  readonly fromName: string;
  readonly fromAddress: string;
  /** Null when only headers have been synced. Rules still run on the subject. */
  readonly bodyText: string | null;
  readonly receivedAt: Date;
}

interface Rule {
  readonly kind: TaskKind;
  readonly match: RegExp;
  readonly exclude?: RegExp;
  /** Bulk senders (no-reply, newsletters) never produce this kind. */
  readonly personalOnly?: boolean;
  /** Only keep the candidate if a due date was found — cuts noise for vague rules. */
  readonly requiresDate?: boolean;
  readonly title: (input: ExtractInput, subject: string) => string;
}

/**
 * Bump whenever RULES change. Messages scanned by an older version are scanned
 * again, so an improved rule also catches mail that already arrived. Safe
 * because saving is idempotent and never revives a finished or dismissed task.
 */
export const RULES_VERSION = 5;

/** Longest stretch of body text the rules look at. Footers and old quotes live past this. */
const MAX_BODY_CHARS = 4_000;
const MAX_TITLE_CHARS = 90;

const PROMOTIONAL =
  /\b(?:\d{1,2}%\s+off|sale|deals?|discount|coupon|promo(?:tion)?|webinar|newsletter|digest|limited\s+time|shop\s+now|free\s+shipping)\b/i;

const BULK_SENDER =
  /^(?:no-?reply|do-?not-?reply|notifications?|notify|alerts?|news(?:letter)?|info|updates?|marketing|mailer(?:-daemon)?|bounce|support|hello|team|accounts?|billing|service|customerservice)\b/i;

const RULES: readonly Rule[] = [
  {
    kind: 'pay',
    match:
      /\b(?:(?:amount|payment|balance|minimum\s+payment|total|premium)\s+(?:is\s+)?due|bill\s+(?:is\s+)?(?:ready|due|available|generated)|(?:new|your)\s+(?:e-?)?(?:bill|statement|invoice)\b|invoice\s+(?:#|no\.?|number)?\s*\w*\s*(?:is\s+)?(?:due|attached|ready)|pay(?:ment)?\s+(?:reminder|request(?:ed)?)|past\s+due|overdue|please\s+(?:make|remit)\s+(?:a\s+|the\s+)?payment|pay\s+(?:now|by|before)\b|(?:please|pls|plz|kindly|reminder\s+to|need\s+to|remember\s+to)\s+pay\b|\bpay\s+(?:the\s+|your\s+|this\s+|an?\s+|pending\s+|outstanding\s+|due\s+)*(?:[\w&.'’-]+\s+){0,2}?(?:invoice|bill|rent|dues|fees?|balance|amount|premium|tax(?:es)?|emi|maintenance|deposit|salary|wages|fine))/i,
    exclude:
      /\b(?:payment\s+(?:was\s+|has\s+been\s+)?(?:received|processed|successful|confirmed|complete[d]?|posted)|thank(?:s|\s+you)\s+for\s+(?:your\s+)?payment|(?:payment\s+)?receipt\b|refund(?:ed)?|you(?:'ve|\s+have)\s+paid|autopay\s+(?:is\s+)?(?:on|set\s+up|scheduled|enabled)|will\s+be\s+(?:automatically\s+)?(?:debited|charged)|payment\s+sent|you\s+sent)\b/i,
    title: (input, subject) => `Pay ${payeeIn(subject) ?? senderLabel(input)}`,
  },
  {
    kind: 'sign',
    match:
      /\b(?:docusign|(?:adobe|dropbox)\s+sign|hellosign|please\s+(?:review\s+and\s+|e-?)?sign|signature\s+(?:is\s+)?(?:required|requested|needed|pending)|awaiting\s+your\s+signature|ready\s+for\s+(?:your\s+)?signature|sign\s+(?:the|this|your)\s+(?:document|agreement|form|lease|contract|offer))/i,
    exclude: /\b(?:completed|has\s+been\s+signed|all\s+parties\s+have\s+signed|was\s+signed|you(?:'ve|\s+have)?\s+signed|voided|declined)\b/i,
    title: (_input, subject) => `Sign: ${subject.replace(/^(?:please\s+)?(?:docusign|sign)\s*:?\s*/i, '')}`,
  },
  {
    kind: 'cheque',
    match:
      /\b(?:cheques?|demand\s+draft|check\s+(?:payable|made\s+(?:out|payable)|for\s+[$₹]|to\s+be\s+(?:issued|sent|mailed))|(?:write|send|mail|issue|drop\s+off)\s+(?:a|the)\s+check)\b/i,
    exclude: /\b(?:cheque\s+(?:has\s+been\s+)?(?:deposited|cleared|received))\b/i,
    title: (_input, subject) => `Cheque: ${subject}`,
  },
  {
    kind: 'reply',
    personalOnly: true,
    match:
      /\b(?:please\s+(?:reply|respond|confirm|let\s+me\s+know|advise|revert)|can\s+you\s+(?:please\s+)?(?:confirm|let\s+me\s+know|send|share|review|check)|could\s+you\s+(?:please\s+)?\w+|let\s+me\s+know\s+(?:if|when|whether|by|what)|kindly\s+(?:confirm|revert|reply|respond|share)|awaiting\s+your\s+(?:reply|response|confirmation)|rsvp|get\s+back\s+to\s+me|what\s+do\s+you\s+think|your\s+thoughts)\b/i,
    exclude: PROMOTIONAL,
    title: (input, subject) => `Reply to ${senderLabel(input)} — ${subject}`,
  },
  {
    kind: 'deadline',
    requiresDate: true,
    match:
      /\b(?:expir(?:es|ing|y|ation)|renew(?:al)?|deadline|last\s+(?:date|day)\s+to|due\s+(?:by|on|date)|submit\s+(?:by|before)|appointment|reminder|registration\s+closes|scheduled\s+for)\b/i,
    exclude: PROMOTIONAL,
    title: (_input, subject) => subject,
  },
];

/** Strip reply chains and signatures so a quoted old request doesn't fire again. */
function primaryText(body: string | null): string {
  if (!body) return '';
  const [fresh = ''] = body.split(/\n(?:On\s.{0,200}?wrote:|-{2,}\s*(?:Original|Forwarded)\s+Message|From:\s.+\nSent:\s)/i);
  return fresh
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
    .slice(0, MAX_BODY_CHARS);
}

export function cleanSubject(subject: string): string {
  const stripped = subject
    .replace(/^(?:\s*(?:re|fwd?|aw|wg)\s*(?:\[\d+\])?\s*:\s*)+/i, '')
    .replace(/\[(?:external|ext)\]\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || '(no subject)';
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** "pay invoice to testfirm" → "testfirm". The payee beats the sender when it is named. */
export function payeeIn(subject: string): string | null {
  const match = /\bpay\b.{0,40}?\bto\s+([^\s.,;:!?][^.,;:!?\n]{0,40})/i.exec(subject);
  const payee = match?.[1]?.replace(/\s+(?:by|before|on|today|tomorrow)\b.*$/i, '').trim();
  return payee || null;
}

function senderLabel(input: ExtractInput): string {
  const name = input.fromName.replace(/["']/g, '').trim();
  if (name) return name;
  const domain = input.fromAddress.split('@')[1] ?? input.fromAddress;
  return domain.replace(/^(?:mail|email|e|info|billing|notify)\./i, '');
}

const PAY_OBJECT =
  /\bpay\s+(?:the\s+|my\s+|your\s+|our\s+|this\s+)?((?:[\w&.'’-]+\s+){0,3}?(?:invoice|bill|rent|dues|fees?|balance|premium|tax(?:es)?|emi|maintenance|deposit|salary|wages|fine))\b/i;

/** "pay credit card bill tomorrow…" → "credit card bill": what is being paid, when no payee is named. */
export function payObjectIn(text: string): string | null {
  return PAY_OBJECT.exec(text)?.[1]?.trim() ?? null;
}

/**
 * Which specific action (pay / sign / cheque) a piece of text asks for, and
 * whether that rule's own exclusion vetoed it. Shared with the chat rules so
 * "pay the electricity bill" means the same thing in an email and a message.
 */
export function matchActionKind(text: string): { readonly kind: TaskKind; readonly isVetoed: boolean } | null {
  for (const rule of RULES) {
    if (rule.kind !== 'pay' && rule.kind !== 'sign' && rule.kind !== 'cheque') continue;
    if (!rule.match.test(text)) continue;
    return { kind: rule.kind, isVetoed: rule.exclude?.test(text) ?? false };
  }
  return null;
}

/** True when text reads like a dated obligation (renewal, appointment…) rather than an advert. */
export function looksLikeDeadline(text: string): boolean {
  const rule = RULES.find((candidate) => candidate.kind === 'deadline')!;
  return rule.match.test(text) && !rule.exclude?.test(text);
}

export function isBulkSender(address: string): boolean {
  const local = address.split('@')[0] ?? '';
  return BULK_SENDER.test(local);
}

/**
 * Propose tasks for one email.
 *
 * `deadline` is a catch-all and is skipped whenever a more specific rule
 * recognised the email — "Your bill is due Oct 15" is a payment, not two tasks.
 */
export function extractTasks(input: ExtractInput): readonly TaskCandidate[] {
  const subject = cleanSubject(input.subject);
  const text = `${subject}\n${primaryText(input.bodyText)}`;
  const isBulk = isBulkSender(input.fromAddress);

  const candidates: TaskCandidate[] = [];
  // A specific rule that recognised the email but was vetoed ("autopay is
  // scheduled") speaks for the whole email — the catch-all must not overrule it.
  let isClaimed = false;
  for (const rule of RULES) {
    if (rule.kind === 'deadline' && isClaimed) continue;
    if (rule.personalOnly && isBulk) continue;
    if (!rule.match.test(text)) continue;
    isClaimed = true;
    if (rule.exclude?.test(text)) continue;

    const dueDate = findDueDate(text, input.receivedAt);
    if (rule.requiresDate && !dueDate) continue;

    candidates.push({
      kind: rule.kind,
      title: truncate(rule.title(input, subject), MAX_TITLE_CHARS),
      dueDate,
      amount: rule.kind === 'pay' || rule.kind === 'cheque' ? findAmount(text) : null,
    });
  }
  return candidates;
}
