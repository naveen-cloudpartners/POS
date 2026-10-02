import PageIcon from '../components/ui/PageIcon';
import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  DollarSign,
  ClipboardList,
  Wallet,
  Users,
  AlertTriangle,
  TrendingUp,
  ArrowUp,
  ArrowDown,
  Minus,
  ArrowRight,
  Package,
  Zap,
  FileCheck,
  CheckCircle2,
  RefreshCw,
  FileText,
} from 'lucide-react';
import Card from '../components/ui/Card';
import StatCard from '../components/ui/StatCard';
import Table from '../components/ui/Table';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';

import { useAuth } from '../context/AuthContext';
import { getOrders } from '../services/orderService';
import { getProducts } from '../services/productService';
import { getCustomers } from '../services/customerService';
import { getDashboardSummary, type DashboardSummary } from '../services/dashboardService';
import { getTransfers, getWarehouses } from '../services/inventoryService';
import { currency, formatDate, number, isLowStock, isOutOfStock } from '../utils/format';
import type { Order, Product, StockTransfer, Warehouse } from '../types';
import './Dashboard.css';
import './DashboardRedesign.css';
import DashboardChart from '../components/dashboard/DashboardChart';
import { buildDashboardSeries } from '../utils/dashboardAnalytics';

interface DashboardData {
  orders: Array<Order>;
  products: Array<Product>;
  customerCount: number;
  summary: DashboardSummary | null;
  warehouses: Array<Warehouse>;
  transfers: Array<StockTransfer>;
}

function statusOf(o: Order): string {
  return (o.status ?? '').trim().toLowerCase();
}

function DashboardMoney({ value }: { value: number }) {
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return <strong title={currency(value)}><span className="dashboard-money-full">{currency(value)}</span><span className="dashboard-money-compact">LKR {compact}</span></strong>;
}

function MetricTrend({ change }: { change: number | null }) {
  if (change === null) return <span className="dashboard-trend-unavailable" title="No previous-period data to calculate a trend"><Minus className="dashboard-trend-arrow flat" size={36} strokeWidth={2.2} aria-label="Trend unavailable: no previous-period data" /></span>;
  const Icon = change > 0 ? ArrowUp : change < 0 ? ArrowDown : Minus;
  return <Icon className={`dashboard-trend-arrow${change < 0 ? ' negative' : change === 0 ? ' flat' : ''}`} size={36} strokeWidth={2.2} aria-label={change > 0 ? 'Increase from previous period' : change < 0 ? 'Decrease from previous period' : 'Unchanged from previous period'} />;
}

function countsAsSale(o: Order): boolean {
  const st = statusOf(o);
  return st !== 'voided' && st !== 'void' && st !== 'cancelled' && st !== 'canceled' && st !== 'refunded';
}

function orderValue(o: Order): number {
  const paid = Number(o.paid_total);
  return Number.isFinite(paid) ? paid : 0;
}

interface Reco {
  tone: 'ok' | 'warn' | 'bad';
  title: string;
  sub: string;
}

