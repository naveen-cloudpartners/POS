/* CloudHub POS — shared domain types (frontend only, mirrors backend shapes) */

export interface Product {
  ROWID?: number | string;
  books_item_id?: string;
  name: string;
  sku: string;
  rate: number;
  stock: number;
  category: string;
  tax_id?: string;
  tax_percentage?: number;
  cost_price?: number;
  reorder_level?: number | null;
  status?: string;
  barcode?: string;
  unit?: string;
  description?: string;
  category_id?: number | string | null;
  category_name?: string;
  /** PROD-05: every linked category id (category_id stays the primary). */
  category_ids?: Array<string> | string | null;
  /** PROD-05: resolved display names, same order as category_ids. */
  category_names?: Array<string>;
  /** PROD-08: File Store image reference (bytes via GET /api/items/:id/image). */
  image_id?: string | null;
  image_name?: string | null;
  image_mime?: string | null;
  image_url?: string | null;
}

export interface Category {
  ROWID?: number | string;
  name: string;
  description?: string;
  status?: string;
  display_order?: number;
  CREATEDTIME?: string;
  MODIFIEDTIME?: string;
}

export interface OrderLineInput {
  books_item_id?: string;
  item_id?: string;
  quantity: number;
  rate: number;
  tax_percentage?: number;
  name?: string;
  /** Line-item discount (POS-05). Percent 0–100 or flat amount. */
  discount_value?: number;
  discount_type?: 'percent' | 'flat';
}

export interface Order {
  ROWID?: number | string;
  customer_name?: string;
  customer_email?: string;
  subtotal?: number;
  tax_amount?: number;
  total?: number;
  payment_mode?: string;
  status?: string;
  books_invoice_id?: string;
  invoice_number?: string;
  local_ref?: string;
  CREATEDTIME?: string;
  /* ---------------- ORD-02/04 enrichments (server-shaped) ---------------- */
  /** Cashier display name captured at checkout (new orders). */
  cashier_name?: string;
  /** Cashier email captured at checkout (new orders). */
  created_by?: string;
  /** Derived settlement state: Paid | Partially Paid | Unpaid | Pending | Void | Refunded. */
  payment_status?: string;
  paid_total?: number;
}

export interface OrderLineDetail {
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  discount: number;
  discount_type?: string;
  net?: number;
  tax: number;
  line_total: number;
}

export interface OrderPaymentLeg {
  method: string;
  amount: number;
}

export interface OrderMovement {
  id: string;
  item_name: string;
  sku: string;
  movement_type: string;
  quantity_change: number;
  stock_before: number;
  stock_after: number;
  reason: string;
  performed_by: string;
  at: string;
}

export interface OrderDetail {
  order_id: string;
  order_number: string;
  customer: {
    name: string;
    email: string;
    phone: string;
    company: string;
    tier: string;
    loyalty_points: number;
    lifetime_points: number;
    lifetime_value: number;
  };
  cashier: { name: string; email: string; role: string };
  created_at: string;
  status: string;
  payment_status: string;
  subtotal: number;
  discount_amount: number;
  discount_percent: number;
  tax_amount: number;
  total_amount: number;
  items: Array<OrderLineDetail>;
  payments: Array<OrderPaymentLeg>;
  paid_total: number;
  balance_due: number;
  payment_mode: string;
  books_invoice_id: string;
  local_ref: string;
  inventory: { movements: Array<OrderMovement>; movement_count: number };
}

/** Legacy line-item row (OrderItems table); the detail view uses OrderLineDetail. */
export interface OrderItem {
  ROWID?: number | string;
  order_id?: number | string;
  item_id?: string;
  quantity?: number;
  rate?: number;
}

export type UserRole = 'Admin' | 'Manager' | 'Cashier' | 'Storekeeper' | 'Waiter' | 'Chef';

