/* CloudHub POS — API base + authenticated fetch helper.
   Keeps the default export (API_BASE string) for existing imports. */

import { actionSound, playSound } from './soundService';

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
  const method = options.method ?? 'GET';
  let resp: Response;
  try { resp = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  }); } catch (error) {
    if (actionSound(path, method, null)) playSound('error');
    throw error;
  }
  const text = await resp.text();
  let data: unknown = null;
  try {
    data = text === '' ? null : JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!resp.ok) {
    if (actionSound(path, method, null)) playSound('error');
    if (resp.status === 401 || resp.status === 403) window.dispatchEvent(new Event('pos-access-refresh'));
    const msg =
      data !== null && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : data !== null && typeof data === 'object' && 'message' in data && typeof (data as { message: unknown }).message === 'string'
          ? (data as { message: string }).message
          : `Request failed (${resp.status})`;
    throw new ApiError(resp.status, msg);
  }
  const sound = actionSound(path, method, data);
  if (sound) playSound(sound);
  if (method !== 'GET' && !path.startsWith('/notifications')) {
    const ticket = data && typeof data === 'object' && 'ticket' in data ? (data as { ticket: { number: string; status: string; updatedAt: string } }).ticket : null;
    if (ticket) window.dispatchEvent(new CustomEvent('pos-alert-delivered', { detail: `kot:${ticket.number}:${ticket.status}:${ticket.updatedAt}` }));
    window.dispatchEvent(new Event('pos-notifications-refresh'));
  }
  return data as T;
}
