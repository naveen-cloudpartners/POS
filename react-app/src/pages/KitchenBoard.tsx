import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Clock3, RefreshCw, Search, Flame, CheckCircle2, Utensils, ArrowRight, ArrowLeft, Volume2, VolumeX } from 'lucide-react';
import { useNotifications } from '../context/NotificationContext';
import { useAuth } from '../context/AuthContext';
import { getKitchenTickets, updateKitchenTicket, type KitchenStatus, type KitchenTicket } from '../services/kitchenService';
import Loader from '../components/ui/Loader';
import Modal from '../components/ui/Modal';
import API_BASE from '../services/api';
import './KitchenBoard.css';

const LANES = [
  { status: 'QUEUED', label: 'Queued', caption: 'Oldest tickets first', action: 'Start preparing', next: 'PREPARING', icon: Clock3 },
  { status: 'PREPARING', label: 'Preparing', caption: 'Cooking in progress', action: 'Mark ready', next: 'READY', icon: Flame },
  { status: 'READY', label: 'Ready', caption: 'Waiting for collection', action: 'Mark served', next: 'SERVED', icon: CheckCircle2 },
] as const;
function KitchenLane({ lane, count, children }: { lane: typeof LANES[number]; count: number; children: ReactNode }) {
  const strip = useRef<HTMLDivElement>(null);
  const scroll = (direction: number) => strip.current?.scrollBy({ left: direction * Math.max(300, strip.current.clientWidth * .8), behavior: 'smooth' });
  return <section className={`kitchen-lane ${lane.status.toLowerCase()}`}>
    <header className="kitchen-lane-head"><lane.icon size={18} /><div><h2>{lane.label}<span>{count}</span></h2><p>{lane.caption}</p></div>
      <div className="kitchen-row-controls"><button type="button" aria-label={`${lane.label}: previous tickets`} onClick={() => scroll(-1)}><ArrowLeft size={16} /></button><button type="button" aria-label={`${lane.label}: next tickets`} onClick={() => scroll(1)}><ArrowRight size={16} /></button></div>
    </header>
    <div ref={strip} className="kitchen-lane-tickets" role="region" aria-label={`${lane.label} tickets`} tabIndex={0}>{children}</div>
  </section>;
}
function DishImage({ item }: { item: KitchenTicket['items'][number] }) {
  const [failed, setFailed] = useState('');
  const src = item.imageUrl ? `${API_BASE}${item.imageUrl}` : '';
  return <span className="kitchen-dish-image">{src && failed !== src ? <img src={src} alt={item.name} loading="lazy" onError={() => setFailed(src)} /> : <Utensils size={24} aria-hidden="true" />}</span>;
}
function age(ticket: KitchenTicket, now: number) {
  const start = Date.parse(ticket.firedAt);
  return Number.isFinite(start) ? Math.max(0, Math.floor((now - start) / 60000)) : null;
}