export default function Dashboard() {
  const { role } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(7);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      getOrders({ limit: 300 }),
      getProducts(),
      getCustomers().catch(() => []),
      getDashboardSummary(),
      getWarehouses().catch(() => [] as Array<Warehouse>),
      getTransfers().catch(() => [] as Array<StockTransfer>),
    ])
      .then(([orders, products, customers, summary, warehouses, transfers]) => {
        setData({ orders, products, customerCount: customers.length, summary, warehouses, transfers });
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load dashboard'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const series = useMemo(() => buildDashboardSeries(data?.orders ?? [], period), [data, period]);
  const periodRevenue = series.reduce((sum, point) => sum + point.revenue, 0);
  const previousRevenue = series.reduce((sum, point) => sum + point.previousRevenue, 0);
  const periodOrders = series.reduce((sum, point) => sum + point.orders, 0);
  const previousOrders = series.reduce((sum, point) => sum + point.previousOrders, 0);
  const orderGrowth = previousOrders > 0 ? (periodOrders - previousOrders) / previousOrders * 100 : null;
  const periodGrowth = previousRevenue > 0 ? (periodRevenue - previousRevenue) / previousRevenue * 100 : null;

  const stats = useMemo(() => {
    if (data === null) return null;
    const s = data.summary;
    const today = new Date().toISOString().slice(0, 10);

    // DASH-07: per-product reorder levels (fallback 10 only when unset).
    const lowStock = data.products.filter(isLowStock);
    const outStock = data.products.filter(isOutOfStock);

    // Legacy client-side aggregates — used for growth/chart plus as a
    // fallback when the backend predates GET /api/dashboard/summary.
    const salesOrders = data.orders.filter((o) => countsAsSale(o) && orderValue(o) > 0);
    const legacyRevenue = salesOrders.reduce((sum, o) => sum + orderValue(o), 0);
    const legacyTodayOrders = salesOrders.filter((o) => String(o.CREATEDTIME ?? '').slice(0, 10) === today);
    const legacyTodayRevenue = legacyTodayOrders.reduce((sum, o) => sum + orderValue(o), 0);
    // DASH-01: server buckets when available, legacy lifetime fallback.
    const revenueToday = s?.revenue.today ?? legacyTodayRevenue;
    const revenueWeek = s?.revenue.week ?? legacyRevenue;
    const revenueMonth = s?.revenue.month ?? legacyRevenue;
    const revenueTotal = s?.revenue.total ?? legacyRevenue;

    // DASH-02: server pipeline when available, legacy mapping fallback.
    const pending = s?.orderCounts.pending ?? data.orders.filter((o) => statusOf(o) === 'pending').length;
    const offline = s?.orderCounts.offline ?? data.orders.filter((o) => ['completed', 'offline pending'].includes(statusOf(o))).length;
    const synced = s?.orderCounts.synced ?? data.orders.filter((o) => statusOf(o) === 'synced').length;
    const toInvoice = s?.orderCounts.toInvoice ?? data.orders.filter((o) => (o.books_invoice_id ?? '') === '' && (o.invoice_number ?? '') === '').length;
    const orderTotal = s?.orderCounts.total ?? salesOrders.length;
    const todayOrderCount = s?.orderCounts.today ?? legacyTodayOrders.length;

    // DASH-03: server customer summary; directory count always available.
    const customers = s?.customers ?? { total: data.customerCount, new: 0, returning: 0, active: 0 };
    const customersKnown = s !== null;

    // DASH-04: actual cost-basis profit; null when the backend predates it.
    const profit = s === null ? null : s.profit;
    const profitCoverage = profit !== null && profit.linesTotal > 0
      ? Math.round((profit.linesWithCost / profit.linesTotal) * 100)
      : 0;

    const units = data.products.reduce((sum, p) => sum + Number(p.stock || 0), 0);
    const stockValue = data.products.reduce((sum, p) => sum + Number(p.rate || 0) * Number(p.stock || 0), 0);
    const avgOrder = orderTotal === 0 ? 0 : revenueTotal / orderTotal;

    // DASH-06: top sellers from order lines; legacy stock-value fallback.
    const serverTop = s?.topProducts ?? [];
    const maxTopRevenue = Math.max(1, ...serverTop.map((t) => t.revenue));
    const topProducts = (serverTop.length > 0
      ? serverTop.map((t) => ({
        key: t.itemId,
        name: t.name,
        sub: `${number(t.quantity)} sold`,
        value: currency(t.revenue),
        meterPct: Math.max(4, Math.round((t.revenue / maxTopRevenue) * 100)),
      }))
      : (() => {
        const ranked = [...data.products]
          .map((p) => ({ p, val: Number(p.rate) * Number(p.stock) }))
          .sort((a, b) => b.val - a.val)
          .slice(0, 5);
        const top = Math.max(1, ranked[0]?.val ?? 1);
        return ranked.map(({ p, val }) => ({
          key: String(p.ROWID ?? p.sku),
          name: p.name,
          sub: `${p.category} · ${number(p.stock)} in stock`,
          value: currency(val),
          meterPct: Math.max(4, Math.round((val / top) * 100)),
        }));
      })());

    return {
      revenueToday, revenueWeek, revenueMonth, revenueTotal,
      pending, offline, synced, toInvoice, orderTotal, todayOrderCount,
      customers, customersKnown, profit, profitCoverage,
      topProducts,
      slowMovers: s?.slowMovers ?? [],
      movements: s?.movements ?? [],
      todayOrders: legacyTodayOrders, todayRevenue: revenueToday,
      units, stockValue, avgOrder, lowStock, outStock,
    };
  }, [data]);

  const lowList = useMemo(() => {
    if (data === null) return [];
    return [...data.products].filter(isLowStock).sort((a, b) => Number(a.stock) - Number(b.stock)).slice(0, 6);
  }, [data]);

  // DASH-06: rule-based business recommendations from live state.
  const recos = useMemo((): Array<Reco> => {
    if (stats === null || data === null) return [];
    const out: Array<Reco> = [];
    if (stats.outStock.length > 0) {
      out.push({ tone: 'bad', title: `Restock ${stats.outStock.length} out-of-stock item${stats.outStock.length === 1 ? '' : 's'} first`, sub: stats.outStock.slice(0, 3).map((p) => p.name).join(', ') });
    }
    const slowValue = stats.slowMovers.reduce((sum, m) => sum + m.stockValue, 0);
    if (stats.slowMovers.length > 0 && slowValue > 0) {
      out.push({ tone: 'warn', title: `${stats.slowMovers.length} slow movers tie up ${currency(slowValue)}`, sub: `Consider offers on ${stats.slowMovers.slice(0, 2).map((m) => m.name).join(', ')}` });
    }
    if (stats.toInvoice > 0) {
      out.push({ tone: 'warn', title: `${stats.toInvoice} order${stats.toInvoice === 1 ? '' : 's'} missing invoices`, sub: 'Issue invoices from Orders' });
    }
    if (stats.lowStock.length > 0 && stats.outStock.length === 0) {
      out.push({ tone: 'warn', title: `${stats.lowStock.length} item${stats.lowStock.length === 1 ? '' : 's'} at or below reorder level`, sub: 'Review Inventory to reorder' });
    }
    return out.slice(0, 3);
  }, [stats, data]);

  // DASH-05: orders + stock-movement audit trail, chronological; undated alerts last.
  const activity = useMemo(() => {
    if (data === null || stats === null) return [];
    const orderEvents = data.orders.filter((row) => countsAsSale(row) && orderValue(row) > 0).slice(0, 6).map((o) => ({
      id: `o-${String(o.ROWID ?? o.invoice_number)}`,
      kind: 'order' as const,
      text: `Order ${o.invoice_number ?? o.ROWID} — ${o.customer_name ?? 'Walk-in'} · ${currency(orderValue(o))}`,
      time: String(o.CREATEDTIME ?? ''),
    }));
    const movementEvents = stats.movements.slice(0, 6).map((m) => {
      const qty = m.quantityChange;
      const signed = `${qty >= 0 ? '+' : ''}${number(qty)}`;
      const actor = m.performedBy !== '' ? ` by ${m.performedBy}` : '';
      const reason = m.reason !== '' ? ` — ${m.reason}` : '';
      return {
        id: `m-${m.id}`,
        kind: 'movement' as const,
        text: `${m.movementType} ${signed} · ${m.itemName || m.sku}${reason}${actor}`,
        time: m.at,
      };
    });
    const stockEvents = stats.lowStock.slice(0, 4).map((p) => ({
      id: `s-${String(p.ROWID ?? p.sku)}`,
      kind: 'stock' as const,
      text: `Low stock: ${p.name} (${number(p.stock)} left)`,
      time: '',
    }));
    const dated = [...orderEvents, ...movementEvents.filter((m) => m.time !== '')].sort((a, b) => (a.time < b.time ? 1 : -1));
    const undated = [...movementEvents.filter((m) => m.time === ''), ...stockEvents];
    return [...dated, ...undated].slice(0, 10);
  }, [data, stats]);

  if (loading) return <Loader message="Loading dashboard…" skeleton="page" />;
  if (error !== '' || data === null || stats === null) {
    return <ErrorState message={error === '' ? 'Dashboard data unavailable.' : error} onRetry={load} />;
  }

  // DASH-08: dashboard is Admin/Manager-only. Everyone else goes to POS.
  if (role !== '' && role !== 'Admin' && role !== 'Manager') {
    return <Navigate to="/sales/pos" replace />;
  }


  const recent = data.orders.slice(0, 6);

  return (
    <div className="dash dashboard-redesign">
      {/* TOP — KPI row above the fold */}
      <div className="ch-page-head reveal"><PageIcon />
        <div>
          <span className="dashboard-eyebrow">YOUR BUSINESS AT A GLANCE</span>
          <h1 className="ch-page-title">Dashboard</h1>
          <p className="ch-page-sub">
            Sales, stock and performance in one place.
          </p>
        </div>
        <div className="ch-page-actions">
          <Link to="/sales/pos" className="ch-btn ch-btn-primary"><Zap size={15} /> New sale</Link>
          <button type="button" onClick={load} className="ch-btn ch-btn-secondary" aria-label="Refresh dashboard"><RefreshCw size={15} /> Refresh</button>
        </div>
      </div>

      <div className="dashboard-section-bar">
        <div><b>Performance overview</b><span>Live business data</span></div>
        <label className="dashboard-period">Period <select value={period} onChange={event => setPeriod(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option></select></label>
      </div>
      <div className="dashboard-overview-grid">
        <div className="dashboard-metrics">
          <article className="dashboard-metric"><div className="dashboard-metric-label">Collected revenue <DollarSign size={16} /></div><div className="dashboard-metric-value"><DashboardMoney value={periodRevenue} /><MetricTrend change={periodGrowth} /></div><span className={periodGrowth !== null && periodGrowth < 0 ? 'dashboard-change negative' : 'dashboard-change'}>{periodGrowth === null ? (periodRevenue > 0 ? 'No revenue in previous period' : 'No collected revenue yet') : `${periodGrowth >= 0 ? '+' : ''}${periodGrowth.toFixed(1)}% vs previous ${period} days`}</span><small>{currency(stats.revenueToday)} collected today</small></article>
          <article className="dashboard-metric"><div className="dashboard-metric-label">Orders <ClipboardList size={16} /></div><div className="dashboard-metric-value"><strong>{number(periodOrders)}</strong><MetricTrend change={orderGrowth} /></div><span className={orderGrowth !== null && orderGrowth < 0 ? 'dashboard-change negative' : 'dashboard-change'}>{orderGrowth === null ? `Last ${period} days · no prior orders` : `${orderGrowth >= 0 ? '+' : ''}${orderGrowth.toFixed(1)}% vs previous ${period} days`}</span><small>{number(stats.todayOrderCount)} paid sales today</small></article>
          <article className="dashboard-metric"><div className="dashboard-metric-label">Inventory value <Package size={16} /></div><DashboardMoney value={stats.stockValue} /><span className="dashboard-change neutral">At current selling prices</span><small>{number(stats.units)} units · {number(data.products.length)} products</small></article>
          <article className="dashboard-metric"><div className="dashboard-metric-label">Actual profit <Wallet size={16} /></div>{stats.profit === null ? <strong>—</strong> : <DashboardMoney value={stats.profit.total} />}<span className="dashboard-change neutral">{stats.profit === null ? 'Cost data unavailable' : `${stats.profit.marginPct.toFixed(1)}% margin · recorded lines`}</span><small>{stats.profit === null ? 'Requires recorded product costs' : `${stats.profitCoverage}% of lines have recorded costs`}</small></article>
        </div>
        <Card title="Sales comparison" subtitle={`${series[0]?.label} – ${series.at(-1)?.label} · vs previous ${period} days`} className="dashboard-chart-card"><DashboardChart key={period} kind="sales" points={series} /></Card>
      </div>
      <div className="dashboard-trends-grid">
        <Card title="Revenue growth" subtitle="Cumulative collections · equal-length periods" className="dashboard-chart-card"><DashboardChart key={period} kind="revenue" points={series} /></Card>
        <Card title="Order trends" subtitle="Daily orders and outstanding payments" className="dashboard-chart-card"><DashboardChart key={period} kind="orders" points={series} /></Card>
      </div>
      <p className="dashboard-data-note">Charts use the latest {number(data.orders.length)} loaded orders (up to 300). Revenue is recorded collections; voided, cancelled and refunded orders are excluded. Inventory is current stock; profit covers available costed lines.{data.orders.length >= 300 && <strong> History limit reached: period totals and comparisons may be incomplete.</strong>}</p>

      {/* MIDDLE — sales activity pipeline */}
      <Card title="Sales Activity" subtitle="Live order pipeline" delay={160} className="dash-activity-card">
        <div className="sales-activity">
          <Link to="/sales/orders" className="sa-cell">
            <b className="sa-blue">{number(stats.pending)}</b>
            <span className="sa-cap">Qty</span>
            <span className="sa-lbl"><ClipboardList size={13} /> PENDING</span>
          </Link>
          <Link to="/sales/orders?status=Completed" className="sa-cell">
            <b className="sa-red">{number(stats.offline)}</b>
            <span className="sa-cap">Pkgs</span>
            <span className="sa-lbl"><CheckCircle2 size={13} /> COMPLETED</span>
          </Link>
          <Link to="/sales/orders?status=synced" className="sa-cell">
            <b className="sa-green">{number(stats.synced)}</b>
            <span className="sa-cap">Pkgs</span>
            <span className="sa-lbl"><RefreshCw size={13} /> SYNCED</span>
          </Link>
          <Link to="/sales/invoices" className="sa-cell">
            <b className="sa-amber">{number(stats.toInvoice)}</b>
            <span className="sa-cap">Qty</span>
            <span className="sa-lbl"><FileCheck size={13} /> TO BE INVOICED</span>
          </Link>
        </div>
      </Card>

      <div className="dash-grid">
        <Card
          title="Recent Orders"
          subtitle="Latest transactions"
          delay={200}
          action={<Link to="/sales/orders" className="ch-btn ch-btn-ghost ch-btn-sm">All orders <ArrowRight size={14} /></Link>}
        >
          {recent.length === 0 ? (
            <EmptyState title="No orders yet" message="Head to POS to record the first sale." action={<Link to="/sales/pos" className="ch-btn ch-btn-primary ch-btn-sm">Open POS</Link>} />
          ) : (
            <Table
              columns={[
                { key: 'n', header: 'Order', render: (o: Order) => <span className="ch-cell-main">{o.invoice_number ?? `#${String(o.ROWID)}`}</span> },
                { key: 'c', header: 'Customer', render: (o: Order) => o.customer_name ?? '—' },
                { key: 't', header: 'Total', numeric: true, render: (o: Order) => currency(o.total) },
                { key: 's', header: 'Status', render: (o: Order) => <StatusBadge status={o.status ?? 'Pending'} /> },
              ]}
              rows={recent}
              rowKey={(o, i) => `${String(o.ROWID ?? o.invoice_number ?? i)}-${i}`}
            />
          )}
        </Card>

        <Card
          title="Low Stock"
          subtitle={`${stats.lowStock.length} at or below reorder level`}
          delay={240}
          action={<Link to="/inventory" className="ch-btn ch-btn-ghost ch-btn-sm">Inventory <ArrowRight size={14} /></Link>}
        >
          {lowList.length === 0 ? (
            <p className="ch-hint">Stock levels healthy — nothing to reorder.</p>
          ) : (
            <ul className="dash-low">
              {lowList.map((p) => (
                <li key={String(p.ROWID ?? p.sku)}>
                  <span className="ch-thumb" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                  <span className="dash-top-meta">
                    <span className="ch-cell-main">{p.name}</span>
                    <span className="ch-cell-sub">{p.sku} · {p.category}</span>
                  </span>
                  <span className={Number(p.stock) <= 0 ? 'dash-low-n bad' : 'dash-low-n warn'}>{number(p.stock)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* BOTTOM — insights, top products, activity */}
      <div className="dash-grid-3">
        <Card title="Business insights" subtitle="Auto-generated from live data" delay={260}>
          <ul className="dash-insights">
            <li>
              <span className="dash-insight-ic ok"><TrendingUp size={15} /></span>
              <span><b>{stats.todayOrderCount} orders today</b><span className="ch-cell-sub"> worth {currency(stats.revenueToday)} — avg ticket {currency(stats.avgOrder)}</span></span>
            </li>
            <li>
              <span className="dash-insight-ic warn"><Package size={15} /></span>
              <span><b>{number(stats.units)} units · {currency(stats.stockValue)}</b><span className="ch-cell-sub"> tied up in stock across {number(data.products.length)} SKUs</span></span>
            </li>
            <li>
              <span className={stats.outStock.length > 0 ? 'dash-insight-ic bad' : 'dash-insight-ic ok'}><AlertTriangle size={15} /></span>
              <span>
                <b>{stats.lowStock.length === 0 ? 'Stock is healthy' : `${stats.lowStock.length} items need reorder`}</b>
                <span className="ch-cell-sub">{stats.outStock.length > 0 ? `${stats.outStock.length} out of stock — restock first` : 'No stock-outs right now'}</span>
              </span>
            </li>
            <li>
              <span className="dash-insight-ic ok"><FileText size={15} /></span>
              <span><b>{number(stats.synced)} orders synced</b><span className="ch-cell-sub">{number(stats.offline)} completed locally · {number(stats.toInvoice)} to invoice</span></span>
            </li>
            {recos.map((r, i) => (
              <li key={`reco-${i}`}>
                <span className={`dash-insight-ic ${r.tone}`}><Zap size={15} /></span>
                <span><b>{r.title}</b><span className="ch-cell-sub">{r.sub}</span></span>
              </li>
            ))}
          </ul>
          <div className="ch-row" style={{ marginTop: 14 }}>
            <Link to="/inventory" className="ch-btn ch-btn-secondary ch-btn-sm">Review inventory</Link>
            <Link to="/customers" className="ch-btn ch-btn-ghost ch-btn-sm">Top customers <ArrowRight size={13} /></Link>
          </div>
        </Card>

        <Card title={data.summary?.topProducts.length ? 'Top products' : 'Inventory value leaders'} subtitle={data.summary?.topProducts.length ? 'Best sellers by units moved' : 'Products ranked by current stock value'} delay={300} action={<Link to="/inventory/products" className="ch-btn ch-btn-ghost ch-btn-sm">All <ArrowRight size={14} /></Link>}>
          {stats.topProducts.length === 0 ? (
            <p className="ch-hint">No sales data yet.</p>
          ) : (
            <ul className="dash-top">
              {stats.topProducts.map((p) => (
                <li key={p.key}>
                  <span className="ch-thumb" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                  <span className="dash-top-meta">
                    <span className="ch-cell-main">{p.name}</span>
                    <span className="ch-meter" aria-hidden="true"><i style={{ width: `${p.meterPct}%` }} /></span>
                    <span className="ch-cell-sub">{p.sub}</span>
                  </span>
                  <span className="dash-top-value">{p.value}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Activity feed" subtitle="Orders, adjustments and stock alerts" delay={340}>
          {activity.length === 0 ? (
            <p className="ch-hint">No activity yet.</p>
          ) : (
            <ul className="dash-activity">
              {activity.map((a) => (
                <li key={a.id}>
                  <span className={a.kind === 'order' ? 'dash-dot' : 'dash-dot warn'} aria-hidden="true" />
                  <span>
                    <span className="dash-activity-text">{a.text}</span>
                    {a.time !== '' && <span className="dash-activity-time">{formatDate(a.time)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Slow movers (DASH-06) */}
      {stats.slowMovers.length > 0 && (
        <Card title="Slow-moving stock" subtitle="In stock, no sale in 30 days — capital waiting to move" delay={360}>
          <ul className="dash-top">
            {stats.slowMovers.map((m) => (
              <li key={m.sku}>
                <span className="ch-thumb" aria-hidden="true">{m.name.charAt(0).toUpperCase()}</span>
                <span className="dash-top-meta">
                  <span className="ch-cell-main">{m.name}</span>
                  <span className="ch-cell-sub">{m.sku} · {number(m.stock)} in stock{m.lastSoldAt ? ` · last sold ${formatDate(m.lastSoldAt)}` : ' · never sold'}</span>
                </span>
                <span className="dash-top-value">{currency(m.stockValue)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Warehouses supplement (INV-04/05): small widgets only, existing layout untouched */}
      {(data.warehouses.length > 0 || data.transfers.length > 0) && (
        <div className="ch-grid-stats">
          <StatCard
            label="Warehouses"
            value={number(data.warehouses.length)}
            delta={data.warehouses.filter((w) => (w.status ?? 'Active') === 'Active').length === data.warehouses.length ? 'All active' : 'Check inactive'}
            deltaTone="flat"
            icon={<Package size={20} />}
            delay={380}
          />
          <StatCard
            label="Pending transfers"
            value={number(data.transfers.filter((t) => ['Draft', 'Pending'].includes(String(t.status))).length)}
            delta={`${number(data.transfers.filter((t) => String(t.status) === 'Approved').length)} approved · ${number(data.transfers.filter((t) => String(t.status) === 'Completed').length)} completed`}
            deltaTone="flat"
            icon={<ClipboardList size={20} />}
            iconBg="#f3f4f6"
            iconColor="#1f2937"
            delay={400}
          />
        </div>
      )}

      {/* Orders supplement (ORD): pending + top cashier from loaded orders only */}
      {(() => {
        const pending = data.orders.filter((o) => statusOf(o) === 'pending').length;
        const byCashier = new Map<string, { orders: number; revenue: number }>();
        for (const o of data.orders.filter((row) => countsAsSale(row) && orderValue(row) > 0)) {
          const name = String(o.cashier_name ?? o.created_by ?? '').trim();
          if (name === '') continue;
          const cur = byCashier.get(name) ?? { orders: 0, revenue: 0 };
          cur.orders += 1;
          cur.revenue += orderValue(o);
          byCashier.set(name, cur);
        }
        const top = [...byCashier.entries()].sort((a, b) => b[1].revenue - a[1].revenue)[0];
        if (pending === 0 && !top) return null;
        return (
          <div className="ch-grid-stats">
            <StatCard
              label="Pending orders"
              value={number(pending)}
              delta={pending > 0 ? 'Awaiting review' : 'Queue clear'}
              deltaTone={pending > 0 ? 'down' : 'up'}
              icon={<ClipboardList size={20} />}
              iconBg="#fef1e1"
              iconColor="#b45309"
              delay={400}
            />
            {top && (
              <StatCard
                label="Top cashier"
                value={top[0]}
                delta={`${number(top[1].orders)} orders · ${currency(top[1].revenue)}`}
                deltaTone="flat"
                icon={<Users size={20} />}
                delay={420}
              />
            )}
          </div>
        );
      })()}

      {stats.lowStock.length > 0 && (
        <div className="ch-alert ch-alert-error reveal" role="alert">
          <AlertTriangle size={15} style={{ verticalAlign: '-2px' }} aria-hidden="true" />
          <span>{stats.lowStock.length} product{stats.lowStock.length === 1 ? ' is' : 's are'} low on stock. <Link to="/inventory">Review inventory</Link></span>
        </div>
      )}
    </div>
  );
}
