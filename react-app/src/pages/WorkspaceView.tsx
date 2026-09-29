import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  ChefHat,
  ClipboardCheck,
  CreditCard,
  Download,
  FileText,
  Gift,
  HeartHandshake,
  ImageOff,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Store,
  Trash2,
  Workflow,
} from 'lucide-react';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import FilterBar from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../context/AuthContext';
import { can } from '../services/authService';
import { getProducts, getCategories, createCategory, updateCategory, deactivateCategory, deleteCategory, repairCategoryLinks, type RepairResult } from '../services/productService';
import { getOrders } from '../services/orderService';
import { getCampaigns, createCampaign, updateCampaign, redeemReward, getCustomers, type RewardCampaign } from '../services/customerService';
import { exportAuditCsv, exportAuditPdf, getAuditLogs, getUsers, type AuditMetrics, type AuditRecord } from '../services/userService';
import { getTransfers } from '../services/inventoryService';
import { ackKot, doneKot, getKotLog, type KotEntry } from '../services/printService';
import {
  companyLogoUrl,
  getCompanyProfile,
  getSmtpStatus,
  getZohoStatus,
  removeCompanyLogo,
  saveCompanyProfile,
  uploadCompanyLogo,
  type CompanyProfile,
} from '../services/settingsService';
import { avatarGradient, currency, customerTier, formatDate, initials, number } from '../utils/format';
import type { Category, Customer, Order, PosUser, Product, SmtpStatus, ZohoStatus } from '../types';
import Warehouses from './Warehouses';
import Transfers from './Transfers';
import Movements from './Movements';
import Returns from './Returns';
import './WorkspaceView.css';

/* ==========================================================================
   CloudHub POS — Enterprise sub-module workspace views.
   Every view derives from LIVE service data (products / orders / customers /
   users). No fabricated metrics: empty domains render honest empty states.
   ========================================================================== */

function ViewHead({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <div className="ch-page-head reveal">
      <div>
        <h1 className="ch-page-title">{title}</h1>
        <p className="ch-page-sub">{sub}</p>
      </div>
      {actions !== undefined && <div className="ch-page-actions">{actions}</div>}
    </div>
  );
}

function groupBy<T>(rows: Array<T>, key: (r: T) => string): Map<string, Array<T>> {
  const m = new Map<string, Array<T>>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
}

/* ---------------- Categories (first-class management) ---------------- */

interface CategoryRow {
  cat: Category;
  skus: number;
  names: Array<string>;
}

