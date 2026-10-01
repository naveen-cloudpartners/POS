// CloudHub POS — Catalyst Authentication ONLY (frontend).
// Package: @zcatalyst/auth v0.0.4 (Apache-2.0), browser entry
// `@zcatalyst/auth/web`. Passwords are typed ONLY on Catalyst's hosted
// login page — our code never sees, sends, or stores them. There is no
// OTP, no local user record, no localStorage session. The Catalyst
// session (verified server-side via GET /api/auth/me) is the single
// source of truth.
import API_BASE from './api';
import { ConfigStore, getCredentials } from '@zcatalyst/auth-client';

type WebAuthModule = typeof import('@zcatalyst/auth/web');

let webMod: WebAuthModule | null = null;
let initDone = false;

async function web(): Promise<WebAuthModule> {
  if (!webMod) webMod = await import('@zcatalyst/auth/web');
  return webMod;
}

async function ensureInit(): Promise<void> {
  if (initDone) return;
  const m = await web();
  await m.zcAuth.init();
  initDone = true;
}

/**
 * Hosted Catalyst login endpoint, derived from the serving domain at
 * runtime so IaC clones work with zero code edits (each deployment logs
 * into its own project). Falls back to the original Development URL for
 * non-https origins (local dev). Full-page login ONLY.
 */
export const CATALYST_LOGIN_URL: string = (() => {
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    if (origin.startsWith('https://')) return `${origin}/__catalyst/auth/login`;
  } catch { /* fall through to pinned URL */ }
  return 'https://pos-914406080.development.catalystserverless.com/__catalyst/auth/login';
})();

/**
 * Sign in: full-tab navigation through the official hosted chain.
 * On success Catalyst returns the browser straight to /app/dashboard
 * (ProtectedRoute re-verifies the session server-side there).
 * Falls back to the bare pinned endpoint if the SDK cannot initialize.
 * No iframe, no popup.
 */
export async function login(): Promise<void> {
  try {
    await ensureInit();
    const m = await web();
    await m.zcAuth.hostedSignIn('/app/dashboard');
  } catch (e) {
    console.warn('Hosted sign-in unavailable, direct navigation:',
      e instanceof Error ? e.message : e);
    window.location.href = CATALYST_LOGIN_URL;
  }
}

/**
 * Sign out: destroy the Catalyst session, then land on /login.
 *
 * Uses the same credential-initialization pattern as hostedSignIn():
 * verify that ConfigStore has ZAID and INITIALIZED, and call
 * getCredentials() if either is missing. Only then call zcAuth.signOut().
 * This ensures the SDK's internal this.zaid is populated before
 * signOut() constructs the /accounts/p/{zaid}/logout URL.
 */
export async function logout(): Promise<void> {
  // --- Ensure credentials are loaded (same pattern as hostedSignIn) ---
  if (!ConfigStore.get('INITIALIZED') || !ConfigStore.get('ZAID')) {
    await getCredentials();
  }

  // --- Now safe to call signOut: ZAID is available in ConfigStore ---
  try {
    await ensureInit();
    const m = await web();
    await m.zcAuth.signOut('/app/login');
  } catch {
    window.location.href = '/app/login';
  }
}

export interface SessionUser {
  email: string;
  name: string;
  userId: string;
  avatarVersion: string;
}

export interface BackendSession {
  authenticated: boolean;
  email: string;
  user: SessionUser | null;
  role: string;
}

/**
 * Server-side session truth: GET /api/auth/me reads the request's Catalyst
 * user via the backend SDK. 401 / network failure => not authenticated.
 */
export async function fetchBackendSession(): Promise<BackendSession> {
  const empty: BackendSession = { authenticated: false, email: '', user: null, role: '' };
  try {
    const resp = await fetch(`${API_BASE}/auth/me`, { credentials: 'same-origin', cache: 'no-store' });
    if (!resp.ok) return empty;
    const data: {
      authenticated?: boolean;
      role?: string;
      user?: { email?: string; name?: string; user_id?: string; avatar_version?: string };
      email?: string;
    } = await resp.json().catch(() => ({}));
    if (data?.authenticated !== true) return empty;
    const email = String(data.user?.email || data.email || '');
    if (!email) return empty;
    return {
      authenticated: true,
      role: String(data.role || ''),
      email,
      user: {
        email,
        name: String(data.user?.name || email),
        userId: String(data.user?.user_id || ''),
        avatarVersion: String(data.user?.avatar_version || ''),
      },
    };
  } catch {
    return empty;
  }
}


