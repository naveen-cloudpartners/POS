import PageIcon from '../components/ui/PageIcon';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
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
import { adjustStock, getProducts } from '../services/productService';
import { adjustWarehouseStock, getWarehouseStock, getWarehouses } from '../services/inventoryService';
import { boxesIcon, alertIcon, checkIcon } from './inventoryIcons';
import { currency, number } from '../utils/format';
import type { Product, Warehouse, WarehouseStockRow } from '../types';
import './Inventory.css';

type Availability = 'all' | 'ok' | 'low' | 'out' | 'backordered';

function parseAvailability(v: string | null): Availability | null {
  const f = (v ?? '').toLowerCase();
  if (f === 'ok' || f === 'low' || f === 'out' || f === 'backordered') return f;
  if (f === 'all') return 'all';
  return null;
}

export default function Inventory() {
  const [products, setProducts] = useState<Array<Product>>([]);
  const [warehouses, setWarehouses] = useState<Array<Warehouse>>([]);
  const [stockRows, setStockRows] = useState<Array<WarehouseStockRow>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Availability>(() => {
    return parseAvailability(params.get('filter') ?? params.get('stock')) ?? 'all';
  });
  // INV-01: per-warehouse view. Deep-linked from Warehouses (?warehouse=<id>).
  const [warehouseId, setWarehouseId] = useState(() => params.get('warehouse') ?? 'all');
  const [target, setTarget] = useState<Product | null>(null);
  const [targetRow, setTargetRow] = useState<WarehouseStockRow | null>(null);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  // Aggregate-view adjust needs an explicit warehouse: legacy adjustStock()
  // silently lands on the DEFAULT warehouse, which is wrong when the filter
  // shows "All warehouses". Empty = legacy path (no warehouses provisioned).
  const [adjustWarehouseId, setAdjustWarehouseId] = useState('');
  const [warehouseQuery, setWarehouseQuery] = useState('');
  const [warehouseOpen, setWarehouseOpen] = useState(false);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      getProducts(),
      getWarehouses().catch(() => [] as Array<Warehouse>),
      getWarehouseStock().catch(() => [] as Array<WarehouseStockRow>),
    ])
      .then(([items, wh, rows]) => {
        setProducts(items);
        setWarehouses(wh);
        setStockRows(rows);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load inventory'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  // Stay in sync with workspace deep links (e.g. Low Stock → ?filter=low).
  useEffect(() => {
    const f = parseAvailability(params.get('filter') ?? params.get('stock'));
    if (f !== null) setFilter(f);
    const w = params.get('warehouse');
    if (w !== null) setWarehouseId(w);
  }, [params]);

  const warehouseById = useMemo(
    () => new Map(warehouses.map((w) => [String(w.ROWID), w])),
    [warehouses],
  );

  const counts = useMemo(() => {
    const low = products.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= 10);
    const out = products.filter((p) => Number(p.stock) <= 0 && Number(p.stock) >= 0);
    const backordered = products.filter((p) => Number(p.stock) < 0);
    const value = products.reduce((s, p) => s + Number(p.rate || 0) * Number(p.stock || 0), 0);
    return { low: low.length, out: out.length, backordered: backordered.length, ok: products.length - low.length - out.length - backordered.length, value };
  }, [products]);

  const matchesAvailability = (status: string): boolean => {
    if (filter === 'all') return true;
    if (filter === 'ok') return status === 'Healthy' || status === 'In stock';
    if (filter === 'low') return status === 'Low stock';
    if (filter === 'out') return status === 'Out of stock';
    return status === 'Backordered';
  };

  // Aggregate (all-warehouses) rows — unchanged legacy behavior.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const s = Number(p.stock);
      if (filter === 'low' && !(s > 0 && s <= 10)) return false;
      if (filter === 'out' && !(s <= 0 && s >= 0)) return false;
      if (filter === 'backordered' && s >= 0) return false;
      if (filter === 'ok' && s <= 10) return false;
      if (q === '') return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    });
  }, [products, search, filter]);

  // INV-01: per-warehouse rows for the selected warehouse.
  const warehouseFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return stockRows.filter((r) => {
      if (warehouseId !== 'all' && String(r.warehouse_id) !== warehouseId) return false;
      if (!matchesAvailability(r.status)) return false;
      if (q === '') return true;
      return r.product_name.toLowerCase().includes(q) || r.sku.toLowerCase().includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockRows, search, filter, warehouseId]);

  // Scope counts to the selected warehouse (but not the current availability
  // or search filter) so the filter menu describes that warehouse accurately.
  const warehouseScopeCounts = useMemo(() => {
    const rows = stockRows.filter((r) => warehouseId === 'all' || String(r.warehouse_id) === warehouseId);
    const low = rows.filter((r) => r.status === 'Low stock').length;
    const out = rows.filter((r) => r.status === 'Out of stock').length;
    const backordered = rows.filter((r) => r.status === 'Backordered').length;
    return { total: rows.length, low, out, backordered, ok: rows.length - low - out - backordered };
  }, [stockRows, warehouseId]);

  // Summary cards always describe precisely what the table is showing. When
  // a warehouse is selected, use its row-level values rather than the global
  // Products.stock aggregate.
  const visibleCounts = useMemo(() => {
    if (warehouseId !== 'all') {
      const low = warehouseFiltered.filter((r) => r.status === 'Low stock').length;
      const out = warehouseFiltered.filter((r) => r.status === 'Out of stock').length;
      const backordered = warehouseFiltered.filter((r) => r.status === 'Backordered').length;
      const value = warehouseFiltered.reduce((sum, r) => sum + (Number(r.stock_value) || 0), 0);
      return { low, out, backordered, value };
    }
    const low = filtered.filter((p) => Number(p.stock) > 0 && Number(p.stock) <= 10).length;
    const out = filtered.filter((p) => Number(p.stock) <= 0 && Number(p.stock) >= 0).length;
    const backordered = filtered.filter((p) => Number(p.stock) < 0).length;
    const value = filtered.reduce((sum, p) => sum + Number(p.rate || 0) * Number(p.stock || 0), 0);
    return { low, out, backordered, value };
  }, [warehouseId, warehouseFiltered, filtered]);

  // Aggregate-view adjust warehouse options (searchable). useMemo must live
  // with the other hooks above the loading/error early returns (#310).
  const adjustWarehouseOptions = useMemo(() => {
    const q = warehouseQuery.trim().toLowerCase();
    return warehouses.filter((w) => {
      if (q === '') return true;
      return w.name.toLowerCase().includes(q) || String(w.code ?? '').toLowerCase().includes(q);
    });
  }, [warehouses, warehouseQuery]);

  const statusOf = (p: Product): string => {
    const s = Number(p.stock);
    if (s < 0) return 'Backordered';
    if (s <= 0) return 'Out of stock';
    if (s <= 10) return 'Low stock';
    return 'In stock';
  };

  const openAdjust = (p: Product) => {
    setTarget(p);
    setTargetRow(null);
    setDelta('');
    setReason('');
    // Preselect the default warehouse so the target is always explicit —
    // never silently the default while showing "All warehouses".
    const def = warehouses.find((w) => w.is_default === true) ?? warehouses[0] ?? null;
    setAdjustWarehouseId(def === null ? '' : String(def.ROWID));
    setWarehouseQuery(def === null ? '' : def.name);
    setWarehouseOpen(false);
  };

  const openWarehouseAdjust = (r: WarehouseStockRow) => {
    const p = products.find((x) => String(x.ROWID) === String(r.product_id)) ?? null;
    setTarget(p);
    setTargetRow(r);
    setDelta('');
    setReason('');
  };

  const submit = () => {
    if ((target === null && targetRow === null) || delta.trim() === '') return;
    if (target === null && targetRow === null) return;
    if (reason.trim() === '') return;
    if (targetRow === null && target !== null && warehouses.length > 0 && adjustWarehouseId === '') return;
    setBusy(true);
    const adjReason = reason.trim().slice(0, 200);
    const done = (msg: string) => {
      setNotice(msg);
      setTarget(null);
      setTargetRow(null);
      setDelta('');
      setReason('');
      setBusy(false);
      load();
    };
    const fail = (e: unknown) => {
      setNotice('');
      setError(e instanceof Error ? e.message : 'Adjustment failed');
      setTarget(null);
      setTargetRow(null);
      setBusy(false);
    };
    if (targetRow !== null) {
      // Warehouse-scoped adjustment (INV-01/08 enforced server-side).
      adjustWarehouseStock({
        warehouse_id: targetRow.warehouse_id,
        product_id: targetRow.product_id,
        quantity: Number(delta),
        reason: adjReason,
      })
        .then((res) => done(`${targetRow.product_name} @ ${targetRow.warehouse_name}: ${res.old_stock ?? '?'} → ${res.new_stock ?? '?'} units.`))
        .catch(fail);
    } else if (target !== null && adjustWarehouseId !== '') {
      // Aggregate view with an explicitly chosen warehouse: same
      // warehouse-scoped endpoint, so Catalyst updates that warehouse (and
      // the Products.stock aggregate) — never silently the default.
      const wh = warehouses.find((w) => String(w.ROWID) === adjustWarehouseId);
      adjustWarehouseStock({
        warehouse_id: adjustWarehouseId,
        product_id: String(target.ROWID ?? target.sku),
        quantity: Number(delta),
        reason: adjReason,
      })
        .then((res) => done(`${target.name} @ ${wh?.name ?? adjustWarehouseId}: ${res.old_stock ?? '?'} → ${res.new_stock ?? '?'} units.`))
        .catch(fail);
    } else if (target !== null) {
      adjustStock(String(target.ROWID ?? target.sku), Number(delta), adjReason)
        .then((res) => done(`${target.name}: ${res.old_stock ?? '?'} → ${res.new_stock ?? '?'} units.`))
        .catch(fail);
    }
  };

  if (loading) return <Loader message="Loading inventory…" skeleton="page" />;
  if (error !== '' && products.length === 0) return <ErrorState message={error} onRetry={load} />;

  const perWarehouse = warehouseId !== 'all' || warehouses.length > 0;
  const showWarehouseView = warehouseId !== 'all';
  // Single-field warehouse picker (Google-search style): typing filters,
  // clicking an option selects. Any keystroke clears the previous pick so
  // Apply only fires on an explicitly clicked warehouse.
  const pickAdjustWarehouse = (id: string, name: string) => {
    setAdjustWarehouseId(id);
    setWarehouseQuery(name);
    setWarehouseOpen(false);
  };
  const adjustWarehouseName = targetRow !== null
    ? targetRow.warehouse_name
    : (warehouses.find((w) => String(w.ROWID) === adjustWarehouseId)?.name ?? '');
  const adjustWarehouseQty = target === null || targetRow !== null ? null : (() => {
    const row = stockRows.find((r) => String(r.product_id) === String(target.ROWID) && String(r.warehouse_id) === adjustWarehouseId);
    return row === undefined ? null : Number(row.quantity);
  })();
  const adjustTitle = targetRow !== null
    ? `Adjust — ${targetRow.product_name} @ ${targetRow.warehouse_name}`
    : target === null ? 'Adjust stock' : `Adjust — ${target.name}${adjustWarehouseName !== '' ? ` @ ${adjustWarehouseName}` : ''}`;
  const adjustSubtitle = targetRow !== null
    ? `Current: ${number(targetRow.quantity)} units`
    : target === null ? undefined : adjustWarehouseQty === null
      ? `Total: ${number(target.stock)} units`
      : `Current @ ${adjustWarehouseName}: ${number(adjustWarehouseQty)} units (total ${number(target.stock)})`;
  const adjustReady = !busy && delta.trim() !== '' && reason.trim() !== '' && (targetRow !== null || target === null || warehouses.length === 0 || adjustWarehouseId !== '');

  return (
    <div>
      <div className="ch-page-head"><PageIcon />
        <div>
          <h1 className="ch-page-title">Inventory</h1>
          <p className="ch-page-sub">Stock levels, valuations and adjustments.</p>
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      <div className="ch-grid-stats cols-3">
        <StatCard label="Stock value" value={currency(visibleCounts.value)} icon={boxesIcon} />
        <StatCard label="Low stock" value={number(visibleCounts.low)} delta={visibleCounts.low > 0 ? 'Reorder soon' : 'All healthy'} deltaTone={visibleCounts.low > 0 ? 'down' : 'up'} icon={alertIcon} iconBg="#fef3e2" iconColor="#d97706" />
        <StatCard label="Out of stock" value={number(visibleCounts.out + visibleCounts.backordered)} icon={checkIcon} iconBg={visibleCounts.out + visibleCounts.backordered > 0 ? 'var(--ch-danger-bg)' : 'var(--ch-success-bg)'} iconColor={visibleCounts.out + visibleCounts.backordered > 0 ? 'var(--ch-danger)' : 'var(--ch-success)'} />
      </div>

      <Card title="Inventory">
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search SKU or name…" ariaLabel="Search inventory" />
          <FilterBar
            filters={[
              {
                key: 'f', value: filter, ariaLabel: 'Filter by availability', onChange: (v) => setFilter((parseAvailability(v) ?? 'all') as Availability),
                options: [
                  { value: 'all', label: `All (${warehouseId === 'all' ? products.length : warehouseScopeCounts.total})` },
                  { value: 'ok', label: `Healthy (${warehouseId === 'all' ? counts.ok : warehouseScopeCounts.ok})` },
                  { value: 'low', label: `Low stock (${warehouseId === 'all' ? counts.low : warehouseScopeCounts.low})` },
                  { value: 'out', label: `Out of stock (${warehouseId === 'all' ? counts.out : warehouseScopeCounts.out})` },
                  ...((warehouseId === 'all' ? counts.backordered : warehouseScopeCounts.backordered) > 0 ? [{ value: 'backordered', label: `Backordered (${warehouseId === 'all' ? counts.backordered : warehouseScopeCounts.backordered})` }] : []),
                ],
              },
              ...(perWarehouse ? [{
                key: 'w',
                value: warehouseId,
                ariaLabel: 'Filter by warehouse',
                onChange: setWarehouseId,
                options: [
                  { value: 'all', label: 'All warehouses' },
                  ...warehouses.map((w) => ({ value: String(w.ROWID), label: w.is_default === true ? `${w.name} (Default)` : w.name })),
                ],
              }] : []),
            ]}
            onReset={() => { setSearch(''); setFilter('all'); setWarehouseId('all'); }}
          />
        </div>
        {showWarehouseView ? (
          warehouseFiltered.length === 0 ? (
            <EmptyState title="Nothing to show" message="No items in this warehouse match the filter." icon={<AlertTriangle size={24} />} />
          ) : (
            <Table
              columns={[
                { key: 'p', header: 'Product', render: (r: WarehouseStockRow) => <span><span className="ch-cell-main">{r.product_name}</span><br /><span className="ch-cell-sub">{r.sku} · {r.category}</span></span> },
                { key: 'w', header: 'Warehouse', render: (r: WarehouseStockRow) => <span><span className="ch-cell-main">{r.warehouse_name}</span><br /><span className="ch-cell-sub">{r.warehouse_code}</span></span> },
                { key: 's', header: 'Quantity', numeric: true, render: (r: WarehouseStockRow) => <strong>{number(r.quantity)}</strong> },
                { key: 'r', header: 'Reorder level', numeric: true, render: (r: WarehouseStockRow) => number(r.reorder_level) },
                { key: 'v', header: 'Stock value', numeric: true, render: (r: WarehouseStockRow) => currency(r.stock_value) },
                { key: 'st', header: 'Status', render: (r: WarehouseStockRow) => <StatusBadge status={r.status} /> },
                {
                  key: 'a', header: 'Adjust', render: (r: WarehouseStockRow) => (
                    <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => openWarehouseAdjust(r)}>Adjust</button>
                  ),
                },
              ]}
              rows={warehouseFiltered}
              rowKey={(r, i) => `${String(r.warehouse_id)}-${String(r.product_id)}-${i}`}
            />
          )
        ) : filtered.length === 0 ? (
          <EmptyState title="Nothing to show" message="No items match this inventory filter." icon={<AlertTriangle size={24} />} />
        ) : (
          <Table
            columns={[
              { key: 'p', header: 'Product', render: (p: Product) => <span><span className="ch-cell-main">{p.name}</span><br /><span className="ch-cell-sub">{p.sku} · {p.category}</span></span> },
              ...(warehouses.length > 1 ? [{
                key: 'w',
                header: 'Warehouses',
                render: (p: Product) => {
                  const rows = stockRows.filter((r) => String(r.product_id) === String(p.ROWID));
                  if (rows.length === 0) {
                    const def = warehouses.find((w) => w.is_default === true) ?? warehouseById.get('all');
                    return <span className="ch-cell-sub">{def ? def.name : '—'}</span>;
                  }
                  return (
                    <span className="ch-cell-sub">
                      {rows.map((r) => `${r.warehouse_code || r.warehouse_name}: ${number(r.quantity)}`).join(' · ')}
                    </span>
                  );
                },
              }] : []),
              { key: 's', header: 'Stock', numeric: true, render: (p: Product) => <strong>{number(p.stock)}</strong> },
              { key: 'v', header: 'Value', numeric: true, render: (p: Product) => currency(Number(p.rate || 0) * Number(p.stock || 0)) },
              { key: 'st', header: 'Status', render: (p: Product) => <StatusBadge status={statusOf(p)} /> },
              {
                key: 'a', header: 'Adjust', render: (p: Product) => (
                  <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => openAdjust(p)}>Adjust</button>
                ),
              },
            ]}
            rows={filtered}
            rowKey={(p, i) => `${String(p.ROWID ?? p.sku)}-${i}`}
          />
        )}
      </Card>

      <Modal
        open={target !== null || targetRow !== null}
        title={adjustTitle}
        subtitle={adjustSubtitle}
        onClose={() => { setTarget(null); setTargetRow(null); }}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => { setTarget(null); setTargetRow(null); }} disabled={busy}>Cancel</button>
            <button type="button" className="ch-btn ch-btn-primary" onClick={submit} disabled={!adjustReady}>{busy ? 'Saving…' : 'Apply'}</button>
          </>
        }
      >
        {targetRow === null && target !== null && warehouses.length > 0 && (
          <div className="ch-field" style={{ marginBottom: 12 }}>
            <label className="ch-label" htmlFor="inv-warehouse-search">Warehouse (adjustment target)</label>
            <div style={{ position: 'relative', display: 'flex', flexDirection: 'column' }}>
            <input
              id="inv-warehouse-search"
              className="ch-input"
              value={warehouseQuery}
              onChange={(e) => { setWarehouseQuery(e.target.value); setAdjustWarehouseId(''); setWarehouseOpen(true); }}
              onFocus={() => setWarehouseOpen(true)}
              onBlur={() => setWarehouseOpen(false)}
              placeholder="Type to search warehouses…"
              autoComplete="off"
            />
            {warehouseOpen && adjustWarehouseOptions.length > 0 && (
              <div
                role="listbox"
                aria-label="Matching warehouses"
                style={{
                  position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%',
                  background: 'var(--ch-card-bg, #fff)', border: '1px solid var(--ch-border-soft, #e2e8f0)',
                  borderRadius: 10, marginTop: 0, maxHeight: 180, overflowY: 'auto',
                  boxShadow: '0 12px 32px rgba(15,27,51,.14)',
                }}
              >
                {adjustWarehouseOptions.map((w) => (
                  <div
                    key={String(w.ROWID)}
                    role="option"
                    aria-selected={String(w.ROWID) === adjustWarehouseId}
                    onMouseDown={(e) => { e.preventDefault(); pickAdjustWarehouse(String(w.ROWID), w.name); }}
                    style={{
                      padding: '9px 12px', cursor: 'pointer', fontSize: 13,
                      background: String(w.ROWID) === adjustWarehouseId ? 'var(--ch-primary-bg, #eef4ff)' : 'transparent',
                    }}
                  >
                    <strong>{w.name}</strong>
                    <span className="ch-cell-sub"> · {w.code}{w.is_default === true ? ' · Default' : ''}</span>
                  </div>
                ))}
              </div>
            )}
            </div>
            {warehouseOpen && warehouseQuery.trim() !== '' && adjustWarehouseOptions.length === 0 && (
              <span className="ch-hint">No warehouse matches “{warehouseQuery.trim()}”.</span>
            )}
            <span className="ch-hint">Stock changes in the selected warehouse on Catalyst; the product total re-sums automatically.</span>
          </div>
        )}
        <div className="ch-field">
          <label className="ch-label" htmlFor="inv-delta">Quantity change</label>
          <input id="inv-delta" className="ch-input" type="number" step="1" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 20 or -4" />
          <span className="ch-hint">Positive adds stock (delivery), negative removes (sale, wastage, damage).</span>
        </div>
        <div className="ch-field">
          <label className="ch-label" htmlFor="inv-reason">Reason (required)</label>
          <input id="inv-reason" className="ch-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Delivery, recount, wastage…" maxLength={200} />
          <span className="ch-hint">Recorded in the stock-movement audit trail.</span>
        </div>
      </Modal>
    </div>
  );
}
