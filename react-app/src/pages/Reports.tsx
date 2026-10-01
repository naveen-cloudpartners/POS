import PageIcon from '../components/ui/PageIcon';
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Download, FileText, RefreshCw, TrendingUp, TrendingDown, Wallet, ReceiptText, Package, Users } from 'lucide-react';
import Card from '../components/ui/Card';
import StatCard from '../components/ui/StatCard';
import Table from '../components/ui/Table';
import FilterBar from '../components/ui/FilterBar';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import { useAuth } from '../context/AuthContext';
import { getOrders } from '../services/orderService';
import { getProducts } from '../services/productService';
import { getCustomers } from '../services/customerService';
import { getTransfers, getWarehouseStock, getWarehouses } from '../services/inventoryService';
import { getUsers } from '../services/userService';
import { getSettings } from '../services/settingsService';
import {
  REPORT_PERIOD_OPTIONS,
  exportReportCsv,
  exportReportPdf,
  getCustomerReport,
  getProductReport,
  getProfitReport,
  getRegisterReport,
  getRevenueReport,
  type CustomerReport,
  type ExportType,
  type ProductReport,
  type ProfitReport,
  type RegisterReport,
  type ReportFilters,
  type ReportPeriod,
  type RevenueReport,
} from '../services/reportService';
import { currency, formatDay, number } from '../utils/format';
import type { Customer, Order, PosUser, Product, StockTransfer, Warehouse, WarehouseStockRow } from '../types';
import './Reports.css';

const REPORT_SECTION_IDS: Array<string> = [
  'revenue',
  'inventory',
  'customers',
  'profit',
  'register',
];

/* Sub-section anchors fold into their parent tab so old bookmarks keep
   working (e.g. /reports#channels opens the Revenue tab, then the
   MainLayout anchor scroller smooth-scrolls to the card). */
const REPORT_HASH_TO_SECTION: Record<string, string> = {
  revenue: 'revenue',
  channels: 'revenue',
  'revenue-week': 'revenue',
  'revenue-month': 'revenue',
  filters: 'revenue',
  inventory: 'inventory',
  performance: 'inventory',
  warehouse: 'inventory',
  customers: 'customers',
  loyalty: 'customers',
  profit: 'profit',
  register: 'register',
  'order-status': 'register',
  cashiers: 'register',
  voids: 'register',
};



