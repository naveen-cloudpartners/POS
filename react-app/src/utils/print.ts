/* CloudHub POS — browser-print dispatcher (tier 1 of KOT execution).
   Renders a print job payload to a minimal 80mm-friendly document in a
   popup window and calls print(). QZ Tray / bridge agents consume the
   same payloads later — templates stay server-shaped, transport-agnostic. */

import type { KotJobPayload } from '../services/printService';
import type { PosReceipt } from '../services/orderService';
import { currency } from './format';

export function escPrint(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Open a print popup; returns false when the popup was blocked. */
export function openPrintWindow(title: string, bodyHtml: string): boolean {
  const w = window.open('', '_blank', 'width=480,height=640');
  if (w === null) return false;
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escPrint(title)}</title></head>` +
      `<body style="font-family:Arial,sans-serif;max-width:380px;margin:0 auto;padding:16px;">${bodyHtml}</body></html>`,
  );
  w.document.close();
  w.focus();
  w.print();
  return true;
}

export function billHtml(receipt: PosReceipt): string {
  const money = (n: number): string => currency(n);
  const rows = receipt.lines
    .map(
      (l) =>
        `<tr><td>${escPrint(l.name)}<br/><small>${l.quantity} × ${money(l.rate)}${l.discount > 0 ? ` (−${money(l.discount)})` : ''}</small></td><td align="right">${money(l.lineTotal)}</td></tr>`,
    )
    .join('');
  const pays = receipt.payments.map((p) => `<div>${escPrint(p.mode)}: ${money(p.amount)}</div>`).join('');
  return (
    `<h1 style="font-size:18px;margin:0 0 2px;">${escPrint(receipt.store.store_name || 'CloudHub POS')}</h1>` +
    `<p>Invoice: ${escPrint(receipt.invoiceNumber || receipt.orderId)}<br/>Date: ${escPrint(receipt.date)}<br/>Customer: ${escPrint(receipt.customerName)}</p>` +
    `<table style="width:100%;border-collapse:collapse;font-size:13px;">${rows}</table>` +
    `<p>Subtotal: ${money(receipt.subtotal)}<br/>Tax: ${money(receipt.tax)}<br/>Discount: −${money(receipt.discount)}<br/><strong>Total: ${money(receipt.total)}</strong></p>` +
    `<p>${pays}</p>`
  );
}

export function kotHtml(job: KotJobPayload): string {
  const rows = job.items
    .map((l) => `<tr><td><strong>${l.qty} × ${escPrint(l.name)}</strong>${l.sku ? `<br/><small>${escPrint(l.sku)}</small>` : ''}</td></tr>`)
    .join('');
  return (
    `<h1 style="font-size:22px;margin:0;">KOT ${escPrint(job.kotNumber)}</h1>` +
    `<p style="font-size:15px;"><strong>${escPrint(job.customerName)}</strong>` +
    `${job.roomNumber ? ` · Table/Room ${escPrint(job.roomNumber)}` : ''}<br/>` +
    `<small>Order ${escPrint(job.invoiceNumber || job.orderId)} · ${escPrint(job.firedAt)} · ${escPrint(job.cashier)}</small></p>` +
    (job.kitchenNotes ? `<p><strong>Note:</strong> ${escPrint(job.kitchenNotes)}</p>` : '') +
    `<table style="width:100%;border-collapse:collapse;font-size:15px;">${rows}</table>`
  );
}

export interface CancelChitPayload {
  cancelRef: string;
  orderId: string;
  reason: string;
  actor: string;
  at: string;
  groups: Array<{ station: string; items: Array<{ name: string; sku: string; qty: number }> }>;
}

export function cancelHtml(chit: CancelChitPayload): string {
  const groups = chit.groups
    .map(
      (g) =>
        `<h3 style="margin:12px 0 4px;">${escPrint(g.station.toUpperCase())}</h3>` +
        g.items.map((l) => `<div>− ${l.qty} × ${escPrint(l.name)}</div>`).join(''),
    )
    .join('');
  return (
    `<h1 style="font-size:22px;margin:0;">CANCELLED ${escPrint(chit.cancelRef)}</h1>` +
    `<p>Order ${escPrint(chit.orderId)} · ${escPrint(chit.at)}<br/>` +
    `<small>Reason: ${escPrint(chit.reason)}${chit.actor ? ` · by ${escPrint(chit.actor)}` : ''}</small></p>` +
    groups
  );
}
