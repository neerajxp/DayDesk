/**
 * Cross-source correlation: deciding that an email and a WhatsApp message are
 * about the same piece of work.
 *
 * Pure and deliberately explainable — no embeddings, just distinctive shared
 * words ("pg&e", "sharma", "lease") and matching amounts. Generic words that
 * every bill shares ("pay", "bill", "amount", "due") are stopwords, so two
 * different bills never merge just for being bills.
 */

import type { TaskKind } from '../types/tasks.js';

/** An open task, as the matcher sees it. */
export interface TaskProfile {
  readonly id: number;
  readonly kind: TaskKind;
  readonly title: string;
  readonly amount: string | null;
  /** The text that produced the task: email subject + snippet, or chat text. */
  readonly text: string;
}

/** A new email or chat message, with the task kind the rules gave it (if any). */
export interface Evidence {
  readonly kind: TaskKind | null;
  readonly title: string;
  readonly amount: string | null;
  readonly text: string;
}

/**
 * - followup: the evidence is itself a task of the same kind — merge, don't duplicate.
 * - mention: the evidence is not a task but talks about one — attach for context.
 * - done: the evidence reports work finished. Only ever shown as a hint the
 *   user confirms, so one distinctive shared word ("pg&e") is enough.
 */
export type Relation = 'followup' | 'mention' | 'done';

const STOPWORDS = new Set(
  `pay paid payment payments bill bills invoice invoices amount due balance total please pls plz kindly
   the and for you your yours this that these those with from have has had will would can could should
   are was were been being not but all any our ours their there here what when where which who how why
   today tomorrow tonight yesterday week month year morning evening night
   jan feb mar apr may jun jul aug sep sept oct nov dec january february march april june july august
   september october november december mon tue wed thu fri sat sun monday tuesday wednesday thursday
   friday saturday sunday reminder remind send sent sign signed signature cheque check need needs
   ready new dear regards thanks thank hello hey good make sure don't dont forget remember about
   also just did does done get got let know see one two via per its it's i'm we're they're him her
   mom dad bhai didi ji sir madam team account statement`.split(/\s+/),
);

const MIN_TOKEN_LENGTH = 3;

/** Points for a matching amount; one per shared distinctive word; one for same kind. */
const AMOUNT_WEIGHT = 2;
const THRESHOLDS: Record<Relation, { readonly score: number; readonly sharedWords: number }> = {
  followup: { score: 2, sharedWords: 1 },
  mention: { score: 2, sharedWords: 2 },
  done: { score: 1, sharedWords: 1 },
};

export function tokenize(text: string): ReadonlySet<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}&]+/gu) ?? [];
  return new Set(
    words.filter((word) => word.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(word) && !/^\d+$/.test(word)),
  );
}

/** "$84.20", "USD 84.20", "84.20" all compare equal; "₹2,400.00" equals "₹2,400". */
export function normalizeAmount(amount: string | null): string | null {
  if (!amount) return null;
  const digits = amount.replace(/[^\d.]/g, '').replace(/^\.+|\.+$/g, '');
  if (!digits) return null;
  const value = Number.parseFloat(digits);
  return Number.isFinite(value) ? String(value) : null;
}

/**
 * The open task this evidence is most likely about, or null.
 *
 * A distinctive shared word is always required — two bills for the same
 * amount from different companies are different work.
 */
export function findRelated(
  evidence: Evidence,
  profiles: readonly TaskProfile[],
  relation: Relation,
): { readonly taskId: number; readonly score: number } | null {
  const evidenceWords = tokenize(`${evidence.title} ${evidence.text}`);
  const evidenceAmount = normalizeAmount(evidence.amount);
  const threshold = THRESHOLDS[relation];

  let best: { taskId: number; score: number } | null = null;
  for (const profile of profiles) {
    if (relation === 'followup' && profile.kind !== evidence.kind) continue;

    const profileWords = tokenize(`${profile.title} ${profile.text}`);
    let shared = 0;
    for (const word of evidenceWords) if (profileWords.has(word)) shared += 1;
    if (shared < threshold.sharedWords) continue;

    const amountMatches = evidenceAmount !== null && evidenceAmount === normalizeAmount(profile.amount);
    const score = shared + (amountMatches ? AMOUNT_WEIGHT : 0) + (profile.kind === evidence.kind ? 1 : 0);
    if (score >= threshold.score && (!best || score > best.score)) best = { taskId: profile.id, score };
  }
  return best;
}

const DONE =
  /\b(?:paid|payment\s+(?:received|done|made|successful|complete[d]?)|transferred|deposited|signed|cleared|completed|sorted|taken\s+care\s+of|done)\b|✅|✔️?/i;
const NOT_DONE = /\?|\b(?:not|n't|yet\s+to|pending|have\s+you|did\s+you|please|pls|kindly)\b/i;

/** A message that reports the work as finished — used only as a hint, never to auto-complete. */
export function looksDone(text: string): boolean {
  return DONE.test(text) && !NOT_DONE.test(text);
}