export default function KitchenBoard() {
  const { role, loading: checking } = useAuth();
  const { soundEnabled, soundReady, saving: savingSound, toggleSound } = useNotifications();
  const allowed = ['Admin', 'Kitchen', 'Chef'].includes(role);
  const [tickets, setTickets] = useState<KitchenTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [station, setStation] = useState('all');
  const [search, setSearch] = useState('');
  const [history, setHistory] = useState(false);
  const [detailNumber, setDetailNumber] = useState('');
  const [busy, setBusy] = useState<string[]>([]);
  const [updated, setUpdated] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const [now, setNow] = useState(Date.now());
  const alive = useRef(false);
  const generation = useRef(0);
  const invalidate = useCallback(() => { generation.current++; }, []);
  const pending = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const token = ++generation.current;
    try {
      const response = await getKitchenTickets();
      if (!alive.current || token !== generation.current) return;
      setTickets(response.data); setHasMore(response.hasMore); setUpdated(response.generatedAt); setError('');
    } catch (failure) {
      if (alive.current && token === generation.current) setError(failure instanceof Error ? failure.message : 'Unable to refresh kitchen');
    } finally {
      if (alive.current && token === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    alive.current = true;
    if (!allowed || checking) return () => { alive.current = false; };
    void refresh();
    const timer = window.setInterval(() => { setNow(Date.now()); if (!document.hidden && pending.current.size === 0) void refresh(); }, 15000);
    const onVisible = () => { if (!document.hidden && pending.current.size === 0) void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { alive.current = false; invalidate(); window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [allowed, checking, refresh, invalidate]);

  const transition = async (ticket: KitchenTicket, next: KitchenStatus) => {
    if (pending.current.has(ticket.number)) return;
    pending.current.add(ticket.number); generation.current++;
    setBusy([...pending.current]); setNotice(''); setActionError('');
    try {
      const changed = await updateKitchenTicket(ticket, next);
      if (!alive.current) return;
      setTickets(current => current.map(row => row.number === changed.number ? changed : row));
      setNotice(`${ticket.number} moved to ${next.toLowerCase()}.`);
    } catch (failure) {
      if (alive.current) setActionError(failure instanceof Error ? failure.message : 'Ticket update failed');
    } finally {
      pending.current.delete(ticket.number);
      if (alive.current) { setBusy([...pending.current]); if (pending.current.size === 0) void refresh(); }
    }
  };
  const filtered = useMemo(() => tickets.filter(ticket => (station === 'all' || ticket.station === station) && `${ticket.number} ${ticket.orderId} ${ticket.roomNumber} ${ticket.items.map(item => item.name).join(' ')}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.firedAt.localeCompare(b.firedAt)), [tickets, station, search]);
  const archived = filtered.filter(ticket => ['SERVED', 'CANCELLED'].includes(ticket.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  if (checking) return <Loader message="Checking kitchen access…" />;
  if (!allowed) return <Navigate to="/" replace />;
  if (loading) return <Loader message="Loading kitchen queue…" skeleton="page" />;

  const detail = tickets.find(ticket => ticket.number === detailNumber);
  const card = (ticket: KitchenTicket) => {
    const lane = LANES.find(lane => lane.status === ticket.status);
    const minutes = age(ticket, now);
    const late = minutes !== null && minutes >= 15 && !!lane;
    return <article key={ticket.number} className={`kitchen-ticket ${late ? 'waiting-long' : ''}`}>
      <header><h3>{ticket.number}</h3><span className="kitchen-ticket-age"><Clock3 size={12} />{minutes === null ? '—' : `${minutes} min`}</span></header>
      <div className="kitchen-ticket-order"><span>{ticket.station} · #{ticket.orderId}</span>{ticket.roomNumber && <b>Table / room {ticket.roomNumber}</b>}</div>
      <ul className="kitchen-ticket-items" aria-label={`${ticket.number} dishes — scroll sideways`}>{ticket.items.map((item, i) => <li key={`${item.sku}-${i}`}><DishImage item={item} /><span className="kitchen-dish-name">{item.name}<small>{item.qty} × {item.sku}{ticket.items.length > 1 ? ` · ${i + 1}/${ticket.items.length} dishes ↔` : ''}</small></span><b>{item.qty}×</b></li>)}</ul>
      <div className={`kitchen-ticket-note-line ${ticket.notes || ticket.cancellationNote || ticket.detailsMissing ? 'has-note' : ''}`} title={ticket.notes || ticket.cancellationNote}>{ticket.detailsMissing ? 'Legacy ticket: verify dishes at counter' : ticket.cancellationNote || ticket.notes || `${ticket.items.length} dish${ticket.items.length === 1 ? '' : 'es'}`}</div>
      <footer><button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDetailNumber(ticket.number)}>Details</button>{lane ? <button type="button" className="ch-btn ch-btn-primary" disabled={busy.includes(ticket.number) || (ticket.detailsMissing && lane.next !== 'SERVED')} onClick={() => void transition(ticket, lane.next)}>{busy.includes(ticket.number) ? 'Updating…' : lane.action}<ArrowRight size={14} /></button> : <span className="kitchen-ticket-final">{ticket.status === 'SERVED' ? 'Served' : 'Cancelled'}</span>}</footer>
    </article>;
  };

  return <div className="kitchen-board">
    <h1 className="kitchen-sr-only">Kitchen board</h1>
    {error && <div className="ch-alert ch-alert-error" role="alert">{error} <button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {actionError && <div className="ch-alert ch-alert-error" role="alert">{actionError}</div>}
    <span className="kitchen-sr-only" role="status">{notice}</span>
    {hasMore && <div className="ch-alert ch-alert-error">Showing the oldest 200 active tickets. Clear completed tickets to see the rest.</div>}
    <div className="kitchen-toolbar">
      <div className="kitchen-view-toggle"><button type="button" aria-pressed={!history} onClick={() => setHistory(false)}>Active board</button><button type="button" aria-pressed={history} onClick={() => setHistory(true)}>Recent history</button></div>
      <label className="kitchen-search"><Search size={16} /><input aria-label="Search kitchen tickets" placeholder="Search ticket, table or dish" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <select aria-label="Kitchen station" value={station} onChange={event => setStation(event.target.value)}><option value="all">All stations</option><option value="kitchen">Kitchen</option><option value="bar">Bar</option></select>
      <button type="button" className="ch-btn ch-btn-secondary kitchen-refresh" aria-label="Refresh kitchen tickets" title={updated ? `Updated ${new Date(updated).toLocaleTimeString()}` : "Refresh kitchen tickets"} disabled={busy.length > 0} onClick={() => void refresh()}><RefreshCw size={15} /></button>
      <button type="button" className="ch-btn ch-btn-secondary kitchen-refresh kitchen-sound-control" disabled={savingSound} aria-label={soundEnabled && soundReady ? 'Mute kitchen sounds' : 'Enable kitchen sounds'} aria-pressed={soundEnabled && soundReady} onClick={() => void toggleSound()}>{soundEnabled ? <Volume2 size={15} /> : <VolumeX size={15} />}<span className="kitchen-sound-label">{soundEnabled && !soundReady ? 'Enable audio' : soundEnabled ? 'Sound on' : 'Muted'}</span></button>
    </div>
    {history ? <section className="kitchen-history"><h2>Served & cancelled <span>{archived.length}</span></h2><div className="kitchen-history-grid">{archived.map(card)}</div>{archived.length === 0 && <p className="kitchen-empty">No recent finished tickets match your filters.</p>}</section> : <div className="kitchen-lanes">{LANES.map(lane => {
      const rows = filtered.filter(ticket => ticket.status === lane.status);
      return <KitchenLane key={lane.status} lane={lane} count={rows.length}>{rows.map(card)}{rows.length === 0 && <div className="kitchen-empty"><Utensils size={24} /><p>{lane.status === 'QUEUED' ? 'No orders waiting' : lane.status === 'PREPARING' ? 'Nothing cooking yet' : 'No orders ready'}</p></div>}</KitchenLane>;
    })}</div>}
    <Modal open={!!detail} title={detail?.number || 'Ticket details'} subtitle={detail ? `Order #${detail.orderId} · ${detail.station} · Table / room ${detail.roomNumber || '—'}` : undefined} onClose={() => setDetailNumber('')} footer={<><button className="ch-btn ch-btn-secondary" onClick={() => setDetailNumber('')}>Close</button>{detail?.detailsMissing && role === 'Admin' && !['SERVED', 'CANCELLED'].includes(detail.status) && <button className="ch-btn ch-btn-secondary" disabled={busy.includes(detail.number)} onClick={() => { if (window.confirm('Dismiss this legacy ticket after counter verification? This does not void the sale.')) void transition(detail, 'CANCELLED'); }}>Dismiss verified legacy ticket</button>}</>}>
      {detail && <><ul className="kitchen-detail-items">{detail.items.map((item, i) => <li key={i}><DishImage item={item} /><span>{item.name}</span><b>{item.qty}×</b></li>)}</ul>{detail.detailsMissing && <p>Dish details were not recorded. Confirm with the counter before preparing.</p>}{detail.notes && <p className="kitchen-ticket-notes"><b>Kitchen notes</b>{detail.notes}</p>}{detail.cancellationNote && <p className="kitchen-ticket-warning">{detail.cancellationNote}</p>}</>}
    </Modal>
  </div>;
}
