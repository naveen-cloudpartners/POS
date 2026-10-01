import PageIcon from '../components/ui/PageIcon';
import { useEffect, useMemo, useState } from 'react';
import { Search, Minus, Plus, Trash2, User, Banknote, CreditCard, Landmark, CheckCircle2, ShoppingBag, X, Printer, Download, Mail, Ban } from 'lucide-react';
import Loader from '../components/ui/Loader';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { getProducts } from '../services/productService';
import { checkout, sendReceiptEmail, voidOrder, type PosReceipt } from '../services/orderService';
import { getCustomers } from '../services/customerService';
import { getPaymentMethods, getSettings, getSmtpStatus, getTaxSettings, type TaxSettings } from '../services/settingsService';
import { sendCompanyPrintJob, type KotJobPayload, type PrintJob } from '../services/printService';
import { useAuth } from '../context/AuthContext';
import { currency, number, isLowStock, isOutOfStock } from '../utils/format';
import { calcTotals, type TaxOpts } from '../utils/tax';
import type { Customer, Product } from '../types';
import './Pos.css';
import ProductImage from '../components/ui/ProductImage';

interface CartLine {
  product: Product;
  qty: number;
  /** Line discount value as typed (percent 0–100 or flat amount). */
  discVal: string;
  discType: 'percent' | 'flat';
}

type PayMode = 'Cash' | 'Card' | 'Bank';

interface SplitLeg {
  mode: PayMode;
  amount: string;
}

/* Canonical sale math lives in utils/tax (mirrors posNormalizeLine /
   posTotalsFor on the backend, SET-02 tax mode included) so tender
   validation agrees. The local round2 below serves split-tender inputs. */
