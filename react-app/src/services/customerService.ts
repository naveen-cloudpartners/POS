import API_BASE, { apiFetch, ApiError } from './api';
import type { Customer, LoyaltyActivity, Order } from '../types';

export { ApiError };
export type { LoyaltyActivity };

/* CloudHub POS — customer directory + CUST-05 loyalty foundation.
   Primary source is GET /api/customers (Customers table with loyalty
   balances + live order stats). If the backend predates the Customers
   table (503), we fall back to the legacy /contacts shape so every
   consumer (POS, Dashboard, Reports, views) keeps working. */

interface CustomersResponse {
  success: boolean;
  count?: number;
  data?: Array<Customer>;
  loyalty?: { enabled?: boolean; points_per_currency?: number };
}

interface LegacyContact {
  id?: string;
  contact_id?: string;
  name?: string;
  contact_name?: string;
  contact_type?: string;
  type?: string;
  email?: string;
  phone?: string;
  company_name?: string;
  company?: string;
  balance?: number | string;
}

function legacyToCustomer(c: LegacyContact, i: number): Customer {
  return {
    id: String(c.id ?? c.contact_id ?? `local-${i}`),
    name: String(c.name ?? c.contact_name ?? 'Unknown'),
    type: String(c.type ?? c.contact_type ?? 'Customer'),
    email: c.email ?? '',
    phone: c.phone ?? '',
    company: c.company ?? c.company_name ?? '',
    address: '',
    balance: typeof c.balance === 'number' ? c.balance : Number(c.balance ?? 0),
    loyalty_points: 0,
    lifetime_points: 0,
    tier: 'New',
  };
}

async function legacyCustomers(): Promise<Array<Customer>> {
  const res = await apiFetch<{ success: boolean; contacts?: Array<LegacyContact> }>('/contacts');
  return (res.contacts ?? []).map(legacyToCustomer);
}

export async function getCustomers(filters?: { search?: string; tier?: string }): Promise<Array<Customer>> {
  const params = new URLSearchParams();
  if (filters?.search) params.set('search', filters.search);
  if (filters?.tier) params.set('tier', filters.tier);
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  try {
    const res = await apiFetch<CustomersResponse>(`/customers${suffix}`);
    return (res.data ?? []).map((c) => ({
      ...c,
      last_order: c.last_order ?? c.last_order_at ?? '',
    }));
  } catch (e) {
    // Backend predates the Customers table → legacy directory (no loyalty).
    if (e instanceof ApiError && e.status === 503) return legacyCustomers();
    throw e;
  }
}

export interface CustomerDetail {
  customer: Customer;
  recent_orders: Array<Order>;
  loyalty_activity: Array<LoyaltyActivity>;
}

export async function getCustomer(id: string | number): Promise<CustomerDetail> {
  const res = await apiFetch<{
    success: boolean;
    customer?: Customer;
    recent_orders?: Array<Order>;
    loyalty_activity?: Array<LoyaltyActivity>;
  }>(`/customers/${encodeURIComponent(String(id))}`);
  const c = (res.customer ?? {}) as Customer;
  return {
    customer: { ...c, last_order: c.last_order ?? c.last_order_at ?? '' },
    recent_orders: res.recent_orders ?? [],
    loyalty_activity: res.loyalty_activity ?? [],
  };
}

export interface SaveCustomerInput {
  id?: string;
  name: string;
  type?: string;
  email?: string;
  phone?: string;
  company?: string;
  address?: string;
}

/** Create (no id) or update (id) — same signature as the legacy helper. */
export async function saveCustomer(input: SaveCustomerInput): Promise<Customer | null> {
  if (input.id !== undefined && String(input.id).trim() !== '' && !String(input.id).startsWith('local-')) {
    return updateCustomer(input.id, input);
  }
  const payload = { ...input };
  delete payload.id;
  try {
    const res = await apiFetch<{ success: boolean; customer?: Customer }>('/customers', {
      method: 'POST',
      body: payload,
    });
    return res.customer ?? null;
  } catch (e) {
    if (e instanceof ApiError && e.status === 503) {
      // Legacy backend: write through the old contacts endpoint.
      await apiFetch<{ success: boolean }>('/contacts', { method: 'POST', body: payload });
      return null;
    }
    throw e;
  }
}