export interface PosUser {
  email: string;
  name: string;
  role: string;
  permissions?: Record<string, unknown>;
  /** Lifecycle state: Active | Inactive (+ legacy 'active'). */
  status?: string;
  phone?: string;
  notes?: string;
  invited_by?: string;
  invited_at?: number;
  verified_at?: number;
  last_login?: string;
}

export interface Customer {
  id: string;
  ROWID?: number | string;
  name: string;
  type?: string;
  email?: string;
  phone?: string;
  company?: string;
  /** CUST-01: street address (new profile field). */
  address?: string;
  balance?: number;
  order_count?: number;
  lifetime_value?: number;
  last_order?: string;
  /* ---------------- CUST-05 loyalty foundation ---------------- */
  /** Current usable points balance. */
  loyalty_points?: number;
  /** Total points earned historically (analytics). */
  lifetime_points?: number;
  /** Server-assigned tier: New | Active | Loyal | VIP. */
  tier?: string;
  joined_at?: string | null;
  last_activity_at?: string | null;
  updated_at?: string | null;
  average_order_value?: number;
  last_order_at?: string;
  /** Orders in the trailing 30 days (server metrics). */
  purchase_frequency_30d?: number;
}

export interface LoyaltyActivity {
  ROWID?: number | string;
  delta: number;
  old_points: number;
  new_points: number;
  reason: string;
  performed_by: string;
  created_at?: string;
}

export interface CustomerLoyalty {
  customer_id: string;
  customer_name: string;
  loyalty_points: number;
  lifetime_points: number;
  tier: string;
  points_issued: number;
  points_redeemed: number;
  order_count: number;
  lifetime_value: number;
  program: {
    enabled: boolean;
    points_per_currency: number;
    thresholds: { active: number; loyal: number; vip: number };
  };
  activity: Array<LoyaltyActivity>;
}

export interface StoreSettings {
  store_name?: string;
  company?: string;
  currency?: string;
  tax_rate?: number | string;
  industry?: string;
  name?: string;
  /** INV-08: allow inventory quantities to go below zero (backorders). */
  allow_backorders?: boolean | string | number;
  [key: string]: unknown;
}

export interface SmtpStatus {
  configured: boolean;
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_from: string;
}

export interface ZohoStatus {
  catalyst_connection: boolean;
  master_configured: boolean;
  dc?: string;
  org_id?: string | null;
  connected: boolean;
  connection?: unknown;
}

/* ---------------- Inventory Phase 2 — multi-warehouse ---------------- */

export interface Warehouse {
  ROWID?: number | string;
  name: string;
  code: string;
  description?: string;
  address?: string;
  contact_person?: string;
  contact_phone?: string;
  status?: string;
  is_default?: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  /** Live metrics joined by the backend (list/detail only). */
  skus?: number;
  units?: number;
  inventory_value?: number;
  low_stock_count?: number;
}

export type WarehouseRowStatus = 'Healthy' | 'Low stock' | 'Out of stock' | 'Backordered';

export interface WarehouseStockRow {
  ROWID?: number | string;
  warehouse_id: string;
  warehouse_name: string;
  warehouse_code: string;
  product_id: string;
  product_name: string;
  sku: string;
  category: string;
  rate: number;
  quantity: number;
  reorder_level: number;
  stock_value: number;
  status: string;
  updated_at?: string | null;
}

export type TransferStatus = 'Draft' | 'Pending' | 'Approved' | 'Completed' | 'Cancelled';

export interface TransferItemInput {
  product_id: string;
  quantity: number;
}

export interface TransferItem extends TransferItemInput {
  ROWID?: number | string;
  product_name?: string;
  sku?: string;
}

export interface StockTransfer {
  ROWID?: number | string;
  transfer_number: string;
  source_warehouse_id: string;
  destination_warehouse_id: string;
  source_warehouse_name?: string;
  destination_warehouse_name?: string;
  status: TransferStatus | string;
  notes?: string;
  created_by?: string;
  approved_by?: string;
  completed_by?: string;
  created_at?: string | null;
  approved_at?: string | null;
  completed_at?: string | null;
  items: Array<TransferItem>;
}
