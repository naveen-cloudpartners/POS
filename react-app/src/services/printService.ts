import { apiFetch } from './api';
import type { PosReceipt } from './orderService';
import { billHtml, cancelHtml, kotHtml, openPrintWindow, type CancelChitPayload } from '../utils/print';

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
  payload: {
    receipt?: unknown;
    cancelRef?: string;
    orderId?: string;
    reason?: string;
    actor?: string;
    at?: string;
    groups?: Array<{ station: string; items: Array<PrintJobLine> }>;
  } & Partial<KotJobPayload>;
}

export interface Printer {
  id: string;
  name: string;
  station: PrintStation;
  width: 58 | 80;
  transport: 'browser' | 'qz' | 'bridge' | 'cloud';
  address: string;
  enabled: boolean;
  /** Exact Windows printer name selected through QZ Tray on this terminal. */
  osPrinter?: string;
  /** Extra Configurations JSON fields survive the API's printer normalization. */
  [key: string]: unknown;
}

type QzTray = {
  websocket: { isActive: () => boolean; connect: () => Promise<void> };
  printers: { find: () => Promise<string[]> };
  configs: { create: (printer: string, options?: Record<string, unknown>) => unknown };
  print: (config: unknown, data: Array<Record<string, unknown>>) => Promise<void>;
};

declare global { interface Window { qz?: QzTray; } }

export type PrintDispatchResult = { ok: boolean; transport: 'qz' | 'browser'; error?: string };

/** Load on demand so an offline CDN or absent QZ Tray never breaks browser printing. */
async function loadQzTray(): Promise<QzTray | null> {
  if (window.qz) return window.qz;
  const id = 'cloudhub-qz-tray-client';
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  await new Promise<void>((resolve) => {
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => resolve(), { once: true });
      window.setTimeout(resolve, 3000);
      return;
    }
    const script = document.createElement('script');
    script.id = id;
    script.src = 'https://cdn.jsdelivr.net/npm/qz-tray@2.2.4/qz-tray.js';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  return window.qz ?? null;
}

export async function discoverQzPrinters(): Promise<{ connected: boolean; printers: string[]; error?: string }> {
  const qz = await loadQzTray();
  if (!qz) return { connected: false, printers: [], error: 'QZ Tray was not detected on this terminal.' };
  try {
    if (!qz.websocket.isActive()) await qz.websocket.connect();
    return { connected: true, printers: await qz.printers.find() };
  } catch (error) {
    return { connected: false, printers: [], error: error instanceof Error ? error.message : 'Could not connect to QZ Tray.' };
  }
}

function printHtmlForJob(job: PrintJob): string | null {
  if (job.template === 'bill' && job.payload.receipt) return billHtml(job.payload.receipt as PosReceipt);
  if ((job.template === 'kot' || job.template === 'bar') && job.payload.kotNumber) return kotHtml(job.payload as KotJobPayload);
  if (job.template === 'cancel' && job.payload.cancelRef) return cancelHtml(job.payload as unknown as CancelChitPayload);
  if ((job.template === 'kot' || job.template === 'bar') && job.payload.groups) {
    return job.payload.groups.map((group) => kotHtml({
      kotNumber: `${job.payload.orderId || job.jobId} · ${group.station}`,
      station: group.station, items: group.items, orderId: String(job.payload.orderId || ''), invoiceNumber: '',
      customerName: '', roomNumber: '', kitchenNotes: '', cashier: '', firedAt: '',
    })).join('<hr/>');
  }
  return null;
}

/** One terminal dispatch path for Settings tests, POS, and Orders reprints. */
export async function sendPrintJob(job: PrintJob, printer: Printer | null): Promise<PrintDispatchResult> {
  const html = printHtmlForJob(job);
  if (html === null) return { ok: false, transport: 'browser', error: 'This print job has no printable content.' };
  if (printer?.transport === 'qz') {
    const qz = await loadQzTray();
    const osPrinter = String(printer.osPrinter || '').trim();
    if (qz && osPrinter !== '') {
      try {
        if (!qz.websocket.isActive()) await qz.websocket.connect();
        await qz.print(qz.configs.create(osPrinter, { rasterize: true }), [{ type: 'html', format: 'plain', data: html }]);
        return { ok: true, transport: 'qz' };
      } catch (error) {
        return { ok: false, transport: 'qz', error: error instanceof Error ? error.message : 'QZ Tray print failed.' };
      }
    }
  }
  const ok = openPrintWindow(job.jobId, html);
  return ok ? { ok: true, transport: 'browser' } : { ok: false, transport: 'browser', error: 'Popup blocked — allow popups to print.' };
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

export async function getKotLog(status?: string, limit?: number, station?: string): Promise<Array<KotEntry>> {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  if (station && station !== 'all') params.set('station', station);
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
