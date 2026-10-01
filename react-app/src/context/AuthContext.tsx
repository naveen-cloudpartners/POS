import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchBackendSession, type SessionUser } from '../services/catalystAuth';
import { normalizeRole, type AppRole } from '../services/authService';

interface AuthState {
  user: SessionUser | null;
  email: string;
  role: AppRole;
  loading: boolean;
  refresh: () => void;
}

const AuthContext = createContext<AuthState>({ user: null, email: '', role: '', loading: true, refresh: () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<AppRole>('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    let busy = false;
    const update = async () => {
      if (busy) return;
      busy = true;
      try {
        const session = await fetchBackendSession();
        if (!live) return;
        setUser(session.user);
        setEmail(session.email);
        setRole(session.authenticated ? normalizeRole(session.role) : '');
      } finally {
        busy = false;
        if (live) setLoading(false);
      }
    };
    void update();
    const timer = window.setInterval(() => { if (!document.hidden) void update(); }, 10000);
    const onFocus = () => { void update(); };
    const onVisibility = () => { if (!document.hidden) void update(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pos-access-refresh', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pos-access-refresh', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [tick]);

  const value = useMemo<AuthState>(
    () => ({ user, email, role, loading, refresh: () => setTick((t) => t + 1) }),
    [user, email, role, loading],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
