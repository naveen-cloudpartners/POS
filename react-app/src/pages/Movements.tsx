import PageIcon from '../components/ui/PageIcon';
import { useEffect, useMemo, useState } from 'react';
import { Download, ArrowLeftRight } from 'lucide-react';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import SearchBar from '../components/ui/SearchBar';
import FilterBar from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { getStockMovements, getWarehouses, type StockMovement } from '../services/inventoryService';
import { formatDate, number } from '../utils/format';
import type { Warehouse } from '../types';
import './Inventory.css';

function toCsv(rows: Array<Array<string | number>>): string {
  return rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

function download(name: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Movements() {
  const [rows, setRows] = useState<Array<StockMovement>>([]);
  const [types, setTypes] = useState<Array<string>>([]);
  const [summary, setSummary] = useState({ movements: 0, units_in: 0, units_out: 0 });
  const [warehouses, setWarehouses] = useState<Array<Warehouse>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [warehouse, setWarehouse] = useState('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      getStockMovements({
        search: search.trim(),
        type,
        warehouse,
        date_from: dateFrom,
        date_to: dateTo,
      }),
      getWarehouses().catch(() => [] as Array<Warehouse>),
    ])
      .then(([ledger, wh]) => {
        setRows(ledger.rows);
        setTypes(ledger.types);
        setSummary(ledger.summary);
        setWarehouses(wh);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load movements'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (!loading) load();
    }, search.trim() === '' ? 0 : 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, type, warehouse, dateFrom, dateTo]);

  const exportCsv = () => {
    download(
      `stock-movements-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv([
        ['Date', 'Product', 'SKU', 'Type', 'Change', 'Before', 'After', 'Reference', 'Reason', 'Actor'],
        ...rows.map((m) => [
          String(m.created_at ?? ''),
          m.item_name,
          m.sku,
          m.movement_type,
          m.quantity_change,
          m.stock_before,
          m.stock_after,
          `${m.reference_type} ${m.reference_id}`.trim(),
          m.reason,
          m.performed_by,
        ]),
      ]),
    );
  };

  const whName = useMemo(() => {
    const map = new Map(warehouses.map((w) => [String(w.ROWID), w.name]));
    return (id: string): string => (id !== '' ? (map.get(id) ?? id) : '—');
  }, [warehouses]);

  if (loading && rows.length === 0) return <Loader message="Loading movements…" skeleton="page" />;
  if (error !== '' && rows.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <div className="ch-page-head"><PageIcon />
        <div>
          <h1 className="ch-page-title">Stock Movements</h1>
          <p className="ch-page-sub">Every stock-affecting event — sales, adjustments, transfers, returns.</p>
        </div>
        <div className="ch-page-actions">
          <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={exportCsv}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      <div className="ch-grid-stats cols-3">
        <StatCard label="Movements" value={number(summary.movements)} icon={<ArrowLeftRight size={20} />} />
        <StatCard label="Units in" value={number(summary.units_in)} icon={<ArrowLeftRight size={20} />} iconBg="#e3f6ec" iconColor="#287c52" />
        <StatCard label="Units out" value={number(summary.units_out)} icon={<ArrowLeftRight size={20} />} iconBg="#fef1e1" iconColor="#b45309" />
      </div>

      <Card title="Stock movements">
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search product, reason, actor…" ariaLabel="Search movements" />
          <FilterBar
            filters={[
              {
                key: 't', value: type, ariaLabel: 'Filter by movement type', onChange: setType,
                options: [{ value: 'all', label: 'All types' }, ...types.map((t) => ({ value: t, label: t }))],
              },
              {
                key: 'w', value: warehouse, ariaLabel: 'Filter by warehouse', onChange: setWarehouse,
                options: [{ value: 'all', label: 'All warehouses' }, ...warehouses.map((w) => ({ value: String(w.ROWID), label: w.name }))],
              },
            ]}
            onReset={() => { setSearch(''); setType('all'); setWarehouse('all'); setDateFrom(''); setDateTo(''); }}
          />
          <span className="orders-dates">
            <input type="date" className="ch-input" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            <input type="date" className="ch-input" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </span>
        </div>
        {loading && <p className="ch-hint">Refreshing…</p>}
        {rows.length === 0 ? (
          <EmptyState title="No movements" message="Sales, adjustments, transfers and returns are recorded here automatically." icon={<ArrowLeftRight size={24} />} />
        ) : (
          <Table
            columns={[
              { key: 'd', header: 'Date', render: (m: StockMovement) => <span className="ch-cell-sub">{m.created_at ? formatDate(m.created_at) : '—'}</span> },
              {
                key: 'p', header: 'Product', render: (m: StockMovement) => (
                  <span><span className="ch-cell-main">{m.item_name || m.sku || '—'}</span><br /><span className="ch-cell-sub">{m.sku}</span></span>
                ),
              },
              { key: 't', header: 'Type', render: (m: StockMovement) => <StatusBadge status={m.movement_type.replace(/_/g, ' ')} /> },
              {
                key: 'q', header: 'Change', numeric: true, render: (m: StockMovement) => (
                  <b>{m.quantity_change > 0 ? `+${number(m.quantity_change)}` : number(m.quantity_change)}</b>
                ),
              },
              { key: 's', header: 'Stock', numeric: true, render: (m: StockMovement) => <span className="ch-cell-sub">{number(m.stock_before)} → {number(m.stock_after)}</span> },
              { key: 'w', header: 'Warehouse', render: (m: StockMovement) => <span className="ch-cell-sub">{whName(m.warehouse_id || m.from_warehouse_id)}</span> },
              { key: 'r', header: 'Reference', render: (m: StockMovement) => <span className="ch-cell-sub">{`${m.reference_type} ${m.reference_id}`.trim() || '—'}</span> },
              { key: 'n', header: 'Reason', render: (m: StockMovement) => <span className="ch-cell-sub">{m.reason || '—'}</span> },
            ]}
            rows={rows}
            rowKey={(m, i) => `${String(m.ROWID ?? i)}-${i}`}
          />
        )}
      </Card>
    </div>
  );
}