function CategoriesView() {
  const { role } = useAuth();
  const [products, setProducts] = useState<Array<Product>>([]);
  const [categories, setCategories] = useState<Array<Category>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: '', description: '', display_order: '0', status: 'Active' });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<CategoryRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CategoryRow | null>(null);
  const [repairInfo, setRepairInfo] = useState<RepairResult | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);

  const editable = can('manage_products', role === '' ? 'Admin' : role);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([getProducts(), getCategories().catch(() => [] as Array<Category>)])
      .then(([items, cats]) => {
        setProducts(items);
        setCategories(cats);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load categories'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const rows: Array<CategoryRow> = useMemo(() => {
    return categories.map((c) => {
      const id = String(c.ROWID ?? '');
      const mine = products.filter((p) => {
        if (p.category_id !== undefined && p.category_id !== null && String(p.category_id) !== '') {
          return String(p.category_id) === id;
        }
        return (p.category || 'General').trim().toLowerCase() === c.name.trim().toLowerCase();
      });
      return { cat: c, skus: mine.length, names: mine.slice(0, 8).map((p) => p.name) };
    });
  }, [products, categories]);

  if (loading) return <Loader message="Loading categories…" skeleton="page" />;
  if (error !== '' && categories.length === 0) return <ErrorState message={error} onRetry={load} />;

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', description: '', display_order: '0', status: 'Active' });
    setFormError('');
    setFormOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({
      name: c.name,
      description: c.description ?? '',
      display_order: String(c.display_order ?? 0),
      status: c.status || 'Active',
    });
    setFormError('');
    setFormOpen(true);
  };

  const submitForm = () => {
    if (form.name.trim() === '') {
      setFormError('Category name is required.');
      return;
    }
    setFormBusy(true);
    setFormError('');
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      display_order: Math.max(0, parseInt(form.display_order, 10) || 0),
      status: form.status,
    };
    const done = (msg: string) => {
      setNotice(msg);
      setFormOpen(false);
      setFormBusy(false);
      load();
    };
    if (editing === null || editing.ROWID === undefined) {
      createCategory(payload)
        .then(() => done('Category added.'))
        .catch((e: unknown) => {
          setFormError(e instanceof Error ? e.message : 'Failed to save category');
          setFormBusy(false);
        });
    } else {
      updateCategory(String(editing.ROWID), payload)
        .then(() => done('Category updated. Linked products pick up the new name automatically.'))
        .catch((e: unknown) => {
          setFormError(e instanceof Error ? e.message : 'Failed to save category');
          setFormBusy(false);
        });
    }
  };

  const deactivate = (c: Category) => {
    if (c.ROWID === undefined) return;
    setBusy(true);
    setNotice('');
    deactivateCategory(String(c.ROWID))
      .then(() => {
        setNotice(`Category "${c.name}" deactivated. Linked products keep working.`);
        load();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to deactivate category');
        setBusy(false);
      })
      .finally(() => setBusy(false));
  };

  const reactivate = (c: Category) => {
    if (c.ROWID === undefined) return;
    setBusy(true);
    setNotice('');
    updateCategory(String(c.ROWID), { status: 'Active' })
      .then(() => {
        setNotice(`Category "${c.name}" reactivated.`);
        load();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Failed to reactivate category');
        setBusy(false);
      })
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    if (deleteTarget === null || deleteTarget.cat.ROWID === undefined) return;
    setBusy(true);
    setNotice('');
    deleteCategory(String(deleteTarget.cat.ROWID))
      .then((res) => {
        setNotice(res.message ?? `Category "${deleteTarget.cat.name}" deleted.`);
        setDeleteTarget(null);
        load();
      })
      .catch((e: unknown) => {
        // 409 carries the product count ("contains N products…").
        setError(e instanceof Error ? e.message : 'Failed to delete category');
        setDeleteTarget(null);
        setBusy(false);
      })
      .finally(() => setBusy(false));
  };

  const runRepair = () => {
    setRepairBusy(true);
    setRepairInfo(null);
    setNotice('');
    repairCategoryLinks()
      .then((res) => {
        setRepairInfo(res);
        setNotice(res.message ?? 'Audit complete.');
        load();
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Repair failed');
        setRepairBusy(false);
      })
      .finally(() => setRepairBusy(false));
  };

  return (
    <div>
      <ViewHead
        title="Categories"
        sub={`${categories.length} categories · ${number(products.length)} products · renames apply to linked products automatically.`}
        actions={
          <>
            <Link to="/inventory/products" className="ch-btn ch-btn-secondary ch-btn-sm">All products <ArrowRight size={13} /></Link>
            {editable && (
              <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={runRepair} disabled={repairBusy}>
                <RefreshCw size={14} /> {repairBusy ? 'Auditing…' : 'Repair links'}
              </button>
            )}
            {editable && (
              <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={openAdd}>
                <Plus size={14} /> Add category
              </button>
            )}
          </>
        }
      />
      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}
      {repairInfo !== null && repairInfo.issues.length > 0 && (
        <div className="ch-alert ch-alert-info" role="status">
          <span>{repairInfo.fixed} link{repairInfo.fixed === 1 ? '' : 's'} repaired · {repairInfo.issues.length} item{repairInfo.issues.length === 1 ? '' : 's'} need attention: {repairInfo.issues.slice(0, 5).map((i) => i.sku || i.name).join(', ')}</span>
        </div>
      )}
      <Card delay={80}>
        {rows.length === 0 ? (
          <EmptyState
            title="No categories yet"
            message="Create categories so every product shares one consistent grouping."
            icon={<Package size={26} />}
            action={editable ? <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={openAdd}><Plus size={14} /> Add category</button> : undefined}
          />
        ) : (
          <Table
            columns={[
              {
                key: 'n', header: 'Category', render: (r: CategoryRow) => (
                  <button type="button" className="cust-link" onClick={() => setDetail(r)}>
                    <span className="ch-cell-main">{r.cat.name}</span><br /><span className="ch-cell-sub">Order {number(r.cat.display_order ?? 0)}</span>
                  </button>
                ),
              },
              { key: 'd', header: 'Description', render: (r: CategoryRow) => <span className="ch-cell-sub">{r.cat.description || '—'}</span> },
              { key: 's', header: 'Status', render: (r: CategoryRow) => <StatusBadge status={r.cat.status || 'Active'} /> },
              { key: 'c', header: 'Products', numeric: true, render: (r: CategoryRow) => <b>{number(r.skus)}</b> },
              {
                key: 'a', header: 'Actions', render: (r: CategoryRow) => (
                  <span className="ch-row" style={{ gap: 2 }}>
                    <Link to={`/inventory/products?category=${encodeURIComponent(r.cat.name)}`} className="ch-btn ch-btn-ghost ch-btn-sm">
                      View <ArrowRight size={13} />
                    </Link>
                    {editable && (
                      <>
                        <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => openEdit(r.cat)} aria-label={`Edit ${r.cat.name}`}>
                          <Pencil size={15} />
                        </button>
                        {(r.cat.status || 'Active') === 'Active' ? (
                          <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => deactivate(r.cat)} disabled={busy} aria-label={`Deactivate ${r.cat.name}`}>
                            <SlidersHorizontal size={15} />
                          </button>
                        ) : (
                          <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => reactivate(r.cat)} disabled={busy}>
                            Reactivate
                          </button>
                        )}
                        {r.skus === 0 && (
                          <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setDeleteTarget(r)} disabled={busy} aria-label={`Delete ${r.cat.name}`} title="Delete (no linked products)">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </>
                    )}
                  </span>
                ),
              },
            ]}
            rows={rows}
            rowKey={(r) => String(r.cat.ROWID ?? r.cat.name)}
          />
        )}
      </Card>

      <Modal
        open={formOpen}
        title={editing === null ? 'Add category' : `Edit ${editing.name}`}
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setFormOpen(false)} disabled={formBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitForm} disabled={formBusy}>
              {formBusy ? 'Saving…' : editing === null ? 'Add category' : 'Save changes'}
            </button>
          </>
        }
      >
        {formError !== '' && <p className="ch-form-error">{formError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field">
            <label className="ch-label" htmlFor="cf-name">Category name</label>
            <input id="cf-name" className="ch-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Beverages" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cf-order">Display order</label>
            <input id="cf-order" className="ch-input" type="number" min="0" step="1" value={form.display_order} onChange={(e) => setForm({ ...form, display_order: e.target.value })} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cf-status">Status</label>
            <select id="cf-status" className="ch-select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="cf-desc">Description</label>
            <input id="cf-desc" className="ch-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
          </div>
        </div>
      </Modal>

      <Modal
        open={detail !== null}
        title={detail === null ? 'Category details' : detail.cat.name}
        subtitle="Linked products and lifecycle state"
        onClose={() => setDetail(null)}
        footer={
          <>
            {detail !== null && editable && (detail.cat.status || 'Active') === 'Active' && (
              <button type="button" className="ch-btn ch-btn-secondary" onClick={() => { const c = detail.cat; setDetail(null); openEdit(c); }}>Edit</button>
            )}
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDetail(null)}>Close</button>
          </>
        }
      >
        {detail !== null && (
          <div>
            <dl className="ws-dl">
              <div><dt>Description</dt><dd>{detail.cat.description || '—'}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={detail.cat.status || 'Active'} /></dd></div>
              <div><dt>Products linked</dt><dd><b>{number(detail.skus)}</b></dd></div>
              <div><dt>Created</dt><dd>{detail.cat.CREATEDTIME ? formatDate(detail.cat.CREATEDTIME) : '—'}</dd></div>
              <div><dt>Updated</dt><dd>{detail.cat.MODIFIEDTIME ? formatDate(detail.cat.MODIFIEDTIME) : '—'}</dd></div>
            </dl>
            {detail.names.length > 0 && (
              <>
                <h4 className="cust-h">Linked products</h4>
                <ul className="ws-mini">
                  {detail.names.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </>
            )}
            <div className="ch-row" style={{ marginTop: 12 }}>
              <Link to={`/inventory/products?category=${encodeURIComponent(detail.cat.name)}`} className="ch-btn ch-btn-secondary ch-btn-sm">
                View products <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        title="Delete category"
        subtitle="Permanent removal — only possible with zero linked products"
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
          {deleteTarget === null
            ? ''
            : `Delete "${deleteTarget.cat.name}" permanently? This cannot be undone. Categories with products can only be deactivated.`}
        </p>
      </Modal>
    </div>
  );
}

/* ---------------- Kitchen board (KOT execution) ----------------
   Pending station chits with Ack/Done transitions. Polls quietly so the
   board stays live without flashing skeletons. */

function kotAge(firedAt: string): string {
  const t = new Date(String(firedAt ?? '')).getTime();
  if (!Number.isFinite(t)) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function KitchenView() {
  const [entries, setEntries] = useState<Array<KotEntry>>([]);
  const [station, setStation] = useState('all');
  const [status, setStatus] = useState<'active' | 'DONE' | 'all'>('active');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const load = (quiet?: boolean) => {
    if (!quiet) {
      setLoading(true);
      setError('');
    }
    getKotLog(undefined, 100, station)
      .then(setEntries)
      .catch((e: unknown) => {
        if (!quiet) setError(e instanceof Error ? e.message : 'Failed to load KOTs');
      })
      .finally(() => {
        if (!quiet) setLoading(false);
      });
  };

  useEffect(() => {
    load();
    // Fetch-light: 20s cadence, skipped while the tab is hidden (the
    // Refresh button covers on-demand updates).
    const t = window.setInterval(() => {
      if (document.hidden) return;
      load(true);
    }, 20000);
    return () => window.clearInterval(t);
  }, [station]);

  const transition = (number: string, to: 'ack' | 'done') => {
    setBusy(number);
    setNotice('');
    (to === 'ack' ? ackKot(number) : doneKot(number))
      .then(() => {
        setNotice(`KOT ${number} ${to === 'ack' ? 'acknowledged' : 'completed'}.`);
        load(true);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Transition failed'))
      .finally(() => setBusy(''));
  };

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (station !== 'all' && e.station !== station) return false;
      if (status === 'active' && e.status === 'DONE') return false;
      if (status === 'DONE' && e.status !== 'DONE') return false;
      return true;
    });
  }, [entries, station, status]);

  const counts = useMemo(() => ({
    fired: entries.filter((e) => e.status === 'FIRED').length,
    acked: entries.filter((e) => e.status === 'ACKED').length,
    done: entries.filter((e) => e.status === 'DONE').length,
  }), [entries]);

  if (loading) return <Loader message="Loading kitchen…" skeleton="page" />;
  if (error !== '' && entries.length === 0) return <ErrorState message={error} onRetry={() => load()} />;

  return (
    <div>
      <ViewHead
        title="Kitchen"
        sub="Live station tickets — acknowledge and complete as dishes fire."
        actions={
          <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => load()}>
            <RefreshCw size={14} /> Refresh
          </button>
        }
      />
      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}
      <div className="ch-grid-stats">
        <StatCard label="Fired" value={number(counts.fired)} icon={<ChefHat size={20} />} iconBg="#fef1e1" iconColor="#b25a09" delay={40} />
        <StatCard label="In progress" value={number(counts.acked)} icon={<ClipboardCheck size={20} />} iconBg="#e9f0fe" iconColor="#2b5fe3" delay={100} />
        <StatCard label="Done" value={number(counts.done)} icon={<CheckCircle2 size={20} />} iconBg="#e3f6ec" iconColor="#147a50" delay={160} />
      </div>
      <Card delay={200}>
        <div className="ch-toolbar">
          <FilterBar
            filters={[
              {
                key: 'station',
                value: station,
                onChange: setStation,
                options: [
                  { value: 'all', label: 'All stations' },
                  { value: 'kitchen', label: 'Kitchen' },
                  { value: 'bar', label: 'Bar' },
                  { value: 'counter', label: 'Counter' },
                ],
                ariaLabel: 'Filter by station',
              },
              {
                key: 'status',
                value: status,
                onChange: (v: string) => setStatus(v as 'active' | 'DONE' | 'all'),
                options: [
                  { value: 'active', label: 'Active' },
                  { value: 'DONE', label: 'Done' },
                  { value: 'all', label: 'All' },
                ],
                ariaLabel: 'Filter by status',
              },
            ]}
          />
          <span className="ch-cell-sub" style={{ marginLeft: 'auto', fontWeight: 700 }}>{filtered.length} tickets</span>
        </div>
        {filtered.length === 0 ? (
          <EmptyState title="No tickets" message="Fired KOTs appear here as POS sales complete." icon={<ChefHat size={26} />} />
        ) : (
          <Table
            columns={[
              {
                key: 'k', header: 'Ticket', render: (e: KotEntry) => (
                  <span><span className="ch-cell-main">{e.number}</span><br /><span className="ch-cell-sub">Order {e.orderId}</span></span>
                ),
              },
              { key: 's', header: 'Station', render: (e: KotEntry) => <StatusBadge status={e.station} /> },
              { key: 'l', header: 'Lines', numeric: true, render: (e: KotEntry) => <b>{number(e.lines ?? 0)}</b> },
              { key: 'a', header: 'Waiting', render: (e: KotEntry) => kotAge(e.firedAt ?? '') },
              { key: 'st', header: 'Status', render: (e: KotEntry) => <StatusBadge status={e.status} /> },
              {
                key: 'x', header: 'Actions', render: (e: KotEntry) => (
                  <span className="ch-row" style={{ gap: 4 }}>
                    {e.status === 'FIRED' && (
                      <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" disabled={busy === e.number} onClick={() => transition(e.number, 'ack')}>
                        {busy === e.number ? '…' : 'Ack'}
                      </button>
                    )}
                    {e.status === 'ACKED' && (
                      <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" disabled={busy === e.number} onClick={() => transition(e.number, 'done')}>
                        {busy === e.number ? '…' : 'Done'}
                      </button>
                    )}
                  </span>
                ),
              },
            ]}
            rows={filtered}
            rowKey={(e) => e.number}
          />
        )}
      </Card>
    </div>
  );
}