export async function updateCustomer(
  id: string | number,
  input: Partial<Omit<SaveCustomerInput, 'id'>>,
): Promise<Customer | null> {
  const res = await apiFetch<{ success: boolean; customer?: Customer }>(
    `/customers/${encodeURIComponent(String(id))}`,
    { method: 'PUT', body: input },
  );
  return res.customer ?? null;
}

export async function deleteCustomer(id: string | number): Promise<{ success: boolean; message?: string }> {
  return apiFetch<{ success: boolean; message?: string }>(
    `/customers/${encodeURIComponent(String(id))}`,
    { method: 'DELETE' },
  );
}

/* ---------------- Loyalty (CUST-05) ---------------- */

export interface AdjustPointsResult {
  success: boolean;
  message?: string;
  loyalty_points?: number;
  lifetime_points?: number;
  tier?: string;
  activity_logged?: boolean;
}

export async function adjustPoints(
  id: string | number,
  input: { points: number; reason: string },
): Promise<AdjustPointsResult> {
  return apiFetch<AdjustPointsResult>(
    `/customers/${encodeURIComponent(String(id))}/adjust-points`,
    { method: 'POST', body: input },
  );
}

/* ---------------- Reward campaigns + redemption ---------------- */

export interface RewardCampaign {
  id: string;
  name: string;
  description: string;
  points_cost: number;
  reward_type: 'discount_percent' | 'discount_flat';
  reward_value: number;
  active: boolean;
  created_at?: string;
}

export async function getCampaigns(activeOnly = false): Promise<Array<RewardCampaign>> {
  const res = await apiFetch<{ success: boolean; count?: number; data?: Array<RewardCampaign> }>(
    `/loyalty/campaigns${activeOnly ? '?active=true' : ''}`,
  );
  return res.data ?? [];
}

export async function createCampaign(input: {
  name: string;
  description?: string;
  points_cost: number;
  reward_type: 'discount_percent' | 'discount_flat';
  reward_value: number;
  active?: boolean;
}): Promise<RewardCampaign | null> {
  const res = await apiFetch<{ success: boolean; message?: string; campaign?: RewardCampaign }>('/loyalty/campaigns', {
    method: 'POST',
    body: input,
  });
  return res.campaign ?? null;
}

export async function updateCampaign(
  id: string,
  input: Partial<Pick<RewardCampaign, 'name' | 'description' | 'points_cost' | 'reward_type' | 'reward_value' | 'active'>>,
): Promise<RewardCampaign | null> {
  const res = await apiFetch<{ success: boolean; message?: string; campaign?: RewardCampaign }>(
    `/loyalty/campaigns/${encodeURIComponent(id)}`,
    { method: 'PUT', body: input },
  );
  return res.campaign ?? null;
}

export interface RedeemResult {
  success: boolean;
  message?: string;
  voucher?: string;
  campaign?: RewardCampaign;
  loyalty_points?: number;
  reward?: { type: 'flat' | 'percent'; value: number };
}

export async function redeemReward(customerId: string | number, campaignId: string): Promise<RedeemResult> {
  return apiFetch<RedeemResult>(`/customers/${encodeURIComponent(String(customerId))}/redeem`, {
    method: 'POST',
    body: { campaign_id: campaignId },
  });
}

/** Export the visible directory as CSV (report framework reuse). */
export function exportCustomersCsv(rows: Array<Customer>): void {
  const esc = (v: unknown): string => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [
    ['Name', 'Email', 'Phone', 'Company', 'Tier', 'Points', 'Lifetime Points', 'Orders', 'Lifetime Value'].map(esc).join(','),
    ...rows.map((c) =>
      [
        c.name,
        c.email ?? '',
        c.phone ?? '',
        c.company ?? '',
        c.tier ?? '',
        c.loyalty_points ?? 0,
        c.lifetime_points ?? 0,
        c.order_count ?? 0,
        c.lifetime_value ?? 0,
      ]
        .map(esc)
        .join(','),
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default API_BASE;
