import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, ArrowRight, Plus } from 'lucide-react';
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
import {
  approveTransfer,
  cancelTransfer,
  completeTransfer,
  createTransfer,
  getTransfer,
  getTransfers,
  getWarehouseStock,
  getWarehouses,
} from '../services/inventoryService';
import { getProducts } from '../services/productService';
import { currency, formatDate, number } from '../utils/format';
import type { Product, StockTransfer, Warehouse, WarehouseStockRow } from '../types';
import './Inventory.css';

const STATUS_OPTIONS = ['Draft', 'Pending', 'Approved', 'Completed', 'Cancelled'];

interface DraftLine {
  product_id: string;
  quantity: string;
  available: number;
}

export default function Transfers() {
  const { role } = useAuth();
  const [transfers, setTransfers] = useState<Array<StockTransfer>>([]);
  const [warehouses, setWarehouses] = useState<Array<Warehouse>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [srcFilter, setSrcFilter] = useState('all');
  const [dstFilter, setDstFilter] = useState('all');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<StockTransfer | null>(null);

  // Create-transfer state
  const [createOpen, setCreateOpen] = useState(false);
  const [products, setProducts] = useState<Array<Product>>([]);
  const [srcStock, setSrcStock] = useState<Array<WarehouseStockRow>>([]);
  const [formSrc, setFormSrc] = useState('');
  const [formDst, setFormDst] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [lines, setLines] = useState<Array<DraftLine>>([{ product_id: '', quantity: '1', available: 0 }]);
  const [formError, setFormError] = useState('');
  const [formBusy, setFormBusy] = useState(false);

  const effectiveRole = role === '' ? 'Admin' : role;
  const operable = ['Admin', 'Manager', 'Storekeeper'].includes(effectiveRole);
  const approver = ['Admin', 'Manager'].includes(effectiveRole);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([getTransfers(), getWarehouses().catch(() => [] as Array<Warehouse>)])
      .then(([t, w]) => {
        setTransfers(t);
        setWarehouses(w);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load transfers'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const whName = (id: string, t?: StockTransfer): string => {
    if (t?.source_warehouse_name && id === t.source_warehouse_id) return t.source_warehouse_name;
    if (t?.destination_warehouse_name && id === t.destination_warehouse_id) return t.destination_warehouse_name;
    return warehouses.find((w) => String(w.ROWID) === String(id))?.name ?? id;
  };

  const stats = useMemo(() => {
    const by = (s: string) => transfers.filter((t) => String(t.status).toLowerCase() === s).length;
    return { total: transfers.length, pending: by('pending') + by('draft'), approved: by('approved'), completed: by('completed') };
  }, [transfers]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return transfers.filter((t) => {
      if (statusFilter !== 'all' && String(t.status).toLowerCase() !== statusFilter) return false;
      if (srcFilter !== 'all' && String(t.source_warehouse_id) !== srcFilter) return false;
      if (dstFilter !== 'all' && String(t.destination_warehouse_id) !== dstFilter) return false;
      if (q === '') return true;
      return t.transfer_number.toLowerCase().includes(q)
        || (t.notes ?? '').toLowerCase().includes(q)
        || (t.source_warehouse_name ?? '').toLowerCase().includes(q)
        || (t.destination_warehouse_name ?? '').toLowerCase().includes(q);
    });
  }, [transfers, search, statusFilter, srcFilter, dstFilter]);

  const refreshDetail = (id: string | number) => {
    getTransfer(id)
      .then((t) => {
        if (t) {
          setDetail(t);
          setTransfers((prev) => prev.map((x) => (String(x.ROWID) === String(t.ROWID) ? t : x)));
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to refresh transfer'));
  };

  const act = (
    fn: (id: string | number) => Promise<unknown>,
    id: string | number,
    okMsg: string,
  ) => {
    setBusy(true);
    setNotice('');
    fn(id)
      .then(() => {
        setNotice(okMsg);
        refreshDetail(id);
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Transfer action failed'))
      .finally(() => setBusy(false));
  };

  /* ---- create flow ---- */

  const openCreate = () => {
    setFormError('');
    setFormNotes('');
    setLines([{ product_id: '', quantity: '1', available: 0 }]);
    const active = warehouses.filter((w) => (w.status ?? 'Active') === 'Active');
    const def = active.find((w) => w.is_default === true);
    setFormSrc(def?.ROWID !== undefined ? String(def.ROWID) : active[0] !== undefined ? String(active[0].ROWID) : '');
    setFormDst('');
    setCreateOpen(true);
    getProducts()
      .then(setProducts)
      .catch(() => setProducts([]));
  };

  useEffect(() => {
    if (!createOpen || formSrc === '') {
      setSrcStock([]);
      return;
    }
    getWarehouseStock({ warehouse_id: formSrc })
      .then(setSrcStock)
      .catch(() => setSrcStock([]));
  }, [createOpen, formSrc]);

  const availOf = (pid: string): number => {
    const row = srcStock.find((r) => String(r.product_id) === String(pid));
    return row ? Number(row.quantity) || 0 : 0;
  };

  const submitCreate = () => {
    if (formSrc === '' || formDst === '') {
      setFormError('Source and destination warehouses are required.');
      return;
    }
    if (formSrc === formDst) {
      setFormError('Source and destination warehouses must be different.');
      return;
    }
    const items = [];
    for (const [i, l] of lines.entries()) {
      if (l.product_id === '') {
        setFormError(`Line ${i + 1}: choose a product.`);
        return;
      }
      const qty = Number(l.quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        setFormError(`Line ${i + 1}: quantity must be greater than zero.`);
        return;
      }
      items.push({ product_id: l.product_id, quantity: qty });
    }
    if (items.length === 0) {
      setFormError('At least one transfer item is required.');
      return;
    }
    setFormBusy(true);
    setFormError('');
    createTransfer({ source_warehouse_id: formSrc, destination_warehouse_id: formDst, items, notes: formNotes.trim() })
      .then(() => {
        setNotice('Transfer created and pending approval.');
        setCreateOpen(false);
        setFormBusy(false);
        load();
      })
      .catch((e: unknown) => {
        setFormError(e instanceof Error ? e.message : 'Failed to create transfer');
        setFormBusy(false);
      });
  };

  if (loading) return <Loader message="Loading transfers…" skeleton="page" />;
  if (error !== '' && transfers.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <div className="ch-page-head">
        <div>
          <h1 className="ch-page-title">Transfers</h1>
          <p className="ch-page-sub">Move stock between warehouses with a full audit trail.</p>
        </div>
        <div className="ch-page-actions">
          {operable && (
            <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={openCreate}>
              <Plus size={14} /> Create transfer
            </button>
          )}
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      <div className="ch-grid-stats cols-4">
        <StatCard label="Total transfers" value={number(stats.total)} icon={<ArrowLeftRight size={20} />} />
        <StatCard label="Awaiting approval" value={number(stats.pending)} delta={stats.pending > 0 ? 'Action needed' : 'Queue clear'} deltaTone={stats.pending > 0 ? 'down' : 'up'} icon={<ArrowLeftRight size={20} />} iconBg="#fef3e2" iconColor="#d97706" />
        <StatCard label="Approved" value={number(stats.approved)} delta="Ready to complete" icon={<ArrowRight size={20} />} iconBg="#e9f0fe" iconColor="#2b5fe3" />
        <StatCard label="Completed" value={number(stats.completed)} icon={<ArrowLeftRight size={20} />} iconBg="#e3f6ec" iconColor="#147a50" />
      </div>

      <Card>
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search transfer number or notes…" ariaLabel="Search transfers" />
          <FilterBar
            filters={[
              {
                key: 's', value: statusFilter, ariaLabel: 'Filter by status', onChange: setStatusFilter,
                options: [{ value: 'all', label: `All (${transfers.length})` }, ...STATUS_OPTIONS.map((s) => ({ value: s.toLowerCase(), label: s }))],
              },
              {
                key: 'src', value: srcFilter, ariaLabel: 'Filter by source warehouse', onChange: setSrcFilter,
                options: [{ value: 'all', label: 'All sources' }, ...warehouses.map((w) => ({ value: String(w.ROWID), label: w.name }))],
              },
              {
                key: 'dst', value: dstFilter, ariaLabel: 'Filter by destination warehouse', onChange: setDstFilter,
                options: [{ value: 'all', label: 'All destinations' }, ...warehouses.map((w) => ({ value: String(w.ROWID), label: w.name }))],
              },
            ]}
            onReset={() => { setSearch(''); setStatusFilter('all'); setSrcFilter('all'); setDstFilter('all'); }}
          />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            title="No transfers to show"
            message="Create a transfer to move stock between warehouses — every move writes TRANSFER_OUT and TRANSFER_IN ledger entries."
            icon={<ArrowLeftRight size={24} />}
            action={operable ? <button type="button" className="ch-btn ch-btn-primary ch-btn-sm" onClick={openCreate}><Plus size={14} /> Create transfer</button> : undefined}
          />
        ) : (
          <Table
            columns={[
              {
                key: 'n', header: 'Transfer', render: (t: StockTransfer) => (
                  <button type="button" className="cust-link" onClick={() => setDetail(t)}>
                    <span className="ch-cell-main">{t.transfer_number}</span><br />
                    <span className="ch-cell-sub">{whName(t.source_warehouse_id, t)} → {whName(t.destination_warehouse_id, t)}</span>
                  </button>
                ),
              },
              { key: 'i', header: 'Lines', numeric: true, render: (t: StockTransfer) => <b>{number(t.items?.length ?? 0)}</b> },
              { key: 'q', header: 'Units', numeric: true, render: (t: StockTransfer) => number((t.items ?? []).reduce((s, i) => s + Number(i.quantity || 0), 0)) },
              { key: 's', header: 'Status', render: (t: StockTransfer) => <StatusBadge status={String(t.status)} /> },
              { key: 'd', header: 'Created', render: (t: StockTransfer) => <span className="ch-cell-sub">{t.created_at ? formatDate(t.created_at) : '—'}</span> },
              {
                key: 'a', header: 'Actions', render: (t: StockTransfer) => (
                  <span className="ch-row" style={{ gap: 2 }}>
                    <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setDetail(t)}>View</button>
                    {String(t.status) !== 'Completed' && String(t.status) !== 'Cancelled' && approver && (String(t.status) === 'Draft' || String(t.status) === 'Pending') && (
                      <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" disabled={busy || t.ROWID === undefined} onClick={() => t.ROWID !== undefined && act(approveTransfer, t.ROWID, `Transfer ${t.transfer_number} approved.`)}>Approve</button>
                    )}
                    {String(t.status) === 'Approved' && operable && (
                      <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" disabled={busy || t.ROWID === undefined} onClick={() => t.ROWID !== undefined && act(
                        (id) => completeTransfer(id).then((r) => r.transfer),
                        t.ROWID,
                        `Transfer ${t.transfer_number} completed.`,
                      )}>Complete</button>
                    )}
                  </span>
                ),
              },
            ]}
            rows={filtered}
            rowKey={(t, i) => `${String(t.ROWID ?? t.transfer_number)}-${i}`}
          />
        )}
      </Card>

      {/* Detail modal */}
      <Modal
        open={detail !== null}
        title={detail === null ? 'Transfer details' : detail.transfer_number}
        subtitle={detail === null ? undefined : `${whName(detail.source_warehouse_id, detail)} → ${whName(detail.destination_warehouse_id, detail)}`}
        onClose={() => setDetail(null)}
        footer={
          detail === null ? undefined : (
            <>
              {String(detail.status) !== 'Completed' && String(detail.status) !== 'Cancelled' && operable && (
                <button
                  type="button"
                  className="ch-btn ch-btn-secondary"
                  disabled={busy || detail.ROWID === undefined}
                  onClick={() => detail.ROWID !== undefined && act(cancelTransfer, detail.ROWID, `Transfer ${detail.transfer_number} cancelled.`)}
                >
                  Cancel transfer
                </button>
              )}
              {String(detail.status) !== 'Completed' && String(detail.status) !== 'Cancelled' && approver && (String(detail.status) === 'Draft' || String(detail.status) === 'Pending') && (
                <button
                  type="button"
                  className="ch-btn ch-btn-secondary"
                  disabled={busy || detail.ROWID === undefined}
                  onClick={() => detail.ROWID !== undefined && act(approveTransfer, detail.ROWID, `Transfer ${detail.transfer_number} approved.`)}
                >
                  Approve
                </button>
              )}
              {String(detail.status) === 'Approved' && operable && (
                <button
                  type="button"
                  className="ch-btn ch-btn-primary"
                  disabled={busy || detail.ROWID === undefined}
                  onClick={() => detail.ROWID !== undefined && act(
                    (id) => completeTransfer(id).then((r) => r.transfer),
                    detail.ROWID,
                    `Transfer ${detail.transfer_number} completed. Stock moved.`,
                  )}
                >
                  {busy ? 'Working…' : 'Complete transfer'}
                </button>
              )}
              <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDetail(null)}>Close</button>
            </>
          )
        }
      >
        {detail !== null && (
          <div>
            <p style={{ marginTop: 0 }}>
              <StatusBadge status={String(detail.status)} />
              {(detail.notes ?? '') !== '' && <span className="ch-cell-sub" style={{ marginLeft: 8 }}>{detail.notes}</span>}
            </p>
            <Table
              columns={[
                { key: 'p', header: 'Product', render: (i: StockTransfer['items'][number]) => <span><span className="ch-cell-main">{i.product_name || i.product_id}</span>{i.sku ? <><br /><span className="ch-cell-sub">{i.sku}</span></> : null}</span> },
                { key: 'q', header: 'Qty', numeric: true, render: (i: StockTransfer['items'][number]) => <b>{number(i.quantity)}</b> },
              ]}
              rows={detail.items ?? []}
              rowKey={(i, ix) => `${String(i.product_id)}-${ix}`}
              minWidth={280}
            />
            <dl className="ws-dl" style={{ marginTop: 12 }}>
              <div><dt>Created by</dt><dd>{detail.created_by || '—'}</dd></div>
              <div><dt>Approved by</dt><dd>{detail.approved_by || '—'}{detail.approved_at ? ` · ${formatDate(detail.approved_at)}` : ''}</dd></div>
              <div><dt>Completed by</dt><dd>{detail.completed_by || '—'}{detail.completed_at ? ` · ${formatDate(detail.completed_at)}` : ''}</dd></div>
            </dl>
          </div>
        )}
      </Modal>

      {/* Create modal */}
      <Modal
        open={createOpen}
        title="Create transfer"
        subtitle="Source stock is validated now and again on completion"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setCreateOpen(false)} disabled={formBusy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submitCreate} disabled={formBusy}>
              {formBusy ? 'Creating…' : 'Create transfer'}
            </button>
          </>
        }
      >
        {formError !== '' && <p className="ch-form-error">{formError}</p>}
        <div className="ch-form-grid">
          <div className="ch-field">
            <label className="ch-label" htmlFor="tr-src">Source warehouse</label>
            <select id="tr-src" className="ch-select" value={formSrc} onChange={(e) => setFormSrc(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.filter((w) => (w.status ?? 'Active') === 'Active').map((w) => (
                <option key={String(w.ROWID)} value={String(w.ROWID)}>{w.name} ({w.code})</option>
              ))}
            </select>
          </div>
          <div className="ch-field">
            <label className="ch-label" htmlFor="tr-dst">Destination warehouse</label>
            <select id="tr-dst" className="ch-select" value={formDst} onChange={(e) => setFormDst(e.target.value)}>
              <option value="">Select…</option>
              {warehouses.filter((w) => (w.status ?? 'Active') === 'Active' && String(w.ROWID) !== formSrc).map((w) => (
                <option key={String(w.ROWID)} value={String(w.ROWID)}>{w.name} ({w.code})</option>
              ))}
            </select>
          </div>
          <div className="ch-field ch-field-full">
            <label className="ch-label" htmlFor="tr-notes">Notes</label>
            <input id="tr-notes" className="ch-input" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} placeholder="Optional reason for this transfer" />
          </div>
        </div>
        <h4 className="cust-h">Items</h4>
        {lines.map((l, i) => (
          <div className="ch-form-grid" key={i} style={{ marginBottom: 8 }}>
            <div className="ch-field">
              <label className="ch-label" htmlFor={`tr-p-${i}`}>Product</label>
              <select
                id={`tr-p-${i}`}
                className="ch-select"
                value={l.product_id}
                onChange={(e) => {
                  const pid = e.target.value;
                  setLines((prev) => prev.map((x, ix) => (ix === i ? { ...x, product_id: pid, available: availOf(pid) } : x)));
                }}
              >
                <option value="">Select…</option>
                {products.map((p) => (
                  <option key={String(p.ROWID ?? p.sku)} value={String(p.ROWID ?? '')}>
                    {p.name} ({p.sku}) — {currency(p.rate)}
                  </option>
                ))}
              </select>
              {l.product_id !== '' && (
                <span className="ch-hint">Available in source: {number(l.available !== 0 ? l.available : availOf(l.product_id))}</span>
              )}
            </div>
            <div className="ch-field">
              <label className="ch-label" htmlFor={`tr-q-${i}`}>Quantity</label>
              <input
                id={`tr-q-${i}`}
                className="ch-input"
                type="number"
                min="1"
                step="1"
                value={l.quantity}
                onChange={(e) => setLines((prev) => prev.map((x, ix) => (ix === i ? { ...x, quantity: e.target.value } : x)))}
              />
            </div>
            <div className="ch-field" style={{ alignSelf: 'end' }}>
              <button
                type="button"
                className="ch-btn ch-btn-ghost ch-btn-sm"
                disabled={lines.length <= 1}
                onClick={() => setLines((prev) => prev.filter((_, ix) => ix !== i))}
              >
                Remove
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          className="ch-btn ch-btn-secondary ch-btn-sm"
          onClick={() => setLines((prev) => [...prev, { product_id: '', quantity: '1', available: 0 }])}
        >
          <Plus size={14} /> Add line
        </button>
      </Modal>
    </div>
  );
}
