import { apiFetch } from './api';

/* CloudHub POS — print planning client (KOT/print routing).
   The backend plans printJobs per order; the terminal executes them
   (browser popup today, QZ Tray / bridge tomorrow — same payloads). */

export type PrintStation = 'counter' | 'kitchen' | 'bar';
export type PrintTemplate = 'bill' | 'kot' | 'bar' | 'cancel';

export interface PrintJobLine {
  name: string;
  sku: string;
  qty: number;
}

export interface KotJobPayload {
  kotNumber: string;
  station: string;
  items: Array<PrintJobLine>;
  orderId: string;
  invoiceNumber: string;
  customerName: string;
  roomNumber: string;
  kitchenNotes: string;
  cashier: string;
  firedAt: string;
}

export interface PrintJob {
  jobId: string;
  template: PrintTemplate;
  station: string;
  printerId: string | null;
  printerName: string;
  copies: number;
  // Bill jobs carry { receipt }; KOT/bar jobs carry a KotJobPayload.
  payload: { receipt?: unknown } & Partial<KotJobPayload>;
}

export interface Printer {
  id: string;
  name: string;
  station: PrintStation;
  width: 58 | 80;
  transport: 'browser' | 'qz' | 'bridge' | 'cloud';
  address: string;
  enabled: boolean;
}

export interface PrintRouting {
  byCategoryId: Record<string, string>;
  byCategoryName: Record<string, string>;
  defaultStation: string;
}

export interface KotEntry {
  number: string;
  orderId: string;
  station: string;
  status: 'FIRED' | 'ACKED' | 'DONE';
  lines?: number;
  firedAt?: string;
  updated_at?: string;
  actor?: string;
}

export async function getPrinters(): Promise<Array<Printer>> {
  const res = await apiFetch<{ success: boolean; printers?: Array<Printer> }>('/settings/printers');
  return res.printers ?? [];
}

export async function savePrinters(printers: Array<Printer>): Promise<Array<Printer>> {
  const res = await apiFetch<{ success: boolean; message?: string; printers?: Array<Printer> }>(
    '/settings/printers',
    { method: 'PUT', body: { printers } },
  );
  return res.printers ?? printers;
}

export async function getPrintRouting(): Promise<PrintRouting | null> {
  try {
    const res = await apiFetch<{ success: boolean; routing?: PrintRouting }>('/settings/print-routing');
    return res.routing ?? null;
  } catch {
    return null;
  }
}

export async function savePrintRouting(routing: PrintRouting): Promise<PrintRouting | null> {
  const res = await apiFetch<{ success: boolean; message?: string; routing?: PrintRouting }>(
    '/settings/print-routing',
    { method: 'PUT', body: routing },
  );
  return res.routing ?? null;
}

export async function getKotLog(status?: string, limit?: number): Promise<Array<KotEntry>> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  const res = await apiFetch<{ success: boolean; data?: Array<KotEntry> }>(`/kot${suffix}`);
  return res.data ?? [];
}

export async function ackKot(number: string): Promise<KotEntry | null> {
  const res = await apiFetch<{ success: boolean; kot?: KotEntry }>(
    `/kot/${encodeURIComponent(number)}/ack`,
    { method: 'POST', body: {} },
  );
  return res.kot ?? null;
}

export async function doneKot(number: string): Promise<KotEntry | null> {
  const res = await apiFetch<{ success: boolean; kot?: KotEntry }>(
    `/kot/${encodeURIComponent(number)}/done`,
    { method: 'POST', body: {} },
  );
  return res.kot ?? null;
}

export interface ReprintResult {
  template: string;
  jobId: string;
  payload: Record<string, unknown>;
}

export async function fetchPrintJob(orderId: string | number, template: PrintTemplate): Promise<ReprintResult> {
  return apiFetch<ReprintResult>(
    `/orders/${encodeURIComponent(String(orderId))}/print?template=${template}`,
  );
}
