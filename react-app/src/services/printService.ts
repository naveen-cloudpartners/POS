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
  api: { setSha256Type: (hasher: (message: string) => Promise<string>) => void };
  security: {
    setCertificatePromise: (handler: (resolve: (certificate: string) => void, reject: (error: unknown) => void) => void) => void;
    setSignatureAlgorithm: (algorithm: string) => void;
    setSignaturePromise: (handler: (message: string) => (resolve: (signature: string) => void, reject: (error: unknown) => void) => void) => void;
  };
  websocket: { isActive: () => boolean; connect: () => Promise<void>; disconnect: () => Promise<void> };
  printers: { find: () => Promise<string[]> };
  configs: { create: (printer: string, options?: Record<string, unknown>) => unknown };
  print: (config: unknown, data: Array<Record<string, unknown>>) => Promise<void>;
};

declare global { interface Window { qz?: QzTray; } }

export type PrintDispatchResult = { ok: boolean; transport: 'qz' | 'browser'; error?: string };

/** Load on demand so an offline CDN or absent QZ Tray never breaks browser printing. */
let qzLoad: Promise<QzTray | null> | null = null;
let qzConnect: Promise<void> | null = null;
let signingSetup: Promise<void> | null = null;

export async function resetPrinterSession() {
  signingSetup = null;
  if (window.qz?.websocket.isActive()) await window.qz.websocket.disconnect().catch(() => undefined);
}

async function loadQzTray(): Promise<QzTray | null> {
  if (!qzLoad) qzLoad = loadQzScript().then((qz) => { if (!qz) qzLoad = null; return qz; });
  return qzLoad;
}

async function loadQzScript(): Promise<QzTray | null> {
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
    script.src = `${import.meta.env.BASE_URL}vendor/qz-tray/qz-tray.js`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
  return window.qz ?? null;
}

async function connectQz(qz: QzTray): Promise<void> {
  if (!signingSetup) {
    signingSetup = apiFetch<{ certificate: string }>('/printing/qz/certificate').then(({ certificate }) => {
      qz.security.setCertificatePromise((resolve) => resolve(certificate));
      if (certificate) {
        const requests = new Map<string, string>();
        // QZ passes a SHA-256 digest to its signature callback, not the JSON request.
        // Keep the original so the backend can validate the action before signing.
        qz.api.setSha256Type(async (message) => {
          const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message));
          const digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
          requests.set(digest, message);
          if (requests.size > 32) requests.delete(requests.keys().next().value!);
          return digest;
        });
        qz.security.setSignatureAlgorithm('SHA512');
        qz.security.setSignaturePromise((digest) => (resolve, reject) => {
          const message = requests.get(digest);
          if (!message) { reject(new Error('QZ signing request was not captured. Reload the page and retry.')); return; }
          apiFetch<{ signature: string }>('/printing/qz/sign', { method: 'POST', body: { message } })
            .then(({ signature }) => resolve(signature)).catch(reject);
        });
      }
    }).catch((error) => { signingSetup = null; throw error; });
  }
  await signingSetup;
  if (qz.websocket.isActive()) return;
  if (!qzConnect) qzConnect = qz.websocket.connect().finally(() => { qzConnect = null; });
  await qzConnect;
}

export async function discoverQzPrinters(): Promise<{ connected: boolean; printers: string[]; error?: string }> {
  const qz = await loadQzTray();
  if (!qz) return { connected: false, printers: [], error: 'QZ Tray was not detected on this terminal.' };
  try {
    await connectQz(qz);
    return { connected: true, printers: await qz.printers.find() };
  } catch (error) {
    return { connected: false, printers: [], error: error instanceof Error ? error.message : 'Could not connect to QZ Tray.' };
  }
}

export interface QzCertificateStatus { configured: boolean; uploadReady: boolean; subject: string; expires: string }
export const getQzCertificateStatus = () => apiFetch<QzCertificateStatus>('/settings/printers/qz-certificate');
export async function saveQzCertificateFiles(certificate: File, privateKey: File) {
  if (!certificate.size || !privateKey.size) throw new Error('One of the files is empty. Regenerate the QZ certificate files.');
  if (certificate.size > 32000 || privateKey.size > 32000) throw new Error('Each file must be 32 KB or smaller.');
  const result = await apiFetch<QzCertificateStatus>('/settings/printers/qz-certificate', {
    method: 'PUT', body: { certificate: await certificate.text(), privateKey: await privateKey.text() },
  });
  signingSetup = null;
  // The next discovery reconnects using the newly saved certificate.
  if (window.qz?.websocket.isActive()) await window.qz.websocket.disconnect().catch(() => undefined);
  return result;
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
    if (!qz) return { ok: false, transport: 'qz', error: 'Start QZ Tray on this terminal, then retry printing.' };
    if (!osPrinter) return { ok: false, transport: 'qz', error: 'Select a detected receipt printer in Admin Settings → Printers.' };
    if (qz && osPrinter !== '') {
      try {
        await connectQz(qz);
        const width = printer.width === 58 ? 58 : 80;
        const document = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12px;margin:0;padding:2mm;width:${width - 8}mm;box-sizing:border-box}table{table-layout:fixed}td{overflow-wrap:break-word}p{margin:8px 0}</style></head><body>${html}</body></html>`;
        await qz.print(qz.configs.create(osPrinter, { rasterize: true, copies: Math.max(1, Math.min(5, job.copies || 1)), jobName: job.jobId, margins: 0 }), [{ type: 'pixel', format: 'html', flavor: 'plain', data: document, options: { pageWidth: width / 25.4 } }]);
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

/** Always resolve the current company's saved printer, including after a login switch. */
export async function sendCompanyPrintJob(job: PrintJob, automatic = false): Promise<PrintDispatchResult> {
  try {
    const printers = await getPrinters();
    const printer = printers.find((p) => p.enabled && p.id === job.printerId)
      ?? printers.find((p) => p.enabled && p.station === job.station);
    if (!printer) return { ok: false, transport: 'qz', error: `No enabled ${job.station} printer is configured. Ask Admin to save a printer.` };
    if (automatic && printer.transport !== 'qz') return { ok: true, transport: 'browser' };
    return await sendPrintJob(job, printer);
  } catch (error) {
    return { ok: false, transport: 'qz', error: error instanceof Error ? error.message : 'Could not load the company printer.' };
  }
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