/* ---------------- Warehouses + Transfers (INV-01/04/05 — full modules) -----
   Rendered from src/pages/Warehouses.tsx and src/pages/Transfers.tsx so the
   workspace router stays the single entry point for inventory sub-modules. */

/* ---------------- Payments ---------------- */

function PaymentsView() {
  const [orders, setOrders] = useState<Array<Order>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getOrders().then(setOrders).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false));
  }, []);

  const byPay = useMemo(() => {
    const g = groupBy(orders, (o) => o.payment_mode ?? 'Unknown');
    return [...g.entries()]
      .map(([method, items]) => ({
        method,
        orders: items.length,
        revenue: items.reduce((s, o) => s + (Number(o.total) || 0), 0),
        last: items.map((o) => String(o.CREATEDTIME ?? '')).filter(Boolean).sort().pop() ?? '',
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }, [orders]);

  if (loading) return <Loader message="Loading payments…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const revenue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const total = Math.max(1, revenue);

  return (
    <div>
      <ViewHead
        title="Payments"
        sub={`${number(orders.length)} settled transactions · ${currency(revenue)} collected across ${byPay.length} methods.`}
        actions={<Link to="/sales/orders" className="ch-btn ch-btn-secondary ch-btn-sm">All orders <ArrowRight size={13} /></Link>}
      />
      <div className="ws-pay-grid">
        {byPay.map((p, i) => (
          <Card key={p.method} title={p.method} subtitle={`${number(p.orders)} orders`} delay={i * 60} hoverable>
            <p className="ws-big">{currency(p.revenue)}</p>
            <div className="ch-meter"><i style={{ width: `${Math.max(4, Math.round((p.revenue / total) * 100))}%` }} /></div>
            <p className="ch-cell-sub" style={{ margin: '8px 0 0' }}>
              {Math.round((p.revenue / total) * 100)}% of collections{p.last === '' ? '' : ` · last ${formatDate(p.last)}`}
            </p>
          </Card>
        ))}
        {byPay.length === 0 && (
          <Card><EmptyState title="No payments yet" message="Completed POS sales will appear here by method." icon={<CreditCard size={26} />} /></Card>
        )}
      </div>
    </div>
  );
}

/* ---------------- Invoices ---------------- */

function InvoicesView() {
  const [orders, setOrders] = useState<Array<Order>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getOrders().then(setOrders).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false));
  }, []);

  const invoiced = useMemo(() => orders.filter((o) => (o.books_invoice_id ?? '') !== '' || (o.invoice_number ?? '') !== ''), [orders]);
  const pending = orders.length - invoiced.length;

  if (loading) return <Loader message="Loading invoices…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div>
      <ViewHead title="Invoices" sub={`${number(invoiced.length)} invoiced · ${number(pending)} awaiting invoice.`} />
      <div className="ch-grid-stats">
        <StatCard label="Invoiced" value={number(invoiced.length)} delta={`${currency(invoiced.reduce((s, o) => s + (Number(o.total) || 0), 0))} billed`} deltaTone="up" icon={<FileText size={20} />} delay={40} />
        <StatCard label="Awaiting invoice" value={number(pending)} delta={pending > 0 ? 'Follow up from Orders' : 'All clear'} deltaTone={pending > 0 ? 'down' : 'up'} icon={<ClipboardCheck size={20} />} iconBg="#fef1e1" iconColor="#b25a09" delay={100} />
      </div>
      <Card delay={140}>
        {invoiced.length === 0 ? (
          <EmptyState title="No invoices yet" message="Invoices are issued automatically when POS sales sync to Books." icon={<FileText size={26} />} />
        ) : (
          <Table
            columns={[
              { key: 'n', header: 'Invoice', render: (o: Order) => <span className="ch-cell-main">{o.invoice_number && o.invoice_number !== '' ? o.invoice_number : `#${String(o.ROWID)}`}</span> },
              { key: 'd', header: 'Date', render: (o: Order) => formatDate(String(o.CREATEDTIME ?? '')) },
              { key: 'c', header: 'Customer', render: (o: Order) => o.customer_name ?? '—' },
              { key: 't', header: 'Total', numeric: true, render: (o: Order) => <b>{currency(o.total)}</b> },
              { key: 's', header: 'Status', render: (o: Order) => <StatusBadge status={o.status ?? 'Pending'} /> },
            ]}
            rows={invoiced.slice(0, 50)}
            rowKey={(o, i) => `${String(o.ROWID ?? o.invoice_number ?? i)}-${i}`}
          />
        )}
      </Card>
    </div>
  );
}

/* ---------------- Returns + Movements: full modules (see pages/) ------- */

/* ---------------- Loyalty / Rewards / Membership ---------------- */

interface EnrichedCustomer extends Customer {
  order_count: number;
  lifetime_value: number;
}

function useEnrichedCustomers() {
  const [rows, setRows] = useState<Array<EnrichedCustomer>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
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
            const mine = byName.get(c.name.trim().toLowerCase()) ?? [];
            const lifetime = mine.reduce((s, o) => s + (Number(o.total) || 0), 0);
            return { ...c, order_count: mine.length, lifetime_value: c.balance && c.balance > 0 ? c.balance : lifetime };
          }),
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);
  return { rows, loading, error };
}

function tierBadge(tier: string) {
  return <StatusBadge status={tier} />;
}

/* CUST-05: real loyalty balances from the Customers table (server tier
   wins; the order-based estimate remains as the display fallback). */
function loyaltyTierOf(c: EnrichedCustomer): string {
  const server = (c.tier ?? '').trim();
  if (server !== '') return server;
  return customerTier(c.order_count, c.lifetime_value);
}

