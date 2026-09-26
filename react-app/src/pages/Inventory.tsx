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
  const [busy, setBusy] = useState(false);

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
  };

  const openWarehouseAdjust = (r: WarehouseStockRow) => {
    const p = products.find((x) => String(x.ROWID) === String(r.product_id)) ?? null;
    setTarget(p);
    setTargetRow(r);
    setDelta('');
  };

  const submit = () => {
    if ((target === null && targetRow === null) || delta.trim() === '') return;
    setBusy(true);
    const reason = 'Manual adjustment from Inventory page';
    const done = (msg: string) => {
      setNotice(msg);
      setTarget(null);
      setTargetRow(null);
      setDelta('');
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
        reason,
      })
        .then((res) => done(`${targetRow.product_name} @ ${targetRow.warehouse_name}: ${res.old_stock ?? '?'} → ${res.new_stock ?? '?'} units.`))
        .catch(fail);
    } else if (target !== null) {
      adjustStock(String(target.ROWID ?? target.sku), Number(delta), reason)
        .then((res) => done(`${target.name}: ${res.old_stock ?? '?'} → ${res.new_stock ?? '?'} units.`))
        .catch(fail);
    }
  };

  if (loading) return <Loader message="Loading inventory…" skeleton="page" />;
  if (error !== '' && products.length === 0) return <ErrorState message={error} onRetry={load} />;

  const perWarehouse = warehouseId !== 'all' || warehouses.length > 0;
  const showWarehouseView = warehouseId !== 'all';
  const adjustTitle = targetRow !== null
    ? `Adjust — ${targetRow.product_name} @ ${targetRow.warehouse_name}`
    : target === null ? 'Adjust stock' : `Adjust — ${target.name}`;
  const adjustSubtitle = targetRow !== null
    ? `Current: ${number(targetRow.quantity)} units`
    : target === null ? undefined : `Current: ${number(target.stock)} units`;

  return (
    <div>
      <div className="ch-page-head">
        <div>
          <h1 className="ch-page-title">Inventory</h1>
          <p className="ch-page-sub">Stock levels, valuations and adjustments.</p>
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      <div className="ch-grid-stats cols-3">
        <StatCard label="Stock value" value={currency(counts.value)} icon={boxesIcon} />
        <StatCard label="Low stock" value={number(counts.low)} delta={counts.low > 0 ? 'Reorder soon' : 'All healthy'} deltaTone={counts.low > 0 ? 'down' : 'up'} icon={alertIcon} iconBg="#fef3e2" iconColor="#d97706" />
        <StatCard label="Out of stock" value={number(counts.out + counts.backordered)} icon={checkIcon} iconBg={counts.out + counts.backordered > 0 ? 'var(--ch-danger-bg)' : 'var(--ch-success-bg)'} iconColor={counts.out + counts.backordered > 0 ? 'var(--ch-danger)' : 'var(--ch-success)'} />
      </div>

      <Card>
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search SKU or name…" ariaLabel="Search inventory" />
          <FilterBar
            filters={[
              {
                key: 'f', value: filter, ariaLabel: 'Filter by availability', onChange: (v) => setFilter((parseAvailability(v) ?? 'all') as Availability),
                options: [
                  { value: 'all', label: `All (${products.length})` },
                  { value: 'ok', label: `Healthy (${counts.ok})` },
                  { value: 'low', label: `Low stock (${counts.low})` },
                  { value: 'out', label: `Out of stock (${counts.out})` },
                  ...(counts.backordered > 0 ? [{ value: 'backordered', label: `Backordered (${counts.backordered})` }] : []),
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
            <button type="button" className="ch-btn ch-btn-primary" onClick={submit} disabled={busy || delta.trim() === ''}>{busy ? 'Saving…' : 'Apply'}</button>
          </>
        }
      >
        <div className="ch-field">
          <label className="ch-label" htmlFor="inv-delta">Quantity change</label>
          <input id="inv-delta" className="ch-input" type="number" step="1" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 20 or -4" />
          <span className="ch-hint">Positive adds stock (delivery), negative removes (sale, wastage, damage).</span>
        </div>
      </Modal>
    </div>
  );
}
