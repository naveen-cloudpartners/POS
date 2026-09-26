/* CloudHub POS — API base + authenticated fetch helper.
   Keeps the default export (API_BASE string) for existing imports. */

const API_BASE =
  import.meta.env.PROD
    ? '/server/pos_backend/api'
    : 'http://localhost:3000/server/pos_backend/api';

export default API_BASE;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
}

export async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text === '' ? null : JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    const msg =
      data !== null && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : data !== null && typeof data === 'object' && 'message' in data && typeof (data as { message: unknown }).message === 'string'
          ? (data as { message: string }).message
          : `Request failed (${resp.status})`;
    throw new ApiError(resp.status, msg);
  }
  return data as T;
}