function LoyaltyView() {
  const { rows, loading, error } = useEnrichedCustomers();
  const stats = useMemo(() => {
    const issued = rows.reduce((s, c) => s + Number(c.lifetime_points ?? 0), 0);
    const active = rows.reduce((s, c) => s + Number(c.loyalty_points ?? 0), 0);
    return {
      members: rows.length,
      active,
      issued,
      redeemed: Math.max(0, issued - active),
      vips: rows.filter((c) => loyaltyTierOf(c) === 'VIP').length,
    };
  }, [rows]);
  const tiers = useMemo(() => {
    const g = groupBy(rows, loyaltyTierOf);
    return (['VIP', 'Loyal', 'Active', 'New'] as const).map((t) => {
      const items = g.get(t) ?? [];
      return {
        tier: t,
        members: items.length,
        points: items.reduce((s, c) => s + Number(c.loyalty_points ?? 0), 0),
        value: items.reduce((s, c) => s + c.lifetime_value, 0),
        orders: items.reduce((s, c) => s + c.order_count, 0),
      };
    });
  }, [rows]);
  const ranking = useMemo(
    () => [...rows].sort((a, b) => Number(b.loyalty_points ?? 0) - Number(a.loyalty_points ?? 0)).slice(0, 25),
    [rows],
  );

  if (loading) return <Loader message="Loading loyalty…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div>
      <ViewHead title="Loyalty" sub="Live points balances, tier distribution and member ranking." actions={<Link to="/customers" className="ch-btn ch-btn-secondary ch-btn-sm">All customers</Link>} />
      <div className="ch-grid-stats">
        <StatCard label="Total members" value={number(stats.members)} icon={<HeartHandshake size={20} />} delay={40} />
        <StatCard label="Active points" value={number(stats.active)} delta={`${number(stats.issued)} issued`} deltaTone="flat" icon={<Gift size={20} />} iconBg="#e3f6ec" iconColor="#147a50" delay={100} />
        <StatCard label="Points redeemed" value={number(stats.redeemed)} icon={<Gift size={20} />} iconBg="#fef1e1" iconColor="#b25a09" delay={160} />
        <StatCard label="VIP customers" value={number(stats.vips)} icon={<HeartHandshake size={20} />} iconBg="#e9f0fe" iconColor="#2b5fe3" delay={220} />
      </div>
      <div className="ws-tier-grid">
        {tiers.map((t, i) => (
          <Card key={t.tier} delay={i * 60} hoverable>
            <span>{tierBadge(t.tier)}</span>
            <p className="ws-big">{number(t.members)}</p>
            <p className="ch-cell-sub" style={{ margin: 0 }}>{number(t.points)} pts · {number(t.orders)} orders · {currency(t.value)} lifetime</p>
          </Card>
        ))}
      </div>
      <Card title="Customer loyalty ranking" subtitle="Top members by current points balance" delay={200}>
        {ranking.length === 0 || stats.issued === 0 ? (
          <EmptyState
            title="No points issued yet"
            message="Members earn 1 point per LKR 100 automatically at checkout. Balances and tiers appear here as sales complete."
            icon={<Gift size={26} />}
            action={<Link to="/sales/pos" className="ch-btn ch-btn-primary ch-btn-sm">Open POS</Link>}
          />
        ) : (
          <Table
            columns={[
              {
                key: 'n', header: 'Member', render: (c: EnrichedCustomer) => (
                  <span className="cust-link"><span className="ch-avatar" style={{ background: avatarGradient(c.name) }} aria-hidden="true">{initials(c.name)}</span><span className="ch-cell-main">{c.name}</span></span>
                ),
              },
              { key: 't', header: 'Tier', render: (c: EnrichedCustomer) => tierBadge(loyaltyTierOf(c)) },
              { key: 'p', header: 'Points', numeric: true, render: (c: EnrichedCustomer) => <b>{number(c.loyalty_points ?? 0)}</b> },
              { key: 'lp', header: 'Lifetime pts', numeric: true, render: (c: EnrichedCustomer) => number(c.lifetime_points ?? 0) },
              { key: 'l', header: 'Lifetime value', numeric: true, render: (c) => <b>{currency(c.lifetime_value)}</b> },
            ]}
            rows={ranking}
            rowKey={(c) => c.id}
          />
        )}
      </Card>
    </div>
  );
}

function RewardsView() {
  const { role } = useAuth();
  const { rows, loading, error } = useEnrichedCustomers();
  const [campaigns, setCampaigns] = useState<Array<RewardCampaign>>([]);
  const [campError, setCampError] = useState('');
  const [notice, setNotice] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [form, setForm] = useState({ name: '', description: '', points_cost: '100', reward_type: 'discount_percent', reward_value: '10', active: true });
  const [redeemTarget, setRedeemTarget] = useState<EnrichedCustomer | null>(null);
  const [redeemCampaign, setRedeemCampaign] = useState('');
  const [redeemBusy, setRedeemBusy] = useState(false);
  const [redeemError, setRedeemError] = useState('');
  const [voucher, setVoucher] = useState<string | null>(null);

  const effectiveRole = role === '' ? 'Admin' : role;
  const canManage = ['Admin', 'Manager'].includes(effectiveRole);
  const canRedeem = ['Admin', 'Manager', 'Cashier'].includes(effectiveRole);

  const loadCampaigns = () => {
    getCampaigns()
      .then(setCampaigns)
      .catch((e: unknown) => setCampError(e instanceof Error ? e.message : 'Failed to load campaigns'));
  };
  useEffect(loadCampaigns, []);

  const eligible = useMemo(
    () => rows.filter((c) => loyaltyTierOf(c) === 'VIP').sort((a, b) => b.lifetime_value - a.lifetime_value),
    [rows],
  );
  const activeCampaigns = useMemo(() => campaigns.filter((c) => c.active), [campaigns]);

  if (loading) return <Loader message="Loading rewards…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const activePoints = rows.reduce((s, c) => s + Number(c.loyalty_points ?? 0), 0);

  const submitCampaign = () => {
    if (form.name.trim() === '') {
      setFormError('Campaign name is required.');
      return;
    }
    setFormBusy(true);
    setFormError('');
    createCampaign({
      name: form.name.trim(),
      description: form.description.trim(),
      points_cost: Math.max(1, Math.floor(Number(form.points_cost) || 0)),
      reward_type: form.reward_type === 'discount_flat' ? 'discount_flat' : 'discount_percent',
      reward_value: Number(form.reward_value) || 0,
      active: form.active,
    })
      .then(() => {
        setNotice('Campaign created.');
        setFormOpen(false);
        setForm({ name: '', description: '', points_cost: '100', reward_type: 'discount_percent', reward_value: '10', active: true });
        loadCampaigns();
      })
      .catch((e: unknown) => setFormError(e instanceof Error ? e.message : 'Failed to create campaign'))
      .finally(() => setFormBusy(false));
  };

  const toggleCampaign = (c: RewardCampaign) => {
    updateCampaign(c.id, { active: !c.active })
      .then(() => {
        setNotice(`Campaign ${!c.active ? 'activated' : 'deactivated'}.`);
        loadCampaigns();
      })
      .catch((e: unknown) => setCampError(e instanceof Error ? e.message : 'Update failed'));
  };

  const submitRedeem = () => {
    if (redeemTarget === null || redeemCampaign === '') return;
    setRedeemBusy(true);
    setRedeemError('');
    setVoucher(null);
    redeemReward(redeemTarget.ROWID ?? redeemTarget.id, redeemCampaign)
      .then((res) => {
        setVoucher(res.voucher ?? null);
        setNotice(res.message ?? 'Redeemed.');
      })
      .catch((e: unknown) => setRedeemError(e instanceof Error ? e.message : 'Redemption failed'))
      .finally(() => setRedeemBusy(false));
  };

  return (
    <div>
      <ViewHead
        title="Rewards"
        sub="Redemption campaigns draw on live loyalty balances — vouchers apply as POS discounts."
        actions={canManage ? (
          <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={() => { setFormError(''); setFormOpen(true); }}>
            <Plus size={14} /> New campaign
          </button>
        ) : undefined}
      />
      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {campError !== '' && <div className="ch-alert ch-alert-error">{campError}</div>}
      <div className="ch-grid-stats">
        <StatCard label="Active campaigns" value={number(activeCampaigns.length)} delta={`${number(campaigns.length)} total`} deltaTone="flat" icon={<Gift size={20} />} delay={40} />
        <StatCard label="Redeemable points" value={number(activePoints)} delta="Across all members" deltaTone="flat" icon={<HeartHandshake size={20} />} iconBg="#e3f6ec" iconColor="#147a50" delay={100} />
      </div>
      <Card title="Reward programs" subtitle="Points cost → POS discount voucher" delay={140}>
        {campaigns.length === 0 ? (
          <EmptyState
            title="No reward programs configured"
            message="Create a redemption campaign to let members spend points. VIP members below are first in line — balances are already tracked in Loyalty."
            icon={<Gift size={26} />}
            action={canManage ? (
              <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={() => setFormOpen(true)}>
                <Plus size={14} /> New campaign
              </button>
            ) : undefined}
          />
        ) : (
          <Table
            columns={[
              { key: 'n', header: 'Campaign', render: (c: RewardCampaign) => <span><span className="ch-cell-main">{c.name}</span><br /><span className="ch-cell-sub">{c.description || '—'}</span></span> },
              { key: 'c', header: 'Cost', numeric: true, render: (c: RewardCampaign) => <b>{number(c.points_cost)} pts</b> },
              {
                key: 'r', header: 'Reward', render: (c: RewardCampaign) => (
                  <span className="ch-cell-sub">{c.reward_type === 'discount_flat' ? `${currency(c.reward_value)} off` : `${c.reward_value}% off`}</span>
                ),
              },
              { key: 's', header: 'Status', render: (c: RewardCampaign) => <StatusBadge status={c.active ? 'Active' : 'Inactive'} /> },
              {
                key: 'a', header: '', render: (c: RewardCampaign) => canManage ? (
                  <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => toggleCampaign(c)}>
                    {c.active ? 'Deactivate' : 'Activate'}
                  </button>
                ) : <span />,
              },
            ]}
            rows={campaigns}
            rowKey={(c) => c.id}
          />
        )}
      </Card>
      {eligible.length > 0 && (
        <Card title="Reward-eligible members" subtitle="Top VIP spenders — redeem a campaign into a voucher" delay={180}>
          <Table
            columns={[
              { key: 'n', header: 'Member', render: (c: EnrichedCustomer) => <span className="ch-cell-main">{c.name}</span> },
              { key: 'p', header: 'Points', numeric: true, render: (c: EnrichedCustomer) => <b>{number(c.loyalty_points ?? 0)}</b> },
              { key: 'o', header: 'Orders', numeric: true, render: (c) => number(c.order_count) },
              { key: 'l', header: 'Lifetime', numeric: true, render: (c) => <b>{currency(c.lifetime_value)}</b> },
              {
                key: 'r', header: '', render: (c: EnrichedCustomer) => canRedeem && activeCampaigns.length > 0 ? (
                  <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => { setRedeemTarget(c); setRedeemCampaign(activeCampaigns[0]?.id ?? ''); setRedeemError(''); setVoucher(null); }}>
                    Redeem
                  </button>
                ) : <StatusBadge status="Pending" />,
              },
            ]}
            rows={eligible.slice(0, 25)}
            rowKey={(c) => c.id}
          />
        </Card>
      )}

      <Modal
        open={formOpen}
        title="New campaign"
        subtitle="Members spend points; the voucher applies as a POS discount"
        onClose={() => setFormOpen(false)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setFormOpen(false)} disabled={formBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitCampaign} disabled={formBusy}>
              {formBusy ? 'Creating…' : 'Create campaign'}
            </button>
          </>
        }
      >
        {formError !== '' && <p className="ch-form-error">{formError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="rw-name">Campaign name</label>
            <input id="rw-name" className="ch-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. 10% off voucher" />
          </div>
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="rw-desc">Description</label>
            <input id="rw-desc" className="ch-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="rw-cost">Points cost</label>
            <input id="rw-cost" className="ch-input" type="number" min="1" step="1" value={form.points_cost} onChange={(e) => setForm({ ...form, points_cost: e.target.value })} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="rw-type">Reward type</label>
            <select id="rw-type" className="ch-select" value={form.reward_type} onChange={(e) => setForm({ ...form, reward_type: e.target.value })}>
              <option value="discount_percent">Percent off</option>
              <option value="discount_flat">Flat amount off</option>
            </select>
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="rw-value">Reward value</label>
            <input id="rw-value" className="ch-input" type="number" min="0" step="0.01" value={form.reward_value} onChange={(e) => setForm({ ...form, reward_value: e.target.value })} />
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="rw-active" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input id="rw-active" type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Active immediately
            </label>
          </div>
        </div>
      </Modal>

      <Modal
        open={redeemTarget !== null}
        title={redeemTarget === null ? 'Redeem reward' : `Redeem — ${redeemTarget.name}`}
        subtitle={redeemTarget === null ? undefined : `Balance: ${number(redeemTarget.loyalty_points ?? 0)} pts`}
        onClose={() => { setRedeemTarget(null); setVoucher(null); }}
        footer={
          voucher !== null ? (
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => { setRedeemTarget(null); setVoucher(null); }}>Done</button>
          ) : (
            <>
              <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setRedeemTarget(null)} disabled={redeemBusy}>Cancel</button>
              <button type="button" className="ch-btn ch-btn-primary" onClick={submitRedeem} disabled={redeemBusy || redeemCampaign === ''}>
                {redeemBusy ? 'Redeeming…' : 'Redeem'}
              </button>
            </>
          )
        }
      >
        {redeemError !== '' && <p className="ch-form-error">{redeemError}</p>}
        {voucher !== null ? (
          <div className="ch-alert ch-alert-success">
            Voucher <b>{voucher}</b> — apply it as a POS discount at checkout.
          </div>
        ) : (
          <div className="ch-field">
            <label className="ch-label" htmlFor="rw-camp">Campaign</label>
            <select id="rw-camp" className="ch-select" value={redeemCampaign} onChange={(e) => setRedeemCampaign(e.target.value)}>
              {activeCampaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} — {number(c.points_cost)} pts ({c.reward_type === 'discount_flat' ? `${currency(c.reward_value)} off` : `${c.reward_value}% off`})
                </option>
              ))}
            </select>
          </div>
        )}
      </Modal>
    </div>
  );
}

