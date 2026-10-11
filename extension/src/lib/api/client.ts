/**
 * Typed client for the DayDesk helper.
 *
 * Every call carries the pairing token. A 401 means the stored token no longer
 * matches ~/.daydesk/token; a network failure means the helper is not running.
 * The panel distinguishes those two because the remedies are different.
 */

import type {
  MessageDetail,
  MessagePage,
  ProviderInfo,
  SearchResponse,
  SyncStatus,
  FolderRole,
} from './types.js';

export const HELPER_ORIGIN = 'http://127.0.0.1:4287';

export class HelperDownError extends Error {
  constructor() {
    super('The DayDesk helper is not running.');
    this.name = 'HelperDownError';
  }
}

export class UnauthorizedError extends Error {
  constructor() {
    super('The pairing token was rejected.');
    this.name = 'UnauthorizedError';
  }
}

export class NotPairedError extends Error {
  constructor() {
    super('No Yahoo account is paired yet.');
    this.name = 'NotPairedError';
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${HELPER_ORIGIN}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
  } catch {
    // fetch only rejects on network-level failure, which here means nothing is
    // listening on the loopback port.
    throw new HelperDownError();
  }

  if (response.status === 401) throw new UnauthorizedError();
  if (response.status === 409) throw new NotPairedError();

  if (!response.ok) {
    const detail = await response
      .json()
      .then((body: { message?: string }) => body.message)
      .catch(() => undefined);
    throw new ApiError(detail ?? `Request failed with ${response.status}.`, response.status);
  }

  return (await response.json()) as T;
}

/** Liveness probe. Needs no token, so it separates "down" from "bad token". */
export async function checkHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${HELPER_ORIGIN}/api/system/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export function createApi(token: string) {
  return {
    status: () => request<SyncStatus>('/api/system/status', token),

    providers: () => request<ProviderInfo[]>('/api/system/providers', token),

    pair: (email: string, appPassword: string, providerId = 'yahoo') =>
      request<{ paired: boolean; email: string }>('/api/system/pair', token, {
        method: 'POST',
        body: JSON.stringify({ email, appPassword, providerId }),
      }),

    unpair: () => request<{ unpaired: boolean }>('/api/system/pair', token, { method: 'DELETE' }),

    messages: (options: { role: FolderRole; limit?: number; offset?: number; unreadOnly?: boolean }) => {
      const params = new URLSearchParams({ role: options.role });
      if (options.limit !== undefined) params.set('limit', String(options.limit));
      if (options.offset !== undefined) params.set('offset', String(options.offset));
      if (options.unreadOnly) params.set('unreadOnly', 'true');
      return request<MessagePage>(`/api/mail/messages?${params}`, token);
    },

    message: (id: number) => request<MessageDetail>(`/api/mail/messages/${id}`, token),

    search: (query: string, options: { role?: FolderRole; limit?: number } = {}) => {
      const params = new URLSearchParams({ q: query });
      if (options.role) params.set('role', options.role);
      if (options.limit !== undefined) params.set('limit', String(options.limit));
      return request<SearchResponse>(`/api/mail/search?${params}`, token);
    },

    sync: (role?: FolderRole) =>
      request<{ ok: boolean; status: SyncStatus }>('/api/mail/sync', token, {
        method: 'POST',
        body: JSON.stringify(role ? { role } : {}),
      }),
  };
}

export type DayDeskApi = ReturnType<typeof createApi>;
