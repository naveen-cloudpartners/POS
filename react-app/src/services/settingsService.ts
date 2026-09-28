import API_BASE, { apiFetch } from './api';
import type { SmtpStatus, StoreSettings, ZohoStatus } from '../types';

interface SettingsResponse {
  success: boolean;
  settings?: StoreSettings;
}

export async function getSettings(): Promise<StoreSettings> {
  const res = await apiFetch<SettingsResponse>('/config/settings');
  return res.settings ?? {};
}

export async function saveSettings(settings: StoreSettings): Promise<{ org_id?: string }> {
  const res = await apiFetch<{ success: boolean; message?: string; org_id?: string }>('/config/settings', {
    method: 'POST',
    body: { settings },
  });
  return { org_id: res.org_id };
}

export async function getSmtpStatus(): Promise<SmtpStatus> {
  const res = await apiFetch<{ success: boolean; configured?: boolean; smtp_host?: string; smtp_port?: string; smtp_user?: string; smtp_from?: string }>(
    '/config/smtp',
  );
  return {
    configured: res.configured ?? false,
    smtp_host: res.smtp_host ?? '',
    smtp_port: res.smtp_port ?? '587',
    smtp_user: res.smtp_user ?? '',
    smtp_from: res.smtp_from ?? '',
  };
}

export async function saveSmtp(input: {
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
}): Promise<void> {
  await apiFetch<{ success: boolean }>('/config/smtp', { method: 'POST', body: input });
}

export async function getZohoStatus(): Promise<ZohoStatus> {
  const res = await apiFetch<{
    success: boolean;
    catalyst_connection?: boolean;
    master_configured?: boolean;
    dc?: string;
    org_id?: string | null;
    connected?: boolean;
    connection?: unknown;
  }>('/auth/status');
  return {
    catalyst_connection: res.catalyst_connection ?? false,
    master_configured: res.master_configured ?? false,
    dc: res.dc,
    org_id: res.org_id,
    connected: res.connected ?? false,
    connection: res.connection,
  };
}

export async function disconnectZoho(): Promise<void> {
  await apiFetch<{ success: boolean }>('/auth/disconnect', { method: 'POST', body: {} });
}

/* ---------------- Structured settings (SET-01/02/04/05) ---------------- */

export interface CompanyProfile {
  company_name: string;
  legal_name: string;
  address1: string;
  address2: string;
  city: string;
  province: string;
  postal_code: string;
  country: string;
  phone: string;
  email: string;
  website: string;
  reg_number: string;
  tax_number: string;
  currency: string;
  logo_file_id: string;
  logo_name: string;
  logo_mime: string;
  logo_url: string;
}

export async function getCompanyProfile(): Promise<Partial<CompanyProfile>> {
  const res = await apiFetch<{ success: boolean; company?: Partial<CompanyProfile> }>('/settings/company');
  return res.company ?? {};
}

export async function saveCompanyProfile(input: Partial<CompanyProfile>): Promise<Partial<CompanyProfile>> {
  const res = await apiFetch<{ success: boolean; message?: string; company?: Partial<CompanyProfile> }>('/settings/company', {
    method: 'PUT',
    body: input,
  });
  return res.company ?? {};
}

export function companyLogoUrl(): string {
  return `${API_BASE}/settings/company/logo`;
}

export async function uploadCompanyLogo(input: { imageData: string; mimeType?: string }): Promise<{ success: boolean; message?: string; logo_url?: string }> {
  return apiFetch<{ success: boolean; message?: string; logo_url?: string }>('/settings/company/logo', {
    method: 'POST',
    body: input,
  });
}

export async function removeCompanyLogo(): Promise<void> {
  await apiFetch<{ success: boolean }>('/settings/company/logo', { method: 'DELETE' });
}

export interface TaxProfile {
  name: string;
  rate: number;
}

export interface TaxSettings {
  enabled: boolean;
  name: string;
  default_rate: number;
  mode: 'exclusive' | 'inclusive';
  round: boolean;
  profiles: Array<TaxProfile>;
}

export async function getTaxSettings(): Promise<TaxSettings | null> {
  try {
    const res = await apiFetch<{ success: boolean; tax?: TaxSettings }>('/settings/tax');
    return res.tax ?? null;
  } catch {
    return null;
  }
}

export async function saveTaxSettings(input: Partial<TaxSettings>): Promise<TaxSettings | null> {
  const res = await apiFetch<{ success: boolean; message?: string; tax?: TaxSettings }>('/settings/tax', {
    method: 'PUT',
    body: input,
  });
  return res.tax ?? null;
}

export interface NotificationTypeSetting {
  enabled: boolean;
  channels: Array<string>;
  threshold?: number | string;
  recipients?: string;
  frequency?: string;
}

export type NotificationPrefs = Record<string, NotificationTypeSetting | string> & {
  alert_email?: string;
};

export async function getNotificationSettings(): Promise<NotificationPrefs | null> {
  try {
    const res = await apiFetch<{ success: boolean; notifications?: NotificationPrefs }>('/settings/notifications');
    return res.notifications ?? null;
  } catch {
    return null;
  }
}

export async function saveNotificationSettings(input: NotificationPrefs): Promise<NotificationPrefs | null> {
  const res = await apiFetch<{ success: boolean; message?: string; notifications?: NotificationPrefs }>('/settings/notifications', {
    method: 'PUT',
    body: input,
  });
  return res.notifications ?? null;
}

export interface IntegrationHealth {
  books: {
    connected: boolean;
    org_id: string;
    dc: string;
    token_expires_at: string;
    last_sync_at: string;
    last_sync_result: string;
  };
  // Older deployments and Books-only health responses omit SMTP entirely.
  smtp?: { configured: boolean };
}

export async function getIntegrationHealth(): Promise<IntegrationHealth | null> {
  try {
    const res = await apiFetch<{ success: boolean; integrations?: IntegrationHealth }>('/settings/integrations');
    return res.integrations ?? null;
  } catch {
    return null;
  }
}

export interface PaymentMethod {
  mode: string;
  enabled: boolean;
}

export async function getPaymentMethods(): Promise<Array<PaymentMethod>> {
  try {
    const res = await apiFetch<{ success: boolean; methods?: Array<PaymentMethod> }>('/settings/payments');
    return res.methods ?? [
      { mode: 'Cash', enabled: true },
      { mode: 'Card', enabled: true },
      { mode: 'Bank', enabled: true },
    ];
  } catch {
    return [
      { mode: 'Cash', enabled: true },
      { mode: 'Card', enabled: true },
      { mode: 'Bank', enabled: true },
    ];
  }
}

export async function savePaymentMethods(methods: Array<PaymentMethod>): Promise<Array<PaymentMethod>> {
  const res = await apiFetch<{ success: boolean; message?: string; methods?: Array<PaymentMethod> }>('/settings/payments', {
    method: 'PUT',
    body: { methods },
  });
  return res.methods ?? methods;
}

export interface DigestResult {
  success: boolean;
  sent?: boolean;
  message?: string;
  count?: number;
  to?: Array<string>;
}

export async function sendLowStockDigest(): Promise<DigestResult> {
  return apiFetch<DigestResult>('/settings/notifications/digest', { method: 'POST', body: {} });
}
