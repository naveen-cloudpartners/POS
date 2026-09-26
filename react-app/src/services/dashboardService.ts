import { apiFetch } from './api';

/* CloudHub POS — dashboard aggregation client (DASH-01…07).
   Single source of truth: all rollups are computed server-side from live
   Orders / OrderItems / Products / StockMovements rows. No heuristics. */

export interface DashboardRevenue {
  today: number;
  week: number;
  month: number;
  total: number;
}

export interface DashboardOrderCounts {
  total: number;
  pending: number;
  offline: number;
  synced: number;
  toInvoice: number;
  today: number;
}

export interface DashboardCustomers {
  total: number;
  new: number;
  returning: number;
  active: number;
}

export interface DashboardProfit {
  total: number;
  linesWithCost: number;
  linesTotal: number;
  revenueOnCostedLines: number;
  marginPct: number;
}

export interface DashboardTopProduct {
  itemId: string;
  name: string;
  sku: string;
  quantity: number;
  revenue: number;
}

export interface DashboardSlowMover {
  sku: string;
  name: string;
  stock: number;
  stockValue: number;
  lastSoldAt: string | null;
}

export interface DashboardMovement {
  id: string;
  itemRowid: string;
  sku: string;
  itemName: string;
  movementType: string;
  quantityChange: number;
  stockBefore: number;
  stockAfter: number;
  referenceType: string;
  referenceId: string;
  reason: string;
  performedBy: string;
  at: string;
}

export interface DashboardSummary {
  revenue: DashboardRevenue;
  orderCounts: DashboardOrderCounts;
  customers: DashboardCustomers;
  profit: DashboardProfit;
  topProducts: Array<DashboardTopProduct>;
  slowMovers: Array<DashboardSlowMover>;
  movements: Array<DashboardMovement>;
  generatedAt: string;
}

interface SummaryResponse {
  success: boolean;
  data?: DashboardSummary;
}

export async function getDashboardSummary(): Promise<DashboardSummary | null> {
  try {
    const res = await apiFetch<SummaryResponse>('/dashboard/summary');
    return res.data ?? null;
  } catch {
    return null;
  }
}
