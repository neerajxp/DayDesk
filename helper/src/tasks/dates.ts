/**
 * Due-date and amount extraction from free mail text.
 *
 * Pure functions. Mail is attacker-controlled input, so every pattern here is
 * bounded (no nested quantifiers) and the caller truncates text before it gets
 * here.
 *
 * Only dates that sit next to a "due"-style keyword count. A bill email is full
 * of dates — statement date, period start, last payment — and picking the
 * wrong one is worse than picking none, because "no date" is an honest state
 * the panel can show.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

const WEEKDAYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

const MONTH_NAME =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?';
const WEEKDAY_NAME =
  '(sun(?:day)?|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?)';
const ORDINAL = '(?:st|nd|rd|th)?';

/** Each date shape, tried at every position. Group layout is per-pattern. */
const DATE_PATTERNS: readonly { readonly re: RegExp; readonly parse: (m: RegExpExecArray, ref: Date) => Date | null }[] = [
  {
    // 2026-10-15
    re: /\b(\d{4})-(\d{2})-(\d{2})\b/gi,
    parse: (m) => makeDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  },
  {
    // October 15, 2026 · Oct 15th · Oct. 15 · Oct-12-2026
    re: new RegExp(`\\b${MONTH_NAME}[\\s-]+(\\d{1,2})${ORDINAL}(?:,?[\\s-]+(\\d{4}))?\\b`, 'gi'),
    parse: (m, ref) => withYear(monthIndex(m[1]!), Number(m[2]), m[3], ref),
  },
  {
    // 15 October 2026 · 15th Oct · 12-oct
    re: new RegExp(`\\b(\\d{1,2})${ORDINAL}[\\s-]+(?:of\\s+)?${MONTH_NAME}(?:,?[\\s-]+(\\d{4}))?\\b`, 'gi'),
    parse: (m, ref) => withYear(monthIndex(m[2]!), Number(m[1]), m[3], ref),
  },
  {
    // 10/15/2026 · 10/15/26 · 10/15 — US order, unless the first part cannot be a month.
    re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b/g,
    parse: (m, ref) => {
      let month = Number(m[1]);
      let day = Number(m[2]);
      if (month > 12 && day <= 12) [month, day] = [day, month];
      const year = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined;
      return withYear(month - 1, day, year, ref);
    },
  },
  {
    re: /\b(today|tonight|tomorrow)\b/gi,
    parse: (m, ref) => addDays(startOfDay(ref), m[1]!.toLowerCase() === 'tomorrow' ? 1 : 0),
  },
  {
    // "by Friday" — the next such weekday on or after the email arrived.
    re: new RegExp(`\\b${WEEKDAY_NAME}\\b`, 'gi'),
    parse: (m, ref) => {
      const target = WEEKDAYS[m[1]!.toLowerCase().slice(0, 3)];
      if (target === undefined) return null;
      const start = startOfDay(ref);
      return addDays(start, (target - start.getDay() + 7) % 7);
    },
  },
];

/**
 * Words that mark the date after them as a deadline. The gap between keyword
 * and date is capped so "due" in one sentence cannot claim a date three lines
 * down.
 *
 * Prepositions get a much tighter window than nouns: "reply by Friday" is a
 * deadline, but "sent by PG&E on Oct 3" is not.
 */
const DUE_KEYWORDS: readonly { readonly re: RegExp; readonly window: number }[] = [
  {
    re: /\b(?:due|deadline|expires?|expiring|expiry|expiration|renew(?:al)?|payable|pay(?:ment)?\s+date|last\s+(?:date|day)|closes?|scheduled\s+for|appointment)\b/gi,
    window: 40,
  },
  { re: /\b(?:by|before|until|on\s+or\s+before|no\s+later\s+than)\b/gi, window: 5 },
];

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Local calendar date as YYYY-MM-DD. */
export function toDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function monthIndex(name: string): number {
  const key = name.toLowerCase().replace('.', '');
  return MONTHS[key.slice(0, 4) === 'sept' ? 'sept' : key.slice(0, 3)] ?? -1;
}

/** Build a date, rejecting rollovers like Feb 31 → Mar 3. */
function makeDate(year: number, month: number, day: number): Date | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const date = new Date(year, month, day);
  return date.getMonth() === month && date.getDate() === day ? date : null;
}

/**
 * Resolve a yearless date against the day the email arrived. "Oct 3" in an
 * email from late December means next October, not one in the past — but a
 * date a couple of weeks back is more likely an overdue notice than next year.
 */
function withYear(month: number, day: number, year: string | undefined, ref: Date): Date | null {
  if (year) return makeDate(Number(year), month, day);
  const sameYear = makeDate(ref.getFullYear(), month, day);
  if (!sameYear) return null;
  const lookback = addDays(startOfDay(ref), -30);
  return sameYear < lookback ? makeDate(ref.getFullYear() + 1, month, day) : sameYear;
}

interface DateHit {
  readonly index: number;
  readonly date: Date;
}

