/**
 * Full-text search over the local archive.
 *
 * FTS5's MATCH grammar treats a pile of characters as operators ("AND", "OR",
 * "NOT", "NEAR", quotes, parens, colons, carets, asterisks, hyphens). Passing
 * raw user input into MATCH therefore either throws a syntax error or silently
 * means something other than what the user typed. buildMatchExpression()
 * reduces input to quoted literal terms so neither can happen.
 */

import type { Database } from 'better-sqlite3';
import type { FolderRole, MessageSummary } from '../types/mail.js';
import { rowToSummary, type MessageRow } from './messages.js';

/** Characters that carry meaning in the FTS5 query grammar. */
const FTS_OPERATOR_CHARS = /["()*:^\-+{}[\]~]/g;

/**
 * Turn free text into a safe FTS5 MATCH expression.
 *
 * Each word becomes a quoted literal, so operator keywords like AND/OR/NEAR
 * are matched as words rather than interpreted. Terms are combined with AND.
 * The final term gets a prefix wildcard so type-ahead search feels live.
 *
 * Returns null when the input contains nothing searchable, which callers should
 * treat as "no results" rather than "match everything".
 */
export function buildMatchExpression(raw: string, options: { prefixLastTerm?: boolean } = {}): string | null {
  const { prefixLastTerm = true } = options;

  const terms = raw
    .split(/\s+/)
    .map((token) => token.replace(FTS_OPERATOR_CHARS, '').trim())
    .filter((token) => token.length > 0);

  if (terms.length === 0) return null;

  return terms
    .map((term, index) => {
      const quoted = `"${term.replace(/"/g, '""')}"`;
      const isLast = index === terms.length - 1;
      return isLast && prefixLastTerm ? `${quoted}*` : quoted;
    })
    .join(' AND ');
}

export interface SearchHit extends MessageSummary {
  /** FTS5 relevance score; lower (more negative) is a better match. */
  readonly rank: number;
}

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  readonly total: number;
}

/**
 * Search headers and bodies, newest-relevant first.
 *
 * Scoped to one account's folders. Bodies only contribute once they have been
 * fetched, so a message whose body has never been opened matches on subject
 * and sender alone.
 */
export function searchMessages(
  db: Database,
  accountId: number,
  rawQuery: string,
  options: { limit: number; offset: number; role?: FolderRole },
): SearchResult {
  const match = buildMatchExpression(rawQuery);
  if (!match) return { hits: [], total: 0 };

  const roleFilter = options.role ? 'AND folders.role = ?' : '';
  const params: unknown[] = options.role ? [match, accountId, options.role] : [match, accountId];

  let rows: (MessageRow & { role: FolderRole; rank: number })[];
  try {
    rows = db
      .prepare(
        `SELECT messages.*, folders.role AS role, messages_fts.rank AS rank
         FROM messages_fts
         JOIN messages ON messages.id = messages_fts.rowid
         JOIN folders  ON folders.id = messages.folder_id
         WHERE messages_fts MATCH ?
           AND folders.account_id = ?
           ${roleFilter}
         ORDER BY messages_fts.rank, messages.internal_date DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, options.limit, options.offset) as (MessageRow & {
      role: FolderRole;
      rank: number;
    })[];
  } catch (error) {
    // A malformed expression should surface as no results, not a 500. The
    // sanitiser above makes this unreachable in practice; this is a backstop.
    return { hits: [], total: 0 };
  }

  const { n } = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM messages_fts
       JOIN messages ON messages.id = messages_fts.rowid
       JOIN folders  ON folders.id = messages.folder_id
       WHERE messages_fts MATCH ? AND folders.account_id = ? ${roleFilter}`,
    )
    .get(...params) as { n: number };

  return {
    hits: rows.map((row) => ({ ...rowToSummary(row, row.role), rank: row.rank })),
    total: n,
  };
}
