import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Banknote, Check, ClipboardList, CreditCard, FileText, PackageCheck, PackagePlus, Plus, ReceiptText, Search, Store, Trash2, Truck, UsersRound, Wallet, Warehouse } from 'lucide-react';
import Card from '../components/ui/Card';
import { useAuth } from '../context/AuthContext';
import EmptyState from '../components/ui/EmptyState';
import ErrorState from '../components/ui/ErrorState';
import Loader from '../components/ui/Loader';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import { getWarehouses } from '../services/inventoryService';
import { getProducts } from '../services/productService';
import { approvePurchaseOrder, createPurchaseOrder, createVendor, createVendorBill, createVendorPayment, getPurchasingRecords, receivePurchaseOrder, type PurchaseOrder, type Vendor, type VendorBill, type VendorPayment } from '../services/purchaseService';
import type { Product, Warehouse as WarehouseType } from '../types';
import './Purchases.css';

type Section = 'orders' | 'vendors' | 'receiving' | 'bills' | 'payments';
type Dialog = 'vendor' | 'order' | 'receive' | 'bill' | 'payment' | null;
interface DraftLine { id: string; product_id: string; quantity: string; unit_cost: string; tax_percentage: string; }

const newLine = (): DraftLine => ({ id: `${Date.now()}-${Math.random()}`, product_id: '', quantity: '1', unit_cost: '0', tax_percentage: '0' });
const idOf = (value: { ROWID?: string | number }) => String(value.ROWID ?? '');
const money = (value: number) => `LKR ${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function Purchases() {
  const location = useLocation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const canManagePayables = role === 'Admin' || role === 'Manager';
  const section: Section = location.pathname.endsWith('/vendors') ? 'vendors' : location.pathname.endsWith('/receiving') ? 'receiving' : location.pathname.endsWith('/bills') ? 'bills' : location.pathname.endsWith('/payments') ? 'payments' : 'orders';
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [bills, setBills] = useState<VendorBill[]>([]);
  const [payments, setPayments] = useState<VendorPayment[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadErrors, setLoadErrors] = useState<Partial<Record<'vendors' | 'orders' | 'bills' | 'payments' | 'products' | 'warehouses', string>>>({});
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [vendorName, setVendorName] = useState('');
  const [vendorEmail, setVendorEmail] = useState('');
  const [vendorPhone, setVendorPhone] = useState('');
  const [vendorId, setVendorId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [draftLines, setDraftLines] = useState<DraftLine[]>([newLine()]);
  const [selectedOrder, setSelectedOrder] = useState<PurchaseOrder | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<Record<string, string>>({});
  const [billOrderId, setBillOrderId] = useState('');
  const [billId, setBillId] = useState('');
  const [amount, setAmount] = useState('0');
  const [paymentType, setPaymentType] = useState<'Payment' | 'Credit'>('Payment');
  const [paymentMethod, setPaymentMethod] = useState('Bank transfer');

  const load = useCallback(async () => {
    setLoading(true);
    const [records, items, wh] = await Promise.allSettled([getPurchasingRecords(canManagePayables), getProducts(), getWarehouses()]);
    const errors: typeof loadErrors = {};
    if (records.status === 'fulfilled') {
      const r = records.value;
      setVendors(r.vendors); setOrders(r.orders); setBills(r.bills); setPayments(r.payments);
      Object.assign(errors, r.errors);
    } else {
      const message = records.reason instanceof Error ? records.reason.message : 'Purchasing could not be loaded.';
      Object.assign(errors, { vendors: message, orders: message, bills: message, payments: message });
    }
    if (items.status === 'fulfilled') setProducts(items.value);
    else errors.products = items.reason instanceof Error ? items.reason.message : 'Products could not be loaded.';
    if (wh.status === 'fulfilled') setWarehouses(wh.value.filter((w) => (w.status ?? 'Active') === 'Active'));
    else errors.warehouses = wh.reason instanceof Error ? wh.reason.message : 'Warehouses could not be loaded.';
    setLoadErrors(errors); setLoading(false);
  }, [canManagePayables]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setSearch(''); setDialog(null); setError(''); setNotice(''); }, [section]);

  const vendorNameFor = (id: string) => vendors.find((v) => idOf(v) === String(id))?.name ?? 'Unknown vendor';
  const warehouseNameFor = (id: string) => warehouses.find((w) => idOf(w) === String(id))?.name ?? 'Unknown warehouse';
  const productFor = (id: string) => products.find((p) => idOf(p) === String(id));
  const readyOrders = useMemo(() => orders.filter((o) => ['Approved', 'Partially received'].includes(o.status)), [orders]);
  const openBills = useMemo(() => bills.filter((b) => Number(b.paid_amount) < Number(b.total_amount)), [bills]);
  const outstanding = useMemo(() => openBills.reduce((sum, b) => sum + Math.max(0, Number(b.total_amount) - Number(b.paid_amount)), 0), [openBills]);
  const totalPayments = useMemo(() => payments.filter((p) => p.type !== 'Credit').reduce((sum, p) => sum + Number(p.amount || 0), 0), [payments]);
  const totalCredits = useMemo(() => payments.filter((p) => p.type === 'Credit').reduce((sum, p) => sum + Number(p.amount || 0), 0), [payments]);
  const orderTotal = useMemo(() => draftLines.reduce((sum, line) => { const base = (Number(line.quantity) || 0) * (Number(line.unit_cost) || 0); return sum + base * (1 + (Number(line.tax_percentage) || 0) / 100); }, 0), [draftLines]);

  const resetDialog = () => {
    setDialog(null); setVendorName(''); setVendorEmail(''); setVendorPhone(''); setVendorId(''); setWarehouseId(''); setExpectedDate(''); setNotes(''); setDraftLines([newLine()]); setSelectedOrder(null); setReceiptQuantities({}); setBillOrderId(''); setBillId(''); setAmount('0'); setPaymentType('Payment'); setPaymentMethod('Bank transfer'); setError('');
  };
  const finish = async (message: string) => { resetDialog(); setNotice(message); await load(); };
  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  const saveVendor = async () => {
    if (!vendorName.trim()) return setError('Vendor name is required.');
    setBusy(true); try { await createVendor({ name: vendorName.trim(), email: vendorEmail.trim(), phone: vendorPhone.trim() }); await finish('Vendor created successfully.'); } catch (e) { fail(e, 'Could not create vendor.'); } finally { setBusy(false); }
  };
  const saveOrder = async () => {
    if (!vendorId || !warehouseId) return setError('Choose a vendor and receiving warehouse.');
    const items = [];
    for (const [i, line] of draftLines.entries()) {
      const quantity = Number(line.quantity); const unitCost = Number(line.unit_cost); const tax = Number(line.tax_percentage);
      if (!line.product_id) return setError(`Line ${i + 1}: choose a product.`);
      if (!Number.isFinite(quantity) || quantity <= 0) return setError(`Line ${i + 1}: quantity must be greater than zero.`);
      if (!Number.isFinite(unitCost) || unitCost < 0) return setError(`Line ${i + 1}: unit cost cannot be negative.`);
      items.push({ product_id: line.product_id, quantity, unit_cost: unitCost, tax_percentage: Number.isFinite(tax) ? Math.max(0, tax) : 0 });
    }
    setBusy(true); try { await createPurchaseOrder({ vendor_id: vendorId, warehouse_id: warehouseId, expected_date: expectedDate, notes: notes.trim(), items }); await finish('Purchase order created as Draft.'); } catch (e) { fail(e, 'Could not create purchase order.'); } finally { setBusy(false); }
  };
  const approve = async (order: PurchaseOrder) => { setBusy(true); try { await approvePurchaseOrder(order.ROWID!); await finish(`${order.po_number} approved and ready to receive.`); } catch (e) { fail(e, 'Approval failed.'); } finally { setBusy(false); } };
  const openReceive = (order: PurchaseOrder) => {
    const values: Record<string, string> = {};
    order.items.forEach((line) => { const remaining = Math.max(0, Number(line.quantity) - Number(line.received_quantity)); if (line.ROWID !== undefined && remaining > 0) values[String(line.ROWID)] = String(remaining); });
    setSelectedOrder(order); setReceiptQuantities(values); setDialog('receive');
  };
  const receive = async () => {
    if (!selectedOrder) return;
    const items = selectedOrder.items.flatMap((line) => { const quantity = Number(receiptQuantities[String(line.ROWID ?? '')] ?? 0); return line.ROWID !== undefined && Number.isFinite(quantity) && quantity > 0 ? [{ purchase_order_item_id: line.ROWID, quantity }] : []; });
    if (!items.length) return setError('Enter a quantity for at least one line.');
    setBusy(true); try { await receivePurchaseOrder(selectedOrder.ROWID!, items); await finish(`${selectedOrder.po_number} receipt posted to ${warehouseNameFor(selectedOrder.warehouse_id)}.`); } catch (e) { fail(e, 'Receipt failed.'); } finally { setBusy(false); }
  };
  const saveBill = async () => {
    if (!vendorId) return setError('Choose a vendor.');
    if (!Number.isFinite(Number(amount)) || Number(amount) < 0) return setError('Enter a valid bill total.');
    setBusy(true); try { await createVendorBill({ vendor_id: vendorId, purchase_order_id: billOrderId || undefined, total_amount: Number(amount) }); await finish('Vendor bill recorded.'); } catch (e) { fail(e, 'Could not create vendor bill.'); } finally { setBusy(false); }
  };
  const savePayment = async () => {
    if (!vendorId || !billId) return setError('Choose a vendor and open bill.');
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) return setError('Enter an amount greater than zero.');
    setBusy(true); try { await createVendorPayment({ vendor_id: vendorId, bill_id: billId, amount: Number(amount), type: paymentType, payment_method: paymentMethod }); await finish(`${paymentType} recorded successfully.`); } catch (e) { fail(e, 'Could not record this transaction.'); } finally { setBusy(false); }
  };

  const query = search.trim().toLowerCase();
  const filteredOrders = orders.filter((o) => [o.po_number, vendorNameFor(o.vendor_id), warehouseNameFor(o.warehouse_id), o.status].some((v) => v.toLowerCase().includes(query)));
  const filteredVendors = vendors.filter((v) => [v.name, v.email ?? '', v.phone ?? '', v.vendor_number ?? ''].some((x) => x.toLowerCase().includes(query)));
  const filteredBills = bills.filter((b) => [b.bill_number, vendorNameFor(b.vendor_id), b.status].some((v) => v.toLowerCase().includes(query)));
  const filteredPayments = payments.filter((p) => [p.payment_number, vendorNameFor(p.vendor_id), p.type, p.payment_method ?? ''].some((v) => v.toLowerCase().includes(query)));
  const page = {
    orders: { eyebrow: 'Procurement', title: 'Purchase orders', subtitle: 'Plan supplier orders, approve spend and track every stock arrival.', action: 'New purchase order', icon: ClipboardList, dialog: 'order' as Dialog },
    vendors: { eyebrow: 'Supplier network', title: 'Vendors', subtitle: 'Keep supplier contacts and purchasing relationships in one reliable directory.', action: 'Add vendor', icon: UsersRound, dialog: 'vendor' as Dialog },
    receiving: { eyebrow: 'Warehouse intake', title: 'Receive stock', subtitle: 'Review approved orders and post partial or complete receipts to the correct warehouse.', action: '', icon: PackageCheck, dialog: null },
    bills: { eyebrow: 'Accounts payable', title: 'Vendor bills', subtitle: 'Capture supplier invoices and monitor what is paid, open or overdue.', action: 'Add vendor bill', icon: ReceiptText, dialog: 'bill' as Dialog },
    payments: { eyebrow: 'Settlements', title: 'Payments & credits', subtitle: 'Settle open bills and maintain a clear supplier transaction history.', action: 'Record transaction', icon: CreditCard, dialog: 'payment' as Dialog },
  }[section];
  const PageIcon = page.icon;

  if (loading) return <Loader message="Loading purchasing…" skeleton="page" />;
  const sectionError = loadErrors[section === 'receiving' ? 'orders' : section];
  if (sectionError) return <ErrorState message={sectionError} onRetry={() => void load()} />;

  return <div className="purchase-page">
    <section className="purchase-hero"><div className="purchase-hero-icon"><PageIcon size={24} /></div><div className="purchase-hero-copy"><span className="purchase-kicker">{page.eyebrow}</span><h1>{page.title}</h1><p>{page.subtitle}</p></div>{page.dialog !== null && (page.dialog !== 'vendor' || canManagePayables) && <button className="ch-btn ch-btn-primary purchase-primary" onClick={() => setDialog(page.dialog)}><Plus size={16} /> {page.action}</button>}</section>
    {Object.keys(loadErrors).length > 0 && <div role="alert" className="ch-alert ch-alert-error">Some supporting data could not be loaded: {Object.entries(loadErrors).map(([name, message]) => `${name}: ${message}`).join("; ")} <button className="ch-btn ch-btn-sm" onClick={() => void load()}>Retry</button></div>}
    {notice && <div className="ch-alert ch-alert-success">{notice}</div>}{error && <div className="ch-alert ch-alert-error">{error}</div>}
    {section === 'orders' && <OrderPage orders={filteredOrders} readyCount={readyOrders.length} search={search} setSearch={setSearch} vendorNameFor={vendorNameFor} warehouseNameFor={warehouseNameFor} onApprove={canManagePayables ? approve : undefined} onReceive={() => navigate('/purchases/receiving')} onCreate={() => setDialog('order')} busy={busy} />}
    {section === 'vendors' && <VendorPage vendors={filteredVendors} orderCount={orders.length} outstanding={outstanding} search={search} setSearch={setSearch} onCreate={canManagePayables ? () => setDialog('vendor') : undefined} />}
    {section === 'receiving' && <ReceivingPage orders={readyOrders.filter((o) => [o.po_number, vendorNameFor(o.vendor_id), warehouseNameFor(o.warehouse_id)].some((v) => v.toLowerCase().includes(query)))} search={search} setSearch={setSearch} vendorNameFor={vendorNameFor} warehouseNameFor={warehouseNameFor} onReceive={openReceive} onViewOrders={() => navigate('/purchases/orders')} />}
    {section === 'bills' && <BillPage bills={filteredBills} outstanding={outstanding} search={search} setSearch={setSearch} vendorNameFor={vendorNameFor} onCreate={() => setDialog('bill')} />}
    {section === 'payments' && <PaymentPage payments={filteredPayments} totalPayments={totalPayments} totalCredits={totalCredits} openBillCount={openBills.length} search={search} setSearch={setSearch} vendorNameFor={vendorNameFor} onCreate={() => setDialog('payment')} />}

    <Modal open={dialog === 'vendor'} title="Add vendor" subtitle="Create a supplier profile for orders and bills." onClose={resetDialog} footer={<Actions busy={busy} label="Save vendor" onCancel={resetDialog} onSave={() => void saveVendor()} />}>{error && <div role="alert" className="ch-alert ch-alert-error">{error}</div>}<div className="purchase-form-grid"><Field label="Vendor name" required><input autoFocus placeholder="e.g. Fresh Foods Lanka" value={vendorName} onChange={(e) => setVendorName(e.target.value)} /></Field><Field label="Email"><input type="email" placeholder="accounts@supplier.com" value={vendorEmail} onChange={(e) => setVendorEmail(e.target.value)} /></Field><Field label="Phone"><input placeholder="Contact number" value={vendorPhone} onChange={(e) => setVendorPhone(e.target.value)} /></Field></div></Modal>

    <Modal open={dialog === 'order'} size="lg" title="New purchase order" subtitle="Choose a supplier, destination and every product to order." onClose={resetDialog} footer={<Actions busy={busy} label="Create draft order" onCancel={resetDialog} onSave={() => void saveOrder()} />}>
      <div className="purchase-form-grid purchase-form-grid-3"><Field label="Vendor" required><select value={vendorId} onChange={(e) => setVendorId(e.target.value)}><option value="">Choose vendor</option>{vendors.filter((v) => (v.status ?? 'Active') === 'Active').map((v) => <option key={idOf(v)} value={idOf(v)}>{v.name}</option>)}</select></Field><Field label="Receiving warehouse" required><select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">Choose warehouse</option>{warehouses.map((w) => <option key={idOf(w)} value={idOf(w)}>{w.name}</option>)}</select></Field><Field label="Expected date"><input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field></div>
      <div className="purchase-line-head"><div><b>Order lines</b><span>Add all products expected from this supplier.</span></div><button className="ch-btn ch-btn-sm" onClick={() => setDraftLines((lines) => [...lines, newLine()])}><Plus size={14} /> Add line</button></div>
      <div className="purchase-lines">{draftLines.map((line, i) => <div className="purchase-line" key={line.id}><span className="purchase-line-number">{i + 1}</span><Field label="Product" required><select value={line.product_id} onChange={(e) => setDraftLines((rows) => rows.map((row) => row.id === line.id ? { ...row, product_id: e.target.value } : row))}><option value="">Choose product</option>{products.map((p) => <option key={idOf(p)} value={idOf(p)}>{p.name} · {p.sku}</option>)}</select></Field><Field label="Quantity" required><input type="number" min="0.01" step="0.01" value={line.quantity} onChange={(e) => setDraftLines((rows) => rows.map((row) => row.id === line.id ? { ...row, quantity: e.target.value } : row))} /></Field><Field label="Unit cost" required><input type="number" min="0" step="0.01" value={line.unit_cost} onChange={(e) => setDraftLines((rows) => rows.map((row) => row.id === line.id ? { ...row, unit_cost: e.target.value } : row))} /></Field><Field label="Tax %"><input type="number" min="0" step="0.01" value={line.tax_percentage} onChange={(e) => setDraftLines((rows) => rows.map((row) => row.id === line.id ? { ...row, tax_percentage: e.target.value } : row))} /></Field><button className="purchase-line-remove" aria-label={`Remove line ${i + 1}`} disabled={draftLines.length === 1} onClick={() => setDraftLines((rows) => rows.filter((row) => row.id !== line.id))}><Trash2 size={15} /></button></div>)}</div>
      <div className="purchase-order-foot"><Field label="Internal notes"><textarea rows={3} placeholder="Delivery instructions or supplier reference" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field><div className="purchase-order-total"><span>Estimated order total</span><strong>{money(orderTotal)}</strong><small>Includes line tax</small></div></div>
    </Modal>

    <Modal open={dialog === 'receive'} size="lg" title={selectedOrder ? `Receive ${selectedOrder.po_number}` : 'Receive stock'} subtitle={selectedOrder ? `${vendorNameFor(selectedOrder.vendor_id)} → ${warehouseNameFor(selectedOrder.warehouse_id)}` : ''} onClose={resetDialog} footer={<Actions busy={busy} label="Post stock receipt" onCancel={resetDialog} onSave={() => void receive()} />}>{error && <div role="alert" className="ch-alert ch-alert-error">{error}</div>}<div className="purchase-receive-note"><Warehouse size={18} /><span>Stock will be added only to <b>{selectedOrder ? warehouseNameFor(selectedOrder.warehouse_id) : ''}</b>. Enter what physically arrived.</span></div><div className="ch-table-wrap"><table className="ch-table purchase-receive-table"><thead><tr><th>Product</th><th>Ordered</th><th>Received</th><th>Remaining</th><th>Receive now</th></tr></thead><tbody>{selectedOrder?.items.map((line) => { const remaining = Math.max(0, Number(line.quantity) - Number(line.received_quantity)); const product = productFor(line.product_id); return <tr key={String(line.ROWID)}><td><b>{product?.name ?? 'Product'}</b><small>{product?.sku ?? line.product_id}</small></td><td>{line.quantity}</td><td>{line.received_quantity}</td><td>{remaining}</td><td><input type="number" min="0" max={remaining} step="0.01" value={receiptQuantities[String(line.ROWID ?? '')] ?? '0'} onChange={(e) => setReceiptQuantities((values) => ({ ...values, [String(line.ROWID ?? '')]: e.target.value }))} /></td></tr>; })}</tbody></table></div></Modal>

    <Modal open={dialog === 'bill'} title="Add vendor bill" subtitle="Record a supplier invoice and optional purchase-order link." onClose={resetDialog} footer={<Actions busy={busy} label="Save bill" onCancel={resetDialog} onSave={() => void saveBill()} />}>{error && <div role="alert" className="ch-alert ch-alert-error">{error}</div>}<div className="purchase-form-grid"><Field label="Vendor" required><select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setBillOrderId(''); }}><option value="">Choose vendor</option>{vendors.map((v) => <option key={idOf(v)} value={idOf(v)}>{v.name}</option>)}</select></Field><Field label="Purchase order"><select value={billOrderId} onChange={(e) => setBillOrderId(e.target.value)}><option value="">No linked order</option>{orders.filter((o) => !vendorId || String(o.vendor_id) === vendorId).map((o) => <option key={idOf(o)} value={idOf(o)}>{o.po_number} · {money(o.total_amount)}</option>)}</select></Field><Field label="Bill total" required><MoneyInput value={amount} setValue={setAmount} /></Field></div></Modal>

    <Modal open={dialog === 'payment'} title="Record payment or credit" subtitle="Apply a supplier transaction to an open bill." onClose={resetDialog} footer={<Actions busy={busy} label={`Record ${paymentType.toLowerCase()}`} onCancel={resetDialog} onSave={() => void savePayment()} />}>{error && <div role="alert" className="ch-alert ch-alert-error">{error}</div>}<div className="purchase-segmented"><button className={paymentType === 'Payment' ? 'active' : ''} onClick={() => setPaymentType('Payment')}><Banknote size={15} /> Payment</button><button className={paymentType === 'Credit' ? 'active' : ''} onClick={() => setPaymentType('Credit')}><FileText size={15} /> Supplier credit</button></div><div className="purchase-form-grid"><Field label="Vendor" required><select value={vendorId} onChange={(e) => { setVendorId(e.target.value); setBillId(''); }}><option value="">Choose vendor</option>{vendors.map((v) => <option key={idOf(v)} value={idOf(v)}>{v.name}</option>)}</select></Field><Field label="Open bill" required><select value={billId} onChange={(e) => setBillId(e.target.value)}><option value="">Choose bill</option>{openBills.filter((b) => String(b.vendor_id) === vendorId).map((b) => <option key={idOf(b)} value={idOf(b)}>{b.bill_number} · {money(Number(b.total_amount) - Number(b.paid_amount))} due</option>)}</select></Field><Field label="Method"><select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}><option>Bank transfer</option><option>Cash</option><option>Card</option><option>Cheque</option><option>Other</option></select></Field><Field label="Amount" required><MoneyInput value={amount} setValue={setAmount} /></Field></div></Modal>
  </div>;
}

function Stat({ label, value, detail, icon, tone = 'blue' }: { label: string; value: string | number; detail: string; icon: ReactNode; tone?: 'blue' | 'green' | 'amber' | 'violet' }) { return <Card className={`purchase-stat purchase-stat-${tone}`}><div className="purchase-stat-top"><span>{label}</span><i>{icon}</i></div><strong>{value}</strong><p>{detail}</p></Card>; }
function Toolbar({ value, onChange, placeholder, count }: { value: string; onChange: (value: string) => void; placeholder: string; count: number }) { return <div className="purchase-toolbar"><div className="purchase-search"><Search size={16} /><input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div><span>{count} record{count === 1 ? '' : 's'}</span></div>; }
function Field({ label, required = false, children }: { label: string; required?: boolean; children: ReactNode }) { return <label className="purchase-field"><span>{label}{required && <em>*</em>}</span>{children}</label>; }
function Actions({ busy, label, onCancel, onSave }: { busy: boolean; label: string; onCancel: () => void; onSave: () => void }) { return <><button className="ch-btn" onClick={onCancel} disabled={busy}>Cancel</button><button className="ch-btn ch-btn-primary" onClick={onSave} disabled={busy}>{busy ? 'Saving…' : label}</button></>; }
function MoneyInput({ value, setValue }: { value: string; setValue: (value: string) => void }) { return <div className="purchase-money-input"><span>LKR</span><input type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} /></div>; }
interface Common { search: string; setSearch: (value: string) => void; }

function OrderPage({ orders, readyCount, search, setSearch, vendorNameFor, warehouseNameFor, onApprove, onReceive, onCreate, busy }: Common & { orders: PurchaseOrder[]; readyCount: number; vendorNameFor: (id: string) => string; warehouseNameFor: (id: string) => string; onApprove?: (o: PurchaseOrder) => void; onReceive: () => void; onCreate: () => void; busy: boolean }) {
  const drafts = orders.filter((o) => o.status === 'Draft').length; const total = orders.reduce((sum, o) => sum + Number(o.total_amount || 0), 0);
  return <><div className="purchase-stats"><Stat label="All orders" value={orders.length} detail="Supplier orders in this view" icon={<ClipboardList size={18} />} /><Stat label="Drafts" value={drafts} detail="Waiting for approval" icon={<FileText size={18} />} tone="amber" /><Stat label="Ready to receive" value={readyCount} detail="Approved stock arrivals" icon={<PackageCheck size={18} />} tone="green" /><Stat label="Order value" value={money(total)} detail="Value across listed orders" icon={<Wallet size={18} />} tone="violet" /></div><Records title="Purchase orders" subtitle="Review status, supplier and destination warehouse." toolbar={<Toolbar value={search} onChange={setSearch} placeholder="Search PO, vendor or warehouse" count={orders.length} />} empty={orders.length === 0} emptyIcon={<ClipboardList size={26} />} emptyTitle="No purchase orders found" emptyMessage={search ? 'Try another search.' : 'Create your first supplier order to begin.'} emptyAction={!search && <button className="ch-btn ch-btn-primary ch-btn-sm" onClick={onCreate}><Plus size={14} /> New purchase order</button>}><table className="ch-table purchase-table"><thead><tr><th>Purchase order</th><th>Vendor</th><th>Destination</th><th>Lines</th><th>Total</th><th>Status</th><th>Action</th></tr></thead><tbody>{orders.map((o) => <tr key={idOf(o)}><td><b>{o.po_number}</b><small>{o.expected_date ? `Expected ${o.expected_date}` : 'No expected date'}</small></td><td>{vendorNameFor(o.vendor_id)}</td><td>{warehouseNameFor(o.warehouse_id)}</td><td>{o.items.length}</td><td className="purchase-money">{money(o.total_amount)}</td><td><StatusBadge status={o.status} /></td><td className="purchase-row-actions">{o.status === 'Draft' && onApprove && <button className="ch-btn ch-btn-sm" disabled={busy} onClick={() => onApprove(o)}><Check size={14} /> Approve</button>}{['Approved', 'Partially received'].includes(o.status) && <button className="ch-btn ch-btn-primary ch-btn-sm" onClick={onReceive}><PackagePlus size={14} /> Receive</button>}</td></tr>)}</tbody></table></Records></>;
}

function VendorPage({ vendors, orderCount, outstanding, search, setSearch, onCreate }: Common & { vendors: Vendor[]; orderCount: number; outstanding: number; onCreate?: () => void }) {
  const active = vendors.filter((v) => (v.status ?? 'Active') === 'Active').length;
  return <><div className="purchase-stats purchase-stats-3"><Stat label="All vendors" value={vendors.length} detail="Supplier profiles" icon={<UsersRound size={18} />} /><Stat label="Active vendors" value={active} detail="Available for new orders" icon={<Store size={18} />} tone="green" /><Stat label="Purchasing relationship" value={orderCount} detail={`${money(outstanding)} currently payable`} icon={<Truck size={18} />} tone="violet" /></div><Records title="Vendor directory" subtitle="Supplier contacts used across orders, bills and payments." toolbar={<Toolbar value={search} onChange={setSearch} placeholder="Search name, email or phone" count={vendors.length} />} empty={vendors.length === 0} emptyIcon={<UsersRound size={26} />} emptyTitle="No vendors found" emptyMessage={search ? 'Try another search.' : 'Add a supplier before creating a purchase order.'} emptyAction={!search && onCreate && <button className="ch-btn ch-btn-primary ch-btn-sm" onClick={onCreate}><Plus size={14} /> Add vendor</button>}><div className="purchase-vendor-grid">{vendors.map((v) => <article className="purchase-vendor" key={idOf(v)}><div className="purchase-vendor-avatar">{v.name.slice(0, 1).toUpperCase()}</div><div className="purchase-vendor-main"><div><h3>{v.name}</h3><StatusBadge status={v.status ?? 'Active'} /></div><span>{v.vendor_number ?? 'Supplier'}</span><dl><div><dt>Email</dt><dd>{v.email || 'Not provided'}</dd></div><div><dt>Phone</dt><dd>{v.phone || 'Not provided'}</dd></div></dl></div></article>)}</div></Records></>;
}

function ReceivingPage({ orders, search, setSearch, vendorNameFor, warehouseNameFor, onReceive, onViewOrders }: Common & { orders: PurchaseOrder[]; vendorNameFor: (id: string) => string; warehouseNameFor: (id: string) => string; onReceive: (o: PurchaseOrder) => void; onViewOrders: () => void }) {
  const units = orders.reduce((sum, o) => sum + o.items.reduce((s, line) => s + Math.max(0, Number(line.quantity) - Number(line.received_quantity)), 0), 0); const destinations = new Set(orders.map((o) => o.warehouse_id)).size;
  return <><div className="purchase-stats purchase-stats-3"><Stat label="Ready orders" value={orders.length} detail="Approved supplier arrivals" icon={<PackageCheck size={18} />} tone="green" /><Stat label="Outstanding units" value={units} detail="Quantity left to receive" icon={<PackagePlus size={18} />} tone="amber" /><Stat label="Destinations" value={destinations} detail="Warehouses expecting stock" icon={<Warehouse size={18} />} /></div><Records title="Receiving queue" subtitle="Review each arrival before inventory is updated." toolbar={<Toolbar value={search} onChange={setSearch} placeholder="Search PO, vendor or warehouse" count={orders.length} />} empty={orders.length === 0} emptyIcon={<PackageCheck size={26} />} emptyTitle="No orders ready to receive" emptyMessage={search ? 'Try another search.' : 'Approve a draft purchase order and it will appear here.'} emptyAction={!search && <button className="ch-btn ch-btn-sm" onClick={onViewOrders}>View purchase orders</button>}><div className="purchase-receive-grid">{orders.map((o) => { const remaining = o.items.reduce((sum, line) => sum + Math.max(0, Number(line.quantity) - Number(line.received_quantity)), 0); return <article className="purchase-receive-card" key={idOf(o)}><div className="purchase-receive-top"><div><span>Purchase order</span><h3>{o.po_number}</h3></div><StatusBadge status={o.status} /></div><div className="purchase-receive-route"><span><Truck size={15} /> {vendorNameFor(o.vendor_id)}</span><i>→</i><span><Warehouse size={15} /> {warehouseNameFor(o.warehouse_id)}</span></div><div className="purchase-receive-meta"><div><b>{o.items.length}</b><span>lines</span></div><div><b>{remaining}</b><span>units due</span></div><div><b>{money(o.total_amount)}</b><span>order value</span></div></div><button className="ch-btn ch-btn-primary" onClick={() => onReceive(o)}><PackagePlus size={15} /> Review receipt</button></article>; })}</div></Records></>;
}

function BillPage({ bills, outstanding, search, setSearch, vendorNameFor, onCreate }: Common & { bills: VendorBill[]; outstanding: number; vendorNameFor: (id: string) => string; onCreate: () => void }) {
  const paid = bills.reduce((sum, b) => sum + Number(b.paid_amount || 0), 0); const open = bills.filter((b) => Number(b.paid_amount) < Number(b.total_amount)).length;
  return <><div className="purchase-stats purchase-stats-3"><Stat label="Open bills" value={open} detail="Awaiting settlement" icon={<ReceiptText size={18} />} tone="amber" /><Stat label="Outstanding" value={money(outstanding)} detail="Current payable balance" icon={<Wallet size={18} />} tone="violet" /><Stat label="Paid to date" value={money(paid)} detail="Applied across supplier bills" icon={<Check size={18} />} tone="green" /></div><Records title="Vendor bills" subtitle="Supplier invoices and their settlement status." toolbar={<Toolbar value={search} onChange={setSearch} placeholder="Search bill, vendor or status" count={bills.length} />} empty={bills.length === 0} emptyIcon={<ReceiptText size={26} />} emptyTitle="No vendor bills found" emptyMessage={search ? 'Try another search.' : 'Record a bill after receiving a supplier invoice.'} emptyAction={!search && <button className="ch-btn ch-btn-primary ch-btn-sm" onClick={onCreate}><Plus size={14} /> Add vendor bill</button>}><table className="ch-table purchase-table"><thead><tr><th>Bill</th><th>Vendor</th><th>Total</th><th>Paid</th><th>Balance</th><th>Status</th></tr></thead><tbody>{bills.map((b) => <tr key={idOf(b)}><td><b>{b.bill_number}</b><small>{b.due_date ? `Due ${b.due_date}` : 'No due date'}</small></td><td>{vendorNameFor(b.vendor_id)}</td><td>{money(b.total_amount)}</td><td>{money(b.paid_amount)}</td><td className="purchase-money">{money(Math.max(0, Number(b.total_amount) - Number(b.paid_amount)))}</td><td><StatusBadge status={b.status} /></td></tr>)}</tbody></table></Records></>;
}

function PaymentPage({ payments, totalPayments, totalCredits, openBillCount, search, setSearch, vendorNameFor, onCreate }: Common & { payments: VendorPayment[]; totalPayments: number; totalCredits: number; openBillCount: number; vendorNameFor: (id: string) => string; onCreate: () => void }) {
  return <><div className="purchase-stats purchase-stats-3"><Stat label="Payments" value={money(totalPayments)} detail="Cash settled with suppliers" icon={<Banknote size={18} />} tone="green" /><Stat label="Supplier credits" value={money(totalCredits)} detail="Credits applied to bills" icon={<FileText size={18} />} tone="violet" /><Stat label="Open bills" value={openBillCount} detail="Available for settlement" icon={<Wallet size={18} />} tone="amber" /></div><Records title="Transaction history" subtitle="Payments and credits recorded against supplier bills." toolbar={<Toolbar value={search} onChange={setSearch} placeholder="Search reference, vendor or method" count={payments.length} />} empty={payments.length === 0} emptyIcon={<CreditCard size={26} />} emptyTitle="No supplier transactions found" emptyMessage={search ? 'Try another search.' : 'Record a payment or supplier credit against an open bill.'} emptyAction={!search && <button className="ch-btn ch-btn-primary ch-btn-sm" onClick={onCreate}><Plus size={14} /> Record transaction</button>}><table className="ch-table purchase-table"><thead><tr><th>Reference</th><th>Vendor</th><th>Type</th><th>Method</th><th>Date</th><th>Amount</th></tr></thead><tbody>{payments.map((p) => <tr key={idOf(p)}><td><b>{p.payment_number}</b></td><td>{vendorNameFor(p.vendor_id)}</td><td><StatusBadge status={p.type} /></td><td>{p.payment_method || '—'}</td><td>{p.payment_date || '—'}</td><td className="purchase-money">{money(p.amount)}</td></tr>)}</tbody></table></Records></>;
}

function Records({ title, subtitle, toolbar, empty, emptyIcon, emptyTitle, emptyMessage, emptyAction, children }: { title: string; subtitle: string; toolbar: ReactNode; empty: boolean; emptyIcon: ReactNode; emptyTitle: string; emptyMessage: string; emptyAction: ReactNode; children: ReactNode }) { return <Card className="purchase-records" title={title} subtitle={subtitle} action={toolbar} padded={empty}>{empty ? <EmptyState icon={emptyIcon} title={emptyTitle} message={emptyMessage} action={emptyAction} /> : <div className="ch-table-wrap">{children}</div>}</Card>; }
