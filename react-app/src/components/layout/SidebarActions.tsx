import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell';
import { useAuth } from '../../context/AuthContext';
import { logout } from '../../services/catalystAuth';
import { profilePhotoUrl } from '../../services/profileService';
import { companyLogoUrl, getCompanyProfile } from '../../services/settingsService';

export default function SidebarActions({ settingsControl }: { settingsControl?: ReactNode }) {
  const { user, role } = useAuth();
  const location = useLocation();
  const [userOpen, setUserOpen] = useState(false);
  const [logoSrc, setLogoSrc] = useState('');
  const userRef = useRef<HTMLDivElement | null>(null);

  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase() || 'U';

  useEffect(() => {
    let live = true;
    setLogoSrc('');
    if (role === 'Admin') {
      void getCompanyProfile().then(company => {
        if (live && company.logo_file_id) setLogoSrc(`${companyLogoUrl()}?v=${encodeURIComponent(company.logo_file_id)}`);
      }).catch(() => undefined);
    } else {
      setLogoSrc(user?.avatarVersion ? profilePhotoUrl(user.avatarVersion) : '');
    }
    return () => { live = false; };
  }, [location.pathname, location.hash, role, user?.avatarVersion]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (userRef.current !== null && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
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
    setUserOpen(false);
  }, [location.pathname, location.hash]);

  return (
    <div className="ch-sidebar-actions">
        <NotificationBell />

        {settingsControl}
        <div className="ch-notif-wrap" ref={userRef}>
          <button type="button" className="ch-profile" onClick={() => { setUserOpen((v) => !v); }} aria-label="User menu" aria-expanded={userOpen} title="Account">
            <span className="ch-avatar" aria-hidden="true">
              <span className={logoSrc ? 'ch-profile-initial has-logo' : 'ch-profile-initial'}>{initial}</span>
              {logoSrc && <img className={`ch-profile-logo ${role === 'Admin' ? 'company-avatar' : 'personal-avatar'}`} src={logoSrc} alt="" onError={() => setLogoSrc('')} />}
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

