import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, RefreshCw, Volume2, VolumeX, X } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import '../../styles/notifications.css';

export default function NotificationBell() {
  const { events, unread, loading, error, saving, soundEnabled, soundReady, refresh, markRead, toggleSound, testSound } = useNotifications();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 12, left: 12 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ top: Math.max(12, Math.min(rect.top, window.innerHeight - 512)), left: Math.max(12, Math.min(rect.right + 12, window.innerWidth - 372)) });
    };
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    place(); panel.current?.focus();
    document.addEventListener('pointerdown', outside); window.addEventListener('keydown', key); window.addEventListener('resize', place);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', key); window.removeEventListener('resize', place); };
  }, [open]);
  return <div className="ch-notif-wrap">
    <button ref={trigger} type="button" className="ch-icon-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}${error ? ', connection issue' : ''}`} aria-expanded={open} aria-controls={open ? 'pos-notification-panel' : undefined} onClick={() => { setOpen(value => !value); if (!open) refresh(); }}>
      <Bell size={17} />{unread > 0 && <span className="pos-notification-count" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}{error && <span className="pos-notification-offline" aria-hidden="true" />}
    </button>
    {open && createPortal(<div id="pos-notification-panel" ref={panel} className="pos-notification-panel" role="region" aria-label="Notifications" tabIndex={-1} style={position}>
      <div className="pos-notification-head"><h2>Notifications <span>{unread} unread</span></h2><button type="button" aria-label="Close notifications" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={18} /></button></div>
      <div className="pos-notification-controls"><button type="button" disabled={saving || loading || !unread} onClick={() => void markRead(events.filter(e => !e.read).map(e => e.id))}><CheckCheck size={15} />Mark all read</button><button type="button" disabled={saving || loading} aria-pressed={soundEnabled && soundReady} title={soundEnabled && !soundReady ? 'Enable browser audio' : 'Toggle alert sounds'} onClick={() => void toggleSound()}>{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}{soundEnabled && !soundReady ? 'Enable audio' : soundEnabled ? 'Sound on' : 'Muted'}</button></div>
      <div className="pos-notification-status">{soundEnabled ? 'Sounds start after your first click or key press.' : 'Sounds muted for your account.'}<button type="button" disabled={!soundEnabled || loading} onClick={() => void testSound()}>Test sound</button></div>
      {error && <div className="pos-notification-error" role="alert">{error}<button type="button" onClick={refresh}><RefreshCw size={14} />Retry</button></div>}
      <div className="pos-notification-list" aria-busy={loading}>
        {loading ? <p className="pos-notification-empty">Loading alerts…</p> : !events.length && !error ? <p className="pos-notification-empty">You're up to date. New kitchen and stock alerts will appear here.</p> : events.map(event => <button type="button" key={event.id} className={`pos-notification-item${event.read ? '' : ' unread'}`} disabled={saving} onClick={async () => { if (event.read || await markRead([event.id])) { setOpen(false); navigate(event.href); } }}>
          <span className={`pos-notification-symbol ${event.kind}`} aria-hidden="true">{event.kind === 'kitchen_ready' ? '✓' : event.kind === 'kitchen_new' ? '+' : '!'}</span><span><b>{event.title}</b><span>{event.message}</span><time dateTime={event.createdAt}>{event.kind === 'stock' ? 'Current stock alert' : new Date(event.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></span>{!event.read && <i aria-label="Unread" />}
        </button>)}
      </div>
    </div>, document.body)}
  </div>;
}

export function NotificationToast() {
  const { latest } = useNotifications();
  return <div className="pos-notification-toast" role="status" aria-live="polite" aria-atomic="true">{latest && <><Bell size={18} /><span><b>{latest.title}</b><span>{latest.message}</span></span></>}</div>;
}
