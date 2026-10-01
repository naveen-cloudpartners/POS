import { apiFetch } from './api';
import type { Order, OrderDetail, OrderLineInput } from '../types';
import type { PrintJob } from './printService';

export type { OrderDetail };

interface OrdersResponse {
  success: boolean;
  count?: number;
  data?: Array<Order>;
}

export interface CheckoutPayment {
  mode: string;
  amount: number;
}

export interface CheckoutInput {
  customer_name: string;
  customer_email?: string;
  payment_mode: string;
  room_number?: string;
  kitchen_notes?: string;
  line_items: Array<OrderLineInput>;
  invoice_number?: string;
  local_ref?: string;
  /** Order-level discount % applied after tax (POS-05). */
  discount_pct?: number;
  /** Split tender legs; sum must equal the order total (POS-08/11). */
  payments?: Array<CheckoutPayment>;
  /** Total handed over; must equal the order total (POS-11). */
  tendered?: number;
  /** Email the receipt on success when true + receipt_email set (POS-09). */
  email_receipt?: boolean;
  receipt_email?: string;
}

export interface PosReceiptLine {
  name: string;
  quantity: number;
  rate: number;
  discount: number;
  discountType: 'percent' | 'flat';
  lineTotal: number;
}

export interface PosReceipt {
  store: { store_name?: string; company?: string; currency?: string };
  orderId: string;
  invoiceNumber: string;
  booksInvoiceId: string;
  date: string;
  customerName: string;
  customerEmail: string;
  paymentMode: string;
  payments: Array<CheckoutPayment>;
  lines: Array<PosReceiptLine>;
  subtotal: number;
  tax: number;
  discount: number;
  total: number;
  tendered: number;
  change: number;
}

interface CheckoutResponse {
  success: boolean;
  message?: string;
  payments?: Array<CheckoutPayment>;
  receipt?: PosReceipt;
  /** KOT/print routing plan (backend-planned, terminal-executed). */
  print_jobs?: Array<PrintJob>;
  kot_numbers?: Array<string>;
  stock_deducted?: boolean;
  movements_logged?: number;
  email_sent?: boolean;
  order?: {
    local_order_id?: number | string;
    customer_name?: string;
    room_number?: string;
    kitchen_notes?: string;
    total?: number;
    payment_mode?: string;
  };
  zoho_books?: {
    warning?: string;
    invoice_id?: string;
    invoice_number?: string;
    books_customer_id?: string;
    payment_recorded?: boolean;
    payment_id?: string | null;
  };
}

export interface OrderFilters {
  status?: string;
  customer?: string;
  cashier?: string;
  date_from?: string;
  date_to?: string;
  payment_status?: string;
  payment?: string;
  search?: string;
  limit?: number;
}

/** Server-side filtered history (ORD-04). Empty values are omitted. */
export async function getOrders(filters?: OrderFilters): Promise<Array<Order>> {
  const params = new URLSearchParams();
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).toLowerCase() !== 'all') {
        params.set(k, String(v));
      }
    }
  }
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  const res = await apiFetch<OrdersResponse>(`/orders${suffix}`);
  return res.data ?? [];
}

export async function getOrderDetail(id: string | number): Promise<OrderDetail | null> {
  const res = await apiFetch<{ success: boolean; order?: OrderDetail }>(
    `/orders/${encodeURIComponent(String(id))}`,
  );
  return res.order ?? null;
}

/** Flattened CSV export of the visible order set (report reuse). */
export function exportOrdersCsv(rows: Array<Order>): void {
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Order Number', 'Date', 'Customer', 'Customer Email', 'Cashier', 'Subtotal', 'Tax', 'Total', 'Payment Method', 'Payment Status', 'Order Status']
      .map(esc)
      .join(','),
    ...rows.map((o) =>
      [
        o.invoice_number && o.invoice_number !== '' ? o.invoice_number : `#${String(o.ROWID ?? '')}`,
        String(o.CREATEDTIME ?? ''),
        o.customer_name ?? '',
        o.customer_email ?? '',
        o.cashier_name ?? o.created_by ?? '',
        Number(o.subtotal ?? 0),
        Number(o.tax_amount ?? 0),
        Number(o.total ?? 0),
        o.payment_mode ?? '',
        o.payment_status ?? '',
        o.status ?? '',
      ]
        .map(esc)
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function checkout(input: CheckoutInput): Promise<CheckoutResponse> {
  return apiFetch<CheckoutResponse>('/orders', { method: 'POST', body: input });
}

export async function sendReceiptEmail(orderId: string | number, email: string): Promise<boolean> {
  const res = await apiFetch<{ success: boolean; emailed?: boolean }>(`/orders/${orderId}/email-receipt`, {
    method: 'POST',
    body: { email },
  });
  return res.emailed === true;
}

export async function voidOrder(orderId: string | number, reason?: string): Promise<{ message?: string; restored_lines?: number; movements_logged?: number }> {
  return apiFetch(`/orders/${orderId}/void`, { method: 'POST', body: { reason: reason ?? '' } });
}

export interface ReturnLineInput {
  order_item_id?: string | number;
  product_id?: string | number;
  quantity: number;
}

export interface ReturnResult {
  success: boolean;
  message?: string;
  refund_total?: number;
  refund_mode?: string;
  fully_refunded?: boolean;
  lines?: Array<{ product: string; sku: string; quantity: number; refund: number }>;
  movements_logged?: number;
  points_reversed?: number;
}

/** Process a merchandise return (Admin/Manager). Restocks, refunds, audits. */
export async function returnOrder(
  orderId: string | number,
  input: { items: Array<ReturnLineInput>; reason?: string; refund_mode?: string },
): Promise<ReturnResult> {
  return apiFetch<ReturnResult>(`/orders/${encodeURIComponent(String(orderId))}/return`, {
    method: 'POST',
    body: input,
  });
}
