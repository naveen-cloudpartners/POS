import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBackendSession } from '../services/catalystAuth';

/**
 * Root entry gate for /app/
 * Checks Catalyst session BEFORE rendering Landing.
 * Authenticated -> /dashboard, Otherwise -> /landing
 * Prevents flash of landing page for signed-in users.
 */
export default function RootEntry() {
  const navigate = useNavigate();

  useEffect(() => {
    let live = true;
    (async () => {
      const session = await fetchBackendSession();
      if (!live) return;
      if (session.authenticated) {
        navigate('/dashboard', { replace: true });
      } else {
        navigate('/landing', { replace: true });
      }
    })();
    return () => { live = false; };
  }, [navigate]);

  return (
    <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'Inter, system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: '36px',
            height: '36px',
            border: '3px solid #e2e8f0',
            borderTopColor: '#0061ff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }}
        />
        <p style={{ fontSize: '14px', color: '#64748b', margin: 0 }}>Loading...</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
  );
}