function ExportActions({ type, filters, compact }: { type: ExportType; filters: ReportFilters; compact?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const run = (kind: 'csv' | 'pdf') => {
    setBusy(kind);
    setError('');
    const fn = kind === 'csv' ? exportReportCsv : exportReportPdf;
    fn(type, filters)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Export failed'))
      .finally(() => setBusy(null));
  };
  return (
    <span className="ch-row" style={{ gap: 6 }} title={error !== '' ? error : undefined}>
      <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" disabled={busy !== null} onClick={() => run('csv')}>
        <Download size={13} /> {busy === 'csv' ? '…' : compact === true ? 'CSV' : 'Export CSV'}
      </button>
      <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" disabled={busy !== null} onClick={() => run('pdf')}>
        <FileText size={13} /> {busy === 'pdf' ? '…' : compact === true ? 'PDF' : 'Export PDF'}
      </button>
      {error !== '' && <span className="ch-form-error" style={{ margin: 0 }}>{error}</span>}
    </span>
  );
}

export default function Reports() {
  const { role, email } = useAuth();
  const [orders, setOrders] = useState<Array<Order>>([]);
  const [products, setProducts] = useState<Array<Product>>([]);
  const [customers, setCustomers] = useState<Array<Customer>>([]);
  const [customerCount, setCustomerCount] = useState(0);
  const [warehouses, setWarehouses] = useState<Array<Warehouse>>([]);
  const [whRows, setWhRows] = useState<Array<WarehouseStockRow>>([]);
  const [transfers, setTransfers] = useState<Array<StockTransfer>>([]);
  const [users, setUsers] = useState<Array<PosUser>>([]);
  const [loading, setLoading] = useState(true);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // ---- Global report filters (RPT-01): every card recalculates from these.
  const [period, setPeriod] = useState<ReportPeriod>('month');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customer, setCustomer] = useState('');
  const [cashier, setCashier] = useState('');
  const [warehouse, setWarehouse] = useState('all');
  const [category, setCategory] = useState('');
  const [payment, setPayment] = useState('all');
  const [status, setStatus] = useState('all');

  const [revenue, setRevenue] = useState<RevenueReport | null>(null);
  const [perf, setPerf] = useState<ProductReport | null>(null);
  const [custRep, setCustRep] = useState<CustomerReport | null>(null);
  const [profitRep, setProfitRep] = useState<ProfitReport | null>(null);
  const [registerRep, setRegisterRep] = useState<RegisterReport | null>(null);

  const effectiveRole = role;
  const isFrontline = ['Cashier', 'Waiter', 'Chef'].includes(effectiveRole);
  const isStorekeeper = effectiveRole === 'Storekeeper';
  const canViewProfit = ['Admin', 'Manager'].includes(effectiveRole);

  // Settings-style hash tab navigation: one section visible at a time.
  // Matches the sidebar links (/reports#revenue … #register) and keeps
  // bookmark scrolling working via MainLayout's anchor scroller.
  const { hash } = useLocation();
  const hashId = hash.startsWith('#') ? hash.slice(1) : '';
  const requestedSection = REPORT_HASH_TO_SECTION[hashId] ?? (REPORT_SECTION_IDS.includes(hashId) ? hashId : '');
  // Storekeepers only get inventory; everyone else defaults to revenue.
  const activeSection = isStorekeeper ? 'inventory' : (requestedSection !== '' ? requestedSection : 'revenue');

  const filters: ReportFilters = useMemo(() => ({
    period,
    date_from: period === 'custom' ? dateFrom : '',
    date_to: period === 'custom' ? dateTo : '',
    customer: customer.trim(),
    cashier: isFrontline ? email : cashier.trim(),
    warehouse: warehouse === 'all' ? '' : warehouse,
    category: category.trim(),
    payment: payment === 'all' ? '' : payment,
    status: status === 'all' ? '' : status,
  }), [period, dateFrom, dateTo, customer, email, isFrontline, cashier, warehouse, category, payment, status]);

  const loadDirectory = () => {
    setLoading(true);
    setError('');
    Promise.all([
      getProducts(),
      getCustomers().catch(() => []),
      getWarehouses().catch(() => [] as Array<Warehouse>),
      getWarehouseStock().catch(() => [] as Array<WarehouseStockRow>),
      getTransfers().catch(() => [] as Array<StockTransfer>),
      getUsers().catch(() => [] as Array<PosUser>),
      getSettings().catch(() => ({})),
    ])
      .then(([p, c, w, rows, t, u, s]) => {
        setProducts(p);
        setCustomers(c);
        setCustomerCount(c.length);
        setWarehouses(w);
        setWhRows(rows);
        setTransfers(t);
        setUsers(u);
        const def = String((s as { report_default_range?: unknown }).report_default_range ?? '');
        if ((REPORT_PERIOD_OPTIONS as Array<{ value: string }>).some((o) => o.value === def)) {
          setPeriod(def as ReportPeriod);
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load reports'))
      .finally(() => setLoading(false));
  };

  // Fetch-light: only the visible tab's endpoints fire (other tabs keep
  // their last-loaded data — same mount, just hidden). The 200-row order
  // slice feeds legacy fallbacks + filter presets where those tabs need it.
  const loadReports = (tab: string) => {
    setReportsLoading(true);
    // Filtered order slice keeps every client-side section in sync too.
    const orderParams = {
      status: filters.status,
      customer: filters.customer,
      cashier: filters.cashier,
      date_from: filters.date_from || (filters.period === 'custom' ? '' : undefined),
      date_to: filters.date_to || undefined,
      payment: filters.payment,
      limit: 200,
    };
    const rangeParams: ReportFilters = { ...filters };
    if (filters.period !== 'custom') {
      delete rangeParams.date_from;
      delete rangeParams.date_to;
    }
    // Custom dates without an explicit range still bound the order slice.
    const orderRange = filters.period === 'custom'
      ? { date_from: filters.date_from, date_to: filters.date_to }
      : {};
    const wantOrders = tab === 'revenue' || tab === 'register' || tab === 'customers';
    Promise.all([
      wantOrders ? getOrders({ ...orderParams, ...orderRange }).catch(() => [] as Array<Order>) : Promise.resolve(null),
      tab === 'revenue' ? getRevenueReport(rangeParams) : Promise.resolve(null),
      tab === 'inventory' ? getProductReport(rangeParams) : Promise.resolve(null),
      (tab === 'customers' && !isStorekeeper) ? getCustomerReport(rangeParams) : Promise.resolve(null),
      (tab === 'profit' && canViewProfit) ? getProfitReport(rangeParams) : Promise.resolve(null),
      (tab === 'register' && !isStorekeeper) ? getRegisterReport(rangeParams) : Promise.resolve(null),
    ])
      .then(([o, rev, pr, cr, pf, rg]) => {
        if (o !== null) setOrders(o);
        if (rev !== null) setRevenue(rev);
        if (pr !== null) setPerf(pr);
        if (cr !== null) setCustRep(cr);
        if (pf !== null) setProfitRep(pf);
        if (rg !== null) setRegisterRep(rg);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load reports'))
      .finally(() => setReportsLoading(false));
  };

  useEffect(loadDirectory, []);
  // Debounced recalculation (text filters type-ahead server-side).
  // activeSection is a dep so switching tabs fetches just that tab.
  useEffect(() => {
    const t = window.setTimeout(() => loadReports(activeSection), customer.trim() === '' && category.trim() === '' ? 0 : 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateFrom, dateTo, customer, cashier, warehouse, category, payment, status, email, activeSection]);

  /* ---- Legacy client memos (fallback when a server report is unavailable) ---- */
  const legacyRevenue = useMemo(() => orders.reduce((s, o) => s + (Number(o.total) || 0), 0), [orders]);
  const legacyAvg = orders.length === 0 ? 0 : legacyRevenue / orders.length;

  const byDay = useMemo(() => {
    const map = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
      const day = String(o.CREATEDTIME ?? '').slice(0, 10) || 'Unknown';
      const cur = map.get(day) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += Number(o.total) || 0;
      map.set(day, cur);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .slice(0, 14);
  }, [orders]);

  const byPayment = useMemo(() => {
    const map = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
      const key = o.payment_mode ?? 'Unknown';
      const cur = map.get(key) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += Number(o.total) || 0;
      map.set(key, cur);
    }
    return Array.from(map.entries());
  }, [orders]);

  const topCustomers = useMemo(() => {
    const map = new Map<string, { orders: number; revenue: number; last: string }>();
    for (const o of orders) {
      const key = (o.customer_name ?? '').trim() === '' ? 'Walk-in' : (o.customer_name as string).trim();
      const cur = map.get(key) ?? { orders: 0, revenue: 0, last: '' };
      cur.orders += 1;
      cur.revenue += Number(o.total) || 0;
      const d = String(o.CREATEDTIME ?? '');
      if (d !== '' && d > cur.last) cur.last = d;
      map.set(key, cur);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);
  }, [orders]);

  const orderReports = useMemo(() => {
    const byStatus = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
      const key = String(o.status ?? 'Pending').trim() === '' ? 'Pending' : String(o.status);
      const cur = byStatus.get(key) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += Number(o.total) || 0;
      byStatus.set(key, cur);
    }
    const cashierOf = (o: Order): string =>
      String(o.cashier_name ?? '').trim() !== ''
        ? String(o.cashier_name)
        : String(o.created_by ?? '').trim() !== ''
          ? String(o.created_by)
          : 'Unattributed';
    const byCashier = new Map<string, { orders: number; revenue: number }>();
    for (const o of orders) {
      const key = cashierOf(o);
      const cur = byCashier.get(key) ?? { orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += Number(o.total) || 0;
      byCashier.set(key, cur);
    }
    const voided = orders.filter((o) => ['voided', 'cancelled'].includes(String(o.status ?? '').toLowerCase()));
    const refunded = orders.filter((o) => String(o.status ?? '').toLowerCase() === 'refunded');
    return {
      byStatus: [...byStatus.entries()].map(([st, v]) => ({ status: st, ...v })).sort((a, b) => b.orders - a.orders),
      topCashiers: [...byCashier.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      voidedCount: voided.length,
      voidedValue: voided.reduce((s, o) => s + (Number(o.total) || 0), 0),
      refundedCount: refunded.length,
      refundedValue: refunded.reduce((s, o) => s + (Number(o.total) || 0), 0),
    };
  }, [orders]);

  const inventoryRows = useMemo(() => [...products].sort((a, b) => Number(b.stock) - Number(a.stock)).slice(0, 10), [products]);

  const warehouseValuation = useMemo(() => {
    const list = warehouse === 'all' ? warehouses : warehouses.filter((w) => String(w.ROWID) === warehouse);
    return list.map((w) => {
      const mine = whRows.filter((r) => String(r.warehouse_id) === String(w.ROWID));
      return {
        id: String(w.ROWID ?? w.code),
        name: w.name,
        code: w.code,
        skus: mine.length,
        units: mine.reduce((s, r) => s + Number(r.quantity || 0), 0),
        value: mine.reduce((s, r) => s + Number(r.stock_value || 0), 0),
        low: mine.filter((r) => r.status === 'Low stock' || r.status === 'Out of stock' || r.status === 'Backordered').length,
      };
    });
  }, [warehouses, whRows, warehouse]);

  const transferStats = useMemo(() => {
    const completed = transfers.filter((t) => String(t.status) === 'Completed');
    const units = completed.reduce((s, t) => s + (t.items ?? []).reduce((x, i) => x + Number(i.quantity || 0), 0), 0);
    return { total: transfers.length, completed: completed.length, units };
  }, [transfers]);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => String(p.category ?? '').trim()).filter(Boolean));
    return [...set].sort();
  }, [products]);

  const paymentOptions = useMemo(() => {
    const set = new Set(orders.map((o) => String(o.payment_mode ?? '').trim()).filter(Boolean));
    return [...set].sort();
  }, [orders]);

  /* ---- Resolved display values: server first, legacy fallback ---- */
  const rev = revenue;
  const dispRevenue = rev?.revenue ?? legacyRevenue;
  const dispOrders = rev?.order_count ?? orders.length;
  const dispAov = rev?.average_order_value ?? legacyAvg;
  const growth = rev?.growth_percentage ?? 0;
  const growthBase = rev ? `vs prior ${rev.range.label}` : 'vs prior period';
  const dayEntries: Array<{ day: string; orders: number; revenue: number }> = rev
    ? [...rev.revenue_by_day].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(-14)
    : byDay.slice().reverse().map(([day, v]) => ({ day, orders: v.orders, revenue: v.revenue }));
  const payEntries: Array<{ method: string; orders: number; revenue: number }> = rev
    ? rev.revenue_by_payment_method.map((p) => ({ method: p.method, orders: p.orders, revenue: p.revenue }))
    : byPayment.map(([method, v]) => ({ method, orders: v.orders, revenue: v.revenue }));
  const maxDay = Math.max(1, ...dayEntries.map((d) => d.revenue));
  const payTotal = Math.max(1, ...payEntries.map((p) => p.revenue));
  const spark = dayEntries.map((d) => d.revenue);
  const rangeLabel = rev?.range.label ?? (period === 'custom' ? `${dateFrom} → ${dateTo}` : REPORT_PERIOD_OPTIONS.find((o) => o.value === period)?.label ?? '');

  const resetFilters = () => {
    setPeriod('month');
    setDateFrom('');
    setDateTo('');
    setCustomer('');
    if (!isFrontline) setCashier('');
    setWarehouse('all');
    setCategory('');
    setPayment('all');
    setStatus('all');
  };

  if (loading) return <Loader message="Loading reports…" skeleton="page" />;
  if (error !== '' && orders.length === 0 && products.length === 0) return <ErrorState message={error} onRetry={() => { loadDirectory(); loadReports(activeSection); }} />;

  return (
    <div className="reports-page">
      <div className="ch-page-head reveal"><PageIcon />
        <div>
          <h1 className="ch-page-title">Reports</h1>
          <p className="ch-page-sub">Sales, growth and inventory analytics · {rangeLabel}.</p>
        </div>
        <div className="ch-page-actions">
          <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => { loadDirectory(); loadReports(activeSection); setNotice('Reports refreshed.'); }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}
      {isFrontline && (
        <div className="ch-alert ch-alert-info">Scoped to your own sales ({email}). Company profit is managers-only.</div>
      )}
      {isStorekeeper && (
        <div className="ch-alert ch-alert-info">Storekeeper view: inventory and stock reports only.</div>
      )}

      {/* Global report filter bar (RPT-01) */}
      {!isStorekeeper && (
        <Card id="filters" title="Report filters" subtitle="Every card below recalculates from this range" delay={20}>
          <div className="ch-toolbar">
            <FilterBar
              filters={[
                {
                  key: 'period', value: period, ariaLabel: 'Date range preset', onChange: (v) => setPeriod(v as ReportPeriod),
                  options: REPORT_PERIOD_OPTIONS.map((o) => ({ value: o.value, label: o.label })),
                },
                {
                  key: 'pay', value: payment, ariaLabel: 'Payment method', onChange: setPayment,
                  options: [{ value: 'all', label: 'All payments' }, ...paymentOptions.map((p) => ({ value: p, label: p }))],
                },
                {
                  key: 'st', value: status, ariaLabel: 'Order status', onChange: setStatus,
                  options: [
                    { value: 'all', label: 'All statuses' },
                    { value: 'Paid', label: 'Paid' },
                    { value: 'Pending', label: 'Pending' },
                    { value: 'Offline Pending', label: 'Offline pending' },
                    { value: 'Synced', label: 'Synced' },
                    { value: 'Voided', label: 'Voided' },
                    { value: 'Refunded', label: 'Refunded' },
                  ],
                },
                {
                  key: 'wh', value: warehouse, ariaLabel: 'Warehouse', onChange: setWarehouse,
                  options: [{ value: 'all', label: 'All warehouses' }, ...warehouses.map((w) => ({ value: String(w.ROWID), label: w.name }))],
                },
              ]}
              onReset={resetFilters}
            />
            <span className="orders-dates">
              {period === 'custom' && (
                <>
                  <input type="date" className="ch-input" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                  <input type="date" className="ch-input" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </>
              )}
              <input
                className="ch-input"
                list="rep-customers"
                aria-label="Filter by customer"
                placeholder="Customer…"
                value={customer}
                onChange={(e) => setCustomer(e.target.value)}
              />
              <datalist id="rep-customers">
                {customers.slice(0, 60).map((c) => <option key={c.id} value={c.name}>{c.email ?? ''}</option>)}
              </datalist>
              <input
                className="ch-input"
                list="rep-cashiers"
                aria-label="Filter by cashier"
                placeholder="Cashier…"
                value={isFrontline ? email : cashier}
                disabled={isFrontline}
                onChange={(e) => setCashier(e.target.value)}
              />
              <datalist id="rep-cashiers">
                {users.map((u) => <option key={u.email} value={u.name || u.email}>{`${u.role} · ${u.email}`}</option>)}
              </datalist>
              <input
                className="ch-input"
                list="rep-categories"
                aria-label="Filter by category"
                placeholder="Category…"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <datalist id="rep-categories">
                {categories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </span>
          </div>
          {reportsLoading && <p className="ch-hint">Recalculating…</p>}
        </Card>
      )}

      {/* Revenue tab — overview + daily/channel/week/month (Settings-style hash tab) */}
      {!isStorekeeper && activeSection === 'revenue' && (
        <div className="reports-tab">
          <div className="ch-grid-stats reports-stats">
            <StatCard label="Total revenue" value={currency(dispRevenue)} delta={`${growth >= 0 ? '+' : ''}${growth.toFixed(1)}% ${growthBase}`} deltaTone={growth >= 0 ? 'up' : 'down'} icon={<Wallet size={20} />} spark={spark} delay={40} />
            <StatCard label="Total orders" value={number(dispOrders)} delta={`Avg ${currency(dispAov)} per order`} deltaTone="flat" icon={<ReceiptText size={20} />} iconBg="#e3f6ec" iconColor="#147a50" delay={100} />
            <StatCard label="Products" value={number(products.length)} delta={`${number(products.reduce((s, p) => s + Number(p.stock || 0), 0))} units on hand`} icon={<Package size={20} />} iconBg="#fef1e1" iconColor="#b25a09" delay={160} />
            <StatCard label="Customers" value={number(customerCount)} icon={<Users size={20} />} iconBg="#e9f0fe" iconColor="#2b5fe3" delay={220} />
          </div>

          <div className="reports-grid">
            <Card
              id="revenue"
              title="Revenue by day"
              subtitle={`${rangeLabel} · with trend`}
              delay={140}
              action={<ExportActions type="revenue" filters={filters} compact />}
            >
              {dayEntries.length === 0 ? (
                <p className="ch-hint">No sales in this range.</p>
              ) : (
                <div className="reports-bars">
                  {dayEntries.map((d, i) => {
                    const prev = i > 0 ? (dayEntries[i - 1]?.revenue ?? 0) : null;
                    const delta = prev === null || prev <= 0 ? null : ((d.revenue - prev) / prev) * 100;
                    return (
                      <div key={d.day} className="reports-bar-row">
                        <span className="reports-day">{formatDay(d.day)}</span>
                        <span className="reports-track"><span className="reports-fill" style={{ width: `${Math.max(3, Math.round((d.revenue / maxDay) * 100))}%` }} /></span>
                        <span className="reports-val">{currency(d.revenue)} · {d.orders}</span>
                        {delta !== null && (
                          <span className={delta >= 0 ? 'rep-trend up' : 'rep-trend down'}>
                            {delta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                            {Math.abs(delta).toFixed(0)}%
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>

            <Card
              id="channels"
              title="Revenue by channel"
              subtitle="Payment split with share"
              delay={180}
              action={<ExportActions type="revenue" filters={filters} compact />}
            >
              {payEntries.length === 0 ? (
                <p className="ch-hint">No orders yet.</p>
              ) : (
                <div className="ch-stack">
                  {payEntries.map((p) => (
                    <div key={p.method} className="rep-pay">
                      <div className="rep-pay-head"><b>{p.method}</b><span className="ch-cell-sub">{number(p.orders)} orders · {Math.round((p.revenue / payTotal) * 100)}%</span></div>
                      <div className="ch-meter"><i style={{ width: `${Math.max(4, Math.round((p.revenue / payTotal) * 100))}%` }} /></div>
                      <b className="rep-pay-val">{currency(p.revenue)}</b>
                    </div>
                  ))}
                  <Table
                    columns={[
                      { key: 'm', header: 'Method', render: (p: { method: string }) => <span className="ch-cell-main">{p.method}</span> },
                      { key: 'o', header: 'Orders', numeric: true, render: (p: { orders: number }) => number(p.orders) },
                      { key: 'r', header: 'Revenue', numeric: true, render: (p: { revenue: number }) => currency(p.revenue) },
                    ]}
                    rows={payEntries}
                    rowKey={(p) => p.method}
                    minWidth={300}
                  />
                </div>
              )}
            </Card>
          </div>

          {(rev !== null && (rev.revenue_by_week.length > 0 || rev.revenue_by_month.length > 0)) && (
            <div className="reports-grid">
              <Card id="revenue-week" title="Revenue by week" subtitle="Monday-start weeks in range" delay={190}>
                <Table
                  columns={[
                    { key: 'w', header: 'Week of', render: (r: { week: string; orders: number; revenue: number }) => <span className="ch-cell-main">{formatDay(r.week)}</span> },
                    { key: 'o', header: 'Orders', numeric: true, render: (r) => number(r.orders) },
                    { key: 'r', header: 'Revenue', numeric: true, render: (r) => <b>{currency(r.revenue)}</b> },
                  ]}
                  rows={rev.revenue_by_week}
                  rowKey={(r) => r.week}
                  minWidth={300}
                />
              </Card>
              <Card id="revenue-month" title="Revenue by month" subtitle="Calendar months in range" delay={195}>
                <Table
                  columns={[
                    { key: 'm', header: 'Month', render: (r: { month: string; orders: number; revenue: number }) => <span className="ch-cell-main">{r.month}</span> },
                    { key: 'o', header: 'Orders', numeric: true, render: (r) => number(r.orders) },
                    { key: 'r', header: 'Revenue', numeric: true, render: (r) => <b>{currency(r.revenue)}</b> },
                  ]}
                  rows={rev.revenue_by_month}
                  rowKey={(r) => r.month}
                  minWidth={300}
                />
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Inventory tab — product performance + highlights (Settings-style hash tab) */}
      {!isStorekeeper && activeSection === 'inventory' && (
        <div className="reports-tab">
          <div className="reports-grid">
            <Card
              id="performance"
              title="Product performance"
              subtitle={perf ? `Cost coverage ${perf.coverage.lines_with_cost}/${perf.coverage.lines_total} lines` : 'Best, worst and slowest movers'}
              delay={200}
              action={<ExportActions type="products" filters={filters} compact />}
            >
              {perf === null || (perf.best_sellers.length === 0 && perf.slow_movers.length === 0) ? (
                <p className="ch-hint">No product sales in this range.</p>
              ) : (
                <div className="ch-stack">
                  {perf.best_sellers.length > 0 && (
                    <Table
                      columns={[
                        { key: 'n', header: 'Best sellers', render: (p: (typeof perf.best_sellers)[number]) => <span><span className="ch-cell-main">{p.name}</span><br /><span className="ch-cell-sub">{p.sku}</span></span> },
                        { key: 'q', header: 'Qty', numeric: true, render: (p) => <b>{number(p.quantity)}</b> },
                        { key: 'r', header: 'Revenue', numeric: true, render: (p) => currency(p.revenue) },
                        { key: 'p', header: 'Profit', numeric: true, render: (p) => <b>{currency(p.profit)}</b> },
                      ]}
                      rows={perf.best_sellers.slice(0, 5)}
                      rowKey={(p) => p.product_id}
                      minWidth={320}
                    />
                  )}
                  {perf.slow_movers.length > 0 && (
                    <Table
                      columns={[
                        { key: 'n', header: 'Slow movers', render: (p: (typeof perf.slow_movers)[number]) => <span><span className="ch-cell-main">{p.name}</span><br /><span className="ch-cell-sub">{p.sku}</span></span> },
                        { key: 's', header: 'Stock', numeric: true, render: (p) => number(p.stock) },
                        { key: 't', header: 'Turnover', numeric: true, render: (p) => number(p.turnover) },
                      ]}
                      rows={perf.slow_movers.slice(0, 5)}
                      rowKey={(p) => p.product_id}
                      minWidth={320}
                    />
                  )}
                </div>
              )}
            </Card>

            <Card id="inventory" title="Product highlights" subtitle="Top stock on hand" delay={205} action={<ExportActions type="inventory" filters={filters} compact />}>
              {inventoryRows.length === 0 ? (
                <p className="ch-hint">No products to report on.</p>
              ) : (
                <Table
                  columns={[
                    { key: 'n', header: 'Product', render: (p: Product) => <span className="ch-cell-main">{p.name}</span> },
                    { key: 's', header: 'Stock', numeric: true, render: (p: Product) => number(p.stock) },
                    { key: 'p', header: 'Price', numeric: true, render: (p: Product) => currency(p.rate) },
                  ]}
                  rows={inventoryRows}
                  rowKey={(p, i) => `${String(p.ROWID ?? p.sku)}-${i}`}
                  minWidth={300}
                />
              )}
            </Card>
          </div>
        </div>
      )}

      {/* Customers / Profit / Register tabs — one visible at a time (Settings-style hash tabs) */}
      {!isStorekeeper && (activeSection === 'customers' || activeSection === 'profit' || activeSection === 'register') && (
        <div className="reports-tab">
          <div className="reports-grid">
            {activeSection === 'customers' && (
            <Card
              id="customers"
              title="Customer analytics"
              subtitle={custRep ? `${custRep.active_customers} active · ${custRep.new_customers} new · ${custRep.returning_customers} returning` : 'Top buyers by lifetime revenue'}
              delay={260}
              action={<ExportActions type="customers" filters={filters} compact />}
            >
              {custRep !== null && custRep.revenue_trend.length > 0 ? (
                <div className="reports-bars">
                  {(() => {
                    const trend = custRep.revenue_trend.slice(-14);
                    const max = Math.max(1, ...trend.map((d) => d.revenue));
                    return trend.map((row) => (
                      <div key={row.day} className="reports-bar-row">
                        <span className="reports-day">{formatDay(row.day)}</span>
                        <span className="reports-track"><span className="reports-fill" style={{ width: `${Math.max(3, Math.round((row.revenue / max) * 100))}%` }} /></span>
                        <span className="reports-val">{currency(row.revenue)} · {row.customers}</span>
                      </div>
                    ));
                  })()}
                </div>
              ) : topCustomers.length === 0 ? (
                <p className="ch-hint">No customer sales yet.</p>
              ) : (
                <Table
                  columns={[
                    { key: 'n', header: 'Customer', render: (c: (typeof topCustomers)[number]) => <span className="ch-cell-main">{c.name}</span> },
                    { key: 'o', header: 'Orders', numeric: true, render: (c) => number(c.orders) },
                    { key: 'r', header: 'Revenue', numeric: true, render: (c) => <b>{currency(c.revenue)}</b> },
                    { key: 'l', header: 'Last order', render: (c) => <span className="ch-cell-sub">{c.last === '' ? '—' : formatDay(c.last)}</span> },
                  ]}
                  rows={topCustomers}
                  rowKey={(c) => c.name}
                  minWidth={320}
                />
              )}
            </Card>
            )}

            <div className="ch-stack">
              {activeSection === 'profit' && (
                canViewProfit ? (
                <Card
                  id="profit"
                  title="Profit Reports"
                  subtitle={profitRep ? `Cost-basis actual · ${profitRep.coverage.lines_with_cost}/${profitRep.coverage.lines_total} lines costed` : 'Margin snapshot (30% blended estimate)'}
                  delay={280}
                  action={<ExportActions type="profit" filters={filters} compact />}
                >
                  {profitRep !== null ? (
                    <>
                      <dl className="reports-summary">
                        <div><dt>Total revenue</dt><dd>{currency(profitRep.revenue)}</dd></div>
                        <div><dt>Cost of goods</dt><dd>{currency(profitRep.cost)}</dd></div>
                        <div><dt>Gross profit</dt><dd>{currency(profitRep.gross_profit)}</dd></div>
                        <div><dt>Margin</dt><dd>{profitRep.margin_pct}%</dd></div>
                      </dl>
                      {profitRep.by_category.length > 0 && (
                        <Table
                          columns={[
                            { key: 'c', header: 'Category', render: (r: (typeof profitRep.by_category)[number]) => <span className="ch-cell-main">{r.category}</span> },
                            { key: 'r', header: 'Revenue', numeric: true, render: (r) => currency(r.revenue) },
                            { key: 'p', header: 'Profit', numeric: true, render: (r) => <b>{currency(r.profit)}</b> },
                          ]}
                          rows={profitRep.by_category.slice(0, 6)}
                          rowKey={(r) => r.category}
                          minWidth={280}
                        />
                      )}
                    </>
                  ) : (
                    <dl className="reports-summary">
                      <div><dt>Total revenue</dt><dd>{currency(dispRevenue)}</dd></div>
                      <div><dt>Est. profit</dt><dd>{currency(dispRevenue * 0.3)}</dd></div>
                      <div><dt>Blended margin</dt><dd>30%</dd></div>
                      <div><dt>Avg order value</dt><dd>{currency(dispAov)}</dd></div>
                    </dl>
                  )}
                </Card>
                ) : (
                  <Card><p className="ch-hint">Profit reports are managers-only.</p></Card>
                )
              )}
              {activeSection === 'register' && (
              <>
              <Card
                id="register"
                title="Registers"
                subtitle={registerRep ? `${rangeLabel} · cash, card, shifts` : "Today's till at a glance"}
                delay={300}
                action={<ExportActions type="registers" filters={filters} compact />}
              >
                {registerRep !== null ? (
                  <>
                    <dl className="reports-summary">
                      <div><dt>Cash</dt><dd>{currency(registerRep.cash_summary.cash)}</dd></div>
                      <div><dt>Card</dt><dd>{currency(registerRep.cash_summary.card)}</dd></div>
                      <div><dt>Other</dt><dd>{currency(registerRep.cash_summary.other)}</dd></div>
                      <div><dt>Total collected</dt><dd>{currency(registerRep.cash_summary.total)}</dd></div>
                      <div><dt>Voids</dt><dd>{number(registerRep.voids.count)} · {currency(registerRep.voids.value)}</dd></div>
                      <div><dt>Refunds</dt><dd>{number(registerRep.refunds.count)} · {currency(registerRep.refunds.value)}</dd></div>
                    </dl>
                    {registerRep.shifts.length > 0 && (
                      <Table
                        columns={[
                          { key: 'c', header: 'Shift', render: (s: (typeof registerRep.shifts)[number]) => <span><span className="ch-cell-main">{s.cashier || '—'}</span><br /><span className="ch-cell-sub">{s.at === '' ? '' : formatDay(s.at)}</span></span> },
                          { key: 's', header: 'Status', render: (s) => <span className="ch-cell-sub">{s.status || '—'}</span> },
                          { key: 'v', header: 'Variance', numeric: true, render: (s) => <b>{currency(s.variance)}</b> },
                        ]}
                        rows={registerRep.shifts.slice(0, 6)}
                        rowKey={(s, i) => `${s.id}-${i}`}
                        minWidth={280}
                      />
                    )}
                  </>
                ) : (
                  <p className="ch-hint">No register data in this range.</p>
                )}
              </Card>
              <Card
                id="order-status"
                title="Orders by status"
                subtitle="Status mix with revenue"
                delay={310}
                action={<ExportActions type="orders" filters={filters} compact />}
              >
                {orderReports.byStatus.length === 0 ? (
                  <p className="ch-hint">No orders yet.</p>
                ) : (
                  <Table
                    columns={[
                      { key: 's', header: 'Status', render: (r: (typeof orderReports.byStatus)[number]) => <span className="ch-cell-main">{r.status}</span> },
                      { key: 'o', header: 'Orders', numeric: true, render: (r) => number(r.orders) },
                      { key: 'r', header: 'Revenue', numeric: true, render: (r) => <b>{currency(r.revenue)}</b> },
                    ]}
                    rows={orderReports.byStatus}
                    rowKey={(r) => r.status}
                    minWidth={280}
                  />
                )}
              </Card>
              <Card id="cashiers" title="Top cashiers" subtitle="Sales attribution by cashier" delay={320}>
                {(registerRep?.cashiers.length ?? orderReports.topCashiers.length) === 0 ? (
                  <p className="ch-hint">No cashier data yet.</p>
                ) : (
                  <Table
                    columns={[
                      { key: 'n', header: 'Cashier', render: (r: { name: string }) => <span className="ch-cell-main">{r.name}</span> },
                      { key: 'o', header: 'Orders', numeric: true, render: (r: { orders: number }) => number(r.orders) },
                      { key: 'r', header: 'Revenue', numeric: true, render: (r: { revenue: number }) => <b>{currency(r.revenue)}</b> },
                    ]}
                    rows={(registerRep !== null && registerRep.cashiers.length > 0
                      ? registerRep.cashiers.map((c) => ({ name: c.cashier, orders: c.orders, revenue: c.revenue }))
                      : orderReports.topCashiers
                    ).slice(0, 5)}
                    rowKey={(r) => r.name}
                    minWidth={280}
                  />
                )}
              </Card>
              <Card id="voids" title="Voids & refunds" subtitle="Cancelled and refunded orders" delay={330}>
                <dl className="reports-summary">
                  <div><dt>Voided / cancelled</dt><dd>{number(registerRep?.voids.count ?? orderReports.voidedCount)} · {currency(registerRep?.voids.value ?? orderReports.voidedValue)}</dd></div>
                  <div><dt>Refunded</dt><dd>{number(registerRep?.refunds.count ?? orderReports.refundedCount)} · {currency(registerRep?.refunds.value ?? orderReports.refundedValue)}</dd></div>
                </dl>
              </Card>
              </>
              )}
            </div>
          </div>
        </div>
      )}

          {!isStorekeeper && activeSection === 'customers' && (
          <div className="reports-tab">
          <div className="reports-grid">
            <Card id="loyalty" title="Customer loyalty" subtitle="Tier distribution, points and lifetime value" delay={250} action={<ExportActions type="customers" filters={filters} compact />}>
              <Table
                columns={[
                  { key: 't', header: 'Tier', render: (r: { tier: string }) => <span className="ch-cell-main">{r.tier}</span> },
                  { key: 'm', header: 'Members', numeric: true, render: (r: { members: number }) => number(r.members) },
                  { key: 'p', header: 'Points', numeric: true, render: (r: { points: number }) => number(r.points) },
                  { key: 'v', header: 'Lifetime value', numeric: true, render: (r: { value: number }) => <b>{currency(r.value)}</b> },
                ]}
                rows={(() => {
                  const pts = new Map<string, { points: number; value: number }>();
                  for (const c of customers) {
                    const t = (c.tier ?? '').trim() || 'New';
                    const cur = pts.get(t) ?? { points: 0, value: 0 };
                    cur.points += Number(c.loyalty_points ?? 0);
                    cur.value += Number(c.lifetime_value ?? 0);
                    pts.set(t, cur);
                  }
                  const counts = new Map<string, number>();
                  if (custRep) {
                    for (const d of custRep.loyalty_distribution) counts.set(d.tier, d.members);
                  } else {
                    for (const c of customers) {
                      const t = (c.tier ?? '').trim() || 'New';
                      counts.set(t, (counts.get(t) ?? 0) + 1);
                    }
                  }
                  return (['VIP', 'Loyal', 'Active', 'New'] as const).map((t) => ({
                    tier: t,
                    members: counts.get(t) ?? 0,
                    points: pts.get(t)?.points ?? 0,
                    value: pts.get(t)?.value ?? 0,
                  }));
                })()}
                rowKey={(r) => r.tier}
                minWidth={300}
              />
            </Card>

            <Card title="VIP & lifetime value" subtitle="Top VIP spenders plus program totals" delay={255}>
              <dl className="reports-summary">
                <div><dt>Total lifetime value</dt><dd>{currency(custRep?.total_lifetime_value ?? customers.reduce((s, c) => s + Number(c.lifetime_value ?? 0), 0))}</dd></div>
                <div><dt>Average LTV</dt><dd>{currency(custRep?.average_lifetime_value ?? (customers.length > 0 ? customers.reduce((s, c) => s + Number(c.lifetime_value ?? 0), 0) / customers.length : 0))}</dd></div>
                <div><dt>Active loyalty points</dt><dd>{number(customers.reduce((s, c) => s + Number(c.loyalty_points ?? 0), 0))}</dd></div>
                <div><dt>VIP members</dt><dd>{number(custRep?.vip_customers.length ?? customers.filter((c) => ((c.tier ?? '').trim() || 'New') === 'VIP').length)}</dd></div>
                {custRep !== null && (
                  <>
                    <div><dt>New customers</dt><dd>{number(custRep.new_customers)}</dd></div>
                    <div><dt>Returning</dt><dd>{number(custRep.returning_customers)}</dd></div>
                    <div><dt>Avg frequency</dt><dd>{number(custRep.average_frequency)} orders</dd></div>
                  </>
                )}
              </dl>
              {(custRep?.vip_customers ?? []).length > 0 && (
                <Table
                  columns={[
                    { key: 'n', header: 'VIP', render: (c: Customer) => <span className="ch-cell-main">{c.name}</span> },
                    { key: 'p', header: 'Points', numeric: true, render: (c: Customer) => number(c.loyalty_points ?? 0) },
                    { key: 'v', header: 'LTV', numeric: true, render: (c: Customer) => <b>{currency(c.lifetime_value ?? 0)}</b> },
                  ]}
                  rows={(custRep?.vip_customers ?? []).slice(0, 8)}
                  rowKey={(c) => c.id}
                  minWidth={280}
                />
              )}
            </Card>
          </div>
          </div>
          )}

      {/* Inventory tab — business health + transfers + warehouse (visible to every role, Storekeeper scope) */}
      {activeSection === 'inventory' && (
      <div className="reports-tab">
      <div className="reports-grid">
        <Card title="Business summary" subtitle="Inventory & customer health" delay={240}>
          <dl className="reports-summary">
            <div><dt>Customers tracked</dt><dd>{number(customerCount)}</dd></div>
            <div><dt>Catalog items</dt><dd>{number(products.length)}</dd></div>
            <div><dt>Units in stock</dt><dd>{number(products.reduce((s, p) => s + Number(p.stock || 0), 0))}</dd></div>
            <div><dt>Stock value</dt><dd>{currency(products.reduce((s, p) => s + Number(p.rate || 0) * Number(p.stock || 0), 0))}</dd></div>
            <div><dt>Low stock items</dt><dd className={products.filter((p) => Number(p.stock) <= 10).length > 0 ? 'rep-warn' : 'rep-ok'}>{number(products.filter((p) => Number(p.stock) <= 10).length)}</dd></div>
          </dl>
        </Card>
        {(warehouses.length > 0 || transfers.length > 0) && (
          <Card title="Transfer history" subtitle="Stock moved between warehouses" delay={245}>
            <dl className="reports-summary">
              <div><dt>Total transfers</dt><dd>{number(transferStats.total)}</dd></div>
              <div><dt>Completed</dt><dd>{number(transferStats.completed)}</dd></div>
              <div><dt>Units moved</dt><dd>{number(transferStats.units)}</dd></div>
              <div><dt>Locations</dt><dd>{number(warehouses.length)}</dd></div>
            </dl>
          </Card>
        )}
      </div>
      {(warehouses.length > 0 || transfers.length > 0) && (
      <div className="reports-grid reports-single">
          <Card id="warehouse" title="Inventory by warehouse" subtitle="Valuation and low-stock lines per location" delay={250} action={<ExportActions type="inventory" filters={filters} compact />}>
            {warehouseValuation.length === 0 ? (
              <p className="ch-hint">No warehouse breakdown yet.</p>
            ) : (
              <Table
                columns={[
                  { key: 'n', header: 'Warehouse', render: (w: (typeof warehouseValuation)[number]) => <span><span className="ch-cell-main">{w.name}</span><br /><span className="ch-cell-sub">{w.code}</span></span> },
                  { key: 'u', header: 'Units', numeric: true, render: (w) => number(w.units) },
                  { key: 'v', header: 'Valuation', numeric: true, render: (w) => <b>{currency(w.value)}</b> },
                  { key: 'l', header: 'Low lines', numeric: true, render: (w) => <span className={w.low > 0 ? 'rep-warn' : 'rep-ok'}>{number(w.low)}</span> },
                ]}
                rows={warehouseValuation}
                rowKey={(w) => w.id}
                minWidth={300}
              />
            )}
          </Card>
      </div>
        )}
      </div>
      )}
    </div>
  );
}