function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export default function Pos() {
  const { role } = useAuth();
  const canVoid = role === 'Admin' || role === 'Manager';
  const [products, setProducts] = useState<Array<Product>>([]);
  const [customers, setCustomers] = useState<Array<Customer>>([]);
  const [store, setStore] = useState({ store_name: '', company: '', currency: 'LKR' });
  const [smtpReady, setSmtpReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [cart, setCart] = useState<Array<CartLine>>([]);
  const [customerName, setCustomerName] = useState('Walk-in Guest');
  const [customerEmail, setCustomerEmail] = useState('');
  const [discountPct, setDiscountPct] = useState('0');
  const [payMode, setPayMode] = useState<PayMode>('Cash');
  const [split, setSplit] = useState(false);
  const [splits, setSplits] = useState<Array<SplitLeg>>([{ mode: 'Cash', amount: '' }]);
  const [mailReceipt, setMailReceipt] = useState(false);
  const [receiptEmail, setReceiptEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [receipt, setReceipt] = useState<PosReceipt | null>(null);
  const [showReceipt, setShowReceipt] = useState(false);
  const [printJobs, setPrintJobs] = useState<Array<PrintJob>>([]);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailMsg, setEmailMsg] = useState('');
  const [printMessage, setPrintMessage] = useState('');
  const [receiptPrinting, setReceiptPrinting] = useState(false);
  const [voidConfirm, setVoidConfirm] = useState(false);
  const [voidBusy, setVoidBusy] = useState(false);
  // SET-02: live tax mode (exclusive default preserves legacy math).
  const [taxOpts, setTaxOpts] = useState<TaxOpts>({ mode: 'exclusive', round: true });
  const [taxName, setTaxName] = useState('Tax');
  const [taxSettings, setTaxSettings] = useState<TaxSettings | null>(null);
  const [taxSelection, setTaxSelection] = useState('default');
  const selectedTaxRate = !taxSettings?.enabled ? 0
    : taxSelection === 'default' ? taxSettings.default_rate
    : taxSettings.profiles[Number(taxSelection)]?.rate ?? taxSettings.default_rate;
  // SET-05: tender methods offered follow Settings → Payment methods.
  const [tenderModes, setTenderModes] = useState<Array<PayMode>>(['Cash', 'Card', 'Bank']);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([getProducts(), getCustomers().catch(() => []), getTaxSettings()])
      .then(([items, custs, tax]) => {
        if (tax === null) throw new Error('Unable to load tax settings. Please retry before checkout.');
        setProducts(items);
        setCustomers(custs);
        setTaxSettings(tax);
        setTaxSelection('default');
        setTaxOpts({ mode: tax.enabled ? tax.mode : 'exclusive', round: tax.round });
        setTaxName(tax.name || 'Tax');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Failed to load catalog'))
      .finally(() => setLoading(false));
    getSettings().then((s) => setStore({
      store_name: String(s.store_name ?? ''),
      company: String(s.company ?? ''),
      currency: String(s.currency ?? 'LKR'),
    })).catch(() => undefined);
    getPaymentMethods()
      .then((methods) => {
        const enabled = methods.filter((m) => m.enabled).map((m) => m.mode as PayMode);
        if (enabled.length > 0) {
          setTenderModes(enabled);
          setPayMode((prev) => (enabled.includes(prev) ? prev : enabled[0] as PayMode));
          setSplits((prev) => prev.map((l) => (enabled.includes(l.mode) ? l : { ...l, mode: enabled[0] as PayMode })));
        }
      })
      .catch(() => undefined);
    getSmtpStatus().then((s) => setSmtpReady(s.configured)).catch(() => undefined);
  };

  useEffect(load, []);

  const categories = useMemo(() => {
    const set = new Set(products.map((p) => p.category || 'General'));
    return ['all', ...Array.from(set).sort()];
  }, [products]);

  const catCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) m.set(p.category || 'General', (m.get(p.category || 'General') ?? 0) + 1);
    return m;
  }, [products]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== 'all' && (p.category || 'General') !== category) return false;
      if (q === '') return true;
      return p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
    });
  }, [products, search, category]);

  const stockOf = (p: Product): number => Number(p.stock) || 0;

  const addToCart = (p: Product) => {
    setReceipt(null);
    setPrintJobs([]);
    const key = String(p.ROWID ?? p.sku);
    setCart((prev) => {
      const found = prev.find((l) => String(l.product.ROWID ?? l.product.sku) === key);
      const cur = found?.qty ?? 0;
      if (cur + 1 > stockOf(p)) {
        setMessage({ kind: 'err', text: `Only ${number(stockOf(p))} × ${p.name} in stock.` });
        return prev;
      }
      setMessage(null);
      if (found) {
        return prev.map((l) => (l === found ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { product: p, qty: 1, discVal: '0', discType: 'percent' }];
    });
  };

  const setQty = (index: number, qty: number) => {
    const line = cart[index];
    if (line === undefined) return;
    qty = Math.floor(Number(qty));
    if (!Number.isFinite(qty)) return;
    if (qty <= 0) {
      setCart((prev) => prev.filter((_, i) => i !== index));
      return;
    }
    const cap = stockOf(line.product);
    if (qty > cap) {
      setMessage({ kind: 'err', text: `Only ${number(cap)} × ${line.product.name} in stock.` });
      qty = cap;
    }
    setCart((prev) => prev.map((l, i) => (i === index ? { ...l, qty } : l)));
  };

  const removeLine = (index: number) => {
    setCart((prev) => prev.filter((_, i) => i !== index));
  };

  const setLineDisc = (index: number, patch: Partial<Pick<CartLine, 'discVal' | 'discType'>>) => {
    setCart((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };

  const scanBarcode = () => {
    const code = search.trim().toLowerCase();
    if (code === '') return;
    const hit = products.find((p) => p.sku.toLowerCase() === code || p.name.toLowerCase() === code);
    if (hit) {
      addToCart(hit);
      setSearch('');
      setMessage(null);
    } else {
      setMessage({ kind: 'err', text: `No product matches "${search.trim()}".` });
    }
  };

  // POS-04: picking a known customer fills their email automatically.
  const onCustomerName = (value: string) => {
    setCustomerName(value);
    const hit = customers.find((c) => c.name.toLowerCase() === value.trim().toLowerCase());
    if (hit?.email) setCustomerEmail(hit.email);
  };

  const totals = useMemo(() => {
    const calc = calcTotals(
      cart.map((l) => ({
        qty: l.qty,
        rate: Number(l.product.rate) || 0,
        taxPct: selectedTaxRate,
        discVal: Number(l.discVal) || 0,
        discType: l.discType,
      })),
      Number(discountPct) || 0,
      taxOpts,
    );
    const itemDisc = round2(cart.reduce((s, l) => {
      const gross = round2(Number(l.product.rate || 0) * l.qty);
      const dv = Math.max(0, Number(l.discVal) || 0);
      return s + (l.discType === 'flat' ? Math.min(dv, gross) : round2((gross * Math.min(dv, 100)) / 100));
    }, 0));
    return { sub: calc.sub, tax: calc.tax, itemDisc, orderDisc: calc.orderDisc, total: calc.total, taxMode: taxOpts.mode };
  }, [cart, discountPct, taxOpts, selectedTaxRate]);

  const itemCount = cart.reduce((s, l) => s + l.qty, 0);

  // POS-08/11: split tender legs; paid must equal the total.
  const paidTotal = useMemo(() => {
    if (!split) return totals.total;
    return round2(splits.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  }, [split, splits, totals.total]);
  const tenderDiff = round2(paidTotal - totals.total);
  const tenderOk = Math.abs(tenderDiff) < 0.015;

  const setSplitLeg = (index: number, patch: Partial<SplitLeg>) => {
    setSplits((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  };
  const addSplitLeg = () => {
    if (splits.length >= 3) return;
    const used = new Set(splits.map((l) => l.mode));
    const next = tenderModes.find((m) => !used.has(m)) ?? tenderModes[0] ?? 'Cash';
    setSplits((prev) => [...prev, { mode: next, amount: '' }]);
  };
  const removeSplitLeg = (index: number) => {
    setSplits((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  };

  const submit = () => {
    if (cart.length === 0 || busy) return;
    if (split && !tenderOk) {
      setMessage({ kind: 'err', text: `Split total (${currency(paidTotal)}) must equal order total (${currency(totals.total)}).` });
      return;
    }
    setBusy(true);
    setMessage(null);
    setPrintMessage('');
    const mailTo = (receiptEmail.trim() === '' ? customerEmail.trim() : receiptEmail.trim());
    checkout({
      customer_name: customerName.trim() === '' ? 'Walk-in Guest' : customerName.trim(),
      customer_email: customerEmail.trim() === '' ? undefined : customerEmail.trim(),
      payment_mode: payMode,
      line_items: cart.map((l) => ({
        books_item_id: l.product.books_item_id ?? '',
        item_id: String(l.product.ROWID ?? l.product.sku),
        quantity: l.qty,
        rate: Number(l.product.rate) || 0,
        tax_percentage: selectedTaxRate,
        name: l.product.name,
        discount_value: Number(l.discVal) || 0,
        discount_type: l.discType,
      })),
      discount_pct: Number(discountPct) || 0,
      payments: split
        ? splits.map((l) => ({ mode: l.mode, amount: Number(l.amount) || 0 }))
        : [{ mode: payMode, amount: totals.total }],
      tendered: paidTotal,
      email_receipt: mailReceipt && mailTo !== '',
      receipt_email: mailTo === '' ? undefined : mailTo,
      local_ref: `POS-${Date.now()}`,
    })
      .then((res) => {
        if (res.receipt) {
          const r = { ...res.receipt };
          if (r.store.store_name === '' && store.store_name !== '') {
            r.store = { ...store, currency: r.store.currency || store.currency };
          }
          setReceipt(r);
          setShowReceipt(true);
          setEmailMsg(res.email_sent === true ? 'Receipt emailed.' : '');
          setPrintJobs(Array.isArray(res.print_jobs) ? res.print_jobs.filter((j) => j.template !== 'bill') : []);
          const bill: PrintJob = { jobId: `bill-${r.orderId}`, template: 'bill', station: 'counter', printerId: null, printerName: 'Counter', copies: 1, payload: { receipt: r } };
          setReceiptPrinting(true);
          setPrintMessage('Sending receipt to printer…');
          void sendCompanyPrintJob(bill, true).then((result) => {
            setPrintMessage(result.ok ? (result.transport === 'qz' ? 'Receipt sent to printer.' : 'Use Print to print this receipt.') : `Sale completed. Receipt was not printed: ${result.error} Use Print to retry.`);
          }).finally(() => setReceiptPrinting(false));
        }
        setMessage({ kind: 'ok', text: res.zoho_books?.warning || res.message || 'Sale completed.' });
        setCart([]);
        setSplits([{ mode: 'Cash', amount: '' }]);
        // Silent refresh: stock changed server-side, but a full load()
        // would flash the skeleton and disturb the cashier's context.
        getProducts().then(setProducts).catch(() => undefined);
        getCustomers().then(setCustomers).catch(() => undefined);
      })
      .catch((e: unknown) => setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Checkout failed' }))
      .finally(() => setBusy(false));
  };

  const sendEmail = () => {
    if (receipt === null || emailBusy) return;
    const to = (receiptEmail.trim() === '' ? customerEmail.trim() : receiptEmail.trim());
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setEmailMsg('Enter a valid email address.');
      return;
    }
    setEmailBusy(true);
    setEmailMsg('');
    sendReceiptEmail(receipt.orderId, to)
      .then((ok) => setEmailMsg(ok ? 'Receipt emailed.' : 'Email failed — SMTP may not be configured.'))
      .catch((e: unknown) => setEmailMsg(e instanceof Error ? e.message : 'Email failed.'))
      .finally(() => setEmailBusy(false));
  };

  const submitVoid = () => {
    if (receipt === null || voidBusy) return;
    setVoidBusy(true);
    voidOrder(receipt.orderId, 'Voided at counter')
      .then((res) => {
        setVoidConfirm(false);
        setShowReceipt(false);
        setReceipt(null);
        setMessage({ kind: 'ok', text: res.message ?? 'Order voided. Stock restored.' });
        getProducts().then(setProducts).catch(() => undefined);
      })
      .catch((e: unknown) => {
        setVoidConfirm(false);
        setMessage({ kind: 'err', text: e instanceof Error ? e.message : 'Void failed.' });
      })
      .finally(() => setVoidBusy(false));
  };

  const receiptText = (r: PosReceipt): string => {
    const money = (n: number): string => currency(n);
    const out: Array<string> = [
      r.store.store_name || 'CloudHub POS',
      `Invoice: ${r.invoiceNumber || r.orderId}`,
      `Date: ${r.date}`,
      `Customer: ${r.customerName}`,
      '--------------------------------',
    ];
    for (const l of r.lines) {
      out.push(`${l.name}  ${l.quantity} x ${money(l.rate)} = ${money(l.lineTotal)}`);
      if (l.discount > 0) out.push(`  (discount ${money(l.discount)})`);
    }
    out.push('--------------------------------');
    out.push(`Subtotal: ${money(r.subtotal)}`);
    out.push(`Tax: ${money(r.tax)}`);
    out.push(`Discount: -${money(r.discount)}`);
    out.push(`TOTAL: ${money(r.total)}`);
    for (const p of r.payments) out.push(`${p.mode}: ${money(p.amount)}`);
    return out.join('\n');
  };

  const downloadReceipt = () => {
    if (receipt === null) return;
    const blob = new Blob([receiptText(receipt)], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt-${receipt.invoiceNumber || receipt.orderId}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const dispatchPrintJob = (job: PrintJob) => {
    void sendCompanyPrintJob(job)
      .then((result) => { if (!result.ok) setError(result.error ?? 'Print failed.'); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Print failed.'));
  };

  const printReceipt = () => {
    if (receipt === null || receiptPrinting) return;
    setReceiptPrinting(true);
    void sendCompanyPrintJob({ jobId: `bill-${receipt.orderId}`, template: 'bill', station: 'counter', printerId: null, printerName: 'Counter', copies: 1, payload: { receipt } })
      .then((result) => setPrintMessage(result.ok ? 'Receipt sent to printer.' : result.error ?? 'Print failed.'))
      .catch(() => setPrintMessage('Print failed. Please retry.'))
      .finally(() => setReceiptPrinting(false));
  };

  const printKot = (job: PrintJob) => {
    const payload = job.payload as Partial<KotJobPayload>;
    if (!payload.kotNumber || !Array.isArray(payload.items)) return;
    void dispatchPrintJob(job);
  };

  if (loading) return <Loader message="Loading POS…" skeleton="page" />;
  if (error !== '' && products.length === 0) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="pos-page pos-terminal">
      <div className="ch-page-head reveal"><PageIcon />
        <div>
          <h1 className="ch-page-title">Point of Sale</h1>
          <p className="ch-page-sub">{number(products.length)} products · {number(categories.length - 1)} categories</p>
        </div>
        <div className="ch-page-actions">
          <span className="pos-live-cart"><ShoppingBag size={14} /> {itemCount} in cart · {currency(totals.total)}</span>
        </div>
      </div>

      {message !== null && (
        <div className={message.kind === 'ok' ? 'ch-alert ch-alert-success pos-receipt' : 'ch-alert ch-alert-error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
          {message.kind === 'ok' && <CheckCircle2 size={16} style={{ flexShrink: 0 }} aria-hidden="true" />}
          <span>
            {message.text}
            {receipt !== null && message.kind === 'ok' && (
              <span> Order <strong>#{receipt.orderId}</strong> · Invoice <strong>{receipt.invoiceNumber}</strong> · Total <strong>{currency(receipt.total)}</strong></span>
            )}
          </span>
          <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => { setMessage(null); setReceipt(null); }} aria-label="Dismiss"><X size={14} /></button>
        </div>
      )}

      <div className="pos-layout">
        <button type="button" className="pos-mobile-cart-link ch-btn ch-btn-primary" onClick={() => {
          const cart = document.getElementById('pos-current-sale');
          cart?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          cart?.focus({ preventScroll: true });
        }}><ShoppingBag size={18} /> View cart · {itemCount} items · {currency(totals.total)}</button>
        {/* LEFT — categories + barcode */}
        <section className="pos-col pos-center reveal" aria-label="Product catalog">
          <div className="pos-panel pos-catalog">
            <div className="pos-cats" aria-label="Product categories">
              {categories.map((c) => {
                const n = c === 'all' ? products.length : (catCounts.get(c) ?? 0);
                return (
                  <button
                    key={c}
                    type="button"
                    className={c === category ? 'pos-cat active' : 'pos-cat'}
                    onClick={() => setCategory(c)}
                    aria-pressed={c === category}
                  >
                    <span className="pos-cat-lbl">{c === 'all' ? 'All items' : c}</span>
                    <span className="pos-cat-n">{n}</span>
                  </button>
                );
              })}
            </div>
            <div className="pos-center-head">
              <div>
                <h3 className="pos-panel-title">Products</h3>
                <p className="pos-panel-sub">{visible.length} shown{category !== 'all' ? ` in ${category}` : ''}</p>
              </div>
              <span className="pos-search">
                <Search size={15} aria-hidden="true" />
                <input aria-label="Search products or scan SKU" placeholder="Search products or scan SKU…" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') scanBarcode(); }} />
              </span>
              <button type="button" className="ch-btn ch-btn-secondary ch-btn-icon" onClick={scanBarcode} aria-label="Add scanned product" title="Add scanned product"><Plus size={18} /></button>
            </div>
            {visible.length === 0 ? (
              <EmptyState title="No products" message="No items match this filter." />
            ) : (
              <div className="pos-grid">
                {visible.map((p, i) => {
                  const out = isOutOfStock(p);
                  const low = !out && isLowStock(p);
                  return (
                    <button
                      key={String(p.ROWID ?? p.sku)}
                      type="button"
                      className="pos-card reveal"
                      style={{ animationDelay: `${Math.min(i, 10) * 30}ms` }}
                      onClick={() => addToCart(p)}
                      disabled={out}
                      title={out ? 'Out of stock' : `Add ${p.name} to cart`}
                    >
                      <span className="ch-thumb pos-thumb pos-mobile-thumb" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                      <span className="desktop-product-media"><ProductImage product={p} className="ch-thumb pos-thumb" /></span>
                      <span className="pos-card-name">{p.name}</span>
                      <span className="pos-card-meta">{p.sku} · {number(p.stock)} left</span>
                      <span className="pos-card-row">
                        <span className="pos-card-price">{currency(p.rate)}</span>
                        <span className="pos-add" aria-hidden="true"><Plus size={14} /></span>
                      </span>
                      {out ? <StatusBadge status="Out of stock" /> : low ? <StatusBadge status="Low stock" /> : null}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* RIGHT — floating glass cart */}
        <aside id="pos-current-sale" tabIndex={-1} className="pos-col pos-right reveal" style={{ animationDelay: '140ms' }}>
          <div className="pos-cart">
            <div className="pos-cart-head">
              <div>
                <h3 className="pos-panel-title"><ShoppingBag size={17} aria-hidden="true" /> Current order</h3>
                <p className="pos-panel-sub">{itemCount} item{itemCount === 1 ? '' : 's'} in cart</p>
              </div>
              {cart.length > 0 && (
                <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={() => setCart([])}>Clear</button>
              )}
            </div>

            <div className="pos-customer">
              <label className="ch-label" htmlFor="pos-cust"><User size={13} aria-hidden="true" /> Customer</label>
              <input
                id="pos-cust"
                className="ch-input"
                list="pos-customer-list"
                value={customerName}
                onChange={(e) => onCustomerName(e.target.value)}
                placeholder="Walk-in Guest"
              />
              <datalist id="pos-customer-list">
                <option value="Walk-in Guest" />
                {customers.map((c) => (
                  <option key={c.id} value={c.name}>{c.email ?? ''}</option>
                ))}
              </datalist>
              <input
                className="ch-input"
                aria-label="Customer email"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                placeholder="Email (optional)"
                type="email"
              />
            </div>

            <div className="pos-lines-wrap">
              {cart.length === 0 ? (
                <div className="pos-empty">
                  <ShoppingBag size={26} aria-hidden="true" />
                  <b>Cart is empty</b>
                </div>
              ) : (
                <ul className="pos-lines">
                  {cart.map((l, i) => (
                    <li key={String(l.product.ROWID ?? l.product.sku)}>
                      <span className="pos-line-main">
                        <strong>{l.product.name}</strong>
                        <span className="ch-cell-sub">{currency(l.product.rate)} each</span>
                      </span>
                      <span className="pos-line-disc">
                        <input
                          className="ch-input"
                          aria-label={`Discount for ${l.product.name}`}
                          value={l.discVal}
                          inputMode="decimal"
                          onChange={(e) => setLineDisc(i, { discVal: e.target.value })}
                          placeholder="0"
                        />
                        <select
                          className="ch-select"
                          aria-label={`Discount type for ${l.product.name}`}
                          value={l.discType}
                          onChange={(e) => setLineDisc(i, { discType: e.target.value === 'flat' ? 'flat' : 'percent' })}
                        >
                          <option value="percent">%</option>
                          <option value="flat">LKR</option>
                        </select>
                      </span>
                      <span className="pos-qty">
                        <button type="button" className="ch-btn ch-btn-secondary ch-btn-icon ch-btn-sm" onClick={() => setQty(i, l.qty - 1)} aria-label={`Decrease ${l.product.name}`}><Minus size={13} /></button>
                        <input
                          className="pos-qty-input"
                          aria-label={`Quantity for ${l.product.name}`}
                          type="number"
                          min="1"
                          max={stockOf(l.product)}
                          value={l.qty}
                          inputMode="numeric"
                          onChange={(e) => setQty(i, e.currentTarget.valueAsNumber)}
                        />
                        <button type="button" className="ch-btn ch-btn-secondary ch-btn-icon ch-btn-sm" onClick={() => setQty(i, l.qty + 1)} aria-label={`Increase ${l.product.name}`}><Plus size={13} /></button>
                      </span>
                      <span className="pos-line-total">{currency(Number(l.product.rate) * l.qty)}</span>
                      <button type="button" className="ch-btn ch-btn-ghost ch-btn-icon ch-btn-sm pos-remove" onClick={() => removeLine(i)} aria-label={`Remove ${l.product.name}`}><Trash2 size={14} /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="pos-order-adjustments">
              <div className="ch-field">
                <label className="ch-label" htmlFor="pos-tax">Tax profile</label>
                <select id="pos-tax" className="ch-select" value={taxSelection}
                  disabled={!taxSettings?.enabled || busy}
                  onChange={(e) => setTaxSelection(e.target.value)}>
                  <option value="default">{taxSettings?.enabled ? `Default ${taxName} (${taxSettings.default_rate}%)` : 'Tax disabled (0%)'}</option>
                  {taxSettings?.profiles.map((profile, index) => (
                    <option key={`${profile.name}-${index}`} value={String(index)}>{profile.name} ({profile.rate}%)</option>
                  ))}
                </select>
              </div>
              <div className="ch-field">
                <label className="ch-label" htmlFor="pos-disc">Discount %</label>
                <input id="pos-disc" className="ch-input" type="number" min="0" max="100" value={discountPct} onChange={(e) => setDiscountPct(e.target.value)} />
              </div>
            </div>
            <div className="pos-meta-row pos-payment-row">
              <div className="ch-field">
                <span className="ch-label">Payment</span>
                <div className="pos-pay" role="radiogroup" aria-label="Payment method">
                  {tenderModes.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={!split && payMode === m}
                      className={!split && payMode === m ? 'pos-pay-btn active' : 'pos-pay-btn'}
                      onClick={() => { setPayMode(m); setSplit(false); }}
                    >
                      {m === 'Cash' ? <Banknote size={15} /> : m === 'Card' ? <CreditCard size={15} /> : <Landmark size={15} />}
                      {m}
                    </button>
                  ))}
                </div>
                <button type="button" className={`pos-split-toggle ${split ? 'ch-btn ch-btn-secondary ch-btn-sm' : 'ch-btn ch-btn-ghost ch-btn-sm'}`} onClick={() => setSplit((v) => !v)} aria-pressed={split}>
                  {split ? 'Single payment' : 'Split payment'}
                </button>
              </div>
            </div>

            {split && (
              <div className="pos-split">
                {splits.map((leg, i) => (
                  <div key={i} className="pos-split-row">
                    <select className="ch-select" aria-label={`Split ${i + 1} method`} value={leg.mode} onChange={(e) => setSplitLeg(i, { mode: e.target.value as PayMode })}>
                      {tenderModes.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input
                      className="ch-input"
                      aria-label={`Split ${i + 1} amount`}
                      type="number" min="0" step="0.01"
                      value={leg.amount}
                      onChange={(e) => setSplitLeg(i, { amount: e.target.value })}
                      placeholder="0.00"
                    />
                    {splits.length > 1 && (
                      <button type="button" className="ch-btn ch-btn-ghost ch-btn-icon ch-btn-sm" onClick={() => removeSplitLeg(i)} aria-label={`Remove split ${i + 1}`}><X size={14} /></button>
                    )}
                  </div>
                ))}
                <div className="ch-row" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="ch-btn ch-btn-ghost ch-btn-sm" onClick={addSplitLeg} disabled={splits.length >= 3}>Add leg</button>
                  <span className="ch-cell-sub">Paid {currency(paidTotal)} · {tenderOk ? 'matches' : `diff ${currency(tenderDiff)}`}</span>
                </div>
              </div>
            )}

            {smtpReady && (
              <div className="pos-email-row">
                <label className="ch-row" style={{ gap: 8, fontSize: 13 }}>
                  <input type="checkbox" className="ch-checkbox" checked={mailReceipt} onChange={(e) => setMailReceipt(e.target.checked)} aria-label="Email receipt on checkout" />
                  Email receipt
                </label>
                {mailReceipt && (
                  <input
                    className="ch-input"
                    aria-label="Receipt email"
                    type="email"
                    value={receiptEmail}
                    onChange={(e) => setReceiptEmail(e.target.value)}
                    placeholder={customerEmail.trim() === '' ? 'Email for receipt…' : customerEmail}
                  />
                )}
              </div>
            )}

            <div className="pos-sticky-checkout">
              <dl className="pos-totals">
                <div><dt>Sub total</dt><dd>{currency(totals.sub)}</dd></div>
                <div>
                  <dt>{taxName}{totals.taxMode === 'inclusive' ? ' (incl.)' : ''}</dt>
                  <dd>{currency(totals.tax)}</dd>
                </div>
                {totals.itemDisc > 0 && <div><dt>Item discounts</dt><dd>−{currency(totals.itemDisc)}</dd></div>}
                {totals.orderDisc > 0 && <div><dt>Discount</dt><dd>−{currency(totals.orderDisc)}</dd></div>}
                <div className="pos-grand"><dt>Total</dt><dd>{currency(totals.total)}</dd></div>
              </dl>
              <button type="button" className="ch-btn ch-btn-primary pos-checkout" onClick={submit} disabled={cart.length === 0 || busy || (split && !tenderOk)}>
                {busy ? 'Processing…' : `Charge ${currency(totals.total)} · ${split ? 'Split' : payMode}`}
              </button>
            </div>
          </div>
        </aside>
      </div>

      {/* Receipt (POS-09) */}
      <Modal
        open={showReceipt && receipt !== null}
        title={receipt === null ? 'Receipt' : `Receipt ${receipt.invoiceNumber || `#${receipt.orderId}`}`}
        subtitle={receipt === null ? undefined : `${receipt.date} · ${receipt.customerName}`}
        onClose={() => { setShowReceipt(false); }}
        footer={
          <>
            <button type="button" className="ch-btn ch-btn-secondary" onClick={printReceipt} disabled={receiptPrinting}><Printer size={15} /> {receiptPrinting ? 'Printing…' : 'Print'}</button>
            {printJobs.filter((j) => j.template !== 'bill').map((j) => (
              <button key={j.jobId} type="button" className="ch-btn ch-btn-secondary" onClick={() => printKot(j)}>
                <Printer size={15} /> {(j.payload as Partial<KotJobPayload>).kotNumber ?? j.station}
              </button>
            ))}
            <button type="button" className="ch-btn ch-btn-secondary" onClick={downloadReceipt}><Download size={15} /> Download</button>
            {canVoid && receipt !== null && (
              <button type="button" className="ch-btn ch-btn-danger" onClick={() => setVoidConfirm(true)} disabled={voidBusy}><Ban size={15} /> Void sale</button>
            )}
            <button type="button" className="ch-btn ch-btn-primary" onClick={() => { setShowReceipt(false); }}>Done</button>
          </>
        }
      >
        {receipt !== null && (
          <div className="pos-receipt-doc">
            {printMessage && <p role="status" className="ch-hint">{printMessage}</p>}
            <h3 className="pos-rc-store">{receipt.store.store_name || 'CloudHub POS'}</h3>
            {receipt.store.company !== '' && <p className="ch-cell-sub">{receipt.store.company}</p>}
            <dl className="pos-rc-meta">
              <div><dt>Invoice</dt><dd>{receipt.invoiceNumber || `#${receipt.orderId}`}</dd></div>
              <div><dt>Date</dt><dd>{receipt.date}</dd></div>
              <div><dt>Customer</dt><dd>{receipt.customerName}</dd></div>
            </dl>
            <table className="pos-rc-table">
              <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
              <tbody>
                {receipt.lines.map((l, i) => (
                  <tr key={i}>
                    <td>{l.name}{l.discount > 0 && <span className="ch-cell-sub"> −{currency(l.discount)}</span>}</td>
                    <td>{l.quantity}</td>
                    <td>{currency(l.rate)}</td>
                    <td>{currency(l.lineTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="pos-rc-totals">
              <div><dt>Subtotal</dt><dd>{currency(receipt.subtotal)}</dd></div>
              <div><dt>Tax</dt><dd>{currency(receipt.tax)}</dd></div>
              <div><dt>Discount</dt><dd>−{currency(receipt.discount)}</dd></div>
              <div><dt>Total</dt><dd>{currency(receipt.total)}</dd></div>
              {receipt.payments.map((p, i) => <div key={i}><dt>{p.mode}</dt><dd>{currency(p.amount)}</dd></div>)}
            </dl>
            {smtpReady && (
              <div className="pos-email-row">
                <input
                  className="ch-input"
                  aria-label="Email address for receipt"
                  type="email"
                  value={receiptEmail}
                  onChange={(e) => { setReceiptEmail(e.target.value); setEmailMsg(''); }}
                  placeholder="Email for receipt…"
                />
                <button type="button" className="ch-btn ch-btn-secondary ch-btn-sm" onClick={sendEmail} disabled={emailBusy}>
                  <Mail size={15} /> {emailBusy ? 'Sending…' : 'Send'}
                </button>
              </div>
            )}
            {emailMsg !== '' && <p className="ch-hint" role="status">{emailMsg}</p>}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={voidConfirm}
        title="Void sale"
        message={receipt === null ? '' : `Void order #${receipt.orderId} (${currency(receipt.total)})? Stock will be restored and the order marked VOIDED. Zoho Books reversal is manual.`}
        confirmLabel="Void sale"
        danger
        busy={voidBusy}
        onConfirm={submitVoid}
        onCancel={() => setVoidConfirm(false)}
      />
    </div>
  );
}
