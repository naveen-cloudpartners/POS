import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fetchBackendSession, type SessionUser } from '../services/catalystAuth';
import { getCurrentRole, type AppRole } from '../services/authService';

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
    (async () => {
      setLoading(true);
      try {
        const session = await fetchBackendSession();
        if (!live) return;
        setUser(session.user);
        setEmail(session.email);
        if (session.authenticated) {
          const r = await getCurrentRole();
          if (live) setRole(r === '' ? 'Admin' : r);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
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
