import PageIcon from '../components/ui/PageIcon';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus, Users, Crown, ReceiptText, Mail, Phone, Building2, Download, Pencil, Trash2, Sparkles } from 'lucide-react';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import FilterBar from '../components/ui/FilterBar';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import StatusBadge from '../components/ui/StatusBadge';
import { useAuth } from '../context/AuthContext';
import {
  adjustPoints,
  deleteCustomer,
  exportCustomersCsv,
  getCustomer,
  getCustomers,
  saveCustomer,
} from '../services/customerService';
import { getOrders } from '../services/orderService';
import { avatarGradient, currency, customerTier, formatDate, initials, number } from '../utils/format';
import type { Customer, LoyaltyActivity, Order } from '../types';
import './Customers.css';

interface Enriched extends Customer {
  order_count: number;
  lifetime_value: number;
  last_order: string;
}

const EMPTY = { name: '', email: '', phone: '', company: '', address: '', type: 'Customer' };

/** Server tier wins; otherwise the long-standing order-based estimate. */
function tierOf(c: Enriched): { label: string } {
  const server = (c.tier ?? '').trim();
  if (server !== '') return { label: server };
  return { label: customerTier(c.order_count, c.lifetime_value) };
}

function gradFor(name: string): string {
  return avatarGradient(name);
}