function findAllDates(text: string, ref: Date): DateHit[] {
  const hits: DateHit[] = [];
  for (const pattern of DATE_PATTERNS) {
    pattern.re.lastIndex = 0;
    for (let m = pattern.re.exec(text); m; m = pattern.re.exec(text)) {
      const date = pattern.parse(m, ref);
      if (date) hits.push({ index: m.index, date });
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * The first explicit calendar date anywhere in `text` ("12-oct", "1st Nov").
 * Only for short, single-purpose text like a chat message, where a date is
 * almost always the deadline; emails use findDueDate, which demands a
 * "due"-style keyword.
 *
 * Relative words and bare weekdays are skipped: "tomorrow 12-oct" means the
 * 12th even if it was typed late on the 10th, and "see you Monday" is not a
 * deadline.
 */
export function findFirstDate(text: string, receivedAt: Date): string | null {
  const [first] = findAllDates(text, receivedAt).filter((hit) => !isRelativeWord(text, hit.index));
  return first ? toDateKey(first.date) : null;
}

function isRelativeWord(text: string, index: number): boolean {
  return new RegExp(`^(?:today|tonight|tomorrow|${WEEKDAY_NAME})\\b`, 'i').test(text.slice(index));
}

/**
 * The first date in `text` preceded closely by a due-style keyword.
 *
 * @param receivedAt when the email arrived — anchors relative words like
 *   "tomorrow" and yearless dates.
 */
export function findDueDate(text: string, receivedAt: Date): string | null {
  const dates = findAllDates(text, receivedAt);
  if (dates.length === 0) return null;

  const keywords: { end: number; window: number }[] = [];
  for (const { re, window } of DUE_KEYWORDS) {
    re.lastIndex = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) keywords.push({ end: m.index + m[0].length, window });
  }

  for (const hit of dates) {
    const isNearKeyword = keywords.some(({ end, window }) => end <= hit.index && hit.index - end <= window);
    if (isNearKeyword) return toDateKey(hit.date);
  }
  return null;
}

/** Prefix form: "$84.20", "₹2,400", "USD 84.20", "Rs. 1,200". */
const AMOUNT_PREFIXED = /(?:[$€£₹]|\b(?:USD|INR|Rs\.?|EUR|GBP)\s?)\s?\d{1,3}(?:,\d{2,3})*(?:\.\d{2})?\b/gi;
/** Suffix form, common in chat: "350$", "1,200 rs", "40 dollars", "84.20 USD". */
const AMOUNT_SUFFIXED =
  /\b(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})?)\s?(\$|€|£|₹|usd|inr|eur|gbp|rs\.?|rupees?|dollars?|bucks|euros?|pounds?)(?=[\s.,;:!?)]|$)/gi;
const SUFFIX_SYMBOLS: Record<string, string> = {
  $: '$', usd: '$', dollar: '$', dollars: '$', bucks: '$',
  '€': '€', eur: '€', euro: '€', euros: '€',
  '£': '£', gbp: '£', pound: '£', pounds: '£',
  '₹': '₹', inr: '₹', rs: '₹', 'rs.': '₹', rupee: '₹', rupees: '₹',
};
const AMOUNT_KEYWORD = /\b(?:due|amount|balance|total|pay(?:ment)?|minimum|premium|owed?|charge|for|of)\b/gi;
const AMOUNT_WINDOW = 60;

function findAllAmounts(text: string): { index: number; value: string }[] {
  const found: { index: number; value: string }[] = [];
  AMOUNT_PREFIXED.lastIndex = 0;
  for (let m = AMOUNT_PREFIXED.exec(text); m; m = AMOUNT_PREFIXED.exec(text)) {
    found.push({ index: m.index, value: m[0].replace(/\s+/g, ' ').trim() });
  }
  AMOUNT_SUFFIXED.lastIndex = 0;
  for (let m = AMOUNT_SUFFIXED.exec(text); m; m = AMOUNT_SUFFIXED.exec(text)) {
    // Shown in prefix form so "350$" and "$350" read — and correlate — the same.
    const symbol = SUFFIX_SYMBOLS[m[2]!.toLowerCase()] ?? '';
    if (!found.some((hit) => hit.index <= m!.index && m!.index < hit.index + hit.value.length)) {
      found.push({ index: m.index, value: `${symbol}${m[1]}` });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

/**
 * The amount that most likely needs paying: the first one shortly after a
 * money keyword, else the first amount at all.
 */
export function findAmount(text: string): string | null {
  const amounts = findAllAmounts(text);
  if (amounts.length === 0) return null;

  AMOUNT_KEYWORD.lastIndex = 0;
  for (let k = AMOUNT_KEYWORD.exec(text); k; k = AMOUNT_KEYWORD.exec(text)) {
    const end = k.index + k[0].length;
    const near = amounts.find((amount) => amount.index >= end && amount.index - end <= AMOUNT_WINDOW);
    if (near) return near.value;
  }
  return amounts[0]!.value;
}
