import PageIcon from '../components/ui/PageIcon';
import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Eye, Printer, ReceiptText } from 'lucide-react';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import FilterBar from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../context/AuthContext';
import { exportOrdersCsv, getOrderDetail, getOrders, voidOrder } from '../services/orderService';
import { fetchPrintJob, sendCompanyPrintJob, type PrintJob, type PrintTemplate } from '../services/printService';
import { getCustomers } from '../services/customerService';
import { getUsers } from '../services/userService';
import { currency, formatDate, number } from '../utils/format';
import type { Customer, Order, OrderDetail, PosUser } from '../types';
import './Orders.css';

function orderDate(o: Order): string {
  return String(o.CREATEDTIME ?? '');
}

function orderLabel(o: Order): string {
  return o.invoice_number && o.invoice_number !== '' ? o.invoice_number : `#${String(o.ROWID)}`;
}

const STATUS_OPTIONS = [
  'Pending',
  'Paid',
  'Partially Paid',
  'Unpaid',
  'Completed',
  'Synced',
  'Refunded',
  'Voided',
  'Cancelled',
];

const PAYMENT_STATUS_OPTIONS = ['Paid', 'Partially Paid', 'Unpaid', 'Pending', 'Void', 'Refunded'];

type DatePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom';

function dayStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function presetRange(preset: DatePreset): { from: string; to: string } {
  const today = new Date();
  if (preset === 'today') {
    const t = dayStr(today);
    return { from: t, to: t };
  }
  if (preset === 'yesterday') {
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    const s = dayStr(y);
    return { from: s, to: s };
  }
  if (preset === 'week') {
    const w = new Date(today);
    w.setDate(w.getDate() - 6);
    return { from: dayStr(w), to: dayStr(today) };
  }
  if (preset === 'month') {
    return { from: dayStr(today).slice(0, 7) + '-01', to: dayStr(today) };
  }
  return { from: '', to: '' };
}

