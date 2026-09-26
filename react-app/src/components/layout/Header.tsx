import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, Bell, Search, Zap, ShoppingCart, Package, Users, FileBarChart } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { logout } from '../../services/catalystAuth';

interface HeaderProps {
  title: string;
  module: string;
  onMenu: () => void;
}

const MODULE_SUB: Record<string, string> = {
  Dashboard: 'Business overview',
  Inventory: 'Catalog & stock control',
  Sales: 'Checkout & orders',
  Customers: 'Relationships & value',
  Reports: 'Analytics & registers',
  Administration: 'Team & audit',
  Settings: 'Store configuration',
};

export default function Header({ title, module, onMenu }: HeaderProps) {
  const { user, role } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement | null>(null);
  const qaRef = useRef<HTMLDivElement | null>(null);
  const userRef = useRef<HTMLDivElement | null>(null);

  const sub = MODULE_SUB[module] ?? 'CloudHub POS · Enterprise';
  const initial = (user?.name ?? user?.email ?? 'U').trim().charAt(0).toUpperCase() || 'U';

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (notifRef.current !== null && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (qaRef.current !== null && !qaRef.current.contains(e.target as Node)) setQaOpen(false);
      if (userRef.current !== null && !userRef.current.contains(e.target as Node)) setUserOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.getElementById('ch-global-search')?.focus();
      }
      if (e.key === 'Escape') {
        setNotifOpen(false);
        setQaOpen(false);
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
    setQaOpen(false);
    setUserOpen(false);
  }, [location.pathname, location.hash]);

  return (
    <header className="ch-header">
      <button type="button" className="ch-btn ch-btn-ghost ch-btn-icon ch-menu-btn" onClick={onMenu} aria-label="Open navigation">
        <Menu size={20} />
      </button>
      <div style={{ minWidth: 0 }}>
        <span className="ch-header-title">
          {title} <span className="ch-module-chip">{module}</span>
        </span>
        <span className="ch-header-sub">{sub}</span>
      </div>

      <label className="ch-header-search" htmlFor="ch-global-search">
        <Search size={15} aria-hidden="true" />
        <input
          id="ch-global-search"
          placeholder="Search products, orders, customers…"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const q = (e.target as HTMLInputElement).value.trim();
              if (q !== '') navigate(`/inventory/products?search=${encodeURIComponent(q)}`);
            }
          }}
        />
        <kbd>⌘K</kbd>
      </label>

      <div className="ch-header-right">
        <span className="ch-env-pill"><i />LIVE</span>
        {role !== '' && <span className="ch-badge ch-badge-info">{role}</span>}

        <div className="ch-notif-wrap" ref={qaRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="ch-btn ch-btn-primary ch-btn-sm"
            aria-label="Quick add"
            aria-expanded={qaOpen}
            onClick={() => { setQaOpen((v) => !v); setNotifOpen(false); setUserOpen(false); }}
          >
            <Zap size={14} /> Quick add
          </button>
          {qaOpen && (
            <div className="ch-qa-pop" role="menu" aria-label="Quick add">
              <Link className="ch-qa-item" to="/sales/pos" onClick={() => setQaOpen(false)}><ShoppingCart size={15} /> New sale</Link>
              <Link className="ch-qa-item" to="/inventory/products" onClick={() => setQaOpen(false)}><Package size={15} /> Add product</Link>
              <Link className="ch-qa-item" to="/customers" onClick={() => setQaOpen(false)}><Users size={15} /> Add customer</Link>
              <Link className="ch-qa-item" to="/reports" onClick={() => setQaOpen(false)}><FileBarChart size={15} /> View reports</Link>
            </div>
          )}
        </div>

        <div className="ch-notif-wrap" ref={notifRef}>
          <button
            type="button"
            className="ch-icon-btn"
            aria-label="Notifications"
            aria-expanded={notifOpen}
            onClick={() => { setNotifOpen((v) => !v); setQaOpen(false); setUserOpen(false); }}
          >
            <Bell size={17} />
            <span className="ch-dot" aria-hidden="true" />
          </button>
          {notifOpen && (
            <div className="ch-notif-pop" role="menu" aria-label="Notifications">
              <div className="ch-notif-head">Notifications <span className="ch-badge ch-badge-info">3 new</span></div>
              <div className="ch-notif-item"><span className="ch-thumb" style={{ width: 36, height: 36 }}>◈</span><span><b>Sales sync complete</b><span>Orders and inventory are up to date.</span></span></div>
              <div className="ch-notif-item"><span className="ch-thumb" style={{ width: 36, height: 36, background: 'var(--ch-warning-bg)', color: 'var(--ch-warning-ink)' }}>!</span><span><b>Low-stock review</b><span>Check Inventory for items under 10 units.</span></span></div>
              <div className="ch-notif-item"><span className="ch-thumb" style={{ width: 36, height: 36, background: 'var(--ch-success-bg)', color: 'var(--ch-success-ink)' }}>✓</span><span><b>Store is live</b><span>POS is ready to take sales.</span></span></div>
            </div>
          )}
        </div>

        <div className="ch-notif-wrap" ref={userRef}>
          <button type="button" className="ch-profile" onClick={() => { setUserOpen((v) => !v); setNotifOpen(false); setQaOpen(false); }} aria-label="User menu" aria-expanded={userOpen} title="Account">
            <span className="ch-avatar" aria-hidden="true">{initial}</span>
            <span className="ch-profile-meta">
              <b>{user?.name ?? 'Store owner'}</b>
              <span>{role === '' ? '…' : role}</span>
            </span>
          </button>
          {userOpen && (
            <div className="ch-qa-pop" role="menu" aria-label="User menu">
              <Link className="ch-qa-item" to="/settings" onClick={() => setUserOpen(false)}>Store settings</Link>
              <Link className="ch-qa-item" to="/admin/users" onClick={() => setUserOpen(false)}>Team members</Link>
              <button type="button" className="ch-qa-item" onClick={() => { void logout(); }}>Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