function MembershipView() {
  const { rows, loading, error } = useEnrichedCustomers();
  const groups = useMemo(() => {
    const g = groupBy(rows, (c) => (c.company ?? '').trim() === '' ? 'Individual accounts' : (c.company as string).trim());
    return [...g.entries()]
      .map(([name, items]) => ({
        name,
        members: items.length,
        orders: items.reduce((s, c) => s + c.order_count, 0),
        value: items.reduce((s, c) => s + c.lifetime_value, 0),
      }))
      .sort((a, b) => b.value - a.value);
  }, [rows]);

  if (loading) return <Loader message="Loading membership…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div>
      <ViewHead title="Membership" sub="Company-affiliated accounts grouped from customer profiles." />
      <Card delay={80}>
        {groups.length === 0 ? (
          <EmptyState title="No memberships" message="Add company names to customer profiles to build membership groups." icon={<Building2 size={26} />} />
        ) : (
          <Table
            columns={[
              { key: 'n', header: 'Membership', render: (g: (typeof groups)[number]) => <span className="ch-cell-main">{g.name}</span> },
              { key: 'm', header: 'Members', numeric: true, render: (g) => number(g.members) },
              { key: 'o', header: 'Orders', numeric: true, render: (g) => number(g.orders) },
              { key: 'v', header: 'Lifetime value', numeric: true, render: (g) => <b>{currency(g.value)}</b> },
            ]}
            rows={groups}
            rowKey={(g) => g.name}
          />
        )}
      </Card>
    </div>
  );
}

/* ---------------- Roles / Activity / Audit ---------------- */

const PERMISSIONS = [
  { key: 'sell', label: 'Sell (POS)' },
  { key: 'manage_products', label: 'Manage products' },
  { key: 'adjust_stock', label: 'Adjust stock' },
  { key: 'view_reports', label: 'View reports' },
  { key: 'manage_users', label: 'Manage users' },
  { key: 'manage_settings', label: 'Manage settings' },
] as const;

type PermissionKey = (typeof PERMISSIONS)[number]['key'];

const ROLE_SCOPES: Record<string, string> = {
  Admin: 'Full access: users, settings, reports, exports, voids, audit trail.',
  Manager: 'Operations: products, inventory, customers, orders, reports. No settings, no user deletion.',
  Cashier: 'Counter: POS sales, own orders, customer lookup and creation. No products, users or reports.',
  Storekeeper: 'Warehouse: stock, adjustments, transfers. Products read-only. No sales or customers.',
  Waiter: 'Floor sales like Cashier. No back-office access.',
  Chef: 'Kitchen visibility only. No sales, stock or admin access.',
};

function RolesView() {
  const [users, setUsers] = useState<Array<PosUser>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getUsers().then(setUsers).catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load')).finally(() => setLoading(false));
  }, []);

  const byRole = useMemo(() => {
    const g = groupBy(users, (u) => (u.role === 'master_admin' ? 'Admin' : u.role));
    return [...g.entries()]
      .map(([role, items]) => ({
        role,
        members: items.length,
        active: items.filter((u) => String(u.status ?? 'active').toLowerCase() !== 'inactive').length,
      }))
      .sort((a, b) => b.members - a.members);
  }, [users]);

  if (loading) return <Loader message="Loading roles…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const matrixRoles = [...new Set([...byRole.map((r) => r.role), 'Admin', 'Manager', 'Cashier', 'Storekeeper'])];

  return (
    <div>
      <ViewHead title="Roles" sub="Access levels resolved from the live team roster and POS permission rules." actions={<Link to="/admin/users" className="ch-btn ch-btn-secondary ch-btn-sm">Manage users</Link>} />
      <div className="ws-tier-grid">
        {byRole.map((r, i) => (
          <Card key={r.role} delay={i * 60} hoverable>
            <span><StatusBadge status={r.role} /></span>
            <p className="ws-big">{number(r.members)}</p>
            <p className="ch-cell-sub" style={{ margin: 0 }}>
              {number(r.active)} active{ROLE_SCOPES[r.role] ? ` · ${ROLE_SCOPES[r.role]}` : ''}
            </p>
          </Card>
        ))}
        {byRole.length === 0 && <Card><p className="ch-hint">No team members found.</p></Card>}
      </div>
      <Card title="Permission matrix" subtitle="Read-only view of enforced POS access rules" delay={160}>
        <Table
          columns={[
            { key: 'p', header: 'Capability', render: (row: (typeof PERMISSIONS)[number]) => <span className="ch-cell-main">{row.label}</span> },
            ...matrixRoles.map((r) => ({
              key: r,
              header: r,
              render: (row: (typeof PERMISSIONS)[number]) => (
                <span className={can(row.key as PermissionKey, r) ? 'ws-yes' : 'ws-no'}>{can(row.key as PermissionKey, r) ? '✓' : '—'}</span>
              ),
            })),
          ]}
          rows={[...PERMISSIONS]}
          rowKey={(row) => row.key}
          minWidth={520}
        />
        <p className="ch-hint" style={{ marginBottom: 0 }}>
          Built-in roles are Admin, Manager, Cashier and Storekeeper. Waiter and Chef remain for
          compatibility. Enforcement runs server-side on every protected endpoint.
        </p>
      </Card>
    </div>
  );
}