export default function Customers() {
  const { role } = useAuth();
  const [rows, setRows] = useState<Array<Enriched>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [tier, setTier] = useState(() => {
    const t = (params.get('tier') ?? 'all').toLowerCase();
    return t === 'vip' || t === 'loyal' || t === 'active' || t === 'new' ? t : 'all';
  });
  const [selected, setSelected] = useState<Enriched | null>(null);
  const [history, setHistory] = useState<Array<Order>>([]);
  const [activity, setActivity] = useState<Array<LoyaltyActivity>>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Enriched | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Enriched | null>(null);
  const [pointsOpen, setPointsOpen] = useState(false);
  const [pointsDelta, setPointsDelta] = useState('');
  const [pointsReason, setPointsReason] = useState('');
  const [pointsError, setPointsError] = useState('');
  const [pointsBusy, setPointsBusy] = useState(false);

  const effectiveRole = role;
  const canCreate = ['Admin', 'Manager', 'Cashier'].includes(effectiveRole);
  const canManage = ['Admin', 'Manager'].includes(effectiveRole);
  const canDelete = effectiveRole === 'Admin';

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([getCustomers(), getOrders().catch(() => [] as Array<Order>)])
      .then(([customers, orders]) => {
        const byName = new Map<string, Array<Order>>();
        for (const o of orders) {
          const key = (o.customer_name ?? '').trim().toLowerCase();
          if (key === '') continue;
          const list = byName.get(key) ?? [];
          list.push(o);
          byName.set(key, list);
        }
        setRows(
          customers.map((c) => {
            // Server stats win when present (CUST-03/04 live from Orders);
            // otherwise fall back to the legacy client-side name match.
            const serverCount = typeof c.order_count === 'number' ? c.order_count : -1;
            const serverValue = typeof c.lifetime_value === 'number' ? c.lifetime_value : -1;
            if (serverCount >= 0 && serverValue >= 0) {
              return {
                ...c,
                order_count: serverCount,
                lifetime_value: serverValue,
                last_order: c.last_order ?? c.last_order_at ?? '',
              };
            }
            const mine = byName.get(c.name.trim().toLowerCase()) ?? [];
            const lifetime = mine.reduce((s, o) => s + (Number(o.total) || 0), 0);
            const last = mine
              .map((o) => String(o.CREATEDTIME ?? ''))
              .filter(Boolean)
              .sort()
              .pop() ?? '';
            return { ...c, order_count: mine.length, lifetime_value: c.balance && c.balance > 0 ? c.balance : lifetime, last_order: last };
          }),
        );
        if (selected !== null) {
          const still = customers.find((c) => c.id === selected.id);
          if (still) {
            const mine = byName.get(still.name.trim().toLowerCase()) ?? [];
            setHistory(mine);
          }
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load customers'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Stay in sync with workspace deep links (e.g. Loyalty → ?tier=vip).
  useEffect(() => {
    const t = (params.get('tier') ?? '').toLowerCase();
    if (t === 'all' || t === 'vip' || t === 'loyal' || t === 'active' || t === 'new') setTier(t);
    const q = params.get('search');
    if (q !== null) setSearch(q);
  }, [params]);

  // CUST-06: name + email + phone (+ company), partial, case-insensitive.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((c) => {
      if (tier !== 'all' && tierOf(c).label.toLowerCase() !== tier) return false;
      if (q === '') return true;
      return (
        c.name.toLowerCase().includes(q) ||
        (c.email ?? '').toLowerCase().includes(q) ||
        (c.phone ?? '').includes(q) ||
        (c.company ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, search, tier]);

  const summary = useMemo(() => {
    const totalValue = rows.reduce((s, c) => s + c.lifetime_value, 0);
    const vips = rows.filter((c) => tierOf(c).label === 'VIP').length;
    const actives = rows.filter((c) => c.order_count > 0).length;
    const totalOrders = rows.reduce((s, c) => s + c.order_count, 0);
    const avgOrder = totalOrders > 0 ? totalValue / totalOrders : 0;
    const avgPoints = rows.length > 0 ? rows.reduce((s, c) => s + Number(c.loyalty_points ?? 0), 0) / rows.length : 0;
    const totalPoints = rows.reduce((s, c) => s + Number(c.loyalty_points ?? 0), 0);
    return { totalValue, vips, actives, totalOrders, avgOrder, avgPoints, totalPoints };
  }, [rows]);

  const topSpenders = useMemo(() => [...rows].sort((a, b) => b.lifetime_value - a.lifetime_value).slice(0, 4), [rows]);
  const maxSpender = Math.max(1, ...topSpenders.map((c) => c.lifetime_value));

  const openCustomer = (c: Enriched) => {
    setSelected(c);
    setActivity([]);
    // Rich profile when the loyalty backend is available; legacy fallback otherwise.
    if (!String(c.id).startsWith('local-') && c.ROWID !== undefined) {
      getCustomer(c.ROWID)
        .then((d) => {
          setSelected((prev) => (prev !== null && prev.id === c.id ? { ...prev, ...d.customer, order_count: d.customer.order_count ?? prev.order_count, lifetime_value: d.customer.lifetime_value ?? prev.lifetime_value } : prev));
          setHistory(d.recent_orders);
          setActivity(d.loyalty_activity);
        })
        .catch(() => {
          getOrders()
            .then((orders) => setHistory(orders.filter((o) => (o.customer_name ?? '').trim().toLowerCase() === c.name.trim().toLowerCase())))
            .catch(() => setHistory([]));
        });
    } else {
      getOrders()
        .then((orders) => setHistory(orders.filter((o) => (o.customer_name ?? '').trim().toLowerCase() === c.name.trim().toLowerCase())))
        .catch(() => setHistory([]));
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY);
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (c: Enriched) => {
    setEditing(c);
    setForm({
      name: c.name,
      email: c.email ?? '',
      phone: c.phone ?? '',
      company: c.company ?? '',
      address: c.address ?? '',
      type: c.type ?? 'Customer',
    });
    setFormError('');
    setFormOpen(true);
  };

  const submit = () => {
    if (form.name.trim() === '') {
      setFormError('Customer name is required.');
      return;
    }
    setBusy(true);
    setFormError('');
    const payload = {
      ...(editing !== null ? { id: editing.id } : {}),
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      address: form.address.trim(),
      type: form.type,
    };
    saveCustomer(payload)
      .then(() => {
        setNotice(`Customer "${form.name.trim()}" saved.`);
        setFormOpen(false);
        setForm(EMPTY);
        setEditing(null);
        load();
      })
      .catch((e: unknown) => setFormError(e instanceof Error ? e.message : 'Failed to save customer'))
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    if (deleteTarget === null) return;
    setBusy(true);
    deleteCustomer(deleteTarget.ROWID ?? deleteTarget.id)
      .then((res) => {
        setNotice(res.message ?? 'Customer deleted.');
        if (selected !== null && selected.id === deleteTarget.id) setSelected(null);
        setDeleteTarget(null);
        load();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to delete customer');
        setDeleteTarget(null);
      })
      .finally(() => setBusy(false));
  };

  const submitPoints = () => {
    if (selected === null || selected.ROWID === undefined) return;
    const delta = Number(pointsDelta);
    if (!Number.isFinite(delta) || delta === 0) {
      setPointsError('Enter a non-zero points amount (positive to add, negative to redeem).');
      return;
    }
    if (pointsReason.trim() === '') {
      setPointsError('A reason is required for every adjustment (audit).');
      return;
    }
    setPointsBusy(true);
    setPointsError('');
    adjustPoints(selected.ROWID, { points: delta, reason: pointsReason.trim() })
      .then((res) => {
        setNotice(res.message ?? 'Points adjusted.');
        setPointsOpen(false);
        setPointsDelta('');
        setPointsReason('');
        load();
        openCustomer({ ...selected, loyalty_points: res.loyalty_points, lifetime_points: res.lifetime_points, tier: res.tier });
      })
      .catch((e: unknown) => setPointsError(e instanceof Error ? e.message : 'Adjustment failed'))
      .finally(() => setPointsBusy(false));
  };

  if (loading) return <Loader message="Loading customers…" skeleton="page" />;
  if (error !== '' && rows.length === 0) return <ErrorState message={error} onRetry={load} />;

  const lastActivityOf = (c: Enriched): string => c.last_activity_at ?? c.last_order_at ?? c.last_order ?? '';

  return (
    <div>
      <div className="ch-page-head reveal"><PageIcon />
        <div>
          <h1 className="ch-page-title">Customers</h1>
          <p className="ch-page-sub">{rows.length} customers · {currency(summary.totalValue)} lifetime value · {summary.vips} VIP.</p>
        </div>
        <div className="ch-page-actions">
          <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => exportCustomersCsv(filtered)}>
            <Download size={14} /> Export CSV
          </button>
          {canCreate && (
            <button type="button" className="ch-btn ch-btn-primary" onClick={openAdd}>
              <UserPlus size={15} /> Add customer
            </button>
          )}
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      {/* Value widgets */}
      <div className="cust-widgets reveal" style={{ animationDelay: '50ms' }}>
        <div className="cust-widget">
          <span className="cust-widget-ic" style={{ background: 'var(--ch-primary-soft)', color: 'var(--ch-primary-deep)' }}><Users size={17} /></span>
          <span><b>{number(rows.length)}</b><span className="ch-cell-sub">Total customers</span></span>
        </div>
        <div className="cust-widget">
          <span className="cust-widget-ic" style={{ background: 'var(--ch-success-bg)', color: 'var(--ch-success-ink)' }}><Crown size={17} /></span>
          <span><b>{number(summary.vips)}</b><span className="ch-cell-sub">VIP customers</span></span>
        </div>
        <div className="cust-widget">
          <span className="cust-widget-ic" style={{ background: 'var(--ch-warning-bg)', color: 'var(--ch-warning-ink)' }}><ReceiptText size={17} /></span>
          <span><b>{currency(summary.totalValue)}</b><span className="ch-cell-sub">Lifetime value</span></span>
        </div>
        <div className="cust-top">
          <span className="ch-cell-sub" style={{ fontWeight: 800, textTransform: 'uppercase', fontSize: 10.5, letterSpacing: '0.08em' }}>Top spenders</span>
          {topSpenders.length === 0 ? (
            <span className="ch-hint">No spend data yet.</span>
          ) : (
            topSpenders.map((c) => (
              <button key={c.id} type="button" className="cust-top-row" onClick={() => openCustomer(c)} title={`View ${c.name}`}>
                <span className="ch-avatar" style={{ background: gradFor(c.name), width: 28, height: 28, fontSize: 11 }}>{initials(c.name)}</span>
                <span className="cust-top-name">{c.name}</span>
                <span className="ch-meter" aria-hidden="true"><i style={{ width: `${Math.max(5, Math.round((c.lifetime_value / maxSpender) * 100))}%` }} /></span>
                <b>{currency(c.lifetime_value)}</b>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Analytics row (CUST-03/04/05): retention + loyalty at a glance */}
      <div className="cust-widgets reveal" style={{ animationDelay: '80ms', gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <div className="cust-widget">
          <span className="cust-widget-ic" style={{ background: '#f3f4f6', color: '#1f2937' }}><ReceiptText size={17} /></span>
          <span><b>{currency(summary.avgOrder)}</b><span className="ch-cell-sub">Average order value</span></span>
        </div>
        <div className="cust-widget">
          <span className="cust-widget-ic" style={{ background: '#e3f6ec', color: '#287c52' }}><Sparkles size={17} /></span>
          <span><b>{number(Math.round(summary.avgPoints))}</b><span className="ch-cell-sub">Avg loyalty balance</span></span>
        </div>
        <div className="cust-widget">
          <span className="cust-widget-ic" style={{ background: '#fef3e2', color: '#b45309' }}><Users size={17} /></span>
          <span><b>{number(summary.actives)}</b><span className="ch-cell-sub">Active (ordered)</span></span>
        </div>
        <div className="cust-widget">
          <span className="cust-widget-ic" style={{ background: 'var(--ch-primary-soft)', color: 'var(--ch-primary-deep)' }}><Crown size={17} /></span>
          <span><b>{number(summary.totalPoints)}</b><span className="ch-cell-sub">Active points</span></span>
        </div>
      </div>

      <div className="cust-layout">
        <Card delay={100}>
          <div className="ch-toolbar">
            <SearchBar value={search} onChange={setSearch} placeholder="Search name, email or phone…" ariaLabel="Search customers" />
            <FilterBar
              filters={[{
                key: 'tier', value: tier, ariaLabel: 'Filter by loyalty tier', onChange: setTier,
                options: [
                  { value: 'all', label: 'All tiers' },
                  { value: 'vip', label: 'VIP' },
                  { value: 'loyal', label: 'Loyal' },
                  { value: 'active', label: 'Active' },
                  { value: 'new', label: 'New' },
                ],
              }]}
              onReset={() => { setSearch(''); setTier('all'); }}
            />
          </div>
          {filtered.length === 0 ? (
            <EmptyState title="No customers" message="Add your first customer to start tracking purchase history." icon={<Users size={26} />} />
          ) : (
            <Table
              columns={[
                {
                  key: 'n', header: 'Customer', render: (c: Enriched) => {
                    return (
                      <button type="button" className="cust-link" onClick={() => openCustomer(c)}>
                        <span className="ch-avatar" style={{ background: gradFor(c.name) }} aria-hidden="true">{initials(c.name)}</span>
                        <span><span className="ch-cell-main">{c.name}</span><br /><span className="ch-cell-sub">{c.company || c.email || c.phone || '—'}</span></span>
                      </button>
                    );
                  },
                },
                { key: 't', header: 'Tier', render: (c: Enriched) => { const t = tierOf(c); return <StatusBadge status={t.label} />; } },
                { key: 'p', header: 'Points', numeric: true, render: (c: Enriched) => <b>{number(c.loyalty_points ?? 0)}</b> },
                { key: 'o', header: 'Orders', numeric: true, render: (c: Enriched) => number(c.order_count) },
                { key: 'l', header: 'Lifetime value', numeric: true, render: (c: Enriched) => <b>{currency(c.lifetime_value)}</b> },
                { key: 'last', header: 'Last activity', render: (c: Enriched) => { const a = lastActivityOf(c); return a === '' ? '—' : formatDate(a); } },
              ]}
              rows={filtered}
              rowKey={(c) => c.id}
            />
          )}
        </Card>

        <Card title="Customer profile" subtitle={selected === null ? 'Select a customer' : selected.name} delay={150} className="cust-profile-card">
          {selected === null ? (
            <EmptyState title="No customer selected" message="Click a customer name to see profile, metrics and purchase timeline." icon={<Users size={26} />} />
          ) : (
            <div className="cust-detail">
              <div className="cust-hero">
                <span className="ch-avatar" style={{ background: gradFor(selected.name), width: 58, height: 58, fontSize: 20, borderRadius: 18 }} aria-hidden="true">{initials(selected.name)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 className="cust-hero-name">{selected.name}</h3>
                  <p className="ch-cell-sub">{selected.company || selected.email || selected.phone || 'Walk-in customer'}</p>
                  <span style={{ marginTop: 6, display: 'inline-block' }}><StatusBadge status={tierOf(selected).label} /></span>
                </div>
              </div>
              <div className="cust-metrics">
                <span><b>{number(selected.order_count)}</b><span className="ch-cell-sub">Orders</span></span>
                <span><b>{currency(selected.lifetime_value)}</b><span className="ch-cell-sub">Lifetime</span></span>
                <span><b>{selected.order_count > 0 ? currency(selected.lifetime_value / selected.order_count) : '—'}</b><span className="ch-cell-sub">Avg ticket</span></span>
              </div>
              {/* Loyalty balances (CUST-05) */}
              <h4 className="cust-h">Loyalty</h4>
              <div className="cust-metrics">
                <span><b>{number(selected.loyalty_points ?? 0)}</b><span className="ch-cell-sub">Current points</span></span>
                <span><b>{number(selected.lifetime_points ?? 0)}</b><span className="ch-cell-sub">Lifetime points</span></span>
                <span><b>{tierOf(selected).label}</b><span className="ch-cell-sub">Tier</span></span>
              </div>
              <dl className="cust-contact">
                <div><dt><Mail size={13} /> Email</dt><dd>{selected.email || '—'}</dd></div>
                <div><dt><Phone size={13} /> Phone</dt><dd>{selected.phone || '—'}</dd></div>
                <div><dt><Building2 size={13} /> Company</dt><dd>{selected.company || '—'}</dd></div>
                <div><dt><Building2 size={13} /> Address</dt><dd>{selected.address || '—'}</dd></div>
                <div><dt>Joined</dt><dd>{selected.joined_at ? formatDate(selected.joined_at) : '—'}</dd></div>
                <div><dt>Last purchase</dt><dd>{lastActivityOf(selected) === '' ? '—' : formatDate(lastActivityOf(selected))}</dd></div>
                <div><dt>Frequency (30d)</dt><dd>{selected.purchase_frequency_30d !== undefined ? `${number(selected.purchase_frequency_30d)} orders` : '—'}</dd></div>
              </dl>
              {(canManage || canDelete) && (
                <div className="ch-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                  {canManage && (
                    <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => openEdit(selected)} disabled={busy}>
                      <Pencil size={13} /> Edit
                    </button>
                  )}
                  {canManage && selected.ROWID !== undefined && (
                    <button
                      type="button"
                      className="ch-btn ch-btn-ghost ch-btn-sm"
                      onClick={() => { setPointsDelta(''); setPointsReason(''); setPointsError(''); setPointsOpen(true); }}
                    >
                      <Sparkles size={13} /> Adjust points
                    </button>
                  )}
                  {canDelete && selected.ROWID !== undefined && (
                    <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setDeleteTarget(selected)} disabled={busy}>
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              )}
              {activity.length > 0 && (
                <>
                  <h4 className="cust-h">Loyalty activity</h4>
                  <ul className="cust-timeline">
                    {activity.slice(0, 6).map((a, i) => (
                      <li key={`${String(a.ROWID ?? i)}-${i}`}>
                        <span className="cust-tl-dot" aria-hidden="true" />
                        <span className="cust-tl-main">
                          <b>{Number(a.delta) > 0 ? `+${number(a.delta)}` : number(a.delta)} pts → {number(a.new_points)}</b>
                          <span className="ch-cell-sub">{a.reason}{a.performed_by ? ` · ${a.performed_by}` : ''}</span>
                        </span>
                        <strong className="cust-tl-val">{a.created_at ? formatDate(a.created_at) : ''}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h4 className="cust-h">Purchase timeline</h4>
              {history.length === 0 ? (
                <p className="ch-hint">No orders recorded for this customer yet.</p>
              ) : (
                <ul className="cust-timeline">
                  {history.slice(0, 10).map((o, i) => (
                    <li key={`${String(o.ROWID ?? i)}-${i}`}>
                      <span className="cust-tl-dot" aria-hidden="true" />
                      <span className="cust-tl-main">
                        <b>{o.invoice_number && o.invoice_number !== '' ? o.invoice_number : `#${String(o.ROWID)}`}</b>
                        <span className="ch-cell-sub">{formatDate(String(o.CREATEDTIME ?? ''))}</span>
                      </span>
                      <strong className="cust-tl-val">{currency(o.total)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      </div>

      <Modal
        open={formOpen}
        title={editing === null ? 'Add customer' : `Edit ${editing.name}`}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setFormOpen(false)} disabled={busy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button>
          </>
        }
      >
        {formError !== '' && <p className="ch-form-error">{formError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="cu-name">Full name</label>
            <input id="cu-name" className="ch-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Amara Perera" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cu-email">Email</label>
            <input id="cu-email" className="ch-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cu-phone">Phone</label>
            <input id="cu-phone" className="ch-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="cu-company">Company</label>
            <input id="cu-company" className="ch-input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="cu-address">Address</label>
            <input id="cu-address" className="ch-input" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street, city" />
          </div>
        </div>
      </Modal>

      <Modal
        open={deleteTarget !== null}
        title="Delete customer"
        subtitle="Purchase history is preserved in Orders"
        onClose={() => setDeleteTarget(null)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-danger" onClick={confirmDelete} disabled={busy}>
              {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: 14, color: 'var(--ch-muted)' }}>
          {deleteTarget === null ? '' : `Delete "${deleteTarget.name}"? Customers with orders cannot be deleted.`}
        </p>
      </Modal>

      <Modal
        open={pointsOpen}
        title={selected === null ? 'Adjust points' : `Adjust points — ${selected.name}`}
        subtitle={selected === null ? undefined : `Current balance: ${number(selected.loyalty_points ?? 0)} pts`}
        onClose={() => setPointsOpen(false)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setPointsOpen(false)} disabled={pointsBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitPoints} disabled={pointsBusy}>
              {pointsBusy ? 'Saving…' : 'Apply adjustment'}
            </button>
          </>
        }
      >
        {pointsError !== '' && <p className="ch-form-error">{pointsError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field">
            <label className="ch-label" htmlFor="cu-points">Points (use negative to redeem)</label>
            <input id="cu-points" className="ch-input" type="number" step="1" value={pointsDelta} onChange={(e) => setPointsDelta(e.target.value)} placeholder="e.g. 50 or -20" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cu-reason">Reason (audit)</label>
            <input id="cu-reason" className="ch-input" value={pointsReason} onChange={(e) => setPointsReason(e.target.value)} placeholder="e.g. Goodwill credit" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
