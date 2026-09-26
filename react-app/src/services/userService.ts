import API_BASE, { apiFetch, ApiError } from './api';
import type { PosUser } from '../types';

export { ApiError };

interface UsersResponse {
  success: boolean;
  count?: number;
  users?: Array<PosUser>;
}

interface RoleResponse {
  success: boolean;
  message?: string;
  user?: PosUser;
}

export async function getUsers(): Promise<Array<PosUser>> {
  const res = await apiFetch<UsersResponse>('/users');
  return res.users ?? [];
}

/**
 * Invite a user.
 * NOTE: the deployed backend currently exposes GET /api/users,
 * POST /api/users/update-role and POST /api/users/delete (no dedicated
 * invite route). This helper attempts the documented invite endpoint
 * first and surfaces the backend message so the UI can guide the admin
 * (owner creates the account via Catalyst after approval).
 */
export async function inviteUser(email: string, role: string, name?: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await apiFetch<{ success: boolean; message?: string }>('/users/invite', {
      method: 'POST',
      body: { email, role, name: name ?? '' },
    });
    return { ok: true, message: res.message ?? 'Invitation sent.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Invite failed';
    return { ok: false, message };
  }
}

export async function updateUserRole(email: string, role: string): Promise<RoleResponse> {
  return apiFetch<RoleResponse>('/users/update-role', { method: 'POST', body: { email, role } });
}

export async function removeUser(email: string): Promise<{ success: boolean; message?: string }> {
  return apiFetch<{ success: boolean; message?: string }>('/users/delete', { method: 'POST', body: { email } });
}

/* ---------------- Admin user lifecycle (USR-01 / USR-04) ---------------- */

export interface AdminUserInput {
  name: string;
  email: string;
  role: string;
  phone?: string;
  notes?: string;
}

export async function getAdminUsers(): Promise<Array<PosUser>> {
  const res = await apiFetch<UsersResponse>('/admin/users');
  return res.users ?? [];
}

export async function getAdminUser(email: string): Promise<PosUser | null> {
  const res = await apiFetch<{ success: boolean; user?: PosUser }>(
    `/admin/users/${encodeURIComponent(email)}`,
  );
  return res.user ?? null;
}

export async function createAdminUser(input: AdminUserInput): Promise<{ user: PosUser | null; message?: string; catalyst_invited?: boolean }> {
  const res = await apiFetch<{ success: boolean; message?: string; user?: PosUser; catalyst_invited?: boolean }>(
    '/admin/users',
    { method: 'POST', body: input },
  );
  return { user: res.user ?? null, message: res.message, catalyst_invited: res.catalyst_invited };
}

export async function updateAdminUser(
  email: string,
  input: Partial<Pick<AdminUserInput, 'name' | 'phone' | 'notes'>>,
): Promise<PosUser | null> {
  const res = await apiFetch<{ success: boolean; user?: PosUser }>(
    `/admin/users/${encodeURIComponent(email)}`,
    { method: 'PUT', body: input },
  );
  return res.user ?? null;
}

export async function deleteAdminUser(email: string): Promise<{ success: boolean; message?: string }> {
  return apiFetch<{ success: boolean; message?: string }>(
    `/admin/users/${encodeURIComponent(email)}`,
    { method: 'DELETE' },
  );
}

export async function activateUser(email: string): Promise<PosUser | null> {
  const res = await apiFetch<{ success: boolean; message?: string; user?: PosUser }>(
    `/admin/users/${encodeURIComponent(email)}/activate`,
    { method: 'POST', body: {} },
  );
  return res.user ?? null;
}

export async function deactivateUser(email: string): Promise<PosUser | null> {
  const res = await apiFetch<{ success: boolean; message?: string; user?: PosUser }>(
    `/admin/users/${encodeURIComponent(email)}/deactivate`,
    { method: 'POST', body: {} },
  );
  return res.user ?? null;
}

export async function resetUserPassword(email: string): Promise<{ success: boolean; message?: string; invite_resent?: boolean }> {
  return apiFetch<{ success: boolean; message?: string; invite_resent?: boolean }>(
    `/admin/users/${encodeURIComponent(email)}/reset-password`,
    { method: 'POST', body: {} },
  );
}

export async function changeUserRole(email: string, role: string): Promise<PosUser | null> {
  const res = await apiFetch<{ success: boolean; message?: string; user?: PosUser }>(
    `/admin/users/${encodeURIComponent(email)}/change-role`,
    { method: 'POST', body: { role } },
  );
  return res.user ?? null;
}

/* ---------------- Audit trail (USR-05) ---------------- */

export interface AuditRecord {
  ROWID?: number | string;
  created_at?: string | null;
  user_id: string;
  actor_id: string;
  actor_name: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  entity_name: string;
  old_value: string;
  new_value: string;
  ip_address: string;
  user_agent: string;
}

export interface AuditMetrics {
  total_events: number;
  users_created: number;
  users_deleted: number;
  users_deactivated: number;
  role_changes: number;
  orders_created: number;
  report_exports: number;
  by_action: Array<{ action: string; count: number }>;
}

export interface AuditFilters {
  date_from?: string;
  date_to?: string;
  actor?: string;
  action?: string;
  entity?: string;
  search?: string;
}

export async function getAuditLogs(filters?: AuditFilters): Promise<{ rows: AuditRecord[]; metrics: AuditMetrics | null; actions: string[] }> {
  const params = new URLSearchParams();
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).toLowerCase() !== 'all') {
        params.set(k, String(v));
      }
    }
  }
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  const res = await apiFetch<{ success: boolean; count?: number; data?: Array<AuditRecord>; metrics?: AuditMetrics; actions?: string[] }>(
    `/admin/audit${suffix}`,
  );
  return { rows: res.data ?? [], metrics: res.metrics ?? null, actions: res.actions ?? [] };
}

async function downloadAudit(kind: 'csv' | 'pdf', filters?: AuditFilters): Promise<void> {
  const params = new URLSearchParams();
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).toLowerCase() !== 'all') {
        params.set(k, String(v));
      }
    }
  }
  const resp = await fetch(`${API_BASE}/admin/audit/export/${kind}?${params.toString()}`, {
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
  const fallback = kind === 'pdf' ? 'audit-report.pdf' : 'audit-report.csv';
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

export async function exportAuditCsv(filters?: AuditFilters): Promise<void> {
  await downloadAudit('csv', filters);
}

export async function exportAuditPdf(filters?: AuditFilters): Promise<void> {
  await downloadAudit('pdf', filters);
}