/* Business Activity Feed: operational events (sales, inventory, transfers,
   customers). Actor-based compliance events live in the Audit view. */
function ActivityView() {
  const [orders, setOrders] = useState<Array<Order>>([]);
  const [products, setProducts] = useState<Array<Product>>([]);
  const [customers, setCustomers] = useState<Array<Customer>>([]);
  const [transferCount, setTransferCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      getOrders(),
      getProducts(),
      getCustomers().catch(() => [] as Array<Customer>),
      getTransfers().catch(() => []),
    ])
      .then(([o, p, c, t]) => {
        setOrders(o);
        setProducts(p);
        setCustomers(c);
        setTransferCount(t.length);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const feed = useMemo(() => {
    const orderEvents = orders.slice(0, 12).map((o, i) => ({
      id: `o-${String(o.ROWID ?? i)}`,
      icon: <ScrollText size={15} />,
      tone: 'ok' as const,
      title: `Order ${o.invoice_number ?? `#${String(o.ROWID)}`} · ${currency(o.total)}`,
      sub: `${o.customer_name ?? 'Walk-in'} · ${formatDate(String(o.CREATEDTIME ?? ''))} · ${o.payment_mode ?? '—'}`,
    }));
    const stockEvents = products
      .filter((p) => Number(p.stock) <= 10)
      .slice(0, 6)
      .map((p) => ({
        id: `s-${String(p.ROWID ?? p.sku)}`,
        icon: <SlidersHorizontal size={15} />,
        tone: 'warn' as const,
        title: `Low stock — ${p.name}`,
        sub: `${number(p.stock)} units remaining · ${p.sku}`,
      }));
    const customerEvents = customers.slice(0, 4).map((c) => ({
      id: `c-${c.id}`,
      icon: <HeartHandshake size={15} />,
      tone: 'ok' as const,
      title: `Customer — ${c.name}`,
      sub: `${number(c.order_count ?? 0)} orders · ${currency(c.lifetime_value ?? 0)} lifetime · ${(c.tier ?? 'New').trim() || 'New'}`,
    }));
    return [...orderEvents, ...stockEvents, ...customerEvents].slice(0, 24);
  }, [orders, products, customers]);

  if (loading) return <Loader message="Loading activity…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  return (
    <div>
      <ViewHead
        title="Activity Logs"
        sub="Business activity feed — sales, inventory, transfers and customers. Actor-based audit events live under Audit."
        actions={<Link to="/admin/audit" className="ch-btn ch-btn-secondary ch-btn-sm">Open audit log</Link>}
      />
      <div className="ch-grid-stats">
        <StatCard label="Recent orders" value={number(Math.min(orders.length, 12))} icon={<ScrollText size={20} />} delay={40} />
        <StatCard label="Transfers" value={number(transferCount)} icon={<SlidersHorizontal size={20} />} iconBg="#e9f0fe" iconColor="#2b5fe3" delay={100} />
        <StatCard label="Customers" value={number(customers.length)} icon={<HeartHandshake size={20} />} iconBg="#e3f6ec" iconColor="#147a50" delay={160} />
      </div>
      <Card delay={80}>
        {feed.length === 0 ? (
          <p className="ch-hint">No activity yet.</p>
        ) : (
          <ul className="ws-feed">
            {feed.map((e) => (
              <li key={e.id}>
                <span className={e.tone === 'ok' ? 'dash-insight-ic ok' : 'dash-insight-ic warn'} aria-hidden="true">{e.icon}</span>
                <span><b>{e.title}</b><span className="ch-cell-sub" style={{ display: 'block' }}>{e.sub}</span></span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/* True actor-based audit trail (USR-05). Admin only — the backend
   enforces it; the view mirrors the gate with an honest empty state. */
function AuditView() {
  const { role } = useAuth();
  const [rows, setRows] = useState<Array<AuditRecord>>([]);
  const [metrics, setMetrics] = useState<AuditMetrics | null>(null);
  const [actions, setActions] = useState<Array<string>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('all');
  const [entity, setEntity] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [detail, setDetail] = useState<AuditRecord | null>(null);
  const [exportBusy, setExportBusy] = useState<string | null>(null);

  const effectiveRole = role === '' ? 'Admin' : role;
  const isAdmin = effectiveRole === 'Admin';

  const currentFilters = useMemo(() => ({
    date_from: dateFrom,
    date_to: dateTo,
    actor: actor.trim(),
    action,
    entity,
    search: search.trim(),
  }), [dateFrom, dateTo, actor, action, entity, search]);

  const load = () => {
    setLoading(true);
    setError('');
    getAuditLogs(currentFilters)
      .then((res) => {
        setRows(res.rows);
        setMetrics(res.metrics);
        if (res.actions.length > 0) setActions(res.actions);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load audit log'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!loading) load();
    }, search.trim() === '' && actor.trim() === '' ? 0 : 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, actor, action, entity, dateFrom, dateTo]);

  const runExport = (kind: 'csv' | 'pdf') => {
    setExportBusy(kind);
    setNotice('');
    const fn = kind === 'csv' ? exportAuditCsv : exportAuditPdf;
    fn(currentFilters)
      .then(() => setNotice(`Audit ${kind.toUpperCase()} exported with current filters.`))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Export failed'))
      .finally(() => setExportBusy(null));
  };

  if (!isAdmin) {
    return (
      <div>
        <ViewHead title="Audit" sub="Actor-based audit trail of sensitive actions." />
        <Card delay={80}>
          <EmptyState
            title="Admins only"
            message="The audit trail contains cross-user activity and is limited to Admins. Managers cannot view full audit history."
            icon={<ShieldCheck size={26} />}
            action={<Link to="/admin/activity" className="ch-btn ch-btn-secondary ch-btn-sm">View business activity</Link>}
          />
        </Card>
      </div>
    );
  }

  if (loading && rows.length === 0) return <Loader message="Loading audit…" skeleton="page" />;
  if (error !== '' && rows.length === 0) return <ErrorState message={error} onRetry={load} />;

  const entities = [...new Set(rows.map((r) => r.entity_type).filter(Boolean))].sort();

  return (
    <div>
      <ViewHead
        title="Audit"
        sub={`${number(metrics?.total_events ?? rows.length)} audited events · actor, action, entity, IP.`}
        actions={
          <>
            <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" disabled={exportBusy !== null} onClick={() => runExport('csv')}>
              <Download size={14} /> {exportBusy === 'csv' ? 'Exporting…' : 'Audit CSV'}
            </button>
            <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" disabled={exportBusy !== null} onClick={() => runExport('pdf')}>
              <FileText size={14} /> {exportBusy === 'pdf' ? 'Exporting…' : 'Audit PDF'}
            </button>
          </>
        }
      />
      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      <div className="ch-grid-stats">
        <StatCard label="Total events" value={number(metrics?.total_events ?? rows.length)} icon={<ClipboardCheck size={20} />} delay={40} />
        <StatCard label="Users created" value={number(metrics?.users_created ?? 0)} icon={<ClipboardCheck size={20} />} iconBg="#e3f6ec" iconColor="#147a50" delay={100} />
        <StatCard label="Role changes" value={number(metrics?.role_changes ?? 0)} icon={<ClipboardCheck size={20} />} iconBg="#e9f0fe" iconColor="#2b5fe3" delay={160} />
        <StatCard label="Users disabled" value={number(metrics?.users_deactivated ?? 0)} delta={`${number(metrics?.report_exports ?? 0)} exports`} deltaTone="flat" icon={<ClipboardCheck size={20} />} iconBg="#fef1e1" iconColor="#b25a09" delay={220} />
      </div>

      <Card delay={80}>
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search actor, entity, values…" ariaLabel="Search audit log" />
          <FilterBar
            filters={[
              {
                key: 'action', value: action, ariaLabel: 'Filter by action', onChange: setAction,
                options: [{ value: 'all', label: 'All actions' }, ...actions.map((a) => ({ value: a, label: a }))],
              },
              {
                key: 'entity', value: entity, ariaLabel: 'Filter by entity', onChange: setEntity,
                options: [{ value: 'all', label: 'All entities' }, ...entities.map((e) => ({ value: e, label: e }))],
              },
            ]}
            onReset={() => { setSearch(''); setActor(''); setAction('all'); setEntity('all'); setDateFrom(''); setDateTo(''); }}
          />
          <span className="orders-dates">
            <input className="ch-input" aria-label="Filter by actor" placeholder="Actor…" value={actor} onChange={(e) => setActor(e.target.value)} />
            <input type="date" className="ch-input" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <input type="date" className="ch-input" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </span>
        </div>
        {loading && <p className="ch-hint">Refreshing…</p>}
        {rows.length === 0 ? (
          <EmptyState
            title="No audit events"
            message="Sensitive actions (role changes, voids, adjustments, exports) are recorded here automatically. If this is a fresh deployment, provision the UserAuditLog table first."
            icon={<ClipboardCheck size={26} />}
          />
        ) : (
          <Table
            columns={[
              { key: 'd', header: 'Date', render: (r: AuditRecord) => <span className="ch-cell-sub">{r.created_at ? formatDate(r.created_at) : '—'}</span> },
              {
                key: 'a', header: 'Actor', render: (r: AuditRecord) => (
                  <span><span className="ch-cell-main">{r.actor_name || '—'}</span><br /><span className="ch-cell-sub">{r.actor_role || ''}</span></span>
                ),
              },
              { key: 'ac', header: 'Action', render: (r: AuditRecord) => <StatusBadge status={r.action} /> },
              {
                key: 'e', header: 'Entity', render: (r: AuditRecord) => (
                  <button type="button" className="cust-link" onClick={() => setDetail(r)}>
                    <span><span className="ch-cell-main">{r.entity_name || r.entity_id || r.entity_type || '—'}</span><br /><span className="ch-cell-sub">{r.entity_type || ''}</span></span>
                  </button>
                ),
              },
              {
                key: 'v', header: 'Change', render: (r: AuditRecord) => (
                  <span className="ch-cell-sub">
                    {r.old_value !== '' || r.new_value !== '' ? `${r.old_value || '—'} → ${r.new_value || '—'}` : '—'}
                  </span>
                ),
              },
              { key: 'ip', header: 'IP', render: (r: AuditRecord) => <span className="ch-cell-sub">{r.ip_address || '—'}</span> },
            ]}
            rows={rows}
            rowKey={(r, i) => `${String(r.ROWID ?? i)}-${i}`}
          />
        )}
      </Card>

      <Modal
        open={detail !== null}
        title={detail === null ? 'Audit details' : detail.action}
        subtitle={detail === null ? undefined : `${detail.actor_name} · ${detail.created_at ? formatDate(detail.created_at) : ''}`}
        onClose={() => setDetail(null)}
        footer={<button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDetail(null)}>Close</button>}
      >
        {detail !== null && (
          <dl className="ws-dl">
            <div><dt>Actor</dt><dd>{detail.actor_name || '—'}{detail.actor_role ? ` (${detail.actor_role})` : ''}</dd></div>
            <div><dt>Action</dt><dd><StatusBadge status={detail.action} /></dd></div>
            <div><dt>Entity</dt><dd>{[detail.entity_type, detail.entity_name || detail.entity_id].filter(Boolean).join(': ') || '—'}</dd></div>
            <div><dt>Previous value</dt><dd style={{ overflowWrap: 'anywhere' }}>{detail.old_value || '—'}</dd></div>
            <div><dt>New value</dt><dd style={{ overflowWrap: 'anywhere' }}>{detail.new_value || '—'}</dd></div>
            <div><dt>IP address</dt><dd>{detail.ip_address || '—'}</dd></div>
            <div><dt>User agent</dt><dd style={{ overflowWrap: 'anywhere' }}>{detail.user_agent || '—'}</dd></div>
            <div><dt>Recorded</dt><dd>{detail.created_at ? formatDate(detail.created_at) : '—'}</dd></div>
          </dl>
        )}
      </Modal>
    </div>
  );
}

/* ---------------- Business profile ---------------- */

function BusinessView() {
  const { role } = useAuth();
  const [company, setCompany] = useState<Partial<CompanyProfile>>({});
  const [products, setProducts] = useState<Array<Product>>([]);
  const [customers, setCustomers] = useState<Array<Customer>>([]);
  const [orders, setOrders] = useState<Array<Order>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoTick, setLogoTick] = useState(0);

  const isAdmin = (role === '' ? 'Admin' : role) === 'Admin';

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      getCompanyProfile().catch(() => ({} as Partial<CompanyProfile>)),
      getProducts().catch(() => [] as Array<Product>),
      getCustomers().catch(() => [] as Array<Customer>),
      getOrders().catch(() => [] as Array<Order>),
    ])
      .then(([co, p, c, o]) => {
        setCompany(co);
        setProducts(p);
        setCustomers(c);
        setOrders(o);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <Loader message="Loading business profile…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={load} />;

  const revenue = orders.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const setCo = (key: string, value: string) => setCompany((prev) => ({ ...prev, [key]: value }));

  const saveEdit = () => {
    setSaving(true);
    setNotice('');
    saveCompanyProfile(company)
      .then((co) => {
        setCompany(co);
        setEditing(false);
        setNotice('Company profile saved.');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Save failed'))
      .finally(() => setSaving(false));
  };

  const cancelEdit = () => {
    setEditing(false);
    setError('');
    load();
  };

  const onLogoFile = (file: File | undefined) => {
    if (!file || !isAdmin) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setError('Logo must be PNG, JPG/JPEG, or WebP.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Logo exceeds 5 MB.');
      return;
    }
    setLogoBusy(true);
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      uploadCompanyLogo({ imageData: String(reader.result ?? ''), mimeType: file.type })
        .then(() => {
          setNotice('Logo uploaded.');
          setLogoTick((t) => t + 1);
          load();
        })
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Logo upload failed'))
        .finally(() => setLogoBusy(false));
    };
    reader.onerror = () => {
      setError('Could not read the logo file.');
      setLogoBusy(false);
    };
    reader.readAsDataURL(file);
  };

  const onLogoRemove = () => {
    setLogoBusy(true);
    removeCompanyLogo()
      .then(() => {
        setNotice('Logo removed.');
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Logo removal failed'))
      .finally(() => setLogoBusy(false));
  };

  const logoSrc = company.logo_file_id ? `${companyLogoUrl()}?t=${logoTick}` : '';
  const address = [company.address1, company.address2, company.city, company.province, company.postal_code, company.country]
    .filter((v) => String(v ?? '').trim() !== '').join(', ');

  return (
    <div>
      <ViewHead
        title="Business"
        sub="Operating profile — identity, scale and store defaults."
      />
      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}
      <div className="ch-grid-stats">
        <StatCard label="Catalog" value={number(products.length)} delta={`${number(products.reduce((s, p) => s + Number(p.stock || 0), 0))} units on hand`} icon={<Package size={20} />} delay={40} />
        <StatCard label="Customers" value={number(customers.length)} icon={<HeartHandshake size={20} />} iconBg="#e3f6ec" iconColor="#147a50" delay={100} />
        <StatCard label="Lifetime revenue" value={currency(revenue)} delta={`${number(orders.length)} orders`} deltaTone="up" icon={<Building2 size={20} />} iconBg="#e9f0fe" iconColor="#2b5fe3" delay={160} />
      </div>
      <Card
        title="Company profile"
        subtitle="What the store uploaded — names, address and contact details"
        action={<Store size={18} aria-hidden="true" />}
        delay={200}
      >
        {logoSrc !== '' ? (
          <div className="ch-row" style={{ marginBottom: 12, alignItems: 'center' }}>
            <img src={logoSrc} alt="Company logo" style={{ maxHeight: 56, maxWidth: 180, borderRadius: 8, border: '1px solid var(--ch-border-soft)' }} />
            {editing && isAdmin && (
              <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={onLogoRemove} disabled={logoBusy}>
                <ImageOff size={14} /> {logoBusy ? 'Working…' : 'Remove'}
              </button>
            )}
          </div>
        ) : (
          <p className="ch-hint" style={{ marginTop: 0 }}>No logo yet — it appears on emailed receipts once uploaded.</p>
        )}
        {editing ? (
          <>
            {isAdmin && (
              <div className="ch-field" style={{ marginBottom: 12 }}>
                <label className="ch-label" htmlFor="biz-logo">Company logo (PNG/JPG/WebP, max 5 MB)</label>
                <input
                  id="biz-logo"
                  className="ch-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={logoBusy}
                  onChange={(e) => onLogoFile(e.target.files?.[0])}
                />
              </div>
            )}
            <div className="ch-form-grid">
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-cname">Company name</label>
                <input id="biz-cname" className="ch-input" value={String(company.company_name ?? '')} onChange={(e) => setCo('company_name', e.target.value)} placeholder="My Store" disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-legal">Legal / business name</label>
                <input id="biz-legal" className="ch-input" value={String(company.legal_name ?? '')} onChange={(e) => setCo('legal_name', e.target.value)} placeholder="Company (Pvt) Ltd" disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-addr1">Address line 1</label>
                <input id="biz-addr1" className="ch-input" value={String(company.address1 ?? '')} onChange={(e) => setCo('address1', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-addr2">Address line 2</label>
                <input id="biz-addr2" className="ch-input" value={String(company.address2 ?? '')} onChange={(e) => setCo('address2', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-city">City</label>
                <input id="biz-city" className="ch-input" value={String(company.city ?? '')} onChange={(e) => setCo('city', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-prov">Province</label>
                <input id="biz-prov" className="ch-input" value={String(company.province ?? '')} onChange={(e) => setCo('province', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-postal">Postal code</label>
                <input id="biz-postal" className="ch-input" value={String(company.postal_code ?? '')} onChange={(e) => setCo('postal_code', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-country">Country</label>
                <input id="biz-country" className="ch-input" value={String(company.country ?? '')} onChange={(e) => setCo('country', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-phone">Phone</label>
                <input id="biz-phone" className="ch-input" value={String(company.phone ?? '')} onChange={(e) => setCo('phone', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-cemail">Email</label>
                <input id="biz-cemail" className="ch-input" type="email" value={String(company.email ?? '')} onChange={(e) => setCo('email', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-web">Website</label>
                <input id="biz-web" className="ch-input" value={String(company.website ?? '')} onChange={(e) => setCo('website', e.target.value)} placeholder="https://…" disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-currency">Currency</label>
                <select id="biz-currency" className="ch-select" value={String(company.currency ?? 'LKR')} onChange={(e) => setCo('currency', e.target.value)} disabled={!isAdmin}>
                  {['LKR', 'USD', 'EUR', 'INR', 'GBP'].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-reg">Business registration no.</label>
                <input id="biz-reg" className="ch-input" value={String(company.reg_number ?? '')} onChange={(e) => setCo('reg_number', e.target.value)} disabled={!isAdmin} />
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="biz-taxno">Tax registration no.</label>
                <input id="biz-taxno" className="ch-input" value={String(company.tax_number ?? '')} onChange={(e) => setCo('tax_number', e.target.value)} disabled={!isAdmin} />
              </div>
            </div>
            <div className="ch-row" style={{ marginTop: 12 }}>
              {isAdmin ? (
                <>
                  <button type="button" className="ch-btn ch-btn-primary" onClick={saveEdit} disabled={saving}>
                    <Save size={15} /> {saving ? 'Saving…' : 'Save changes'}
                  </button>
                  <button type="button" className="ch-btn ch-btn-secondary" onClick={cancelEdit} disabled={saving}>
                    Cancel
                  </button>
                </>
              ) : (
                <span className="ch-hint">Read-only — only Admins can save.</span>
              )}
            </div>
          </>
        ) : (
          <>
            <dl className="ws-dl">
              <div><dt>Store name</dt><dd>{String(company.company_name ?? '—') === '' ? '—' : String(company.company_name)}</dd></div>
              <div><dt>Company</dt><dd>{String(company.legal_name ?? '—') === '' ? '—' : String(company.legal_name)}</dd></div>
              <div><dt>Address</dt><dd>{address === '' ? '—' : address}</dd></div>
              <div><dt>Phone</dt><dd>{String(company.phone ?? '') === '' ? '—' : String(company.phone)}</dd></div>
              <div><dt>Email</dt><dd>{String(company.email ?? '') === '' ? '—' : String(company.email)}</dd></div>
              <div><dt>Website</dt><dd>{String(company.website ?? '') === '' ? '—' : String(company.website)}</dd></div>
              <div><dt>Registration</dt><dd>{String(company.reg_number ?? '') === '' ? '—' : String(company.reg_number)}</dd></div>
              <div><dt>Tax number</dt><dd>{String(company.tax_number ?? '') === '' ? '—' : String(company.tax_number)}</dd></div>
              <div><dt>Currency</dt><dd>{String(company.currency ?? 'LKR')}</dd></div>
            </dl>
            <div className="ch-row" style={{ marginTop: 12 }}>
              {isAdmin ? (
                <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => { setError(''); setNotice(''); setEditing(true); }}>
                  <Pencil size={14} /> Edit
                </button>
              ) : (
                <span className="ch-hint">Read-only — only Admins can edit.</span>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

/* ---------------- Automation ---------------- */

function AutomationView() {
  const [zoho, setZoho] = useState<ZohoStatus | null>(null);
  const [smtp, setSmtp] = useState<SmtpStatus | null>(null);
  const [orders, setOrders] = useState<Array<Order>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([getZohoStatus(), getSmtpStatus(), getOrders().catch(() => [] as Array<Order>)])
      .then(([z, s, o]) => {
        setZoho(z);
        setSmtp(s);
        setOrders(o);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false));
  }, []);

  const synced = useMemo(() => orders.filter((o) => (o.status ?? '').toLowerCase() === 'synced').length, [orders]);
  const offline = useMemo(() => orders.filter((o) => (o.status ?? '').toLowerCase() === 'offline pending').length, [orders]);
  const connected = zoho?.connected === true;

  if (loading) return <Loader message="Loading automations…" skeleton="page" />;
  if (error !== '') return <ErrorState message={error} onRetry={() => window.location.reload()} />;

  const rows = [
    { id: 'inv', label: 'Invoice posting', desc: 'POS sales posted to Books automatically on sync.', on: connected },
    { id: 'stock', label: 'Inventory sync', desc: 'Catalog and stock levels mirrored from Books.', on: connected },
    { id: 'mail', label: 'Email receipts', desc: 'SMTP delivery for receipts and notifications.', on: smtp?.configured === true },
    { id: 'queue', label: 'Offline queue drain', desc: `${number(offline)} orders waiting to sync.`, on: offline === 0 },
  ];

  return (
    <div>
      <ViewHead
        title="Automation"
        sub="Hands-free flows and their live operating status."
        actions={<Link to="/settings#integrations" className="ch-btn ch-btn-secondary ch-btn-sm">Manage integrations</Link>}
      />
      <div className="ch-grid-stats">
        <StatCard label="Books connection" value={connected ? 'Active' : 'Off'} delta={zoho?.org_id ? `Org ${zoho.org_id}` : 'Not connected'} deltaTone={connected ? 'up' : 'down'} icon={<Workflow size={20} />} delay={40} />
        <StatCard label="Synced orders" value={number(synced)} icon={<ClipboardCheck size={20} />} iconBg="#e3f6ec" iconColor="#147a50" delay={100} />
        <StatCard label="Offline queue" value={number(offline)} delta={offline === 0 ? 'Queue clear' : 'Drains on reconnect'} deltaTone={offline === 0 ? 'up' : 'down'} icon={<RefreshCw size={20} />} iconBg="#fef1e1" iconColor="#b25a09" delay={160} />
      </div>
      <Card title="Flows" subtitle="Status derived from live integration state" delay={200}>
        <ul className="ws-feed">
          {rows.map((r) => (
            <li key={r.id}>
              <span className={r.on ? 'dash-insight-ic ok' : 'dash-insight-ic warn'} aria-hidden="true"><Workflow size={15} /></span>
              <span style={{ flex: 1 }}><b>{r.label}</b><span className="ch-cell-sub" style={{ display: 'block' }}>{r.desc}</span></span>
              <StatusBadge status={r.on ? 'Active' : 'Pending'} />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/* ---------------- Router ---------------- */

export default function WorkspaceView() {
  const location = useLocation();
  switch (location.pathname) {    case '/inventory/categories':
      return <CategoriesView />;
    case '/inventory/warehouses':
      return <Warehouses />;
    case '/inventory/transfers':
      return <Transfers />;
    case '/inventory/movements':
      return <Movements />;
    case '/sales/payments':
      return <PaymentsView />;
    case '/sales/invoices':
      return <InvoicesView />;
    case '/sales/returns':
      return <Returns />;
    case '/sales/kitchen':
      return <KitchenView />;
    case '/customers/loyalty':
      return <LoyaltyView />;
    case '/customers/rewards':
      return <RewardsView />;
    case '/customers/membership':
      return <MembershipView />;
    case '/admin/roles':
      return <RolesView />;
    case '/admin/activity':
      return <ActivityView />;
    case '/admin/audit':
      return <AuditView />;
    case '/settings/business':
      return <BusinessView />;
    case '/settings/automation':
      return <AutomationView />;
    default:
      return <ErrorState message="Unknown workspace view." />;
  }
}
