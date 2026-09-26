import { MOBILE_OVERRIDE_KEY } from '../../config/app';

/* Reusable mobile-device detection (UA first, screen fallback).
   Desktop browsers — even narrow windows — are never gated. */

const MOBILE_UA =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i;

export function deviceIsMobile(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';

  // 1. Explicit mobile / tablet user agents.
  if (MOBILE_UA.test(ua)) return true;

  const touch = navigator.maxTouchPoints > 1;
  const smallScreen =
    Math.min(window.screen.width, window.screen.height) <= 1024;

  // 2. iPadOS 13+ reports a desktop "Macintosh" UA — touch + small screen
  //    is the only reliable signal there.
  if (touch && smallScreen && /Macintosh/.test(ua)) return true;

  // 3. Genuine desktop OS — never gate (window size alone is not enough).
  if (/Windows NT|Mac OS X|Linux|X11|CrOS/i.test(ua)) return false;

  // 4. Unknown UA on a small touch screen — treat as mobile.
  return touch && smallScreen;
}

export function hasDesktopOverride(): boolean {
  try {
    return window.localStorage.getItem(MOBILE_OVERRIDE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setDesktopOverride(): void {
  try {
    window.localStorage.setItem(MOBILE_OVERRIDE_KEY, 'true');
  } catch {
    /* private mode — gate simply reappears next visit */
  }
}
