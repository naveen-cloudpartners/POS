import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { logout } from '../../services/catalystAuth';
import { profilePhotoUrl } from '../../services/profileService';

export default function SidebarActions({ settingsControl }: { settingsControl?: ReactNode }) {
  const { user, role } = useAuth();
  const location = useLocation();
  const [notifOpen, setNotifOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [logoSrc, setLogoSrc] = useState('');
  const notifRef = useRef<HTMLDivElement | null>(null);
  const userRef = useRef<HTMLDivElement | null>(null);

  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase() || 'U';

  useEffect(() => {
    setLogoSrc(user?.avatarVersion ? profilePhotoUrl(user.avatarVersion) : '');
  }, [location.pathname, location.hash, role, user?.avatarVersion]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (notifRef.current !== null && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (userRef.current !== null && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setUserOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useEffect(() => {
    setNotifOpen(false);
    setUserOpen(false);
  }, [location.pathname, location.hash]);

  return (
    <div className="ch-sidebar-actions">
        <div className="ch-notif-wrap" ref={notifRef}>
          <button
            type="button"
            className="ch-icon-btn"
            aria-label="Notifications"
            aria-expanded={notifOpen}
            onClick={() => { setNotifOpen((v) => !v);  setUserOpen(false); }}
          >
            <Bell size={17} />
          </button>
          {notifOpen && (
            <div className="ch-notif-pop" role="menu" aria-label="Notifications">
              <div className="ch-notif-head">Notifications</div>
              <div className="ch-notif-item"><span><b>No notifications</b><span>You have no new notifications to review.</span></span></div>
            </div>
          )}
        </div>

        {settingsControl}
        <div className="ch-notif-wrap" ref={userRef}>
          <button type="button" className="ch-profile" onClick={() => { setUserOpen((v) => !v); setNotifOpen(false);  }} aria-label="User menu" aria-expanded={userOpen} title="Account">
            <span className="ch-avatar" aria-hidden="true">
              <span className={logoSrc ? 'ch-profile-initial has-logo' : 'ch-profile-initial'}>{initial}</span>
              {logoSrc && <img className="ch-profile-logo" src={logoSrc} alt="" onError={() => setLogoSrc('')} />}
            </span>
          </button>
          {userOpen && (
            <div className="ch-qa-pop" role="menu" aria-label="User menu">
              {role !== 'Admin' && <Link className="ch-qa-item" to="/settings/profile" onClick={() => setUserOpen(false)}>My profile</Link>}
              <div className="ch-notif-head">{user?.name ?? user?.email ?? 'Store owner'} · {role}</div>
              {role === 'Admin' && <Link className="ch-qa-item" to="/settings" onClick={() => setUserOpen(false)}>Store settings</Link>}
              {['Admin', 'Manager'].includes(role) && <Link className="ch-qa-item" to="/admin/users" onClick={() => setUserOpen(false)}>Team members</Link>}
              <button type="button" className="ch-qa-item" onClick={() => { void logout(); }}>Sign out</button>
            </div>
          )}
        </div>
    </div>
  );
}