export default function Orders() {
  const { role } = useAuth();
  const [orders, setOrders] = useState<Array<Order>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [params] = useSearchParams();
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [status, setStatus] = useState(() => params.get('status') ?? 'all');
  const [payment, setPayment] = useState(params.get('payment') ?? 'all');
  const [paymentStatus, setPaymentStatus] = useState('all');
  const [customer, setCustomer] = useState(params.get('customer') ?? '');
  const [cashier, setCashier] = useState(params.get('cashier') ?? '');
  const [preset, setPreset] = useState<DatePreset>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [customers, setCustomers] = useState<Array<Customer>>([]);
  const [users, setUsers] = useState<Array<PosUser>>([]);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);

  const effectiveRole = role;
  const canVoid = effectiveRole === 'Admin';

  // ORD-04: every filter runs on the server; the page only renders results.
  const load = () => {
    setLoading(true);
    setError('');
    const range = preset === 'custom' ? { from: dateFrom, to: dateTo } : presetRange(preset);
    getOrders({
      status,
      payment,
      payment_status: paymentStatus,
      customer: customer.trim(),
      cashier: cashier.trim(),
      date_from: range.from,
      date_to: range.to,
      search: search.trim(),
      limit: 200,
    })
      .then(setOrders)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load orders'))
      .finally(() => setLoading(false));
  };

  // Debounced server reload (search-as-you-type stays server-side).
  useEffect(() => {
    const t = window.setTimeout(load, search.trim() === '' ? 0 : 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, status, payment, paymentStatus, customer, cashier, preset, dateFrom, dateTo]);

  // Autocomplete sources (best-effort; filters accept free text regardless).
  useEffect(() => {
    getCustomers().catch(() => [] as Array<Customer>).then(setCustomers).catch(() => undefined);
    getUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  // Stay in sync with workspace deep links (e.g. pipeline → ?status=synced).
  useEffect(() => {
    const s = params.get('status');
    if (s !== null) setStatus(s);
    const p = params.get('payment');
    if (p !== null) setPayment(p);
    const c = params.get('customer');
    if (c !== null) setCustomer(c);
    const k = params.get('cashier');
    if (k !== null) setCashier(k);
    const q = params.get('search');
    if (q !== null) setSearch(q);
  }, [params]);

  const payments = useMemo(() => {
    const set = new Set(orders.map((o) => o.payment_mode ?? 'Unknown').filter(Boolean));
    return ['all', ...Array.from(set).sort()];
  }, [orders]);

  const customerOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<string> = [];
    for (const c of customers) {
      for (const v of [c.name, c.email ?? '', c.phone ?? '']) {
        const s = String(v ?? '').trim();
        if (s !== '' && !seen.has(s.toLowerCase())) {
          seen.add(s.toLowerCase());
          out.push(s);
        }
      }
      if (out.length >= 60) break;
    }
    return out;
  }, [customers]);

  const cashierOptions = useMemo(
    () =>
      users.map((u) => ({
        name: u.name || u.email,
        email: u.email,
        role: u.role === 'master_admin' ? 'Admin' : u.role,
      })),
    [users],
  );

  const total = useMemo(() => orders.reduce((s, o) => s + (Number(o.total) || 0), 0), [orders]);

  const openDetail = (o: Order) => {
    setDetail(null);
    setDetailLoading(true);
    getOrderDetail(o.ROWID ?? '')
      .then(setDetail)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load order details'))
      .finally(() => setDetailLoading(false));
  };

  const [printBusy, setPrintBusy] = useState(false);
  // Preloaded printer list: reprint payloads arrive async (fetchPrintJob),
  // so resolving the printer from state keeps the browser-popup path as
  // close to the click as possible instead of adding another await.

  const reprint = (orderId: string, template: PrintTemplate) => {
    setPrintBusy(true);
    setError('');
    fetchPrintJob(orderId, template)
      .then((res) => {
        const p = res.payload as Record<string, unknown>;
        const station = template === 'bill' ? 'counter' : template === 'bar' ? 'bar' : 'kitchen';
        const job: PrintJob = {
          jobId: res.jobId, template, station, printerId: null, printerName: `${station} (default)`, copies: 1,
          payload: template === 'bill' ? { receipt: p.receipt } : p as PrintJob['payload'],
        };
        return sendCompanyPrintJob(job)
          .then((result) => { if (!result.ok) setError(result.error ?? 'Reprint failed.'); })
          .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Reprint failed'));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Reprint failed'))
      .finally(() => setPrintBusy(false));
  };

  const doVoid = () => {
    if (detail === null) return;
    setVoidBusy(true);
    voidOrder(detail.order_id, 'Voided from Orders detail view')
      .then((res) => {
        setNotice(res.message ?? 'Order voided.');
        setDetail(null);
        load();
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Void failed'))
      .finally(() => setVoidBusy(false));
  };

  const resetAll = () => {
    setSearch('');
    setStatus('all');
    setPayment('all');
    setPaymentStatus('all');
    setCustomer('');
    setCashier('');
    setPreset('all');
    setDateFrom('');
    setDateTo('');
  };

  if (loading && orders.length === 0) return <Loader message="Loading orders…" skeleton="page" />;
  if (error !== '' && orders.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div>
      <div className="ch-page-head"><PageIcon />
        <div>
          <h1 className="ch-page-title">Orders</h1>
          <p className="ch-page-sub">{orders.length} orders · {currency(total)} total.</p>
        </div>
        <div className="ch-page-actions">
          <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={() => exportOrdersCsv(orders)}>
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}

      <Card title="Orders">
        <div className="ch-toolbar">
          <SearchBar value={search} onChange={setSearch} placeholder="Search order, invoice, customer…" ariaLabel="Search orders" />
          <FilterBar
            filters={[
              {
                key: 'status', value: status, ariaLabel: 'Filter by status', onChange: setStatus,
                options: [{ value: 'all', label: 'All statuses' }, ...STATUS_OPTIONS.map((s) => ({ value: s, label: s }))],
              },
              {
                key: 'ps', value: paymentStatus, ariaLabel: 'Filter by payment status', onChange: setPaymentStatus,
                options: [{ value: 'all', label: 'Any settlement' }, ...PAYMENT_STATUS_OPTIONS.map((s) => ({ value: s, label: s }))],
              },
              {
                key: 'pay', value: payment, ariaLabel: 'Filter by payment', onChange: setPayment,
                options: payments.map((p) => ({ value: p, label: p === 'all' ? 'All payments' : p })),
              },
              {
                key: 'range', value: preset, ariaLabel: 'Filter by date range', onChange: (v) => setPreset(v as DatePreset),
                options: [
                  { value: 'all', label: 'All dates' },
                  { value: 'today', label: 'Today' },
                  { value: 'yesterday', label: 'Yesterday' },
                  { value: 'week', label: 'This week' },
                  { value: 'month', label: 'This month' },
                  { value: 'custom', label: 'Custom…' },
                ],
              },
            ]}
            onReset={resetAll}
          />
          <span className="orders-dates">
            <input
              className="ch-input"
              list="ord-customers"
              aria-label="Filter by customer"
              placeholder="Customer…"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
            />
            <datalist id="ord-customers">
              {customerOptions.map((c) => <option key={c} value={c} />)}
            </datalist>
            <input
              className="ch-input"
              list="ord-cashiers"
              aria-label="Filter by cashier"
              placeholder="Cashier…"
              value={cashier}
              onChange={(e) => setCashier(e.target.value)}
            />
            <datalist id="ord-cashiers">
              {cashierOptions.map((c) => <option key={c.email} value={c.name}>{`${c.role} · ${c.email}`}</option>)}
            </datalist>
            {preset === 'custom' && (
              <>
                <input type="date" className="ch-input" aria-label="From date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                <input type="date" className="ch-input" aria-label="To date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </>
            )}
          </span>
        </div>

        {loading && <p className="ch-hint">Refreshing…</p>}
        {orders.length === 0 ? (
          <EmptyState title="No orders found" message="Try widening the filters, or record a sale in POS." icon={<ReceiptText size={24} />} />
        ) : (
          <Table
            columns={[
              { key: 'n', header: 'Order number', render: (o: Order) => <span className="ch-cell-main">{orderLabel(o)}</span> },
              { key: 'd', header: 'Date', render: (o: Order) => formatDate(orderDate(o)) },
              {
                key: 'c', header: 'Customer', render: (o: Order) => (
                  <span><span className="ch-cell-main">{o.customer_name ?? '—'}</span><br /><span className="ch-cell-sub">{o.customer_email ?? ''}</span></span>
                ),
              },
              { key: 'k', header: 'Cashier', render: (o: Order) => <span className="ch-cell-sub">{o.cashier_name || o.created_by || '—'}</span> },
              { key: 'a', header: 'Amount', numeric: true, render: (o: Order) => currency(o.total) },
              { key: 'p', header: 'Payment', render: (o: Order) => <span><span className="ch-cell-main">{o.payment_mode ?? '—'}</span><br /><StatusBadge status={o.payment_status ?? 'Pending'} /></span> },
              { key: 's', header: 'Status', render: (o: Order) => <StatusBadge status={o.status ?? 'Pending'} /> },
              {
                key: 'v', header: 'Details', render: (o: Order) => (
                  <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => openDetail(o)} aria-label={`View order ${orderLabel(o)}`}>
                    <Eye size={15} /> View
                  </button>
                ),
              },
            ]}
            rows={orders}
            rowKey={(o, i) => `${String(o.ROWID ?? o.invoice_number ?? i)}-${i}`}
          />
        )}
      </Card>

      {/* Order Detail Drawer (large modal — the established detail pattern) */}
      <Modal
        open={detail !== null || detailLoading}
        size="lg"
        title={detail === null ? 'Order details' : `Order ${detail.order_number}`}
        subtitle={detail === null ? (detailLoading ? 'Loading…' : undefined) : formatDate(detail.created_at)}
        onClose={() => setDetail(null)}
        footer={
          detail === null ? (
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDetail(null)}>Close</button>
          ) : (
            <>
              <button type="button" className="ch-btn ch-btn-secondary" onClick={() => reprint(detail.order_id, 'bill')} disabled={printBusy}>
                <Printer size={14} /> Bill
              </button>
              <button type="button" className="ch-btn ch-btn-secondary" onClick={() => reprint(detail.order_id, 'kot')} disabled={printBusy}>
                <Printer size={14} /> KOT
              </button>
              {canVoid && detail.status !== 'Voided' && (
                <button type="button" className="ch-btn ch-btn-danger" onClick={doVoid} disabled={voidBusy}>
                  {voidBusy ? 'Voiding…' : 'Void order'}
                </button>
              )}
              <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setDetail(null)}>Close</button>
            </>
          )
        }
      >
        {detailLoading && detail === null && <Loader message="Loading order…" />}
        {detail !== null && (
          <div>
            {/* 1 — Order summary */}
            <h4 className="cust-h">Order summary</h4>
            <dl className="ws-dl">
              <div><dt>Order number</dt><dd><b>{detail.order_number}</b></dd></div>
              <div><dt>Date</dt><dd>{formatDate(detail.created_at)}</dd></div>
              <div><dt>Status</dt><dd><StatusBadge status={detail.status} /></dd></div>
              <div><dt>Payment status</dt><dd><StatusBadge status={detail.payment_status} /></dd></div>
              <div><dt>Cashier</dt><dd>{detail.cashier.name || '—'}{detail.cashier.role ? ` · ${detail.cashier.role}` : ''}</dd></div>
            </dl>

            {/* 2 — Customer */}
            <h4 className="cust-h">Customer</h4>
            <dl className="ws-dl">
              <div><dt>Name</dt><dd>{detail.customer.name}</dd></div>
              <div><dt>Phone</dt><dd>{detail.customer.phone || '—'}</dd></div>
              <div><dt>Email</dt><dd>{detail.customer.email || '—'}</dd></div>
              <div><dt>Loyalty tier</dt><dd>{detail.customer.tier !== '' ? <StatusBadge status={detail.customer.tier} /> : '—'}</dd></div>
              <div>
                <dt>Points</dt>
                <dd>{number(detail.customer.loyalty_points)} <span className="ch-cell-sub">({number(detail.customer.lifetime_points)} lifetime)</span></dd>
              </div>
              <div><dt>Lifetime value</dt><dd><b>{currency(detail.customer.lifetime_value)}</b></dd></div>
            </dl>
            {detail.customer.email !== '' && detail.customer.email !== 'walkin@pos.system' && (
              <div className="ch-row" style={{ marginBottom: 8 }}>
                <Link to={`/customers?search=${encodeURIComponent(detail.customer.email)}`} className="ch-btn ch-btn-ghost ch-btn-sm">
                  Open customer profile
                </Link>
              </div>
            )}

            {/* 3 — Line items */}
            <h4 className="cust-h">Line items ({detail.items.length})</h4>
            <Table
              columns={[
                { key: 'p', header: 'Product', render: (l: OrderDetail['items'][number]) => <span><span className="ch-cell-main">{l.product_name}</span>{l.sku !== '' && <><br /><span className="ch-cell-sub">{l.sku}</span></>}</span> },
                { key: 'q', header: 'Qty', numeric: true, render: (l) => number(l.quantity) },
                { key: 'r', header: 'Price', numeric: true, render: (l) => currency(l.unit_price) },
                { key: 'd', header: 'Discount', numeric: true, render: (l) => (l.discount > 0 ? `−${currency(l.discount)}` : '—') },
                { key: 't', header: 'Tax', numeric: true, render: (l) => currency(l.tax) },
                { key: 'lt', header: 'Line total', numeric: true, render: (l) => <b>{currency(l.line_total)}</b> },
              ]}
              rows={detail.items}
              rowKey={(_l, i) => `line-${i}`}
              minWidth={560}
            />

            {/* 4 — Payments */}
            <h4 className="cust-h">Payment breakdown</h4>
            <Table
              columns={[
                { key: 'm', header: 'Method', render: (p: OrderDetail['payments'][number]) => <span className="ch-cell-main">{p.method || '—'}</span> },
                { key: 'a', header: 'Amount', numeric: true, render: (p) => <b>{currency(p.amount)}</b> },
              ]}
              rows={detail.payments}
              rowKey={(_p, i) => `pay-${i}`}
              minWidth={280}
            />
            {detail.payments.length > 1 && (
              <p className="ch-hint">Split payment across {detail.payments.length} methods.</p>
            )}

            {/* 5 — Totals */}
            <h4 className="cust-h">Totals</h4>
            <dl className="ws-dl">
              <div><dt>Subtotal</dt><dd>{currency(detail.subtotal)}</dd></div>
              <div><dt>Discount{detail.discount_percent > 0 ? ` (${detail.discount_percent}%)` : ''}</dt><dd>−{currency(detail.discount_amount)}</dd></div>
              <div><dt>Tax</dt><dd>{currency(detail.tax_amount)}</dd></div>
              <div><dt>Grand total</dt><dd><b>{currency(detail.total_amount)}</b></dd></div>
              <div><dt>Paid</dt><dd>{currency(detail.paid_total)}</dd></div>
              <div><dt>Balance due</dt><dd><b>{currency(detail.balance_due)}</b></dd></div>
              <div><dt>Invoice</dt><dd className="orders-mono">{detail.books_invoice_id || '—'}</dd></div>
              <div><dt>Reference</dt><dd className="orders-mono">{detail.local_ref || '—'}</dd></div>
            </dl>

            {/* 6 — Inventory impact */}
            <h4 className="cust-h">Inventory impact ({detail.inventory.movement_count})</h4>
            {detail.inventory.movements.length === 0 ? (
              <p className="ch-hint">No stock movements recorded for this order.</p>
            ) : (
              <Table
                columns={[
                  { key: 'i', header: 'Product', render: (m: OrderDetail['inventory']['movements'][number]) => <span><span className="ch-cell-main">{m.item_name}</span><br /><span className="ch-cell-sub">{m.movement_type}</span></span> },
                  { key: 'q', header: 'Change', numeric: true, render: (m) => <b>{m.quantity_change > 0 ? `+${number(m.quantity_change)}` : number(m.quantity_change)}</b> },
                  { key: 's', header: 'Stock', numeric: true, render: (m) => <span className="ch-cell-sub">{number(m.stock_before)} → {number(m.stock_after)}</span> },
                ]}
                rows={detail.inventory.movements}
                rowKey={(m, i) => `${m.id}-${i}`}
                minWidth={420}
              />
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
