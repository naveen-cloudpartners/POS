/* CloudHub POS — formatting helpers */

import type { Product } from '../types';

/* Active display currency (store default; explicit per-call code wins).
   Initialized once from Settings by the app shell — defaults to LKR so
   every existing call site keeps working unchanged. */
let activeCurrencyCode = 'LKR';

export function setCurrencyCode(code: string): void {
  const c = String(code ?? '').trim().toUpperCase();
  if (c !== '') activeCurrencyCode = c;
}

export function currency(n: unknown, code?: string): string {
  const use = String(code ?? activeCurrencyCode ?? 'LKR').toUpperCase() || 'LKR';
  const v = typeof n === 'number' ? n : Number(n ?? 0);
  const safe = Number.isFinite(v) ? v : 0;
  try {
    return new Intl.NumberFormat('en-LK', { style: 'currency', currency: use, maximumFractionDigits: 2 }).format(safe);
  } catch {
    return `${use} ${safe.toFixed(2)}`;
  }
}

export function number(n: unknown): string {
  const v = typeof n === 'number' ? n : Number(n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return new Intl.NumberFormat('en-US').format(v);
}

export function formatDate(iso: unknown): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatDay(iso: unknown): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return (parts[0] as string).charAt(0).toUpperCase();
  return `${(parts[0] as string).charAt(0)}${(parts[parts.length - 1] as string).charAt(0)}`.toUpperCase();
}

export function stockStatus(stock: number): string {
  if (stock <= 0) return 'Out of stock';
  if (stock <= 10) return 'Low stock';
  return 'In stock';
}

/* ---- Per-product reorder + cost-aware valuation (Product Management) ----
   Legacy `stockStatus` (fixed ≤ 10) is intentionally untouched: other
   modules keep their current behavior while Products adopts these. */


/** Display category: linked table name → legacy text → General. */
export function categoryNameOf(p: Product): string {
  const linked = (p.category_name ?? '').trim();
  if (linked !== '') return linked;
  const legacy = (p.category ?? '').trim();
  return legacy === '' ? 'General' : legacy;
}

/* ---- PROD-05 multi-category (primary link + id array stay compatible) ---- */

/** Every linked category id: category_ids[] → single category_id → none. */
export function productCategoryIds(p: Product): Array<string> {
  const unique = (list: Array<unknown>): Array<string> => [...new Set(
    list.map((v) => String(v ?? '').trim()).filter((v) => v !== ''),
  )];
  const raw = p.category_ids;
  if (Array.isArray(raw)) {
    const ids = unique(raw);
    if (ids.length > 0) return ids;
  } else if (typeof raw === 'string' && raw.trim() !== '') {
    const text = raw.trim();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { parsed = null; }
    if (Array.isArray(parsed)) {
      const ids = unique(parsed);
      if (ids.length > 0) return ids;
    } else if (text.includes(';')) {
      return unique(text.split(';'));
    } else {
      return [text];
    }
  }
  if (p.category_id !== undefined && p.category_id !== null && String(p.category_id).trim() !== '') {
    return [String(p.category_id).trim()];
  }
  return [];
}

/** Display names for every linked category (lookup → legacy → General). */
export function productCategoryNames(
  p: Product,
  lookup: (id: string) => string | undefined,
): Array<string> {
  if (Array.isArray(p.category_names) && p.category_names.length > 0) {
    return p.category_names.map((n) => String(n)).filter((n) => n !== '');
  }
  const names = productCategoryIds(p)
    .map((id) => lookup(id))
    .filter((n): n is string => n !== undefined && n !== '');
  if (names.length > 0) return names;
  const legacy = categoryNameOf(p);
  return legacy === '' ? [] : [legacy];
}

/** Reorder threshold for a product; falls back to 10 only when unset. */
export function reorderLevelOf(p: Product): number {
  const v = typeof p.reorder_level === 'number' ? p.reorder_level : Number(p.reorder_level);
  if (!Number.isFinite(v) || v < 0) return 10;
  return Math.floor(v);
}

/** Low stock = positive stock at/below the product's own reorder level. */
export function isLowStock(p: Product): boolean {
  const s = Number(p.stock ?? 0);
  return s > 0 && s <= reorderLevelOf(p);
}

export function isOutOfStock(p: Product): boolean {
  return Number(p.stock ?? 0) <= 0;
}

/** Inventory value prefers cost_price × stock; falls back to rate × stock. */
export function stockValueOf(p: Product): number {
  const cost = Number(p.cost_price);
  const unit = Number.isFinite(cost) && cost > 0 ? cost : Number(p.rate || 0);
  return unit * Number(p.stock || 0);
}

/** Selling margin per unit (rate − cost), may be negative or zero. */
export function profitPerUnit(p: Product): number {
  return Number(p.rate || 0) - (Number(p.cost_price) || 0);
}

/* ---- Customer value presentation helpers (display-only) ---- */

export type CustomerTier = 'VIP' | 'Loyal' | 'Active' | 'New';

/** Value tier from order history. Display-only segmentation. */
export function customerTier(orderCount: number, lifetimeValue: number): CustomerTier {
  if (lifetimeValue >= 100000 || orderCount >= 20) return 'VIP';
  if (lifetimeValue >= 25000 || orderCount >= 5) return 'Loyal';
  if (orderCount >= 1) return 'Active';
  return 'New';
}

const AVATAR_GRADS = [
  'linear-gradient(135deg,#7ba4ff,#3a76f8)',
  'linear-gradient(135deg,#5ad6a0,#22b378)',
  'linear-gradient(135deg,#ffb86b,#fd9134)',
  'linear-gradient(135deg,#c39bff,#8b5cf6)',
  'linear-gradient(135deg,#ff9db0,#e84646)',
];

/** Stable gradient per name for avatars. Display-only. */
export function avatarGradient(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_GRADS[h % AVATAR_GRADS.length] ?? AVATAR_GRADS[0] ?? '';
}
