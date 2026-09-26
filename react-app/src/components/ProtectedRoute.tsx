import { useEffect, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { fetchBackendSession } from '../services/catalystAuth';

/**
 * Catalyst-only guard. Allows access with a live Catalyst session
 * (GET /api/auth/me, verified server-side). No localStorage, no OTP
 * state, no custom session logic.
 */
export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking' | 'ok' | 'denied'>('checking');

  useEffect(() => {
    let live = true;
    (async () => {
      const session = await fetchBackendSession();
      if (live) setState(session.authenticated ? 'ok' : 'denied');
    })();
    return () => { live = false; };
  }, []);

  if (state === 'checking') {
    return <div style={{ padding: '40px' }}>Checking sign-in…</div>;
  }
  return state === 'ok' ? <>{children}</> : <Navigate to="/login" replace />;
}
