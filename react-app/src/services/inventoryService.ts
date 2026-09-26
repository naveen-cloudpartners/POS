import { apiFetch, ApiError } from './api';
import type {
  StockTransfer,
  TransferItemInput,
  Warehouse,
  WarehouseStockRow,
} from '../types';

export { ApiError };

/* ---------------- Warehouses (INV-04) ---------------- */

interface WarehousesResponse {
  success: boolean;
  count?: number;
  data?: Array<Warehouse>;
}

interface WarehouseResponse {
  success: boolean;
  message?: string;
  warehouse?: Warehouse;
}

export async function getWarehouses(): Promise<Array<Warehouse>> {
  const res = await apiFetch<WarehousesResponse>('/warehouses');
  return res.data ?? [];
}

export async function createWarehouse(input: {
  name: string;
  code: string;
  description?: string;
  address?: string;
  contact_person?: string;
  contact_phone?: string;
  status?: string;
  is_default?: boolean;
}): Promise<Warehouse | null> {
  const res = await apiFetch<WarehouseResponse>('/warehouses', { method: 'POST', body: input });
  return res.warehouse ?? null;
}

export async function updateWarehouse(
  id: string | number,
  input: Partial<Pick<Warehouse, 'name' | 'code' | 'description' | 'address' | 'contact_person' | 'contact_phone' | 'status' | 'is_default'>>,
): Promise<Warehouse | null> {
  const res = await apiFetch<WarehouseResponse>(`/warehouses/${encodeURIComponent(String(id))}`, {
    method: 'PUT',
    body: input,
  });
  return res.warehouse ?? null;
}

export async function deleteWarehouse(id: string | number): Promise<{ success: boolean; message?: string }> {
  return apiFetch<{ success: boolean; message?: string }>(`/warehouses/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
  });
}

export async function setDefaultWarehouse(id: string | number): Promise<void> {
  await apiFetch<{ success: boolean }>(`/warehouses/${encodeURIComponent(String(id))}/default`, {
    method: 'POST',
    body: {},
  });
}

/* ---------------- Warehouse stock (INV-01) ---------------- */

interface WarehouseStockResponse {
  success: boolean;
  count?: number;
  data?: Array<WarehouseStockRow>;
}

export async function getWarehouseStock(filters?: {
  warehouse_id?: string;
  product_id?: string;
  status?: string;
}): Promise<Array<WarehouseStockRow>> {
  const params = new URLSearchParams();
  if (filters?.warehouse_id) params.set('warehouse_id', filters.warehouse_id);
  if (filters?.product_id) params.set('product_id', filters.product_id);
  if (filters?.status) params.set('status', filters.status);
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  const res = await apiFetch<WarehouseStockResponse>(`/warehouse-stock${suffix}`);
  return res.data ?? [];
}

export interface WarehouseAdjustResult {
  success: boolean;
  message?: string;
  warehouse_id?: string;
  warehouse_name?: string;
  product_id?: string;
  old_stock?: number;
  new_stock?: number;
  aggregate_stock?: number | null;
  movement_logged?: boolean;
  movement_id?: string | null;
}

export async function adjustWarehouseStock(input: {
  warehouse_id: string | number;
  product_id: string | number;
  quantity: number;
  reason?: string;
  reorder_level?: number;
}): Promise<WarehouseAdjustResult> {
  return apiFetch<WarehouseAdjustResult>('/warehouse-stock/adjust', { method: 'POST', body: input });
}

/* ---------------- Transfers (INV-05) ---------------- */

interface TransfersResponse {
  success: boolean;
  count?: number;
  data?: Array<StockTransfer>;
}

interface TransferResponse {
  success: boolean;
  message?: string;
  transfer?: StockTransfer;
  movements_logged?: number;
}

export async function getTransfers(filters?: {
  status?: string;
  source_warehouse_id?: string;
  destination_warehouse_id?: string;
  from?: string;
  to?: string;
}): Promise<Array<StockTransfer>> {
  const params = new URLSearchParams();
  if (filters?.status) params.set('status', filters.status);
  if (filters?.source_warehouse_id) params.set('source_warehouse_id', filters.source_warehouse_id);
  if (filters?.destination_warehouse_id) params.set('destination_warehouse_id', filters.destination_warehouse_id);
  if (filters?.from) params.set('from', filters.from);
  if (filters?.to) params.set('to', filters.to);
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  const res = await apiFetch<TransfersResponse>(`/transfers${suffix}`);
  return res.data ?? [];
}

export async function getTransfer(id: string | number): Promise<StockTransfer | null> {
  const res = await apiFetch<TransferResponse>(`/transfers/${encodeURIComponent(String(id))}`);
  return res.transfer ?? null;
}

export async function createTransfer(input: {
  source_warehouse_id: string | number;
  destination_warehouse_id: string | number;
  items: Array<TransferItemInput>;
  notes?: string;
  status?: 'Draft' | 'Pending';
}): Promise<StockTransfer | null> {
  const res = await apiFetch<TransferResponse>('/transfers', { method: 'POST', body: input });
  return res.transfer ?? null;
}

export async function approveTransfer(id: string | number): Promise<StockTransfer | null> {
  const res = await apiFetch<TransferResponse>(`/transfers/${encodeURIComponent(String(id))}/approve`, {
    method: 'POST',
    body: {},
  });
  return res.transfer ?? null;
}

export async function completeTransfer(id: string | number): Promise<TransferResponse> {
  return apiFetch<TransferResponse>(`/transfers/${encodeURIComponent(String(id))}/complete`, {
    method: 'POST',
    body: {},
  });
}

export async function cancelTransfer(id: string | number): Promise<StockTransfer | null> {
  const res = await apiFetch<TransferResponse>(`/transfers/${encodeURIComponent(String(id))}/cancel`, {
    method: 'POST',
    body: {},
  });
  return res.transfer ?? null;
}

/* ---------------- Stock movement ledger (INV-06) ---------------- */

export interface StockMovement {
  ROWID?: number | string;
  item_rowid: string;
  sku: string;
  item_name: string;
  movement_type: string;
  quantity_change: number;
  stock_before: number;
  stock_after: number;
  reference_type: string;
  reference_id: string;
  reason: string;
  performed_by: string;
  warehouse_id: string;
  from_warehouse_id: string;
  to_warehouse_id: string;
  created_at?: string | null;
}

export async function getStockMovements(filters?: {
  product?: string;
  type?: string;
  warehouse?: string;
  reference?: string;
  search?: string;
  date_from?: string;
  date_to?: string;
}): Promise<{ rows: StockMovement[]; summary: { movements: number; units_in: number; units_out: number }; types: string[] }> {
  const params = new URLSearchParams();
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).toLowerCase() !== 'all') {
        params.set(k, String(v));
      }
    }
  }
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  const res = await apiFetch<{
    success: boolean;
    count?: number;
    data?: Array<StockMovement>;
    summary?: { movements: number; units_in: number; units_out: number };
    types?: string[];
  }>(`/stock-movements${suffix}`);
  return {
    rows: res.data ?? [],
    summary: res.summary ?? { movements: 0, units_in: 0, units_out: 0 },
    types: res.types ?? [],
  };
}
