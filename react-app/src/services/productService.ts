import API_BASE, { apiFetch, ApiError } from './api';
import type { Category, Product } from '../types';

export { ApiError };

interface ItemsResponse {
  success: boolean;
  count?: number;
  data?: Array<Product>;
}

interface ItemMutationResponse {
  success: boolean;
  message?: string;
  item?: Product;
}

interface StockAdjustResponse {
  success: boolean;
  message?: string;
  old_stock?: number;
  new_stock?: number;
}

interface SyncResponse {
  success: boolean;
  message?: string;
  summary?: { total_fetched: number; inserted: number; updated: number; failed: number };
}

export async function getProducts(): Promise<Array<Product>> {
  const res = await apiFetch<ItemsResponse>('/items');
  return res.data ?? [];
}

export async function createProduct(input: {
  name: string;
  sku: string;
  rate: number;
  stock: number;
  category?: string;
  tax_percentage?: number;
  books_item_id?: string;
  cost_price?: number;
  reorder_level?: number;
  status?: string;
  barcode?: string;
  unit?: string;
  description?: string;
  category_id?: number | string | null;
  category_ids?: Array<string>;
}): Promise<Product | null> {
  const res = await apiFetch<ItemMutationResponse>('/items', { method: 'POST', body: input });
  return res.item ?? null;
}

export async function updateProduct(
  id: string | number,
  input: Partial<Pick<Product, 'name' | 'rate' | 'stock' | 'category' | 'tax_percentage' | 'cost_price' | 'reorder_level' | 'status' | 'barcode' | 'unit' | 'description' | 'category_id'> & { category_ids?: Array<string> }>,
): Promise<void> {
  await apiFetch<{ success: boolean }>(`/items/${id}`, { method: 'PUT', body: input });
}

/* ---------------- PROD-08: File Store product images ---------------- */

/** Direct image URL (bytes stream through the backend; auth via session). */
export function productImageUrl(id: string | number): string {
  return `${API_BASE}/items/${encodeURIComponent(String(id))}/image`;
}

export interface ProductImageResult {
  success: boolean;
  message?: string;
  image_id?: string;
  image_name?: string;
  image_url?: string;
}

export async function uploadProductImage(
  id: string | number,
  input: { imageData: string; mimeType: string; fileName: string },
): Promise<ProductImageResult> {
  return apiFetch<ProductImageResult>(`/items/${id}/image`, { method: 'POST', body: input });
}

export async function deleteProductImage(id: string | number): Promise<void> {
  await apiFetch<{ success: boolean }>(`/items/${id}/image`, { method: 'DELETE' });
}

/* ---------------- PROD-09: CSV import / export ---------------- */

export interface ImportRowError {
  row: number;
  sku: string;
  error: string;
}

export interface ImportResult {
  success: boolean;
  inserted: number;
  failed: number;
  errors: Array<ImportRowError>;
}

export async function importProductsCsv(rows: Array<Record<string, string>>): Promise<ImportResult> {
  return apiFetch<ImportResult>('/items/import', { method: 'POST', body: { rows } });
}

/** Download the full catalog CSV (server-generated, single source of truth). */
export async function exportProductsCsv(): Promise<void> {
  const resp = await fetch(`${API_BASE}/items/export`, { credentials: 'same-origin' });
  if (!resp.ok) throw new ApiError(resp.status, 'Export failed.');
  const blob = await resp.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `products-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteProduct(id: string | number): Promise<void> {
  await apiFetch<{ success: boolean }>(`/items/${id}`, { method: 'DELETE' });
}

export async function adjustStock(rowid: string | number, delta: number, reason?: string): Promise<StockAdjustResponse> {
  return apiFetch<StockAdjustResponse>('/items/stock-adjust', {
    method: 'POST',
    body: { rowid, delta, reason: reason ?? '' },
  });
}

export async function syncFromBooks(): Promise<SyncResponse> {
  return apiFetch<SyncResponse>('/sync/books', { method: 'POST', body: {} });
}

/* ---------------- Categories (first-class catalog grouping) ---------------- */

interface CategoriesResponse {
  success: boolean;
  count?: number;
  data?: Array<Category>;
}

interface CategoryMutationResponse {
  success: boolean;
  message?: string;
  category?: Category;
}

export async function getCategories(): Promise<Array<Category>> {
  const res = await apiFetch<CategoriesResponse>('/categories');
  return res.data ?? [];
}

export async function createCategory(input: {
  name: string;
  description?: string;
  display_order?: number;
  status?: string;
}): Promise<Category | null> {
  const res = await apiFetch<CategoryMutationResponse>('/categories', { method: 'POST', body: input });
  return res.category ?? null;
}

export async function updateCategory(
  id: string | number,
  input: Partial<Pick<Category, 'name' | 'description' | 'status' | 'display_order'>>,
): Promise<void> {
  await apiFetch<{ success: boolean }>(`/categories/${id}`, { method: 'PUT', body: input });
}

/** Deactivate via status update (reversible, products keep working). */
export async function deactivateCategory(id: string | number): Promise<void> {
  await apiFetch<{ success: boolean }>(`/categories/${id}`, { method: 'PUT', body: { status: 'Inactive' } });
}

/** Hard delete — the API allows it only when zero products are linked (else 409). */
export async function deleteCategory(id: string | number): Promise<{ success: boolean; message?: string }> {
  return apiFetch<{ success: boolean; message?: string }>(`/categories/${id}`, { method: 'DELETE' });
}

export interface RepairResult {
  success: boolean;
  message?: string;
  checked: number;
  fixed: number;
  issues: Array<{ sku: string; name: string; reason: string }>;
}

/** Audit + auto-repair product↔category links (safe: only unambiguous fixes). */
export async function repairCategoryLinks(): Promise<RepairResult> {
  return apiFetch<RepairResult>('/categories/repair', { method: 'POST', body: {} });
}