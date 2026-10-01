import { apiFetch } from './api';

export interface Vendor { ROWID?: string | number; vendor_number?: string; name: string; email?: string; phone?: string; status?: string; }
export interface PurchaseLine { ROWID?: string | number; product_id: string; quantity: number; received_quantity: number; unit_cost: number; tax_percentage?: number; }
export interface PurchaseOrder { ROWID?: string | number; po_number: string; vendor_id: string; warehouse_id: string; status: string; expected_date?: string; total_amount: number; notes?: string; items: PurchaseLine[]; }
export interface VendorBill { ROWID?: string | number; bill_number: string; vendor_id: string; purchase_order_id?: string; status: string; total_amount: number; paid_amount: number; bill_date?: string; due_date?: string; }
export interface VendorPayment { ROWID?: string | number; payment_number: string; vendor_id: string; bill_id?: string; type: string; amount: number; payment_date?: string; payment_method?: string; }

const data = <T>(path: string) => apiFetch<{ success: boolean; data?: T }>(path).then((r) => r.data ?? ([] as unknown as T));
export const getVendors = () => data<Array<Vendor>>('/purchases/vendors');
export const createVendor = (body: Partial<Vendor>) => apiFetch('/purchases/vendors', { method: 'POST', body });
export const getPurchaseOrders = () => data<Array<PurchaseOrder>>('/purchases/orders');
export const createPurchaseOrder = (body: { vendor_id: string; warehouse_id: string; expected_date?: string; notes?: string; items: Array<Pick<PurchaseLine, 'product_id' | 'quantity' | 'unit_cost' | 'tax_percentage'>> }) => apiFetch('/purchases/orders', { method: 'POST', body });
export const approvePurchaseOrder = (id: string | number) => apiFetch(`/purchases/orders/${encodeURIComponent(String(id))}/approve`, { method: 'POST', body: {} });
export const receivePurchaseOrder = (id: string | number, items: Array<{ purchase_order_item_id: string | number; quantity: number }>) => apiFetch(`/purchases/orders/${encodeURIComponent(String(id))}/receive`, { method: 'POST', body: { items } });
export const getVendorBills = () => data<Array<VendorBill>>('/purchases/bills');
export const createVendorBill = (body: Partial<VendorBill>) => apiFetch('/purchases/bills', { method: 'POST', body });
export const getVendorPayments = () => data<Array<VendorPayment>>('/purchases/payments');
export const createVendorPayment = (body: Partial<VendorPayment>) => apiFetch('/purchases/payments', { method: 'POST', body });

/** Preserve successful sections when an unrelated purchasing table is unavailable. */
export async function getPurchasingRecords(includePayables = true) {
  const results = await Promise.allSettled([
    getVendors(), getPurchaseOrders(),
    includePayables ? getVendorBills() : Promise.resolve([] as VendorBill[]),
    includePayables ? getVendorPayments() : Promise.resolve([] as VendorPayment[]),
  ] as const);
  const errors: Partial<Record<'vendors' | 'orders' | 'bills' | 'payments', string>> = {};
  const names = ['vendors', 'orders', 'bills', 'payments'] as const;
  results.forEach((result, index) => {
    if (result.status === 'rejected') errors[names[index]] = result.reason instanceof Error ? result.reason.message : 'Could not load this section.';
  });
  return {
    vendors: results[0].status === 'fulfilled' ? results[0].value : [],
    orders: results[1].status === 'fulfilled' ? results[1].value : [],
    bills: results[2].status === 'fulfilled' ? results[2].value : [],
    payments: results[3].status === 'fulfilled' ? results[3].value : [],
    errors,
  };
}
