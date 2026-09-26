import API_BASE, { apiFetch } from './api';

/* CloudHub POS — server-side reporting client (RPT-01…06).
   Every report recalculates on the backend for the active filter set
   (period presets, custom range, customer, cashier, warehouse, category,
   payment, status). CSV/PDF exports honor the same filters. */

export type ReportPeriod =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'week'
  | 'month'
  | 'lastmonth'
  | 'year'
  | 'custom'
  | 'all';

export interface ReportRange {
  from: string;
  to: string;
  period: string;
  label: string;
}

export interface ReportFilters {
  period?: ReportPeriod | string;
  date_from?: string;
  date_to?: string;
  customer?: string;
  cashier?: string;
  warehouse?: string;
  category?: string;
  payment?: string;
  status?: string;
}

export interface RevenueReport {
  revenue: number;
  order_count: number;
  average_order_value: number;
  revenue_by_day: Array<{ day: string; orders: number; revenue: number }>;
  revenue_by_week: Array<{ week: string; orders: number; revenue: number }>;
  revenue_by_month: Array<{ month: string; orders: number; revenue: number }>;
  revenue_by_payment_method: Array<{ method: string; orders: number; revenue: number }>;
  revenue_by_customer: Array<{ name: string; orders: number; revenue: number }>;
  revenue_by_cashier: Array<{ cashier: string; orders: number; revenue: number }>;
  growth_percentage: number;
  previous_revenue: number;
  range: ReportRange;
}

export interface ProductPerfRow {
  product_id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
  cost: number;
  stock: number;
  reorder_level: number;
  quantity: number;
  revenue: number;
  profit: number;
  margin_pct: number;
  turnover: number;
  last_sold_at: string;
}

export interface ProductReport {
  best_sellers: Array<ProductPerfRow>;
  worst_sellers: Array<ProductPerfRow>;
  most_profitable: Array<ProductPerfRow>;
  least_profitable: Array<ProductPerfRow>;
  top_revenue: Array<ProductPerfRow>;
  slow_movers: Array<ProductPerfRow>;
  coverage: { lines_with_cost: number; lines_total: number };
  range: ReportRange;
}

export interface CustomerReportRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  tier: string;
  loyalty_points: number;
  lifetime_points: number;
  orders: number;
  lifetime_value: number;
  average_order_value: number;
  joined_at: string;
}

export interface CustomerReport {
  total_customers: number;
  active_customers: number;
  new_customers: number;
  returning_customers: number;
  average_frequency: number;
  total_lifetime_value: number;
  average_lifetime_value: number;
  loyalty_distribution: Array<{ tier: string; members: number }>;
  vip_customers: Array<CustomerReportRow>;
  top_customers: Array<CustomerReportRow>;
  revenue_trend: Array<{ day: string; revenue: number; customers: number }>;
  range: ReportRange;
}

export interface ProfitReport {
  revenue: number;
  cost: number;
  gross_profit: number;
  margin_pct: number;
  coverage: { lines_with_cost: number; lines_total: number };
  by_product: Array<{ product_id: string; sku: string; name: string; category: string; quantity: number; revenue: number; cost: number; profit: number; margin_pct: number }>;
  by_category: Array<{ category: string; quantity: number; revenue: number; cost: number; profit: number; margin_pct: number }>;
  by_day: Array<{ day: string; revenue: number; cost: number; profit: number; margin_pct: number }>;
  range: ReportRange;
}

export interface RegisterReport {
  cashiers: Array<{ cashier: string; orders: number; revenue: number; cash: number; card: number }>;
  shifts: Array<{ id: string; cashier: string; opening_float: number; cash_sales: number; noncash_sales: number; expected_cash: number; actual_cash: number; variance: number; status: string; at: string }>;
  cash_summary: { cash: number; card: number; other: number; total: number };
  payment_breakdown: Array<{ method: string; orders: number; revenue: number }>;
  refunds: { count: number; value: number };
  voids: { count: number; value: number };
  range: ReportRange;
}

function queryString(filters: ReportFilters): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') params.set(k, String(v));
  }
  const s = params.toString();
  return s === '' ? '' : `?${s}`;
}

export async function getRevenueReport(filters: ReportFilters): Promise<RevenueReport | null> {
  try {
    const res = await apiFetch<{ success: boolean; report?: RevenueReport }>(`/reports/revenue${queryString(filters)}`);
    return res.report ?? null;
  } catch {
    return null;
  }
}

export async function getProductReport(filters: ReportFilters): Promise<ProductReport | null> {
  try {
    const res = await apiFetch<{ success: boolean; report?: ProductReport }>(`/reports/products${queryString(filters)}`);
    return res.report ?? null;
  } catch {
    return null;
  }
}

export async function getCustomerReport(filters: ReportFilters): Promise<CustomerReport | null> {
  try {
    const res = await apiFetch<{ success: boolean; report?: CustomerReport }>(`/reports/customers${queryString(filters)}`);
    return res.report ?? null;
  } catch {
    return null;
  }
}

export async function getProfitReport(filters: ReportFilters): Promise<ProfitReport | null> {
  try {
    const res = await apiFetch<{ success: boolean; report?: ProfitReport }>(`/reports/profit${queryString(filters)}`);
    return res.report ?? null;
  } catch {
    return null;
  }
}

export async function getRegisterReport(filters: ReportFilters): Promise<RegisterReport | null> {
  try {
    const res = await apiFetch<{ success: boolean; report?: RegisterReport }>(`/reports/registers${queryString(filters)}`);
    return res.report ?? null;
  } catch {
    return null;
  }
}

export type ExportType = 'revenue' | 'products' | 'customers' | 'profit' | 'registers' | 'orders' | 'inventory';

async function downloadFile(kind: 'csv' | 'pdf', type: ExportType, filters: ReportFilters): Promise<void> {
  const resp = await fetch(`${API_BASE}/reports/export/${kind}?type=${encodeURIComponent(type)}&${queryString(filters).slice(1)}`, {
    credentials: 'same-origin',
  });
  if (!resp.ok) {
    let msg = `Export failed (${resp.status})`;
    try {
      const data = (await resp.json()) as { error?: string; message?: string };
      msg = data.error ?? data.message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(msg);
  }
  const blob = await resp.blob();
  const fallback = kind === 'pdf' ? `${type}-report.pdf` : `${type}-report.csv`;
  const disposition = resp.headers.get('content-disposition') ?? '';
  const match = /filename="([^"]+)"/.exec(disposition);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = match?.[1] ?? fallback;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function exportReportCsv(type: ExportType, filters: ReportFilters): Promise<void> {
  await downloadFile('csv', type, filters);
}

export async function exportReportPdf(type: ExportType, filters: ReportFilters): Promise<void> {
  await downloadFile('pdf', type, filters);
}

export const REPORT_PERIOD_OPTIONS: Array<{ value: ReportPeriod; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'lastmonth', label: 'Last month' },
  { value: 'year', label: 'This year' },
  { value: 'custom', label: 'Custom range…' },
  { value: 'all', label: 'All time' },
];
