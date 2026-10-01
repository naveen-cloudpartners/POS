import PageIcon from '../components/ui/PageIcon';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Undo2 } from 'lucide-react';
import Card from '../components/ui/Card';
import Table from '../components/ui/Table';
import Modal from '../components/ui/Modal';
import SearchBar from '../components/ui/SearchBar';
import StatusBadge from '../components/ui/StatusBadge';
import StatCard from '../components/ui/StatCard';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../context/AuthContext';
import { getOrderDetail, getOrders, returnOrder } from '../services/orderService';
import { getStockMovements, type StockMovement } from '../services/inventoryService';
import { getPaymentMethods } from '../services/settingsService';
import { currency, formatDate, number } from '../utils/format';
import type { Order, OrderDetail } from '../types';
import './WorkspaceView.css';

interface ReturnQty {
  [productId: string]: string;
}

export default function Returns() {
  const { role } = useAuth();
  const [orders, setOrders] = useState<Array<Order>>([]);
  const [returns, setReturns] = useState<Array<StockMovement>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<OrderDetail | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [qtys, setQtys] = useState<ReturnQty>({});
  const [reason, setReason] = useState('');
  const [refundMode, setRefundMode] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ refund_total?: number; fully_refunded?: boolean; message?: string } | null>(null);
  const [refundModes, setRefundModes] = useState<Array<string>>(['Cash', 'Card', 'Bank']);

  const effectiveRole = role;
  const canProcess = ['Admin', 'Manager'].includes(effectiveRole);

  const load = () => {
    setLoading(true);
    setError('');
    getPaymentMethods()
      .then((methods) => {
        const enabled = methods.filter((m) => m.enabled).map((m) => m.mode);
        if (enabled.length > 0) {
          setRefundModes(enabled);
          setRefundMode((prev) => (enabled.includes(prev) ? prev : enabled[0] ?? 'Cash'));
        }
      })
      .catch(() => undefined);
    Promise.all([
      getOrders({ limit: 200 }).catch(() => [] as Array<Order>),
      getStockMovements({ type: 'RETURN' }).then((r) => r.rows).catch(() => [] as Array<StockMovement>),
    ])
      .then(([o, r]) => {
        setOrders(o);
        setReturns(r);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load returns'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q === '') return orders.filter((o) => !['voided', 'cancelled', 'refunded'].includes(String(o.status ?? '').toLowerCase()));
    return orders.filter((o) =>
      String(o.invoice_number ?? '').toLowerCase().includes(q)
      || String(o.ROWID ?? '').includes(q)
      || (o.customer_name ?? '').toLowerCase().includes(q)
      || (o.customer_email ?? '').toLowerCase().includes(q),
    );
  }, [orders, search]);

  const openReturn = (o: Order) => {
    setTarget(null);
    setResult(null);
    setFormError('');
    setReason('');
    setQtys({});
    setTargetLoading(true);
    setRefundMode(o.payment_mode ?? 'Cash');
    getOrderDetail(o.ROWID ?? '')
      .then((d) => {
        setTarget(d);
        if (d) {
          const init: ReturnQty = {};
          for (const l of d.items) init[l.product_id] = '';
          setQtys(init);
        }
      })
      .catch((e: unknown) => setFormError(e instanceof Error ? e.message : 'Failed to load order details'))
      .finally(() => setTargetLoading(false));
  };

  const submit = () => {
    if (target === null) return;
    const items = target.items
      .map((l) => ({ product_id: l.product_id, quantity: Number(qtys[l.product_id] ?? 0) }))
      .filter((l) => l.quantity > 0);
    if (items.length === 0) {
      setFormError('Enter a return quantity for at least one line.');
      return;
    }
    setBusy(true);
    setFormError('');
    returnOrder(target.order_id, { items, reason: reason.trim() || 'Customer return', refund_mode: refundMode })
      .then((res) => {
        setResult(res);
        setNotice(res.message ?? 'Return processed.');
        load();
      })
      .catch((e: unknown) => setFormError(e instanceof Error ? e.message : 'Return failed'))
      .finally(() => setBusy(false));
  };

  if (loading) return <Loader message="Loading returns…" skeleton="page" />;
  if (error !== '' && orders.length === 0) return <ErrorState message={error} onRetry={load} />;

  const refundedValue = returns.length; // count-based; values shown per row via reason text

  return (
    <div>
      <div className="ch-page-head"><PageIcon />
        <div>
          <h1 className="ch-page-title">Returns</h1>
          <p className="ch-page-sub">Return merchandise authorisations against settled orders.</p>
        </div>
        <div className="ch-page-actions">
          <Link to="/sales/orders" className="ch-btn ch-btn-secondary ch-btn-sm">Browse orders</Link>
        </div>
      </div>

      {notice !== '' && <div className="ch-alert ch-alert-success">{notice}</div>}
      {error !== '' && <div className="ch-alert ch-alert-error">{error}</div>}
      {!canProcess && (
        <div className="ch-alert ch-alert-info">Only Admins and Managers can process returns (store policy).</div>
      )}

      <div className="ch-grid-stats">
        <StatCard label="Return events" value={number(refundedValue)} icon={<Undo2 size={20} />} delay={40} />
        <StatCard
          label="Eligible orders"
          value={number(orders.filter((o) => !['voided', 'cancelled', 'refunded'].includes(String(o.status ?? '').toLowerCase())).length)}
          icon={<Undo2 size={20} />}
          iconBg="#e3f6ec"
          iconColor="#287c52"
          delay={100}
        />
      </div>

      <div className="ws-grid-2">
        <Card title="Find an order" subtitle="Search by invoice, customer or email" delay={80}>
          <SearchBar value={search} onChange={setSearch} placeholder="Search orders…" ariaLabel="Search orders" />
          {filteredOrders.length === 0 ? (
            <p className="ch-hint" style={{ marginTop: 10 }}>No eligible orders match.</p>
          ) : (
            <Table
              columns={[
                { key: 'n', header: 'Order', render: (o: Order) => <span className="ch-cell-main">{o.invoice_number && o.invoice_number !== '' ? o.invoice_number : `#${String(o.ROWID)}`}</span> },
                { key: 'c', header: 'Customer', render: (o: Order) => <span className="ch-cell-sub">{o.customer_name ?? '—'}</span> },
                { key: 't', header: 'Total', numeric: true, render: (o: Order) => <b>{currency(o.total)}</b> },
                {
                  key: 'a', header: '', render: (o: Order) => (
                    <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" disabled={!canProcess} onClick={() => openReturn(o)}>
                      Return <ArrowRight size={13} />
                    </button>
                  ),
                },
              ]}
              rows={filteredOrders.slice(0, 8)}
              rowKey={(o, i) => `${String(o.ROWID ?? i)}-${i}`}
              minWidth={360}
            />
          )}
          <h4 className="cust-h">Return workflow</h4>
          <ol className="ws-steps">
            <li><b>Locate the order</b><span className="ch-cell-sub">Search by invoice number or customer.</span></li>
            <li><b>Verify items & condition</b><span className="ch-cell-sub">Confirm quantities before approving the refund.</span></li>
            <li><b>Refund & restock</b><span className="ch-cell-sub">Refund to the original method; stock restores with an audited RETURN movement.</span></li>
          </ol>
        </Card>

        <Card title="Recent returns" subtitle="Latest RETURN movements" delay={120}>
          {returns.length === 0 ? (
            <EmptyState
              title="No returns recorded"
              message="Approved returns will appear here with the original order, refund method and restock status."
              icon={<Undo2 size={26} />}
            />
          ) : (
            <Table
              columns={[
                { key: 'p', header: 'Product', render: (m: StockMovement) => <span className="ch-cell-main">{m.item_name || m.sku}</span> },
                { key: 'q', header: 'Qty', numeric: true, render: (m: StockMovement) => <b>+{number(m.quantity_change)}</b> },
                { key: 'd', header: 'Date', render: (m: StockMovement) => <span className="ch-cell-sub">{m.created_at ? formatDate(m.created_at) : '—'}</span> },
              ]}
              rows={returns.slice(0, 8)}
              rowKey={(m, i) => `${String(m.ROWID ?? i)}-${i}`}
              minWidth={300}
            />
          )}
          <dl className="ws-dl" style={{ marginTop: 12 }}>
            <div><dt>Return window</dt><dd>14 days with receipt</dd></div>
            <div><dt>Refund method</dt><dd>Original payment method</dd></div>
            <div><dt>Approval</dt><dd>Manager and above</dd></div>
          </dl>
        </Card>
      </div>

      <Modal
        open={target !== null || targetLoading}
        title={target === null ? 'Process return' : `Return — order ${target.order_number}`}
        subtitle={target === null ? undefined : `${target.customer.name} · ${currency(target.total_amount)} · ${target.status}`}
        onClose={() => { setTarget(null); setResult(null); }}
        footer={
          result !== null ? (
            <button type="button" className="ch-btn ch-btn-secondary" onClick={() => { setTarget(null); setResult(null); }}>Close</button>
          ) : (
            <>
              <button type="button" className="ch-btn ch-btn-secondary" onClick={() => setTarget(null)} disabled={busy}>Cancel</button>
              <button type="button" className="ch-btn ch-btn-primary" onClick={submit} disabled={busy || target === null}>
                {busy ? 'Processing…' : 'Process return'}
              </button>
            </>
          )
        }
      >
        {targetLoading && <Loader message="Loading order…" />}
        {formError !== '' && <p className="ch-form-error">{formError}</p>}
        {result !== null && (
          <div className="ch-alert ch-alert-success">
            Refund {currency(result.refund_total ?? 0)}{result.fully_refunded === true ? ' — order fully refunded.' : '.'}
          </div>
        )}
        {target !== null && result === null && (
          <>
            <div style={{ marginBottom: 8 }}>
              <StatusBadge status={target.status} /> <StatusBadge status={target.payment_status} />
            </div>
            <Table
              columns={[
                { key: 'p', header: 'Product', render: (l: OrderDetail['items'][number]) => <span><span className="ch-cell-main">{l.product_name}</span><br /><span className="ch-cell-sub">bought {number(l.quantity)}</span></span> },
                {
                  key: 'q', header: 'Return qty', render: (l: OrderDetail['items'][number]) => (
                    <input
                      className="ch-input"
                      type="number"
                      min="0"
                      max={l.quantity}
                      step="1"
                      style={{ maxWidth: 90 }}
                      value={qtys[l.product_id] ?? ''}
                      onChange={(e) => setQtys((prev) => ({ ...prev, [l.product_id]: e.target.value }))}
                      aria-label={`Return quantity for ${l.product_name}`}
                    />
                  ),
                },
              ]}
              rows={target.items}
              rowKey={(_l, i) => `ret-${i}`}
              minWidth={300}
            />
            <div className="ch-form-grid" style={{ marginTop: 12 }}>
              <div className="ch-field">
                <label className="ch-label" htmlFor="ret-mode">Refund method</label>
                <select id="ret-mode" className="ch-select" value={refundMode} onChange={(e) => setRefundMode(e.target.value)}>
                  {refundModes.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="ret-reason">Reason</label>
                <input id="ret-reason" className="ch-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer return" />
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
