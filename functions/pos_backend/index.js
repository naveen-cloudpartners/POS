// dotenv is a LOCAL-DEV convenience only: Catalyst injects environment
// variables directly at runtime, so a missing module must never crash boot
// (a top-level require here took down the whole function, hanging /health).
try {
  require('dotenv').config();
} catch {
  // Running on Catalyst (or any env without dotenv installed) — the
  // platform-provided environment is used as-is.
}

if (!process.env.ZOHO_CLIENT_ID)
  throw new Error('ZOHO_CLIENT_ID missing');
if (!process.env.ZOHO_CLIENT_SECRET)
  throw new Error('ZOHO_CLIENT_SECRET missing');

// Local env check — booleans only, never prints secret values.
console.log('[ENV] ZOHO_CLIENT_ID:', !!process.env.ZOHO_CLIENT_ID);
console.log('[ENV] ZOHO_CLIENT_SECRET:', !!process.env.ZOHO_CLIENT_SECRET);
// Build stamp: proves exactly what shipped (cold-start line in logs).
console.log('[BUILD] pos_backend 2026-09-29 (stratus, KOT, LIMIT300, company-reader, tax-read, invite-mail1, roster-merge, printers-qz, transfer-create, smtp-kept)');

const express = require('express');
const axios = require('axios');
const catalyst = require('zcatalyst-sdk-node');
const ZohoBooksService = require('./zohoBooksService');
const nodemailer = require('nodemailer');
const zlib = require('zlib'); // core module: PNG inflate for PDF logo embedding

const app = express();
// 12mb body cap: base64 inflates binaries ~33%, so a 5 MB company logo
// arrives as ~6.8 MB JSON; product images (1.5 MB) and CSV batches also
// exceed the 100kb Express default. All other payloads are tiny JSON.
app.use(express.json({ limit: '12mb' }));

/* ==========================================================================
   SAAS MASTER DEVELOPER CREDENTIALS
   All values MUST be set via Catalyst Environment Variables.
   Never hardcode secrets in source code.
   ========================================================================== */
const SAAS_MASTER_CREDENTIALS = {
  client_id: process.env.ZOHO_CLIENT_ID || '',
  client_secret: process.env.ZOHO_CLIENT_SECRET || '',
  dc: process.env.ZOHO_DC || 'com'
};

/**
 * Ensures the SaaS master developer credentials are present in the Configurations
 * datastore. This runs transparently so merchants never need to enter a Client ID
 * or Secret — they simply authorize their own Zoho Books account via OAuth.
 * Returns { client_id, client_secret, dc } resolved from the store.
 */
async function ensureMasterCredentials(booksService) {
  let clientId = await booksService.getConfig('zoho_client_id');
  let clientSecret = await booksService.getConfig('zoho_client_secret');
  let dc = await booksService.getConfig('zoho_dc');

  if (!clientId && SAAS_MASTER_CREDENTIALS.client_id) {
    console.log('Master credentials missing — seeding from environment variables.');
    await booksService.saveConfig('zoho_client_id', SAAS_MASTER_CREDENTIALS.client_id);
    await booksService.saveConfig('zoho_client_secret', SAAS_MASTER_CREDENTIALS.client_secret);
    if (!dc) await booksService.saveConfig('zoho_dc', SAAS_MASTER_CREDENTIALS.dc);
    clientId = SAAS_MASTER_CREDENTIALS.client_id;
    clientSecret = SAAS_MASTER_CREDENTIALS.client_secret;
    dc = dc || SAAS_MASTER_CREDENTIALS.dc;
  } else if (!clientId) {
    console.warn('ZOHO_CLIENT_ID environment variable is not set. OAuth flows will fail until configured.');
  }


  // Auto-seed SMTP config for OTP email delivery only if environment variables are present
  const smtpHost = await booksService.getConfig('email_smtp_host');
  if (!smtpHost && process.env.SMTP_HOST) {
    console.log('SMTP config missing — seeding from environment variables.');
    await booksService.saveConfig('email_smtp_host', process.env.SMTP_HOST);
    await booksService.saveConfig('email_smtp_port', process.env.SMTP_PORT || '465');
    await booksService.saveConfig('email_smtp_user', process.env.SMTP_USER || '');
    await booksService.saveConfig('email_smtp_pass', process.env.SMTP_PASS || '');
    await booksService.saveConfig('email_smtp_from', process.env.SMTP_FROM || '');
  }

  return { client_id: clientId, client_secret: clientSecret, dc: dc || SAAS_MASTER_CREDENTIALS.dc };
}

/**
 * Builds the OAuth redirect URI without default ports (:443 for HTTPS, :80 for HTTP)
 * so it matches what's registered in the Zoho API Console.
 */
function buildRedirectUri(req) {
  let host = req.get('host') || '';
  host = host.replace(/:443$/, '').replace(/:80$/, '');
  // Always force HTTPS — behind Catalyst proxy, req.protocol may be 'http'
  return `https://${host}/server/pos_backend/api/auth/callback`;
}

/**
 * Safely execute a ZCQL query. Returns the result array or an empty array
 * if the table doesn't exist (first-time deployment).
 */
async function safeZcql(catalystApp, query) {
  try {
    return await catalystApp.zcql().executeZCQLQuery(query);
  } catch (err) {
    if (err.message && err.message.includes('No Such Table')) {
      console.warn('Table not found in Datastore. Please create tables via Catalyst CLI or Console.');
      return [];
    }
    throw err;
  }
}

/**
 * Safely insert/update a Datastore row. Returns true/false.
 * Does NOT rely on ZCQL SELECT succeeding — falls back to direct insert.
 */
async function safeUpsertConfig(catalystApp, key, value) {
  const payload = { config_key: key, config_value: value };
  try {
    const existing = await safeZcql(catalystApp, `SELECT ROWID FROM Configurations WHERE config_key = '${key}'`);
    if (existing && existing.length > 0) {
      const table = catalystApp.datastore().table('Configurations');
      await table.updateRow({ ROWID: existing[0].Configurations.ROWID, ...payload });
      return true;
    }
  } catch (err) {
    console.warn(`safeUpsertConfig: ZCQL fallback (${err.message}), trying direct insert`);
  }
  try {
    const table = catalystApp.datastore().table('Configurations');
    await table.insertRow(payload);
    return true;
  } catch (err) {
    console.error(`safeUpsertConfig: insertRow failed for '${key}':`, err.message);
    throw err;
  }
}

// Enable CORS — restrict to Catalyst domain in production.
// CATALYST_APP_DOMAIN should be set e.g. "https://your-app.catalyst.zoho.com"
const ALLOWED_ORIGIN = process.env.CATALYST_APP_DOMAIN || '*';
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN === '*') {
    res.header('Access-Control-Allow-Origin', '*');
  } else if (origin && (origin === ALLOWED_ORIGIN || origin.endsWith('.catalyst.zoho.com'))) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Vary', 'Origin');
  }
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, x-zoho-refresh-token, x-zoho-org-id, x-zoho-dc');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// USR-05: actor-based audit trail. Registered early so every mutating API
// call below passes through it; the handler itself is a hoisted function
// defined alongside the admin block. Fail-open by design — logging never
// blocks the request it observes.
app.use(auditMiddleware);
app.use(enforceApiPermissions);

/**
 * Sanitize a value before interpolating into a ZCQL string.
 * Escapes single quotes and removes characters that could break the query.
 * Always use parameterized queries if the Catalyst SDK supports them;
 * this is a defense-in-depth safeguard for string interpolation.
 */
function sanitizeZcql(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/'/g, "''").replace(/[\x00-\x1f\x7f]/g, '');
}

/**
 * Format a JS Date as a Catalyst Datastore datetime literal: "YYYY-MM-DD HH:mm:ss" (UTC).
 * The SDK sends insertRow payloads as plain JSON with no date conversion, so a
 * Date object arrives as an ISO-8601 string ("...T...Z") which the Datastore
 * server rejects with "datetime value expected". This is the format it accepts.
 */
function formatCatalystDateTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

/**
 * STOCK MOVEMENT LEDGER (Phase 1 — Core Business Data)
 * --------------------------------------------------------------------------
 * Single write path for every stock-changing event. The stock-adjust
 * endpoint below logs through here; future callers (POS checkout, returns,
 * purchases, warehouse transfers, recounts) must reuse this helper —
 * never update Products.stock without a movement record.
 *
 * movement_type: SALE | ADJUSTMENT | RETURN | PURCHASE | OPENING
 *                | TRANSFER_IN | TRANSFER_OUT
 * reference_type: MANUAL | POS_ORDER | RETURN | PURCHASE | TRANSFER | OPENING
 *                (free-form strings accepted for future callers)
 *
 * Returns the inserted ROWID, or null when the StockMovements table does
 * not exist yet. Fail-open by design: adjustments keep working on
 * deployments created before the table was provisioned, and the miss is
 * logged loudly plus surfaced as `movement_logged: false` so the gap is
 * visible instead of silent.
 */
async function logStockMovement(catalystApp, {
  itemRowid, sku, itemName, movementType,
  quantityChange, stockBefore, stockAfter,
  referenceType, referenceId, reason, performedBy,
  warehouseId, fromWarehouseId, toWarehouseId,
}) {
  const base = {
    item_rowid: String(itemRowid ?? ''),
    sku: String(sku ?? ''),
    item_name: String(itemName ?? ''),
    movement_type: String(movementType || 'ADJUSTMENT'),
    quantity_change: Number(quantityChange) || 0,
    stock_before: Number(stockBefore) || 0,
    stock_after: Number(stockAfter) || 0,
    reference_type: String(referenceType || 'MANUAL'),
    reference_id: referenceId === undefined || referenceId === null ? '' : String(referenceId),
    reason: String(reason ?? ''),
    performed_by: String(performedBy ?? ''),
  };
  // Phase 2: warehouse audit columns. New deployments provision them;
  // older deployments reject unknown columns — fall back to legacy shape.
  const extended = { ...base };
  if (warehouseId !== undefined && warehouseId !== null && String(warehouseId) !== '') {
    extended.warehouse_id = String(warehouseId);
  }
  if (fromWarehouseId !== undefined && fromWarehouseId !== null && String(fromWarehouseId) !== '') {
    extended.from_warehouse_id = String(fromWarehouseId);
  }
  if (toWarehouseId !== undefined && toWarehouseId !== null && String(toWarehouseId) !== '') {
    extended.to_warehouse_id = String(toWarehouseId);
  }
  const hasWarehouseCols = extended.warehouse_id !== undefined
    || extended.from_warehouse_id !== undefined
    || extended.to_warehouse_id !== undefined;
  try {
    const table = catalystApp.datastore().table('StockMovements');
    const payload = hasWarehouseCols ? extended : base;
    const row = await table.insertRow(payload);
    return (row && row.ROWID) || null;
  } catch (err) {
    if (hasWarehouseCols) {
      try {
        const table = catalystApp.datastore().table('StockMovements');
        const row = await table.insertRow(base);
        console.warn('[STOCK-LEDGER] Warehouse columns missing — logged legacy movement. Add warehouse_id/from_warehouse_id/to_warehouse_id to StockMovements.');
        return (row && row.ROWID) || null;
      } catch (retryErr) {
        console.error(`[STOCK-LEDGER] Movement insert failed (provision table 'StockMovements' via Catalyst Console):`, retryErr.message);
        return null;
      }
    }
    console.error(`[STOCK-LEDGER] Movement insert failed (provision table 'StockMovements' via Catalyst Console):`, err.message);
    return null;
  }
}

/**
 * Generic SMTP sender reusing the OTP system's configuration
 * (env vars first, Configurations-table fallback). Returns true on success.
 * Never throws — callers decide whether email failure matters.
 */
async function sendSmtpMail(catalystApp, { to, subject, html, text }) {
  try {
    const booksService = new ZohoBooksService(catalystApp, null);
    let smtpHost = process.env.SMTP_HOST;
    let smtpPort = process.env.SMTP_PORT;
    let smtpUser = process.env.SMTP_USER;
    let smtpPass = process.env.SMTP_PASS;
    let smtpFrom = process.env.SMTP_FROM || smtpUser;
    if (!smtpHost) {
      try {
        smtpHost = await booksService.getConfig('email_smtp_host');
        smtpPort = await booksService.getConfig('email_smtp_port');
        smtpUser = await booksService.getConfig('email_smtp_user');
        smtpPass = await booksService.getConfig('email_smtp_pass');
        smtpFrom = await booksService.getConfig('email_smtp_from') || smtpUser;
      } catch (e) { /* Configurations table may not exist yet */ }
    }
    if (!(smtpHost && smtpUser && smtpPass)) {
      console.error('[MAIL] SMTP configuration incomplete:', { host: !!smtpHost, user: !!smtpUser, password: !!smtpPass });
      return false;
    }
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: parseInt(smtpPort, 10) || 587,
      secure: parseInt(smtpPort, 10) === 465,
      auth: { user: smtpUser, pass: smtpPass }
    });
    await transporter.sendMail({ from: smtpFrom, to, subject, html, text });
    return true;
  } catch (err) {
    console.error('[MAIL] Send failed:', err.message);
    return false;
  }
}

/**
 * Invitation email for team members (USR-01 mail gap).
 * Catalyst's registerUser API only creates the user record — it never sends
 * a password email (the platform emails only console-issued invites). So we
 * send our own welcome mail via the store SMTP: the member's role, a sign-in
 * link to the hosted login page, and first-time password instructions
 * ("Forgot password" on that page emails them a reset link, which acts as
 * the set-password mail). Best-effort: returns true/false, never throws,
 * never blocks the caller. False also means SMTP is not configured yet.
 */
async function sendInviteEmail(catalystApp, req, { to, name, role, orgName, invitedBy, isReminder }) {
  try {
    const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const addressee = esc(String(name || '').trim() || String(to).split('@')[0]);
    const store = esc(orgName || 'CloudHub POS');
    const roleText = esc(role || 'Cashier');
    const inviter = esc(invitedBy || '');
    const loginUrl = `${getPublicBaseUrl(req)}/__catalyst/auth/login`;
    const subject = isReminder
      ? `Reminder: join ${store} on CloudHub POS`
      : `You're invited to join ${store} on CloudHub POS`;
    const text =
      `${isReminder ? 'Reminder' : 'Hello'} ${addressee}\n\n` +
      `${inviter !== '' ? `${inviter} invited` : 'You were invited'} you to join ${store} on CloudHub POS with the role: ${roleText}.\n\n` +
      `Sign in here:\n${loginUrl}\n\n` +
      `First time signing in? Open the sign-in page above and click "Forgot password" — you will get an email link to set your password.\n\n` +
      `If you did not expect this invitation, you can ignore this email.`;
    const html =
      `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f1b33">` +
      `<h2 style="margin:0 0 12px">You're invited to join ${store}</h2>` +
      `<p style="margin:0 0 8px">Hello ${addressee},</p>` +
      `<p style="margin:0 0 8px">${inviter !== '' ? `${inviter} invited` : 'You were invited'} you to join <b>${store}</b> on CloudHub POS with the role: <b>${roleText}</b>.</p>` +
      `<p style="margin:16px 0"><a href="${loginUrl}" style="display:inline-block;background:#3a76f8;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:10px">Sign in to CloudHub POS</a></p>` +
      `<p style="margin:0 0 8px;font-size:13px;color:#5b6b87">First time signing in? Open the sign-in page and click <b>"Forgot password"</b> — you will get an email link to set your password.</p>` +
      `<p style="margin:16px 0 0;font-size:12px;color:#8b98b3">If you did not expect this invitation, you can ignore this email.</p>` +
      `</div>`;
    return await sendSmtpMail(catalystApp, { to, subject, html, text });
  } catch (e) { console.warn('[MAIL] Invite email skipped:', e.message); return false; }
}

/**
 * Public base URL of this deployment behind the Catalyst proxy
 * (same host logic as buildRedirectUri, without the callback path).
 */
function getPublicBaseUrl(req) {
  let host = req.get('host') || '';
  host = host.replace(/:443$/, '').replace(/:80$/, '');
  return `https://${host}`;
}

/* ==========================================================================
   POS CHECKOUT HELPERS (POS-05/08/10/11) — canonical sale math + catalog
   resolution shared by checkout, receipt rebuilds and voids.
   --------------------------------------------------------------------------
   Canonical totals (frontend mirrors these EXACTLY — same ops, same order):
     lineGross = round2(qty × rate)
     lineDisc  = flat ? min(discVal, lineGross)
                      : lineGross × clamp(discVal,0,100)/100, rounded
     lineNet   = lineGross − lineDisc
     lineTax   = round2(lineNet × taxPct/100)
     subtotal  = Σ lineNet · taxAmount = Σ lineTax
     orderDisc = round2((subtotal + taxAmount) × clamp(orderPct,0,100)/100)
     total     = round2(subtotal + taxAmount − orderDisc)
   ========================================================================== */

function posRound2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function posClampPct(value) {
  const n = Number(value) || 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Normalize one checkout line + its discount. Never throws.
 * taxOpts: { mode: 'exclusive' (default) | 'inclusive', round: true }.
 * Exclusive (legacy): tax is added on top — totals are byte-identical to
 * the pre-mode implementation. Inclusive: the rate already contains tax,
 * so the tax portion is extracted (subtotal goes ex-tax, total unchanged).
 * round=false keeps full precision per line; only the final total rounds.
 */
function posNormalizeLine(raw, taxOpts) {
  const mode = taxOpts && taxOpts.mode === 'inclusive' ? 'inclusive' : 'exclusive';
  const round = !taxOpts || taxOpts.round !== false;
  const r2 = (n) => (round ? posRound2(n) : (Number(n) || 0));
  const qty = Math.max(0, Number(raw.quantity) || 0);
  const rate = Math.max(0, Number(raw.rate) || 0);
  const taxPct = posClampPct(raw.tax_percentage);
  const discType = raw.discount_type === 'flat' ? 'flat' : 'percent';
  const discVal = Math.max(0, Number(raw.discount_value) || 0);
  const lineGross = r2(qty * rate);
  const lineDisc = discType === 'flat'
    ? Math.min(discVal, lineGross)
    : r2((lineGross * Math.min(discVal, 100)) / 100);
  const inclusiveNet = r2(lineGross - lineDisc);
  let lineNet = inclusiveNet;
  let lineTax = 0;
  if (mode === 'inclusive') {
    // Rate (and therefore the discounted net) already includes tax.
    lineTax = r2(inclusiveNet - inclusiveNet / (1 + taxPct / 100));
    lineNet = r2(inclusiveNet - lineTax);
  } else {
    lineTax = r2((inclusiveNet * taxPct) / 100);
  }
  return {
    qty, rate, taxPct, discType, taxMode: mode,
    discVal: discType === 'flat' ? r2(discVal) : Math.min(discVal, 100),
    lineGross, lineDisc, lineNet, lineTax,
    name: String(raw.name ?? ''),
    sku: String(raw.sku ?? ''),
    books_item_id: String(raw.books_item_id ?? ''),
    item_id: String(raw.item_id ?? ''),
  };
}

/**
 * Canonical order totals from normalized lines + order discount %.
 * round=false keeps full precision until the final total (mirrors
 * utils/tax calcTotals on the frontend — the two must stay identical
 * so tender validation never mismatches).
 */
function posTotalsFor(normLines, orderPct, taxOpts) {
  const round = !taxOpts || taxOpts.round !== false;
  const r2 = (n) => (round ? posRound2(n) : (Number(n) || 0));
  const subtotal = r2(normLines.reduce((s, l) => s + l.lineNet, 0));
  const taxAmount = r2(normLines.reduce((s, l) => s + l.lineTax, 0));
  const orderDisc = r2(((subtotal + taxAmount) * posClampPct(orderPct)) / 100);
  const total = round ? posRound2(subtotal + taxAmount - orderDisc) : subtotal + taxAmount - orderDisc;
  return { subtotal, taxAmount, orderDisc, total };
}

const POS_PAY_MODES = ['Cash', 'Card', 'Bank'];

/**
 * Resolve a checkout/void line to its live Products row.
 * Match order (most reliable first): books_item_id → ROWID → sku.
 * Returns the product row or null. Never throws.
 */
async function resolveProductForSale(catalystApp, line) {
  try {
    const booksKey = sanitizeZcql(line.books_item_id || '');
    if (booksKey !== '') {
      const hit = await safeZcql(catalystApp,
        `SELECT ROWID, sku, name, stock, status, reorder_level FROM Products WHERE books_item_id = '${booksKey}'`);
      if (hit && hit[0]) return hit[0].Products;
    }
    const ref = String(line.item_id ?? '').trim();
    if (/^[0-9]+$/.test(ref)) {
      const hit = await safeZcql(catalystApp,
        `SELECT ROWID, sku, name, stock, status, reorder_level FROM Products WHERE ROWID = ${ref}`);
      if (hit && hit[0]) return hit[0].Products;
    }
    const skuKey = sanitizeZcql(line.item_id || line.sku || '');
    if (skuKey !== '') {
      const hit = await safeZcql(catalystApp,
        `SELECT ROWID, sku, name, stock, status, reorder_level FROM Products WHERE sku = '${skuKey}'`);
      if (hit && hit[0]) return hit[0].Products;
    }
  } catch (e) { /* resolution failure reads as "not found" below */ }
  return null;
}

/** Best-effort store profile for receipts (org settings → legacy → blanks). */
async function getStoreProfile(catalystApp, orgId) {
  const profile = {
    store_name: '', company: '', currency: 'LKR',
    address: '', phone: '', email: '', website: '',
  };
  try {
    const rows = await safeZcql(catalystApp,
      `SELECT config_key, config_value FROM Configurations WHERE config_key LIKE 'org_${sanitizeZcql(orgId)}_setting_%'`);
    for (const row of rows || []) {
      const full = String(row.Configurations.config_key);
      const key = full.replace(`org_${orgId}_setting_`, '');
      if (key === 'store_name' || key === 'company' || key === 'currency') {
        profile[key] = String(row.Configurations.config_value ?? '');
      }
      // SET-01: company profile mirrors for receipt/PDF branding.
      if (key === 'company_name' && profile.store_name === '') profile.store_name = String(row.Configurations.config_value ?? '');
      if (key === 'company_legal_name' && profile.company === '') profile.company = String(row.Configurations.config_value ?? '');
      if (key === 'company_address1' || key === 'company_address2' || key === 'company_city' || key === 'company_province' || key === 'company_postal_code' || key === 'company_country') {
        const bit = String(row.Configurations.config_value ?? '').trim();
        if (bit !== '') profile.address = profile.address === '' ? bit : `${profile.address}, ${bit}`;
      }
      if (key === 'company_phone' && profile.phone === '') profile.phone = String(row.Configurations.config_value ?? '');
      if (key === 'company_email' && profile.email === '') profile.email = String(row.Configurations.config_value ?? '');
      if (key === 'company_website' && profile.website === '') profile.website = String(row.Configurations.config_value ?? '');
    }
    if (!profile.store_name && !profile.company) {
      const legacy = await safeZcql(catalystApp,
        `SELECT config_key, config_value FROM Configurations WHERE config_key LIKE 'pos_setting_%'`);
      for (const row of legacy || []) {
        const key = String(row.Configurations.config_key).replace('pos_setting_', '');
        if (key === 'store_name' || key === 'company' || key === 'currency') {
          profile[key] = String(row.Configurations.config_value ?? '');
        }
      }
    }
  } catch (e) { /* receipts still render with blanks */ }
  if (!profile.currency) profile.currency = 'LKR';
  return profile;
}

/**
 * Rebuild a printable receipt for an order (POS-09).
 * Order-level discount is derived (total is stored): orderDisc = sub+tax−total.
 * Payments prefer the Payments ledger, falling back to the order row.
 */
async function buildReceiptData(catalystApp, orgId, orderId) {
  const orderRows = await safeZcql(catalystApp,
    `SELECT ROWID, customer_name, customer_email, subtotal, tax_amount, total, payment_mode, status, books_invoice_id, invoice_number, CREATEDTIME FROM Orders WHERE ROWID = ${orderId}`);
  if (!orderRows || orderRows.length === 0) return null;
  const order = orderRows[0].Orders;
  const lineRows = await safeZcql(catalystApp,
    `SELECT ROWID, order_id, item_id, quantity, rate, discount_value, discount_type FROM OrderItems WHERE order_id = ${orderId}`);
  const prodRows = await safeZcql(catalystApp,
    `SELECT sku, name, books_item_id FROM Products LIMIT 300`);
  const nameByBooksId = new Map();
  const nameBySku = new Map();
  for (const r of prodRows || []) {
    const p = r.Products;
    if (!p) continue;
    if (p.books_item_id) nameByBooksId.set(String(p.books_item_id), String(p.name ?? ''));
    if (p.sku) nameBySku.set(String(p.sku), String(p.name ?? ''));
  }
  const lines = (lineRows || []).map((r) => {
    const l = r.OrderItems;
    const qty = Number(l.quantity) || 0;
    const rate = Number(l.rate) || 0;
    const name = nameByBooksId.get(String(l.item_id ?? '')) || nameBySku.get(String(l.item_id ?? '')) || String(l.item_id ?? 'Item');
    return { name, quantity: qty, rate, discount: Number(l.discount_value) || 0, discountType: l.discount_type === 'flat' ? 'flat' : 'percent', lineTotal: posRound2(qty * rate) };
  });
  const subtotal = posRound2(lines.reduce((s, l) => s + l.lineTotal, 0));
  // NOTE: stored line totals predate per-line tax breakdowns; tax/total
  // come from the order row (canonical at checkout time).
  let payments = [];
  try {
    const payRows = await safeZcql(catalystApp,
      `SELECT mode, amount FROM Payments WHERE order_id = ${orderId}`);
    payments = (payRows || []).map((r) => ({ mode: String(r.Payments.mode), amount: Number(r.Payments.amount) || 0 }));
  } catch (e) { /* Payments table may not exist on old deployments */ }
  if (payments.length === 0) {
    payments = [{ mode: String(order.payment_mode || 'Cash'), amount: Number(order.total) || 0 }];
  }
  const store = await getStoreProfile(catalystApp, orgId);
  // SET-01: company logo embedded in emailed receipts when small enough.
  let logo = '';
  try {
    logo = await getCompanyLogoDataUri(catalystApp, orgId);
  } catch (e) { /* logo optional */ }
  const total = Number(order.total) || 0;
  return {
    store,
    logo,
    orderId: String(order.ROWID),
    invoiceNumber: String(order.invoice_number || ''),
    booksInvoiceId: String(order.books_invoice_id || ''),
    date: String(order.CREATEDTIME || ''),
    status: String(order.status || ''),
    customerName: String(order.customer_name || 'Walk-in Guest'),
    customerEmail: String(order.customer_email || ''),
    paymentMode: String(order.payment_mode || ''),
    payments,
    lines,
    subtotal,
    tax: Number(order.tax_amount) || 0,
    discount: posRound2(subtotal + (Number(order.tax_amount) || 0) - total) > 0
      ? posRound2(subtotal + (Number(order.tax_amount) || 0) - total) : 0,
    total,
  };
}

/** Escape text for safe interpolation into admin HTML emails/pages. */
function escHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Full-page HTML response for the admin approve/reject link endpoints. */
function adminResultPage({ title, heading, message, tone }) {
  const color = tone === 'success' ? '#059669' : tone === 'error' ? '#dc2626' : '#1d4ed8';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" />` +
    `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` +
    `<title>${escHtml(title)} — CloudHub POS</title></head>` +
    `<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#eef3fd;padding:40px 16px;">` +
    `<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:40px 32px;text-align:center;box-shadow:0 20px 50px -20px rgba(10,40,120,0.35);">` +
    `<div style="display:inline-block;width:60px;height:60px;border-radius:50%;background:${color};color:#fff;font-size:28px;line-height:60px;margin-bottom:16px;">${tone === 'error' ? '✕' : '✓'}</div>` +
    `<h1 style="color:#0a1a3d;font-size:22px;margin:0 0 12px;">${escHtml(heading)}</h1>` +
    `<p style="color:#475569;font-size:15px;line-height:1.65;margin:0;">${message}</p>` +
    `<p style="color:#94a3b8;font-size:12px;margin:24px 0 0;">CloudHub POS · Organization Administration</p>` +
    `</div></body></html>`;
}

// Middleware helper to extract tenant headers
function getTenantConfig(req) {
  const refreshToken = req.header('x-zoho-refresh-token');
  const orgId = req.header('x-zoho-org-id');
  const dc = req.header('x-zoho-dc') || 'US';

  if (refreshToken || orgId) {
    return { refreshToken, orgId, dc };
  }
  return null;
}

/**
 * Resolves the current Catalyst user, and returns their OrgUsers and Organizations row if tables exist.
 * Otherwise, falls back gracefully to a default organization 'org_default' (virtual single-tenant).
 */
async function getCurrentOrgUser(req, catalystApp) {
  // Reuse only within this HTTP request; the next request reads the roster again.
  if (!req._posOrgUserPromise) req._posOrgUserPromise = resolveCurrentOrgUser(req, catalystApp);
  return req._posOrgUserPromise;
}

async function resolveCurrentOrgUser(req, catalystApp) {
  let user = null;
  try {
    user = await catalystApp.userManagement().getCurrentUser();
  } catch (err) {
    return null;
  }

  if (!user) return null;

  // Email normalization FIRST — the Catalyst SDK project-user object
  // carries `email_id` (not always `email`) and the id as `user_id`/`zaid`.
  // Authentication is determined using user.email_id || user.email, matching
  // /api/auth/me. (A premature `user.email`-only check used to 401 here.)
  const userEmail = String(user.email_id || user.email || '').trim();
  const userId = String(user.user_id || user.zaid || '');
  if (userEmail === '') return null;
  user.email = userEmail;
  user.user_id = userId;

  // Authenticate with user credentials first; resolve only this identity's server-owned membership records.
  catalystApp = catalyst.initialize(req, { scope: 'admin' });

  // The roster is authoritative on every request, including role demotions.
  const roster = await findRosterUser(catalystApp, userEmail.toLowerCase());
  if (roster && ['inactive', 'deleted'].includes(String(roster.data.status || '').toLowerCase())) return null;

  const safeUserId = sanitizeZcql(userId);
  const safeUserEmail = sanitizeZcql(userEmail.toLowerCase());

  // Try querying OrgUsers and Organizations tables. Matches email-keyed
  // rows (invite rows, the growing majority) first, then numeric Catalyst
  // user ids (legacy console rows) — one query in the common case.
  // NOTE: no LIMIT 1 — duplicate rows (legacy org_default stamp + real org)
  // made single-row picks flip orgs between requests, so settings saved to
  // one prefix "disappeared" on reads from the other. Prefer the real org
  // deterministically below.
  try {
    let orgUserRows = null;
    if (safeUserEmail !== '') {
      orgUserRows = await safeZcql(catalystApp,
        `SELECT ROWID, org_id, role, display_name, user_id FROM OrgUsers WHERE user_id = '${safeUserEmail}' LIMIT 300`
      );
    }
    if ((!orgUserRows || orgUserRows.length === 0) && safeUserId !== '') {
      orgUserRows = await safeZcql(catalystApp,
        `SELECT ROWID, org_id, role, display_name, user_id FROM OrgUsers WHERE user_id = '${safeUserId}' LIMIT 300`
      );
    }

    if (orgUserRows && orgUserRows.length > 0) {
      // Deterministic pick: rows carrying the real org win over legacy
      // org_default stamps (stable sort keeps original order otherwise).
      const ranked = [...orgUserRows].sort((a, b) => {
        const ao = String((a && a.OrgUsers && a.OrgUsers.org_id) || '');
        const bo = String((b && b.OrgUsers && b.OrgUsers.org_id) || '');
        return (ao === 'org_default' ? 1 : 0) - (bo === 'org_default' ? 1 : 0);
      });
      const orgUser = { ...ranked[0].OrgUsers };
      if (roster) orgUser.role = normWhRole(roster.data.role);
      // Self-heal: converge numeric-id rows to email-keyed rows so the team
      // roster always shows real emails. Cosmetic migration only, best-effort.
      try {
        if (String(orgUser.user_id ?? '').toLowerCase() !== userEmail.toLowerCase()) {
          await catalystApp.datastore().table('OrgUsers').updateRow({ ROWID: orgUser.ROWID, user_id: userEmail.toLowerCase() });
          orgUser.user_id = userEmail.toLowerCase();
        }
      } catch (e) { /* never blocks sign-in */ }
      const safeOrgId = sanitizeZcql(orgUser.org_id);

      // Project shape first (this project's Organizations table uses
      // organization_name/status); template shape stays as fallback.
      // One query in the common case instead of always two.
      let org = {
        org_name: 'My Store',
        industry: 'Retail',
        zoho_books_org_id: '',
        books_connected: 'false'
      };
      let resolved = false;
      try {
        const altRows = await safeZcql(catalystApp,
          `SELECT ROWID, organization_name, industry, status FROM Organizations WHERE ROWID = '${safeOrgId}'`
        );
        if (altRows && altRows.length > 0) {
          const a = altRows[0].Organizations;
          org = {
            org_name: String(a.organization_name ?? '') || 'My Store',
            industry: String(a.industry ?? 'Retail'),
            zoho_books_org_id: '',
            books_connected: String(a.status ?? '').toLowerCase() === 'approved' ? 'true' : 'false',
          };
          resolved = true;
        }
      } catch (e) { /* try the template schema below */ }
      if (!resolved) {
        try {
          const orgRows = await safeZcql(catalystApp,
            `SELECT org_name, industry, zoho_books_org_id, books_connected FROM Organizations WHERE ROWID = '${safeOrgId}'`
          );
          if (orgRows && orgRows.length > 0) { org = orgRows[0].Organizations; resolved = true; }
        } catch (e2) { /* default org stands */ }
      }

      return { user, orgUser, org };
    }
  } catch (err) {
    const isMissingTable = err.message && (err.message.includes('No such Table') || err.message.includes('No such column'));
    if (isMissingTable) {
      console.warn('[getCurrentOrgUser] Organizations/OrgUsers table or column missing, using Configurations fallback');
    } else {
      console.error('[getCurrentOrgUser] Query error:', err.message);
    }
  }

  // Fallback mode if tables don't exist or user is not mapped yet.
  // We check Configurations to see if they are already considered onboarded.
  // This maintains absolute compatibility during table migration.
  const fallbackOrgId = String(roster?.data?.org_id || 'org_default');
  const virtualOrgUser = {
    org_id: fallbackOrgId,
    user_id: user.user_id,
    role: roster ? normWhRole(roster.data.role) : '', // Unassigned accounts have no privileges
    display_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email
  };

  const virtualOrg = {
    org_name: 'CloudHub POS',
    industry: 'Retail',
    zoho_books_org_id: '',
    books_connected: 'false'
  };

  return { user, orgUser: virtualOrgUser, org: virtualOrg };
}


// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), platform: 'Cloud POS SaaS' });
});

/**
 * POST /api/config/smtp
 * Save SMTP email configuration for OTP delivery
 */
app.post('/api/config/smtp', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'SMTP configuration requires Admin.')) return;
    const { smtp_host, smtp_port, smtp_user, smtp_pass, smtp_from } = req.body;
    if (!smtp_host || !smtp_user || !smtp_pass) {
      return res.status(400).json({ success: false, error: 'SMTP host, user, and password are required' });
    }
    await safeUpsertConfig(catalystApp, 'email_smtp_host', smtp_host);
    await safeUpsertConfig(catalystApp, 'email_smtp_port', smtp_port || '587');
    await safeUpsertConfig(catalystApp, 'email_smtp_user', smtp_user);
    await safeUpsertConfig(catalystApp, 'email_smtp_pass', smtp_pass);
    await safeUpsertConfig(catalystApp, 'email_smtp_from', smtp_from || smtp_user);
    res.status(200).json({ success: true, message: 'SMTP configuration saved' });
  } catch (error) {
    console.error('Error saving SMTP config:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/config/smtp
 * Get SMTP configuration status (does not expose password)
 */
app.get('/api/config/smtp', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const booksService = new ZohoBooksService(catalystApp);
    const host = await booksService.getConfig('email_smtp_host');
    const port = await booksService.getConfig('email_smtp_port');
    const user = await booksService.getConfig('email_smtp_user');
    const from = await booksService.getConfig('email_smtp_from');
    res.status(200).json({
      success: true,
      configured: !!(host && user),
      smtp_host: host || '',
      smtp_port: port || '587',
      smtp_user: user || '',
      smtp_from: from || ''
    });
  } catch (error) {
    res.status(200).json({ success: true, configured: false });
  }
});

/**
 * GET /api/setup/status
 * Checks if all required Datastore tables exist and returns their status.
 * This is a one-time diagnostic — once tables are confirmed, this endpoint is no longer needed.
 */
app.get('/api/setup/status', async (req, res) => {
  const requiredTables = ['Products', 'Orders', 'OrderItems', 'Configurations', 'Organizations', 'OrgUsers', 'StockMovements', 'Categories', 'Warehouses', 'WarehouseStock', 'StockTransfers', 'TransferItems', 'Customers', 'CustomerActivity', 'Vendors', 'PurchaseOrders', 'PurchaseOrderItems', 'VendorBills', 'VendorPayments'];
  const tableStatus = {};

  for (const tableName of requiredTables) {
    try {
      const catalystApp = catalyst.initialize(req);
      const result = await catalystApp.zcql().executeZCQLQuery(`SELECT ROWID FROM ${tableName} LIMIT 1`);
      tableStatus[tableName] = { exists: true, sample_rows: result ? result.length : 0 };
    } catch (err) {
      tableStatus[tableName] = { exists: false, error: err.message };
    }
  }

  const allExist = requiredTables.every(t => tableStatus[t].exists);
  res.status(200).json({
    success: true,
    all_tables_ready: allExist,
    tables: tableStatus,
    message: allExist
      ? 'All Datastore tables are provisioned and ready.'
      : 'Some tables are missing. Please create them via Catalyst CLI: run `npx zcatalyst-cli datastore push` from the project root, or create them manually in the Catalyst Console → Data Store.'
  });
});

/* ==========================================================================
   ZOHO OAUTH MULTI-TENANT AUTHENTICATION ENDPOINTS
   ==========================================================================
   NOTE: /api/debug-configs and /api/debug/connection removed — they exposed
   all Configurations table secrets (SMTP passwords, OAuth secrets) publicly.
   Use /api/setup/status for non-sensitive table health checks.
   ========================================================================== */

/**
 * GET /api/auth/status
 * Check connection availability - Catalyst connection first, then Master Credentials
 */
app.get('/api/auth/status', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const booksService = new ZohoBooksService(catalystApp);

    // Check Catalyst connection first (SDK v3.2.0+)
    let catalystConnAvailable = false;
    try {
      const connCredentials = await catalystApp.connections().getConnectionCredentials('zohobooks_conn');
      catalystConnAvailable = !!(connCredentials && connCredentials.headers && connCredentials.headers['Authorization']);
    } catch (e) {
      // Catalyst connection not configured or SDK < v3.2.0
    }

    // Transparently ensure SaaS master credentials exist (merchants never see these)
    const master = await ensureMasterCredentials(booksService);
    const orgId = await booksService.getConfig('zoho_org_id');

    const lastConnectedStr = await booksService.getConfig('last_connected_org');
    const lastConnected = lastConnectedStr ? JSON.parse(lastConnectedStr) : null;

    res.status(200).json({
      success: true,
      catalyst_connection: catalystConnAvailable,
      master_configured: !!(master.client_id && master.client_secret),
      dc: master.dc,
      org_id: orgId || (lastConnected ? lastConnected.orgId : null),
      connected: !!lastConnected,
      connection: lastConnected
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/organizations
 * Fetch all Zoho Books organizations for the authenticated account across all DCs or a specific DC
 */
app.get('/api/organizations', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const dcQuery = req.query.dc || null;
    const tenantConfig = getTenantConfig(req);

    // Strict multi-tenant isolation: do not fetch organizations using the project-level
    // connection (zohobooks_conn) if the user has not provided their own OAuth token.
    // This prevents merchant sessions from auto-linking to the developer's personal account.
    if (!tenantConfig || !tenantConfig.refreshToken) {
      console.log('GET /organizations: No tenant OAuth refresh token provided. Returning empty organizations list.');
      return res.status(200).json({
        success: true,
        count: 0,
        organizations: []
      });
    }

    const booksService = new ZohoBooksService(catalystApp, tenantConfig);

    console.log('Retrieving Zoho Books organizations for current account connection...');
    const organizations = await booksService.getOrganizations(dcQuery);

    res.status(200).json({
      success: true,
      count: organizations.length,
      organizations
    });
  } catch (error) {
    console.error('Error fetching Zoho Books organizations:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to fetch organizations.' });
  }
});

/**
 * POST /api/organizations/register
 * SaaS organization registration submission (onboarding Step 3).
 *
 * Flow: validate -> duplicate check on owner_email -> insert Organizations
 * row with status "pending" -> notify admin via SMTP -> 201.
 *
 * Does NOT create users, auth credentials, or approvals (future phases).
 * Password is accepted for future account provisioning and is NOT stored
 * in the Organizations table.
 */
app.post('/api/organizations/register', async (req, res) => {
  try {
    const body = req.body || {};
    const organization_name = typeof body.organization_name === 'string' ? body.organization_name.trim() : '';
    const business_reg_no = typeof body.business_reg_no === 'string' ? body.business_reg_no.trim() : '';
    const tin_number = typeof body.tin_number === 'string' ? body.tin_number.trim() : '';
    const industry = typeof body.industry === 'string' ? body.industry.trim() : '';
    const owner_name = typeof body.owner_name === 'string' ? body.owner_name.trim() : '';
    const owner_email = typeof body.owner_email === 'string' ? body.owner_email.trim() : '';
    const owner_phone = typeof body.owner_phone === 'string' ? body.owner_phone.trim() : '';
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    const province = typeof body.province === 'string' ? body.province.trim() : '';
    const country = typeof body.country === 'string' ? body.country.trim() : '';
    // NOTE: registration collects org + owner + address only. No password
    // here — the owner sets their password through Catalyst's activation
    // email after approval. Catalyst Authentication is the only credential
    // store; this table holds no password fields.

    // ---- Required-field validation ----
    const missing = [];
    if (!organization_name) missing.push('organization_name');
    if (!business_reg_no) missing.push('business_reg_no');
    if (!owner_name) missing.push('owner_name');
    if (!owner_email) missing.push('owner_email');
    if (!owner_phone) missing.push('owner_phone');
    if (!address) missing.push('address');
    if (!city) missing.push('city');
    if (!province) missing.push('province');
    if (!country) missing.push('country');
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields: ${missing.join(', ')}`
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner_email)) {
      return res.status(400).json({ success: false, message: 'Invalid email format.' });
    }
    console.log('[REGISTER] Validation passed');

    const catalystApp = catalyst.initialize(req);

    // ---- Duplicate check on owner_email ----
    const safeEmail = sanitizeZcql(owner_email);
    const existing = await safeZcql(
      catalystApp,
      `SELECT ROWID FROM Organizations WHERE owner_email = '${safeEmail}'`
    );
    if (existing && existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Organization already registered'
      });
    }
    console.log('[REGISTER] Duplicate check passed');

    // ---- Insert Organizations row ----
    // created_at must be "YYYY-MM-DD HH:mm:ss" (see formatCatalystDateTime).
    // approved_at is intentionally omitted — approval-stage field for the
    // future Approve Organization API.
    const created_at = formatCatalystDateTime(new Date());
    console.log('[REGISTER] created_at type:', typeof created_at);
    console.log('[REGISTER] created_at value:', created_at);
    const payload = {
      organization_name,
      business_reg_no,
      tin_number,
      industry,
      owner_name,
      owner_email,
      owner_phone,
      address,
      city,
      province,
      country,
      status: 'pending',
      remarks: '',
      created_at
    };
    console.log('[REGISTER] Insert payload ready:', Object.keys(payload).join(','));
    const inserted = await catalystApp.datastore().table('Organizations').insertRow(payload);
    console.log(`[REGISTER] Insert succeeded, ROWID: ${inserted && inserted.ROWID}`);
    console.log(`[REGISTER] New organization pending approval: ${organization_name} <${owner_email}>`);

    // ---- Admin notification email (HTML approval request) ----
    try {
      const notifyTo = process.env.SMTP_USER;
      if (notifyTo && inserted && inserted.ROWID) {
        const base = getPublicBaseUrl(req);
        const approveUrl = `${base}/server/pos_backend/api/admin/approve-org?id=${inserted.ROWID}`;
        const rejectUrl = `${base}/server/pos_backend/api/admin/reject-org?id=${inserted.ROWID}`;
        const detailRow = (label, value) =>
          `<tr><td style="padding:9px 14px;color:#64748b;font-size:13px;border-bottom:1px solid #eef2f9;">${label}</td>` +
          `<td style="padding:9px 14px;color:#0a1a3d;font-size:13px;font-weight:700;border-bottom:1px solid #eef2f9;text-align:right;">${escHtml(value) || '—'}</td></tr>`;
        const html =
          `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;background:#f4f7fe;padding:28px 20px;">` +
          `<div style="background:#0b1e42;border-radius:14px 14px 0 0;padding:26px 28px;">` +
          `<p style="color:#9cc2ff;font-size:12px;letter-spacing:2px;margin:0 0 6px;">CLOUDHUB POS · ADMIN</p>` +
          `<h1 style="color:#ffffff;font-size:21px;margin:0;">New Organization Approval Required</h1></div>` +
          `<div style="background:#ffffff;border-radius:0 0 14px 14px;padding:26px 28px;">` +
          `<table style="width:100%;border-collapse:collapse;margin-bottom:8px;"><tbody>` +
          detailRow('Organization', organization_name) +
          detailRow('Business Reg. No', business_reg_no) +
          detailRow('Owner', owner_name) +
          detailRow('Owner Email', owner_email) +
          detailRow('Owner Phone', owner_phone) +
          detailRow('Industry', industry) +
          detailRow('Country', country) +
          detailRow('Registered', created_at) +
          `</tbody></table>` +
          `<p style="margin:14px 0 20px;"><span style="display:inline-block;background:#fef3c7;border:1px solid #fcd34d;color:#92400e;font-size:12px;font-weight:700;border-radius:999px;padding:5px 14px;">STATUS: PENDING APPROVAL</span></p>` +
          `<a href="${approveUrl}" style="display:block;text-align:center;background:#059669;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;padding:15px;margin-bottom:12px;">APPROVE ORGANIZATION</a>` +
          `<a href="${rejectUrl}" style="display:block;text-align:center;background:#ffffff;color:#dc2626;font-size:15px;font-weight:700;text-decoration:none;border-radius:10px;padding:14px;border:2px solid #fecaca;">REJECT ORGANIZATION</a>` +
          `<p style="color:#94a3b8;font-size:12px;line-height:1.6;margin:20px 0 0;">This registration requires review. Approving creates the owner's CloudHub POS account and sends them an activation email.</p>` +
          `</div></div>`;
        const text =
          `New CloudHub POS Organization Registration\n\nOrganization: ${organization_name}\n` +
          `Business Registration: ${business_reg_no}\nOwner: ${owner_name}\nEmail: ${owner_email}\n` +
          `Phone: ${owner_phone}\nIndustry: ${industry}\nCountry: ${country}\nStatus: Pending Approval\n\n` +
          `Approve: ${approveUrl}\nReject: ${rejectUrl}`;
        const sent = await sendSmtpMail(catalystApp, {
          to: notifyTo,
          subject: 'CloudHub POS - New Organization Approval Required',
          html, text
        });
        console.log(sent
          ? `[REGISTER] Admin notification sent to ${notifyTo}`
          : '[REGISTER] Admin notification failed — check the [MAIL] error or SMTP configuration.');
      }
    } catch (emailErr) {
      // Registration already stored; never fail the request on email errors.
      console.error('[REGISTER] Admin notification failed:', emailErr.message);
    }

    return res.status(201).json({
      success: true,
      status: 'pending',
      message: 'Registration submitted successfully'
    });
  } catch (error) {
    console.error('[REGISTER] FULL ERROR:', JSON.stringify(error, null, 2));
    console.error('[REGISTER] MESSAGE:', error.message);
    console.error('[REGISTER] CODE:', error.code);
    console.error('[REGISTER] STATUS:', error.statusCode);
    return res.status(500).json({
      success: false,
      message: 'Registration failed. Please try again.'
    });
  }
});

/** Provision the approved company's owner with full POS Admin access.
 * Retry-safe: existing authentication accounts and OrgUsers rows are reused.
 * Mark approved only after both role stores have been saved successfully. */
async function provisionOrganizationOwner(catalystApp, org) {
  const email = String(org.owner_email || '').trim().toLowerCase();
  const name = String(org.owner_name || email).trim();
  const orgId = String(org.ROWID || '');
  if (!email || !orgId) throw new Error('Organization owner and organization ID are required.');

  let exists = false;
  try {
    const users = await catalystApp.userManagement().getAllUsers();
    exists = Array.isArray(users) && users.some((user) =>
      String(user.email_id || user.email || '').trim().toLowerCase() === email);
  } catch (error) {
    // A duplicate response from registerUser also makes retries safe.
    console.warn('[APPROVE] Authentication lookup unavailable:', error.message);
  }
  if (!exists) {
    const parts = name.split(/\s+/);
    try {
      await catalystApp.userManagement().registerUser(
        { platform_type: 'web' },
        { email_id: email, first_name: parts[0] || email, last_name: parts.slice(1).join(' ') || undefined }
      );
    } catch (error) {
      if (!/already|exists|duplicate/i.test(extractSdkMessage(error))) throw error;
    }
  }

  const mapped = await syncOrgUserRole(catalystApp, email, 'Admin', { orgId, displayName: name });
  if (!mapped) throw new Error('Could not save the organization owner Admin role. Retry approval.');
  const existing = await findRosterUser(catalystApp, email);
  await saveRosterUser(catalystApp, email, {
    ...(existing ? existing.data : {}),
    email, name, org_id: orgId,
    role: 'Admin', permissions: getRolePermissions('Admin'), status: 'active',
    invited_at: existing && existing.data.invited_at ? existing.data.invited_at : Date.now(),
    updated_at: Date.now(),
  });
  await catalystApp.datastore().table('Organizations').updateRow({
    ROWID: org.ROWID, status: 'approved', approved_at: formatCatalystDateTime(new Date()),
  });
}

/**
 * GET /api/admin/approve-org?id=ROWID
 * Admin email-link endpoint: approve a pending organization, create the
 * Catalyst Authentication user (duplicate-safe), trigger Catalyst's
 * activation email, and notify the owner. Returns an HTML result page.
 */
app.get('/api/admin/approve-org', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    if (!/^[0-9]+$/.test(id)) {
      return res.status(400).send(adminResultPage({
        title: 'Invalid link', heading: 'Invalid approval link',
        message: 'This approval link is malformed. Please use the button in the admin notification email.',
        tone: 'error'
      }));
    }
    const catalystApp = catalyst.initialize(req);
    const rows = await safeZcql(catalystApp,
      `SELECT ROWID, organization_name, owner_name, owner_email, status FROM Organizations WHERE ROWID = '${id}'`);
    if (!rows || rows.length === 0) {
      return res.status(404).send(adminResultPage({
        title: 'Not found', heading: 'Organization not found',
        message: 'No organization matches this approval link. It may have been removed.',
        tone: 'error'
      }));
    }
    const org = rows[0].Organizations;
    if (org.status !== 'pending') {
      return res.status(200).send(adminResultPage({
        title: 'Already processed', heading: 'Approval already completed',
        message: `“${escHtml(org.organization_name)}” is already <strong>${escHtml(org.status)}</strong>. No further action was taken.`,
        tone: 'info'
      }));
    }

    await provisionOrganizationOwner(catalystApp, org);
    console.log(`[APPROVE] Organization approved with Admin access: ${org.organization_name} <${org.owner_email}>`);

    // No resetPassword() here: registerUser() above already sends Catalyst's
    // invitation/activation email. resetPassword() is password RECOVERY and
    // would wrongly mail "Reset password for your POS account" to a new owner.

    // Notify the owner that approval is complete.
    const ownerHtml =
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#f4f7fe;padding:28px 20px;">` +
      `<div style="background:#0b1e42;border-radius:14px 14px 0 0;padding:26px 28px;">` +
      `<p style="color:#9cc2ff;font-size:12px;letter-spacing:2px;margin:0 0 6px;">CLOUDHUB POS</p>` +
      `<h1 style="color:#ffffff;font-size:21px;margin:0;">Registration Approved</h1></div>` +
      `<div style="background:#ffffff;border-radius:0 0 14px 14px;padding:26px 28px;">` +
      `<p style="color:#475569;font-size:14px;line-height:1.65;">Hello <strong>${escHtml(org.owner_name)}</strong>,</p>` +
      `<p style="color:#475569;font-size:14px;line-height:1.65;">Your organization has been approved.</p>` +
      `<p style="color:#475569;font-size:14px;line-height:1.65;">A CloudHub POS account has been created. Please check your inbox and complete account activation.</p>` +
      `<p style="color:#475569;font-size:14px;line-height:1.65;">After creating your password you will be able to log in.</p>` +
      `<p style="color:#94a3b8;font-size:12px;margin:20px 0 0;">CloudHub POS Support</p>` +
      `</div></div>`;
    await sendSmtpMail(catalystApp, {
      to: org.owner_email,
      subject: 'CloudHub POS Registration Approved',
      html: ownerHtml,
      text: `Hello ${org.owner_name},\n\nYour organization has been approved.\n\nA CloudHub POS account has been created. Please check your inbox and complete account activation.\n\nAfter creating your password you will be able to log in.`
    });

    // hosted Catalyst login (activation mail comes from Catalyst Auth).

    return res.status(200).send(adminResultPage({
      title: 'Approved', heading: 'Organization approved',
      message: `“${escHtml(org.organization_name)}” is now <strong>approved</strong>. The Catalyst account for ${escHtml(org.owner_email)} has been created and the owner notified.`,
      tone: 'success'
    }));
  } catch (error) {
    console.error('[APPROVE] FULL ERROR:', JSON.stringify(error, null, 2));
    return res.status(500).send(adminResultPage({
      title: 'Error', heading: 'Approval failed',
      message: 'An unexpected error occurred. Please try again or approve from the Catalyst console.',
      tone: 'error'
    }));
  }
});

/**
 * GET /api/admin/reject-org?id=ROWID
 * Admin email-link endpoint: reject a pending organization and notify the owner.
 */
app.get('/api/admin/reject-org', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    if (!/^[0-9]+$/.test(id)) {
      return res.status(400).send(adminResultPage({
        title: 'Invalid link', heading: 'Invalid rejection link',
        message: 'This rejection link is malformed. Please use the button in the admin notification email.',
        tone: 'error'
      }));
    }
    const catalystApp = catalyst.initialize(req);
    const rows = await safeZcql(catalystApp,
      `SELECT ROWID, organization_name, owner_name, owner_email, status FROM Organizations WHERE ROWID = '${id}'`);
    if (!rows || rows.length === 0) {
      return res.status(404).send(adminResultPage({
        title: 'Not found', heading: 'Organization not found',
        message: 'No organization matches this rejection link. It may have been removed.',
        tone: 'error'
      }));
    }
    const org = rows[0].Organizations;
    if (org.status !== 'pending') {
      return res.status(200).send(adminResultPage({
        title: 'Already processed', heading: 'Approval already completed',
        message: `“${escHtml(org.organization_name)}” is already <strong>${escHtml(org.status)}</strong>. No further action was taken.`,
        tone: 'info'
      }));
    }

    await catalystApp.datastore().table('Organizations').updateRow({
      ROWID: org.ROWID,
      status: 'rejected'
    });
    console.log(`[REJECT] Organization rejected: ${org.organization_name} <${org.owner_email}>`);


    const html =
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#f4f7fe;padding:28px 20px;">` +
      `<div style="background:#ffffff;border-radius:14px;padding:30px 28px;text-align:center;">` +
      `<h1 style="color:#0a1a3d;font-size:20px;margin:0 0 12px;">CloudHub POS Registration Update</h1>` +
      `<p style="color:#475569;font-size:14px;line-height:1.65;">Hello <strong>${escHtml(org.owner_name)}</strong>,</p>` +
      `<p style="color:#475569;font-size:14px;line-height:1.65;">Unfortunately your registration has not been approved at this time.</p>` +
      `<p style="color:#475569;font-size:14px;line-height:1.65;">Please contact support if you believe this was a mistake.</p>` +
      `<p style="color:#94a3b8;font-size:12px;margin:20px 0 0;">CloudHub POS Support</p>` +
      `</div></div>`;
    await sendSmtpMail(catalystApp, {
      to: org.owner_email,
      subject: 'CloudHub POS Registration Update',
      html,
      text: `Unfortunately your registration has not been approved at this time.\nPlease contact support if you believe this was a mistake.`
    });

    return res.status(200).send(adminResultPage({
      title: 'Rejected', heading: 'Organization rejected',
      message: `“${escHtml(org.organization_name)}” has been marked <strong>rejected</strong> and the owner has been notified.`,
      tone: 'success'
    }));
  } catch (error) {
    console.error('[REJECT] FULL ERROR:', JSON.stringify(error, null, 2));
    return res.status(500).send(adminResultPage({
      title: 'Error', heading: 'Rejection failed',
      message: 'An unexpected error occurred. Please try again.',
      tone: 'error'
    }));
  }
});

/**
 * POST /api/auth/save-master-credentials
 * Saves global Master Developer credentials from Settings panel
 */
app.post('/api/auth/save-master-credentials', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Master credentials require Admin.')) return;
    const booksService = new ZohoBooksService(catalystApp);
    const { client_id, client_secret, dc } = req.body;

    if (!client_id || !client_secret) {
      return res.status(400).json({ success: false, error: 'Client ID and Client Secret are required' });
    }

    await booksService.saveConfig('zoho_client_id', client_id);
    await booksService.saveConfig('zoho_client_secret', client_secret);
    await booksService.saveConfig('zoho_dc', dc || 'US');

    res.status(200).json({ success: true, message: 'SaaS Master Client Credentials saved successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/auth/seed-credentials
 * One-time seeding of default Zoho API Console credentials
 */
app.post('/api/auth/seed-credentials', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Seeding credentials requires Admin.')) return;
    const booksService = new ZohoBooksService(catalystApp);

    // Check if already configured
    const existingId = await booksService.getConfig('zoho_client_id');
    if (existingId) {
      return res.status(200).json({ success: true, message: 'Credentials already configured, skipping seed.' });
    }

    const { client_id, client_secret, dc } = req.body;
    if (!client_id || !client_secret) {
      return res.status(400).json({ success: false, error: 'Client ID and Client Secret are required' });
    }

    await booksService.saveConfig('zoho_client_id', client_id);
    await booksService.saveConfig('zoho_client_secret', client_secret);
    await booksService.saveConfig('zoho_dc', dc || 'com');

    res.status(200).json({ success: true, message: 'Default Zoho credentials seeded successfully!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/auth/me
 * Catalyst authenticates identity; the current POS roster supplies privileges.
 */
app.get('/api/auth/me', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const context = await getCurrentOrgUser(req, catalystApp);
    if (!context) return res.status(401).json({ success: false, authenticated: false });
    const { user, orgUser } = context;
    const email = user.email;
    const role = callerRole(context);
    const profile = roleCan(role, 'manage_profile') ? await readPersonalProfile(catalystApp, context) : null;
    res.set('Cache-Control', 'no-store');
    return res.json({
      success: true, authenticated: true, role,
      permissions: getRolePermissions(role),
      user: { email, name: (profile && profile.name) || orgUser.display_name || email, user_id: user.user_id, avatar_version: profile && profile.photo_ref ? String(profile.photo_updated_at) : '' }
    });
  } catch (err) {
    return res.status(401).json({ success: false, authenticated: false });
  }
});

/**
 * GET /api/auth/url
 * Returns the authorization link to redirect users to Zoho Accounts using Master Client ID
 */
app.get('/api/auth/url', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const booksService = new ZohoBooksService(catalystApp);

    const master = await ensureMasterCredentials(booksService);
    const clientId = master.client_id;

    const redirectUri = buildRedirectUri(req);
    const oauthUrl = `https://accounts.zoho.com/oauth/v2/auth?scope=ZohoBooks.fullaccess.all&client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&access_type=offline&prompt=consent`;

    res.send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Connect Zoho Books</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Inter', sans-serif; background: #f1f5f9; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
  .card { background: white; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,0.08); max-width: 480px; width: 100%; overflow: hidden; border: 1px solid #e2e8f0; }
  .header { background: linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%); padding: 24px 28px; color: white; }
  .header h1 { font-family: 'Outfit', 'Inter', sans-serif; font-size: 20px; margin: 0 0 4px 0; font-weight: 600; }
  .header p { font-size: 13px; opacity: 0.75; margin: 0; }
  .body { padding: 24px 28px; }
  .option { display: flex; align-items: flex-start; gap: 14px; padding: 16px; border: 2px solid #e2e8f0; border-radius: 12px; margin-bottom: 12px; cursor: pointer; transition: all 0.2s; }
  .option:hover { border-color: #94a3b8; }
  .option.active { border-color: #3b82f6; background: #eff6ff; }
  .option-icon { width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; }
  .icon-current { background: #dbeafe; color: #2563eb; }
  .icon-different { background: #fef3c7; color: #d97706; }
  .option-text h3 { font-size: 14px; margin: 0 0 3px 0; font-weight: 600; color: #0f172a; }
  .option-text p { font-size: 12px; margin: 0; color: #64748b; line-height: 1.4; }
  .steps { display: none; margin-top: 16px; padding: 16px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; }
  .steps.visible { display: block; }
  .steps ol { margin: 0 0 14px 0; padding-left: 20px; }
  .steps li { font-size: 13px; color: #334155; margin-bottom: 8px; line-height: 1.5; }
  .steps li strong { color: #0f172a; }
  .oauth-link-wrap { background: #f1f5f9; padding: 10px 14px; border-radius: 8px; word-break: break-all; font-size: 11px; color: #475569; border: 1px solid #e2e8f0; margin-bottom: 10px; max-height: 80px; overflow-y: auto; }
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 10px 20px; border: none; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; width: 100%; justify-content: center; transition: all 0.2s; }
  .btn-primary { background: #3b82f6; color: white; }
  .btn-primary:hover { background: #2563eb; }
  .btn-secondary { background: #e2e8f0; color: #475569; }
  .btn-secondary:hover { background: #cbd5e1; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .info-box { background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 10px; padding: 12px 14px; margin-top: 12px; font-size: 12px; color: #0369a1; line-height: 1.5; }
  .hidden { display: none; }
</style></head>
<body>
<div class="card">
  <div class="header">
    <h1>🔗 Connect Zoho Books</h1>
    <p>Link your Zoho Books account to sync inventory and invoices</p>
  </div>
  <div class="body">
    <p style="font-size: 13px; color: #475569; margin: 0 0 16px 0; line-height: 1.5;">
      Choose how you'd like to connect:
    </p>

    <div class="option active" id="option-current" onclick="selectOption('current')">
      <div class="option-icon icon-current">👤</div>
      <div class="option-text">
        <h3>Use current Zoho session</h3>
        <p>Connect with the Zoho account you're already signed in as (fastest)</p>
      </div>
    </div>

    <div class="option" id="option-different" onclick="selectOption('different')">
      <div class="option-icon icon-different">🔄</div>
      <div class="option-text">
        <h3>Use a different Zoho account</h3>
        <p>Sign out first, then log in with a different Zoho Books account</p>
      </div>
    </div>

    <div id="steps-different" class="steps">
      <ol>
        <li><strong>First sign out</strong> — <a href="https://accounts.zoho.com" target="_blank" rel="noopener">Click here to open Zoho Accounts</a> in a new tab and sign out</li>
        <li><strong>Then come back</strong> to this popup and click the button below</li>
      </ol>
      <button class="btn btn-primary" onclick="window.location.href=oauthUrl" style="margin-bottom: 8px;">
        🔗 Continue to Zoho Login →
      </button>
      <div style="font-size: 11px; color: #94a3b8; text-align: center;">After signing out, clicking this will show the Zoho login screen where you can log in with any account</div>
    </div>

    <div class="info-box" id="statusBox">
      <span id="statusText">Ready to connect. Click "Continue" below.</span>
    </div>

    <button class="btn btn-primary" onclick="proceed()" id="proceedBtn" style="margin-top: 16px;">
      Continue →
    </button>
  </div>
</div>

<script>
  var oauthUrl = ${JSON.stringify(oauthUrl)};
  var selectedOption = 'current';

  function selectOption(opt) {
    selectedOption = opt;
    document.getElementById('option-current').classList.toggle('active', opt === 'current');
    document.getElementById('option-different').classList.toggle('active', opt === 'different');
    document.getElementById('steps-different').classList.toggle('visible', opt === 'different');
    document.getElementById('statusBox').classList.toggle('hidden', opt === 'different');
    document.getElementById('proceedBtn').textContent = opt === 'current' ? 'Continue →' : 'Continue →';
  }

  function proceed() {
    if (selectedOption === 'current') {
      window.location.href = oauthUrl;
    } else {
      // For "different account": redirects to Zoho OAuth in same popup
      // User should sign out of Zoho in a new tab first, then click proceed
      window.location.href = oauthUrl;
    }
  }
</script>
</body></html>`);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/auth/callback
 * Zoho OAuth redirect callback that exchanges the code, fetches linked Organizations, and posts to parent window
 */
app.get('/api/auth/callback', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const booksService = new ZohoBooksService(catalystApp);
    const code = req.query.code;

    if (!code) {
      return res.status(400).send('Authentication code is missing from Zoho redirection.');
    }

    const master = await ensureMasterCredentials(booksService);
    const clientId = master.client_id;
    const clientSecret = master.client_secret;

    const redirectUri = buildRedirectUri(req);

    // Always exchange on accounts.zoho.com — Zoho routes to correct DC internally
    console.log('Exchanging auth code for tokens on accounts.zoho.com...');
    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      }
    });

    if (response.data && response.data.refresh_token) {
      const refreshToken = response.data.refresh_token;
      const accessToken = response.data.access_token;
      console.log('Token exchange successful. Access token prefix:', accessToken.substring(0, 15) + '...');

      // Zoho auto-routes the code exchange to the correct DC, so the access token
      // we just got is already for the right DC. Use it directly to probe /items
      // on each DC's API endpoint — the correct DC will return code 0.
      const allDcs = ['US', 'EU', 'IN', 'AU', 'JP'];
      let organizations = [];
      let foundDc = null;

      // First: get the org list from ANY DC (works cross-DC)
      let allOrgs = [];
      for (const probeDc of allDcs) {
        try {
          const probeDomains = booksService.getDomainUrls(probeDc);
          const orgsUrl = `${probeDomains.api}/organizations`;
          console.log(`Fetching orgs from ${probeDc}: ${orgsUrl}`);
          const orgsResponse = await axios.get(orgsUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
            timeout: 5000
          });
          if (orgsResponse.data && orgsResponse.data.code === 0 && orgsResponse.data.organizations && orgsResponse.data.organizations.length > 0) {
            allOrgs = orgsResponse.data.organizations;
            console.log(`Found ${allOrgs.length} org(s) via ${probeDc} DC: ${allOrgs.map(o => o.organization_id).join(', ')}`);
            break; // /organizations works cross-DC, one probe is enough
          }
        } catch (probeErr) {
          console.warn(`Org probe on ${probeDc} failed:`, probeErr.message);
        }
      }

      if (allOrgs.length === 0) {
        throw new Error('No Zoho Books organizations found for this account.');
      }

      // Second: find the correct DC by testing /items on each DC with the original access token
      // /items is DC-restricted, so only the correct DC will return code 0
      for (const probeDc of allDcs) {
        try {
          const probeDomains = booksService.getDomainUrls(probeDc);
          const testOrgId = allOrgs[0].organization_id;
          const itemsUrl = `${probeDomains.api}/items?organization_id=${testOrgId}&status=active`;
          console.log(`Testing /items on ${probeDc}: ${itemsUrl}`);

          const itemsResp = await axios.get(itemsUrl, {
            headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
            timeout: 8000
          });

          if (itemsResp.data && itemsResp.data.code === 0) {
            foundDc = probeDc;
            organizations = allOrgs.map(org => ({ ...org, dc: probeDc }));
            console.log(`CORRECT DC FOUND: ${foundDc} — /items returned ${itemsResp.data.items ? itemsResp.data.items.length : 0} items`);
            break;
          } else {
            console.warn(`DC ${probeDc} /items returned code ${itemsResp.data.code}: ${itemsResp.data.message}`);
          }
        } catch (itemErr) {
          const errMsg = itemErr.response ? `HTTP ${itemErr.response.status}: ${JSON.stringify(itemErr.response.data)}` : itemErr.message;
          console.warn(`DC ${probeDc} /items failed: ${errMsg}`);
        }
      }

      // Fallback: if no DC passed the /items test, default to US
      if (!foundDc) {
        foundDc = 'US';
        organizations = allOrgs.map(org => ({ ...org, dc: 'US' }));
        console.warn('WARNING: No DC verified via /items test. Defaulting to US. Orgs:', JSON.stringify(organizations));
      }

      // Resolve user email from Zoho user info API
      let userEmail = 'merchant@zoho.books';
      try {
        const userInfoResp = await axios.get('https://accounts.zoho.com/oauth/user/info', {
          headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
          timeout: 5000
        });
        if (userInfoResp.data && userInfoResp.data.ZUID) {
          userEmail = userInfoResp.data.Email || (organizations.length > 0 ? organizations[0].email : 'merchant@zoho.books');
        }
      } catch (e) {
        userEmail = organizations.length > 0 ? organizations[0].email : 'merchant@zoho.books';
      }

      // Save admin user to Configurations (so they appear in Users section)
      const adminName = userEmail.split('@')[0] || 'Admin';
      const adminUserKey = `user_${userEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const adminPayload = { email: userEmail, name: adminName, role: 'Admin', permissions: getRolePermissions('Admin'), status: 'active', invited_at: Date.now(), verified_at: Date.now() };
      await safeUpsertConfig(catalystApp, adminUserKey, JSON.stringify(adminPayload));

      // Save the exchanged tokens for each organization in Configurations
      for (const org of organizations) {
        console.log(`Persisting secure OAuth configs in Datastore for org ${org.organization_id} (${org.name})...`);
        await safeUpsertConfig(catalystApp, `zoho_refresh_token_${org.organization_id}`, refreshToken);
        await safeUpsertConfig(catalystApp, `zoho_dc_${org.organization_id}`, foundDc);
        await safeUpsertConfig(catalystApp, `zoho_org_name_${org.organization_id}`, org.name);
        await safeUpsertConfig(catalystApp, `zoho_books_connected_${org.organization_id}`, 'true');
      }

      // Save last_connected_org for client-side polling fallback
      if (organizations.length > 0) {
        const lastConnectedPayload = {
          refreshToken,
          dc: foundDc || 'US',
          orgId: organizations[0].organization_id,
          orgName: organizations[0].name,
          email: userEmail
        };
        await safeUpsertConfig(catalystApp, 'last_connected_org', JSON.stringify(lastConnectedPayload));
      }

      // Return secure handshaking landing page that sends credentials to parent window
      res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <title>Zoho Connection Authorized</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;600;700&display=swap" rel="stylesheet">
          <style>
            body {
              font-family: 'Inter', sans-serif;
              background-color: #f8fafc;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
            }
            .success-card {
              background: white;
              padding: 40px;
              border-radius: 16px;
              box-shadow: 0 10px 30px rgba(0,0,0,0.05);
              text-align: center;
              max-width: 400px;
              border: 1px solid #e2e8f0;
            }
            .icon {
              color: #16a34a;
              font-size: 64px;
              margin-bottom: 20px;
            }
            h2 {
              font-family: 'Outfit', sans-serif;
              font-size: 24px;
              margin: 0 0 10px 0;
              color: #0f172a;
            }
            p {
              color: #64748b;
              font-size: 14px;
              line-height: 1.5;
              margin: 0 0 20px 0;
            }
            .spinner {
              border: 3px solid #f3f3f3;
              border-top: 3px solid #16a34a;
              border-radius: 50%;
              width: 24px;
              height: 24px;
              animation: spin 1s linear infinite;
              margin: 0 auto;
            }
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          </style>
        </head>
        <body>
          <div class="success-card">
            <div class="icon">✓</div>
            <h2>Authorization Approved!</h2>
            <p>Your Zoho Books account has been successfully linked. Fetching business units and closing...</p>
            <div class="spinner"></div>
          </div>
          <script>
            const authResult = {
              type: 'zoho_auth_success',
              email: ${JSON.stringify(userEmail)},
              refreshToken: ${JSON.stringify(refreshToken)},
              dc: ${JSON.stringify(foundDc)},
              organizations: ${JSON.stringify(organizations)}
            };
            
            if (window.opener) {
              // Restrict postMessage to our own origin to prevent token theft.
              // Note: document.referrer points to Zoho Accounts after the redirect, which blocks delivery to the opener.
              const targetOrigin = window.location.origin;
              window.opener.postMessage(authResult, targetOrigin);
              console.log('Credentials posted to opener origin:', targetOrigin);
              setTimeout(() => {
                window.close();
              }, 1200);
            } else {
              // No opener (e.g., opened directly in a tab): show data for manual entry
              document.querySelector('.success-card').innerHTML = \`
                <div class="icon">✓</div>
                <h2>Connection Successful!</h2>
                <p>Your Zoho Books account has been linked. Return to the POS app — it will detect this connection automatically.</p>
                <p style="font-size:12px;color:#94a3b8;">If the app doesn't detect it, try closing this tab and clicking "Connect" in the POS app again.</p>
                <button onclick="window.close()" style="padding:10px 24px;border:none;border-radius:10px;background:#3b82f6;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Close this window</button>
              \`;
              // Also try to reach any open window on our origin via BroadcastChannel
              try {
                const bc = new BroadcastChannel('zoho_auth');
                bc.postMessage(authResult);
                bc.close();
              } catch(e) {}
            }
          </script>
        </body>
        </html>
      `);
    } else {
      throw new Error(response.data.error || 'Failed to exchange credentials from code');
    }
  } catch (error) {
    console.error('Error in OAuth callback exchange:', error.message);
    const errorHtml = `<!DOCTYPE html><html><head><title>Connection Error</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&display=swap" rel="stylesheet">
      <style>body{font-family:'Inter',sans-serif;background:#fef2f2;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;}
      .err{background:#fff;padding:32px;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.08);text-align:center;max-width:380px;border:1px solid #fecaca;}
      h2{color:#b91c1c;font-size:18px;margin:0 0 8px;} p{color:#64748b;font-size:13px;line-height:1.5;margin:0 0 16px;}
      .btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:8px;background:#ef4444;color:#fff;font-size:13px;font-weight:600;cursor:pointer;}</style></head>
      <body><div class="err"><h2>Connection Failed</h2>
      <p>${error.message.includes('redirect_uri') ? 'The redirect URI does not match what is configured in the Zoho API Console. Please verify the Authorized Redirect URI in your Zoho API Console settings.' : error.message}</p>
      <button class="btn" onclick="window.close()"><i class="fa-solid fa-xmark"></i> Close</button>
      </div></body></html>`;
    res.status(500).send(errorHtml);
  }
});

/**
 * POST /api/auth/disconnect
 * Dynamic client session disconnection
 */
app.post('/api/auth/disconnect', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    await safeUpsertConfig(catalystApp, 'last_connected_org', '');
    res.status(200).json({ success: true, message: 'Successfully disconnected Zoho session' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   USER MANAGEMENT — INVITE, OTP, LOGIN
   ========================================================================== */

/**
 * GET /api/users
 * List all registered users
 */
app.get('/api/users', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Roster merge lives in readUserRoster() (shared with /api/admin/*).
    const users = await readUserRoster(catalystApp, orgUserContext);
    res.status(200).json({ success: true, users });
  } catch (error) {
    res.status(200).json({ success: true, users: [] });
  }
});

/**
 * POST /api/users/delete
 * Remove a user
 */
app.post('/api/users/delete', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    // USR-03: legacy removal path — Admin only (prefer /api/admin/users/:id).
    if (!requirePermission(orgUserContext, res, 'delete_users', 'Removing users requires Admin. Use Administration → Users.')) return;
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'Email required' });
    const meLegacy = String(orgUserContext.user.email || orgUserContext.user.email_id || '').toLowerCase();
    if (String(email).toLowerCase() === meLegacy) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account.' });
    }

    const target = String(email).trim();
    const userKey = rosterKey(target);
    // Older clients still call this endpoint when their first request to the
    // admin lifecycle API is a 404. Keep that fallback complete: remove every
    // duplicate roster row, revoke OrgUsers, then best-effort delete the
    // matching Catalyst Authentication login just like DELETE /api/admin/users.
    const result = await safeZcql(catalystApp,
      `SELECT ROWID FROM Configurations WHERE config_key = '${sanitizeZcql(userKey)}' LIMIT 300`
    );
    const table = catalystApp.datastore().table('Configurations');
    for (const row of (result || [])) {
      try { await table.deleteRow(row.Configurations.ROWID); } catch (e) { /* continue removing duplicate rows */ }
    }
    await deleteOrgUserRows(catalystApp, target);
    const authOutcome = await removeCatalystAuthLogin(catalystApp, target);
    const roleMessage = `User '${target}' deleted. Role record revoked.`;
    const message = authOutcome.auth_removed
      ? `${roleMessage} Login account removed.`
      : `${roleMessage} Login account still exists (${authOutcome.auth_detail}) — remove it in console Authentication.`;
    res.status(200).json({ success: true, message, auth_removed: authOutcome.auth_removed, auth_detail: authOutcome.auth_detail });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/users/update-role
 * Update a user's role and permissions
 */
app.post('/api/users/update-role', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    // USR-02/03: Storekeeper was wrongly rejected here (400); Managers
    // cannot grant Admin or modify Admin accounts (prefer change-role API).
    if (!requirePermission(orgUserContext, res, 'manage_users', 'Changing roles requires Admin or Manager.')) return;
    const { role } = req.body || {};
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !role) return res.status(400).json({ success: false, error: 'Email and role are required' });

    const validRoles = [...POS_ALL_ROLES];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }
    if (callerRole(orgUserContext) !== 'Admin') {
      const target = await findRosterUser(catalystApp, email);
      const targetRole = target ? String(target.data.role || 'Cashier') : 'Cashier';
      if (targetRole === 'Admin' || targetRole === 'master_admin' || role === 'Admin') {
        return res.status(403).json({ success: false, error: 'Only Admins can grant or modify the Admin role.' });
      }
    }

    const userKey = `user_${email.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const result = await safeZcql(catalystApp, `SELECT ROWID, config_value FROM Configurations WHERE config_key = '${userKey}'`);

    let userData;
    if (!result || result.length === 0) {
      const adopted = await adoptRosterUser(catalystApp, String(email).trim().toLowerCase());
      if (!adopted) return res.status(404).json({ success: false, error: 'User not found' });
      userData = adopted.data;
    } else {
      userData = JSON.parse(result[0].Configurations.config_value);
    }
    if (normWhRole(userData.role) === 'Admin' && role !== 'Admin' && String(userData.status || 'active') !== 'inactive') {
      if (await countActiveAdmins(catalystApp, orgUserContext) <= 1) {
        return res.status(400).json({ success: false, error: 'Assign another Admin before changing the last active Admin.' });
      }
    }
    userData.role = role;
    userData.permissions = getRolePermissions(role);
    userData.updated_at = Date.now();
    await safeUpsertConfig(catalystApp, userKey, JSON.stringify(userData));
    await syncOrgUserRole(catalystApp, String(email).trim().toLowerCase(), role, {
      orgId: orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '',
      displayName: String(userData.name || String(email).trim().toLowerCase()),
    });

    res.status(200).json({ success: true, message: `Role updated to ${role}`, user: userData });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Returns the permissions object for a given role
 */
function getRolePermissions(role) {
  const perms = {
    Admin: {
      refund: true, reconcile: true, adjust_inventory: true,
      manage_users: true, view_reports: true, system_settings: true,
      zoho_books: 'full', zoho_invoice: 'full', zoho_inventory: 'full', zoho_mail: 'full'
    },
    Manager: {
      refund: true, reconcile: true, adjust_inventory: true,
      manage_users: false, view_reports: true, system_settings: false,
      zoho_books: 'view', zoho_invoice: 'create_view', zoho_inventory: 'view', zoho_mail: 'none'
    },
    Cashier: {
      refund: false, reconcile: true, adjust_inventory: false,
      manage_users: false, view_reports: false, system_settings: false,
      zoho_books: 'none', zoho_invoice: 'none', zoho_inventory: 'none', zoho_mail: 'none'
    },
    Storekeeper: {
      refund: false, reconcile: true, adjust_inventory: true,
      manage_users: false, view_reports: true, system_settings: false,
      zoho_books: 'none', zoho_invoice: 'none', zoho_inventory: 'view', zoho_mail: 'none'
    },
    Waiter: {
      refund: false, reconcile: false, adjust_inventory: false,
      manage_users: false, view_reports: false, system_settings: false,
      zoho_books: 'none', zoho_invoice: 'none', zoho_inventory: 'none', zoho_mail: 'none'
    },
    Chef: {
      refund: false, reconcile: false, adjust_inventory: false,
      manage_users: false, view_reports: false, system_settings: false,
      zoho_books: 'none', zoho_invoice: 'none', zoho_inventory: 'none', zoho_mail: 'none'
    }
  };
  const r = normWhRole(role);
  const result = perms[r] ? { ...perms[r] } : {};
  for (const permission of ['sell', 'manage_products', 'adjust_stock', 'manage_inventory', 'view_reports', 'manage_users', 'manage_settings']) {
    result[permission] = roleCan(r, permission);
  }
  result.system_settings = result.manage_settings;
  result.adjust_inventory = result.adjust_stock;
  return result;
}

/**
 * GET /api/organization
 * Fetch detailed organization profile from Zoho Books for the active tenant
 */
app.get('/api/organization', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const tenantConfig = getTenantConfig(req);
    const booksService = new ZohoBooksService(catalystApp, tenantConfig);

    if (!tenantConfig || !tenantConfig.orgId) {
      return res.status(400).json({ success: false, error: 'No active Zoho Books organization connected.' });
    }

    const headers = await booksService.getHeaders();
    const dc = tenantConfig.dc || 'US';
    const domains = booksService.getDomainUrls(dc);
    const url = `${domains.api}/organizations/${tenantConfig.orgId}?organization_id=${tenantConfig.orgId}`;

    const response = await axios.get(url, { headers });
    if (response.data && response.data.code === 0 && response.data.organization) {
      const org = response.data.organization;
      res.status(200).json({
        success: true,
        organization: {
          organization_id: org.organization_id,
          name: org.name,
          email: org.email,
          phone: org.phone,
          currency_code: org.currency_code,
          currency_symbol: org.currency_symbol,
          time_zone: org.time_zone,
          date_format: org.date_format,
          plan_name: org.plan_name,
          company_name: org.company_name,
          address: org.address,
          country: org.country,
          fiscal_year_start_month: org.fiscal_year_start_month,
          tax_reg_no: org.tax_reg_no
        }
      });
    } else {
      throw new Error(response.data.message || 'Failed to fetch organization');
    }
  } catch (error) {
    console.error('Error fetching organization details:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   PRODUCTS & SALES ENDPOINTS WITH TENANT ISOLATION
   ========================================================================== */

/**
 * GET /api/sync/diagnose
 * Diagnostic endpoint — checks Books API connectivity and tests each module.
 */
app.get('/api/sync/diagnose', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const tenantConfig = getTenantConfig(req);
    const booksService = new ZohoBooksService(catalystApp, tenantConfig);
    const orgId = tenantConfig ? tenantConfig.orgId : 'not set';
    const dc = tenantConfig ? tenantConfig.dc : 'not set';

    const diagnosis = { orgId, dc, steps: [] };

    // Step 1: Get headers
    let headers;
    try {
      headers = await booksService.getHeaders();
      diagnosis.steps.push({ name: 'Auth Token', status: 'OK', prefix: headers.Authorization ? headers.Authorization.substring(0, 25) + '...' : 'none' });
    } catch (err) {
      diagnosis.steps.push({ name: 'Auth Token', status: 'FAILED', error: err.message });
      return res.status(200).json({ success: false, diagnosis });
    }

    // Step 2: Test Organizations API
    try {
      const domains = booksService.getDomainUrls(dc);
      const url = `${domains.api}/organizations?organization_id=${orgId}`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      diagnosis.steps.push({ name: 'GET /organizations', status: 'OK', code: response.data.code, count: response.data.organizations ? response.data.organizations.length : 0 });
    } catch (err) {
      const msg = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).substring(0, 200)}` : err.message;
      diagnosis.steps.push({ name: 'GET /organizations', status: 'FAILED', error: msg });
    }

    // Step 3: Test Items API
    try {
      const domains = booksService.getDomainUrls(dc);
      const url = `${domains.api}/items?organization_id=${orgId}&status=active`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      diagnosis.steps.push({ name: 'GET /items', status: 'OK', code: response.data.code, count: response.data.items ? response.data.items.length : 0 });
    } catch (err) {
      const msg = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).substring(0, 200)}` : err.message;
      diagnosis.steps.push({ name: 'GET /items', status: 'FAILED', error: msg });
    }

    // Step 4: Test Contacts API
    try {
      const domains = booksService.getDomainUrls(dc);
      const url = `${domains.api}/contacts?organization_id=${orgId}`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      diagnosis.steps.push({ name: 'GET /contacts', status: 'OK', code: response.data.code, count: response.data.contacts ? response.data.contacts.length : 0 });
    } catch (err) {
      const msg = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).substring(0, 200)}` : err.message;
      diagnosis.steps.push({ name: 'GET /contacts', status: 'FAILED', error: msg });
    }

    // Step 5: Test Invoices API
    try {
      const domains = booksService.getDomainUrls(dc);
      const url = `${domains.api}/invoices?organization_id=${orgId}`;
      const response = await axios.get(url, { headers, timeout: 10000 });
      diagnosis.steps.push({ name: 'GET /invoices', status: 'OK', code: response.data.code, count: response.data.invoices ? response.data.invoices.length : 0 });
    } catch (err) {
      const msg = err.response ? `HTTP ${err.response.status}: ${JSON.stringify(err.response.data).substring(0, 200)}` : err.message;
      diagnosis.steps.push({ name: 'GET /invoices', status: 'FAILED', error: msg });
    }

    res.status(200).json({ success: true, diagnosis });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/items
 * Retrieve local products cached in Catalyst Data Store.
 * Single-tenant: fetches ALL products (no org_id column in current schema).
 */
app.get('/api/items', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // Full column list (PROD-02/05/07 integrity: cost, reorder, status,
    // multi-category links and image refs must round-trip, not reset to
    // defaults on read). New columns fall back gracefully on deployments
    // created before they were provisioned.
    let queryResult;
    try {
      queryResult = await catalystApp.zcql().executeZCQLQuery(
        'SELECT ROWID, books_item_id, name, rate, sku, tax_id, tax_percentage, stock, category, category_id, category_ids, cost_price, reorder_level, status, barcode, unit, description, image_id, image_name, image_mime FROM Products LIMIT 300'
      );
    } catch (fullErr) {
      queryResult = await catalystApp.zcql().executeZCQLQuery(
        'SELECT ROWID, books_item_id, name, rate, sku, tax_id, tax_percentage, stock, category, category_id FROM Products LIMIT 300'
      );
    }

    // Resolve display names from the Categories table (single lookup).
    // Missing table or unlinked rows fall back to legacy Products.category text.
    let catNameById = new Map();
    try {
      const catRows = await safeZcql(catalystApp, `SELECT ROWID, name FROM Categories`);
      for (const r of (catRows || [])) {
        const c = r.Categories;
        if (c && c.name) catNameById.set(String(c.ROWID), String(c.name));
      }
    } catch (e) { /* Categories table may not exist yet */ }

    const products = queryResult.map(row => {
      const it = row.Products;
      const linked = it.category_id !== undefined && it.category_id !== null && String(it.category_id) !== ''
        ? catNameById.get(String(it.category_id))
        : undefined;
      const ids = parseCategoryIds(it.category_ids);
      const out = {
        ...it,
        category_name: linked || it.category || 'General',
        category_ids: ids.length > 0 ? ids : (it.category_id ? [String(it.category_id)] : []),
      };
      out.category_names = out.category_ids
        .map((id) => catNameById.get(String(id)))
        .filter((n) => n !== undefined && n !== '');
      if (out.image_id) out.image_url = `/api/items/${it.ROWID}/image`;
      return out;
    });
    res.status(200).json({ success: true, count: products.length, data: products });
  } catch (error) {
    console.error('Error fetching local products:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to retrieve local products.' });
  }
});

/**
 * POST /api/sync/books
 * Pull items and sync them from Zoho Books to Catalyst Data Store under active org_id
 */
app.post('/api/sync/books', async (req, res) => {
  console.log('[SYNC] POST /api/sync/books hit');
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_products', 'Books sync requires Admin or Manager.')) return;

    const { orgUser, org } = orgUserContext;
    const posOrgId = orgUser.org_id;

    const headerConfig = getTenantConfig(req);
    const tenantConfig = {
      ...headerConfig,
      posOrgId: posOrgId,
      orgId: headerConfig ? headerConfig.orgId : org.zoho_books_org_id,
      dc: headerConfig ? headerConfig.dc : 'com'
    };

    console.log('[SYNC] Resolved multi-tenant configuration:', JSON.stringify({ posOrgId: tenantConfig.posOrgId, orgId: tenantConfig.orgId, dc: tenantConfig.dc }));

    const orgId = posOrgId;
    const dc = tenantConfig.dc || 'com';

    let headers;
    try {
      headers = await new ZohoBooksService(catalystApp, tenantConfig).getHeaders();
      console.log('[SYNC] Got headers, Auth:', headers.Authorization ? headers.Authorization.substring(0, 30) + '...' : 'NONE');
    } catch (headerErr) {
      console.error('[SYNC] getHeaders() failed:', headerErr.message, headerErr.stack);
      return res.status(500).json({ success: false, error: `HeaderError: ${headerErr.message}` });
    }
    
    const domains = { 
      'US': { api: 'https://www.zohoapis.com/books/v3' },
      'EU': { api: 'https://www.zohoapis.eu/books/v3' },
      'IN': { api: 'https://www.zohoapis.in/books/v3' },
      'AU': { api: 'https://www.zohoapis.com.au/books/v3' },
      'JP': { api: 'https://www.zohoapis.co.jp/books/v3' }
    };
    const apiBase = (domains[dc.toUpperCase()] || domains['US']).api;
    const apiUrl = `${apiBase}/items?organization_id=${orgId}&status=active`;
    console.log('[SYNC] Calling:', apiUrl);

    // axios is required at top of file; using that reference
    let response;
    try {
      response = await axios.get(apiUrl, { headers, timeout: 30000 });
    } catch (apiErr) {
      const errData = apiErr.response ? apiErr.response.data : null;
      const errMsg = errData ? (errData.message || JSON.stringify(errData)) : apiErr.message;
      console.error('[SYNC] Books API error:', errMsg, apiErr.response ? `HTTP ${apiErr.response.status}` : 'no response');
      if (apiErr.config) {
        console.error('[SYNC] Request URL:', apiErr.config.url);
        console.error('[SYNC] Request Auth:', apiErr.config.headers ? apiErr.config.headers.Authorization : 'none');
      }
      return res.status(500).json({ success: false, error: `Zoho Books API: ${errMsg}` });
    }

    console.log('[SYNC] Books API code:', response.data.code, 'items:', response.data.items ? response.data.items.length : 0);
    
    if (!response.data || response.data.code !== 0) {
      return res.status(500).json({ success: false, error: `Zoho Books error: ${response.data.message}` });
    }

    const booksItems = response.data.items || [];
    console.log('[SYNC] Got', booksItems.length, 'items from Books. Syncing to datastore...');

    console.log(`[SYNC STEP 2] Accessing Products table in Datastore...`);
    const productsTable = catalystApp.datastore().table('Products');
    
    // Check if org_id column exists by trying a query with it
    let hasOrgIdColumn = true;
    let existingResult = [];
    try {
      existingResult = await catalystApp.zcql().executeZCQLQuery(
        `SELECT ROWID, books_item_id FROM Products WHERE org_id = '${orgId}'`
      );
      console.log(`[SYNC STEP 2] OK — found ${existingResult.length} existing products with org_id`);
    } catch (colErr) {
      console.error(`[SYNC STEP 2] ZCQL query error:`, colErr.message);
      if (colErr.message && (colErr.message.includes('Unknown') || colErr.message.includes('org_id') || colErr.message.includes('No privileges'))) {
        hasOrgIdColumn = false;
        console.warn('[SYNC STEP 2] org_id column missing or no privileges — inserting without org_id');
        try {
          existingResult = await catalystApp.zcql().executeZCQLQuery(
            'SELECT ROWID, books_item_id FROM Products'
          );
          console.log(`[SYNC STEP 2] Fallback OK — found ${existingResult.length} existing products`);
        } catch (fallbackErr) {
          console.error(`[SYNC STEP 2] Fallback also failed:`, fallbackErr.message);
          existingResult = [];
        }
      } else {
        throw colErr;
      }
    }
    
    const existingMap = {};
    existingResult.forEach(row => {
      existingMap[row.Products.books_item_id] = row.Products.ROWID;
    });

    let inserted = 0;
    let updated = 0;
    let failed = 0;

    for (const item of booksItems) {
      const itemData = {
        books_item_id: item.item_id,
        name: item.name,
        rate: parseFloat(item.rate) || 0.0,
        sku: item.sku || '',
        tax_id: item.tax_id || '',
        tax_percentage: parseFloat(item.tax_percentage) || 0.0,
        stock: parseFloat(item.stock_on_hand) || 999.0,
        category: item.category || 'General'
      };

      // Only include org_id if the column exists
      if (hasOrgIdColumn) {
        itemData.org_id = orgId;
      }

      if (existingMap[item.item_id]) {
        const rowId = existingMap[item.item_id];
        try {
          // Preserve the curated taxonomy on update: Books is not the
          // system of record for categories, so a sync must never rewrite
          // the linked category_id or its synced display text (doing so
          // creates divergent id/text pairs that surface as wrong
          // categories in the UI).
          const { category, category_id, ...syncFields } = itemData;
          await productsTable.updateRow({ ROWID: rowId, ...syncFields });
          updated++;
        } catch (updateErr) {
          failed++;
          console.error(`[SYNC] updateRow failed for '${item.name}': ${updateErr.message}`);
          // If update fails (e.g. org_id column issue), try without it
          if (hasOrgIdColumn && updateErr.message && updateErr.message.includes('org_id')) {
            try {
              const { org_id, ...itemDataNoOrg } = itemData;
              await productsTable.updateRow({ ROWID: rowId, ...itemDataNoOrg });
              updated++;
              failed--;
            } catch (e) {
              console.error(`[SYNC] updateRow fallback also failed for '${item.name}': ${e.message}`);
            }
          }
        }
      } else {
        try {
          await productsTable.insertRow(itemData);
          inserted++;
        } catch (insertErr) {
          failed++;
          console.error(`[SYNC] insertRow failed for '${item.name}': ${insertErr.message}`);
          // If insert fails (e.g. org_id column issue), try without it
          if (hasOrgIdColumn && insertErr.message && insertErr.message.includes('org_id')) {
            try {
              const { org_id, ...itemDataNoOrg } = itemData;
              await productsTable.insertRow(itemDataNoOrg);
              inserted++;
              failed--;
            } catch (e) {
              console.error(`[SYNC] insertRow fallback also failed for '${item.name}': ${e.message}`);
            }
          }
        }
      }
    }

    const syncMsg = failed > 0
      ? `Synced ${inserted + updated} of ${booksItems.length} items (${failed} failed)`
      : `Sync with Zoho Books complete!`;

    // SET-05: last-sync stamp for the integration health card.
    try {
      await safeUpsertConfig(catalystApp, 'last_books_sync_at', formatCatalystDateTime(new Date()));
      await safeUpsertConfig(catalystApp, 'last_books_sync_result', syncMsg);
    } catch (e) { /* stamp is best-effort */ }

    res.status(200).json({
      success: true,
      message: syncMsg,
      items: booksItems.map(item => ({
        books_item_id: item.item_id,
        name: item.name,
        rate: parseFloat(item.rate) || 0.0,
        sku: item.sku || '',
        tax_id: item.tax_id || '',
        tax_percentage: parseFloat(item.tax_percentage) || 0.0,
        stock: parseFloat(item.stock_on_hand) || 999.0,
        category: item.category || 'General'
        // NOTE: no `industry` field here on purpose. Books items are real inventory,
        // not a demo preset — they should show under whichever industry template is
        // active. The catalog grid filter treats a missing `industry` as "show always".
      })),
      summary: {
        total_fetched: booksItems.length,
        inserted: inserted,
        updated: updated,
        failed: failed
      }
    });
  } catch (error) {
    console.error('Error syncing items with Zoho Books:', error);

    // SET-04/05: stamp the failure and alert (best-effort, preference-gated).
    try {
      const failApp = catalyst.initialize(req);
      const rawMsg = error.response ? JSON.stringify(error.response.data) : error.message;
      await safeUpsertConfig(failApp, 'last_books_sync_at', formatCatalystDateTime(new Date()));
      await safeUpsertConfig(failApp, 'last_books_sync_result', `Failed: ${String(rawMsg).slice(0, 200)}`);
      const failCtx = await getCurrentOrgUser(req, failApp).catch(() => null);
      const failOrgId = failCtx && failCtx.orgUser ? String(failCtx.orgUser.org_id || '') : '';
      const prefs = await getNotificationSettings(failApp, failOrgId);
      if (prefs.books_sync_fail.enabled && prefs.books_sync_fail.channels.includes('email')) {
        const to = alertRecipients(prefs, 'books_sync_fail');
        if (to.length > 0) {
          await sendSmtpMail(failApp, {
            to: to.join(','),
            subject: 'Zoho Books sync failed',
            html: `<p>Catalog sync failed: <strong>${escHtml(String(rawMsg).slice(0, 300))}</strong></p><p>CloudHub POS · Integration alert</p>`,
            text: `Zoho Books sync failed: ${String(rawMsg).slice(0, 300)}`,
          });
        }
      }
    } catch (e) { /* alerting is best-effort */ }

    // Log the FULL raw error from Zoho Books for debugging
    const rawError = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('RAW ZOHO ERROR:', rawError);
    
    // Also log which URL/token was used
    if (error.config) {
      console.error('REQUEST URL:', error.config.url);
      console.error('REQUEST AUTH:', error.config.headers ? error.config.headers.Authorization : 'none');
    }
    
    res.status(500).json({ 
      success: false, 
      error: rawError,
      message: 'Sync failed — raw Zoho Books error above'
    });
  }
});

/**
 * POST /api/orders
 * Check out a POS transaction, submitting invoice to Zoho Books and saving order (single-tenant).
 */
app.post('/api/orders', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { orgUser, org } = orgUserContext;
    const posOrgId = orgUser.org_id;

    const headerConfig = getTenantConfig(req);
    const tenantConfig = {
      ...headerConfig,
      posOrgId: posOrgId,
      orgId: headerConfig ? headerConfig.orgId : org.zoho_books_org_id,
      dc: headerConfig ? headerConfig.dc : 'com'
    };
    const booksService = new ZohoBooksService(catalystApp, tenantConfig);
    const orgId = posOrgId;

    const {
      customer_name,
      customer_email,
      payment_mode,
      room_number,
      kitchen_notes,
      line_items,
      invoice_number,
      local_ref,
      discount_pct,
      payments,
      tendered,
      email_receipt,
      receipt_email
    } = req.body;

    // USR-03: only selling roles may check out (Storekeeper/Chef blocked).
    if (!requirePermission(orgUserContext, res, 'sell', 'Checkout requires a selling role (Admin, Manager, Cashier or Waiter).')) return;
    if (!line_items || line_items.length === 0) {
      return res.status(400).json({ success: false, error: 'Checkout failed: Cart is empty.' });
    }

    // ---- Canonical totals (POS-05 line discounts + order discount) ----
    // SET-02: tax mode, rounding and default rate come from Tax settings.
    // Exclusive (default) math is byte-identical to the legacy path.
    const taxCfg = await getTaxSettings(catalystApp, posOrgId);
    const taxOpts = { mode: taxCfg.enabled ? taxCfg.mode : 'exclusive', round: taxCfg.round };
    const normLines = line_items.map((raw) => {
      // Lines without an explicit rate inherit the default (0 stays exempt;
      // disabled tax forces 0 everywhere).
      const effTax = !taxCfg.enabled
        ? 0
        : (raw.tax_percentage === undefined || raw.tax_percentage === null || raw.tax_percentage === ''
          ? taxCfg.default_rate
          : raw.tax_percentage);
      return posNormalizeLine({ ...raw, tax_percentage: effTax }, taxOpts);
    });
    const orderPct = posClampPct(discount_pct);
    const calc = posTotalsFor(normLines, orderPct, taxOpts);

    // ---- Payment validation (POS-11): tendered must equal the total ----
    let payList = [];
    if (payments !== undefined && payments !== null) {
      if (!Array.isArray(payments) || payments.length === 0) {
        return res.status(400).json({ success: false, error: 'Checkout failed: payment breakdown is empty.' });
      }
      payList = payments.map((p) => ({
        mode: String(p.mode || '').trim(),
        amount: posRound2(p.amount),
      }));
      for (const p of payList) {
        if (!POS_PAY_MODES.includes(p.mode)) {
          return res.status(400).json({ success: false, error: `Checkout failed: unsupported payment mode "${p.mode}".` });
        }
        if (!(p.amount > 0)) {
          return res.status(400).json({ success: false, error: `Checkout failed: payment amount for ${p.mode} must be positive.` });
        }
      }
    }
    const paidTotal = payList.length > 0
      ? posRound2(payList.reduce((s, p) => s + p.amount, 0))
      : posRound2(tendered);
    if (Math.abs(paidTotal - calc.total) > 0.015) {
      return res.status(400).json({
        success: false,
        error: `Checkout failed: payment total (${paidTotal.toFixed(2)}) does not match order total (${calc.total.toFixed(2)}).`,
      });
    }
    const effectiveMode = payList.length > 1
      ? 'Split'
      : (payList.length === 1 ? payList[0].mode : (POS_PAY_MODES.includes(payment_mode) ? payment_mode : 'Cash'));
    if (payList.length === 0) {
      payList = [{ mode: effectiveMode, amount: calc.total }];
    }
    // SET-05: only enabled tender methods may settle an order.
    try {
      const tenderCfg = await getPaymentMethods(catalystApp, posOrgId);
      const enabledModes = new Set(tenderCfg.filter((m) => m.enabled).map((m) => m.mode));
      for (const p of payList) {
        if (!enabledModes.has(p.mode)) {
          return res.status(400).json({ success: false, error: `Checkout failed: payment method "${p.mode}" is disabled (see Settings → Payment methods).` });
        }
      }
    } catch (e) { /* tender config is best-effort; static modes already validated */ }

    // ---- Stock validation (POS-10): every line must be sellable ----
    // Resolves each line to its live Products row: missing → 400,
    // non-Active status → 400, insufficient stock → 400. Nothing is
    // written until ALL lines pass, so a failed checkout leaves no trace.
    const productsTable = catalystApp.datastore().table('Products');
    const resolvedLines = [];
    for (const line of normLines) {
      const live = await resolveProductForSale(catalystApp, line);
      if (!live) {
        return res.status(400).json({ success: false, error: `Checkout failed: product not found for "${line.name || line.item_id || 'line item'}".` });
      }
      const status = String(live.status ?? 'Active');
      if (status !== '' && status !== 'Active') {
        return res.status(400).json({ success: false, error: `Checkout failed: "${live.name}" is ${status} and cannot be sold.` });
      }
      const onHand = Number(live.stock) || 0;
      if (onHand < line.qty) {
        return res.status(400).json({ success: false, error: `Checkout failed: insufficient stock for "${live.name}" (need ${line.qty}, have ${onHand}).` });
      }
      resolvedLines.push({ line, live, onHand });
    }

    // Append table/room number to customer name for database compatibility and clarity
    let finalCustomerName = customer_name || 'Walk-in Guest';
    if (room_number) {
      finalCustomerName += ` (${room_number})`;
    }
    const finalEmail = customer_email || 'walkin@pos.system';

    let invoiceId = 'OFFLINE-' + Date.now();
    let invoiceNumber = 'OFFLINE-' + Math.floor(1000 + Math.random() * 9000);
    let booksCustomerId = 'OFFLINE-CUST';
    // Books records a single settlement mode: use the first payment leg.
    // Local totals (plus the full split ledger) remain the source of truth.
    const booksPayMode = payList.length > 0 ? payList[0].mode : payment_mode;
    let immediatePayment = ['Cash', 'Card', 'UPI'].includes(booksPayMode);
    let paymentRecorded = false;
    let paymentId = null;

    // Check if we are connected to Zoho Books (we have tenant headers)
    if (orgId) {
      try {
        // 1. Resolve Customer in Zoho Books
        console.log('Resolving customer in Zoho Books...');
        const booksCustomer = await booksService.getOrCreateCustomer(finalCustomerName, finalEmail);
        booksCustomerId = booksCustomer.contact_id;

        // 2. Create Invoice in Zoho Books
        const roomNote = room_number ? `${room_number}${kitchen_notes ? ' | Note: ' + kitchen_notes : ''}` : kitchen_notes;
        console.log(`Creating Zoho Books Invoice for customer ${booksCustomerId}...`);
        const booksInvoice = await booksService.createInvoice(booksCustomerId, line_items, booksPayMode, roomNote);
        invoiceId = booksInvoice.invoice_id;
        invoiceNumber = booksInvoice.invoice_number;

        // 3. Record immediate payments in Books
        if (immediatePayment) {
          console.log(`Recording payment for invoice ${invoiceId}...`);
          const booksPayment = await booksService.recordPayment(booksCustomerId, invoiceId, booksInvoice.total, booksPayMode);
          paymentId = booksPayment.payment_id;
          paymentRecorded = true;
        }
      } catch (zohoError) {
        console.warn('Failed to submit order directly to Zoho Books. Saving completed local order...', zohoError.message);
      }
    }

    // 4. Canonical totals (validated above; Books flow keeps gross lines).
    const { subtotal, taxAmount, orderDisc, total } = calc;

    // 5. Save locally in Catalyst Data Store
    const ordersTable = catalystApp.datastore().table('Orders');
    const orderItemsTable = catalystApp.datastore().table('OrderItems');

    console.log('Writing POS transaction to Catalyst Data Store...');
    // ORD-04 cashier attribution (best-effort columns; older deployments
    // without cashier_name/created_by keep working via the retry below).
    let cashierName = '';
    let cashierEmail = '';
    try {
      const u = orgUserContext && orgUserContext.user ? orgUserContext.user : null;
      cashierEmail = u ? String(u.email || u.email_id || '') : '';
      const orgU = orgUserContext && orgUserContext.orgUser ? orgUserContext.orgUser : null;
      cashierName = orgU && orgU.display_name
        ? String(orgU.display_name)
        : (u ? [u.first_name, u.last_name].filter(Boolean).join(' ') || cashierEmail : '');
    } catch (e) { /* attribution is best-effort */ }
    const orderPayload = {
      customer_name: finalCustomerName,
      customer_email: finalEmail,
      subtotal: subtotal,
      tax_amount: taxAmount,
      total: total,
      payment_mode: effectiveMode,
      status: orgId && !invoiceId.startsWith('OFFLINE') ? 'Synced' : 'Completed',
      books_invoice_id: invoiceId,
      invoice_number: invoiceNumber || invoice_number || '',
      local_ref: local_ref || ''
    };
    let orderRow;
    try {
      orderRow = await ordersTable.insertRow({ ...orderPayload, cashier_name: cashierName, created_by: cashierEmail });
    } catch (e) {
      // Columns not provisioned yet — legacy shape still records the sale.
      orderRow = await ordersTable.insertRow(orderPayload);
    }

    const localOrderId = orderRow.ROWID;

    for (const line of normLines) {
      const base = {
        order_id: localOrderId,
        item_id: line.books_item_id || line.item_id,
        quantity: line.qty,
        rate: line.rate,
      };
      try {
        await orderItemsTable.insertRow({ ...base, discount_value: line.lineDisc > 0 ? line.lineDisc : 0, discount_type: line.discType });
      } catch (lineErr) {
        // Older deployments whose OrderItems table lacks discount columns.
        await orderItemsTable.insertRow(base);
      }
    }

    // 5b. Payment ledger (POS-08, best-effort: derive from order if missing).
    try {
      const paymentsTable = catalystApp.datastore().table('Payments');
      for (const p of payList) {
        await paymentsTable.insertRow({ order_id: localOrderId, mode: p.mode, amount: p.amount });
      }
    } catch (payErr) {
      console.warn('Payments ledger unavailable, continuing with order row:', payErr.message);
    }

    // 6. Inventory deduction + SALE movements (POS-10).
    // Stock was validated above; each line decrements and logs atomically
    // per line through the single logStockMovement() write path.
    let performedBy = '';
    try {
      const me = await getCurrentOrgUser(req, catalystApp);
      const email = me && me.user && (me.user.email || me.user.email_id);
      if (email) performedBy = String(email);
    } catch (e) { /* audit identity is best-effort */ }
    let movementsLogged = 0;
    for (const { line, live, onHand } of resolvedLines) {
      const newStock = Math.max(0, posRound2(onHand - line.qty));
      await productsTable.updateRow({ ROWID: live.ROWID, stock: newStock });
      const movementId = await logStockMovement(catalystApp, {
        itemRowid: live.ROWID,
        sku: live.sku,
        itemName: live.name,
        movementType: 'SALE',
        quantityChange: -line.qty,
        stockBefore: onHand,
        stockAfter: newStock,
        referenceType: 'POS_ORDER',
        referenceId: String(localOrderId),
        reason: 'POS Checkout',
        performedBy,
      });
      if (movementId !== null) movementsLogged += 1;
      // Phase 2 mirror (best-effort): keep default WarehouseStock in step
      // so SUM(WarehouseStock.quantity) stays equal to Products.stock.
      try {
        await mirrorDeltaToDefaultWarehouse(catalystApp, live.ROWID, -line.qty);
      } catch (e) { /* warehouse mirror is best-effort */ }
    }

    // 6b. Loyalty accrual (CUST-05, best-effort: never blocks checkout).
    let loyaltyAwarded = 0;
    try {
      loyaltyAwarded = await accrueLoyaltyForOrder(catalystApp, orgUserContext, {
        customerName: finalCustomerName,
        customerEmail: finalEmail,
        orderTotal: total,
        orderId: localOrderId,
        performedBy,
      });
    } catch (e) { console.warn('[LOYALTY] Accrual skipped:', e.message); }

    // 6c. Print jobs (KOT/print routing): station split + KOT numbers + log.
    // Best-effort: checkout never fails because printing cannot be planned.
    let checkoutKots = [];
    try {
      const routing = await getPrintRouting(catalystApp, posOrgId);
      const stationMap = await productStationMap(catalystApp, resolvedLines.map((x) => x.live && x.live.ROWID));
      const groups = new Map();
      for (const { line, live } of resolvedLines) {
        const st = stationForLine(live, routing, stationMap);
        if (!groups.has(st)) groups.set(st, []);
        groups.get(st).push({
          name: line.name || (live && live.name) || 'Item',
          sku: line.sku || (live && live.sku) || '',
          qty: line.qty,
        });
      }
      for (const [station, items] of groups.entries()) {
        if (station === 'counter') continue;
        checkoutKots.push({
          kotNumber: await allocKotNumber(catalystApp, posOrgId),
          station,
          items,
          orderId: String(localOrderId),
          invoiceNumber: String(invoiceNumber || invoice_number || ''),
          customerName: finalCustomerName,
          roomNumber: String(room_number || ''),
          kitchenNotes: String(kitchen_notes || ''),
          cashier: cashierName,
          firedAt: new Date().toISOString(),
        });
      }
      if (checkoutKots.length > 0) {
        await appendKotLog(catalystApp, posOrgId, checkoutKots.map((k) => ({
          number: k.kotNumber, orderId: k.orderId, station: k.station,
          status: 'FIRED', lines: k.items.length, firedAt: k.firedAt,
        })));
      }
    } catch (e) {
      console.warn('[KOT] Print planning skipped:', e.message);
      checkoutKots = [];
    }

    // 7. Receipt payload (POS-09) + optional email.
    const store = await getStoreProfile(catalystApp, posOrgId);
    let receiptLogo = '';
    try {
      receiptLogo = await getCompanyLogoDataUri(catalystApp, posOrgId);
    } catch (e) { /* logo optional */ }
    const receipt = {
      store,
      logo: receiptLogo,
      orderId: String(localOrderId),
      invoiceNumber: String(invoiceNumber || invoice_number || ''),
      booksInvoiceId: String(invoiceId),
      date: new Date().toISOString(),
      customerName: finalCustomerName,
      customerEmail: finalEmail,
      paymentMode: effectiveMode,
      payments: payList.map((p) => ({ mode: p.mode, amount: p.amount })),
      lines: normLines.map((l) => ({
        name: l.name, quantity: l.qty, rate: l.rate,
        discount: l.lineDisc, discountType: l.discType,
        lineTotal: posRound2(l.lineNet + l.lineTax),
      })),
      subtotal, tax: taxAmount, discount: orderDisc, total,
      tendered: paidTotal,
      change: posRound2(paidTotal - total),
    };
    let emailSent = false;
    const receiptEmail = String(receipt_email || '').trim();
    if (email_receipt === true && receiptEmail !== '' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(receiptEmail)) {
      emailSent = await sendReceiptEmail(catalystApp, receipt, receiptEmail);
    }

    // 7b. Bill job joins the KOT jobs (counter/kitchen/bar printers when set).
    const printerByStation = {};
    try {
      for (const p of await getPrinters(catalystApp, posOrgId)) {
        if (p.active && !printerByStation[p.station]) printerByStation[p.station] = p;
      }
    } catch (e) { /* bill prints wherever the terminal decides */ }
    const stationPrinter = (st) => printerByStation[st] || null;
    const counterPrinter = stationPrinter('counter');
    const printJobs = [
      {
        jobId: `bill-${localOrderId}`, template: 'bill', station: 'counter',
        printerId: counterPrinter ? counterPrinter.id : null,
        printerName: counterPrinter ? counterPrinter.name : 'Counter (default)',
        copies: 1, payload: { receipt },
      },
      ...checkoutKots.map((k) => {
        const printer = stationPrinter(k.station);
        return {
          jobId: `kot-${k.kotNumber}`, template: k.station === 'bar' ? 'bar' : 'kot',
          station: k.station, printerId: printer ? printer.id : null,
          printerName: printer ? printer.name : `${k.station} (default)`,
          copies: 1, payload: k,
        };
      }),
    ];

    res.status(200).json({
      success: true,
      message: orgId && !invoiceId.startsWith('OFFLINE')
        ? 'Checkout completed & synchronized successfully!'
        : 'Checkout completed and saved locally.',
      order: {
        local_order_id: localOrderId,
        customer_name: finalCustomerName,
        room_number: room_number || 'N/A',
        kitchen_notes: kitchen_notes || '',
        total: total,
        payment_mode: effectiveMode
      },
      payments: payList.map((p) => ({ mode: p.mode, amount: p.amount })),
      receipt,
      print_jobs: printJobs,
      kot_numbers: checkoutKots.map((k) => k.kotNumber),
      stock_deducted: true,
      movements_logged: movementsLogged,
      loyalty_awarded: loyaltyAwarded,
      email_sent: emailSent,
      zoho_books: {
        invoice_id: invoiceId,
        invoice_number: invoiceNumber,
        books_customer_id: booksCustomerId,
        payment_recorded: paymentRecorded,
        payment_id: paymentId
      }
    });

  } catch (error) {
    console.error('Error processing POS order checkout:', error);
    res.status(500).json({ success: false, error: error.message || 'POS Checkout failed.' });
  }
});

/**
 * GET /api/orders
 * Returns all past POS transactions (single-tenant, no org_id filter).
 */
app.get('/api/orders', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    // ORD-04: server-side filtering. The bounded history slice is read
    // once here on the server; every filter below runs before the
    // response is built, so the frontend never loads-and-filters.
    const filters = {
      status: String((req.query && req.query.status) || '').trim(),
      customer: String((req.query && req.query.customer) || '').trim(),
      cashier: String((req.query && req.query.cashier) || '').trim(),
      dateFrom: String((req.query && req.query.date_from) || '').trim(),
      dateTo: String((req.query && req.query.date_to) || '').trim(),
      paymentStatus: String((req.query && req.query.payment_status) || '').trim(),
      payment: String((req.query && (req.query.payment || req.query.payment_mode)) || '').trim(),
      search: String((req.query && req.query.search) || '').trim(),
      limit: Math.min(300, Math.max(1, parseInt((req.query && req.query.limit) || '100', 10) || 100)),
    };
    let history = await getOrderHistory(catalystApp, filters);
    // Frontline roles see only attributed sales belonging to their identity.
    const listRole = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (listRole === 'Cashier' || listRole === 'Waiter' || listRole === 'Chef') {
      const me = orgUserContext.user
        ? String(orgUserContext.user.email || orgUserContext.user.email_id || '').toLowerCase()
        : '';
      history = history.filter((o) => {
        const by = String(o.created_by ?? '').toLowerCase();
        return canReadOrder(listRole, me, by);
      });
    }
    res.status(200).json({ success: true, count: history.length, data: history });
  } catch (error) {
    console.error('Error fetching past orders:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to retrieve orders.' });
  }
});

/**
 * GET /api/orders/:id — complete order details (ORD-02).
 * Line items with product resolution, payment breakdown, derived
 * payment status, customer loyalty context, cashier attribution and
 * the stock-movement trail for the order.
 */
app.get('/api/orders/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const id = String(req.params.id || '').trim();
    if (!isDigitsId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid order ID.' });
    }
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    const detail = await getOrderDetails(catalystApp, orgId, id);
    if (!detail) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    // Cashier scoping (ORD permissions): cashiers see only their own sales.
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (role === 'Cashier' || role === 'Waiter' || role === 'Chef') {
      const me = orgUserContext.user ? String(orgUserContext.user.email || orgUserContext.user.email_id || '').toLowerCase() : '';
      const mine = String(detail.cashier.email || '').toLowerCase();
      if (!canReadOrder(role, me, mine)) {
        return res.status(403).json({ success: false, error: 'You can only view your own orders.' });
      }
    }
    res.status(200).json({ success: true, order: detail });
  } catch (error) {
    console.error('Error fetching order details:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Render a receipt object as printable HTML + plain text (POS-09).
 * Shared by the email endpoint; the checkout response carries the same
 * shape built from live cart data.
 */
function renderReceiptHtml(receipt, currencyCode) {
  const money = (n) => `${currencyCode} ${Number(n || 0).toFixed(2)}`;
  const esc = (v) => escHtml(v);
  const lineRows = receipt.lines.map((l) => {
    const disc = l.discount > 0
      ? ` <span style="color:#64748b;">(−${esc(money(l.discount))}${l.discountType === 'flat' ? '' : ' ' + esc(String(l.discountType))})</span>`
      : '';
    return `<tr><td style="padding:6px 0;border-bottom:1px solid #eef1f7;">${esc(l.name)}<br /><span style="color:#64748b;font-size:12px;">${Number(l.quantity)} × ${esc(money(l.rate))}${disc}</span></td>` +
      `<td align="right" style="padding:6px 0;border-bottom:1px solid #eef1f7;">${esc(money(l.lineTotal))}</td></tr>`;
  }).join('');
  const payRows = receipt.payments.map((p) => `<div>${esc(p.mode)}: ${esc(money(p.amount))}</div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8" />` +
    `<title>Receipt ${esc(receipt.invoiceNumber || receipt.orderId)} — ${esc(receipt.store.store_name || 'CloudHub POS')}</title></head>` +
    `<body style="margin:0;font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:24px 12px;">` +
    `<div style="max-width:420px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:28px 24px;">` +
    (receipt.logo ? `<img src="${receipt.logo}" alt="" style="max-height:64px;max-width:220px;margin-bottom:8px;" />` : '') +
    `<h1 style="font-size:18px;margin:0 0 2px;color:#0f1b33;">${esc(receipt.store.store_name || 'CloudHub POS')}</h1>` +
    (receipt.store.company ? `<p style="margin:0 0 4px;color:#64748b;font-size:13px;">${esc(receipt.store.company)}</p>` : '') +
    ([receipt.store.address, [receipt.store.phone, receipt.store.email].filter(Boolean).join(' · '), receipt.store.website].filter((s) => s && String(s).trim() !== '').map((s) => `<p style="margin:0 0 4px;color:#64748b;font-size:12px;">${esc(s)}</p>`).join('')) +
    `<p style="margin:0 0 4px;font-size:13px;"><strong>Invoice:</strong> ${esc(receipt.invoiceNumber || receipt.orderId)}</p>` +
    `<p style="margin:0 0 4px;font-size:13px;"><strong>Date:</strong> ${esc(receipt.date)}</p>` +
    `<p style="margin:0 0 12px;font-size:13px;"><strong>Customer:</strong> ${esc(receipt.customerName)}</p>` +
    `<table style="width:100%;border-collapse:collapse;font-size:13px;">${lineRows}</table>` +
    `<div style="margin-top:10px;font-size:13px;">` +
    `<div>Subtotal: ${esc(money(receipt.subtotal))}</div>` +
    `<div>Tax: ${esc(money(receipt.tax))}</div>` +
    `<div>Discount: −${esc(money(receipt.discount))}</div>` +
    `<div style="font-size:16px;font-weight:bold;margin-top:4px;">Total: ${esc(money(receipt.total))}</div>` +
    `<div style="margin-top:6px;color:#475569;">${payRows}</div></div>` +
    `<p style="margin:14px 0 0;font-size:12px;color:#64748B;">Thank you for shopping with us.</p>` +
    `</div></body></html>`;
}

function renderReceiptText(receipt, currencyCode) {
  const money = (n) => `${currencyCode} ${Number(n || 0).toFixed(2)}`;
  const out = [];
  out.push(receipt.store.store_name || 'CloudHub POS');
  if (receipt.store.company) out.push(receipt.store.company);
  out.push(`Invoice: ${receipt.invoiceNumber || receipt.orderId}`);
  out.push(`Date: ${receipt.date}`);
  out.push(`Customer: ${receipt.customerName}`);
  out.push('--------------------------------');
  for (const l of receipt.lines) {
    out.push(`${l.name}  ${l.quantity} x ${money(l.rate)} = ${money(l.lineTotal)}`);
    if (l.discount > 0) out.push(`  (discount ${money(l.discount)})`);
  }
  out.push('--------------------------------');
  out.push(`Subtotal: ${money(receipt.subtotal)}`);
  out.push(`Tax: ${money(receipt.tax)}`);
  out.push(`Discount: -${money(receipt.discount)}`);
  out.push(`TOTAL: ${money(receipt.total)}`);
  for (const p of receipt.payments) out.push(`${p.mode}: ${money(p.amount)}`);
  out.push('Thank you for shopping with us.');
  return out.join('\n');
}

/** Email a built receipt via the configured SMTP sender. Never throws. */
async function sendReceiptEmail(catalystApp, receipt, toEmail) {
  try {
    const currencyCode = receipt.store.currency || 'LKR';
    const ok = await sendSmtpMail(catalystApp, {
      to: toEmail,
      subject: `Receipt ${receipt.invoiceNumber || receipt.orderId} — ${receipt.store.store_name || 'CloudHub POS'}`,
      html: renderReceiptHtml(receipt, currencyCode),
      text: renderReceiptText(receipt, currencyCode),
    });
    return ok === true;
  } catch (err) {
    console.error('[RECEIPT] Email failed:', err.message);
    return false;
  }
}

/**
 * GET /api/orders/:id/receipt
 * Rebuild a sale receipt from stored rows (POS-09). Read-only.
 */
app.get('/api/orders/:id/receipt', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const orderId = String(req.params.id || '').trim();
    if (!/^[0-9]+$/.test(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order id.' });
    }
    const receipt = await buildReceiptData(catalystApp, orgUserContext.orgUser.org_id, orderId);
    if (!receipt) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    res.status(200).json({ success: true, receipt });
  } catch (error) {
    console.error('Error building receipt:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/orders/:id/email-receipt  { email }
 * Email the stored receipt via SMTP (POS-09). 404 when SMTP unconfigured.
 */
app.post('/api/orders/:id/email-receipt', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const orderId = String(req.params.id || '').trim();
    if (!/^[0-9]+$/.test(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order id.' });
    }
    const toEmail = String(req.body?.email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ success: false, error: 'A valid email address is required.' });
    }
    const receipt = await buildReceiptData(catalystApp, orgUserContext.orgUser.org_id, orderId);
    if (!receipt) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    const sent = await sendReceiptEmail(catalystApp, receipt, toEmail);
    if (!sent) {
      return res.status(404).json({ success: false, error: 'Email receipt unavailable — SMTP is not configured.' });
    }
    res.status(200).json({ success: true, emailed: true });
  } catch (error) {
    console.error('Error emailing receipt:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/orders/:id/void  { reason? }
 * Void a sale (POS-12). Admin/Manager only. Restores stock per OrderItems
 * line and logs VOID movements through logStockMovement(); marks the order
 * VOIDED. Books-side reversal is out of scope and reported as such.
 */
app.post('/api/orders/:id/void', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const callerRole = orgUserContext.orgUser.role === 'master_admin' ? 'Admin' : (orgUserContext.orgUser.role || 'Cashier');
    if (callerRole !== 'Admin' && callerRole !== 'Manager') {
      return res.status(403).json({ success: false, error: 'Void requires Admin or Manager role.' });
    }
    const orderId = String(req.params.id || '').trim();
    if (!/^[0-9]+$/.test(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order id.' });
    }
    const reason = String(req.body?.reason || 'Voided at counter').slice(0, 200);

    const found = await safeZcql(catalystApp,
      `SELECT ROWID, status, total, customer_name, customer_email, invoice_number FROM Orders WHERE ROWID = ${orderId}`);
    if (!found || found.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    const order = found[0].Orders;
    if (String(order.status || '').toLowerCase() === 'voided') {
      return res.status(400).json({ success: false, error: 'Order is already voided.' });
    }

    const lineRows = await safeZcql(catalystApp,
      `SELECT ROWID, order_id, item_id, quantity, rate FROM OrderItems WHERE order_id = ${orderId}`);
    const ordersTable = catalystApp.datastore().table('Orders');
    const productsTable = catalystApp.datastore().table('Products');
    let performedBy = '';
    try {
      const me = orgUserContext.user;
      const email = me && (me.email || me.email_id);
      if (email) performedBy = String(email);
    } catch (e) { /* audit identity is best-effort */ }

    let restored = 0;
    let movementsLogged = 0;
    for (const row of lineRows || []) {
      const line = row.OrderItems;
      const qty = Number(line.quantity) || 0;
      if (qty <= 0) continue;
      const live = await resolveProductForSale(catalystApp, { item_id: line.item_id, books_item_id: line.item_id });
      if (!live) continue;
      const onHand = Number(live.stock) || 0;
      const newStock = onHand + qty;
      await productsTable.updateRow({ ROWID: live.ROWID, stock: newStock });
      const movementId = await logStockMovement(catalystApp, {
        itemRowid: live.ROWID,
        sku: live.sku,
        itemName: live.name,
        movementType: 'VOID',
        quantityChange: qty,
        stockBefore: onHand,
        stockAfter: newStock,
        referenceType: 'POS_ORDER',
        referenceId: orderId,
        reason,
        performedBy,
      });
      if (movementId !== null) movementsLogged += 1;
      // Phase 2 mirror (best-effort): restore default WarehouseStock in step.
      try {
        await mirrorDeltaToDefaultWarehouse(catalystApp, live.ROWID, qty);
      } catch (e) { /* warehouse mirror is best-effort */ }
      restored += 1;
    }

    await ordersTable.updateRow({ ROWID: order.ROWID, status: 'Voided' });
    // SET-04: void notification email (best-effort, preference-gated).
    try {
      const voidOrgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
      await maybeSendVoidNotification(catalystApp, voidOrgId, {
        orderNumber: order.invoice_number && order.invoice_number !== '' ? String(order.invoice_number) : `#${orderId}`,
        customerEmail: order.customer_email,
        total: order.total,
      });
    } catch (e) { /* notification is best-effort */ }
    // Cancel chit for kitchen/bar stations (best-effort, after restore).
    let cancelChit = null;
    try {
      const voidOrgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
      const cancelLines = [];
      for (const row of lineRows || []) {
        const l = row.OrderItems;
        const qty = Number(l.quantity) || 0;
        if (qty <= 0) continue;
        const live = await resolveProductForSale(catalystApp, { item_id: l.item_id, books_item_id: l.item_id });
        cancelLines.push({
          name: (live && live.name) || String(l.item_id || 'Item'),
          sku: (live && live.sku) || '',
          qty,
          ref: live ? String(live.ROWID) : '',
        });
      }
      cancelChit = await buildCancelChit(catalystApp, voidOrgId, cancelLines, {
        orderId, reason, actor: performedBy,
      });
    } catch (e) { console.warn('[KOT] Cancel chit skipped:', e.message); }
    res.status(200).json({
      success: true,
      message: `Order voided. Stock restored on ${restored} line${restored === 1 ? '' : 's'}.`,
      restored_lines: restored,
      movements_logged: movementsLogged,
      cancel_chit: cancelChit,
      books_note: 'Zoho Books reversal is manual and out of scope.',
    });
  } catch (error) {
    console.error('Error voiding order:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/orders/:id/return — process a merchandise return (RMA).
 * Body: { items: [{ order_item_id? | product_id?, quantity }], reason?, refund_mode? }
 * Admin/Manager only (store return policy: approval Manager and above).
 * Per line: quantity validated against (ordered − previously returned,
 * derived from RETURN movements so no schema change is needed), stock
 * restored with RETURN movements + warehouse mirror, refund recorded as a
 * negative Payments leg. Full returns flip the order to Refunded;
 * loyalty points earned on the refunded amount are reversed.
 */
app.post('/api/orders/:id/return', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = callerRole(orgUserContext);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Processing returns requires Admin or Manager.' });
    }
    const orderId = String(req.params.id || '').trim();
    if (!/^[0-9]+$/.test(orderId)) {
      return res.status(400).json({ success: false, error: 'Invalid order id.' });
    }
    const { items, reason, refund_mode } = req.body || {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one return line is required.' });
    }
    const cleanReason = String(reason || 'Customer return').slice(0, 200);
    const found = await safeZcql(catalystApp,
      `SELECT ROWID, status, subtotal, tax_amount, total, customer_name, customer_email, invoice_number, payment_mode FROM Orders WHERE ROWID = ${orderId} LIMIT 1`);
    if (!found || found.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found.' });
    }
    const order = found[0].Orders;
    const orderStatus = String(order.status || '').toLowerCase();
    if (orderStatus === 'voided' || orderStatus === 'cancelled') {
      return res.status(400).json({ success: false, error: `Order is ${order.status} and cannot be returned.` });
    }
    if (orderStatus === 'refunded') {
      return res.status(400).json({ success: false, error: 'Order is already fully refunded.' });
    }
    // Original lines + previously returned quantities (RETURN movements).
    const lineRows = await safeZcql(catalystApp,
      `SELECT ROWID, order_id, item_id, quantity, rate, discount_value, discount_type FROM OrderItems WHERE order_id = ${orderId} LIMIT 300`);
    const movRows = await safeZcql(catalystApp,
      `SELECT item_rowid, sku, quantity_change FROM StockMovements WHERE reference_id = '${sanitizeZcql(orderId)}' AND movement_type = 'RETURN' LIMIT 300`);
    const returnedByKey = new Map();
    for (const r of (movRows || [])) {
      const m = r.StockMovements;
      const key = String(m.item_rowid || m.sku || '');
      returnedByKey.set(key, (returnedByKey.get(key) || 0) + Math.abs(Number(m.quantity_change) || 0));
    }
    const byItemRowId = new Map();
    const byRef = new Map();
    for (const r of (lineRows || [])) {
      const l = r.OrderItems;
      byItemRowId.set(String(l.ROWID), l);
      byRef.set(String(l.item_id ?? ''), l);
    }
    const orderSubtotal = Number(order.subtotal) || 0;
    const plan = [];
    for (const [idx, it] of items.entries()) {
      const ref = String((it && (it.order_item_id ?? it.product_id ?? it.item_id)) ?? '').trim();
      const qty = Number(it && it.quantity);
      if (ref === '' || !Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ success: false, error: `Line ${idx + 1}: product/order-item reference and a quantity greater than zero are required.` });
      }
      const orig = byItemRowId.get(ref) || byRef.get(ref);
      if (!orig) {
        return res.status(404).json({ success: false, error: `Line ${idx + 1}: item not found on this order.` });
      }
      const live = await resolveProductForSale(catalystApp, { item_id: orig.item_id, books_item_id: orig.item_id });
      const keyRow = live ? String(live.ROWID) : '';
      const keySku = live ? String(live.sku || '') : String(orig.item_id || '');
      const already = returnedByKey.get(keyRow) || returnedByKey.get(keySku) || 0;
      const orderedQty = Number(orig.quantity) || 0;
      if (qty > orderedQty - already) {
        return res.status(400).json({
          success: false,
          error: `"${live ? live.name : ref}": only ${orderedQty - already} of ${orderedQty} still returnable (requested ${qty}).`,
        });
      }
      // Refund math mirrors the sale: pro-rata net + tax share, minus the
      // order-discount share, so partial returns stay exact.
      const dv = Number(orig.discount_value) || 0;
      const dtype = orig.discount_type === 'flat' ? 'flat' : 'percent';
      const gross = posRound2(orderedQty * (Number(orig.rate) || 0));
      const lineDisc = dtype === 'flat' ? Math.min(dv, gross) : posRound2((gross * Math.min(100, Math.max(0, dv))) / 100);
      const lineNet = posRound2(gross - lineDisc);
      const ratio = orderedQty > 0 ? qty / orderedQty : 0;
      const netRefund = posRound2(lineNet * ratio);
      const orderTax = Number(order.tax_amount) || 0;
      const taxRefund = orderSubtotal > 0 ? posRound2((lineNet / orderSubtotal) * orderTax * ratio) : 0;
      const orderDiscTotal = Math.max(0, posRound2(orderSubtotal + orderTax - (Number(order.total) || 0)));
      const discShare = (orderSubtotal + orderTax) > 0
        ? posRound2(orderDiscTotal * ((lineNet + (orderSubtotal > 0 ? (lineNet / orderSubtotal) * orderTax : 0)) / (orderSubtotal + orderTax)) * ratio)
        : 0;
      plan.push({
        orig, live, qty, ratio,
        refund: posRound2(Math.max(0, netRefund + taxRefund - discShare)),
        name: live ? live.name : String(orig.item_id || ''),
        sku: live ? live.sku : '',
      });
    }
    if (plan.length === 0) {
      return res.status(400).json({ success: false, error: 'No returnable lines.' });
    }
    const ordersTable = catalystApp.datastore().table('Orders');
    const productsTable = catalystApp.datastore().table('Products');
    let performedBy = '';
    try {
      const me = orgUserContext.user;
      const em = me && (me.email || me.email_id);
      if (em) performedBy = String(em);
    } catch (e) { /* audit identity is best-effort */ }
    let movementsLogged = 0;
    let refundTotal = 0;
    for (const p of plan) {
      const onHand = p.live ? (Number(p.live.stock) || 0) : 0;
      const newStock = onHand + p.qty;
      if (p.live) {
        await productsTable.updateRow({ ROWID: p.live.ROWID, stock: newStock });
        try {
          await mirrorDeltaToDefaultWarehouse(catalystApp, p.live.ROWID, p.qty);
        } catch (e) { /* warehouse mirror is best-effort */ }
      }
      const movementId = await logStockMovement(catalystApp, {
        itemRowid: p.live ? p.live.ROWID : p.orig.item_id,
        sku: p.sku,
        itemName: p.name,
        movementType: 'RETURN',
        quantityChange: p.qty,
        stockBefore: onHand,
        stockAfter: newStock,
        referenceType: 'RETURN',
        referenceId: orderId,
        reason: `${cleanReason} (refund ${posRound2(p.refund)})`,
        performedBy,
      });
      if (movementId !== null) movementsLogged += 1;
      refundTotal = posRound2(refundTotal + p.refund);
    }
    // Refund leg (negative) so payment sums net correctly.
    const refundMode = String(refund_mode || order.payment_mode || 'Cash').trim() || 'Cash';
    try {
      await catalystApp.datastore().table('Payments').insertRow({
        order_id: orderId, mode: `Refund-${refundMode}`, amount: -refundTotal,
      });
    } catch (e) {
      console.warn('[RETURNS] Refund leg skipped (provision Payments):', e.message);
    }
    // Fully returned (every line at its ordered quantity) → Refunded.
    const orderedTotal = (lineRows || []).reduce((s, r) => s + (Number(r.OrderItems.quantity) || 0), 0);
    const returnedTotal = plan.reduce((s, p) => s + p.qty, 0)
      + [...returnedByKey.values()].reduce((s, q) => s + q, 0);
    const full = orderedTotal > 0 && returnedTotal >= orderedTotal;
    if (full) {
      await ordersTable.updateRow({ ROWID: order.ROWID, status: 'Refunded' });
    }
    // Loyalty reversal: take back points earned on the refunded amount.
    let pointsReversed = 0;
    try {
      const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
      const cfg = await getLoyaltyConfig(catalystApp, orgId);
      const takeBack = calculateLoyaltyPoints(refundTotal, cfg.points_per_currency);
      if (takeBack > 0) {
        const match = await matchCustomerForOrder(catalystApp, order.customer_name, order.customer_email);
        if (match) {
          const oldPts = Number(match.loyalty_points) || 0;
          const newPts = Math.max(0, oldPts - takeBack);
          await catalystApp.datastore().table('Customers').updateRow({
            ROWID: match.ROWID,
            loyalty_points: newPts,
            tier: calculateCustomerTier(match.lifetime_points, cfg),
            updated_at: formatCatalystDateTime(new Date()),
          });
          await logCustomerActivity(catalystApp, {
            customerId: match.ROWID,
            delta: -(oldPts - newPts),
            oldPoints: oldPts,
            newPoints: newPts,
            reason: `Points reversed for return on order ${orderId}`,
            performedBy,
          });
          pointsReversed = oldPts - newPts;
        }
      }
    } catch (e) {
      console.warn('[RETURNS] Loyalty reversal skipped:', e.message);
    }
    // Customer notice (preference-gated).
    try {
      const retOrgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
      const prefs = await getNotificationSettings(catalystApp, retOrgId);
      if (prefs.order_refund.enabled && prefs.order_refund.channels.includes('email')) {
        const to = String(order.customer_email || '').trim();
        if (to !== '' && to.toLowerCase() !== 'walkin@pos.system') {
          await sendSmtpMail(catalystApp, {
            to,
            subject: `Refund processed for order ${order.invoice_number && order.invoice_number !== '' ? order.invoice_number : `#${orderId}`}`,
            html: `<p>A refund of <strong>${posRound2(refundTotal)}</strong> was processed${full ? ' (order fully refunded)' : ''}. Reason: ${escHtml(cleanReason)}.</p>`,
            text: `Refund of ${posRound2(refundTotal)} processed${full ? ' (order fully refunded)' : ''}. Reason: ${cleanReason}.`,
          });
        }
      }
    } catch (e) { /* notification is best-effort */ }
    // Cancel chit for the returned lines (best-effort).
    let returnCancelChit = null;
    try {
      const returnOrgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
      returnCancelChit = await buildCancelChit(catalystApp, returnOrgId, plan.map((p) => ({
        name: p.name, sku: p.sku, qty: p.qty, ref: p.live ? String(p.live.ROWID) : '',
      })), { orderId, reason: cleanReason, actor: performedBy });
    } catch (e) { console.warn('[KOT] Return cancel chit skipped:', e.message); }
    res.status(200).json({
      success: true,
      message: full ? 'Order fully refunded.' : 'Partial return processed.',
      refund_total: refundTotal,
      refund_mode: refundMode,
      fully_refunded: full,
      cancel_chit: returnCancelChit,
      lines: plan.map((p) => ({ product: p.name, sku: p.sku, quantity: p.qty, refund: p.refund })),
      movements_logged: movementsLogged,
      points_reversed: pointsReversed,
      books_note: 'Zoho Books reversal is manual and out of scope.',
    });
  } catch (error) {
    console.error('Error processing return:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   PHASE 2 — MISSING BACKEND ENDPOINTS
   ========================================================================== */

/** Return the existing product for an exact non-empty barcode, if any. */
async function findProductByBarcode(catalystApp, barcode) {
  const clean = String(barcode ?? '').trim();
  if (clean === '') return null;
  const rows = await safeZcql(catalystApp,
    `SELECT ROWID, name, barcode FROM Products WHERE barcode = '${sanitizeZcql(clean)}' LIMIT 1`
  );
  return rows && rows[0] && rows[0].Products ? rows[0].Products : null;
}

/**
 * POST /api/items
 * Create a new local catalog item in the Catalyst Data Store
 */
app.post('/api/items', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    if (!requirePermission(orgUserContext, res, 'manage_products', 'Creating products requires Admin or Manager.')) return;
    const { name, sku, rate, stock, category, tax_percentage, books_item_id,
      cost_price, reorder_level, status, barcode, unit, description, category_id, category_ids, warehouse_id } = req.body;

    if (!name || !sku) {
      return res.status(400).json({ success: false, error: 'Name and SKU are required.' });
    }

    // Check duplicate SKU across the catalog (single-tenant, no org_id)
    const existing = await safeZcql(catalystApp,
      `SELECT ROWID FROM Products WHERE sku = '${sanitizeZcql(sku)}'`
    );
    if (existing && existing.length > 0) {
      return res.status(409).json({ success: false, error: `SKU '${sku}' already exists.` });
    }
    const cleanBarcode = String(barcode ?? '').trim();
    if (cleanBarcode !== '') {
      const barcodeMatch = await findProductByBarcode(catalystApp, cleanBarcode);
      if (barcodeMatch) {
        return res.status(409).json({ success: false, error: `Barcode '${cleanBarcode}' is already assigned to '${barcodeMatch.name || 'another product'}'.` });
      }
    }

    // Initial product stock is a per-warehouse balance. Existing API clients
    // which omit warehouse_id retain the legacy default-warehouse behavior.
    let openingWarehouse = null;
    const rawWarehouseId = warehouse_id === undefined || warehouse_id === null
      ? '' : String(warehouse_id).trim();
    if (rawWarehouseId !== '') {
      openingWarehouse = await findWarehouseById(catalystApp, rawWarehouseId);
      if (!openingWarehouse) {
        return res.status(404).json({ success: false, error: 'Selected warehouse was not found.' });
      }
      if (String(openingWarehouse.status || 'Active').toLowerCase() !== 'active') {
        return res.status(400).json({ success: false, error: 'Opening stock must be assigned to an active warehouse.' });
      }
    } else {
      try {
        const all = await listAllWarehouses(catalystApp);
        openingWarehouse = all.find((w) => whIsDefault(w)) || null;
      } catch (e) { /* warehouse mirror remains best-effort for legacy callers */ }
    }

    // category_id link (optional for legacy callers, required for new UI).
    // ROWIDs are > 2^53: keep exact digits as text end-to-end. Converting
    // to Number/parseInt rounds (…781 → …784) and validation then misses.
    // PROD-05: category_ids[] carries every linked category; category_id
    // stays as the primary link for backward compatibility.
    let linkedCategoryId = null;
    let categoryText = category || 'General';
    let linkedCategoryIds = [];
    const rawCatId = category_id === undefined || category_id === null
      ? null
      : String(category_id).trim();
    const multiIds = parseCategoryIds(category_ids);
    if (multiIds.length > 0) {
      const resolved = await resolveCategoryIds(catalystApp, multiIds);
      if (resolved === null) {
        return res.status(400).json({ success: false, error: 'One or more selected categories do not exist.' });
      }
      linkedCategoryIds = resolved.ids;
      linkedCategoryId = resolved.primaryId;
      categoryText = resolved.primaryName;
    } else if (rawCatId !== null && rawCatId !== '') {
      if (!/^[0-9]+$/.test(rawCatId)) {
        return res.status(400).json({ success: false, error: 'Invalid category_id.' });
      }
      const linked = await findCategoryById(catalystApp, rawCatId);
      if (!linked) {
        return res.status(400).json({ success: false, error: 'Selected category does not exist.' });
      }
      linkedCategoryId = rawCatId;
      linkedCategoryIds = [rawCatId];
      categoryText = linked.name;
    }

    // New inventory fields: validated types with safe defaults.
    const STATUS_VALUES = ['Active', 'Inactive', 'Discontinued'];
    const costPrice = parseFloat(cost_price);
    let reorderLevel = 10;
    if (reorder_level !== undefined && reorder_level !== null && reorder_level !== '') {
      const parsed = parseInt(reorder_level, 10);
      reorderLevel = Number.isFinite(parsed) ? Math.max(0, parsed) : 10;
    }

    const itemData = {
      books_item_id: books_item_id || '',
      name,
      rate: parseFloat(rate) || 0,
      sku,
      tax_percentage: parseFloat(tax_percentage) || 0,
      stock: parseFloat(stock) || 0,
      category: categoryText,
      category_id: linkedCategoryId,
      category_ids: linkedCategoryIds.length > 0 ? JSON.stringify(linkedCategoryIds) : '',
      cost_price: Number.isFinite(costPrice) && costPrice >= 0 ? costPrice : 0,
      reorder_level: reorderLevel,
      status: STATUS_VALUES.includes(String(status)) ? status : 'Active',
      barcode: cleanBarcode,
      unit: String(unit ?? 'Piece').trim() || 'Piece',
      description: String(description ?? ''),
    };

    const table = catalystApp.datastore().table('Products');
    const row = await table.insertRow(itemData);
    // New catalog stock belongs to the chosen warehouse. The product's stock
    // column remains the aggregate quantity, while WarehouseStock supplies
    // warehouse-specific inventory and existing warehouse filters.
    try {
      if (openingWarehouse) {
        await setWarehouseQuantity(catalystApp, String(openingWarehouse.ROWID), String(row.ROWID), itemData.stock, reorderLevel);
      }
    } catch (e) { /* warehouse mirror is best-effort */ }
    res.status(201).json({ success: true, message: 'Item created', item: { ROWID: row.ROWID, ...itemData } });
  } catch (error) {
    console.error('Error creating item:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/items/:id
 * Update an existing catalog item by ROWID
 */
app.put('/api/items/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    // ROWIDs exceed 2^53: exact digits as text. parseInt()/Number() can
    // round one product's id onto a DIFFERENT row (silent wrong-row write).
    const rowId = String(req.params.id ?? '').trim();
    if (!/^[0-9]+$/.test(rowId)) return res.status(400).json({ success: false, error: 'Invalid item ID.' });

    if (!requirePermission(orgUserContext, res, 'manage_products', 'Updating products requires Admin or Manager.')) return;
    const { name, rate, stock, category, tax_percentage,
      cost_price, reorder_level, status, barcode, unit, description, category_id, category_ids } = req.body;
    if (barcode !== undefined) {
      const cleanBarcode = String(barcode ?? '').trim();
      if (cleanBarcode !== '') {
        const barcodeMatch = await findProductByBarcode(catalystApp, cleanBarcode);
        if (barcodeMatch && String(barcodeMatch.ROWID) !== rowId) {
          return res.status(409).json({ success: false, error: `Barcode '${cleanBarcode}' is already assigned to '${barcodeMatch.name || 'another product'}'.` });
        }
      }
    }
    const updateData = { ROWID: rowId };
    if (name !== undefined) updateData.name = name;
    if (rate !== undefined) updateData.rate = parseFloat(rate) || 0;
    if (stock !== undefined) updateData.stock = parseFloat(stock) || 0;
    if (category !== undefined) updateData.category = category;
    if (tax_percentage !== undefined) updateData.tax_percentage = parseFloat(tax_percentage) || 0;
    if (category_ids !== undefined) {
      // PROD-05: full multi-category replacement. Empty array clears links.
      const resolved = await resolveCategoryIds(catalystApp, parseCategoryIds(category_ids));
      if (resolved === null) {
        return res.status(400).json({ success: false, error: 'One or more selected categories do not exist.' });
      }
      updateData.category_ids = resolved.ids.length > 0 ? JSON.stringify(resolved.ids) : '';
      updateData.category_id = resolved.primaryId;
      updateData.category = resolved.primaryName;
    } else if (category_id !== undefined) {
      if (category_id === null || String(category_id).trim() === '') {
        updateData.category_id = null;
        updateData.category_ids = '';
      } else {
        const key = String(category_id).trim();
        if (!/^[0-9]+$/.test(key)) {
          return res.status(400).json({ success: false, error: 'Invalid category_id.' });
        }
        const linked = await findCategoryById(catalystApp, key);
        if (!linked) {
          return res.status(400).json({ success: false, error: 'Selected category does not exist.' });
        }
        updateData.category_id = key;
        updateData.category_ids = JSON.stringify([key]);
        updateData.category = linked.name;
      }
    }
    if (cost_price !== undefined) {
      const v = parseFloat(cost_price);
      updateData.cost_price = Number.isFinite(v) && v >= 0 ? v : 0;
    }
    if (reorder_level !== undefined) {
      if (reorder_level === null || reorder_level === '') {
        updateData.reorder_level = 10;
      } else {
        const v = parseInt(reorder_level, 10);
        updateData.reorder_level = Number.isFinite(v) ? Math.max(0, v) : 10;
      }
    }
    if (status !== undefined) {
      updateData.status = ['Active', 'Inactive', 'Discontinued'].includes(String(status)) ? status : 'Active';
    }
    if (barcode !== undefined) updateData.barcode = String(barcode).trim();
    if (unit !== undefined) updateData.unit = String(unit).trim() || 'Piece';
    if (description !== undefined) updateData.description = String(description);

    // Phase 2 mirror inputs: capture the pre-update stock so a direct
    // stock edit can be replayed as a delta on the default warehouse.
    let stockDelta = null;
    if (stock !== undefined) {
      try {
        const cur = await safeZcql(catalystApp, `SELECT stock FROM Products WHERE ROWID = ${rowId}`);
        if (cur && cur.length > 0) {
          stockDelta = (parseFloat(stock) || 0) - (parseFloat(cur[0].Products.stock) || 0);
        }
      } catch (e) { /* mirror skipped */ }
    }

    const table = catalystApp.datastore().table('Products');
    await table.updateRow(updateData);
    if (stockDelta !== null && stockDelta !== 0) {
      try {
        await mirrorDeltaToDefaultWarehouse(catalystApp, rowId, stockDelta);
      } catch (e) { /* warehouse mirror is best-effort */ }
    }
    res.status(200).json({ success: true, message: 'Item updated' });
  } catch (error) {
    console.error('Error updating item:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/items/:id
 * Delete a catalog item by ROWID
 */
app.delete('/api/items/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    // Same BigInt rule as PUT: exact-digit ROWID, never parseInt.
    const rowId = String(req.params.id ?? '').trim();
    if (!/^[0-9]+$/.test(rowId)) return res.status(400).json({ success: false, error: 'Invalid item ID.' });

    if (!requirePermission(orgUserContext, res, 'manage_products', 'Deleting products requires Admin or Manager.')) return;
    // PROD-03: block deletion while any OrderItems line references this
    // product (by books_item_id, sku, or ROWID — checkout stores whichever
    // identifier was available). Deactivation remains the safe alternative.
    const targetRows = await safeZcql(catalystApp,
      `SELECT ROWID, sku, books_item_id, image_id FROM Products WHERE ROWID = ${rowId}`);
    if (!targetRows || targetRows.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }
    const target = targetRows[0].Products;
    const refConds = [];
    if (target.books_item_id) refConds.push(`item_id = '${sanitizeZcql(target.books_item_id)}'`);
    if (target.sku) refConds.push(`item_id = '${sanitizeZcql(target.sku)}'`);
    refConds.push(`item_id = '${rowId}'`);
    const refRows = await safeZcql(catalystApp,
      `SELECT ROWID FROM OrderItems WHERE (${refConds.join(' OR ')})`);
    const refCount = (refRows || []).length;
    if (refCount > 0) {
      return res.status(409).json({
        success: false,
        error: `This product is referenced by ${refCount} order${refCount === 1 ? '' : 's'}. Deactivate it (Status → Inactive) instead of deleting.`,
        orderCount: refCount,
      });
    }

    // Best-effort image cleanup (never blocks delete).
    if (target.image_id && logoRefIsStratus(target.image_id)) {
      await stratusDeleteKey(catalystApp, logoKeyFromRef(target.image_id));
    }

    // WarehouseStock has no database cascade. Remove every stock balance for
    // this exact product before deleting its Products row so deleted catalog
    // items cannot leave orphan inventory in any warehouse.
    const stockRows = await safeZcql(catalystApp,
      `SELECT ROWID FROM WarehouseStock WHERE product_id = '${sanitizeZcql(rowId)}' LIMIT 300`
    );
    const stockTable = catalystApp.datastore().table('WarehouseStock');
    for (const stockRow of (stockRows || [])) {
      await stockTable.deleteRow(stockRow.WarehouseStock.ROWID);
    }

    const table = catalystApp.datastore().table('Products');
    await table.deleteRow(rowId);
    res.status(200).json({ success: true, message: 'Item deleted' });
  } catch (error) {
    console.error('Error deleting item:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   PROD-05 — multi-category helpers.
   `category_ids` is a JSON array of Category ROWIDs stored as text; the
   legacy single `category_id` stays as the primary link so every existing
   reader keeps working unchanged.
   ========================================================================== */

/** Normalize any stored/submitted shape to an array of id strings. */
function parseCategoryIds(value) {
  const unique = (list) => [...new Set(
    list.map((v) => String(v ?? '').trim()).filter((v) => v !== '')
  )];
  if (Array.isArray(value)) return unique(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const text = value.trim();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) { parsed = null; }
    if (Array.isArray(parsed)) return unique(parsed);
    if (text.includes(';')) return unique(text.split(';'));
    return [text];
  }
  return [];
}

/**
 * Validate category ids against the Categories table.
 * Returns { ids, primaryId, primaryName } or null when `ids` is empty
 * (caller keeps legacy single-link behavior). Throws on unknown ids.
 */
async function resolveCategoryIds(catalystApp, ids) {
  const clean = [...new Set(
    (ids || []).map((v) => String(v ?? '').trim()).filter((v) => /^[0-9]+$/.test(v))
  )];
  if (clean.length === 0) return { ids: [], primaryId: null, primaryName: 'General' };
  const valid = [];
  for (const id of clean) {
    const cat = await findCategoryById(catalystApp, id);
    if (!cat) throw new Error(`Category not found: ${id}.`);
    valid.push({ id, name: cat.name });
  }
  return { ids: valid.map((v) => v.id), primaryId: valid[0].id, primaryName: valid[0].name };
}

/* ==========================================================================
   PROD-08 — product images on Stratus (keys products/<rowId>.<ext>).
   The Products row keeps only image_id / image_name / image_mime
   references (image_id is `stratus:<key>`). Serving streams bytes via
   GET /api/items/:id/image (no public URLs).
   ========================================================================== */

const PRODUCT_IMAGE_MAX_BYTES = 1536 * 1024; // 1.5 MB cap keeps rows light
const PRODUCT_IMAGE_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function parseImageUpload(body) {
  const raw = String(body?.imageData ?? '');
  if (!raw) return { error: 'imageData is required (base64 data URL or raw base64).' };
  let mime = String(body?.mimeType ?? '').trim().toLowerCase();
  let b64 = raw;
  const dataUrl = raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (dataUrl) {
    if (dataUrl[1]) mime = String(dataUrl[1]).trim().toLowerCase();
    b64 = dataUrl[3] || '';
  }
  if (!Object.prototype.hasOwnProperty.call(PRODUCT_IMAGE_MIME, mime)) {
    return { error: 'Unsupported image type. Use PNG, JPEG, or WebP.' };
  }
  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch (e) {
    return { error: 'imageData is not valid base64.' };
  }
  if (buffer.length === 0) return { error: 'Empty image upload.' };
  if (buffer.length > PRODUCT_IMAGE_MAX_BYTES) {
    return { error: `Image exceeds 1.5 MB (${Math.round(buffer.length / 1024)} KB).` };
  }
  const ext = PRODUCT_IMAGE_MIME[mime];
  const base = String(body?.fileName ?? 'product').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 60) || 'product';
  return { buffer, mime, ext, fileName: `${base}.${ext}` };
}

/**
 * POST /api/items/:id/image  { imageData, mimeType?, fileName? }
 * Upload (or replace) a product image. Replaces any previous file.
 */
app.post('/api/items/:id/image', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_products', 'Product images require Admin or Manager.')) return;
    const rowId = String(req.params.id ?? '').trim();
    if (!/^[0-9]+$/.test(rowId)) return res.status(400).json({ success: false, error: 'Invalid item ID.' });

    const parsed = parseImageUpload(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });

    const current = await safeZcql(catalystApp,
      `SELECT ROWID, sku, image_id FROM Products WHERE ROWID = ${rowId}`);
    if (!current || current.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }
    const oldImageId = current[0].Products.image_id;

    // Stratus is the only backend (FileStore retired with the migration).
    const objectKey = productImageKey(rowId, parsed.ext);
    await stratusUploadBuffer(catalystApp, objectKey, parsed.buffer, parsed.mime);
    const newRef = `stratus:${objectKey}`;
    console.log('[PRODUCT-IMG] Stratus upload ok:', `key=${objectKey}`, `bytes=${parsed.buffer.length}`);
    if (oldImageId && oldImageId !== newRef && logoRefIsStratus(oldImageId)) {
      await stratusDeleteKey(catalystApp, logoKeyFromRef(oldImageId));
    }
    try {
      const table = catalystApp.datastore().table('Products');
      await table.updateRow({ ROWID: rowId, image_id: newRef, image_name: parsed.fileName, image_mime: parsed.mime });
    } catch (e) {
      return res.status(500).json({ success: false, error: 'Image uploaded but the Products row could not store its reference. Add image_id / image_name / image_mime columns via Console.' });
    }
    res.status(200).json({
      success: true, message: 'Product image updated',
      image_id: newRef, image_name: parsed.fileName, image_url: `/api/items/${rowId}/image`,
    });
  } catch (error) {
    console.error('Error uploading product image:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/items/:id/image — remove the image file + clear references.
 */
app.delete('/api/items/:id/image', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_products', 'Product images require Admin or Manager.')) return;
    const rowId = String(req.params.id ?? '').trim();
    if (!/^[0-9]+$/.test(rowId)) return res.status(400).json({ success: false, error: 'Invalid item ID.' });

    const current = await safeZcql(catalystApp,
      `SELECT ROWID, image_id FROM Products WHERE ROWID = ${rowId}`);
    if (!current || current.length === 0) {
      return res.status(404).json({ success: false, error: 'Product not found.' });
    }
    const oldImageId = current[0].Products.image_id;
    if (oldImageId) {
      if (logoRefIsStratus(oldImageId)) {
        await stratusDeleteKey(catalystApp, logoKeyFromRef(oldImageId));
      }
      try {
        const table = catalystApp.datastore().table('Products');
        await table.updateRow({ ROWID: rowId, image_id: '', image_name: '', image_mime: '' });
      } catch (e) { /* reference columns may predate provisioning */ }
    }
    res.status(200).json({ success: true, message: 'Product image removed' });
  } catch (error) {
    console.error('Error removing product image:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/items/:id/image — stream stored bytes with the saved MIME type.
 */
app.get('/api/items/:id/image', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const rowId = String(req.params.id ?? '').trim();
    if (!/^[0-9]+$/.test(rowId)) return res.status(400).json({ success: false, error: 'Invalid item ID.' });

    const current = await safeZcql(catalystApp,
      `SELECT ROWID, image_id, image_mime FROM Products WHERE ROWID = ${rowId}`);
    const imageId = current && current[0] ? current[0].Products.image_id : null;
    if (!imageId) {
      return res.status(404).json({ success: false, error: 'No image for this product.' });
    }
    const mime = (current[0].Products.image_mime || 'image/png').toString();
    const bytes = await getProductImageBytes(catalystApp, imageId);
    if (!bytes) {
      return res.status(404).json({ success: false, error: 'Image unavailable.' });
    }
    res.set('Content-Type', Object.keys(PRODUCT_IMAGE_MIME).includes(mime) ? mime : 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=3600');
    res.status(200).send(bytes);
  } catch (error) {
    console.error('Error serving product image:', error.message);
    res.status(404).json({ success: false, error: 'Image unavailable.' });
  }
});

/* ==========================================================================
   PROD-09 — CSV import / export (server-validated, batch-safe).
   Export columns: sku,name,rate,cost_price,stock,reorder_level,barcode,
   unit,status,tax_percentage,description,categories (;-separated names).
   Import accepts the same shape as row objects; images are out of scope
   for CSV (binary cannot travel in text rows).
   ========================================================================== */

function csvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const IMPORT_STATUSES = ['Active', 'Inactive', 'Discontinued'];

/**
 * GET /api/items/export — full catalog as CSV download.
 */
app.get('/api/items/export', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    let rows = [];
    try {
      rows = await catalystApp.zcql().executeZCQLQuery(
        'SELECT ROWID, sku, name, rate, cost_price, stock, reorder_level, barcode, unit, status, tax_percentage, description, category_ids, category_id, category FROM Products LIMIT 300'
      );
    } catch (e) {
      rows = await catalystApp.zcql().executeZCQLQuery(
        'SELECT ROWID, sku, name, rate, stock, category, category_id FROM Products LIMIT 300'
      );
    }
    let catNameById = new Map();
    try {
      const catRows = await safeZcql(catalystApp, `SELECT ROWID, name FROM Categories`);
      for (const r of (catRows || [])) {
        const c = r.Categories;
        if (c && c.name) catNameById.set(String(c.ROWID), String(c.name));
      }
    } catch (e) { /* Categories table may not exist yet */ }

    const header = ['sku', 'name', 'rate', 'cost_price', 'stock', 'reorder_level', 'barcode', 'unit', 'status', 'tax_percentage', 'description', 'categories'];
    const lines = [header.join(',')];
    for (const row of rows || []) {
      const p = row.Products || {};
      const ids = parseCategoryIds(p.category_ids);
      if (ids.length === 0 && p.category_id) ids.push(String(p.category_id));
      const names = ids.map((id) => catNameById.get(String(id))).filter(Boolean);
      const catText = names.length > 0 ? names.join(';') : String(p.category || '');
      lines.push([
        csvCell(p.sku), csvCell(p.name), csvCell(p.rate ?? 0), csvCell(p.cost_price ?? 0),
        csvCell(p.stock ?? 0), csvCell(p.reorder_level ?? 10), csvCell(p.barcode ?? ''),
        csvCell(p.unit ?? 'Piece'), csvCell(p.status ?? 'Active'), csvCell(p.tax_percentage ?? 0),
        csvCell(p.description ?? ''), csvCell(catText),
      ].join(','));
    }
    const stamp = new Date().toISOString().slice(0, 10);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="products-${stamp}.csv"`);
    res.status(200).send('\uFEFF' + lines.join('\r\n'));
  } catch (error) {
    console.error('Error exporting products:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/items/import  { rows: [{sku,name,rate,cost_price,stock,
 *   reorder_level,barcode,unit,status,tax_percentage,description,categories}] }
 * Validates every row (SKU uniqueness incl. within-file dupes, category
 * existence, numeric formats, non-negative stock) and inserts the valid
 * ones. Partial success returns 200 with per-row errors.
 */
app.post('/api/items/import', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_products', 'CSV import requires Admin or Manager.')) return;
    const rows = req.body?.rows;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: 'rows must be a non-empty array.' });
    }
    if (rows.length > 500) {
      return res.status(400).json({ success: false, error: 'Import capped at 500 rows per batch.' });
    }

    // Existing catalog SKU/barcode values + active category names. Blank
    // barcodes are allowed; a non-blank barcode identifies one product only.
    const existingRows = await safeZcql(catalystApp, `SELECT sku, barcode FROM Products LIMIT 300`);
    const takenSkus = new Set((existingRows || []).map((r) => String(r.Products?.sku ?? '').trim().toLowerCase()).filter(Boolean));
    const takenBarcodes = new Set((existingRows || []).map((r) => String(r.Products?.barcode ?? '').trim().toLowerCase()).filter(Boolean));
    let activeCats = new Map();
    try {
      const catRows = await safeZcql(catalystApp, `SELECT ROWID, name, status FROM Categories`);
      for (const r of (catRows || [])) {
        const c = r.Categories;
        if (c && c.name && (c.status || 'Active') === 'Active') activeCats.set(String(c.name).trim().toLowerCase(), c);
      }
    } catch (e) { activeCats = new Map(); }

    const num = (v, label, errors, i, opts) => {
      const t = String(v ?? '').trim();
      if (t === '') return opts?.fallback ?? 0;
      const n = Number(t);
      if (!Number.isFinite(n)) { errors.push(`Row ${i}: ${label} "${v}" is not a number.`); return null; }
      if (n < 0) { errors.push(`Row ${i}: ${label} must be 0 or more.`); return null; }
      if (opts?.integer && !Number.isInteger(n)) { errors.push(`Row ${i}: ${label} must be a whole number.`); return null; }
      if (opts?.max !== undefined && n > opts.max) { errors.push(`Row ${i}: ${label} must be at most ${opts.max}.`); return null; }
      return n;
    };

    const table = catalystApp.datastore().table('Products');
    const seenInFile = new Set();
    const seenBarcodesInFile = new Set();
    let inserted = 0;
    const errors = [];
    for (let idx = 0; idx < rows.length; idx++) {
      const lineNo = idx + 1;
      const r = rows[idx] || {};
      const rowErrors = [];
      const sku = String(r.sku ?? '').trim();
      const name = String(r.name ?? '').trim();
      if (sku === '') rowErrors.push(`Row ${lineNo}: sku is required.`);
      if (name === '') rowErrors.push(`Row ${lineNo}: name is required.`);
      const skuKey = sku.toLowerCase();
      if (sku !== '' && (takenSkus.has(skuKey) || seenInFile.has(skuKey))) {
        rowErrors.push(`Row ${lineNo}: SKU '${sku}' already exists.`);
      }
      const barcode = String(r.barcode ?? '').trim();
      const barcodeKey = barcode.toLowerCase();
      if (barcode !== '' && (takenBarcodes.has(barcodeKey) || seenBarcodesInFile.has(barcodeKey))) {
        rowErrors.push(`Row ${lineNo}: barcode '${barcode}' already exists.`);
      }
      const rate = num(r.rate, 'rate', rowErrors, lineNo);
      const cost = num(r.cost_price ?? r.cost, 'cost_price', rowErrors, lineNo);
      const stock = num(r.stock, 'stock', rowErrors, lineNo);
      const reorder = num(r.reorder_level ?? r.reorder, 'reorder_level', rowErrors, lineNo, { integer: true });
      const tax = num(r.tax_percentage ?? r.tax, 'tax_percentage', rowErrors, lineNo, { max: 100 });
      const statusRaw = String(r.status ?? 'Active').trim();
      const status = IMPORT_STATUSES.includes(statusRaw) ? statusRaw : null;
      if (!status) rowErrors.push(`Row ${lineNo}: status must be Active, Inactive, or Discontinued.`);
      // Categories: ;-separated names, each must exist and be Active.
      const catNames = String(r.categories ?? r.category ?? '').split(';').map((s) => s.trim()).filter(Boolean);
      const catIds = [];
      for (const n of catNames) {
        const hit = activeCats.get(n.toLowerCase());
        if (!hit) rowErrors.push(`Row ${lineNo}: category '${n}' does not exist or is inactive.`);
        else catIds.push(String(hit.ROWID));
      }
      if (rate === null || cost === null || stock === null || reorder === null || tax === null) continue;
      if (rowErrors.length > 0) { errors.push(...rowErrors.map((m) => ({ row: lineNo, sku, error: m.replace(`Row ${lineNo}: `, '') }))); continue; }
      seenInFile.add(skuKey);
      takenSkus.add(skuKey);
      if (barcode !== '') {
        seenBarcodesInFile.add(barcodeKey);
        takenBarcodes.add(barcodeKey);
      }
      try {
        const primary = catIds.length > 0 ? activeCats.get(catNames[0].toLowerCase()) : null;
        await table.insertRow({
          sku, name,
          rate, cost_price: cost, stock,
          reorder_level: reorder === 0 && String(r.reorder_level ?? r.reorder ?? '').trim() === '' ? 10 : reorder,
          barcode,
          unit: String(r.unit ?? 'Piece').trim() || 'Piece',
          status,
          tax_percentage: tax,
          description: String(r.description ?? '').trim(),
          category: primary ? primary.name : 'General',
          category_id: primary ? String(primary.ROWID) : null,
          category_ids: catIds.length > 0 ? JSON.stringify(catIds) : '',
          books_item_id: '',
        });
        inserted += 1;
      } catch (e) {
        errors.push({ row: lineNo, sku, error: e.message || 'Insert failed.' });
      }
    }
    res.status(200).json({ success: true, inserted, failed: errors.length, errors });
  } catch (error) {
    console.error('Error importing products:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   CATEGORIES API (Phase: first-class catalog grouping)
   Categories table is provisioned via Catalyst Console (see test_tables_exist.js
   and /api/setup/status). Reads tolerate a missing table (return []); writes
   require it and fail with a clear message.
   ========================================================================== */

const CATEGORY_STATUS_VALUES = ['Active', 'Inactive'];

async function findCategoryById(catalystApp, id) {
  // ROWIDs exceed Number.MAX_SAFE_INTEGER: match on exact digits as text.
  // parseInt()/Number() would silently round (e.g. …781 → …784) and miss.
  const key = String(id ?? '').trim();
  if (!/^[0-9]+$/.test(key)) return null;
  const rows = await safeZcql(catalystApp,
    `SELECT ROWID, name, description, status, display_order FROM Categories WHERE ROWID = ${key}`
  );
  if (!rows || rows.length === 0) return null;
  return rows[0].Categories;
}

/** Case-insensitive name check ("Beverages" vs "beverages" collide). */
async function categoryNameTaken(catalystApp, name, excludeRowid) {
  const rows = await safeZcql(catalystApp, `SELECT ROWID, name FROM Categories`);
  const target = String(name).trim().toLowerCase();
  return (rows || []).some((r) => {
    const c = r.Categories;
    if (!c || !c.name) return false;
    if (excludeRowid && String(c.ROWID) === String(excludeRowid)) return false;
    return String(c.name).trim().toLowerCase() === target;
  });
}

function sortCategories(list) {
  return [...list].sort((a, b) => {
    const oa = Number(a.display_order);
    const ob = Number(b.display_order);
    const na = Number.isFinite(oa) ? oa : Number.MAX_SAFE_INTEGER;
    const nb = Number.isFinite(ob) ? ob : Number.MAX_SAFE_INTEGER;
    if (na !== nb) return na - nb;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
}

/**
 * GET /api/categories
 * List all categories (active + inactive; clients filter for dropdowns).
 */
app.get('/api/categories', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const rows = await safeZcql(catalystApp,
      `SELECT ROWID, name, description, status, display_order, CREATEDTIME, MODIFIEDTIME FROM Categories`
    );
    // Keep ROWIDs as exact digit strings (> 2^53 does not survive Number).
    const data = sortCategories((rows || []).map((r) => {
      const c = r.Categories;
      return { ...c, ROWID: c.ROWID === undefined || c.ROWID === null ? c.ROWID : String(c.ROWID) };
    }));
    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('Error fetching categories:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/categories
 * Create a category. Name required + case-insensitively unique.
 */
app.post('/api/categories', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_products', 'Managing categories requires Admin or Manager.')) return;

    const name = String(req.body.name ?? '').trim();
    if (name === '') {
      return res.status(400).json({ success: false, error: 'Category name is required.' });
    }
    if (await categoryNameTaken(catalystApp, name, null)) {
      return res.status(409).json({ success: false, error: `Category '${name}' already exists.` });
    }

    const status = String(req.body.status ?? 'Active');
    const orderRaw = parseInt(req.body.display_order, 10);
    const payload = {
      name,
      description: String(req.body.description ?? ''),
      status: CATEGORY_STATUS_VALUES.includes(status) ? status : 'Active',
      display_order: Number.isFinite(orderRaw) ? Math.max(0, orderRaw) : 0,
    };
    const table = catalystApp.datastore().table('Categories');
    const row = await table.insertRow(payload);
    res.status(201).json({ success: true, message: 'Category created', category: { ROWID: row.ROWID, ...payload } });
  } catch (error) {
    console.error('Error creating category:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/categories/:id
 * Update name/description/status/display_order.
 */
app.put('/api/categories/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_products', 'Managing categories requires Admin or Manager.')) return;
    // ROWID stays a digit string end-to-end: parseInt()/Number() would
    // silently round IDs above 2^53 and hit the WRONG row (or miss).
    const rowId = String(req.params.id ?? '').trim();
    if (!/^[0-9]+$/.test(rowId)) return res.status(400).json({ success: false, error: 'Invalid category ID.' });

    const existing = await findCategoryById(catalystApp, rowId);
    if (!existing) return res.status(404).json({ success: false, error: 'Selected category no longer exists. Please refresh categories.' });

    const updateData = { ROWID: rowId };
    if (req.body.name !== undefined) {
      const name = String(req.body.name).trim();
      if (name === '') return res.status(400).json({ success: false, error: 'Category name is required.' });
      if (await categoryNameTaken(catalystApp, name, rowId)) {
        return res.status(409).json({ success: false, error: `Category '${name}' already exists.` });
      }
      updateData.name = name;
    }
    if (req.body.description !== undefined) updateData.description = String(req.body.description);
    if (req.body.status !== undefined) {
      const status = String(req.body.status);
      if (!CATEGORY_STATUS_VALUES.includes(status)) {
        return res.status(400).json({ success: false, error: 'Status must be Active or Inactive.' });
      }
      updateData.status = status;
    }
    if (req.body.display_order !== undefined) {
      const orderRaw = parseInt(req.body.display_order, 10);
      updateData.display_order = Number.isFinite(orderRaw) ? Math.max(0, orderRaw) : 0;
    }

    const table = catalystApp.datastore().table('Categories');
    await table.updateRow(updateData);
    res.status(200).json({ success: true, message: 'Category updated' });
  } catch (error) {
    console.error('Error updating category:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/categories/:id
 * Business rules:
 * - Category linked to 1+ products  → 409 BLOCKED (deactivate instead).
 * - Category linked to 0 products   → hard delete (row removed).
 * Linked = matching category_id OR (when unlinked) equal legacy text.
 */
app.delete('/api/categories/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_products', 'Managing categories requires Admin or Manager.')) return;
    const rowId = String(req.params.id ?? '').trim();
    if (!/^[0-9]+$/.test(rowId)) return res.status(400).json({ success: false, error: 'Invalid category ID.' });

    const existing = await findCategoryById(catalystApp, rowId);
    if (!existing) return res.status(404).json({ success: false, error: 'Selected category no longer exists. Please refresh categories.' });

    const itemRows = await safeZcql(catalystApp, `SELECT ROWID, category_id, category FROM Products`);
    const nameNorm = String(existing.name || '').trim().toLowerCase();
    let linked = 0;
    for (const r of (itemRows || [])) {
      const it = r.Products;
      const id = it.category_id === undefined || it.category_id === null ? '' : String(it.category_id).trim();
      if (id !== '' && id === rowId) linked++;
      else if (id === '' && nameNorm !== '' && String(it.category || '').trim().toLowerCase() === nameNorm) linked++;
    }
    if (linked > 0) {
      return res.status(409).json({
        success: false,
        product_count: linked,
        error: `Category contains ${linked} product${linked === 1 ? '' : 's'}. Deactivate instead or move products.`,
      });
    }

    const table = catalystApp.datastore().table('Categories');
    await table.deleteRow(rowId);
    res.status(200).json({ success: true, message: 'Category deleted' });
  } catch (error) {
    console.error('Error deleting category:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/categories/repair
 * Audit + auto-repair product↔category links. Safe by construction:
 * - Linkable: category_id set but unresolvable, OR unlinked text matching a
 *   real category name (case-insensitive) → sets category_id (+ syncs text).
 * - Reported only: invalid ids with no text match, empty names (no action).
 * Returns { checked, fixed, issues[] }.
 */
app.post('/api/categories/repair', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_products', 'Repairing categories requires Admin or Manager.')) return;

    const catRows = await safeZcql(catalystApp, `SELECT ROWID, name, status FROM Categories`);
    const byId = new Map();
    const byName = new Map();
    for (const r of (catRows || [])) {
      const c = r.Categories;
      const id = String(c.ROWID);
      byId.set(id, c);
      const key = String(c.name || '').trim().toLowerCase();
      if (key !== '' && !byName.has(key)) byName.set(key, c);
      // Prefer Active rows when duplicate names exist.
      if (key !== '' && (c.status || 'Active') === 'Active') byName.set(key, c);
    }

    const itemRows = await safeZcql(catalystApp, `SELECT ROWID, sku, name, category_id, category FROM Products`);
    const table = catalystApp.datastore().table('Products');
    let fixed = 0;
    const issues = [];
    for (const r of (itemRows || [])) {
      const it = r.Products;
      const id = it.category_id === undefined || it.category_id === null ? '' : String(it.category_id).trim();
      if (id !== '' && byId.has(id)) continue; // healthy link
      const text = String(it.category || '').trim();
      const match = text !== '' ? byName.get(text.toLowerCase()) : undefined;
      if (match) {
        await table.updateRow({ ROWID: String(it.ROWID), category_id: String(match.ROWID), category: match.name });
        fixed++;
      } else {
        issues.push({
          sku: it.sku || '',
          name: it.name || '',
          reason: id !== '' ? `Invalid category link (${id}) with no matching name` : 'No category assigned',
        });
      }
    }

    res.status(200).json({
      success: true,
      message: `Checked ${(itemRows || []).length} products, repaired ${fixed}.`,
      checked: (itemRows || []).length,
      fixed,
      issues: issues.slice(0, 50),
    });
  } catch (error) {
    console.error('Error repairing category links:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/items/stock-adjust
 * Adjust the stock of a catalog item by ROWID
 * Body: { rowid, delta } where delta can be positive or negative
 */
app.post('/api/items/stock-adjust', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'adjust_stock', 'Stock adjustments require Admin, Manager or Storekeeper.')) return;
    const { rowid, delta, reason } = req.body;
    if (!rowid || delta === undefined) {
      return res.status(400).json({ success: false, error: 'rowid and delta are required.' });
    }
    // BigInt rule: ROWID as exact digits, never parseInt (rounding could
    // adjust the WRONG product's stock).
    const rowKey = String(rowid).trim();
    if (!/^[0-9]+$/.test(rowKey)) {
      return res.status(400).json({ success: false, error: 'Invalid item ID.' });
    }

    const current = await safeZcql(catalystApp,
      `SELECT ROWID, sku, name, stock FROM Products WHERE ROWID = ${rowKey}`
    );
    if (!current || current.length === 0) {
      return res.status(404).json({ success: false, error: 'Item not found.' });
    }

    const item = current[0].Products;
    const currentStock = parseFloat(item.stock) || 0;
    const change = parseFloat(delta) || 0;
    // INV-08 backorder policy: negative stock is rejected unless backorders
    // are explicitly enabled in Settings → Inventory (allow_backorders).
    const tentative = currentStock + change;
    if (tentative < 0) {
      const allowed = await getBackordersAllowed(catalystApp, orgUserContext);
      if (!allowed) {
        return res.status(400).json({ success: false, error: 'Insufficient stock. Enable backorders in Settings → Inventory to allow negative inventory.' });
      }
    }
    const newStock = tentative;

    const table = catalystApp.datastore().table('Products');
    await table.updateRow({ ROWID: item.ROWID, stock: newStock });

    // Phase 2 mirror (best-effort): keep the default warehouse's
    // WarehouseStock row in step with Products.stock so
    // SUM(WarehouseStock.quantity) stays equal to Products.stock.
    // Swallowed entirely — warehouses may not be provisioned yet.
    try {
      await mirrorDeltaToDefaultWarehouse(catalystApp, item.ROWID, change);
    } catch (e) { /* warehouse mirror is best-effort */ }

    // Audit trail (same flow): every adjustment writes a movement record.
    // Identity is best-effort — a missing user never blocks the adjustment.
    let performedBy = '';
    try {
      const ctx = await getCurrentOrgUser(req, catalystApp);
      const email = ctx && ctx.user && (ctx.user.email || ctx.user.email_id);
      if (email) performedBy = String(email);
    } catch (e) { /* audit identity is best-effort */ }

    const movementId = await logStockMovement(catalystApp, {
      itemRowid: item.ROWID,
      sku: item.sku,
      itemName: item.name,
      movementType: 'ADJUSTMENT',
      quantityChange: newStock - currentStock,
      stockBefore: currentStock,
      stockAfter: newStock,
      referenceType: 'MANUAL',
      referenceId: '',
      reason: reason || '',
      performedBy,
    });

    console.log(`Stock adjust: ROWID=${item.ROWID}, delta=${delta}, old=${currentStock}, new=${newStock}, reason=${reason || 'N/A'}, movement=${movementId ?? 'NOT-LOGGED'}`);
    // SET-04: immediate low-stock email when a deduction breaches threshold.
    if (change < 0) {
      try {
        const adjOrgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
        await maybeSendLowStockAlert(catalystApp, adjOrgId, {
          productName: item.name, sku: item.sku, newStock, reorderLevel: item.reorder_level,
        });
      } catch (e) { /* alert is best-effort */ }
    }
    res.status(200).json({
      success: true,
      message: 'Stock adjusted',
      old_stock: currentStock,
      new_stock: newStock,
      movement_logged: movementId !== null,
      movement_id: movementId,
    });
  } catch (error) {
    console.error('Error adjusting stock:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/contacts
 * Retrieve CRM contacts (Customers & Suppliers) from Zoho Books or local Configurations
 */
app.get('/api/contacts', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const tenantConfig = getTenantConfig(req);
    const booksService = new ZohoBooksService(catalystApp, tenantConfig);

    if (tenantConfig && tenantConfig.orgId) {
      // Pull from Zoho Books
      try {
        const headers = await booksService.getHeaders();
        const dc = tenantConfig.dc || 'US';
        const domains = booksService.getDomainUrls(dc);
        const url = `${domains.api}/contacts?organization_id=${tenantConfig.orgId}&status=active`;
        const response = await axios.get(url, { headers, timeout: 15000 });
        if (response.data && response.data.code === 0) {
          const rows = response.data.contacts || [];
          const contacts = roleCan(callerRole(orgUserContext), 'manage_customers') ? rows : rows.filter((c) => String(c.contact_type || 'customer').toLowerCase() === 'customer').map(customerLookup);
          return res.status(200).json({ success: true, contacts });
        }
      } catch (booksErr) {
        console.warn('Failed to fetch contacts from Zoho Books, falling back to local:', booksErr.message);
      }
    }

    // Fallback: return local CRM contacts from Configurations
    const localContacts = await safeZcql(catalystApp,
      `SELECT config_key, config_value FROM Configurations WHERE config_key LIKE 'crm_%'`
    );
    let contacts = localContacts
      .map(row => { try { return JSON.parse(row.Configurations.config_value); } catch(e) { return null; } })
      .filter(Boolean);
    if (!roleCan(callerRole(orgUserContext), 'manage_customers')) contacts = contacts.filter((c) => String(c.type || 'customer').toLowerCase() === 'customer').map(customerLookup);
    res.status(200).json({ success: true, contacts });
  } catch (error) {
    console.error('Error fetching contacts:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/contacts
 * Create or update a CRM contact in the Configurations table
 */
app.post('/api/contacts', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!['Admin', 'Manager', 'Cashier'].includes(callerRole(orgUserContext))) {
      return res.status(403).json({ success: false, error: 'Saving contacts requires Admin, Manager or Cashier.' });
    }
    const { id, name, type, email, phone, company, taxid, balance } = req.body;

    if (!name) return res.status(400).json({ success: false, error: 'Contact name is required.' });

    const contactId = id || `CRM-${Date.now()}`;
    const payload = { id: contactId, name, type: type || 'Customer', email: email || '', phone: phone || '', company: company || '', taxid: taxid || '', balance: parseFloat(balance) || 0 };
    const key = `crm_${contactId.replace(/[^a-zA-Z0-9]/g, '_')}`;

    await safeUpsertConfig(catalystApp, key, JSON.stringify(payload));
    res.status(200).json({ success: true, message: id ? 'Contact updated' : 'Contact created', contact: payload });
  } catch (error) {
    console.error('Error saving contact:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/config/settings
 * Retrieve POS system configuration settings stored in Configurations table
 */
app.get('/api/config/settings', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const { orgUser } = orgUserContext;
    const orgId = orgUser.org_id;
    const prefix = `org_${orgId}_setting_`;

    let result = await safeZcql(catalystApp,
      `SELECT config_key, config_value FROM Configurations WHERE config_key LIKE '${prefix}%'`
    );

    // Backward compatibility fallback for virtual tenant
    if ((!result || result.length === 0) && orgId === 'org_default') {
      result = await safeZcql(catalystApp,
        `SELECT config_key, config_value FROM Configurations WHERE config_key LIKE 'pos_setting_%'`
      );
    }

    const settings = {};
    if (result && result.length > 0) {
      result.forEach(row => {
        const key = row.Configurations.config_key.replace(row.Configurations.config_key.startsWith(prefix) ? prefix : 'pos_setting_', '');
        let val = row.Configurations.config_value;
        if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (!isNaN(val) && val !== '') val = Number(val);
        settings[key] = val;
      });
    }

    res.status(200).json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/config/settings
 * Persist POS system configuration settings to the Configurations table
 */
app.post('/api/config/settings', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const { settings } = req.body;
    let orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Store settings require Admin.')) return;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ success: false, error: 'settings object is required.' });
    }

    let { user, orgUser } = orgUserContext;
    let orgId = orgUser.org_id;

    // Check if we need to auto-create the organization and map user during onboarding.
    // We do this if:
    // 1. The user has no existing real mapping (i.e. currently mapped to fallback virtual 'org_default'), AND
    // 2. We are saving onboarding data (e.g. store_name is present).
    if (orgId === 'org_default' && settings.store_name) {
      const displayName = settings.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
      // Template schema first; this project's Organizations table uses
      // organization_name/status instead — try that shape before giving up.
      // Either shape maps the user via OrgUsers; without that table we stay
      // on org_default (same safe fallback as before).
      let provisioned = null;
      try {
        console.log('[ONBOARDING] Initiating multi-tenant organization provisioning for user:', user.email);
        const orgTable = catalystApp.datastore().table('Organizations');
        const orgRow = await orgTable.insertRow({
          org_name: settings.store_name,
          industry: settings.industry || 'Retail',
          master_admin_user_id: user.user_id,
          zoho_books_org_id: '',
          books_connected: 'false'
        });

        const newId = String(orgRow.ROWID);
        console.log('[ONBOARDING] Created Organizations row with ID:', newId);

        const orgUserTable = catalystApp.datastore().table('OrgUsers');
        await orgUserTable.insertRow({
          org_id: newId,
          user_id: user.user_id,
          role: 'master_admin',
          display_name: displayName
        });
        provisioned = newId;
        console.log('[ONBOARDING] Created OrgUsers master_admin mapping for user_id:', user.user_id);
      } catch (templateErr) {
        console.warn('[ONBOARDING] Template schema failed, trying project schema:', templateErr.message);
        try {
          const now = formatCatalystDateTime(new Date());
          const orgRow = await catalystApp.datastore().table('Organizations').insertRow({
            organization_name: settings.store_name,
            business_reg_no: settings.business_reg_no || '',
            industry: settings.industry || 'Retail',
            owner_name: displayName,
            owner_email: user.email,
            owner_phone: settings.owner_phone || '',
            address: settings.address || '',
            city: settings.city || '',
            province: settings.province || '',
            country: settings.country || '',
            status: 'approved',
            remarks: '',
            created_at: now,
            approved_at: now
          });
          const newId = String(orgRow.ROWID);
          await catalystApp.datastore().table('OrgUsers').insertRow({
            org_id: newId,
            user_id: user.user_id,
            role: 'master_admin',
            display_name: displayName
          });
          provisioned = newId;
          console.log('[ONBOARDING] Created project-schema Organizations row with ID:', newId);
        } catch (projectErr) {
          // If tables do not exist in the Catalyst datastore, we fall back to 'org_default'
          console.warn('[ONBOARDING] Tables not yet created. Falling back to org_default configuration prefix.', projectErr.message);
        }
      }
      orgId = provisioned || 'org_default';
    }

    // Save each setting as an isolated key prefixed with the tenant's ID
    const prefix = `org_${orgId}_setting_`;
    for (const [k, v] of Object.entries(settings)) {
      await safeUpsertConfig(catalystApp, `${prefix}${k}`, String(v));
    }
    
    res.status(200).json({ success: true, message: 'Settings saved.', org_id: orgId });
  } catch (error) {
    console.error('Error saving settings:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/shifts/open
 * Open a new till shift register
 */
app.post('/api/shifts/open', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!['Admin', 'Manager', 'Cashier'].includes(callerRole(orgUserContext))) {
      return res.status(403).json({ success: false, error: 'Opening shifts requires Admin, Manager or Cashier.' });
    }

    const { orgUser } = orgUserContext;
    const orgId = orgUser.org_id;
    const { cashier_name, opening_float, open_notes } = req.body;

    if (!cashier_name || opening_float === undefined) {
      return res.status(400).json({ success: false, error: 'cashier_name and opening_float are required.' });
    }

    const payload = {
      cashier_name: callerRole(orgUserContext) === 'Cashier' ? orgUserContext.user.email : cashier_name,
      opening_float: parseFloat(opening_float) || 0,
      cash_sales: 0.0,
      noncash_sales: 0.0,
      expected_cash: parseFloat(opening_float) || 0,
      status: 'Open',
      open_notes: open_notes || '',
      org_id: orgId
    };

    const table = catalystApp.datastore().table('Shifts');
    const row = await table.insertRow(payload);
    res.status(201).json({ success: true, message: 'Shift opened', shift: { ROWID: row.ROWID, ...payload } });
  } catch (error) {
    console.error('Error opening shift:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/shifts/close
 * Reconcile and close a till shift register
 */
app.post('/api/shifts/close', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!['Admin', 'Manager', 'Cashier'].includes(callerRole(orgUserContext))) {
      return res.status(403).json({ success: false, error: 'Closing shifts requires Admin, Manager or Cashier.' });
    }
    const { rowid, actual_cash, close_notes, cash_sales, noncash_sales } = req.body;

    if (!rowid || actual_cash === undefined) {
      return res.status(400).json({ success: false, error: 'rowid and actual_cash are required.' });
    }

    // Get current shift
    const existing = await safeZcql(catalystApp,
      `SELECT ROWID, cashier_name, opening_float, open_notes, org_id FROM Shifts WHERE ROWID = ${parseInt(rowid)}`
    );
    if (!existing || existing.length === 0) {
      return res.status(404).json({ success: false, error: 'Shift not found.' });
    }

    const shift = existing[0].Shifts;
    if (String(shift.org_id) !== String(orgUserContext.orgUser.org_id) ||
        (callerRole(orgUserContext) === 'Cashier' && String(shift.cashier_name || '').toLowerCase() !== orgUserContext.user.email.toLowerCase())) {
      return res.status(403).json({ success: false, error: 'You can only close your own shift.' });
    }
    const opening = parseFloat(shift.opening_float) || 0;
    const cSales = parseFloat(cash_sales) || 0;
    const ncSales = parseFloat(noncash_sales) || 0;
    const expected = opening + cSales;
    const actual = parseFloat(actual_cash) || 0;
    const variance = actual - expected;

    const updateData = {
      ROWID: parseInt(rowid),
      cash_sales: cSales,
      noncash_sales: ncSales,
      expected_cash: expected,
      actual_cash: actual,
      variance: variance,
      status: 'Closed',
      close_notes: close_notes || ''
    };

    const table = catalystApp.datastore().table('Shifts');
    await table.updateRow(updateData);
    res.status(200).json({ success: true, message: 'Shift closed', shift: updateData });
  } catch (error) {
    console.error('Error closing shift:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/shifts
 * Retrieve shifts history
 */
app.get('/api/shifts', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const orgId = orgUserContext.orgUser.org_id;

    let query = 'SELECT ROWID, cashier_name, opening_float, cash_sales, noncash_sales, expected_cash, actual_cash, variance, status, open_notes, close_notes, CREATEDTIME FROM Shifts';
    query += ` WHERE org_id = '${sanitizeZcql(orgId)}'`;
    query += ' ORDER BY CREATEDTIME DESC LIMIT 100';

    const result = await catalystApp.zcql().executeZCQLQuery(query);
    let shifts = result.map(row => row.Shifts);
    if (callerRole(orgUserContext) === 'Cashier') shifts = shifts.filter((shift) => String(shift.cashier_name || '').toLowerCase() === orgUserContext.user.email.toLowerCase());
    res.status(200).json({ success: true, shifts });
  } catch (error) {
    console.error('Error fetching shifts:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   DASHBOARD AGGREGATION (DASH-01…07) — single source of truth
   --------------------------------------------------------------------------
   One session-gated endpoint that joins what the frontend cannot:
   OrderItems (quantities/cost basis) + StockMovements (audit trail).
   Revenue/orders/customers/profit/top-sellers/slow-movers/movements are all
   derived here from live rows — no heuristics, no hardcoded thresholds.
   Each query is individually fail-soft (missing table → empty slice) so a
   fresh deployment still returns a valid (possibly empty) summary.
   Day bucketing uses UTC calendar days, matching the frontend's
   ISO-date slicing convention.
   ========================================================================== */

function dashDayOf(value) {
  return String(value ?? '').slice(0, 10);
}

function dashShiftDays(dayStr, delta) {
  const d = new Date(dayStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dashNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function dashOrderStatus(order) {
  return normalizeOrderStatus(order && order.status).toLowerCase();
}

function dashCountsAsSale(order) {
  const st = dashOrderStatus(order);
  return st !== 'voided' && st !== 'cancelled' && st !== 'refunded';
}

function dashNetOrderValue(order, legsByOrder) {
  const legs = legsByOrder.get(String(order.ROWID)) || [];
  if (legs.length > 0) {
    return round2(legs.reduce((s, p) => s + dashNum(p.amount), 0));
  }
  return 0;
}

app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    // USR-03: business-wide aggregates are managers-only (page guard mirrors this).
    if (!requirePermission(orgUserContext, res, 'view_reports', 'Dashboard analytics require Admin or Manager.')) return;

    const today = new Date().toISOString().slice(0, 10);
    const weekStart = dashShiftDays(today, -6);
    const monthStart = today.slice(0, 7) + '-01';
    const activeSince = dashShiftDays(today, -29);

    // ---- 1. Orders (bounded; dashboard needs history depth, not full dump)
    let orders = [];
    try {
      const rows = await safeZcql(catalystApp,
        'SELECT ROWID, customer_name, customer_email, subtotal, tax_amount, total, payment_mode, status, books_invoice_id, invoice_number, local_ref, CREATEDTIME FROM Orders ORDER BY CREATEDTIME DESC LIMIT 300'
      );
      orders = (rows || []).map((row) => row.Orders).filter(Boolean);
    } catch (e) { console.warn('[DASH] orders slice unavailable:', e.message); }
    const legsByOrder = await fetchPaymentsGrouped(catalystApp);
    const saleOrders = orders.filter(dashCountsAsSale);
    const collectedOrders = saleOrders.filter((o) => dashNetOrderValue(o, legsByOrder) > 0);
    const saleOrderIds = new Set(collectedOrders.map((o) => String(o.ROWID)));

    // ---- 2. OrderItems (quantities + rates per line for profit/top-sellers)
    let lines = [];
    try {
      const rows = await safeZcql(catalystApp,
        'SELECT ROWID, order_id, item_id, quantity, rate, CREATEDTIME FROM OrderItems ORDER BY CREATEDTIME DESC LIMIT 300'
      );
      lines = (rows || []).map((row) => row.OrderItems).filter(Boolean);
    } catch (e) { console.warn('[DASH] order-lines slice unavailable:', e.message); }

    // ---- 3. Products cost/price map (actual margin basis — never estimated)
    const costByBooksId = new Map();
    const nameByBooksId = new Map();
    const skuByBooksId = new Map();
    let products = [];
    try {
      const rows = await safeZcql(catalystApp,
        'SELECT ROWID, sku, name, rate, cost_price, stock, reorder_level, books_item_id FROM Products LIMIT 300'
      );
      products = (rows || []).map((row) => row.Products).filter(Boolean);
      for (const p of products) {
        const key = String(p.books_item_id ?? '').trim();
        if (key === '') continue;
        // Cost is "known" only when explicitly positive: the product form
        // stores blank costs as 0, and counting those as pure profit would
        // fabricate margin. Unknown-cost lines are reported, never guessed.
        const cost = Number(p.cost_price);
        if (Number.isFinite(cost) && cost > 0) costByBooksId.set(key, cost);
        nameByBooksId.set(key, String(p.name ?? key));
        skuByBooksId.set(key, String(p.sku ?? ''));
      }
    } catch (e) { console.warn('[DASH] products slice unavailable:', e.message); }

    // ---- 4. Recent stock movements (audit trail for the activity feed)
    let movements = [];
    try {
      const rows = await safeZcql(catalystApp,
        'SELECT ROWID, item_rowid, sku, item_name, movement_type, quantity_change, stock_before, stock_after, reference_type, reference_id, reason, performed_by, CREATEDTIME FROM StockMovements ORDER BY CREATEDTIME DESC LIMIT 50'
      );
      movements = (rows || []).map((row) => row.StockMovements).filter(Boolean).map((m) => ({
        id: String(m.ROWID ?? ''),
        itemRowid: String(m.item_rowid ?? ''),
        sku: String(m.sku ?? ''),
        itemName: String(m.item_name ?? ''),
        movementType: String(m.movement_type ?? 'ADJUSTMENT'),
        quantityChange: dashNum(m.quantity_change),
        stockBefore: dashNum(m.stock_before),
        stockAfter: dashNum(m.stock_after),
        referenceType: String(m.reference_type ?? ''),
        referenceId: String(m.reference_id ?? ''),
        reason: String(m.reason ?? ''),
        performedBy: String(m.performed_by ?? ''),
        at: String(m.CREATEDTIME ?? ''),
      }));
    } catch (e) { console.warn('[DASH] movements slice unavailable:', e.message); }

    // ---- Revenue buckets (DASH-01) + order pipeline (DASH-02)
    const revenue = { today: 0, week: 0, month: 0, total: 0 };
    const orderCounts = { total: collectedOrders.length, pending: 0, offline: 0, synced: 0, toInvoice: 0, today: 0 };
    const orderDayById = new Map();
    for (const o of orders) {
      const day = dashDayOf(o.CREATEDTIME);
      if (o.ROWID !== undefined && o.ROWID !== null) orderDayById.set(String(o.ROWID), day);
      if (!dashCountsAsSale(o)) continue;
      const total = dashNetOrderValue(o, legsByOrder);
      if (!(total > 0)) continue;
      revenue.total = round2(revenue.total + total);
      if (day === today) { revenue.today = round2(revenue.today + total); orderCounts.today += 1; }
      if (day !== '' && day >= weekStart) revenue.week = round2(revenue.week + total);
      if (day !== '' && day >= monthStart) revenue.month = round2(revenue.month + total);
      const st = dashOrderStatus(o);
      if (st === 'pending') orderCounts.pending += 1;
      else if (st === 'completed') orderCounts.offline += 1;
      else if (st === 'synced') orderCounts.synced += 1;
      if ((o.books_invoice_id ?? '') === '' && (o.invoice_number ?? '') === '') orderCounts.toInvoice += 1;
    }

    // ---- Customer summary from order history (DASH-03)
    // Key = email, falling back to name. The walk-in placeholder identity
    // is excluded — it is not a real customer and would otherwise skew
    // returning/active counts.
    const custStats = new Map();
    for (const o of collectedOrders) {
      const email = String(o.customer_email ?? '').trim().toLowerCase();
      const name = String(o.customer_name ?? '').trim().toLowerCase();
      if (email === '' && name === '') continue;
      if (email === 'walkin@pos.system' || name === 'walk-in guest') continue;
      const key = email !== '' ? email : name;
      const day = dashDayOf(o.CREATEDTIME);
      const cur = custStats.get(key) || { orders: 0, total: 0, first: day, last: day, name: String(o.customer_name ?? key) };
      cur.orders += 1;
      cur.total = round2(cur.total + dashNetOrderValue(o, legsByOrder));
      if (day !== '' && (cur.first === '' || day < cur.first)) cur.first = day;
      if (day !== '' && (cur.last === '' || day > cur.last)) cur.last = day;
      custStats.set(key, cur);
    }
    let custNew = 0, custReturning = 0, custActive = 0;
    for (const c of custStats.values()) {
      if (c.orders > 1) custReturning += 1;
      if (c.first !== '' && c.first >= activeSince) custNew += 1;
      if (c.last !== '' && c.last >= activeSince) custActive += 1;
    }
    const customers = { total: custStats.size, new: custNew, returning: custReturning, active: custActive };

    // ---- Actual profit from cost basis (DASH-04) — no estimation.
    // Lines whose product has no finite cost_price are reported separately
    // (profitUnknown) instead of being guessed.
    let profitTotal = 0, profitLinesWithCost = 0, profitLinesTotal = 0, profitRevenueOnCosted = 0;
    const qtyByItem = new Map();
    const revByItem = new Map();
    const lastSoldByItem = new Map();
    for (const l of lines) {
      if (!saleOrderIds.has(String(l.order_id ?? ''))) continue;
      const qty = dashNum(l.quantity) || 0;
      const rate = dashNum(l.rate);
      const key = String(l.item_id ?? '').trim();
      profitLinesTotal += 1;
      if (key !== '') {
        qtyByItem.set(key, (qtyByItem.get(key) ?? 0) + qty);
        revByItem.set(key, (revByItem.get(key) ?? 0) + qty * rate);
      }
      const cost = costByBooksId.get(key);
      if (key !== '' && cost !== undefined) {
        profitTotal += qty * (rate - cost);
        profitLinesWithCost += 1;
        profitRevenueOnCosted += qty * rate;
      }
      const orderDay = orderDayById.get(String(l.order_id ?? ''));
      if (key !== '' && orderDay && (!lastSoldByItem.has(key) || orderDay > lastSoldByItem.get(key))) {
        lastSoldByItem.set(key, orderDay);
      }
    }
    const profit = {
      total: profitTotal,
      linesWithCost: profitLinesWithCost,
      linesTotal: profitLinesTotal,
      revenueOnCostedLines: profitRevenueOnCosted,
      marginPct: profitRevenueOnCosted > 0 ? (profitTotal / profitRevenueOnCosted) * 100 : 0,
    };

    // ---- Top sellers by units moved (DASH-06)
    const topProducts = Array.from(qtyByItem.entries())
      .map(([itemId, qty]) => ({
        itemId,
        name: nameByBooksId.get(itemId) || itemId,
        sku: skuByBooksId.get(itemId) || '',
        quantity: qty,
        revenue: revByItem.get(itemId) || 0,
      }))
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // ---- Slow movers: in-stock products with no sale in 30 days (DASH-06)
    const slowMovers = products
      .filter((p) => dashNum(p.stock) > 0)
      .map((p) => {
        const key = String(p.books_item_id ?? '').trim();
        const lastSold = (key !== '' && lastSoldByItem.get(key)) || null;
        const cost = Number(p.cost_price);
        const unit = Number.isFinite(cost) && cost > 0 ? cost : dashNum(p.rate);
        return {
          sku: String(p.sku ?? ''),
          name: String(p.name ?? ''),
          stock: dashNum(p.stock),
          stockValue: unit * dashNum(p.stock),
          lastSoldAt: lastSold,
        };
      })
      .filter((p) => p.lastSoldAt === null || p.lastSoldAt < activeSince)
      .sort((a, b) => b.stockValue - a.stockValue)
      .slice(0, 5);

    res.status(200).json({
      success: true,
      data: {
        revenue, orderCounts, customers, profit, topProducts, slowMovers,
        movements: movements.slice(0, 15),
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Error building dashboard summary:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   INVENTORY PHASE 2 — MULTI-WAREHOUSE (INV-01 / INV-04 / INV-05 / INV-08)
   --------------------------------------------------------------------------
   New Data Store tables (provision via Catalyst Console → Data Store, or
   `npx zcatalyst-cli datastore push` — same flow as the Phase-1 tables):

     Warehouses     name, code*, description, address, contact_person,
                    contact_phone, status, is_default, created_at, updated_at
     WarehouseStock warehouse_id, product_id, quantity, reorder_level,
                    created_at, updated_at   (unique warehouse_id+product_id)
     StockTransfers transfer_number, source_warehouse_id,
                    destination_warehouse_id, status, notes, created_by,
                    approved_by, completed_by, created_at, approved_at,
                    completed_at
     TransferItems  transfer_id, product_id, quantity

   Backward compatibility (INV migration strategy):

     * Products.stock remains the aggregate: Products.stock =
       SUM(WarehouseStock.quantity) across all warehouses.
     * First warehouse read auto-creates a Default warehouse ("Main Store")
       and backfills one WarehouseStock row per product from Products.stock.
     * Legacy writes (POS checkout/void, /items/stock-adjust, product
       create) mirror into the default warehouse best-effort, so existing
       pages (Dashboard, POS, Products, Inventory, Reports, Orders) never
       break whether or not the new tables exist.
   ========================================================================== */

/** Numeric ROWID guard (BigInt-safe: digits only, never parseInt). */
function isDigitsId(v) {
  return /^[0-9]+$/.test(String(v ?? '').trim());
}

/** Normalize a POS role; master_admin behaves as Admin. */
function normWhRole(role) {
  const r = String(role ?? '').trim();
  if (r === 'master_admin') return 'Admin';
  return r;
}

/**
 * INV-08 backorder policy. Reads Configurations in priority order:
 *   1. org_<orgId>_setting_allow_backorders (per-tenant Settings UI)
 *   2. pos_setting_allow_backorders (legacy virtual-tenant fallback)
 *   3. allow_backorders (global fallback)
 * Accepts true/1/'true'/'1'. Default false.
 */
async function getBackordersAllowed(catalystApp, orgUserContext) {
  try {
    const orgId = orgUserContext && orgUserContext.orgUser
      ? String(orgUserContext.orgUser.org_id || '')
      : '';
    const booksService = new ZohoBooksService(catalystApp, null);
    const truthy = (v) => v === true || v === 1 || v === '1'
      || String(v ?? '').trim().toLowerCase() === 'true';
    if (orgId !== '') {
      const scoped = await booksService.getConfig(`org_${orgId}_setting_allow_backorders`);
      if (scoped !== undefined && scoped !== null && String(scoped) !== '') {
        return truthy(scoped);
      }
      if (orgId === 'org_default') {
        const legacy = await booksService.getConfig('pos_setting_allow_backorders');
        if (legacy !== undefined && legacy !== null && String(legacy) !== '') {
          return truthy(legacy);
        }
      }
    }
    const global = await booksService.getConfig('allow_backorders');
    return truthy(global);
  } catch (e) {
    return false;
  }
}

/** Best-effort actor email for audit columns; never throws. */
async function whActorEmail(req, catalystApp, orgUserContext) {
  try {
    if (orgUserContext && orgUserContext.user) {
      const email = orgUserContext.user.email || orgUserContext.user.email_id;
      if (email) return String(email);
    }
    const ctx = await getCurrentOrgUser(req, catalystApp);
    const email = ctx && ctx.user && (ctx.user.email || ctx.user.email_id);
    if (email) return String(email);
  } catch (e) { /* audit identity is best-effort */ }
  return '';
}

/** Fetch a warehouse by ROWID; null when missing (never throws). */
async function findWarehouseById(catalystApp, id) {
  if (!isDigitsId(id)) return null;
  const rowKey = String(id).trim();
  try {
    const rows = await safeZcql(catalystApp,
      `SELECT ROWID, name, code, description, address, contact_person, contact_phone, status, is_default, created_at, updated_at FROM Warehouses WHERE ROWID = ${rowKey}`
    );
    if (rows && rows.length > 0) return rows[0].Warehouses;
  } catch (e) {
    // Older provisioning without the newer columns — retry the core shape.
    try {
      const rows = await safeZcql(catalystApp,
        `SELECT ROWID, name, code, status, is_default FROM Warehouses WHERE ROWID = ${rowKey}`
      );
      if (rows && rows.length > 0) return rows[0].Warehouses;
    } catch (e2) { /* table missing → null */ }
  }
  return null;
}

/** List all warehouses (small table; filtered/sorted in JS). Throws when the table is missing. */
async function listAllWarehouses(catalystApp) {
  let rows;
  try {
    rows = await catalystApp.zcql().executeZCQLQuery(
      'SELECT ROWID, name, code, description, address, contact_person, contact_phone, status, is_default, created_at, updated_at FROM Warehouses LIMIT 200'
    );
  } catch (fullErr) {
    rows = await catalystApp.zcql().executeZCQLQuery(
      'SELECT ROWID, name, code, status, is_default FROM Warehouses LIMIT 200'
    );
  }
  return (rows || []).map((r) => r.Warehouses).filter(Boolean);
}

function whIsDefault(w) {
  const v = w.is_default;
  return v === true || v === 1 || String(v ?? '').trim().toLowerCase() === 'true' || String(v) === '1';
}

function shapeWarehouse(w) {
  return {
    ROWID: w.ROWID,
    name: w.name ?? '',
    code: w.code ?? '',
    description: w.description ?? '',
    address: w.address ?? '',
    contact_person: w.contact_person ?? '',
    contact_phone: w.contact_phone ?? '',
    status: w.status ?? 'Active',
    is_default: whIsDefault(w),
    created_at: w.created_at ?? null,
    updated_at: w.updated_at ?? null,
  };
}

/**
 * Ensure exactly one default warehouse exists; creates "Main Store" (MAIN)
 * on first use. Returns the default warehouse row.
 */
async function ensureDefaultWarehouse(catalystApp) {
  const all = await listAllWarehouses(catalystApp);
  const existing = all.find((w) => whIsDefault(w));
  if (existing) return existing;
  const now = formatCatalystDateTime(new Date());
  // Code-uniqueness guard for the seed row.
  const codeClash = all.some((w) => String(w.code ?? '').trim().toUpperCase() === 'MAIN');
  const table = catalystApp.datastore().table('Warehouses');
  const row = await table.insertRow({
    name: 'Main Store',
    code: codeClash ? `MAIN-${Date.now().toString(36).toUpperCase()}` : 'MAIN',
    description: 'Default store location (auto-created).',
    address: '',
    contact_person: '',
    contact_phone: '',
    status: 'Active',
    is_default: true,
    created_at: now,
    updated_at: now,
  });
  return { ROWID: row.ROWID, name: 'Main Store', code: 'MAIN', status: 'Active', is_default: true };
}

/**
 * Backfill WarehouseStock from Products.stock only for products which have
 * no warehouse balance anywhere. This is a legacy migration for products
 * created before multi-warehouse stock existed; it must never mirror a
 * product already assigned to a non-default warehouse into the default one.
 * Idempotent — only products with no WarehouseStock row are inserted.
 */
async function backfillWarehouseStock(catalystApp) {
  const def = await ensureDefaultWarehouse(catalystApp);
  const defId = String(def.ROWID);
  const products = await safeZcql(catalystApp,
    'SELECT ROWID, stock, reorder_level FROM Products LIMIT 300'
  );
  let existing = [];
  try {
    existing = await fetchAllZcql(catalystApp,
      'ROWID, warehouse_id, product_id', 'WarehouseStock', '', 10);
  } catch (e) {
    existing = [];
  }
  const productsWithWarehouseStock = new Set(
    (existing || [])
      .map((r) => r && r.WarehouseStock && r.WarehouseStock.product_id)
      .filter((productId) => productId !== undefined && productId !== null && String(productId) !== '')
      .map((productId) => String(productId))
  );
  const table = catalystApp.datastore().table('WarehouseStock');
  const now = formatCatalystDateTime(new Date());
  let created = 0;
  for (const r of (products || [])) {
    const p = r.Products;
    if (!p) continue;
    const pid = String(p.ROWID);
    if (productsWithWarehouseStock.has(pid)) continue;
    try {
      await table.insertRow({
        warehouse_id: defId,
        product_id: pid,
        quantity: Number(p.stock) || 0,
        reorder_level: Number(p.reorder_level) || 10,
        created_at: now,
        updated_at: now,
      });
      created += 1;
    } catch (e) {
      console.warn(`[WAREHOUSE] Backfill skipped product ${pid}:`, e.message);
    }
  }
  return { created, default_warehouse_id: defId };
}

/** Fetch one WarehouseStock row; null when absent (never throws). */
async function getWarehouseStockRow(catalystApp, warehouseId, productId) {
  try {
    const rows = await safeZcql(catalystApp,
      `SELECT ROWID, warehouse_id, product_id, quantity, reorder_level, created_at, updated_at FROM WarehouseStock WHERE warehouse_id = '${sanitizeZcql(String(warehouseId))}' AND product_id = '${sanitizeZcql(String(productId))}' LIMIT 1`
    );
    if (rows && rows.length > 0) return rows[0].WarehouseStock;
  } catch (e) { /* table missing → null */ }
  return null;
}

/** Set an absolute quantity on one WarehouseStock row (creates it when missing). */
async function setWarehouseQuantity(catalystApp, warehouseId, productId, quantity, reorderLevel) {
  const table = catalystApp.datastore().table('WarehouseStock');
  const now = formatCatalystDateTime(new Date());
  const existing = await getWarehouseStockRow(catalystApp, warehouseId, productId);
  const qty = Number(quantity) || 0;
  if (existing) {
    const payload = { ROWID: existing.ROWID, quantity: qty, updated_at: now };
    const rl = reorderLevel !== undefined && reorderLevel !== null && reorderLevel !== ''
      ? Math.max(0, parseInt(reorderLevel, 10) || 0)
      : existing.reorder_level;
    if (rl !== undefined) payload.reorder_level = rl;
    await table.updateRow(payload);
    return { before: Number(existing.quantity) || 0, after: qty, created: false };
  }
  const rl = reorderLevel !== undefined && reorderLevel !== null && reorderLevel !== ''
    ? Math.max(0, parseInt(reorderLevel, 10) || 0)
    : 10;
  await table.insertRow({
    warehouse_id: String(warehouseId),
    product_id: String(productId),
    quantity: qty,
    reorder_level: rl,
    created_at: now,
    updated_at: now,
  });
  return { before: 0, after: qty, created: true };
}

/**
 * Recompute Products.stock = SUM(WarehouseStock.quantity) for one product.
 * No-op when the product has zero warehouse rows (legacy stock untouched).
 */
async function syncProductStock(catalystApp, productRowId) {
  const pid = String(productRowId);
  let rows = [];
  try {
    rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT quantity FROM WarehouseStock WHERE product_id = '${sanitizeZcql(pid)}' LIMIT 300`
    );
  } catch (e) {
    return null;
  }
  if (!rows || rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + (Number(r.WarehouseStock.quantity) || 0), 0);
  try {
    await catalystApp.datastore().table('Products').updateRow({ ROWID: isDigitsId(pid) ? pid : pid, stock: total });
  } catch (e) {
    console.warn(`[WAREHOUSE] Aggregate sync failed for product ${pid}:`, e.message);
    return null;
  }
  return total;
}

/**
 * Legacy-write mirror: applies a delta to the default warehouse row for a
 * product (creates the row when needed). Skips silently when the warehouse
 * tables are not provisioned yet.
 */
async function mirrorDeltaToDefaultWarehouse(catalystApp, productRowId, delta) {
  const pid = String(productRowId);
  const d = Number(delta) || 0;
  if (d === 0) return;
  let all;
  try {
    all = await listAllWarehouses(catalystApp);
  } catch (e) {
    return; // Warehouses table not provisioned — nothing to mirror.
  }
  const def = all.find((w) => whIsDefault(w));
  if (!def) return; // No default yet — backfill on next warehouse read.
  const defId = String(def.ROWID);
  const row = await getWarehouseStockRow(catalystApp, defId, pid);
  const before = row ? (Number(row.quantity) || 0) : 0;
  await setWarehouseQuantity(catalystApp, defId, pid, before + d);
}

/** Load a Products row for warehouse flows; null when not found. */
async function getProductForWarehouse(catalystApp, productId) {
  const key = String(productId ?? '').trim();
  if (key === '') return null;
  let rows = [];
  if (isDigitsId(key)) {
    rows = await safeZcql(catalystApp,
      `SELECT ROWID, sku, name, rate, stock, reorder_level, status FROM Products WHERE ROWID = ${key} LIMIT 1`
    );
  } else {
    rows = await safeZcql(catalystApp,
      `SELECT ROWID, sku, name, rate, stock, reorder_level, status FROM Products WHERE sku = '${sanitizeZcql(key)}' LIMIT 1`
    );
  }
  if (!rows || rows.length === 0) return null;
  return rows[0].Products;
}

/** Warehouse row status from quantity + reorder level (INV-01 display). */
function warehouseRowStatus(quantity, reorderLevel) {
  const q = Number(quantity) || 0;
  const rl = Number(reorderLevel);
  const level = Number.isFinite(rl) && rl >= 0 ? Math.floor(rl) : 10;
  if (q < 0) return 'Backordered';
  if (q <= 0) return 'Out of stock';
  if (q <= level) return 'Low stock';
  return 'Healthy';
}

function whMissingTable(res, tableName) {
  return res.status(503).json({
    success: false,
    error: `Table '${tableName}' is not provisioned. Create it in Catalyst Console → Data Store (same flow as Products/Categories), then retry.`,
  });
}

function whIsMissingTableError(error) {
  const msg = extractSdkMessage(error);
  return /No Such Table|No such table|table.*not.*exist|INVALID_TABLE/i.test(msg);
}

function whDatastoreWriteError(res, tableName, error) {
  const detail = extractSdkMessage(error);
  console.error(`[WAREHOUSE] ${tableName} write failed:`, detail);
  if (whIsMissingTableError(error)) return whMissingTable(res, tableName);
  return res.status(500).json({
    success: false,
    error: `Could not write ${tableName}: ${detail}`,
  });
}
/* ---------------- Warehouses CRUD (INV-04) ---------------- */

/** GET /api/warehouses — list with live per-warehouse metrics. */
app.get('/api/warehouses', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    let warehouses;
    try {
      warehouses = await listAllWarehouses(catalystApp);
    } catch (e) {
      return whMissingTable(res, 'Warehouses');
    }
    if (warehouses.length === 0) {
      // Migration: first read seeds the default location.
      try {
        await ensureDefaultWarehouse(catalystApp);
        warehouses = await listAllWarehouses(catalystApp);
      } catch (e) {
        return whMissingTable(res, 'Warehouses');
      }
    }
    // Backfill product rows so a fresh deployment shows real quantities.
    try {
      await backfillWarehouseStock(catalystApp);
    } catch (e) {
      console.warn('[WAREHOUSE] Backfill skipped:', e.message);
    }
    // Per-warehouse metrics from WarehouseStock + Products rates.
    let stockRows = [];
    try {
      const r = await fetchAllZcql(catalystApp,
        'ROWID, warehouse_id, product_id, quantity, reorder_level', 'WarehouseStock', '', 10);
      stockRows = (r || []).map((x) => x.WarehouseStock).filter(Boolean);
    } catch (e) { stockRows = []; }
    let rateByProduct = new Map();
    try {
      const pr = await fetchAllZcql(catalystApp, 'ROWID, rate, cost_price', 'Products', '', 10);
      for (const r of (pr || [])) {
        const p = r.Products;
        if (!p) continue;
        const cost = Number(p.cost_price);
        rateByProduct.set(String(p.ROWID), Number.isFinite(cost) && cost > 0 ? cost : (Number(p.rate) || 0));
      }
    } catch (e) { /* rates optional */ }
    const data = warehouses.map((w) => {
      const wid = String(w.ROWID);
      const mine = stockRows.filter((s) => String(s.warehouse_id) === wid);
      const units = mine.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
      const value = mine.reduce((s, x) => s + (Number(x.quantity) || 0) * (rateByProduct.get(String(x.product_id)) || 0), 0);
      const low = mine.filter((x) => {
        const q = Number(x.quantity) || 0;
        const rl = Number(x.reorder_level);
        const level = Number.isFinite(rl) && rl >= 0 ? Math.floor(rl) : 10;
        return q <= level;
      }).length;
      return { ...shapeWarehouse(w), skus: mine.length, units, inventory_value: value, low_stock_count: low };
    });
    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('Error listing warehouses:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/warehouses — create (Admin/Manager/Storekeeper). */
app.post('/api/warehouses', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager', 'Storekeeper'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Warehouse management requires Admin, Manager or Storekeeper.' });
    }
    const { name, code, description, address, contact_person, contact_phone, status, is_default } = req.body || {};
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ success: false, error: 'Warehouse name is required.' });
    }
    if (!code || String(code).trim() === '') {
      return res.status(400).json({ success: false, error: 'Warehouse code is required.' });
    }
    let existing;
    try {
      existing = await listAllWarehouses(catalystApp);
    } catch (e) {
      return whMissingTable(res, 'Warehouses');
    }
    const normCode = String(code).trim().toUpperCase();
    if (existing.some((w) => String(w.code ?? '').trim().toUpperCase() === normCode)) {
      return res.status(409).json({ success: false, error: `Warehouse code '${String(code).trim()}' already exists.` });
    }
    const now = formatCatalystDateTime(new Date());
    const table = catalystApp.datastore().table('Warehouses');
    const row = await table.insertRow({
      name: String(name).trim(),
      code: String(code).trim(),
      description: String(description ?? ''),
      address: String(address ?? ''),
      contact_person: String(contact_person ?? ''),
      contact_phone: String(contact_phone ?? ''),
      status: status === 'Inactive' ? 'Inactive' : 'Active',
      is_default: is_default === true,
      created_at: now,
      updated_at: now,
    });
    if (is_default === true) {
      // Only one default: unset all others.
      for (const w of existing) {
        if (String(w.ROWID) === String(row.ROWID)) continue;
        if (whIsDefault(w)) {
          try {
            await table.updateRow({ ROWID: w.ROWID, is_default: false, updated_at: now });
          } catch (e) { console.warn('[WAREHOUSE] Unset previous default failed:', e.message); }
        }
      }
    }
    const created = await findWarehouseById(catalystApp, row.ROWID);
    res.status(201).json({ success: true, message: 'Warehouse created.', warehouse: shapeWarehouse(created || { ROWID: row.ROWID, ...req.body }) });
  } catch (error) {
    console.error('Error creating warehouse:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/warehouses/:id — single warehouse with metrics. */
app.get('/api/warehouses/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    let w;
    try {
      w = await findWarehouseById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Warehouses');
    }
    if (!w) return res.status(404).json({ success: false, error: 'Warehouse not found.' });
    const wid = String(w.ROWID);
    let mine = [];
    try {
      const r = await catalystApp.zcql().executeZCQLQuery(
        `SELECT product_id, quantity, reorder_level FROM WarehouseStock WHERE warehouse_id = '${sanitizeZcql(wid)}' LIMIT 300`
      );
      mine = (r || []).map((x) => x.WarehouseStock).filter(Boolean);
    } catch (e) { mine = []; }
    const units = mine.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
    res.status(200).json({
      success: true,
      warehouse: { ...shapeWarehouse(w), skus: mine.length, units },
    });
  } catch (error) {
    console.error('Error fetching warehouse:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** PUT /api/warehouses/:id — edit (Admin/Manager/Storekeeper). */
app.put('/api/warehouses/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager', 'Storekeeper'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Warehouse management requires Admin, Manager or Storekeeper.' });
    }
    let w;
    try {
      w = await findWarehouseById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Warehouses');
    }
    if (!w) return res.status(404).json({ success: false, error: 'Warehouse not found.' });
    const { name, code, description, address, contact_person, contact_phone, status, is_default } = req.body || {};
    const patch = { ROWID: w.ROWID, updated_at: formatCatalystDateTime(new Date()) };
    if (name !== undefined) {
      if (String(name).trim() === '') return res.status(400).json({ success: false, error: 'Warehouse name cannot be empty.' });
      patch.name = String(name).trim();
    }
    if (code !== undefined) {
      if (String(code).trim() === '') return res.status(400).json({ success: false, error: 'Warehouse code cannot be empty.' });
      const all = await listAllWarehouses(catalystApp);
      const normCode = String(code).trim().toUpperCase();
      if (all.some((x) => String(x.ROWID) !== String(w.ROWID) && String(x.code ?? '').trim().toUpperCase() === normCode)) {
        return res.status(409).json({ success: false, error: `Warehouse code '${String(code).trim()}' already exists.` });
      }
      patch.code = String(code).trim();
    }
    if (description !== undefined) patch.description = String(description);
    if (address !== undefined) patch.address = String(address);
    if (contact_person !== undefined) patch.contact_person = String(contact_person);
    if (contact_phone !== undefined) patch.contact_phone = String(contact_phone);
    if (status !== undefined) {
      if (!['Active', 'Inactive'].includes(String(status))) {
        return res.status(400).json({ success: false, error: 'Status must be Active or Inactive.' });
      }
      patch.status = String(status);
    }
    if (is_default !== undefined) patch.is_default = is_default === true;
    const table = catalystApp.datastore().table('Warehouses');
    await table.updateRow(patch);
    if (patch.is_default === true) {
      const all = await listAllWarehouses(catalystApp);
      for (const x of all) {
        if (String(x.ROWID) === String(w.ROWID)) continue;
        if (whIsDefault(x)) {
          try {
            await table.updateRow({ ROWID: x.ROWID, is_default: false, updated_at: patch.updated_at });
          } catch (e) { console.warn('[WAREHOUSE] Unset previous default failed:', e.message); }
        }
      }
    }
    const updated = await findWarehouseById(catalystApp, w.ROWID);
    res.status(200).json({ success: true, message: 'Warehouse updated.', warehouse: shapeWarehouse(updated || { ...w, ...patch }) });
  } catch (error) {
    console.error('Error updating warehouse:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** DELETE /api/warehouses/:id — blocked with 409 when stock exists. */
app.delete('/api/warehouses/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Deleting a warehouse requires Admin or Manager.' });
    }
    let w;
    try {
      w = await findWarehouseById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Warehouses');
    }
    if (!w) return res.status(404).json({ success: false, error: 'Warehouse not found.' });
    if (whIsDefault(w)) {
      return res.status(400).json({ success: false, error: 'The default warehouse cannot be deleted. Set another warehouse as default first.' });
    }
    const wid = String(w.ROWID);
    let mine = [];
    try {
      const r = await catalystApp.zcql().executeZCQLQuery(
        `SELECT ROWID, quantity FROM WarehouseStock WHERE warehouse_id = '${sanitizeZcql(wid)}' LIMIT 300`
      );
      mine = (r || []).map((x) => x.WarehouseStock).filter(Boolean);
    } catch (e) { mine = []; }
    const held = mine.filter((x) => (Number(x.quantity) || 0) !== 0);
    if (held.length > 0) {
      const units = held.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
      return res.status(409).json({
        success: false,
        error: `Warehouse '${w.name}' holds stock (${held.length} SKUs, ${units} units). Transfer it out before deleting.`,
      });
    }
    // Remove empty stock rows, then the warehouse itself.
    try {
      const stockTable = catalystApp.datastore().table('WarehouseStock');
      for (const x of mine) {
        try {
          await stockTable.deleteRow(x.ROWID);
        } catch (e) { console.warn('[WAREHOUSE] Stock row cleanup failed:', e.message); }
      }
    } catch (e) { /* optional cleanup */ }
    await catalystApp.datastore().table('Warehouses').deleteRow(w.ROWID);
    res.status(200).json({ success: true, message: `Warehouse '${w.name}' deleted.` });
  } catch (error) {
    console.error('Error deleting warehouse:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/warehouses/:id/default — set the default warehouse. */
app.post('/api/warehouses/:id/default', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Setting the default warehouse requires Admin or Manager.' });
    }
    let w;
    try {
      w = await findWarehouseById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Warehouses');
    }
    if (!w) return res.status(404).json({ success: false, error: 'Warehouse not found.' });
    if (String(w.status ?? 'Active') !== 'Active') {
      return res.status(400).json({ success: false, error: 'Only an Active warehouse can be the default.' });
    }
    const table = catalystApp.datastore().table('Warehouses');
    const now = formatCatalystDateTime(new Date());
    await table.updateRow({ ROWID: w.ROWID, is_default: true, updated_at: now });
    const all = await listAllWarehouses(catalystApp);
    for (const x of all) {
      if (String(x.ROWID) === String(w.ROWID)) continue;
      if (whIsDefault(x)) {
        try {
          await table.updateRow({ ROWID: x.ROWID, is_default: false, updated_at: now });
        } catch (e) { console.warn('[WAREHOUSE] Unset previous default failed:', e.message); }
      }
    }
    res.status(200).json({ success: true, message: `'${w.name}' is now the default warehouse.` });
  } catch (error) {
    console.error('Error setting default warehouse:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- Warehouse stock (INV-01) ---------------- */

/**
 * GET /api/warehouse-stock?warehouse_id&product_id&status
 * Per-product-per-warehouse quantities with product + warehouse context.
 * status: all | healthy | low | out | backordered
 */
app.get('/api/warehouse-stock', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    try {
      await backfillWarehouseStock(catalystApp);
    } catch (e) {
      const msg = String((e && e.message) || '');
      if (msg.includes('No Such Table') || msg.includes('No such table')) {
        return whMissingTable(res, 'WarehouseStock');
      }
      console.warn('[WAREHOUSE] Backfill skipped:', msg);
    }
    let rows = [];
    try {
      const r = await fetchAllZcql(catalystApp,
        'ROWID, warehouse_id, product_id, quantity, reorder_level, created_at, updated_at',
        'WarehouseStock', '', 10);
      rows = (r || []).map((x) => x.WarehouseStock).filter(Boolean);
    } catch (e) {
      return whMissingTable(res, 'WarehouseStock');
    }
    const { warehouse_id, product_id, status } = req.query || {};
    if (warehouse_id) rows = rows.filter((x) => String(x.warehouse_id) === String(warehouse_id));
    if (product_id) rows = rows.filter((x) => String(x.product_id) === String(product_id));
    // Enrichment maps (single lookups, legacy-safe).
    let prodById = new Map();
    try {
      const pr = await safeZcql(catalystApp,
        'SELECT ROWID, sku, name, rate, cost_price, category, stock, reorder_level FROM Products LIMIT 300'
      );
      for (const r of (pr || [])) {
        if (r.Products) prodById.set(String(r.Products.ROWID), r.Products);
      }
    } catch (e) { /* products optional */ }
    let whById = new Map();
    try {
      const all = await listAllWarehouses(catalystApp);
      for (const w of all) whById.set(String(w.ROWID), w);
    } catch (e) { /* warehouses optional */ }
    let data = rows.map((x) => {
      const pid = String(x.product_id);
      const wid = String(x.warehouse_id);
      const p = prodById.get(pid) || {};
      const w = whById.get(wid) || {};
      const qty = Number(x.quantity) || 0;
      const rlRaw = x.reorder_level !== undefined && x.reorder_level !== null && x.reorder_level !== ''
        ? Number(x.reorder_level)
        : Number(p.reorder_level);
      const rl = Number.isFinite(rlRaw) && rlRaw >= 0 ? Math.floor(rlRaw) : 10;
      const cost = Number(p.cost_price);
      const unit = Number.isFinite(cost) && cost > 0 ? cost : (Number(p.rate) || 0);
      return {
        ROWID: x.ROWID,
        warehouse_id: wid,
        warehouse_name: w.name ?? '',
        warehouse_code: w.code ?? '',
        product_id: pid,
        product_name: p.name ?? '',
        sku: p.sku ?? '',
        category: p.category ?? '',
        rate: Number(p.rate) || 0,
        quantity: qty,
        reorder_level: rl,
        stock_value: unit * qty,
        status: warehouseRowStatus(qty, rl),
        updated_at: x.updated_at ?? null,
      };
    });
    const st = String(status ?? 'all').toLowerCase();
    if (['healthy', 'low', 'out', 'backordered'].includes(st)) {
      data = data.filter((d) => {
        if (st === 'healthy') return d.status === 'Healthy';
        if (st === 'low') return d.status === 'Low stock';
        if (st === 'out') return d.status === 'Out of stock';
        return d.status === 'Backordered';
      });
    }
    data.sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)));
    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('Error listing warehouse stock:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stock-movements — dedicated ledger view (INV-06).
 * Filters: product (name/sku/rowid), type, warehouse, reference, search.
 * Roles: Admin, Manager, Storekeeper.
 */
app.get('/api/stock-movements', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    if (!requirePermission(orgUserContext, res, 'adjust_stock', 'The movement ledger requires Admin, Manager or Storekeeper.')) return;
    let rows = [];
    try {
      const r = await catalystApp.zcql().executeZCQLQuery(
        'SELECT ROWID, item_rowid, sku, item_name, movement_type, quantity_change, stock_before, stock_after, reference_type, reference_id, reason, performed_by, warehouse_id, from_warehouse_id, to_warehouse_id, CREATEDTIME FROM StockMovements ORDER BY CREATEDTIME DESC LIMIT 300'
      );
      rows = (r || []).map((x) => x.StockMovements).filter(Boolean);
    } catch (fullErr) {
      const r = await safeZcql(catalystApp,
        'SELECT ROWID, item_rowid, sku, item_name, movement_type, quantity_change, stock_before, stock_after, reference_type, reference_id, reason, performed_by, CREATEDTIME FROM StockMovements ORDER BY CREATEDTIME DESC LIMIT 300'
      );
      rows = (r || []).map((x) => x.StockMovements).filter(Boolean);
    }
    const q = req.query || {};
    const product = String(q.product || '').trim().toLowerCase();
    const type = String(q.type || '').trim();
    const warehouse = String(q.warehouse || q.warehouse_id || '').trim();
    const reference = String(q.reference || '').trim().toLowerCase();
    const search = String(q.search || '').trim().toLowerCase();
    const from = String(q.date_from || '').trim().slice(0, 10);
    const to = String(q.date_to || '').trim().slice(0, 10);
    let data = rows.map((m) => ({
      ROWID: m.ROWID,
      item_rowid: String(m.item_rowid ?? ''),
      sku: String(m.sku ?? ''),
      item_name: String(m.item_name ?? ''),
      movement_type: String(m.movement_type ?? ''),
      quantity_change: Number(m.quantity_change) || 0,
      stock_before: Number(m.stock_before) || 0,
      stock_after: Number(m.stock_after) || 0,
      reference_type: String(m.reference_type ?? ''),
      reference_id: String(m.reference_id ?? ''),
      reason: String(m.reason ?? ''),
      performed_by: String(m.performed_by ?? ''),
      warehouse_id: String(m.warehouse_id ?? ''),
      from_warehouse_id: String(m.from_warehouse_id ?? ''),
      to_warehouse_id: String(m.to_warehouse_id ?? ''),
      created_at: String(m.CREATEDTIME ?? ''),
    }));
    if (product !== '') {
      data = data.filter((d) => d.item_name.toLowerCase().includes(product)
        || d.sku.toLowerCase().includes(product) || d.item_rowid === product);
    }
    if (type !== '' && type.toLowerCase() !== 'all') {
      data = data.filter((d) => d.movement_type.toLowerCase() === type.toLowerCase());
    }
    if (warehouse !== '') {
      data = data.filter((d) => d.warehouse_id === warehouse || d.from_warehouse_id === warehouse || d.to_warehouse_id === warehouse);
    }
    if (reference !== '') {
      data = data.filter((d) => `${d.reference_type} ${d.reference_id}`.toLowerCase().includes(reference));
    }
    if (search !== '') {
      data = data.filter((d) => `${d.item_name} ${d.sku} ${d.reason} ${d.performed_by} ${d.movement_type}`.toLowerCase().includes(search));
    }
    if (from !== '') data = data.filter((d) => d.created_at.slice(0, 10) >= from);
    if (to !== '') data = data.filter((d) => d.created_at.slice(0, 10) <= to);
    const inQty = data.filter((d) => d.quantity_change > 0).reduce((s, d) => s + d.quantity_change, 0);
    const outQty = data.filter((d) => d.quantity_change < 0).reduce((s, d) => s + Math.abs(d.quantity_change), 0);
    res.status(200).json({
      success: true,
      count: data.length,
      data: data.slice(0, 300),
      summary: { movements: data.length, units_in: inQty, units_out: outQty },
      types: ['SALE', 'ADJUSTMENT', 'VOID', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'PURCHASE', 'OPENING'],
    });
  } catch (error) {
    console.error('Error listing stock movements:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/warehouse-stock/adjust { warehouse_id, product_id, quantity|delta, reason }
 * `quantity`/`delta` is the signed change to apply (e.g. 20 or -4).
 * Enforces INV-08, syncs Products.stock, writes a StockMovements record.
 */
app.post('/api/warehouse-stock/adjust', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager', 'Storekeeper'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Stock adjustments require Admin, Manager or Storekeeper.' });
    }
    const { warehouse_id, product_id, quantity, delta, reason, reorder_level } = req.body || {};
    if (!warehouse_id || !product_id) {
      return res.status(400).json({ success: false, error: 'warehouse_id and product_id are required.' });
    }
    const rawChange = quantity !== undefined ? quantity : delta;
    const change = Number(rawChange);
    if (!Number.isFinite(change) || change === 0) {
      return res.status(400).json({ success: false, error: 'quantity must be a non-zero number (e.g. 20 or -4).' });
    }
    let warehouse;
    try {
      warehouse = await findWarehouseById(catalystApp, warehouse_id);
    } catch (e) {
      return whMissingTable(res, 'Warehouses');
    }
    if (!warehouse) return res.status(404).json({ success: false, error: 'Warehouse not found.' });
    if (String(warehouse.status ?? 'Active') !== 'Active') {
      return res.status(400).json({ success: false, error: `Warehouse '${warehouse.name}' is Inactive.` });
    }
    const product = await getProductForWarehouse(catalystApp, product_id);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found.' });
    const wid = String(warehouse.ROWID);
    const pid = String(product.ROWID);
    const row = await getWarehouseStockRow(catalystApp, wid, pid);
    const before = row ? (Number(row.quantity) || 0) : 0;
    const after = before + change;
    if (after < 0) {
      const allowed = await getBackordersAllowed(catalystApp, orgUserContext);
      if (!allowed) {
        return res.status(400).json({ success: false, error: `Insufficient stock in '${warehouse.name}' (need ${Math.abs(change)}, have ${before}). Enable backorders in Settings → Inventory to allow negative inventory.` });
      }
    }
    const rl = reorder_level !== undefined && reorder_level !== null && reorder_level !== ''
      ? Math.max(0, parseInt(reorder_level, 10) || 0)
      : (row && row.reorder_level !== undefined && row.reorder_level !== null && row.reorder_level !== ''
        ? row.reorder_level
        : (product.reorder_level ?? 10));
    const result = await setWarehouseQuantity(catalystApp, wid, pid, after, rl);
    // SET-04: immediate low-stock email when a deduction breaches threshold.
    if (change < 0) {
      try {
        const whOrgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
        await maybeSendLowStockAlert(catalystApp, whOrgId, {
          productName: `${product.name} @ ${warehouse.name}`, sku: product.sku, newStock: after, reorderLevel: rl,
        });
      } catch (e) { /* alert is best-effort */ }
    }
    const aggregate = await syncProductStock(catalystApp, pid);
    const performedBy = await whActorEmail(req, catalystApp, orgUserContext);
    const movementId = await logStockMovement(catalystApp, {
      itemRowid: pid,
      sku: product.sku,
      itemName: product.name,
      movementType: 'ADJUSTMENT',
      quantityChange: change,
      stockBefore: before,
      stockAfter: after,
      referenceType: 'MANUAL',
      referenceId: wid,
      reason: reason || `Warehouse adjustment (${warehouse.name})`,
      performedBy,
      warehouseId: wid,
    });
    res.status(200).json({
      success: true,
      message: 'Warehouse stock adjusted.',
      warehouse_id: wid,
      warehouse_name: warehouse.name,
      product_id: pid,
      old_stock: result.before,
      new_stock: result.after,
      aggregate_stock: aggregate,
      movement_logged: movementId !== null,
      movement_id: movementId,
    });
  } catch (error) {
    console.error('Error adjusting warehouse stock:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- Transfers (INV-05) ---------------- */

function shapeTransfer(t, items) {
  return {
    ROWID: t.ROWID,
    transfer_number: t.transfer_number ?? '',
    source_warehouse_id: String(t.source_warehouse_id ?? ''),
    destination_warehouse_id: String(t.destination_warehouse_id ?? ''),
    source_warehouse_name: t.source_warehouse_name ?? '',
    destination_warehouse_name: t.destination_warehouse_name ?? '',
    status: t.status ?? 'Pending',
    notes: t.notes ?? '',
    created_by: t.created_by ?? '',
    approved_by: t.approved_by ?? '',
    completed_by: t.completed_by ?? '',
    created_at: t.created_at ?? null,
    approved_at: t.approved_at ?? null,
    completed_at: t.completed_at ?? null,
    items: items || [],
  };
}

async function getTransferItems(catalystApp, transferId) {
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID, transfer_id, product_id, quantity FROM TransferItems WHERE transfer_id = '${sanitizeZcql(String(transferId))}' LIMIT 300`
    );
    return (r || []).map((x) => x.TransferItems).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function loadTransfer(catalystApp, id) {
  if (!isDigitsId(id)) return null;
  const rowKey = String(id).trim();
  let t = null;
  try {
    const rows = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID, transfer_number, source_warehouse_id, destination_warehouse_id, status, notes, created_by, approved_by, completed_by, created_at, approved_at, completed_at FROM StockTransfers WHERE ROWID = ${rowKey} LIMIT 1`
    );
    if (rows && rows.length > 0) t = rows[0].StockTransfers;
  } catch (e) {
    return null;
  }
  if (!t) return null;
  const items = await getTransferItems(catalystApp, t.ROWID);
  // Resolve warehouse names for display.
  try {
    const src = await findWarehouseById(catalystApp, t.source_warehouse_id);
    const dst = await findWarehouseById(catalystApp, t.destination_warehouse_id);
    if (src) t.source_warehouse_name = src.name;
    if (dst) t.destination_warehouse_name = dst.name;
  } catch (e) { /* names optional */ }
  // Resolve product names for display.
  try {
    const ids = [...new Set(items.map((i) => String(i.product_id)))];
    for (const pid of ids) {
      const p = await getProductForWarehouse(catalystApp, pid);
      if (p) {
        for (const it of items) {
          if (String(it.product_id) === pid) {
            it.product_name = p.name;
            it.sku = p.sku;
          }
        }
      }
    }
  } catch (e) { /* names optional */ }
  return shapeTransfer(t, items.map((i) => ({
    ROWID: i.ROWID,
    product_id: String(i.product_id ?? ''),
    product_name: i.product_name ?? '',
    sku: i.sku ?? '',
    quantity: Number(i.quantity) || 0,
  })));
}

/** POST /api/transfers — create a transfer (validates source stock unless backorders on). */
app.post('/api/transfers', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager', 'Storekeeper'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Transfers require Admin, Manager or Storekeeper.' });
    }
    const { source_warehouse_id, destination_warehouse_id, items, notes, status } = req.body || {};
    if (!source_warehouse_id || !destination_warehouse_id) {
      return res.status(400).json({ success: false, error: 'source_warehouse_id and destination_warehouse_id are required.' });
    }
    if (String(source_warehouse_id) === String(destination_warehouse_id)) {
      return res.status(400).json({ success: false, error: 'Source and destination warehouses must be different.' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one transfer item is required.' });
    }
    let src;
    let dst;
    try {
      src = await findWarehouseById(catalystApp, source_warehouse_id);
      dst = await findWarehouseById(catalystApp, destination_warehouse_id);
    } catch (e) {
      return whMissingTable(res, 'Warehouses');
    }
    if (!src) return res.status(404).json({ success: false, error: 'Source warehouse not found.' });
    if (!dst) return res.status(404).json({ success: false, error: 'Destination warehouse not found.' });
    if (String(src.status ?? 'Active') !== 'Active' || String(dst.status ?? 'Active') !== 'Active') {
      return res.status(400).json({ success: false, error: 'Both warehouses must be Active.' });
    }
    const wantDraft = String(status ?? '').toLowerCase() === 'draft';
    const backorders = await getBackordersAllowed(catalystApp, orgUserContext);
    const normItems = [];
    for (const [idx, it] of items.entries()) {
      const pid = String((it && (it.product_id ?? it.productId)) ?? '').trim();
      const qty = Number(it && (it.quantity ?? it.qty));
      if (pid === '' || !Number.isFinite(qty) || qty <= 0) {
        return res.status(400).json({ success: false, error: `Item ${idx + 1}: product_id and a quantity greater than zero are required.` });
      }
      const product = await getProductForWarehouse(catalystApp, pid);
      if (!product) {
        return res.status(404).json({ success: false, error: `Item ${idx + 1}: product not found.` });
      }
      const srcRow = await getWarehouseStockRow(catalystApp, String(src.ROWID), String(product.ROWID));
      const available = srcRow ? (Number(srcRow.quantity) || 0) : 0;
      if (!backorders && available < qty) {
        return res.status(400).json({ success: false, error: `Insufficient stock in '${src.name}' for "${product.name}" (need ${qty}, have ${available}).` });
      }
      normItems.push({ product_id: String(product.ROWID), product_name: product.name, quantity: qty });
    }
    const now = formatCatalystDateTime(new Date());
    const transferNumber = `TRF-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')}`;
    const performedBy = await whActorEmail(req, catalystApp, orgUserContext);
    let transferRow;
    try {
      transferRow = await catalystApp.datastore().table('StockTransfers').insertRow({
        transfer_number: transferNumber,
        source_warehouse_id: String(src.ROWID),
        destination_warehouse_id: String(dst.ROWID),
        status: wantDraft ? 'Draft' : 'Pending',
        notes: String(notes ?? ''),
        created_by: performedBy,
        approved_by: '',
        completed_by: '',
        created_at: now,
      });
    } catch (e) {
      return whDatastoreWriteError(res, 'StockTransfers', e);
    }
    try {
      const itemsTable = catalystApp.datastore().table('TransferItems');
      for (const ni of normItems) {
        await itemsTable.insertRow({
          transfer_id: String(transferRow.ROWID),
          product_id: ni.product_id,
          quantity: ni.quantity,
        });
      }
    } catch (e) {
      return whDatastoreWriteError(res, 'TransferItems', e);
    }
    const created = await loadTransfer(catalystApp, transferRow.ROWID);
    res.status(201).json({ success: true, message: `Transfer ${transferNumber} created.`, transfer: created });
  } catch (error) {
    console.error('Error creating transfer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/transfers — list with filters. */
app.get('/api/transfers', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    let rows = [];
    try {
      const r = await catalystApp.zcql().executeZCQLQuery(
        'SELECT ROWID, transfer_number, source_warehouse_id, destination_warehouse_id, status, notes, created_by, approved_by, completed_by, created_at, approved_at, completed_at FROM StockTransfers ORDER BY CREATEDTIME DESC LIMIT 200'
      );
      rows = (r || []).map((x) => x.StockTransfers).filter(Boolean);
    } catch (e) {
      return whDatastoreWriteError(res, 'StockTransfers', e);
    }
    const q = req.query || {};
    if (q.status) {
      const want = String(q.status).toLowerCase();
      rows = rows.filter((t) => String(t.status ?? '').toLowerCase() === want);
    }
    if (q.source_warehouse_id) rows = rows.filter((t) => String(t.source_warehouse_id) === String(q.source_warehouse_id));
    if (q.destination_warehouse_id) rows = rows.filter((t) => String(t.destination_warehouse_id) === String(q.destination_warehouse_id));
    if (q.from) rows = rows.filter((t) => String(t.created_at ?? '') >= String(q.from));
    if (q.to) rows = rows.filter((t) => String(t.created_at ?? '') <= `${String(q.to)} 23:59:59`);
    // Display names (single warehouse lookup).
    let whById = new Map();
    try {
      const all = await listAllWarehouses(catalystApp);
      for (const w of all) whById.set(String(w.ROWID), w.name);
    } catch (e) { /* optional */ }
    const data = [];
    for (const t of rows) {
      const items = await getTransferItems(catalystApp, t.ROWID);
      data.push(shapeTransfer({
        ...t,
        source_warehouse_name: whById.get(String(t.source_warehouse_id)) ?? '',
        destination_warehouse_name: whById.get(String(t.destination_warehouse_id)) ?? '',
      }, items.map((i) => ({
        ROWID: i.ROWID,
        product_id: String(i.product_id ?? ''),
        quantity: Number(i.quantity) || 0,
      }))));
    }
    res.status(200).json({ success: true, count: data.length, data });
  } catch (error) {
    console.error('Error listing transfers:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/transfers/:id — transfer details. */
app.get('/api/transfers/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    let t;
    try {
      t = await loadTransfer(catalystApp, req.params.id);
    } catch (e) {
      return whDatastoreWriteError(res, 'StockTransfers', e);
    }
    if (!t) return res.status(404).json({ success: false, error: 'Transfer not found.' });
    res.status(200).json({ success: true, transfer: t });
  } catch (error) {
    console.error('Error fetching transfer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/transfers/:id/approve — Admin/Manager only. */
app.post('/api/transfers/:id/approve', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Approving a transfer requires Admin or Manager.' });
    }
    const t = await loadTransfer(catalystApp, req.params.id);
    if (!t) return res.status(404).json({ success: false, error: 'Transfer not found.' });
    if (!['Draft', 'Pending'].includes(String(t.status))) {
      return res.status(400).json({ success: false, error: `Transfer ${t.transfer_number} is ${t.status} and cannot be approved.` });
    }
    const performedBy = await whActorEmail(req, catalystApp, orgUserContext);
    const now = formatCatalystDateTime(new Date());
    await catalystApp.datastore().table('StockTransfers').updateRow({
      ROWID: t.ROWID, status: 'Approved', approved_by: performedBy, approved_at: now,
    });
    const updated = await loadTransfer(catalystApp, t.ROWID);
    res.status(200).json({ success: true, message: `Transfer ${t.transfer_number} approved.`, transfer: updated });
  } catch (error) {
    console.error('Error approving transfer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/transfers/:id/complete — moves stock source → destination,
 * syncs Products.stock aggregates, writes TRANSFER_OUT + TRANSFER_IN
 * movements per line. Admin/Manager/Storekeeper.
 */
app.post('/api/transfers/:id/complete', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager', 'Storekeeper'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Completing a transfer requires Admin, Manager or Storekeeper.' });
    }
    const t = await loadTransfer(catalystApp, req.params.id);
    if (!t) return res.status(404).json({ success: false, error: 'Transfer not found.' });
    if (String(t.status) !== 'Approved') {
      return res.status(400).json({ success: false, error: `Transfer ${t.transfer_number} must be Approved before completing (current: ${t.status}).` });
    }
    const src = await findWarehouseById(catalystApp, t.source_warehouse_id);
    const dst = await findWarehouseById(catalystApp, t.destination_warehouse_id);
    if (!src || !dst) return res.status(400).json({ success: false, error: 'Transfer warehouses no longer exist.' });
    const backorders = await getBackordersAllowed(catalystApp, orgUserContext);
    const performedBy = await whActorEmail(req, catalystApp, orgUserContext);
    // Pre-validate every line so a failed completion moves nothing.
    const plan = [];
    for (const it of (t.items || [])) {
      const product = await getProductForWarehouse(catalystApp, it.product_id);
      if (!product) {
        return res.status(400).json({ success: false, error: `Product ${it.product_id} no longer exists. Cancel and recreate the transfer.` });
      }
      const srcRow = await getWarehouseStockRow(catalystApp, t.source_warehouse_id, String(product.ROWID));
      const srcBefore = srcRow ? (Number(srcRow.quantity) || 0) : 0;
      if (!backorders && srcBefore < it.quantity) {
        return res.status(400).json({ success: false, error: `Insufficient stock in '${src.name}' for "${product.name}" (need ${it.quantity}, have ${srcBefore}).` });
      }
      plan.push({ product, srcBefore, qty: it.quantity });
    }
    let movementsLogged = 0;
    for (const p of plan) {
      const pid = String(p.product.ROWID);
      const dstRow = await getWarehouseStockRow(catalystApp, t.destination_warehouse_id, pid);
      const dstBefore = dstRow ? (Number(dstRow.quantity) || 0) : 0;
      const srcAfter = p.srcBefore - p.qty;
      const dstAfter = dstBefore + p.qty;
      await setWarehouseQuantity(catalystApp, t.source_warehouse_id, pid, srcAfter);
      await setWarehouseQuantity(catalystApp, t.destination_warehouse_id, pid, dstAfter);
      await syncProductStock(catalystApp, pid);
      const outId = await logStockMovement(catalystApp, {
        itemRowid: pid,
        sku: p.product.sku,
        itemName: p.product.name,
        movementType: 'TRANSFER_OUT',
        quantityChange: -p.qty,
        stockBefore: p.srcBefore,
        stockAfter: srcAfter,
        referenceType: 'TRANSFER',
        referenceId: t.transfer_number,
        reason: `Transfer ${t.transfer_number}: ${src.name} → ${dst.name}`,
        performedBy,
        warehouseId: t.source_warehouse_id,
        fromWarehouseId: t.source_warehouse_id,
        toWarehouseId: t.destination_warehouse_id,
      });
      const inId = await logStockMovement(catalystApp, {
        itemRowid: pid,
        sku: p.product.sku,
        itemName: p.product.name,
        movementType: 'TRANSFER_IN',
        quantityChange: p.qty,
        stockBefore: dstBefore,
        stockAfter: dstAfter,
        referenceType: 'TRANSFER',
        referenceId: t.transfer_number,
        reason: `Transfer ${t.transfer_number}: ${src.name} → ${dst.name}`,
        performedBy,
        warehouseId: t.destination_warehouse_id,
        fromWarehouseId: t.source_warehouse_id,
        toWarehouseId: t.destination_warehouse_id,
      });
      if (outId !== null) movementsLogged += 1;
      if (inId !== null) movementsLogged += 1;
    }
    const now = formatCatalystDateTime(new Date());
    await catalystApp.datastore().table('StockTransfers').updateRow({
      ROWID: t.ROWID, status: 'Completed', completed_by: performedBy, completed_at: now,
    });
    const updated = await loadTransfer(catalystApp, t.ROWID);
    res.status(200).json({
      success: true,
      message: `Transfer ${t.transfer_number} completed.`,
      transfer: updated,
      movements_logged: movementsLogged,
    });
  } catch (error) {
    console.error('Error completing transfer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/transfers/:id/cancel — no inventory movement occurs. */
app.post('/api/transfers/:id/cancel', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager', 'Storekeeper'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Cancelling a transfer requires Admin, Manager or Storekeeper.' });
    }
    const t = await loadTransfer(catalystApp, req.params.id);
    if (!t) return res.status(404).json({ success: false, error: 'Transfer not found.' });
    if (['Completed', 'Cancelled'].includes(String(t.status))) {
      return res.status(400).json({ success: false, error: `Transfer ${t.transfer_number} is already ${t.status}.` });
    }
    await catalystApp.datastore().table('StockTransfers').updateRow({
      ROWID: t.ROWID, status: 'Cancelled',
    });
    const updated = await loadTransfer(catalystApp, t.ROWID);
    res.status(200).json({ success: true, message: `Transfer ${t.transfer_number} cancelled. No stock was moved.`, transfer: updated });
  } catch (error) {
    console.error('Error cancelling transfer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   PURCHASING — vendors → purchase orders → receiving → bills → payments
   --------------------------------------------------------------------------
   Receipt is the only purchasing action which changes stock. It reuses the
   WarehouseStock aggregate and StockMovements ledger, so a receipt raises
   stock in the selected PO warehouse exactly once and stays auditable.
   ========================================================================== */

function purchaseRole(ctx) { return normWhRole(ctx.orgUser && ctx.orgUser.role); }
function canUsePurchasing(role) { return ['Admin', 'Manager', 'Storekeeper'].includes(role); }
function canManagePayables(role) { return ['Admin', 'Manager'].includes(role); }
function purchaseNumber(prefix) { return `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')}`; }

async function purchaseRows(catalystApp, table, fields, where = '') {
  const rows = await catalystApp.zcql().executeZCQLQuery(`SELECT ${fields} FROM ${table}${where ? ` WHERE ${where}` : ''} ORDER BY CREATEDTIME DESC LIMIT 300`);
  return (rows || []).map((r) => r[table]).filter(Boolean);
}

async function vendorForPurchase(catalystApp, id) {
  if (!isDigitsId(id)) return null;
  return (await purchaseRows(catalystApp, 'Vendors', 'ROWID, vendor_number, name, email, phone, status', `ROWID = ${String(id)}`))[0] || null;
}

async function getPurchaseOrder(catalystApp, id) {
  if (!isDigitsId(id)) return null;
  const po = (await purchaseRows(catalystApp, 'PurchaseOrders', 'ROWID, po_number, vendor_id, warehouse_id, status, notes, expected_date, created_by, approved_by, received_by, created_at, approved_at, received_at, total_amount', `ROWID = ${String(id)}`))[0];
  if (!po) return null;
  po.items = await purchaseRows(catalystApp, 'PurchaseOrderItems', 'ROWID, purchase_order_id, product_id, quantity, received_quantity, unit_cost, tax_percentage', `purchase_order_id = '${sanitizeZcql(String(po.ROWID))}'`);
  return po;
}

function requirePurchaseAccess(res, ctx, payables = false) {
  const allowed = payables ? canManagePayables(purchaseRole(ctx)) : canUsePurchasing(purchaseRole(ctx));
  if (!allowed) {
    res.status(403).json({ success: false, error: payables ? 'This action requires Admin or Manager.' : 'Purchasing requires Admin, Manager or Storekeeper.' });
    return false;
  }
  return true;
}

app.get('/api/purchases/vendors', async (req, res) => {
  try {
    const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app);
    if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePurchaseAccess(res, ctx)) return;
    const data = await purchaseRows(app, 'Vendors', 'ROWID, vendor_number, name, email, phone, address, tax_number, status, notes, created_by, created_at, updated_at');
    res.status(200).json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/purchases/vendors', async (req, res) => {
  try {
    const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app);
    if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePurchaseAccess(res, ctx, true)) return;
    const b = req.body || {}; const name = String(b.name || '').trim();
    if (name === '') return res.status(400).json({ success: false, error: 'Vendor name is required.' });
    const now = formatCatalystDateTime(new Date());
    const row = await app.datastore().table('Vendors').insertRow({ vendor_number: purchaseNumber('VND'), name, email: String(b.email || '').trim(), phone: String(b.phone || '').trim(), address: String(b.address || '').trim(), tax_number: String(b.tax_number || '').trim(), status: String(b.status || 'Active'), notes: String(b.notes || '').trim(), created_by: await whActorEmail(req, app, ctx), created_at: now, updated_at: now });
    res.status(201).json({ success: true, message: 'Vendor created.', vendor: { ROWID: row.ROWID, name } });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/purchases/orders', async (req, res) => {
  try {
    const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app);
    if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePurchaseAccess(res, ctx)) return;
    const data = await purchaseRows(app, 'PurchaseOrders', 'ROWID, po_number, vendor_id, warehouse_id, status, notes, expected_date, created_by, approved_by, received_by, created_at, approved_at, received_at, total_amount');
    for (const po of data) po.items = await purchaseRows(app, 'PurchaseOrderItems', 'ROWID, purchase_order_id, product_id, quantity, received_quantity, unit_cost, tax_percentage', `purchase_order_id = '${sanitizeZcql(String(po.ROWID))}'`);
    res.status(200).json({ success: true, data });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/purchases/orders', async (req, res) => {
  try {
    const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app);
    if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePurchaseAccess(res, ctx)) return;
    const b = req.body || {}; const vendor = await vendorForPurchase(app, b.vendor_id); const warehouse = await findWarehouseById(app, b.warehouse_id);
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found.' });
    if (!warehouse || String(warehouse.status || 'Active') !== 'Active') return res.status(400).json({ success: false, error: 'Choose an active warehouse.' });
    if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ success: false, error: 'At least one purchase item is required.' });
    const items = []; let total = 0;
    for (const [index, line] of b.items.entries()) {
      const product = await getProductForWarehouse(app, line && line.product_id); const quantity = Number(line && line.quantity); const unitCost = Number(line && line.unit_cost); const tax = Math.max(0, Number(line && line.tax_percentage) || 0);
      if (!product) return res.status(404).json({ success: false, error: `Item ${index + 1}: product not found.` });
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitCost) || unitCost < 0) return res.status(400).json({ success: false, error: `Item ${index + 1}: quantity must be positive and unit cost cannot be negative.` });
      items.push({ product_id: String(product.ROWID), quantity, received_quantity: 0, unit_cost: unitCost, tax_percentage: tax }); total += quantity * unitCost * (1 + tax / 100);
    }
    const now = formatCatalystDateTime(new Date());
    const row = await app.datastore().table('PurchaseOrders').insertRow({ po_number: purchaseNumber('PO'), vendor_id: String(vendor.ROWID), warehouse_id: String(warehouse.ROWID), status: 'Draft', notes: String(b.notes || '').trim(), expected_date: String(b.expected_date || '').trim(), created_by: await whActorEmail(req, app, ctx), approved_by: '', received_by: '', created_at: now, approved_at: '', received_at: '', total_amount: Number(total.toFixed(2)) });
    for (const item of items) await app.datastore().table('PurchaseOrderItems').insertRow({ purchase_order_id: String(row.ROWID), ...item });
    const order = await getPurchaseOrder(app, row.ROWID);
    res.status(201).json({ success: true, message: `Purchase order ${order.po_number} created.`, order });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/purchases/orders/:id/approve', async (req, res) => {
  try {
    const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app);
    if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePurchaseAccess(res, ctx, true)) return;
    const po = await getPurchaseOrder(app, req.params.id);
    if (!po) return res.status(404).json({ success: false, error: 'Purchase order not found.' });
    if (String(po.status) !== 'Draft') return res.status(400).json({ success: false, error: `Purchase order ${po.po_number} is ${po.status} and cannot be approved.` });
    await app.datastore().table('PurchaseOrders').updateRow({ ROWID: po.ROWID, status: 'Approved', approved_by: await whActorEmail(req, app, ctx), approved_at: formatCatalystDateTime(new Date()) });
    res.status(200).json({ success: true, message: `Purchase order ${po.po_number} approved.`, order: await getPurchaseOrder(app, po.ROWID) });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/purchases/orders/:id/receive', async (req, res) => {
  try {
    const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app);
    if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePurchaseAccess(res, ctx)) return;
    const po = await getPurchaseOrder(app, req.params.id);
    if (!po) return res.status(404).json({ success: false, error: 'Purchase order not found.' });
    if (!['Approved', 'Partially received'].includes(String(po.status))) return res.status(400).json({ success: false, error: `Purchase order ${po.po_number} must be Approved before receiving.` });
    const warehouse = await findWarehouseById(app, po.warehouse_id); if (!warehouse) return res.status(400).json({ success: false, error: 'The purchase order warehouse no longer exists.' });
    const input = new Map((Array.isArray((req.body || {}).items) ? req.body.items : []).map((x) => [String(x.purchase_order_item_id || x.ROWID || ''), Number(x.quantity)]));
    if (input.size === 0) return res.status(400).json({ success: false, error: 'Choose at least one quantity to receive.' });
    const plan = [];
    for (const item of po.items) {
      const quantity = input.get(String(item.ROWID)); if (!Number.isFinite(quantity) || quantity === undefined || quantity <= 0) continue;
      const remaining = (Number(item.quantity) || 0) - (Number(item.received_quantity) || 0); if (quantity > remaining) return res.status(400).json({ success: false, error: 'Received quantity cannot exceed the outstanding purchase order quantity.' });
      const product = await getProductForWarehouse(app, item.product_id); if (!product) return res.status(400).json({ success: false, error: 'A product on this purchase order no longer exists.' });
      const stock = await getWarehouseStockRow(app, po.warehouse_id, item.product_id); plan.push({ item, product, quantity, before: stock ? Number(stock.quantity) || 0 : 0 });
    }
    if (plan.length === 0) return res.status(400).json({ success: false, error: 'Enter a quantity greater than zero for at least one outstanding line.' });
    const actor = await whActorEmail(req, app, ctx);
    for (const step of plan) {
      const after = step.before + step.quantity;
      await setWarehouseQuantity(app, po.warehouse_id, step.item.product_id, after); await syncProductStock(app, step.item.product_id);
      await app.datastore().table('PurchaseOrderItems').updateRow({ ROWID: step.item.ROWID, received_quantity: (Number(step.item.received_quantity) || 0) + step.quantity });
      await logStockMovement(app, { itemRowid: step.item.product_id, sku: step.product.sku, itemName: step.product.name, movementType: 'PURCHASE', quantityChange: step.quantity, stockBefore: step.before, stockAfter: after, referenceType: 'PURCHASE', referenceId: po.po_number, reason: `Purchase receipt ${po.po_number} into ${warehouse.name}`, performedBy: actor, warehouseId: po.warehouse_id });
    }
    const received = await getPurchaseOrder(app, po.ROWID); const complete = received.items.every((item) => (Number(item.received_quantity) || 0) >= (Number(item.quantity) || 0));
    await app.datastore().table('PurchaseOrders').updateRow({ ROWID: po.ROWID, status: complete ? 'Received' : 'Partially received', received_by: actor, received_at: formatCatalystDateTime(new Date()) });
    res.status(200).json({ success: true, message: `${po.po_number} receipt recorded in ${warehouse.name}.`, order: await getPurchaseOrder(app, po.ROWID) });
  } catch (error) { console.error('Error receiving purchase order:', error.message); res.status(500).json({ success: false, error: error.message }); }
});

async function getVendorBill(app, id) {
  if (!isDigitsId(id)) return null;
  return (await purchaseRows(app, 'VendorBills', 'ROWID, bill_number, vendor_id, purchase_order_id, status, bill_date, due_date, total_amount, paid_amount, notes, created_by, created_at', `ROWID = ${String(id)}`))[0] || null;
}

app.get('/api/purchases/bills', async (req, res) => {
  try { const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app); if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' }); if (!requirePurchaseAccess(res, ctx)) return; res.status(200).json({ success: true, data: await purchaseRows(app, 'VendorBills', 'ROWID, bill_number, vendor_id, purchase_order_id, status, bill_date, due_date, total_amount, paid_amount, notes, created_by, created_at') }); } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/purchases/bills', async (req, res) => {
  try {
    const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app); if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' }); if (!requirePurchaseAccess(res, ctx, true)) return;
    const b = req.body || {}; const vendor = await vendorForPurchase(app, b.vendor_id); const total = Number(b.total_amount);
    if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found.' }); if (!Number.isFinite(total) || total < 0) return res.status(400).json({ success: false, error: 'Bill total must be zero or greater.' });
    if (b.purchase_order_id && !await getPurchaseOrder(app, b.purchase_order_id)) return res.status(404).json({ success: false, error: 'Purchase order not found.' });
    const number = purchaseNumber('BILL'); const row = await app.datastore().table('VendorBills').insertRow({ bill_number: number, vendor_id: String(vendor.ROWID), purchase_order_id: String(b.purchase_order_id || ''), status: 'Open', bill_date: String(b.bill_date || '').trim(), due_date: String(b.due_date || '').trim(), total_amount: total, paid_amount: 0, notes: String(b.notes || '').trim(), created_by: await whActorEmail(req, app, ctx), created_at: formatCatalystDateTime(new Date()) });
    res.status(201).json({ success: true, message: 'Vendor bill created.', bill: { ROWID: row.ROWID, bill_number: number, total_amount: total, paid_amount: 0, status: 'Open' } });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.get('/api/purchases/payments', async (req, res) => {
  try { const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app); if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' }); if (!requirePurchaseAccess(res, ctx)) return; res.status(200).json({ success: true, data: await purchaseRows(app, 'VendorPayments', 'ROWID, payment_number, vendor_id, bill_id, type, payment_method, payment_date, reference, amount, notes, created_by, created_at') }); } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

app.post('/api/purchases/payments', async (req, res) => {
  try {
    const app = catalyst.initialize(req); const ctx = await getCurrentOrgUser(req, app); if (!ctx) return res.status(401).json({ success: false, error: 'Not authenticated' }); if (!requirePurchaseAccess(res, ctx, true)) return;
    const b = req.body || {}; const amount = Number(b.amount); const vendor = await vendorForPurchase(app, b.vendor_id); if (!vendor) return res.status(404).json({ success: false, error: 'Vendor not found.' }); if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ success: false, error: 'Payment amount must be greater than zero.' });
    const bill = b.bill_id ? await getVendorBill(app, b.bill_id) : null; if (b.bill_id && (!bill || String(bill.vendor_id) !== String(vendor.ROWID))) return res.status(400).json({ success: false, error: 'Choose a bill belonging to this vendor.' });
    if (bill && amount > (Number(bill.total_amount) || 0) - (Number(bill.paid_amount) || 0)) return res.status(400).json({ success: false, error: 'Payment exceeds the outstanding bill balance.' });
    const type = String(b.type || 'Payment'); const paymentNumber = purchaseNumber(type === 'Credit' ? 'CRN' : 'PAY'); const row = await app.datastore().table('VendorPayments').insertRow({ payment_number: paymentNumber, vendor_id: String(vendor.ROWID), bill_id: bill ? String(bill.ROWID) : '', type, payment_method: String(b.payment_method || 'Cash'), payment_date: String(b.payment_date || '').trim(), reference: String(b.reference || '').trim(), amount, notes: String(b.notes || '').trim(), created_by: await whActorEmail(req, app, ctx), created_at: formatCatalystDateTime(new Date()) });
    if (bill) { const paid = (Number(bill.paid_amount) || 0) + amount; await app.datastore().table('VendorBills').updateRow({ ROWID: bill.ROWID, paid_amount: paid, status: paid >= (Number(bill.total_amount) || 0) ? 'Paid' : 'Partially paid' }); }
    res.status(201).json({ success: true, message: `${type} recorded.`, payment: { ROWID: row.ROWID, payment_number: paymentNumber, amount, type } });
  } catch (error) { res.status(500).json({ success: false, error: error.message }); }
});

/* ===========================================================================
   CUSTOMER LOYALTY FOUNDATION (CUST-05)
   --------------------------------------------------------------------------
   New Data Store tables (provision via Catalyst Console → Data Store):

     Customers        name, phone, email, address, company, type,
                      loyalty_points, lifetime_points, tier,
                      joined_at, last_activity_at, updated_at
     CustomerActivity customer_id, delta, old_points, new_points,
                      reason, performed_by, created_at

   Migration: customers previously lived as `crm_*` JSON blobs in
   Configurations (see /api/contacts) or in Zoho Books. The first
   GET /api/customers backfills every legacy local contact into the
   Customers table (idempotent, matched by email then name), so no
   history is lost. /api/contacts is intentionally untouched — legacy
   callers keep working while new code uses /api/customers.

   Loyalty engine: LKR `points_per_currency` spent = 1 point (default
   100, config-driven via Settings → Customer Loyalty). Tiers derive
   from lifetime_points against configurable thresholds.
   ========================================================================== */

/** Read the loyalty configuration (org-scoped Settings keys, safe defaults). */
async function getLoyaltyConfig(catalystApp, orgId) {
  const booksService = new ZohoBooksService(catalystApp, null);
  const cfg = {
    enabled: true,
    points_per_currency: 100,
    tier_active: 100,
    tier_loyal: 500,
    tier_vip: 1000,
    manual_adjustments: true,
    allow_no_email: true,
  };
  try {
    const prefix = orgId ? `org_${orgId}_setting_` : null;
    const read = async (key, fallbackKey) => {
      if (prefix) {
        try {
          const v = await booksService.getConfig(`${prefix}${key}`);
          if (v !== undefined && v !== null && String(v) !== '') return v;
        } catch (e) { /* next fallback */ }
      }
      if (fallbackKey) {
        try {
          const v = await booksService.getConfig(fallbackKey);
          if (v !== undefined && v !== null && String(v) !== '') return v;
        } catch (e) { /* default */ }
      }
      return undefined;
    };
    const truthy = (v, dflt) => {
      if (v === undefined) return dflt;
      if (v === true || v === 1) return true;
      if (v === false || v === 0) return false;
      const s = String(v).trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes') return true;
      if (s === 'false' || s === '0' || s === 'no') return false;
      return dflt;
    };
    const num = (v, dflt, min) => {
      if (v === undefined) return dflt;
      const n = Number(v);
      if (!Number.isFinite(n) || n < min) return dflt;
      return n;
    };
    cfg.enabled = truthy(await read('loyalty_enabled', 'loyalty_enabled'), true);
    cfg.points_per_currency = num(await read('loyalty_points_per_currency', 'loyalty_points_per_currency'), 100, 1);
    cfg.tier_active = num(await read('loyalty_tier_active', 'loyalty_tier_active'), 100, 1);
    cfg.tier_loyal = num(await read('loyalty_tier_loyal', 'loyalty_tier_loyal'), 500, 1);
    cfg.tier_vip = num(await read('loyalty_tier_vip', 'loyalty_tier_vip'), 1000, 1);
    cfg.manual_adjustments = truthy(await read('loyalty_manual_adjustments', 'loyalty_manual_adjustments'), true);
    cfg.allow_no_email = truthy(await read('loyalty_allow_no_email', 'loyalty_allow_no_email'), true);
  } catch (e) { /* safe defaults stand */ }
  // Keep thresholds ordered so tier assignment is monotonic.
  const sorted = [cfg.tier_active, cfg.tier_loyal, cfg.tier_vip].sort((a, b) => a - b);
  cfg.tier_active = sorted[0];
  cfg.tier_loyal = sorted[1];
  cfg.tier_vip = sorted[2];
  return cfg;
}

/** CUST-05 service: points earned for an order total (floor, never negative). */
function calculateLoyaltyPoints(orderTotal, pointsPerCurrency) {
  const total = Number(orderTotal) || 0;
  const ppc = Number(pointsPerCurrency) || 100;
  if (total <= 0 || ppc <= 0) return 0;
  return Math.floor(total / ppc);
}

/** CUST-05 service: tier from lifetime points + thresholds. */
function calculateCustomerTier(lifetimePoints, thresholds) {
  const lp = Number(lifetimePoints) || 0;
  const t = thresholds || { tier_active: 100, tier_loyal: 500, tier_vip: 1000 };
  if (lp >= t.tier_vip) return 'VIP';
  if (lp >= t.tier_loyal) return 'Loyal';
  if (lp >= t.tier_active) return 'Active';
  return 'New';
}

/** CUST-04 service: lifetime value = sum of non-voided order totals. */
function calculateLifetimeValue(orders) {
  return (orders || []).reduce((s, o) => {
    if (String(o.status ?? '').toLowerCase() === 'voided') return s;
    return s + (Number(o.total) || 0);
  }, 0);
}

/** CUST-03 service: purchase frequency = orders in the trailing window. */
function calculatePurchaseFrequency(orders, windowDays) {
  const days = Number(windowDays) > 0 ? Number(windowDays) : 30;
  const list = (orders || []).filter((o) => String(o.status ?? '').toLowerCase() !== 'voided');
  if (list.length === 0) return 0;
  const cutoff = Date.now() - days * 86400000;
  let recent = 0;
  let undated = 0;
  for (const o of list) {
    const t = new Date(String(o.CREATEDTIME ?? '')).getTime();
    if (!Number.isFinite(t)) {
      undated += 1;
    } else if (t >= cutoff) {
      recent += 1;
    }
  }
  // Undated legacy rows count toward the window (they exist, date unknown).
  return recent + undated;
}

/** Orders belonging to a customer (email match first, name fallback). */
async function getCustomerOrders(catalystApp, customer) {
  const email = String(customer.email ?? '').trim().toLowerCase();
  const name = String(customer.name ?? '').trim().toLowerCase();
  let rows = [];
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      'SELECT ROWID, customer_name, customer_email, subtotal, tax_amount, total, payment_mode, status, books_invoice_id, invoice_number, local_ref, CREATEDTIME FROM Orders ORDER BY CREATEDTIME DESC LIMIT 300'
    );
    rows = (r || []).map((x) => x.Orders).filter(Boolean);
  } catch (e) {
    return [];
  }
  return rows.filter((o) => {
    const oe = String(o.customer_email ?? '').trim().toLowerCase();
    const on = String(o.customer_name ?? '').trim().toLowerCase();
    if (email !== '' && oe !== '' && oe === email) return true;
    if (email !== '' && oe !== '' ) return false;
    return name !== '' && on === name;
  });
}

/**
 * CUST service: recompute a customer's derived metrics (LTV, order count,
 * frequency, last activity, tier) from live Orders + stored lifetime
 * points. Persists tier/last_activity_at; returns the metric bundle.
 */
async function recalculateCustomerMetrics(catalystApp, customerRowId, loyaltyCfg) {
  const key = String(customerRowId ?? '').trim();
  if (!isDigitsId(key)) return null;
  const rows = await safeZcql(catalystApp,
    `SELECT ROWID, name, email, loyalty_points, lifetime_points, tier, last_activity_at FROM Customers WHERE ROWID = ${key} LIMIT 1`
  );
  if (!rows || rows.length === 0) return null;
  const c = rows[0].Customers;
  const orders = await getCustomerOrders(catalystApp, c);
  const lifetimeValue = calculateLifetimeValue(orders);
  const frequency = calculatePurchaseFrequency(orders, 30);
  const lastOrder = orders
    .map((o) => String(o.CREATEDTIME ?? ''))
    .filter(Boolean)
    .sort()
    .pop() || '';
  const tier = calculateCustomerTier(c.lifetime_points, loyaltyCfg);
  try {
    const patch = {
      ROWID: c.ROWID,
      tier,
      updated_at: formatCatalystDateTime(new Date()),
    };
    if (lastOrder !== '') {
      patch.last_activity_at = lastOrder;
    } else if (c.last_activity_at) {
      patch.last_activity_at = c.last_activity_at;
    }
    await catalystApp.datastore().table('Customers').updateRow(patch);
  } catch (e) {
    console.warn('[LOYALTY] Metric persist skipped:', e.message);
  }
  return {
    order_count: orders.length,
    lifetime_value: lifetimeValue,
    purchase_frequency_30d: Math.round(frequency * 100) / 100,
    average_order_value: orders.length > 0 ? lifetimeValue / orders.length : 0,
    last_order_at: lastOrder,
    tier,
  };
}

function shapeCustomer(c) {
  return {
    ROWID: c.ROWID,
    id: String(c.ROWID ?? c.email ?? c.name ?? ''),
    name: c.name ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    address: c.address ?? '',
    company: c.company ?? '',
    type: c.type ?? 'Customer',
    loyalty_points: Number(c.loyalty_points) || 0,
    lifetime_points: Number(c.lifetime_points) || 0,
    tier: c.tier ?? 'New',
    joined_at: c.joined_at ?? null,
    last_activity_at: c.last_activity_at ?? null,
    updated_at: c.updated_at ?? null,
  };
}

/** Legacy crm_* contacts (Configurations JSON blobs) for one-time migration. */
async function readLegacyContacts(catalystApp) {
  try {
    const rows = await safeZcql(catalystApp,
      `SELECT config_key, config_value FROM Configurations WHERE config_key LIKE 'crm_%'`
    );
    return (rows || [])
      .map((r) => {
        try {
          return JSON.parse(r.Configurations.config_value);
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return [];
  }
}

/**
 * Idempotent migration: every legacy contact gets a Customers row,
 * matched by email then name. Returns { migrated }.
 */
async function backfillCustomers(catalystApp) {
  const legacy = await readLegacyContacts(catalystApp);
  if (legacy.length === 0) return { migrated: 0 };
  let existing = [];
  try {
    const r = await fetchAllZcql(catalystApp, 'ROWID, name, email', 'Customers', '', 10);
    existing = (r || []).map((x) => x.Customers).filter(Boolean);
  } catch (e) {
    throw new Error('No Such Table: Customers');
  }
  const emails = new Set(existing.map((c) => String(c.email ?? '').trim().toLowerCase()).filter(Boolean));
  const names = new Set(existing.map((c) => String(c.name ?? '').trim().toLowerCase()).filter(Boolean));
  const table = catalystApp.datastore().table('Customers');
  const now = formatCatalystDateTime(new Date());
  let migrated = 0;
  for (const lc of legacy) {
    const email = String(lc.email ?? '').trim();
    const name = String(lc.name ?? lc.contact_name ?? '').trim();
    if (name === '') continue;
    if (email !== '' && emails.has(email.toLowerCase())) continue;
    if (email === '' && names.has(name.toLowerCase())) continue;
    try {
      await table.insertRow({
        name,
        phone: String(lc.phone ?? ''),
        email,
        address: String(lc.address ?? ''),
        company: String(lc.company ?? lc.company_name ?? ''),
        type: String(lc.type ?? lc.contact_type ?? 'Customer'),
        loyalty_points: 0,
        lifetime_points: 0,
        tier: 'New',
        joined_at: now,
        updated_at: now,
      });
      if (email !== '') emails.add(email.toLowerCase());
      else names.add(name.toLowerCase());
      migrated += 1;
    } catch (e) {
      console.warn('[LOYALTY] Contact migration skipped:', e.message);
    }
  }
  return { migrated };
}

/* ---------------- Bounded multi-page ZCQL reads ----------------
   ZCQL rejects LIMIT > 300, so collections that can outgrow one page are
   read newest-first with a ROWID cursor (ROWIDs are monotonic digit
   strings). Identical rows to LIMIT 300 while small; pages transparently
   when large. maxPages guards runaway reads. Throws when the table (or a
   selected column) is missing — callers keep their existing fallbacks. */

async function fetchAllZcql(catalystApp, select, table, where, maxPages) {
  const pages = Math.min(20, Math.max(1, Number(maxPages) || 5));
  const out = [];
  const seen = new Set();
  let cursor = '';
  for (let p = 0; p < pages; p++) {
    const conds = [];
    if (where) conds.push(`(${where})`);
    if (cursor !== '') conds.push(`ROWID < ${cursor}`);
    const whereClause = conds.length > 0 ? ` WHERE ${conds.join(' AND ')}` : '';
    const r = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ${select} FROM ${table}${whereClause} ORDER BY ROWID DESC LIMIT 300`
    );
    const rows = r || [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const key = row && row[table] ? String(row[table].ROWID ?? '') : '';
      if (key === '' || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    if (rows.length < 300) break;
    const ids = rows
      .map((row) => (row && row[table] ? String(row[table].ROWID ?? '') : ''))
      .filter((v) => /^[0-9]+$/.test(v));
    if (ids.length === 0) break;
    cursor = ids.reduce((a, b) => (BigInt(a) < BigInt(b) ? a : b));
  }
  return out;
}

/** Fetch all customers (paged; filtered in JS). Throws when missing. */
async function listAllCustomers(catalystApp) {
  let rows;
  try {
    rows = await fetchAllZcql(catalystApp,
      'ROWID, name, phone, email, address, company, type, loyalty_points, lifetime_points, tier, joined_at, last_activity_at, updated_at',
      'Customers', '', 10);
  } catch (fullErr) {
    // Deployments provisioned with the core profile columns only.
    rows = await fetchAllZcql(catalystApp,
      'ROWID, name, phone, email, address, company, type', 'Customers', '', 10);
  }
  return (rows || []).map((r) => r.Customers).filter(Boolean);
}

async function findCustomerById(catalystApp, id) {
  if (!isDigitsId(id)) return null;
  const rows = await safeZcql(catalystApp,
    `SELECT ROWID, name, phone, email, address, company, type, loyalty_points, lifetime_points, tier, joined_at, last_activity_at, updated_at FROM Customers WHERE ROWID = ${String(id).trim()} LIMIT 1`
  );
  if (rows && rows.length > 0) return rows[0].Customers;
  // Core-columns fallback.
  const slim = await safeZcql(catalystApp,
    `SELECT ROWID, name, phone, email, address, company, type FROM Customers WHERE ROWID = ${String(id).trim()} LIMIT 1`
  );
  if (slim && slim.length > 0) return { loyalty_points: 0, lifetime_points: 0, tier: 'New', ...slim[0].Customers };
  return null;
}

/** Match a checkout identity to a customer row (email first, name fallback). */
async function matchCustomerForOrder(catalystApp, customerName, customerEmail) {
  const email = String(customerEmail ?? '').trim().toLowerCase();
  const rawName = String(customerName ?? '').trim();
  // Room suffixes ("Name (101)") are a POS display concern, not identity.
  const name = rawName.replace(/\s*\([^)]*\)\s*$/, '').trim().toLowerCase();
  let all = [];
  try {
    all = await listAllCustomers(catalystApp);
  } catch (e) {
    return null;
  }
  if (email !== '' && email !== 'walkin@pos.system') {
    const hit = all.find((c) => String(c.email ?? '').trim().toLowerCase() === email);
    if (hit) return hit;
  }
  if (name !== '' && name !== 'walk-in guest') {
    const hit = all.find((c) => String(c.name ?? '').trim().toLowerCase() === name);
    if (hit) return hit;
  }
  return null;
}

/** Append an audit record; fails open (never blocks the caller). */
async function logCustomerActivity(catalystApp, { customerId, delta, oldPoints, newPoints, reason, performedBy }) {
  try {
    await catalystApp.datastore().table('CustomerActivity').insertRow({
      customer_id: String(customerId ?? ''),
      delta: Number(delta) || 0,
      old_points: Number(oldPoints) || 0,
      new_points: Number(newPoints) || 0,
      reason: String(reason ?? ''),
      performed_by: String(performedBy ?? ''),
      created_at: formatCatalystDateTime(new Date()),
    });
    return true;
  } catch (err) {
    console.warn('[LOYALTY] Activity log skipped (provision CustomerActivity):', err.message);
    return false;
  }
}

/**
 * CUST-05 order integration: find-or-create the customer, award
 * floor(total / points_per_currency) points, bump lifetime_points,
 * stamp last_activity_at, recalculate tier, audit the earn.
 * Walk-in/unidentified sales are skipped. Returns points awarded.
 */
async function accrueLoyaltyForOrder(catalystApp, orgUserContext, { customerName, customerEmail, orderTotal, orderId, performedBy }) {
  const orgId = orgUserContext && orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
  const cfg = await getLoyaltyConfig(catalystApp, orgId);
  if (!cfg.enabled) return 0;
  const email = String(customerEmail ?? '').trim();
  const name = String(customerName ?? '').trim();
  const bareName = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const identified = (email !== '' && email.toLowerCase() !== 'walkin@pos.system')
    || (bareName !== '' && bareName.toLowerCase() !== 'walk-in guest');
  if (!identified) return 0;
  if (email === '' && !cfg.allow_no_email) return 0;
  const earned = calculateLoyaltyPoints(orderTotal, cfg.points_per_currency);
  const now = formatCatalystDateTime(new Date());
  let customer = await matchCustomerForOrder(catalystApp, name, email);
  if (!customer) {
    // First purchase: create the profile so points have a home.
    try {
      const row = await catalystApp.datastore().table('Customers').insertRow({
        name: bareName || name || email,
        phone: '',
        email: email.toLowerCase() === 'walkin@pos.system' ? '' : email,
        address: '',
        company: '',
        type: 'Customer',
        loyalty_points: 0,
        lifetime_points: 0,
        tier: 'New',
        joined_at: now,
        last_activity_at: now,
        updated_at: now,
      });
      customer = { ROWID: row.ROWID, name: bareName || name || email, email, loyalty_points: 0, lifetime_points: 0, tier: 'New' };
    } catch (e) {
      return 0; // Customers table not provisioned — checkout continues.
    }
  }
  if (earned <= 0) {
    // No points, but keep the activity stamp fresh.
    try {
      await catalystApp.datastore().table('Customers').updateRow({
        ROWID: customer.ROWID, last_activity_at: now, updated_at: now,
      });
    } catch (e) { /* best-effort */ }
    return 0;
  }
  const oldPts = Number(customer.loyalty_points) || 0;
  const oldLife = Number(customer.lifetime_points) || 0;
  const newPts = oldPts + earned;
  const newLife = oldLife + earned;
  const tier = calculateCustomerTier(newLife, cfg);
  await catalystApp.datastore().table('Customers').updateRow({
    ROWID: customer.ROWID,
    loyalty_points: newPts,
    lifetime_points: newLife,
    tier,
    last_activity_at: now,
    updated_at: now,
  });
  await logCustomerActivity(catalystApp, {
    customerId: customer.ROWID,
    delta: earned,
    oldPoints: oldPts,
    newPoints: newPts,
    reason: `Earned from order ${orderId} (${cfg.points_per_currency} spent = 1 pt)`,
    performedBy: performedBy || 'POS Checkout',
  });
  return earned;
}

/* ---------------- Customer CRUD (CUST-01) ---------------- */

/** GET /api/customers — directory with loyalty balances + live order stats. */
app.get('/api/customers', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    let customers;
    try {
      customers = await listAllCustomers(catalystApp);
    } catch (e) {
      console.error('[CUSTOMERS_503]', e, e?.message, e?.code);
      return whMissingTable(res, 'Customers');
    }
    // One-time migration from legacy crm_* blobs.
    try {
      const { migrated } = await backfillCustomers(catalystApp);
      if (migrated > 0) customers = await listAllCustomers(catalystApp);
    } catch (e) {
      console.warn('[LOYALTY] Backfill skipped:', e.message);
    }
    const cfg = await getLoyaltyConfig(catalystApp, orgId);
    // Bounded order scan for live LTV/counts (best-effort enrichment).
    let orders = [];
    try {
      const r = await catalystApp.zcql().executeZCQLQuery(
        'SELECT customer_name, customer_email, total, status, CREATEDTIME FROM Orders ORDER BY CREATEDTIME DESC LIMIT 300'
      );
      orders = (r || []).map((x) => x.Orders).filter(Boolean);
    } catch (e) { orders = []; }
    const byEmail = new Map();
    const byName = new Map();
    for (const o of orders) {
      const oe = String(o.customer_email ?? '').trim().toLowerCase();
      const on = String(o.customer_name ?? '').trim().toLowerCase().replace(/\s*\([^)]*\)\s*$/, '');
      if (oe !== '' && oe !== 'walkin@pos.system') {
        const list = byEmail.get(oe) ?? [];
        list.push(o);
        byEmail.set(oe, list);
      }
      if (on !== '' && on !== 'walk-in guest') {
        const list = byName.get(on) ?? [];
        list.push(o);
        byName.set(on, list);
      }
    }
    const q = String((req.query && req.query.search) || '').trim().toLowerCase();
    const tierFilter = String((req.query && req.query.tier) || '').trim().toLowerCase();
    let data = customers.map((c) => {
      const email = String(c.email ?? '').trim().toLowerCase();
      const name = String(c.name ?? '').trim().toLowerCase();
      const mine = (email !== '' && byEmail.get(email)) || byName.get(name) || [];
      const valid = mine.filter((o) => String(o.status ?? '').toLowerCase() !== 'voided');
      const lifetimeValue = calculateLifetimeValue(valid);
      const lastOrder = valid.map((o) => String(o.CREATEDTIME ?? '')).filter(Boolean).sort().pop() || '';
      const base = shapeCustomer(c);
      return {
        ...base,
        // Server tier derives from lifetime_points; display falls back to
        // the order-based estimate when the program hasn't issued points.
        tier: base.tier && base.tier !== 'New' ? base.tier : undefined,
        order_count: valid.length,
        lifetime_value: lifetimeValue,
        average_order_value: valid.length > 0 ? lifetimeValue / valid.length : 0,
        last_order_at: lastOrder,
      };
    });
    // Fill tier display estimate where the stored tier is still New.
    data = data.map((c) => ({
      ...c,
      tier: c.tier ?? calculateCustomerTier(c.lifetime_points || 0, cfg),
    }));
    if (q !== '') {
      data = data.filter((c) =>
        c.name.toLowerCase().includes(q)
        || c.email.toLowerCase().includes(q)
        || String(c.phone ?? '').includes(q)
        || String(c.company ?? '').toLowerCase().includes(q)
      );
    }
    if (['new', 'active', 'loyal', 'vip'].includes(tierFilter)) {
      data = data.filter((c) => String(c.tier).toLowerCase() === tierFilter);
    }
    data.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!roleCan(callerRole(orgUserContext), 'manage_customers')) data = data.map(customerLookup);
    res.status(200).json({ success: true, count: data.length, data, loyalty: { enabled: cfg.enabled, points_per_currency: cfg.points_per_currency } });
  } catch (error) {
    console.error('Error listing customers:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/customers/:id — profile with metrics + loyalty activity. */
app.get('/api/customers/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    let c;
    try {
      c = await findCustomerById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Customers');
    }
    if (!c) return res.status(404).json({ success: false, error: 'Customer not found.' });
    if (!roleCan(callerRole(orgUserContext), 'manage_customers')) {
      return res.status(200).json({ success: true, customer: customerLookup(shapeCustomer(c)), recent_orders: [], loyalty_activity: [] });
    }
    const cfg = await getLoyaltyConfig(catalystApp, orgId);
    const metrics = await recalculateCustomerMetrics(catalystApp, c.ROWID, cfg);
    let activity = [];
    try {
      const r = await catalystApp.zcql().executeZCQLQuery(
        `SELECT ROWID, delta, old_points, new_points, reason, performed_by, created_at FROM CustomerActivity WHERE customer_id = '${sanitizeZcql(String(c.ROWID))}' ORDER BY CREATEDTIME DESC LIMIT 20`
      );
      activity = (r || []).map((x) => x.CustomerActivity).filter(Boolean);
    } catch (e) { activity = []; }
    const orders = await getCustomerOrders(catalystApp, c);
    res.status(200).json({
      success: true,
      customer: { ...shapeCustomer(c), ...(metrics || {}) },
      recent_orders: orders.slice(0, 10),
      loyalty_activity: activity,
    });
  } catch (error) {
    console.error('Error fetching customer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/customers — create (Admin/Manager/Cashier). */
app.post('/api/customers', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager', 'Cashier'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Creating customers requires Admin, Manager or Cashier.' });
    }
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    const cfg = await getLoyaltyConfig(catalystApp, orgId);
    const { name, phone, email, address, company, type } = req.body || {};
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ success: false, error: 'Customer name is required.' });
    }
    const cleanEmail = String(email ?? '').trim();
    if (cleanEmail === '' && !cfg.allow_no_email) {
      return res.status(400).json({ success: false, error: 'Email is required (see Settings → Customer Loyalty).' });
    }
    if (cleanEmail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Email address looks invalid.' });
    }
    let all = [];
    try {
      all = await listAllCustomers(catalystApp);
    } catch (e) {
      return whMissingTable(res, 'Customers');
    }
    if (cleanEmail !== '' && all.some((c) => String(c.email ?? '').trim().toLowerCase() === cleanEmail.toLowerCase())) {
      return res.status(409).json({ success: false, error: `A customer with email '${cleanEmail}' already exists.` });
    }
    const now = formatCatalystDateTime(new Date());
    const row = await catalystApp.datastore().table('Customers').insertRow({
      name: String(name).trim(),
      phone: String(phone ?? '').trim(),
      email: cleanEmail,
      address: String(address ?? '').trim(),
      company: String(company ?? '').trim(),
      type: String(type ?? 'Customer').trim() || 'Customer',
      loyalty_points: 0,
      lifetime_points: 0,
      tier: 'New',
      joined_at: now,
      updated_at: now,
    });
    const created = await findCustomerById(catalystApp, row.ROWID);
    res.status(201).json({ success: true, message: 'Customer created.', customer: shapeCustomer(created || { ROWID: row.ROWID, ...req.body }) });
  } catch (error) {
    console.error('Error creating customer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** PUT /api/customers/:id — update (Admin/Manager). */
app.put('/api/customers/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Updating customers requires Admin or Manager.' });
    }
    let c;
    try {
      c = await findCustomerById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Customers');
    }
    if (!c) return res.status(404).json({ success: false, error: 'Customer not found.' });
    const { name, phone, email, address, company, type } = req.body || {};
    const patch = { ROWID: c.ROWID, updated_at: formatCatalystDateTime(new Date()) };
    if (name !== undefined) {
      if (String(name).trim() === '') return res.status(400).json({ success: false, error: 'Customer name cannot be empty.' });
      patch.name = String(name).trim();
    }
    if (phone !== undefined) patch.phone = String(phone).trim();
    if (email !== undefined) {
      const cleanEmail = String(email).trim();
      if (cleanEmail !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return res.status(400).json({ success: false, error: 'Email address looks invalid.' });
      }
      if (cleanEmail !== '') {
        const all = await listAllCustomers(catalystApp);
        if (all.some((x) => String(x.ROWID) !== String(c.ROWID) && String(x.email ?? '').trim().toLowerCase() === cleanEmail.toLowerCase())) {
          return res.status(409).json({ success: false, error: `A customer with email '${cleanEmail}' already exists.` });
        }
      }
      patch.email = cleanEmail;
    }
    if (address !== undefined) patch.address = String(address).trim();
    if (company !== undefined) patch.company = String(company).trim();
    if (type !== undefined) patch.type = String(type).trim() || 'Customer';
    await catalystApp.datastore().table('Customers').updateRow(patch);
    const updated = await findCustomerById(catalystApp, c.ROWID);
    res.status(200).json({ success: true, message: 'Customer updated.', customer: shapeCustomer(updated || { ...c, ...patch }) });
  } catch (error) {
    console.error('Error updating customer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** DELETE /api/customers/:id — Admin only. Blocks when orders reference the customer. */
app.delete('/api/customers/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (role !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Deleting customers requires Admin.' });
    }
    let c;
    try {
      c = await findCustomerById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Customers');
    }
    if (!c) return res.status(404).json({ success: false, error: 'Customer not found.' });
    const orders = await getCustomerOrders(catalystApp, c);
    if (orders.length > 0) {
      return res.status(409).json({
        success: false,
        error: `Customer '${c.name}' has ${orders.length} order${orders.length === 1 ? '' : 's'} on record and cannot be deleted. Purchase history is preserved for reporting.`,
      });
    }
    await catalystApp.datastore().table('Customers').deleteRow(c.ROWID);
    res.status(200).json({ success: true, message: `Customer '${c.name}' deleted.` });
  } catch (error) {
    console.error('Error deleting customer:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- Loyalty (CUST-05) ---------------- */

/** GET /api/customers/:id/loyalty — balances, tier, earn rate, activity. */
app.get('/api/customers/:id/loyalty', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    let c;
    try {
      c = await findCustomerById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Customers');
    }
    if (!c) return res.status(404).json({ success: false, error: 'Customer not found.' });
    const cfg = await getLoyaltyConfig(catalystApp, orgId);
    const metrics = await recalculateCustomerMetrics(catalystApp, c.ROWID, cfg);
    let activity = [];
    try {
      const r = await catalystApp.zcql().executeZCQLQuery(
        `SELECT ROWID, delta, old_points, new_points, reason, performed_by, created_at FROM CustomerActivity WHERE customer_id = '${sanitizeZcql(String(c.ROWID))}' ORDER BY CREATEDTIME DESC LIMIT 50`
      );
      activity = (r || []).map((x) => x.CustomerActivity).filter(Boolean);
    } catch (e) { activity = []; }
    const issued = activity.filter((a) => Number(a.delta) > 0).reduce((s, a) => s + Number(a.delta), 0);
    const redeemed = Math.abs(activity.filter((a) => Number(a.delta) < 0).reduce((s, a) => s + Number(a.delta), 0));
    res.status(200).json({
      success: true,
      loyalty: {
        customer_id: String(c.ROWID),
        customer_name: c.name,
        loyalty_points: Number(c.loyalty_points) || 0,
        lifetime_points: Number(c.lifetime_points) || 0,
        tier: (metrics && metrics.tier) || c.tier || 'New',
        points_issued: issued,
        points_redeemed: redeemed,
        order_count: metrics ? metrics.order_count : 0,
        lifetime_value: metrics ? metrics.lifetime_value : 0,
        program: {
          enabled: cfg.enabled,
          points_per_currency: cfg.points_per_currency,
          thresholds: { active: cfg.tier_active, loyal: cfg.tier_loyal, vip: cfg.tier_vip },
        },
        activity,
      },
    });
  } catch (error) {
    console.error('Error fetching loyalty:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customers/:id/adjust-points { points, reason }
 * Manual correction (Admin/Manager only). Audited in CustomerActivity.
 * Positive adds, negative redeems (balance can never go below zero).
 */
app.post('/api/customers/:id/adjust-points', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Adjusting loyalty points requires Admin or Manager.' });
    }
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    const cfg = await getLoyaltyConfig(catalystApp, orgId);
    if (!cfg.enabled) {
      return res.status(400).json({ success: false, error: 'The loyalty program is disabled (see Settings → Customer Loyalty).' });
    }
    if (!cfg.manual_adjustments && role !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Manual point adjustments are disabled (see Settings → Customer Loyalty).' });
    }
    let c;
    try {
      c = await findCustomerById(catalystApp, req.params.id);
    } catch (e) {
      return whMissingTable(res, 'Customers');
    }
    if (!c) return res.status(404).json({ success: false, error: 'Customer not found.' });
    const { points, reason } = req.body || {};
    const delta = Number(points);
    if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > 100000) {
      return res.status(400).json({ success: false, error: 'points must be a non-zero number within ±100000.' });
    }
    if (!reason || String(reason).trim() === '') {
      return res.status(400).json({ success: false, error: 'A reason is required for every point adjustment (audit).' });
    }
    const oldPts = Number(c.loyalty_points) || 0;
    const newPts = oldPts + delta;
    if (newPts < 0) {
      return res.status(400).json({ success: false, error: `Insufficient points balance (has ${oldPts}, tried ${delta}).` });
    }
    const oldLife = Number(c.lifetime_points) || 0;
    const newLife = delta > 0 ? oldLife + delta : oldLife;
    const tier = calculateCustomerTier(newLife, cfg);
    const now = formatCatalystDateTime(new Date());
    await catalystApp.datastore().table('Customers').updateRow({
      ROWID: c.ROWID,
      loyalty_points: newPts,
      lifetime_points: newLife,
      tier,
      updated_at: now,
    });
    const performedBy = await whActorEmail(req, catalystApp, orgUserContext);
    const logged = await logCustomerActivity(catalystApp, {
      customerId: c.ROWID,
      delta,
      oldPoints: oldPts,
      newPoints: newPts,
      reason: String(reason).trim(),
      performedBy,
    });
    res.status(200).json({
      success: true,
      message: `Points ${delta > 0 ? 'added to' : 'redeemed from'} ${c.name}.`,
      loyalty_points: newPts,
      lifetime_points: newLife,
      tier,
      activity_logged: logged,
    });
  } catch (error) {
    console.error('Error adjusting points:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   ORDER REPOSITORY (ORD-02 / ORD-04)
   --------------------------------------------------------------------------
   Shared read layer for order history, filtering and details. Checkout
   (POST /orders) is untouched — this block only reads, shapes and
   derives. Display statuses are canonicalized here so every consumer
   (Orders page, Reports, Dashboard) badges the same values.
   ========================================================================== */

/** Canonical order statuses (ORD-03). Unknown values pass through. */
function normalizeOrderStatus(status) {
  const s = String(status ?? '').trim().toLowerCase();
  const map = {
    'pending': 'Pending',
    'paid': 'Paid',
    'partially paid': 'Partially Paid',
    'partial': 'Partially Paid',
    'unpaid': 'Unpaid',
    'offline pending': 'Completed',
    'completed': 'Completed',
    'synced': 'Synced',
    'refunded': 'Refunded',
    'refund': 'Refunded',
    'voided': 'Voided',
    'void': 'Voided',
    'cancelled': 'Cancelled',
    'canceled': 'Cancelled',
  };
  if (map[s]) return map[s];
  const raw = String(status ?? '').trim();
  return raw === '' ? 'Pending' : raw;
}

/**
 * Derived payment status from the order row + settled payment legs.
 * Checkout settles in full, so most rows read Paid; partial/unpaid
 * surface honestly when legs fall short; void/refund dominate.
 */
function derivePaymentStatus(order, paidTotal) {
  const st = normalizeOrderStatus(order.status).toLowerCase();
  if (st === 'voided' || st === 'cancelled') return 'Void';
  if (st === 'refunded') return 'Refunded';
  const total = Number(order.total) || 0;
  const paid = Number(paidTotal) || 0;
  if (total <= 0) return 'Paid';
  if (paid >= total - 0.015) return 'Paid';
  if (paid > 0) return 'Partially Paid';
  if (st === 'offline pending' || st === 'pending') return 'Pending';
  return 'Unpaid';
}

/** Bounded Orders slice; cashier columns fall back on old deployments. */
async function fetchOrdersSlice(catalystApp, limit) {
  // Platform cap: ZCQL rejects LIMIT > 300, so clamp here — one choke
  // point covering user ?limit= and internal callers (reports pass 500).
  const n = Math.min(300, Math.max(1, Number(limit) || 100));
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID, customer_name, customer_email, subtotal, tax_amount, total, payment_mode, status, books_invoice_id, invoice_number, local_ref, cashier_name, created_by, CREATEDTIME FROM Orders ORDER BY CREATEDTIME DESC LIMIT ${n}`
    );
    return (r || []).map((x) => x.Orders).filter(Boolean);
  } catch (e) {
    const r = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID, customer_name, customer_email, subtotal, tax_amount, total, payment_mode, status, books_invoice_id, invoice_number, local_ref, CREATEDTIME FROM Orders ORDER BY CREATEDTIME DESC LIMIT ${n}`
    );
    return (r || []).map((x) => x.Orders).filter(Boolean);
  }
}

/** All payment legs grouped by order_id (single bounded read). */
async function fetchPaymentsGrouped(catalystApp) {
  const grouped = new Map();
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      'SELECT order_id, mode, amount FROM Payments ORDER BY CREATEDTIME DESC LIMIT 300'
    );
    for (const x of (r || [])) {
      const p = x.Payments;
      if (!p) continue;
      const key = String(p.order_id ?? '');
      if (key === '') continue;
      const list = grouped.get(key) ?? [];
      list.push({ method: String(p.mode ?? ''), amount: Number(p.amount) || 0 });
      grouped.set(key, list);
    }
  } catch (e) { /* Payments table may not exist on old deployments */ }
  return grouped;
}

function orderListShape(o, legs) {
  const payments = legs && legs.length > 0
    ? legs
    : [{ method: String(o.payment_mode || 'Cash'), amount: Number(o.total) || 0 }];
  const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return {
    ...o,
    cashier_name: o.cashier_name ?? '',
    created_by: o.created_by ?? '',
    payment_status: derivePaymentStatus(o, paidTotal),
    paid_total: Math.round(paidTotal * 100) / 100,
  };
}

/**
 * ORD-04 server-side history: every filter runs here before responding.
 * Filters: status | customer (name/email/phone) | cashier (name/email) |
 * date_from | date_to (YYYY-MM-DD on CREATEDTIME) | payment_status |
 * payment (mode) | search (order/invoice/ref/customer/email) | limit.
 */
async function getOrderHistory(catalystApp, filters) {
  const f = filters || {};
  const orders = await fetchOrdersSlice(catalystApp, f.limit);
  const legsByOrder = await fetchPaymentsGrouped(catalystApp);
  // Customer phone lookup for the customer filter (bounded, best-effort).
  let phoneByEmail = new Map();
  let phoneByName = new Map();
  if (f.customer) {
    try {
      const all = await listAllCustomers(catalystApp);
      for (const c of all) {
        const email = String(c.email ?? '').trim().toLowerCase();
        const name = String(c.name ?? '').trim().toLowerCase();
        if (email !== '') phoneByEmail.set(email, String(c.phone ?? ''));
        if (name !== '') phoneByName.set(name, String(c.phone ?? ''));
      }
    } catch (e) { /* customers optional */ }
  }
  const q = String(f.search || '').trim().toLowerCase();
  const cq = String(f.customer || '').trim().toLowerCase();
  const kq = String(f.cashier || '').trim().toLowerCase();
  const out = [];
  for (const o of orders) {
    if (f.status && normalizeOrderStatus(o.status).toLowerCase() !== String(f.status).toLowerCase()) continue;
    if (cq !== '') {
      const oe = String(o.customer_email ?? '').toLowerCase();
      const on = String(o.customer_name ?? '').toLowerCase();
      const phone = phoneByEmail.get(oe) || phoneByName.get(on) || '';
      if (!oe.includes(cq) && !on.includes(cq) && !String(phone).includes(cq)) continue;
    }
    if (kq !== '') {
      const kn = String(o.cashier_name ?? '').toLowerCase();
      const kb = String(o.created_by ?? '').toLowerCase();
      if (!kn.includes(kq) && !kb.includes(kq)) continue;
    }
    const day = String(o.CREATEDTIME ?? '').slice(0, 10);
    if (f.dateFrom && day < f.dateFrom) continue;
    if (f.dateTo && day > f.dateTo) continue;
    const legs = legsByOrder.get(String(o.ROWID)) || [];
    const shaped = orderListShape(o, legs);
    if (f.paymentStatus && shaped.payment_status.toLowerCase() !== String(f.paymentStatus).toLowerCase()) continue;
    if (f.payment && String(o.payment_mode ?? '') !== f.payment) continue;
    if (q !== '') {
      const hay = [
        String(o.ROWID ?? ''),
        String(o.invoice_number ?? ''),
        String(o.books_invoice_id ?? ''),
        String(o.local_ref ?? ''),
        String(o.customer_name ?? ''),
        String(o.customer_email ?? ''),
      ].join(' ').toLowerCase();
      if (!hay.includes(q)) continue;
    }
    out.push(shaped);
  }
  return out;
}

/**
 * ORD-02 complete details for one order: summary, customer loyalty
 * context, cashier attribution, enriched line items (product/sku,
 * discount, pro-rata tax share, line total), payment breakdown,
 * derived totals and the inventory-movement trail.
 */
async function getOrderDetails(catalystApp, orgId, orderId) {
  if (!isDigitsId(orderId)) return null;
  const key = String(orderId).trim();
  let order = null;
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID, customer_name, customer_email, subtotal, tax_amount, total, payment_mode, status, books_invoice_id, invoice_number, local_ref, cashier_name, created_by, CREATEDTIME FROM Orders WHERE ROWID = ${key} LIMIT 1`
    );
    if (r && r.length > 0) order = r[0].Orders;
  } catch (e) {
    const r = await safeZcql(catalystApp,
      `SELECT ROWID, customer_name, customer_email, subtotal, tax_amount, total, payment_mode, status, books_invoice_id, invoice_number, local_ref, CREATEDTIME FROM Orders WHERE ROWID = ${key} LIMIT 1`
    );
    if (r && r.length > 0) order = r[0].Orders;
  }
  if (!order) return null;

  // Lines (discount columns fall back on old deployments).
  let rawLines = [];
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      `SELECT ROWID, order_id, item_id, quantity, rate, discount_value, discount_type FROM OrderItems WHERE order_id = ${key} LIMIT 300`
    );
    rawLines = (r || []).map((x) => x.OrderItems).filter(Boolean);
  } catch (e) {
    const r = await safeZcql(catalystApp,
      `SELECT ROWID, order_id, item_id, quantity, rate FROM OrderItems WHERE order_id = ${key} LIMIT 300`
    );
    rawLines = (r || []).map((x) => x.OrderItems).filter(Boolean);
  }
  // Product resolution (sku + name for every stored item reference).
  const byBooksId = new Map();
  const bySku = new Map();
  const byRowId = new Map();
  try {
    const pr = await safeZcql(catalystApp, 'SELECT ROWID, sku, name, books_item_id, rate FROM Products LIMIT 300');
    for (const x of (pr || [])) {
      const p = x.Products;
      if (!p) continue;
      if (p.books_item_id) byBooksId.set(String(p.books_item_id), p);
      if (p.sku) bySku.set(String(p.sku), p);
      byRowId.set(String(p.ROWID), p);
    }
  } catch (e) { /* names fall back to stored references */ }
  const orderTax = Number(order.tax_amount) || 0;
  const prelim = rawLines.map((l) => {
    const ref = String(l.item_id ?? '');
    const prod = byBooksId.get(ref) || bySku.get(ref) || byRowId.get(ref) || null;
    const qty = Number(l.quantity) || 0;
    const rate = Number(l.rate) || 0;
    const gross = posRound2(qty * rate);
    const dv = Number(l.discount_value) || 0;
    const dtype = l.discount_type === 'flat' ? 'flat' : 'percent';
    const discount = dtype === 'flat' ? Math.min(dv, gross) : posRound2((gross * Math.min(100, Math.max(0, dv))) / 100);
    return {
      product_id: prod ? String(prod.ROWID) : ref,
      product_name: prod ? String(prod.name ?? ref) : ref,
      sku: prod ? String(prod.sku ?? '') : (/^[0-9]+$/.test(ref) ? '' : ref),
      quantity: qty,
      unit_price: rate,
      discount,
      discount_type: dtype,
      net: posRound2(gross - discount),
    };
  });
  const netSum = prelim.reduce((s, l) => s + l.net, 0);
  const items = prelim.map((l) => {
    const tax = netSum > 0 ? posRound2((l.net / netSum) * orderTax) : 0;
    return { ...l, tax, line_total: posRound2(l.net + tax) };
  });
  const linesSubtotal = posRound2(items.reduce((s, l) => s + l.net, 0));
  const linesDiscount = posRound2(prelim.reduce((s, l) => s + l.discount, 0));

  // Payments (ledger first, order row fallback — same rule as receipts).
  let payments = [];
  try {
    const r = await safeZcql(catalystApp, `SELECT mode, amount FROM Payments WHERE order_id = ${key} LIMIT 50`);
    payments = (r || []).map((x) => ({ method: String(x.Payments.mode ?? ''), amount: Number(x.Payments.amount) || 0 }));
  } catch (e) { payments = []; }
  if (payments.length === 0) {
    payments = [{ method: String(order.payment_mode || 'Cash'), amount: Number(order.total) || 0 }];
  }
  const paidTotal = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  // Customer context (profile + loyalty when the directory knows them).
  let customer = {
    name: String(order.customer_name || 'Walk-in Guest'),
    email: String(order.customer_email || ''),
    phone: '',
    company: '',
    tier: '',
    loyalty_points: 0,
    lifetime_points: 0,
    lifetime_value: 0,
  };
  try {
    const match = await matchCustomerForOrder(catalystApp, order.customer_name, order.customer_email);
    if (match) {
      const cfg = await getLoyaltyConfig(catalystApp, orgId);
      const metrics = await recalculateCustomerMetrics(catalystApp, match.ROWID, cfg);
      customer = {
        name: match.name || customer.name,
        email: match.email || customer.email,
        phone: match.phone || '',
        company: match.company || '',
        tier: (metrics && metrics.tier) || match.tier || 'New',
        loyalty_points: Number(match.loyalty_points) || 0,
        lifetime_points: Number(match.lifetime_points) || 0,
        lifetime_value: metrics ? metrics.lifetime_value : 0,
      };
    }
  } catch (e) { /* directory optional */ }

  // Cashier context (name + email stored at checkout; role best-effort).
  const cashierEmail = String(order.created_by ?? '');
  let cashierRole = '';
  if (cashierEmail !== '') {
    try {
      const ck = `user_${cashierEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
      const ur = await safeZcql(catalystApp,
        `SELECT config_value FROM Configurations WHERE config_key = '${ck}' LIMIT 1`
      );
      if (ur && ur.length > 0) {
        const parsed = JSON.parse(ur[0].Configurations.config_value);
        cashierRole = String(parsed.role === 'master_admin' ? 'Admin' : (parsed.role ?? ''));
      }
    } catch (e) { /* role optional */ }
  }

  // Inventory trail for this order (SALE/VOID movements).
  let movements = [];
  try {
    const mr = await safeZcql(catalystApp,
      `SELECT ROWID, item_rowid, sku, item_name, movement_type, quantity_change, stock_before, stock_after, reference_type, reference_id, reason, performed_by, CREATEDTIME FROM StockMovements WHERE reference_id = '${sanitizeZcql(key)}' LIMIT 100`
    );
    movements = (mr || []).map((x) => {
      const m = x.StockMovements;
      return {
        id: String(m.ROWID ?? ''),
        item_name: String(m.item_name ?? m.sku ?? ''),
        sku: String(m.sku ?? ''),
        movement_type: String(m.movement_type ?? ''),
        quantity_change: Number(m.quantity_change) || 0,
        stock_before: Number(m.stock_before) || 0,
        stock_after: Number(m.stock_after) || 0,
        reason: String(m.reason ?? ''),
        performed_by: String(m.performed_by ?? ''),
        at: String(m.CREATEDTIME ?? ''),
      };
    });
  } catch (e) { movements = []; }

  const subtotal = Number(order.subtotal) || linesSubtotal;
  const total = Number(order.total) || 0;
  const discountAmount = Math.max(0, posRound2(subtotal + orderTax - total));
  return {
    order_id: String(order.ROWID),
    order_number: order.invoice_number && order.invoice_number !== '' ? String(order.invoice_number) : `#${String(order.ROWID)}`,
    customer,
    cashier: {
      name: String(order.cashier_name ?? '') || cashierEmail,
      email: cashierEmail,
      role: cashierRole,
    },
    created_at: String(order.CREATEDTIME ?? ''),
    status: normalizeOrderStatus(order.status),
    payment_status: derivePaymentStatus(order, paidTotal),
    subtotal,
    discount_amount: discountAmount,
    discount_percent: subtotal > 0 ? posRound2((discountAmount / subtotal) * 100) : 0,
    tax_amount: orderTax,
    total_amount: total,
    items,
    payments,
    paid_total: posRound2(paidTotal),
    balance_due: posRound2(Math.max(0, total - paidTotal)),
    payment_mode: String(order.payment_mode ?? ''),
    books_invoice_id: String(order.books_invoice_id ?? ''),
    local_ref: String(order.local_ref ?? ''),
    inventory: { movements, movement_count: movements.length },
  };
}

/* ==========================================================================
   REPORTING SERVICE LAYER (RPT-01…06)
   --------------------------------------------------------------------------
   Shared, filter-driven report builders reused by the JSON endpoints and
   the CSV/PDF exporters below. All metrics derive from live rows —
   Orders (+OrderItems +Payments), Products (cost_price basis for profit),
   Customers, Shifts, Warehouses — bounded slices, never full dumps.
   Ranges are UTC calendar days (YYYY-MM-DD), matching the frontend.
   ========================================================================== */

function utcDay(d) {
  return d.toISOString().slice(0, 10);
}

function shiftDays(dayStr, delta) {
  const d = new Date(`${dayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return utcDay(d);
}

/**
 * Resolve preset period (or explicit date_from/date_to) to a closed range.
 * Returns { from, to, period, label }. Unknown/empty → lifetime ('all').
 */
function resolveReportRange(query) {
  const q = query || {};
  const today = utcDay(new Date());
  const period = String(q.period || '').trim().toLowerCase();
  const explicit = String(q.date_from || '').trim() !== '' || String(q.date_to || '').trim() !== '';
  let from = '';
  let to = '';
  let label = 'All time';
  if (explicit) {
    from = String(q.date_from || '').trim().slice(0, 10);
    to = String(q.date_to || '').trim().slice(0, 10) || today;
    if (from === '') from = to;
    if (from > to) { const t = from; from = to; to = t; }
    label = `${from} → ${to}`;
    return { from, to, period: 'custom', label };
  }
  const monday = (() => {
    const d = new Date();
    const dow = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - dow);
    return utcDay(d);
  })();
  switch (period) {
    case 'today': from = today; to = today; label = 'Today'; break;
    case 'yesterday': from = shiftDays(today, -1); to = from; label = 'Yesterday'; break;
    case 'last7': from = shiftDays(today, -6); to = today; label = 'Last 7 days'; break;
    case 'last30': from = shiftDays(today, -29); to = today; label = 'Last 30 days'; break;
    case 'week': from = monday; to = today; label = 'This week'; break;
    case 'month': from = `${today.slice(0, 7)}-01`; to = today; label = 'This month'; break;
    case 'lastmonth': {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - 1);
      from = utcDay(d).slice(0, 7) + '-01';
      const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      to = utcDay(end);
      label = 'Last month';
      break;
    }
    case 'year': from = `${today.slice(0, 4)}-01-01`; to = today; label = 'This year'; break;
    default: return { from: '', to: '', period: 'all', label: 'All time' };
  }
  return { from, to, period, label };
}

function orderDayOf(o) {
  return String(o.CREATEDTIME ?? '').slice(0, 10);
}

function inReportRange(day, from, to) {
  if (from === '' && to === '') return true;
  if (day === '') return false;
  if (from !== '' && day < from) return false;
  if (to !== '' && day > to) return false;
  return true;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Previous equal-length window before `from` (growth baseline). */
function previousRange(from, to) {
  if (from === '' || to === '') return { from: '', to: '' };
  const len = Math.round((new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000) + 1;
  return { from: shiftDays(from, -len), to: shiftDays(from, -1) };
}

/** Normalized report filters shared by every builder. */
function reportFilters(query) {
  const q = query || {};
  const range = resolveReportRange(q);
  return {
    ...range,
    customer: String(q.customer || q.customer_id || '').trim(),
    cashier: String(q.cashier || q.cashier_id || '').trim(),
    warehouse: String(q.warehouse || q.warehouse_id || '').trim(),
    category: String(q.category || q.category_id || '').trim(),
    payment: String(q.payment || q.payment_method || '').trim(),
    status: String(q.status || '').trim(),
  };
}

/** Orders slice for reports: bounded read, range + attribute filters. */
async function fetchReportOrders(catalystApp, f) {
  const orders = await fetchOrdersSlice(catalystApp, 500);
  const cq = f.customer.toLowerCase();
  const kq = f.cashier.toLowerCase();
  return orders.filter((o) => {
    if (!inReportRange(orderDayOf(o), f.from, f.to)) return false;
    if (f.status !== '' && normalizeOrderStatus(o.status).toLowerCase() !== f.status.toLowerCase()) return false;
    if (f.payment !== '' && String(o.payment_mode ?? '') !== f.payment) return false;
    if (cq !== '') {
      const hay = `${String(o.customer_name ?? '')} ${String(o.customer_email ?? '')}`.toLowerCase();
      if (!hay.includes(cq)) return false;
    }
    if (kq !== '') {
      const hay = `${String(o.cashier_name ?? '')} ${String(o.created_by ?? '')}`.toLowerCase();
      if (!hay.includes(kq)) return false;
    }
    return true;
  });
}

/** OrderItems slice for reports (discount columns fall back). */
async function fetchReportLines(catalystApp) {
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      'SELECT ROWID, order_id, item_id, quantity, rate, discount_value, discount_type, CREATEDTIME FROM OrderItems ORDER BY CREATEDTIME DESC LIMIT 300'
    );
    return (r || []).map((x) => x.OrderItems).filter(Boolean);
  } catch (e) {
    const r = await safeZcql(catalystApp,
      'SELECT ROWID, order_id, item_id, quantity, rate, CREATEDTIME FROM OrderItems ORDER BY CREATEDTIME DESC LIMIT 300'
    );
    return (r || []).map((x) => x.OrderItems).filter(Boolean);
  }
}

/** Products slice with cost basis for profit reports. */
async function fetchReportProducts(catalystApp) {
  try {
    const rows = await fetchAllZcql(catalystApp,
      'ROWID, sku, name, rate, cost_price, stock, category, category_id, books_item_id, reorder_level',
      'Products', '', 10);
    return (rows || []).map((r) => r.Products).filter(Boolean);
  } catch (e) {
    return []; // fail-soft: missing table reads as an empty catalog slice
  }
}

/** Product lookup maps shared by line-level builders. */
function productLookups(products) {
  const byBooksId = new Map();
  const bySku = new Map();
  const byRowId = new Map();
  const costByKey = new Map();
  for (const p of products) {
    if (p.books_item_id) byBooksId.set(String(p.books_item_id), p);
    if (p.sku) bySku.set(String(p.sku), p);
    byRowId.set(String(p.ROWID), p);
    const key = String(p.books_item_id ?? '').trim();
    if (key !== '') {
      const cost = Number(p.cost_price);
      if (Number.isFinite(cost) && cost > 0) costByKey.set(key, cost);
    }
  }
  return { byBooksId, bySku, byRowId, costByKey };
}

function resolveLineProduct(maps, ref) {
  return maps.byBooksId.get(ref) || maps.bySku.get(ref) || maps.byRowId.get(ref) || null;
}

function cashierNameOf(o) {
  const n = String(o.cashier_name ?? '').trim();
  if (n !== '') return n;
  const e = String(o.created_by ?? '').trim();
  return e === '' ? 'Unattributed' : e;
}

/* ---------------- getRevenueReport (RPT-01) ---------------- */

async function getRevenueReport(catalystApp, f) {
  const orders = await fetchReportOrders(catalystApp, f);
  const valid = orders.filter((o) => normalizeOrderStatus(o.status).toLowerCase() !== 'voided'
    && normalizeOrderStatus(o.status).toLowerCase() !== 'cancelled'
    && normalizeOrderStatus(o.status).toLowerCase() !== 'refunded');
  const revenue = round2(valid.reduce((s, o) => s + (Number(o.total) || 0), 0));
  const orderCount = valid.length;
  const byDayMap = new Map();
  const byPayMap = new Map();
  const byCustMap = new Map();
  const byCashierMap = new Map();
  for (const o of valid) {
    const day = orderDayOf(o) || 'Unknown';
    const amt = Number(o.total) || 0;
    const d = byDayMap.get(day) ?? { day, orders: 0, revenue: 0 };
    d.orders += 1; d.revenue = round2(d.revenue + amt);
    byDayMap.set(day, d);
    const pm = String(o.payment_mode ?? 'Unknown') || 'Unknown';
    const p = byPayMap.get(pm) ?? { method: pm, orders: 0, revenue: 0 };
    p.orders += 1; p.revenue = round2(p.revenue + amt);
    byPayMap.set(pm, p);
    const cn = String(o.customer_name ?? '').trim() || 'Walk-in';
    const c = byCustMap.get(cn) ?? { name: cn, orders: 0, revenue: 0 };
    c.orders += 1; c.revenue = round2(c.revenue + amt);
    byCustMap.set(cn, c);
    const kn = cashierNameOf(o);
    const k = byCashierMap.get(kn) ?? { cashier: kn, orders: 0, revenue: 0 };
    k.orders += 1; k.revenue = round2(k.revenue + amt);
    byCashierMap.set(kn, k);
  }
  const byDay = [...byDayMap.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const byWeekMap = new Map();
  const byMonthMap = new Map();
  for (const d of byDay) {
    if (d.day === 'Unknown' || d.day.length < 10) continue;
    const dt = new Date(`${d.day}T00:00:00Z`);
    const dow = (dt.getUTCDay() + 6) % 7;
    dt.setUTCDate(dt.getUTCDate() - dow);
    const wk = utcDay(dt);
    const w = byWeekMap.get(wk) ?? { week: wk, orders: 0, revenue: 0 };
    w.orders += d.orders; w.revenue = round2(w.revenue + d.revenue);
    byWeekMap.set(wk, w);
    const mo = d.day.slice(0, 7);
    const m = byMonthMap.get(mo) ?? { month: mo, orders: 0, revenue: 0 };
    m.orders += d.orders; m.revenue = round2(m.revenue + d.revenue);
    byMonthMap.set(mo, m);
  }
  // Growth vs the previous equal-length window (same filters, shifted range).
  let previousRevenue = 0;
  if (f.from !== '') {
    const prev = previousRange(f.from, f.to);
    const old = await fetchReportOrders(catalystApp, { ...f, from: prev.from, to: prev.to });
    previousRevenue = round2(old
      .filter((o) => normalizeOrderStatus(o.status).toLowerCase() !== 'voided'
        && normalizeOrderStatus(o.status).toLowerCase() !== 'cancelled'
        && normalizeOrderStatus(o.status).toLowerCase() !== 'refunded')
      .reduce((s, o) => s + (Number(o.total) || 0), 0));
  }
  const growth = previousRevenue <= 0
    ? (revenue > 0 ? 100 : 0)
    : round2(((revenue - previousRevenue) / previousRevenue) * 100);
  return {
    revenue,
    order_count: orderCount,
    average_order_value: orderCount > 0 ? round2(revenue / orderCount) : 0,
    revenue_by_day: byDay,
    revenue_by_week: [...byWeekMap.values()].sort((a, b) => (a.week < b.week ? -1 : 1)),
    revenue_by_month: [...byMonthMap.values()].sort((a, b) => (a.month < b.month ? -1 : 1)),
    revenue_by_payment_method: [...byPayMap.values()].sort((a, b) => b.revenue - a.revenue),
    revenue_by_customer: [...byCustMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    revenue_by_cashier: [...byCashierMap.values()].sort((a, b) => b.revenue - a.revenue),
    growth_percentage: growth,
    previous_revenue: previousRevenue,
    range: { from: f.from, to: f.to, period: f.period, label: f.label },
  };
}

/* ---------------- getProductPerformanceReport (RPT-02) ---------------- */

async function getProductPerformanceReport(catalystApp, f) {
  const products = await fetchReportProducts(catalystApp);
  const maps = productLookups(products);
  const lines = await fetchReportLines(catalystApp);
  const orders = await fetchReportOrders(catalystApp, f);
  const validIds = new Set(orders
    .filter((o) => {
      const st = normalizeOrderStatus(o.status).toLowerCase();
      return st !== 'voided' && st !== 'cancelled' && st !== 'refunded';
    })
    .map((o) => String(o.ROWID)));
  const per = new Map();
  for (const p of products) {
    // Category filter applies to the catalog side.
    if (f.category !== '') {
      const hay = `${String(p.category ?? '')} ${String(p.category_id ?? '')}`.toLowerCase();
      if (!hay.includes(f.category.toLowerCase())) continue;
    }
    per.set(String(p.ROWID), {
      product_id: String(p.ROWID),
      sku: String(p.sku ?? ''),
      name: String(p.name ?? ''),
      category: String(p.category ?? ''),
      price: Number(p.rate) || 0,
      cost: Number(p.cost_price) || 0,
      stock: Number(p.stock) || 0,
      reorder_level: Number(p.reorder_level) || 10,
      quantity: 0,
      revenue: 0,
      profit: 0,
      last_sold_at: '',
    });
  }
  let linesWithCost = 0;
  let linesTotal = 0;
  for (const l of lines) {
    if (!validIds.has(String(l.order_id ?? ''))) continue;
    const ref = String(l.item_id ?? '');
    const prod = resolveLineProduct(maps, ref);
    if (!prod) continue;
    const row = per.get(String(prod.ROWID));
    if (!row) continue; // filtered out by category
    const qty = Number(l.quantity) || 0;
    const rate = Number(l.rate) || 0;
    const lineRevenue = posRound2(qty * rate);
    row.quantity += qty;
    row.revenue = round2(row.revenue + lineRevenue);
    linesTotal += 1;
    const cost = Number(prod.cost_price);
    if (Number.isFinite(cost) && cost > 0) {
      row.profit = round2(row.profit + qty * (rate - cost));
      linesWithCost += 1;
    }
    const od = orders.find((o) => String(o.ROWID) === String(l.order_id ?? ''));
    const day = od ? orderDayOf(od) : '';
    if (day !== '' && (row.last_sold_at === '' || day > row.last_sold_at)) row.last_sold_at = day;
  }
  const rows = [...per.values()].map((r) => ({
    ...r,
    revenue: round2(r.revenue),
    profit: round2(r.profit),
    margin_pct: r.revenue > 0 ? round2((r.profit / r.revenue) * 100) : 0,
    // Turnover = units sold ÷ current on-hand (0 stock → sold-through flag).
    turnover: r.stock > 0 ? round2(r.quantity / r.stock) : (r.quantity > 0 ? r.quantity : 0),
  }));
  const sold = rows.filter((r) => r.quantity > 0);
  const byQtyDesc = [...sold].sort((a, b) => b.quantity - a.quantity);
  const byProfitDesc = [...sold].sort((a, b) => b.profit - a.profit);
  const byRevenueDesc = [...sold].sort((a, b) => b.revenue - a.revenue);
  const cutoff = shiftDays(utcDay(new Date()), -30);
  return {
    best_sellers: byQtyDesc.slice(0, 10),
    worst_sellers: [...byQtyDesc].reverse().slice(0, 10),
    most_profitable: byProfitDesc.slice(0, 10),
    least_profitable: [...byProfitDesc].reverse().slice(0, 10),
    top_revenue: byRevenueDesc.slice(0, 10),
    slow_movers: rows
      .filter((r) => r.stock > 0 && (r.last_sold_at === '' || r.last_sold_at < cutoff))
      .sort((a, b) => (b.price * b.stock) - (a.price * a.stock))
      .slice(0, 10),
    coverage: { lines_with_cost: linesWithCost, lines_total: linesTotal },
    range: { from: f.from, to: f.to, period: f.period, label: f.label },
  };
}

/* ---------------- getCustomerReport (RPT-03) ---------------- */

async function getCustomerReport(catalystApp, f) {
  const orders = await fetchReportOrders(catalystApp, f);
  const valid = orders.filter((o) => normalizeOrderStatus(o.status).toLowerCase() !== 'voided'
    && normalizeOrderStatus(o.status).toLowerCase() !== 'cancelled'
    && normalizeOrderStatus(o.status).toLowerCase() !== 'refunded');
  let directory = [];
  try {
    directory = await listAllCustomers(catalystApp);
  } catch (e) { directory = []; }
  const byEmail = new Map();
  const byName = new Map();
  for (const o of valid) {
    const oe = String(o.customer_email ?? '').trim().toLowerCase();
    const on = String(o.customer_name ?? '').trim().toLowerCase();
    if (oe !== '' && oe !== 'walkin@pos.system') {
      const l = byEmail.get(oe) ?? [];
      l.push(o);
      byEmail.set(oe, l);
    }
    if (on !== '' && on !== 'walk-in guest') {
      const l = byName.get(on) ?? [];
      l.push(o);
      byName.set(on, l);
    }
  }
  const tierOf = (c) => String(c.tier ?? '').trim() || 'New';
  const rows = directory.map((c) => {
    const email = String(c.email ?? '').trim().toLowerCase();
    const name = String(c.name ?? '').trim().toLowerCase();
    const mine = (email !== '' && byEmail.get(email)) || byName.get(name) || [];
    const ltv = round2(mine.reduce((s, o) => s + (Number(o.total) || 0), 0));
    return {
      id: String(c.ROWID ?? ''),
      name: String(c.name ?? ''),
      email: String(c.email ?? ''),
      phone: String(c.phone ?? ''),
      tier: tierOf(c),
      loyalty_points: Number(c.loyalty_points) || 0,
      lifetime_points: Number(c.lifetime_points) || 0,
      orders: mine.length,
      lifetime_value: ltv,
      average_order_value: mine.length > 0 ? round2(ltv / mine.length) : 0,
      joined_at: String(c.joined_at ?? ''),
    };
  });
  // Customers with orders but no directory row (walk-in names, legacy).
  const known = new Set(rows.map((r) => `${r.email}|${r.name.toLowerCase()}`));
  for (const [key, mine] of byName.entries()) {
    const emailHit = [...byEmail.entries()].find(([e, l]) => l === mine);
    const email = emailHit ? emailHit[0] : '';
    if (known.has(`${email}|${key}`)) continue;
    if (key === '' || key === 'walk-in guest') continue;
    const first = mine.map((o) => String(o.customer_name ?? '')).find((n) => n.trim() !== '') || key;
    const ltv = round2(mine.reduce((s, o) => s + (Number(o.total) || 0), 0));
    rows.push({
      id: '', name: first, email, phone: '', tier: 'New',
      loyalty_points: 0, lifetime_points: 0, orders: mine.length,
      lifetime_value: ltv, average_order_value: mine.length > 0 ? round2(ltv / mine.length) : 0,
      joined_at: '',
    });
  }
  const withOrders = rows.filter((r) => r.orders > 0);
  const newInRange = f.from === ''
    ? withOrders.length
    : rows.filter((r) => String(r.joined_at).slice(0, 10) >= f.from).length;
  const byDayMap = new Map();
  for (const o of valid) {
    const day = orderDayOf(o);
    if (day === '') continue;
    const ex = new Set([...byEmail.entries()].filter(([, l]) => l.includes(o)).map(([e]) => e));
    const nm = String(o.customer_name ?? '').trim().toLowerCase();
    const key = ex.size > 0 ? [...ex][0] : nm;
    const d = byDayMap.get(day) ?? { day, revenue: 0, customers: new Set() };
    d.revenue = round2(d.revenue + (Number(o.total) || 0));
    if (key !== '' && key !== 'walk-in guest') d.customers.add(key);
    byDayMap.set(day, d);
  }
  const dist = ['VIP', 'Loyal', 'Active', 'New'].map((t) => ({
    tier: t,
    members: rows.filter((r) => (r.tier || 'New') === t).length,
  }));
  return {
    total_customers: rows.length,
    active_customers: withOrders.length,
    new_customers: newInRange,
    returning_customers: withOrders.filter((r) => r.orders > 1).length,
    average_frequency: withOrders.length > 0
      ? round2(withOrders.reduce((s, r) => s + r.orders, 0) / withOrders.length)
      : 0,
    total_lifetime_value: round2(rows.reduce((s, r) => s + r.lifetime_value, 0)),
    average_lifetime_value: rows.length > 0 ? round2(rows.reduce((s, r) => s + r.lifetime_value, 0) / rows.length) : 0,
    loyalty_distribution: dist,
    vip_customers: rows.filter((r) => (r.tier || 'New') === 'VIP')
      .sort((a, b) => b.lifetime_value - a.lifetime_value).slice(0, 10),
    top_customers: [...withOrders].sort((a, b) => b.lifetime_value - a.lifetime_value).slice(0, 10),
    revenue_trend: [...byDayMap.values()]
      .map((d) => ({ day: d.day, revenue: d.revenue, customers: d.customers.size }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    range: { from: f.from, to: f.to, period: f.period, label: f.label },
  };
}

/* ---------------- getProfitReport (RPT-04) ---------------- */

async function getProfitReport(catalystApp, f) {
  const products = await fetchReportProducts(catalystApp);
  const maps = productLookups(products);
  const lines = await fetchReportLines(catalystApp);
  const orders = await fetchReportOrders(catalystApp, f);
  const orderById = new Map(orders.map((o) => [String(o.ROWID), o]));
  let revenue = 0;
  let cost = 0;
  let linesWithCost = 0;
  let linesTotal = 0;
  const byProduct = new Map();
  const byCategory = new Map();
  const byDay = new Map();
  for (const l of lines) {
    const o = orderById.get(String(l.order_id ?? ''));
    if (!o) continue;
    const st = normalizeOrderStatus(o.status).toLowerCase();
    if (st === 'voided' || st === 'cancelled' || st === 'refunded') continue;
    const ref = String(l.item_id ?? '');
    const prod = resolveLineProduct(maps, ref);
    if (!prod) continue;
    // Category filter applies to the product side.
    const cat = String(prod.category ?? '') || 'General';
    if (f.category !== '' && !`${cat} ${String(prod.category_id ?? '')}`.toLowerCase().includes(f.category.toLowerCase())) continue;
    const qty = Number(l.quantity) || 0;
    const rate = Number(l.rate) || 0;
    const lineRevenue = posRound2(qty * rate);
    const unitCost = Number(prod.cost_price);
    const known = Number.isFinite(unitCost) && unitCost > 0;
    linesTotal += 1;
    revenue = round2(revenue + lineRevenue);
    if (known) {
      linesWithCost += 1;
      cost = round2(cost + qty * unitCost);
    }
    const key = String(prod.ROWID);
    const p = byProduct.get(key) ?? {
      product_id: key, sku: String(prod.sku ?? ''), name: String(prod.name ?? ''),
      category: cat, quantity: 0, revenue: 0, cost: 0, profit: 0,
    };
    p.quantity += qty;
    p.revenue = round2(p.revenue + lineRevenue);
    if (known) {
      p.cost = round2(p.cost + qty * unitCost);
      p.profit = round2(p.profit + qty * (rate - unitCost));
    }
    byProduct.set(key, p);
    const g = byCategory.get(cat) ?? { category: cat, quantity: 0, revenue: 0, cost: 0, profit: 0 };
    g.quantity += qty;
    g.revenue = round2(g.revenue + lineRevenue);
    if (known) {
      g.cost = round2(g.cost + qty * unitCost);
      g.profit = round2(g.profit + qty * (rate - unitCost));
    }
    byCategory.set(cat, g);
    const day = orderDayOf(o) || 'Unknown';
    const d = byDay.get(day) ?? { day, revenue: 0, cost: 0, profit: 0 };
    d.revenue = round2(d.revenue + lineRevenue);
    if (known) {
      d.cost = round2(d.cost + qty * unitCost);
      d.profit = round2(d.profit + qty * (rate - unitCost));
    }
    byDay.set(day, d);
  }
  const grossProfit = round2(revenue - cost);
  const finish = (r) => ({ ...r, margin_pct: r.revenue > 0 ? round2((r.profit / r.revenue) * 100) : 0 });
  return {
    revenue,
    cost,
    gross_profit: grossProfit,
    margin_pct: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
    coverage: { lines_with_cost: linesWithCost, lines_total: linesTotal },
    by_product: [...byProduct.values()].map(finish).sort((a, b) => b.profit - a.profit),
    by_category: [...byCategory.values()].map(finish).sort((a, b) => b.profit - a.profit),
    by_day: [...byDay.values()].map(finish).sort((a, b) => (a.day < b.day ? -1 : 1)),
    range: { from: f.from, to: f.to, period: f.period, label: f.label },
  };
}

/* ---------------- getRegisterReport (RPT-05) ---------------- */

async function getRegisterReport(catalystApp, f) {
  const orders = await fetchReportOrders(catalystApp, f);
  const legsByOrder = await fetchPaymentsGrouped(catalystApp);
  const perCashier = new Map();
  let cash = 0;
  let card = 0;
  let other = 0;
  let refundCount = 0;
  let refundValue = 0;
  let voidCount = 0;
  let voidValue = 0;
  const byMethod = new Map();
  for (const o of orders) {
    const st = normalizeOrderStatus(o.status).toLowerCase();
    const amt = Number(o.total) || 0;
    if (st === 'voided' || st === 'cancelled') {
      voidCount += 1;
      voidValue = round2(voidValue + amt);
      continue;
    }
    const legs = legsByOrder.get(String(o.ROWID)) || (st === 'refunded' ? [] : [{ method: String(o.payment_mode || 'Cash'), amount: amt }]);
    const netPaid = round2(legs.reduce((s, leg) => s + (Number(leg.amount) || 0), 0));
    if (st === 'refunded') {
      refundCount += 1;
      refundValue = round2(refundValue + amt);
    }
    for (const leg of legs) {
      const m = String(leg.method || '').toLowerCase();
      const a = Number(leg.amount) || 0;
      if (m === 'cash') cash = round2(cash + a);
      else if (m === 'card') card = round2(card + a);
      else other = round2(other + a);
      const key = String(leg.method || 'Unknown') || 'Unknown';
      const e = byMethod.get(key) ?? { method: key, orders: 0, revenue: 0 };
      e.revenue = round2(e.revenue + a);
      byMethod.set(key, e);
    }
    const seenMethods = new Set(legs.map((l) => String(l.method || '')));
    for (const m of seenMethods) {
      const e = byMethod.get(m || 'Unknown');
      if (e) e.orders += 1;
    }
    const kn = cashierNameOf(o);
    const c = perCashier.get(kn) ?? { cashier: kn, orders: 0, revenue: 0, cash: 0, card: 0 };
    c.orders += 1;
    c.revenue = round2(c.revenue + netPaid);
    for (const leg of legs) {
      const m = String(leg.method || '').toLowerCase();
      if (m === 'cash') c.cash = round2(c.cash + (Number(leg.amount) || 0));
      else if (m === 'card') c.card = round2(c.card + (Number(leg.amount) || 0));
    }
    perCashier.set(kn, c);
  }
  // Shifts in range (best-effort; table may predate some columns).
  let shifts = [];
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      'SELECT ROWID, cashier_name, opening_float, cash_sales, noncash_sales, expected_cash, actual_cash, variance, status, open_notes, close_notes, CREATEDTIME FROM Shifts ORDER BY CREATEDTIME DESC LIMIT 200'
    );
    shifts = (r || []).map((x) => x.Shifts).filter(Boolean).map((s) => ({
      id: String(s.ROWID ?? ''),
      cashier: String(s.cashier_name ?? ''),
      opening_float: Number(s.opening_float) || 0,
      cash_sales: Number(s.cash_sales) || 0,
      noncash_sales: Number(s.noncash_sales) || 0,
      expected_cash: Number(s.expected_cash) || 0,
      actual_cash: Number(s.actual_cash ?? 0),
      variance: Number(s.variance ?? 0),
      status: String(s.status ?? ''),
      at: String(s.CREATEDTIME ?? ''),
    })).filter((s) => inReportRange(String(s.at).slice(0, 10), f.from, f.to));
  } catch (e) { shifts = []; }
  if (f.cashier !== '') {
    const kq = f.cashier.toLowerCase();
    shifts = shifts.filter((s) => String(s.cashier).toLowerCase().includes(kq));
  }
  return {
    cashiers: [...perCashier.values()].sort((a, b) => b.revenue - a.revenue),
    shifts,
    cash_summary: { cash, card, other, total: round2(cash + card + other) },
    payment_breakdown: [...byMethod.values()].sort((a, b) => b.revenue - a.revenue),
    refunds: { count: refundCount, value: refundValue },
    voids: { count: voidCount, value: voidValue },
    range: { from: f.from, to: f.to, period: f.period, label: f.label },
  };
}

/* ---------------- report role scoping ---------------- */

function scopeReportFilters(orgUserContext, f) {
  const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
  const out = { ...f };
  if (role === 'Cashier' || role === 'Waiter' || role === 'Chef') {
    // Frontline sees only their own performance; profit is managers-only.
    const me = orgUserContext.user ? String(orgUserContext.user.email || orgUserContext.user.email_id || '') : '';
    const myName = orgUserContext.orgUser && orgUserContext.orgUser.display_name
      ? String(orgUserContext.orgUser.display_name) : '';
    out.cashier = me !== '' ? me : myName;
  }
  return { filters: out, role };
}

/* ---------------- report JSON endpoints ---------------- */

app.get('/api/reports/revenue', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role) === 'Storekeeper') {
      return res.status(403).json({ success: false, error: 'Revenue reports require Admin, Manager or Cashier (own sales).' });
    }
    const { filters } = scopeReportFilters(orgUserContext, reportFilters(req.query));
    res.status(200).json({ success: true, report: await getRevenueReport(catalystApp, filters) });
  } catch (error) {
    console.error('Error building revenue report:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports/products', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const { filters } = scopeReportFilters(orgUserContext, reportFilters(req.query));
    res.status(200).json({ success: true, report: await getProductPerformanceReport(catalystApp, filters) });
  } catch (error) {
    console.error('Error building product report:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports/customers', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role) === 'Storekeeper') {
      return res.status(403).json({ success: false, error: 'Customer reports require Admin or Manager.' });
    }
    const { filters } = scopeReportFilters(orgUserContext, reportFilters(req.query));
    res.status(200).json({ success: true, report: await getCustomerReport(catalystApp, filters) });
  } catch (error) {
    console.error('Error building customer report:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports/profit', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Profit reports require Admin or Manager.' });
    }
    res.status(200).json({ success: true, report: await getProfitReport(catalystApp, reportFilters(req.query)) });
  } catch (error) {
    console.error('Error building profit report:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/reports/registers', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role) === 'Storekeeper') {
      return res.status(403).json({ success: false, error: 'Register reports require Admin, Manager or Cashier (own sales).' });
    }
    const { filters } = scopeReportFilters(orgUserContext, reportFilters(req.query));
    res.status(200).json({ success: true, report: await getRegisterReport(catalystApp, filters) });
  } catch (error) {
    console.error('Error building register report:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- minimal PDF engine (zero dependencies) ----------------
   Hand-rolled A4 PDF (Helvetica family, built into every PDF reader):
   branded header, meta block, KPI grid, auto-paged tables with repeating
   headers, a vector bar chart, and footers with page numbers. No npm
   packages, so Catalyst packaging cannot break. Non-WinAnsi glyphs
   (e.g. the Rupee sign) are transliterated to plain ASCII. */

function pdfText(s) {
  return String(s ?? '')
    .replace(/₨/g, 'LKR ')
    .replace(/[−–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/·/g, '-')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function pdfMoney(n, code) {
  const v = Number(n) || 0;
  const parts = Math.abs(v).toFixed(2).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${code} ${(v < 0 ? '-' : '')}${parts[0]}.${parts[1]}`;
}

function buildReportPdf(doc) {
  const W = 595;
  const H = 842;
  const M = 48;
  const CW = W - M * 2;
  const code = doc.currency || 'LKR';
  const pages = [];
  let ops = [];
  let y = 0;

  const newPage = () => {
    if (ops.length > 0) pages.push(ops);
    ops = [];
    y = H - M;
  };
  const need = (h) => {
    if (y - h < M + 28) newPage();
  };
  const text = (x, yy, size, bold, str, align, maxWidth) => {
    // Store raw text; pdfText() escaping runs exactly once at emit time.
    let s = String(str ?? '');
    if (maxWidth) {
      const maxChars = Math.max(4, Math.floor(maxWidth / (size * 0.55)));
      if (s.length > maxChars) s = `${s.slice(0, maxChars - 1)}.`;
    }
    ops.push({ t: [x, yy, size, bold ? 1 : 0, s, align || 'l'] });
  };
  const line = (x1, y1, x2, y2, w) => ops.push({ l: [x1, y1, x2, y2, w || 0.7] });
  const bar = (x, yy, w, h) => ops.push({ r: [x, yy, w, h] });

  // Header (first page). Company logo (when the deployment uploaded one
  // and it decoded) sits top-right inside the header band.
  newPage();
  if (doc.logoImage && doc.logoImage.bytes && doc.logoImage.w > 0 && doc.logoImage.h > 0) {
    const sc = Math.min(110 / doc.logoImage.w, 34 / doc.logoImage.h, 1);
    const dw = Math.max(8, doc.logoImage.w * sc);
    const dh = Math.max(8, doc.logoImage.h * sc);
    ops.push({ img: ['ImLogo', W - M - dw, H - M - dh, dw, dh] });
  }
  text(M, y, 19, true, doc.company || 'CloudHub POS'); y -= 20;
  if (doc.companySub) { text(M, y, 10, false, doc.companySub); y -= 15; }
  text(M, y, 14, true, doc.title || 'Report'); y -= 17;
  text(M, y, 10, false, `Range: ${doc.rangeLabel || 'All time'}   |   Generated: ${doc.generated || ''}`); y -= 14;
  line(M, y, M + CW, y); y -= 16;

  // KPI grid (2 columns).
  if (doc.kpis && doc.kpis.length > 0) {
    need(20);
    text(M, y, 12, true, 'Summary'); y -= 15;
    const colW = CW / 2;
    doc.kpis.forEach((k, i) => {
      const cx = M + (i % 2) * colW;
      if (i % 2 === 0) need(26);
      const yy = y - Math.floor(i % 2 === 0 ? 0 : 0);
      text(cx, y, 10, true, k.label);
      text(cx, y - 12, 10, false, k.value);
      if (i % 2 === 1) y -= 28;
    });
    if (doc.kpis.length % 2 === 1) y -= 28;
    y -= 6;
  }

  // Bar chart (vector rectangles + labels).
  if (doc.bars && doc.bars.values.length > 0) {
    need(120);
    text(M, y, 12, true, doc.bars.title || 'Trend'); y -= 12;
    const max = Math.max(1, ...doc.bars.values);
    const chartH = 90;
    const chartW = CW;
    const n = doc.bars.values.length;
    const slot = chartW / n;
    const bw = Math.max(3, Math.min(22, slot * 0.55));
    line(M, y, M, y - chartH);
    line(M, y - chartH, M + chartW, y - chartH);
    doc.bars.values.forEach((v, i) => {
      const h = Math.max(2, Math.round((v / max) * (chartH - 8)));
      const x = M + i * slot + (slot - bw) / 2;
      bar(x, y - chartH, bw, h);
      if (n <= 16 && doc.bars.labels[i]) {
        text(x + bw / 2 - 14, y - chartH - 10, 7, false, String(doc.bars.labels[i]).slice(5), 'l', 30);
      }
    });
    y -= chartH + 22;
  }

  // Tables (auto-paged, repeating headers, totals row).
  for (const tbl of (doc.tables || [])) {
    need(40);
    text(M, y, 12, true, tbl.title || ''); y -= 15;
    const widths = tbl.widths;
    const totalW = widths.reduce((a, b) => a + b, 0) || 1;
    const colX = [];
    const colR = [];
    let acc = M;
    for (const w of widths) {
      const cw = (w / totalW) * CW;
      colX.push(acc);
      colR.push(acc + cw - 4);
      acc += cw;
    }
    const cellX = (i) => (i === 0 ? colX[i] : colR[i]);
    const drawHead = () => {
      need(30);
      tbl.columns.forEach((c, i) => text(cellX(i), y, 9, true, c, i === 0 ? 'l' : 'r', (widths[i] / totalW) * CW - 4));
      y -= 11;
      line(M, y, M + CW, y);
      y -= 9;
    };
    drawHead();
    for (const row of (tbl.rows || [])) {
      need(16);
      row.forEach((cell, i) => text(cellX(i), y, 9, false, cell, i === 0 ? 'l' : 'r', (widths[i] / totalW) * CW - 4));
      y -= 13;
    }
    if (tbl.totals) {
      need(20);
      line(M, y + 4, M + CW, y + 4);
      tbl.totals.forEach((cell, i) => text(cellX(i), y - 6, 9, true, cell, i === 0 ? 'l' : 'r', (widths[i] / totalW) * CW - 4));
      y -= 20;
    }
    y -= 8;
  }
  if (ops.length > 0) pages.push(ops);

  // Serialize: catalog/pages/font/content objects with page footers.
  const objects = [];
  const pageCount = pages.length;
  const fontObj = pageCount + 3;
  pages.forEach((pageOps, idx) => {
    let stream = 'BT\n';
    const emit = (x, yy, size, bold, str, align) => {
      const font = bold ? '/F2' : '/F1';
      let ex = x;
      if (align === 'r') ex = x + 0; // right alignment handled by caller x
      stream += `${font} ${size} Tf 1 0 0 1 ${ex.toFixed(1)} ${yy.toFixed(1)} Tm (${pdfText(str)}) Tj\n`;
    };
    for (const op of pageOps) {
      if (op.t) {
        // Right-aligned cells arrive pre-positioned at the column right
        // edge minus text width estimate.
        const [x, yy, size, bold, str, align] = op.t;
        if (align === 'r') {
          const est = str.length * size * 0.55;
          emit(Math.max(M, x - est), yy, size, bold, str, 'l');
        } else {
          emit(x, yy, size, bold, str, 'l');
        }
      } else if (op.l) {
        const [x1, y1, x2, y2, w] = op.l;
        stream += `${w} w ${x1.toFixed(1)} ${y1.toFixed(1)} m ${x2.toFixed(1)} ${y2.toFixed(1)} l S\n`;
      } else if (op.r) {
        const [x, yy, w, h] = op.r;
        stream += `0.16 0.35 0.95 RG 0.16 0.35 0.95 rg ${x.toFixed(1)} ${yy.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)} re f\n`;
      } else if (op.img) {
        const [name, x, yy, w, h] = op.img;
        stream += `q ${w.toFixed(1)} 0 0 ${h.toFixed(1)} ${x.toFixed(1)} ${yy.toFixed(1)} cm /${name} Do Q\n`;
      }
    }
    // Footer: custom footer text + page number (drawn in stream, always fits).
    const footer = doc.footer || '';
    stream += `/F1 8 Tf 1 0 0 1 ${M} 30 Tm (${pdfText(footer).slice(0, 90)}) Tj\n`;
    const pg = `Page ${idx + 1} of ${pageCount}`;
    stream += `/F1 8 Tf 1 0 0 1 ${(W - M - pg.length * 4.5).toFixed(1)} 30 Tm (${pg}) Tj\n`;
    stream += 'ET';
    objects.push({ kind: 'content', stream });
  });
  // Object numbering: 1 catalog, 2 pages, then (page, content) pairs, then fonts.
  let out = '%PDF-1-4\n';
  const offsets = [];
  const writeObj = (n, body) => {
    offsets[n] = out.length;
    out += `${n} 0 obj\n${body}\nendobj\n`;
  };
  const kids = [];
  pages.forEach((_, i) => kids.push(`${3 + i * 2} 0 R`));
  writeObj(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  writeObj(2, `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages.length} >>`);
  const fontNum = 3 + pages.length * 2;
  // Raster images (company logo at most): object numbers follow the fonts.
  const images = [];
  if (doc.logoImage && doc.logoImage.bytes && doc.logoImage.w > 0) {
    images.push({ name: 'ImLogo', ...doc.logoImage });
  }
  const xobjRef = images.length > 0
    ? `/XObject << ${images.map((im, i) => `/${im.name} ${fontNum + 2 + i} 0 R`).join(' ')} >> `
    : '';
  pages.forEach((_, i) => {
    writeObj(3 + i * 2, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontNum} 0 R /F2 ${fontNum + 1} 0 R >> ${xobjRef}>> /Contents ${3 + i * 2 + 1} 0 R >>`);
    const s = objects[i].stream;
    writeObj(3 + i * 2 + 1, `<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  });
  writeObj(fontNum, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  writeObj(fontNum + 1, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  images.forEach((im, i) => {
    const filter = im.encoding === 'dct' ? '/DCTDecode' : '/FlateDecode';
    const cs = im.gray ? '/DeviceGray' : '/DeviceRGB';
    const bin = im.bytes.toString('latin1');
    writeObj(fontNum + 2 + i, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace ${cs} /BitsPerComponent 8 /Filter ${filter} /Length ${im.bytes.length} >>\nstream\n${bin}\nendstream`);
  });
  const xrefAt = out.length;
  const total = fontNum + 2 + images.length;
  out += `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) {
    out += `${String(offsets[i] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return out;
}

function pdfFilename(type, f) {
  const stamp = f.from !== '' ? `${f.from}_to_${f.to}` : 'all-time';
  return `${type}-report-${stamp}.pdf`;
}

/** Assemble a branded PDF document for one report type. */
async function buildReportDocument(catalystApp, orgId, type, f) {
  const store = await getStoreProfile(catalystApp, orgId);
  let cfgFooter = '';
  try {
    const bs = new ZohoBooksService(catalystApp, null);
    cfgFooter = String((await bs.getConfig(`org_${orgId}_setting_report_footer`)) ?? '');
  } catch (e) { /* default footer */ }
  const base = {
    company: String(store.store_name || store.company || 'CloudHub POS'),
    companySub: store.company && store.store_name ? String(store.company) : '',
    generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
    currency: String(store.currency || 'LKR'),
    footer: cfgFooter || 'Generated by CloudHub POS',
    // SET-01: raster logo embedded in every exported PDF when available.
    logoImage: await getCompanyLogoImage(catalystApp, orgId),
  };
  const M2 = (n) => pdfMoney(n, base.currency);
  if (type === 'revenue') {
    const r = await getRevenueReport(catalystApp, f);
    return {
      doc: {
        ...base,
        title: 'Revenue Report',
        rangeLabel: r.range.label,
        kpis: [
          { label: 'Revenue', value: M2(r.revenue) },
          { label: 'Orders', value: String(r.order_count) },
          { label: 'Average order', value: M2(r.average_order_value) },
          { label: 'Growth', value: `${r.growth_percentage >= 0 ? '+' : ''}${r.growth_percentage}%` },
        ],
        bars: { title: 'Revenue by day', labels: r.revenue_by_day.map((d) => d.day), values: r.revenue_by_day.map((d) => d.revenue) },
        tables: [
          {
            title: 'Revenue by day', columns: ['Day', 'Orders', 'Revenue'], widths: [2, 1, 1.4],
            rows: r.revenue_by_day.map((d) => [d.day, String(d.orders), M2(d.revenue)]),
            totals: ['Total', String(r.order_count), M2(r.revenue)],
          },
          {
            title: 'By payment method', columns: ['Method', 'Orders', 'Revenue'], widths: [2, 1, 1.4],
            rows: r.revenue_by_payment_method.map((p) => [p.method, String(p.orders), M2(p.revenue)]),
          },
          {
            title: 'Top customers', columns: ['Customer', 'Orders', 'Revenue'], widths: [2.4, 1, 1.4],
            rows: r.revenue_by_customer.map((c) => [c.name, String(c.orders), M2(c.revenue)]),
          },
        ],
      },
      filename: pdfFilename('revenue', f),
    };
  }
  if (type === 'products') {
    const r = await getProductPerformanceReport(catalystApp, f);
    const top = [...r.best_sellers, ...r.slow_movers.filter((s) => !r.best_sellers.some((b) => b.sku === s.sku))].slice(0, 20);
    return {
      doc: {
        ...base,
        title: 'Product Performance Report',
        rangeLabel: r.range.label,
        kpis: [
          { label: 'Units sold', value: String(top.reduce((s, p) => s + p.quantity, 0)) },
          { label: 'Product revenue', value: M2(top.reduce((s, p) => s + p.revenue, 0)) },
          { label: 'Product profit', value: M2(top.reduce((s, p) => s + p.profit, 0)) },
          { label: 'Cost coverage', value: `${r.coverage.lines_with_cost}/${r.coverage.lines_total} lines` },
        ],
        tables: [
          {
            title: 'Best sellers', columns: ['Product', 'SKU', 'Qty', 'Revenue', 'Profit'], widths: [2.4, 1.2, 0.8, 1.2, 1.2],
            rows: r.best_sellers.slice(0, 15).map((p) => [p.name, p.sku, String(p.quantity), M2(p.revenue), M2(p.profit)]),
          },
          {
            title: 'Slow movers', columns: ['Product', 'SKU', 'Stock', 'Value'], widths: [2.4, 1.2, 0.8, 1.2],
            rows: r.slow_movers.slice(0, 15).map((p) => [p.name, p.sku, String(p.stock), M2(p.price * p.stock)]),
          },
        ],
      },
      filename: pdfFilename('products', f),
    };
  }
  if (type === 'customers') {
    const r = await getCustomerReport(catalystApp, f);
    return {
      doc: {
        ...base,
        title: 'Customer Report',
        rangeLabel: r.range.label,
        kpis: [
          { label: 'Customers', value: String(r.total_customers) },
          { label: 'Active', value: String(r.active_customers) },
          { label: 'New', value: String(r.new_customers) },
          { label: 'Lifetime value', value: M2(r.total_lifetime_value) },
        ],
        bars: { title: 'Customer revenue trend', labels: r.revenue_trend.map((d) => d.day), values: r.revenue_trend.map((d) => d.revenue) },
        tables: [
          {
            title: 'Top customers', columns: ['Customer', 'Orders', 'LTV'], widths: [2.4, 1, 1.4],
            rows: r.top_customers.map((c) => [c.name, String(c.orders), M2(c.lifetime_value)]),
          },
          {
            title: 'Loyalty distribution', columns: ['Tier', 'Members'], widths: [2.4, 1],
            rows: r.loyalty_distribution.map((d) => [d.tier, String(d.members)]),
          },
        ],
      },
      filename: pdfFilename('customers', f),
    };
  }
  if (type === 'profit') {
    const r = await getProfitReport(catalystApp, f);
    return {
      doc: {
        ...base,
        title: 'Profit Report',
        rangeLabel: r.range.label,
        kpis: [
          { label: 'Revenue', value: M2(r.revenue) },
          { label: 'Cost', value: M2(r.cost) },
          { label: 'Gross profit', value: M2(r.gross_profit) },
          { label: 'Margin', value: `${r.margin_pct}%` },
        ],
        bars: { title: 'Profit by day', labels: r.by_day.map((d) => d.day), values: r.by_day.map((d) => d.profit) },
        tables: [
          {
            title: 'Profit by product', columns: ['Product', 'Qty', 'Revenue', 'Profit', 'Margin'], widths: [2.2, 0.7, 1.1, 1.1, 0.8],
            rows: r.by_product.slice(0, 20).map((p) => [p.name, String(p.quantity), M2(p.revenue), M2(p.profit), `${p.margin_pct}%`]),
            totals: ['Total', '', M2(r.revenue), M2(r.gross_profit), `${r.margin_pct}%`],
          },
          {
            title: 'Profit by category', columns: ['Category', 'Qty', 'Revenue', 'Profit'], widths: [2.2, 0.8, 1.2, 1.2],
            rows: r.by_category.map((c) => [c.category, String(c.quantity), M2(c.revenue), M2(c.profit)]),
          },
        ],
      },
      filename: pdfFilename('profit', f),
    };
  }
  if (type === 'registers') {
    const r = await getRegisterReport(catalystApp, f);
    return {
      doc: {
        ...base,
        title: 'Register Report',
        rangeLabel: r.range.label,
        kpis: [
          { label: 'Cash', value: M2(r.cash_summary.cash) },
          { label: 'Card', value: M2(r.cash_summary.card) },
          { label: 'Total collected', value: M2(r.cash_summary.total) },
          { label: 'Voids', value: `${r.voids.count} (${M2(r.voids.value)})` },
        ],
        tables: [
          {
            title: 'Per cashier', columns: ['Cashier', 'Orders', 'Revenue', 'Cash', 'Card'], widths: [2, 0.8, 1.1, 1.1, 1.1],
            rows: r.cashiers.map((c) => [c.cashier, String(c.orders), M2(c.revenue), M2(c.cash), M2(c.card)]),
          },
          {
            title: 'Shifts', columns: ['Cashier', 'Status', 'Expected', 'Actual', 'Variance'], widths: [1.8, 1, 1.1, 1.1, 1.1],
            rows: r.shifts.slice(0, 25).map((s) => [s.cashier, s.status, M2(s.expected_cash), M2(s.actual_cash), M2(s.variance)]),
          },
        ],
      },
      filename: pdfFilename('registers', f),
    };
  }
  if (type === 'orders') {
    const list = await getOrderHistory(catalystApp, { ...f, limit: 500 });
    const rev = round2(list.reduce((s, o) => s + (Number(o.total) || 0), 0));
    return {
      doc: {
        ...base,
        title: 'Orders Report',
        rangeLabel: f.label,
        kpis: [
          { label: 'Orders', value: String(list.length) },
          { label: 'Revenue', value: M2(rev) },
          { label: 'Average order', value: list.length > 0 ? M2(rev / list.length) : M2(0) },
          { label: 'Voids', value: String(list.filter((o) => normalizeOrderStatus(o.status).toLowerCase() === 'voided').length) },
        ],
        tables: [
          {
            title: 'Orders', columns: ['Order', 'Date', 'Customer', 'Total', 'Status'], widths: [1.4, 1, 2, 1, 1.2],
            rows: list.slice(0, 120).map((o) => [
              String(o.invoice_number && o.invoice_number !== '' ? o.invoice_number : `#${String(o.ROWID)}`),
              String(o.CREATEDTIME ?? '').slice(0, 10),
              String(o.customer_name ?? ''),
              M2(o.total),
              normalizeOrderStatus(o.status),
            ]),
          },
        ],
      },
      filename: pdfFilename('orders', f),
    };
  }
  // inventory
  const products = await fetchReportProducts(catalystApp);
  const catQ = f.category.toLowerCase();
  const seen = products.filter((p) => catQ === '' || `${String(p.category ?? '')} ${String(p.category_id ?? '')}`.toLowerCase().includes(catQ));
  const invVal = round2(seen.reduce((s, p) => {
    const cost = Number(p.cost_price);
    return s + (Number.isFinite(cost) && cost > 0 ? cost : (Number(p.rate) || 0)) * (Number(p.stock) || 0);
  }, 0));
  return {
    doc: {
      ...base,
      title: 'Inventory Report',
      rangeLabel: 'Snapshot',
      kpis: [
        { label: 'SKUs', value: String(seen.length) },
        { label: 'Units', value: String(seen.reduce((s, p) => s + (Number(p.stock) || 0), 0)) },
        { label: 'Stock value', value: M2(invVal) },
        { label: 'Low lines', value: String(seen.filter((p) => { const s = Number(p.stock) || 0; return s > 0 && s <= (Number(p.reorder_level) || 10); }).length) },
      ],
      tables: [
        {
          title: 'Catalog', columns: ['Product', 'SKU', 'Stock', 'Price', 'Value'], widths: [2.2, 1.2, 0.8, 1, 1.2],
          rows: seen.slice(0, 150).map((p) => {
            const cost = Number(p.cost_price);
            const unit = Number.isFinite(cost) && cost > 0 ? cost : (Number(p.rate) || 0);
            return [String(p.name ?? ''), String(p.sku ?? ''), String(Number(p.stock) || 0), M2(p.rate), M2(unit * (Number(p.stock) || 0))];
          }),
        },
      ],
    },
    filename: pdfFilename('inventory', f),
  };
}

/* ---------------- export endpoints ---------------- */

const REPORT_TYPES = ['revenue', 'products', 'customers', 'profit', 'registers', 'orders', 'inventory'];

function reportExportRole(role, type) {
  if (role === 'Admin' || role === 'Manager') return { ok: true };
  if (role === 'Storekeeper') {
    return type === 'products' || type === 'inventory'
      ? { ok: true }
      : { ok: false, error: 'This export is limited to Admin and Manager.' };
  }
  // Cashier/Waiter/Chef: own performance only (scoped below).
  if (['revenue', 'registers', 'orders'].includes(type)) return { ok: true, scoped: true };
  return { ok: false, error: 'This export is limited to Admin and Manager.' };
}

app.get('/api/reports/export/pdf', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const type = String((req.query && req.query.type) || '').trim().toLowerCase();
    if (!REPORT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: `type must be one of: ${REPORT_TYPES.join(', ')}` });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    const gate = reportExportRole(role, type);
    if (!gate.ok) return res.status(403).json({ success: false, error: gate.error });
    // PDF availability toggle (Settings → Reporting; default on).
    try {
      const bs = new ZohoBooksService(catalystApp, null);
      const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
      const flag = await bs.getConfig(`org_${orgId}_setting_report_pdf_enabled`);
      if (flag !== undefined && flag !== null && String(flag) !== '') {
        const s = String(flag).trim().toLowerCase();
        if (s === 'false' || s === '0' || s === 'no') {
          return res.status(403).json({ success: false, error: 'PDF export is disabled (see Settings → Reporting).' });
        }
      }
    } catch (e) { /* default on */ }
    let f = reportFilters(req.query);
    if (gate.scoped) {
      const scoped = scopeReportFilters(orgUserContext, f);
      f = scoped.filters;
    }
    if (type === 'profit' && !['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Profit reports require Admin or Manager.' });
    }
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    const { doc, filename } = await buildReportDocument(catalystApp, orgId, type, f);
    const pdf = buildReportPdf(doc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(Buffer.from(pdf, 'latin1'));
  } catch (error) {
    console.error('Error exporting PDF:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

function csvCell(v) {
  return `"${String(v ?? '').replace(/"/g, '""')}"`;
}

function csvDoc(name, headers, rows) {
  const lines = [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return { name, content: lines.join('\n') };
}

/** GET /api/reports/export/csv?type=&… — server-built CSVs honoring filters. */
app.get('/api/reports/export/csv', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const type = String((req.query && req.query.type) || '').trim().toLowerCase();
    if (!REPORT_TYPES.includes(type)) {
      return res.status(400).json({ success: false, error: `type must be one of: ${REPORT_TYPES.join(', ')}` });
    }
    const role = normWhRole(orgUserContext.orgUser && orgUserContext.orgUser.role);
    const gate = reportExportRole(role, type);
    if (!gate.ok) return res.status(403).json({ success: false, error: gate.error });
    let f = reportFilters(req.query);
    if (gate.scoped) f = scopeReportFilters(orgUserContext, f).filters;
    if (type === 'profit' && !['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Profit reports require Admin or Manager.' });
    }
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    const stamp = f.from !== '' ? `${f.from}_to_${f.to}` : 'all-time';
    let doc;
    if (type === 'revenue') {
      const r = await getRevenueReport(catalystApp, f);
      doc = csvDoc(`revenue-${stamp}.csv`, ['Day', 'Orders', 'Revenue'],
        r.revenue_by_day.map((d) => [d.day, d.orders, d.revenue.toFixed(2)]));
    } else if (type === 'products') {
      const r = await getProductPerformanceReport(catalystApp, f);
      const rows = [...r.best_sellers, ...r.slow_movers.filter((s) => !r.best_sellers.some((b) => b.sku === s.sku))];
      doc = csvDoc(`products-${stamp}.csv`, ['SKU', 'Name', 'Category', 'Qty sold', 'Revenue', 'Profit', 'Margin %', 'Stock'],
        rows.map((p) => [p.sku, p.name, p.category, p.quantity, p.revenue.toFixed(2), p.profit.toFixed(2), p.margin_pct, p.stock]));
    } else if (type === 'customers') {
      const r = await getCustomerReport(catalystApp, f);
      doc = csvDoc(`customers-${stamp}.csv`, ['Name', 'Email', 'Phone', 'Tier', 'Orders', 'Lifetime value'],
        [...r.top_customers].map((c) => [c.name, c.email, c.phone, c.tier, c.orders, c.lifetime_value.toFixed(2)]));
    } else if (type === 'profit') {
      const r = await getProfitReport(catalystApp, f);
      doc = csvDoc(`profit-${stamp}.csv`, ['Product', 'SKU', 'Category', 'Qty', 'Revenue', 'Cost', 'Profit', 'Margin %'],
        r.by_product.map((p) => [p.name, p.sku, p.category, p.quantity, p.revenue.toFixed(2), p.cost.toFixed(2), p.profit.toFixed(2), p.margin_pct]));
    } else if (type === 'registers') {
      const r = await getRegisterReport(catalystApp, f);
      doc = csvDoc(`registers-${stamp}.csv`, ['Cashier', 'Orders', 'Revenue', 'Cash', 'Card'],
        r.cashiers.map((c) => [c.cashier, c.orders, c.revenue.toFixed(2), c.cash.toFixed(2), c.card.toFixed(2)]));
    } else if (type === 'orders') {
      const list = await getOrderHistory(catalystApp, { ...f, limit: 500 });
      doc = csvDoc(`orders-${stamp}.csv`, ['Order', 'Date', 'Customer', 'Cashier', 'Subtotal', 'Tax', 'Total', 'Payment', 'Status'],
        list.map((o) => [String(o.invoice_number && o.invoice_number !== '' ? o.invoice_number : `#${String(o.ROWID)}`), String(o.CREATEDTIME ?? ''), o.customer_name ?? '', cashierNameOf(o), Number(o.subtotal || 0).toFixed(2), Number(o.tax_amount || 0).toFixed(2), Number(o.total || 0).toFixed(2), o.payment_mode ?? '', normalizeOrderStatus(o.status)]));
    } else {
      const products = await fetchReportProducts(catalystApp);
      doc = csvDoc(`inventory-${stamp}.csv`, ['SKU', 'Name', 'Category', 'Stock', 'Price', 'Value'],
        products.map((p) => {
          const cost = Number(p.cost_price);
          const unit = Number.isFinite(cost) && cost > 0 ? cost : (Number(p.rate) || 0);
          return [p.sku, p.name, p.category, Number(p.stock) || 0, Number(p.rate || 0).toFixed(2), (unit * (Number(p.stock) || 0)).toFixed(2)];
        }));
    }
    // Brand the payload with a UTF-8 BOM so Excel opens it cleanly.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
    res.status(200).send(`\uFEFF${doc.content}`);
  } catch (error) {
    console.error('Error exporting CSV:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   USR — RBAC CORE, USER LIFECYCLE, AUDIT LOGGING
   --------------------------------------------------------------------------
   Roles: Admin / Manager / Cashier / Storekeeper (built-in; Waiter and Chef
   retained for compatibility wherever sellers/kitchen staff operate).

   Permission model (roleCan):
     sell               POS checkout                    Admin Manager Cashier Waiter
     manage_products    catalog create/update/delete    Admin Manager
     adjust_stock       stock adjustments               Admin Manager Storekeeper
     manage_inventory   warehouses + transfers          Admin Manager Storekeeper
     view_reports       revenue/profit/customer/reg     Admin Manager
     manage_users       invite + update + role change   Admin Manager*
     delete_users       permanent removal               Admin
     manage_settings    settings + SMTP + master keys   Admin
     export_audit       audit CSV/PDF                   Admin
     (* Managers cannot touch Admin accounts or grant Admin.)

   Catalyst Authentication is untouched: it owns identity, sessions and
   passwords. This layer owns the POS roster (Configurations `user_*`
   JSON + OrgUsers rows), per-endpoint authorization, lifecycle state
   (active/inactive/invited) and the actor-based UserAuditLog trail.
   ========================================================================== */

const POS_BUILT_IN_ROLES = ['Admin', 'Manager', 'Cashier', 'Storekeeper'];
const POS_COMPAT_ROLES = ['Waiter', 'Chef'];
const POS_ALL_ROLES = [...POS_BUILT_IN_ROLES, ...POS_COMPAT_ROLES];

/** Normalized caller role (master_admin behaves as Admin). */
function callerRole(orgUserContext) {
  return normWhRole(orgUserContext && orgUserContext.orgUser && orgUserContext.orgUser.role);
}

/** Central permission matrix (USR-03). Unknown roles get nothing. */
function roleCan(role, permission) {
  const r = String(role ?? '');
  switch (permission) {
    case 'manage_profile':
      return ['Manager', 'Cashier', 'Storekeeper', 'Waiter', 'Chef'].includes(r);
    case 'signed_in':
      return ['Admin', 'Manager', 'Cashier', 'Storekeeper', 'Waiter', 'Chef'].includes(r);
    case 'read_products':
      return ['Admin', 'Manager', 'Cashier', 'Storekeeper', 'Waiter'].includes(r);
    case 'lookup_customers':
      return ['Admin', 'Manager', 'Cashier', 'Waiter'].includes(r);
    case 'manage_customers':
    case 'manage_operations':
      return ['Admin', 'Manager'].includes(r);
    case 'kitchen':
      return ['Admin', 'Manager', 'Waiter', 'Chef'].includes(r);
    case 'sell':
      return ['Admin', 'Manager', 'Cashier', 'Waiter'].includes(r);
    case 'manage_products':
      return ['Admin', 'Manager'].includes(r);
    case 'adjust_stock':
    case 'manage_inventory':
      return ['Admin', 'Manager', 'Storekeeper'].includes(r);
    case 'view_reports':
      return ['Admin', 'Manager'].includes(r);
    case 'manage_users':
      return ['Admin', 'Manager'].includes(r);
    case 'delete_users':
    case 'manage_settings':
    case 'export_audit':
      return r === 'Admin';
    default:
      return false;
  }
}

/** Required capability for each API family; new routes default to Admin-only. */
function apiPermission(method, path) {
  const read = method === 'GET' || method === 'HEAD';
  if (!path.startsWith('/api/')) return null;
  if (['/api/health', '/api/auth/me', '/api/setup/status', '/api/auth/status', '/api/auth/callback', '/api/organizations/register', '/api/admin/approve-org', '/api/admin/reject-org'].includes(path)) return null;
  if (path === '/api/profile/me' || path === '/api/profile/me/photo') return 'manage_profile';
  if (path === '/api/printing/qz/certificate' || path === '/api/printing/qz/sign') return 'signed_in';
  if (/^\/api\/(admin\/users|users)(\/|$)/.test(path)) return 'manage_users';
  if (path.startsWith('/api/admin/audit')) return 'manage_users';
  if (path.startsWith('/api/reports/') || path === '/api/dashboard/summary') return 'view_reports';
  if (path === '/api/items/stock-adjust') return 'adjust_stock';
  if (/^\/api\/(items|categories)(\/|$)/.test(path)) return read ? 'read_products' : 'manage_products';
  if (/^\/api\/(warehouses|warehouse-stock|stock-movements|transfers|purchases)(\/|$)/.test(path)) return 'manage_inventory';
  if (/^\/api\/(customers|contacts)(\/|$)/.test(path)) {
    if (read) return 'lookup_customers';
    if (/\/redeem$/.test(path)) return 'sell';
    return 'manage_customers';
  }
  if (path.startsWith('/api/loyalty/')) return read ? 'lookup_customers' : 'manage_operations';
  if (/^\/api\/orders(\/|$)/.test(path)) {
    if (/\/(void|return)$/.test(path)) return 'manage_operations';
    return 'sell';
  }
  if (path.startsWith('/api/shifts')) return 'sell';
  if (path.startsWith('/api/kot') || path === '/api/print-queue') return 'kitchen';
  // These read-only configuration values are needed by checkout and the shell.
  if (read && ['/api/config/settings', '/api/settings/company/logo', '/api/settings/tax', '/api/settings/payments', '/api/settings/printers', '/api/settings/print-routing'].includes(path)) return 'signed_in';
  if (read && path === '/api/settings/company') return 'signed_in';
  return 'manage_settings';
}

async function enforceApiPermissions(req, res, next) {
  const permission = apiPermission(req.method, req.path);
  if (!permission) return next();
  try {
    const catalystApp = catalyst.initialize(req);
    const context = await getCurrentOrgUser(req, catalystApp);
    if (!context) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(context, res, permission)) return;
    // Receipt, email, and print routes require the same ownership check as history.
    if (/^\/api\/orders\/[^/]+\/(receipt|email-receipt|print)$/.test(req.path)) {
      const id = req.path.split('/')[3];
      if (!isDigitsId(id)) return res.status(400).json({ success: false, error: 'Invalid order ID.' });
      const detail = await getOrderDetails(catalystApp, context.orgUser.org_id, id);
      if (!detail) return res.status(404).json({ success: false, error: 'Order not found.' });
      if (!canReadOrder(callerRole(context), context.user.email, detail.cashier.email)) {
        return res.status(403).json({ success: false, error: 'You can only view your own orders.' });
      }
    }
    return next();
  } catch (error) {
    return res.status(503).json({ success: false, error: 'Unable to verify access. Please try again.' });
  }
}

function customerLookup(customer) {
  const result = {};
  for (const key of ['ROWID', 'id', 'contact_id', 'name', 'contact_name', 'email', 'phone', 'type', 'contact_type', 'tier', 'loyalty_points', 'lifetime_points', 'status']) {
    if (customer[key] !== undefined) result[key] = customer[key];
  }
  return result;
}

function canReadOrder(role, email, ownerEmail) {
  if (role === 'Admin' || role === 'Manager') return true;
  return ['Cashier', 'Waiter'].includes(role) && !!email && !!ownerEmail &&
    String(email).toLowerCase() === String(ownerEmail).toLowerCase();
}

/* ---------------- reusable route guards (USR-03 middleware) ---------------- */

/** 401 unless a Catalyst session resolves; null when it does not. */
async function requireAuth(req, catalystApp) {
  try {
    return await getCurrentOrgUser(req, catalystApp);
  } catch (e) {
    return null;
  }
}

/** Permission gate against the roleCan() matrix. */
function requirePermission(orgUserContext, res, permission, message) {
  if (roleCan(callerRole(orgUserContext), permission)) return true;
  res.status(403).json({ success: false, error: message || 'Your role cannot perform this action.' });
  return false;
}

/* ---------------- roster store (Configurations user_* + OrgUsers) ---------------- */

function rosterKey(email) {
  return `user_${String(email ?? '').replace(/[^a-zA-Z0-9]/g, '_')}`;
}

/** Read the full team roster (same merge order as GET /api/users). */
async function readUserRoster(catalystApp, orgUserContext) {
  const { user, orgUser } = orgUserContext;
  const orgId = orgUser.org_id;
  const usersMap = new Map();
  const currentActiveUser = {
    email: user.email,
    name: orgUser.display_name || user.email,
    role: orgUser.role === 'master_admin' ? 'Admin' : (orgUser.role || 'Cashier'),
    permissions: getRolePermissions(orgUser.role || 'Cashier'),
    status: 'active',
    invited_at: Date.now(),
    verified_at: Date.now(),
  };
  usersMap.set(String(user.email).toLowerCase(), currentActiveUser);
  // Roster JSON FIRST: full profile incl. lifecycle status (OrgUsers rows
  // carry no status and would otherwise mask deactivations as Active).
  // Fetch-all + JS prefix filter (same proven pattern as the adopted company
  // scan) instead of a LIKE predicate, so no operator doubt can hide rows.
  try {
    const configUsers = await safeZcql(catalystApp,
      `SELECT config_key, config_value FROM Configurations LIMIT 300`
    );
    if (configUsers && configUsers.length > 0) {
      configUsers.forEach((row) => {
        if (String(row.Configurations.config_key || '').startsWith('user_')
          && row.Configurations.config_value !== 'used') {
          try {
            const u = JSON.parse(row.Configurations.config_value);
            if (u && u.email && !usersMap.has(String(u.email).toLowerCase())) {
              usersMap.set(String(u.email).toLowerCase(), {
                ...u,
                role: u.role === 'master_admin' ? 'Admin' : (u.role || 'Cashier'),
                permissions: getRolePermissions(u.role),
              });
            }
          } catch (e) { /* ignore parse errors */ }
        }
      });
    }
  } catch (configErr) {
    console.warn('[roster] Legacy config query failed:', configErr.message);
  }
  try {
    const orgUserItems = await listOrgUserRows(catalystApp, orgId);
    if (orgUserItems.length > 0) {
      for (const item of orgUserItems) {
        const userEmail = item.user_id;
        const userRole = item.role === 'master_admin' ? 'Admin' : (item.role || 'Cashier');
        if (userEmail && !usersMap.has(String(userEmail).toLowerCase())) {
          usersMap.set(String(userEmail).toLowerCase(), {
            email: userEmail,
            name: item.display_name || userEmail,
            role: userRole,
            permissions: getRolePermissions(userRole),
            status: 'active',
            invited_at: Date.now(),
            verified_at: Date.now(),
          });
        }
      }
    }
  } catch (err) {
    console.warn('[roster] OrgUsers query failed, falling back to legacy Configurations', err.message);
  }
  // Catalyst Auth accounts with no roster/OrgUsers entry (console-added or
  // self-registered members) must still appear on the Users page so an Admin
  // can assign them a POS role. Best-effort: never blocks the list.
  try {
    const authUsers = await catalystApp.userManagement().getAllUsers();
    for (const au of (Array.isArray(authUsers) ? authUsers : [])) {
      const auEmail = String((au && (au.email_id || au.email)) || '').trim().toLowerCase();
      if (auEmail === '' || !auEmail.includes('@') || usersMap.has(auEmail)) continue;
      const auName = [au.first_name, au.last_name].filter(Boolean).join(' ').trim() || auEmail.split('@')[0];
      usersMap.set(auEmail, {
        email: auEmail,
        name: auName,
        role: 'Unassigned',
        permissions: {},
        status: 'active',
        invited_at: null,
        verified_at: null,
        last_login: null,
        invited_by: '',
      });
    }
  } catch (authErr) {
    console.warn('[roster] Catalyst Auth user merge skipped:', extractSdkMessage(authErr));
  }
  return Array.from(usersMap.values());
}

/** Find one roster record by email (Configurations store). */
async function findRosterUser(catalystApp, email) {
  const key = rosterKey(email);
  const rows = await safeZcql(catalystApp,
    `SELECT ROWID, config_value FROM Configurations WHERE config_key = '${key}' LIMIT 1`
  );
  if (!rows || rows.length === 0) return null;
  try {
    return { ROWID: rows[0].Configurations.ROWID, data: JSON.parse(rows[0].Configurations.config_value) };
  } catch (e) {
    throw new Error('Invalid POS role record.');
  }
}

async function saveRosterUser(catalystApp, email, data) {
  await safeUpsertConfig(catalystApp, rosterKey(email), JSON.stringify(data));
}

/** Best-effort OrgUsers role sync (roster JSON stays the source of truth). */
/** Ensure the Catalyst login account exists AND trigger the platform
 * password email (USR-01 mail gap).
 * registerUser sends Catalyst's own activation/confirm mail; resetPassword()
 * hits /project-user/forgotpassword, which emails a second password link.
 * Invite flows pass { passwordMail: false } so the member gets EXACTLY ONE
 * mail (the registerUser confirm mail) — no recovery mail, no SMTP welcome
 * mail. The Reset-password endpoint keeps the default (true). Returns
 * { created, exists, failed, mailSent, detail }. All best-effort — never
 * throws, never blocks the caller. */
/** Catalyst SDK errors are often plain objects ({status, code, message}),
 * not Error instances — String(e) on those yields "[object Object]" and
 * hides the real reason (this blanked invite failure details). */
function extractSdkMessage(e) {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === 'object') {
    const parts = [
      e.message, e.error,
      e.code !== undefined && e.code !== '' ? `code=${e.code}` : '',
      e.status !== undefined && e.status !== '' ? `status=${e.status}` : '',
    ].filter(Boolean).map(String);
    if (parts.length > 0) return parts.join(' ');
    try { return JSON.stringify(e).slice(0, 300); } catch { /* fall through */ }
  }
  return String(e);
}

/**
 * Remove the Catalyst Authentication login for an already-authorized roster
 * deletion. This is deliberately best-effort: role/roster revocation has
 * already completed, so an Auth SDK outage must never turn that success into
 * a 500 or target any account other than this exact email.
 */
function removeCatalystAuthLogin(catalystApp, email) {
  const target = String(email || '').trim().toLowerCase();
  return (async () => {
    try {
      const users = await catalystApp.userManagement().getAllUsers();
      const hit = (Array.isArray(users) ? users : []).find((user) => {
        const candidate = String((user && (user.email_id || user.email)) || '').trim().toLowerCase();
        return candidate !== '' && candidate === target;
      });
      if (!hit) return { auth_removed: true, auth_detail: 'Login account was already absent.' };
      // deleteUser() calls /project-user/:id. Catalyst's list response carries
      // both a Zoho account ZUID and the project User ID; only `user_id` is
      // valid for that endpoint (passing the ZUID returns INVALID_ID).
      const projectUserId = String(hit.user_id || '').trim();
      if (projectUserId === '') return { auth_removed: false, auth_detail: 'Matching login has no Catalyst project user id.' };
      const removed = await catalystApp.userManagement().deleteUser(projectUserId);
      return removed
        ? { auth_removed: true, auth_detail: 'Login account removed.' }
        : { auth_removed: false, auth_detail: 'Catalyst did not confirm login removal.' };
    } catch (e) {
      return { auth_removed: false, auth_detail: extractSdkMessage(e) };
    }
  })();
}

async function ensureAuthAccount(catalystApp, { email, firstName, lastName }, { passwordMail = true } = {}) {
  const out = { created: false, exists: false, failed: false, mailSent: false, detail: '' };
  // ICatalystSignupUserConfig allows ONLY email_id + first_name + optional
  // last_name (+ optional role_id/org_id). A `role` string or an empty
  // last_name is rejected by /project-user with INVALID_INPUT, so build the
  // payload exactly like the working approve-org call. POS roles (Admin /
  // Manager / Cashier / Storekeeper) live in the roster + OrgUsers sync, NOT
  // in Catalyst Auth.
  const userDetails = {
    email_id: email,
    first_name: String(firstName || '').trim() || String(email).split('@')[0],
  };
  if (lastName !== undefined && lastName !== null && String(lastName).trim() !== '') {
    userDetails.last_name = String(lastName).trim();
  }
  try {
    await catalystApp.userManagement().registerUser({ platform_type: 'web' }, userDetails);
    out.created = true;
  } catch (e) {
    const msg = extractSdkMessage(e);
    if (/already exists|duplicate|already registered/i.test(msg)) out.exists = true;
    else { out.failed = true; out.detail = msg; console.warn('[admin/users] registerUser:', msg); }
  }
  if ((out.created || out.exists) && passwordMail) {
    try {
      await catalystApp.userManagement().resetPassword(email, { platform_type: 'web' });
      out.mailSent = true;
    } catch (e) {
      console.warn('[admin/users] platform password email not sent:', extractSdkMessage(e));
    }
  }
  return out;
}

/** Resolve the working org id: caller context first, else the (single)
 * Organizations row, else 'org_default'. Invite-time callers often resolve
 * via the virtual fallback (org_default), which used to stamp every new
 * roster row with the dummy id — resolving here keeps real org ids. */
async function resolveOrgId(catalystApp, contextOrgId) {
  const ctx = String(contextOrgId || '').trim();
  if (ctx !== '' && ctx !== 'org_default') return ctx;
  try {
    const rows = await safeZcql(catalystApp, `SELECT ROWID FROM Organizations LIMIT 1`);
    if (rows && rows.length > 0 && rows[0].Organizations && rows[0].Organizations.ROWID) {
      return String(rows[0].Organizations.ROWID);
    }
  } catch (e) { /* fall through */ }
  return ctx !== '' ? ctx : 'org_default';
}

/** Best-effort OrgUsers upsert (invite + role changes converge here).
 * Matches existing rows by email; inserts email-keyed rows when missing so
 * admin actions from the Users page never need the Catalyst console.
 * Also heals stale 'org_default' stamps when the real org is known.
 * Roster JSON stays the source of truth; failures never block the caller. */
async function syncOrgUserRole(catalystApp, email, role, extra) {
  try {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (cleanEmail === '') return false;
    const wantRole = String(role || 'Cashier');
    const wantName = String((extra && extra.displayName) || '').trim() || cleanEmail.split('@')[0];
    const orgId = await resolveOrgId(catalystApp, extra && extra.orgId);
    const rows = await safeZcql(catalystApp,
      `SELECT ROWID, display_name, org_id FROM OrgUsers WHERE user_id = '${sanitizeZcql(cleanEmail)}' LIMIT 1`
    );
    if (rows && rows.length > 0) {
      const patch = { ROWID: rows[0].OrgUsers.ROWID, role: wantRole };
      if (extra && extra.displayName !== undefined) patch.display_name = wantName;
      if (orgId !== '' && orgId !== 'org_default') patch.org_id = orgId;
      await catalystApp.datastore().table('OrgUsers').updateRow(patch);
      return true;
    }
    await catalystApp.datastore().table('OrgUsers').insertRow({
      org_id: orgId,
      user_id: cleanEmail,
      role: wantRole,
      display_name: wantName,
    });
    return true;
  } catch (e) { console.warn('[roster] OrgUsers upsert skipped:', e.message); return false; }
}

/** List OrgUsers roster rows for an org, including legacy 'org_default'
 * stamps so mixed-org-id teams still list completely. Deduplicated by
 * user_id. Never throws (returns []). */
async function listOrgUserRows(catalystApp, orgId) {
  const out = [];
  const seen = new Set();
  const ctx = String(orgId || '').trim() || 'org_default';
  const queries = [`SELECT user_id, role, display_name FROM OrgUsers WHERE org_id = '${sanitizeZcql(ctx)}' LIMIT 300`];
  if (ctx !== 'org_default') {
    queries.push(`SELECT user_id, role, display_name FROM OrgUsers WHERE org_id = 'org_default' LIMIT 300`);
  } else {
    // Virtual-viewer fallback: owner/Admins with no OrgUsers row resolve to
    // org_default while team rows carry the real org id — a filtered query
    // alone hides the whole team (users then show as Unassigned via the Auth
    // merge). Full scan so nobody is hidden; tiny team-sized table.
    queries.push(`SELECT user_id, role, display_name FROM OrgUsers LIMIT 300`);
  }
  for (const q of queries) {
    try {
      const rows = await safeZcql(catalystApp, q);
      for (const r of rows || []) {
        const item = r.OrgUsers;
        const key = String(item.user_id ?? '').trim().toLowerCase();
        if (key !== '' && !seen.has(key)) { seen.add(key); out.push(item); }
      }
    } catch (e) { /* keep going */ }
  }
  return out;
}

/** Adopt a console-only user (OrgUsers row, no roster JSON) into the roster
 * store so role/status/profile edits work for staff added outside Invite.
 * Returns { data } like findRosterUser, or null when neither store knows
 * the target. Never throws. */
async function adoptRosterUser(catalystApp, targetEmail) {
  try {
    const clean = String(targetEmail || '').trim().toLowerCase();
    if (clean === '' || !clean.includes('@')) return null;
    const found = await findRosterUser(catalystApp, clean);
    if (found) return found;
    const rows = await safeZcql(catalystApp,
      `SELECT role, display_name FROM OrgUsers WHERE user_id = '${sanitizeZcql(clean)}' LIMIT 1`
    );
    if (!rows || rows.length === 0) return null;
    const r = rows[0].OrgUsers;
    const data = {
      email: clean,
      name: String(r.display_name || clean.split('@')[0]),
      role: String(r.role || 'Cashier'),
      permissions: getRolePermissions(String(r.role || 'Cashier')),
      status: 'active',
      phone: '', notes: '', invited_at: Date.now(), verified_at: Date.now(),
      invited_by: '', last_login: null,
    };
    await saveRosterUser(catalystApp, clean, data);
    return { data };
  } catch (e) { return null; }
}

/** Remove every OrgUsers row for a target (email, case-insensitive).
 * Used by both delete paths so removal revokes the role everywhere, not
 * just in the roster JSON. Returns the removed count. Never throws. */
async function deleteOrgUserRows(catalystApp, target) {
  try {
    const t = String(target || '').trim().toLowerCase();
    if (t === '') return 0;
    const rows = await safeZcql(catalystApp, `SELECT ROWID, user_id FROM OrgUsers LIMIT 300`);
    let n = 0;
    for (const r of rows || []) {
      const item = r.OrgUsers;
      if (String(item.user_id ?? '').trim().toLowerCase() === t) {
        try { await catalystApp.datastore().table('OrgUsers').deleteRow(item.ROWID); n++; } catch (e) { /* keep going */ }
      }
    }
    return n;
  } catch (e) { console.warn('[roster] OrgUsers delete skipped:', e.message); return 0; }
}

/** True when an explicit roster record marks the account inactive. */
async function isAccountDeactivated(catalystApp, email) {
  try {
    const found = await findRosterUser(catalystApp, email);
    return !!found && String(found.data.status || 'active').toLowerCase() === 'inactive';
  } catch (e) {
    return false;
  }
}

/** Count active Admins (self-delete / last-admin guards). */
async function countActiveAdmins(catalystApp, orgUserContext) {
  try {
    const roster = await readUserRoster(catalystApp, orgUserContext);
    return roster.filter((u) => {
      const r = u.role === 'master_admin' ? 'Admin' : u.role;
      return r === 'Admin' && String(u.status || 'active').toLowerCase() === 'active';
    }).length;
  } catch (e) {
    return 1; // Fail closed-safe: unknown state blocks destructive admin ops.
  }
}

function shapeAdminUser(u) {
  return {
    email: u.email,
    name: u.name || u.email,
    role: u.role === 'master_admin' ? 'Admin' : (u.role || 'Cashier'),
    status: String(u.status || 'active').toLowerCase() === 'inactive' ? 'Inactive' : 'Active',
    phone: u.phone || '',
    notes: u.notes || '',
    permissions: u.permissions || getRolePermissions(u.role),
    invited_at: u.invited_at || null,
    verified_at: u.verified_at || null,
    last_login: u.last_login || null,
    invited_by: u.invited_by || '',
  };
}

/* ---------------- audit engine (USR-05) ---------------- */

const AUDIT_ACTIONS = [
  'LOGIN', 'LOGOUT', 'USER_CREATED', 'USER_UPDATED', 'USER_DELETED',
  'USER_ACTIVATED', 'USER_DEACTIVATED', 'ROLE_CHANGED', 'PASSWORD_RESET',
  'ORDER_CREATED', 'ORDER_VOIDED', 'ORDER_REFUNDED', 'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED', 'POINTS_ADJUSTED', 'PRODUCT_CREATED', 'PRODUCT_UPDATED',
  'PRODUCT_DELETED', 'CATEGORY_CREATED', 'CATEGORY_UPDATED', 'CATEGORY_DELETED',
  'STOCK_ADJUSTED', 'WAREHOUSE_CREATED', 'WAREHOUSE_UPDATED', 'WAREHOUSE_DELETED',
  'TRANSFER_CREATED', 'TRANSFER_APPROVED', 'TRANSFER_COMPLETED', 'TRANSFER_CANCELLED',
  'SHIFT_OPENED', 'SHIFT_CLOSED', 'SETTINGS_CHANGED', 'REPORT_EXPORTED',
  'KOT_ACKED', 'KOT_DONE', 'KOT_REPRINTED',
];

/** Fail-open audit write. Never throws. */
async function logAuditLog(catalystApp, entry) {
  try {
    await catalystApp.datastore().table('UserAuditLog').insertRow({
      user_id: String((entry && entry.userId) || ''),
      actor_id: String((entry && entry.actorId) || ''),
      actor_name: String((entry && entry.actorName) || ''),
      actor_role: String((entry && entry.actorRole) || ''),
      action: String((entry && entry.action) || ''),
      entity_type: String((entry && entry.entityType) || ''),
      entity_id: String((entry && entry.entityId) || ''),
      entity_name: String((entry && entry.entityName) || ''),
      old_value: String((entry && entry.oldValue) || '').slice(0, 2000),
      new_value: String((entry && entry.newValue) || '').slice(0, 2000),
      ip_address: String((entry && entry.ip) || '').slice(0, 64),
      user_agent: String((entry && entry.userAgent) || '').slice(0, 300),
      created_at: formatCatalystDateTime(new Date()),
    });
    return true;
  } catch (err) {
    console.warn('[AUDIT] Write skipped (provision UserAuditLog):', err.message);
    return false;
  }
}

function auditIp(req) {
  const fwd = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')[0].trim();
  return fwd || req.ip || '';
}

/** Drop secrets from audited payloads. */
function sanitizeAuditValue(value) {
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value ?? {});
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const k of Object.keys(parsed)) {
        if (/pass|secret|token|pwd|key/i.test(k)) parsed[k] = '***';
      }
      return JSON.stringify(parsed).slice(0, 1000);
    }
    return String(raw).slice(0, 1000);
  } catch (e) {
    return String(value ?? '').slice(0, 1000);
  }
}

/** Map a mutating request to an audit action (or '' to skip). */
function auditActionFor(method, path) {
  const p = String(path || '');
  const M = String(method || '').toUpperCase();
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(M)) return '';
  if (/^\/api\/admin\/users$/.test(p) && M === 'POST') return 'USER_CREATED';
  if (/^\/api\/admin\/users\/.+\/activate$/.test(p)) return 'USER_ACTIVATED';
  if (/^\/api\/admin\/users\/.+\/deactivate$/.test(p)) return 'USER_DEACTIVATED';
  if (/^\/api\/admin\/users\/.+\/reset-password$/.test(p)) return 'PASSWORD_RESET';
  if (/^\/api\/admin\/users\/.+\/change-role$/.test(p)) return 'ROLE_CHANGED';
  if (/^\/api\/admin\/users\/.+$/.test(p)) {
    if (M === 'PUT') return 'USER_UPDATED';
    if (M === 'DELETE') return 'USER_DELETED';
    return '';
  }
  if (/^\/api\/users\/update-role$/.test(p)) return 'ROLE_CHANGED';
  if (/^\/api\/users\/delete$/.test(p)) return 'USER_DELETED';
  if (/^\/api\/users\/invite$/.test(p)) return 'USER_CREATED';
  if (/^\/api\/orders$/.test(p) && M === 'POST') return 'ORDER_CREATED';
  if (/^\/api\/orders\/.+\/void$/.test(p)) return 'ORDER_VOIDED';
  if (/^\/api\/orders\/.+\/return$/.test(p)) return 'ORDER_REFUNDED';
  if (/^\/api\/customers\/.+\/redeem$/.test(p)) return 'POINTS_ADJUSTED';
  if (/^\/api\/loyalty\/campaigns/.test(p)) {
    if (M === 'POST' || M === 'PUT') return 'SETTINGS_CHANGED';
    return '';
  }
  if (/^\/api\/stock-movements$/.test(p)) return '';
  if (/^\/api\/settings\/(payments|notifications\/digest)$/.test(p)) return 'SETTINGS_CHANGED';
  if (/^\/api\/items\/stock-adjust$/.test(p)) return 'STOCK_ADJUSTED';
  if (/^\/api\/items\/import$/.test(p)) return 'PRODUCT_CREATED';
  if (/^\/api\/items\/.+\/image$/.test(p)) return 'PRODUCT_UPDATED';
  if (/^\/api\/items$/.test(p)) return M === 'POST' ? 'PRODUCT_CREATED' : '';
  if (/^\/api\/items\/.+$/.test(p)) {
    if (M === 'PUT') return 'PRODUCT_UPDATED';
    if (M === 'DELETE') return 'PRODUCT_DELETED';
    return '';
  }
  if (/^\/api\/categories\/repair$/.test(p)) return 'CATEGORY_UPDATED';
  if (/^\/api\/categories$/.test(p)) return M === 'POST' ? 'CATEGORY_CREATED' : '';
  if (/^\/api\/categories\/.+$/.test(p)) {
    if (M === 'PUT') return 'CATEGORY_UPDATED';
    if (M === 'DELETE') return 'CATEGORY_DELETED';
    return '';
  }
  if (/^\/api\/warehouses\/.+\/default$/.test(p)) return 'WAREHOUSE_UPDATED';
  if (/^\/api\/warehouses$/.test(p)) return M === 'POST' ? 'WAREHOUSE_CREATED' : '';
  if (/^\/api\/warehouses\/.+$/.test(p)) {
    if (M === 'PUT') return 'WAREHOUSE_UPDATED';
    if (M === 'DELETE') return 'WAREHOUSE_DELETED';
    return '';
  }
  if (/^\/api\/warehouse-stock\/adjust$/.test(p)) return 'STOCK_ADJUSTED';
  if (/^\/api\/transfers$/.test(p) && M === 'POST') return 'TRANSFER_CREATED';
  if (/^\/api\/transfers\/.+\/approve$/.test(p)) return 'TRANSFER_APPROVED';
  if (/^\/api\/transfers\/.+\/complete$/.test(p)) return 'TRANSFER_COMPLETED';
  if (/^\/api\/transfers\/.+\/cancel$/.test(p)) return 'TRANSFER_CANCELLED';
  if (/^\/api\/customers\/.+\/adjust-points$/.test(p)) return 'POINTS_ADJUSTED';
  if (/^\/api\/customers$/.test(p)) return M === 'POST' ? 'CUSTOMER_CREATED' : '';
  if (/^\/api\/customers\/.+$/.test(p)) {
    if (M === 'PUT') return 'CUSTOMER_UPDATED';
    if (M === 'DELETE') return 'CUSTOMER_UPDATED';
    return '';
  }
  if (/^\/api\/contacts$/.test(p) && M === 'POST') return 'CUSTOMER_CREATED';
  if (/^\/api\/shifts\/open$/.test(p)) return 'SHIFT_OPENED';
  if (/^\/api\/shifts\/close$/.test(p)) return 'SHIFT_CLOSED';
  if (/^\/api\/config\/settings$/.test(p)) return 'SETTINGS_CHANGED';
  if (/^\/api\/config\/smtp$/.test(p)) return 'SETTINGS_CHANGED';
  if (/^\/api\/settings\/(company|tax|notifications)(\/logo)?$/.test(p)) return 'SETTINGS_CHANGED';
  if (/^\/api\/auth\/save-master-credentials$/.test(p)) return 'SETTINGS_CHANGED';
  if (/^\/api\/auth\/seed-credentials$/.test(p)) return 'SETTINGS_CHANGED';
  return '';
}

/** Best-effort entity description from path + body. */
function auditEntityFor(req) {
  const p = String(req.path || req.url || '');
  const body = (req.body && typeof req.body === 'object') ? req.body : {};
  const seg = (re) => {
    const m = p.match(re);
    return m ? decodeURIComponent(m[1]) : '';
  };
  const pick = (...keys) => {
    for (const k of keys) {
      if (body[k] !== undefined && body[k] !== null && String(body[k]) !== '') return String(body[k]);
    }
    return '';
  };
  if (p.startsWith('/api/admin/users') || p.startsWith('/api/users')) {
    const raw = seg(/^\/api\/(?:admin\/users|users)\/([^/]+)/) || pick('email') || '';
    const email = /^(activate|deactivate|reset-password|change-role|invite|delete|update-role)$/.test(raw) ? '' : raw;
    return { entityType: 'user', entityId: email, entityName: pick('name', 'email') || email };
  }
  if (p.startsWith('/api/orders')) {
    return { entityType: 'order', entityId: seg(/^\/api\/orders\/([^/]+)/) || '', entityName: pick('invoice_number', 'local_ref', 'customer_name') };
  }
  if (p.startsWith('/api/items') || p.startsWith('/api/categories')) {
    return { entityType: 'product', entityId: seg(/^\/api\/(?:items|categories)\/([^/]+)/) || '', entityName: pick('name', 'sku') };
  }
  if (p.startsWith('/api/warehouse') || p.startsWith('/api/transfers')) {
    return { entityType: 'inventory', entityId: seg(/^\/api\/(?:warehouses|transfers)\/([^/]+)/) || pick('transfer_number'), entityName: pick('name', 'code', 'transfer_number', 'notes') };
  }
  if (p.startsWith('/api/customers') || p.startsWith('/api/contacts')) {
    return { entityType: 'customer', entityId: seg(/^\/api\/customers\/([^/]+)/) || '', entityName: pick('name', 'email') };
  }
  if (p.startsWith('/api/shifts')) {
    return { entityType: 'shift', entityId: pick('rowid'), entityName: pick('cashier_name') };
  }
  if (p.startsWith('/api/config') || p.startsWith('/api/auth')) {
    return { entityType: 'settings', entityId: '', entityName: Object.keys(body).filter((k) => !/pass|secret|token/i.test(k)).slice(0, 5).join(',') };
  }
  return { entityType: '', entityId: '', entityName: '' };
}

/**
 * USR-05 audit middleware: observes successful mutating API calls and
 * appends an actor-based record after the response is sent. Read-only
 * requests, health/setup/auth handshakes and failed calls are skipped.
 */
function auditMiddleware(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return next();
  const action = auditActionFor(method, req.path);
  if (action === '') return next();
  res.on('finish', () => {
    try {
      if (res.statusCode >= 400) return;
      const catalystApp = catalyst.initialize(req);
      getCurrentOrgUser(req, catalystApp).then((ctx) => {
        if (!ctx || !ctx.user) return;
        const ent = auditEntityFor(req);
        const email = String(ctx.user.email || ctx.user.email_id || '');
        const role = callerRole(ctx);
        logAuditLog(catalystApp, {
          userId: String(ctx.user.user_id || ctx.user.zaid || ''),
          actorId: String(ctx.user.user_id || ctx.user.zaid || ''),
          actorName: (ctx.orgUser && ctx.orgUser.display_name)
            || [ctx.user.first_name, ctx.user.last_name].filter(Boolean).join(' ') || email,
          actorRole: role,
          action,
          entityType: ent.entityType,
          entityId: ent.entityId,
          entityName: ent.entityName,
          oldValue: '',
          newValue: sanitizeAuditValue(req.body),
          ip: auditIp(req),
          userAgent: String((req.headers && req.headers['user-agent']) || ''),
        }).catch(() => {});
      }).catch(() => {});
    } catch (e) { /* audit never breaks the request */ }
  });
  next();
}

/* ---------------- admin user APIs (USR-01 / USR-04) ---------------- */

function adminEmailParam(req) {
  return String(req.params.id || req.params.email || '').trim();
}

/** GET /api/admin/users — roster with lifecycle state (Admin/Manager). */
app.get('/api/admin/users', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_users')) return;
    const roster = await readUserRoster(catalystApp, orgUserContext);
    res.status(200).json({ success: true, count: roster.length, users: roster.map(shapeAdminUser) });
  } catch (error) {
    console.error('Error listing admin users:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/admin/users/:id — one member by email (Admin/Manager). */
app.get('/api/admin/users/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_users')) return;
    const roster = await readUserRoster(catalystApp, orgUserContext);
    const hit = roster.find((u) => String(u.email).toLowerCase() === adminEmailParam(req).toLowerCase());
    if (!hit) return res.status(404).json({ success: false, error: 'User not found.' });
    res.status(200).json({ success: true, user: shapeAdminUser(hit) });
  } catch (error) {
    console.error('Error fetching admin user:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Catalyst project user when possible (best-effort: self-signup projects
 * reject unknown emails until the member signs in once), always creates the
 * POS roster entry, upserts the OrgUsers row (no console work needed), and
 * audits the outcome. Shared by POST /api/admin/users and the legacy
 * POST /api/users/invite alias.
 */
async function handleInviteUser(req, res) {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_users')) return;
    const role = callerRole(orgUserContext);
    // Admin-only invites: Managers can manage existing users but cannot invite.
    if (role !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Only Admins can invite users.' });
    }
    const callerOrgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    const { name, email, role: newRole, phone, notes } = req.body || {};
    if (!email || String(email).trim() === '') {
      return res.status(400).json({ success: false, error: 'Email is required.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ success: false, error: 'Email address looks invalid.' });
    }
    const wantRole = String(newRole || 'Cashier').trim();
    if (!POS_ALL_ROLES.includes(wantRole)) {
      return res.status(400).json({ success: false, error: `Role must be one of: ${POS_ALL_ROLES.join(', ')}.` });
    }
    if (role !== 'Admin' && wantRole === 'Admin') {
      return res.status(403).json({ success: false, error: 'Only Admins can create Admin accounts.' });
    }
    // Invitations toggle (Settings → Administration; default on).
    try {
      const bs = new ZohoBooksService(catalystApp, null);
      const flag = await bs.getConfig(`org_${callerOrgId}_setting_admin_allow_invitations`);
      if (flag !== undefined && flag !== null && String(flag) !== '') {
        const s = String(flag).trim().toLowerCase();
        if (s === 'false' || s === '0' || s === 'no') {
          return res.status(403).json({ success: false, error: 'User invitations are disabled (see Settings → Administration).' });
        }
      }
    } catch (e) { /* default on */ }
    const existing = await findRosterUser(catalystApp, cleanEmail);
    if (existing) {
      // Idempotent retry: a previous attempt may have written the roster but
      // missed the OrgUsers row (older backend) — heal it here instead of
      // dead-ending. Single-mail rule: only the registerUser confirm mail is
      // ever sent (passwordMail: false); no SMTP welcome mail here.
      const existingRole = String(existing.data.role || 'Cashier');
      // A retry may also be missing the login account itself — repair that too.
      const retryAuth = await ensureAuthAccount(catalystApp, {
        email: cleanEmail,
        firstName: String(existing.data.name || '').split(' ')[0] || cleanEmail.split('@')[0],
        lastName: String(existing.data.name || '').split(' ').slice(1).join(' ') || '',
      }, { passwordMail: false });
      await syncOrgUserRole(catalystApp, cleanEmail, existingRole, {
        orgId: callerOrgId,
        displayName: String(existing.data.name || cleanEmail.split('@')[0]),
      });
      const retryAccountPart = retryAuth.failed
        ? ` Login account still missing (${retryAuth.detail || 'unknown error'}) — create it in console Authentication.`
        : (retryAuth.created ? ` Login account created — Catalyst emailed a confirmation link to set the password (the only email sent).` : ``);
      return res.status(200).json({
        success: true,
        message: `User '${cleanEmail}' was already invited (role ${existingRole}); record repaired.${retryAccountPart}`,
        user: shapeAdminUser(existing.data),
        already_existed: true,
        password_email_sent: retryAuth.mailSent,
        invite_email_sent: false,
      });
    }
    // 1. Catalyst login account (best-effort). Single-mail rule: the member
    // gets EXACTLY ONE mail — Catalyst's own registerUser confirm mail.
    // No resetPassword mail, no SMTP welcome mail on invites.
    const auth = await ensureAuthAccount(catalystApp, {
      email: cleanEmail,
      firstName: String(name || '').trim().split(' ')[0] || cleanEmail.split('@')[0],
      lastName: String(name || '').trim().split(' ').slice(1).join(' ') || '',
    }, { passwordMail: false });
    const catalystInvited = auth.created || auth.exists;
    let accountNote = '';
    if (auth.failed) {
      accountNote = ` Login account not created (${auth.detail || 'unknown error'}) — invite them from console Authentication; the role below still applies on first login.`;
    } else if (auth.exists) {
      accountNote = ' A login account with this email already exists — ask them to sign in (or use "Forgot password" if needed); no new email was sent.';
    }
    // 2. POS roster entry (source of truth for role + lifecycle).
    const actorEmail = String(orgUserContext.user.email || orgUserContext.user.email_id || '');
    const record = {
      email: cleanEmail,
      org_id: callerOrgId,
      name: String(name || '').trim() || cleanEmail.split('@')[0],
      role: wantRole,
      permissions: getRolePermissions(wantRole),
      status: 'active',
      phone: String(phone || '').trim(),
      notes: String(notes || '').trim(),
      invited_at: Date.now(),
      verified_at: Date.now(),
      invited_by: actorEmail,
      last_login: null,
    };
    await saveRosterUser(catalystApp, cleanEmail, record);
    // Auto-maintain the OrgUsers row so no console work is ever needed.
    await syncOrgUserRole(catalystApp, cleanEmail, wantRole, {
      orgId: callerOrgId,
      displayName: String(name || '').trim() || cleanEmail.split('@')[0],
    });
    // No SMTP welcome mail on invites (single-mail rule) — the registerUser
    // confirm mail is the only email the member receives.
    const confirmNote = auth.created
      ? ' Catalyst emailed them a confirmation link to set their password (the only email sent).'
      : '';
    res.status(201).json({
      success: true,
      message: `User ${cleanEmail} invited with role ${wantRole}.${confirmNote}${accountNote}`,
      user: shapeAdminUser(record),
      catalyst_invited: catalystInvited,
      password_email_sent: auth.mailSent,
      invite_email_sent: false,
    });
  } catch (error) {
    console.error('Error creating admin user:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}
app.post('/api/admin/users', handleInviteUser);
// Legacy alias: older UI builds call POST /users/invite — same Admin-only flow.
app.post('/api/users/invite', handleInviteUser);

/** PUT /api/admin/users/:id — profile fields (Admin/Manager, Admin accounts need Admin). */
app.put('/api/admin/users/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_users')) return;
    const role = callerRole(orgUserContext);
    const target = adminEmailParam(req);
    let found = await findRosterUser(catalystApp, target);
    if (!found) found = await adoptRosterUser(catalystApp, target);
    if (!found) return res.status(404).json({ success: false, error: 'User not found.' });
    const current = String(found.data.role || 'Cashier');
    if (role !== 'Admin' && (current === 'Admin' || current === 'master_admin')) {
      return res.status(403).json({ success: false, error: 'Only Admins can modify Admin accounts.' });
    }
    const { name, phone, notes } = req.body || {};
    const patch = { ...found.data, updated_at: Date.now() };
    if (name !== undefined) {
      if (String(name).trim() === '') return res.status(400).json({ success: false, error: 'Name cannot be empty.' });
      patch.name = String(name).trim();
    }
    if (phone !== undefined) patch.phone = String(phone).trim();
    if (notes !== undefined) patch.notes = String(notes).trim();
    await saveRosterUser(catalystApp, target, patch);
    await syncOrgUserRole(catalystApp, target, String(patch.role || 'Cashier'), { displayName: String(patch.name || target) });
    res.status(200).json({ success: true, message: 'User updated.', user: shapeAdminUser(patch) });
  } catch (error) {
    console.error('Error updating admin user:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** DELETE /api/admin/users/:id — permanent removal (Admin only + guards). */
app.delete('/api/admin/users/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'delete_users')) return;
    const target = adminEmailParam(req);
    const me = String(orgUserContext.user.email || orgUserContext.user.email_id || '').toLowerCase();
    if (target.toLowerCase() === me) {
      return res.status(400).json({ success: false, error: 'You cannot delete your own account.' });
    }
    let found = await findRosterUser(catalystApp, target);
    const hadRoster = !!found;
    if (!found) found = await adoptRosterUser(catalystApp, target);
    let orgOnly = false;
    if (!found) {
      // Maybe only an OrgUsers row exists (e.g. numeric-id legacy row).
      try {
        const rows = await safeZcql(catalystApp, `SELECT ROWID FROM OrgUsers WHERE user_id = '${sanitizeZcql(target.toLowerCase())}' LIMIT 1`);
        orgOnly = !!(rows && rows.length > 0);
      } catch (e) { /* ignore */ }
      if (!orgOnly) return res.status(404).json({ success: false, error: 'User not found.' });
    }
    const targetRole = found ? String(found.data.role || 'Cashier') : 'Cashier';
    if ((targetRole === 'Admin' || targetRole === 'master_admin')
      && (!found || String(found.data.status || 'active').toLowerCase() === 'active')) {
      const remaining = await countActiveAdmins(catalystApp, orgUserContext);
      if (remaining <= 1) {
        return res.status(400).json({ success: false, error: 'Cannot delete the last active Admin.' });
      }
    }
    if (hadRoster) {
      // Delete EVERY row carrying the roster key: concurrent invites can
      // stamp duplicate config rows (SELECT-then-insert race in
      // safeUpsertConfig), and removing only the LIMIT-1 match leaves a twin
      // that keeps the user listed after a "User removed" notice.
      try {
        const dupes = await safeZcql(catalystApp,
          `SELECT ROWID FROM Configurations WHERE config_key = '${rosterKey(target)}' LIMIT 300`
        );
        const table = catalystApp.datastore().table('Configurations');
        let removed = 0;
        for (const d of (dupes || [])) {
          try { await table.deleteRow(d.Configurations.ROWID); removed++; } catch (e) { /* keep going */ }
        }
        if (removed === 0) {
          await table.deleteRow(found.ROWID);
        }
      } catch (e) {
        return res.status(500).json({ success: false, error: 'Failed to remove user record.' });
      }
    }
    // Revoke everywhere: a surviving OrgUsers row would keep signing them in.
    await deleteOrgUserRows(catalystApp, target);
    const authOutcome = await removeCatalystAuthLogin(catalystApp, target);
    const roleMessage = `User '${target}' deleted. Role record revoked.`;
    const message = authOutcome.auth_removed
      ? `${roleMessage} Login account removed.`
      : `${roleMessage} Login account still exists (${authOutcome.auth_detail}) — remove it in console Authentication.`;
    res.status(200).json({ success: true, message, auth_removed: authOutcome.auth_removed, auth_detail: authOutcome.auth_detail });
  } catch (error) {
    console.error('Error deleting admin user:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/admin/users/:id/activate — re-enable (Admin only). */
app.post('/api/admin/users/:id/activate', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_users')) return;
    if (callerRole(orgUserContext) !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Activating users requires Admin.' });
    }
    const target = adminEmailParam(req);
    let found = await findRosterUser(catalystApp, target);
    if (!found) found = await adoptRosterUser(catalystApp, target);
    if (!found) return res.status(404).json({ success: false, error: 'User not found.' });
    const oldStatus = String(found.data.status || 'active');
    const patch = { ...found.data, status: 'active', verified_at: Date.now(), updated_at: Date.now() };
    await saveRosterUser(catalystApp, target, patch);
    const ctxUser = orgUserContext.user || {};
    await logAuditLog(catalystApp, {
      userId: String(ctxUser.user_id || ctxUser.zaid || ''),
      actorId: String(ctxUser.user_id || ctxUser.zaid || ''),
      actorName: (orgUserContext.orgUser && orgUserContext.orgUser.display_name) || String(ctxUser.email || ctxUser.email_id || ''),
      actorRole: callerRole(orgUserContext),
      action: 'USER_ACTIVATED',
      entityType: 'user',
      entityId: target,
      entityName: String(found.data.name || target),
      oldValue: oldStatus,
      newValue: 'active',
      ip: auditIp(req),
      userAgent: String((req.headers && req.headers['user-agent']) || ''),
    });
    res.status(200).json({ success: true, message: `User '${target}' activated.`, user: shapeAdminUser(patch) });
  } catch (error) {
    console.error('Error activating user:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/admin/users/:id/deactivate — suspend (Admin only + last-admin guard). */
app.post('/api/admin/users/:id/deactivate', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_users')) return;
    if (callerRole(orgUserContext) !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Deactivating users requires Admin.' });
    }
    const target = adminEmailParam(req);
    const me = String(orgUserContext.user.email || orgUserContext.user.email_id || '').toLowerCase();
    if (target.toLowerCase() === me) {
      return res.status(400).json({ success: false, error: 'You cannot deactivate your own account.' });
    }
    let found = await findRosterUser(catalystApp, target);
    if (!found) found = await adoptRosterUser(catalystApp, target);
    if (!found) return res.status(404).json({ success: false, error: 'User not found.' });
    const targetRole = String(found.data.role || 'Cashier');
    if (targetRole === 'Admin' || targetRole === 'master_admin') {
      const remaining = await countActiveAdmins(catalystApp, orgUserContext);
      if (remaining <= 1) {
        return res.status(400).json({ success: false, error: 'Cannot deactivate the last active Admin.' });
      }
    }
    const oldStatus = String(found.data.status || 'active');
    const patch = { ...found.data, status: 'inactive', updated_at: Date.now() };
    await saveRosterUser(catalystApp, target, patch);
    const ctxUser = orgUserContext.user || {};
    await logAuditLog(catalystApp, {
      userId: String(ctxUser.user_id || ctxUser.zaid || ''),
      actorId: String(ctxUser.user_id || ctxUser.zaid || ''),
      actorName: (orgUserContext.orgUser && orgUserContext.orgUser.display_name) || String(ctxUser.email || ctxUser.email_id || ''),
      actorRole: callerRole(orgUserContext),
      action: 'USER_DEACTIVATED',
      entityType: 'user',
      entityId: target,
      entityName: String(found.data.name || target),
      oldValue: oldStatus,
      newValue: 'inactive',
      ip: auditIp(req),
      userAgent: String((req.headers && req.headers['user-agent']) || ''),
    });
    res.status(200).json({ success: true, message: `User '${target}' deactivated. Their POS access is suspended.`, user: shapeAdminUser(patch) });
  } catch (error) {
    console.error('Error deactivating user:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/admin/users/:id/reset-password — re-send sign-in details
 * (Admin only). Passwords live in Catalyst Auth — registerUser sends no
 * mail, so this emails the member via store SMTP (sign-in link + first-time
 * "Forgot password" instructions) and audits the event. Members can also
 * self-serve on the hosted Catalyst login page ("Forgot password").
 */
app.post('/api/admin/users/:id/reset-password', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_users')) return;
    if (callerRole(orgUserContext) !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Password resets require Admin.' });
    }
    const target = adminEmailParam(req);
    const found = await findRosterUser(catalystApp, target);
    if (!found) return res.status(404).json({ success: false, error: 'User not found.' });
    // Platform password link FIRST (this is what actually emails them);
    // registerUser inside the helper recreates the account if missing.
    const auth = await ensureAuthAccount(catalystApp, {
      email: target,
      firstName: String(found.data.name || '').split(' ')[0] || target.split('@')[0],
      lastName: String(found.data.name || '').split(' ').slice(1).join(' ') || '',
    });
    const platformMail = auth.mailSent;
    // Store SMTP reminder as the second channel (role + sign-in info).
    const resetActor = String(orgUserContext.user.email || orgUserContext.user.email_id || '');
    const mailSent = await sendInviteEmail(catalystApp, req, {
      to: target,
      name: String(found.data.name || ''),
      role: String(found.data.role || 'Cashier'),
      orgName: String((orgUserContext.org && orgUserContext.org.org_name) || 'CloudHub POS'),
      invitedBy: resetActor,
      isReminder: true,
    });
    res.status(200).json({
      success: true,
      message: platformMail
        ? `Password setup link emailed to ${target} by Catalyst${mailSent ? ', plus sign-in details sent' : ''}.`
        : (mailSent
          ? `Sign-in details emailed to ${target}. First-time users set their password via "Forgot password" on the login page.`
          : `Could not email ${target} (platform mail failed and SMTP not configured or send failed). Invite them from console Authentication, or ask them to use "Forgot password" on the Catalyst login page.`),
      invite_resent: platformMail || mailSent,
    });
  } catch (error) {
    console.error('Error resetting password:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** POST /api/admin/users/:id/change-role — assign role (Admin full; Manager limited). */
app.post('/api/admin/users/:id/change-role', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_users')) return;
    const role = callerRole(orgUserContext);
    const target = adminEmailParam(req);
    const { role: newRole } = req.body || {};
    if (!newRole || !POS_ALL_ROLES.includes(String(newRole))) {
      return res.status(400).json({ success: false, error: `Role must be one of: ${POS_ALL_ROLES.join(', ')}.` });
    }
    let found = await findRosterUser(catalystApp, target);
    if (!found) found = await adoptRosterUser(catalystApp, target);
    if (!found) return res.status(404).json({ success: false, error: 'User not found.' });
    const current = String(found.data.role || 'Cashier');
    if (role !== 'Admin') {
      if (current === 'Admin' || current === 'master_admin' || String(newRole) === 'Admin') {
        return res.status(403).json({ success: false, error: 'Only Admins can grant or modify the Admin role.' });
      }
    }
    if (normWhRole(current) === 'Admin' && String(newRole) !== 'Admin' && String(found.data.status || 'active') !== 'inactive') {
      const remaining = await countActiveAdmins(catalystApp, orgUserContext);
      if (remaining <= 1) {
        return res.status(400).json({ success: false, error: 'You are the last active Admin — assign another Admin first.' });
      }
    }
    const patch = {
      ...found.data,
      role: String(newRole),
      permissions: getRolePermissions(String(newRole)),
      updated_at: Date.now(),
    };
    await saveRosterUser(catalystApp, target, patch);
    await syncOrgUserRole(catalystApp, target, String(newRole), {
      orgId: orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '',
      displayName: String(found.data.name || target),
    });
    const ctxUser = orgUserContext.user || {};
    await logAuditLog(catalystApp, {
      userId: String(ctxUser.user_id || ctxUser.zaid || ''),
      actorId: String(ctxUser.user_id || ctxUser.zaid || ''),
      actorName: (orgUserContext.orgUser && orgUserContext.orgUser.display_name) || String(ctxUser.email || ctxUser.email_id || ''),
      actorRole: role,
      action: 'ROLE_CHANGED',
      entityType: 'user',
      entityId: target,
      entityName: String(found.data.name || target),
      oldValue: current,
      newValue: String(newRole),
      ip: auditIp(req),
      userAgent: String((req.headers && req.headers['user-agent']) || ''),
    });
    res.status(200).json({ success: true, message: `Role updated to ${newRole}.`, user: shapeAdminUser(patch) });
  } catch (error) {
    console.error('Error changing role:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- audit reads + exports (USR-05, Admin only) ---------------- */

function shapeAuditRow(r) {
  return {
    ROWID: r.ROWID,
    created_at: r.created_at ?? null,
    user_id: String(r.user_id ?? ''),
    actor_id: String(r.actor_id ?? ''),
    actor_name: String(r.actor_name ?? ''),
    actor_role: String(r.actor_role ?? ''),
    action: String(r.action ?? ''),
    entity_type: String(r.entity_type ?? ''),
    entity_id: String(r.entity_id ?? ''),
    entity_name: String(r.entity_name ?? ''),
    old_value: String(r.old_value ?? ''),
    new_value: String(r.new_value ?? ''),
    ip_address: String(r.ip_address ?? ''),
    user_agent: String(r.user_agent ?? ''),
  };
}

async function fetchAuditRows(catalystApp) {
  let rows;
  try {
    rows = await catalystApp.zcql().executeZCQLQuery(
      'SELECT ROWID, user_id, actor_id, actor_name, actor_role, action, entity_type, entity_id, entity_name, old_value, new_value, ip_address, user_agent, created_at FROM UserAuditLog ORDER BY CREATEDTIME DESC LIMIT 300'
    );
  } catch (fullErr) {
    rows = await catalystApp.zcql().executeZCQLQuery(
      'SELECT ROWID, actor_name, action, entity_type, entity_id, entity_name, created_at FROM UserAuditLog ORDER BY CREATEDTIME DESC LIMIT 300'
    );
  }
  return (rows || []).map((x) => shapeAuditRow(x.UserAuditLog)).filter(Boolean);
}

function filterAuditRows(rows, q) {
  const actor = String((q && (q.actor || q.user)) || '').trim().toLowerCase();
  const action = String((q && q.action) || '').trim();
  const entity = String((q && (q.entity || q.entity_type)) || '').trim();
  const search = String((q && q.search) || '').trim().toLowerCase();
  const from = String((q && q.date_from) || '').trim().slice(0, 10);
  const to = String((q && q.date_to) || '').trim().slice(0, 10);
  return rows.filter((r) => {
    if (actor !== '' && !`${r.actor_name} ${r.actor_id}`.toLowerCase().includes(actor)) return false;
    if (action !== '' && action !== 'all' && r.action !== action) return false;
    if (entity !== '' && entity !== 'all' && r.entity_type !== entity) return false;
    const day = String(r.created_at ?? '').slice(0, 10);
    if (from !== '' && day < from) return false;
    if (to !== '' && day > to) return false;
    if (search !== '') {
      const hay = `${r.actor_name} ${r.action} ${r.entity_type} ${r.entity_id} ${r.entity_name} ${r.old_value} ${r.new_value}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}

function auditMetrics(rows) {
  const count = (a) => rows.filter((r) => r.action === a).length;
  const byAction = new Map();
  for (const r of rows) byAction.set(r.action, (byAction.get(r.action) ?? 0) + 1);
  return {
    total_events: rows.length,
    users_created: count('USER_CREATED'),
    users_deleted: count('USER_DELETED'),
    users_deactivated: count('USER_DEACTIVATED'),
    role_changes: count('ROLE_CHANGED'),
    orders_created: count('ORDER_CREATED'),
    report_exports: count('REPORT_EXPORTED'),
    by_action: [...byAction.entries()]
      .map(([action, n]) => ({ action, count: n }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
  };
}

async function getAuditRetentionDays(catalystApp, orgId) {
  try {
    const bs = new ZohoBooksService(catalystApp, null);
    const v = await bs.getConfig(`org_${orgId}_setting_admin_audit_retention_days`);
    const n = parseInt(String(v ?? ''), 10);
    if (Number.isFinite(n) && n >= 7) return Math.min(n, 3650);
  } catch (e) { /* default */ }
  return 90;
}

/** GET /api/admin/audit — filterable trail + metrics (Admin only). */
app.get('/api/admin/audit', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (callerRole(orgUserContext) !== 'Admin') {
      return res.status(403).json({ success: false, error: 'Audit logs require Admin.' });
    }
    let rows;
    try {
      rows = await fetchAuditRows(catalystApp);
    } catch (e) {
      return res.status(503).json({
        success: false,
        error: `Table 'UserAuditLog' is not provisioned. Create it in Catalyst Console → Data Store, then retry.`,
      });
    }
    // Retention sweep (best-effort, capped): drop rows older than the window.
    try {
      const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
      const days = await getAuditRetentionDays(catalystApp, orgId);
      const cutoff = shiftDays(utcDay(new Date()), -days);
      const stale = rows.filter((r) => String(r.created_at ?? '').slice(0, 10) !== '' && String(r.created_at).slice(0, 10) < cutoff).slice(0, 100);
      if (stale.length > 0) {
        const table = catalystApp.datastore().table('UserAuditLog');
        for (const s of stale) {
          try {
            await table.deleteRow(s.ROWID);
          } catch (e) { break; }
        }
        if (stale.length > 0) rows = await fetchAuditRows(catalystApp);
      }
    } catch (e) { /* retention sweep is best-effort */ }
    const filtered = filterAuditRows(rows, req.query);
    res.status(200).json({
      success: true,
      count: filtered.length,
      data: filtered.slice(0, 300),
      metrics: auditMetrics(filtered),
      actions: AUDIT_ACTIONS,
    });
  } catch (error) {
    console.error('Error reading audit log:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/admin/audit/export/csv — filtered export (Admin only + toggle). */
app.get('/api/admin/audit/export/csv', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'export_audit')) return;
    try {
      const bs = new ZohoBooksService(catalystApp, null);
      const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
      const flag = await bs.getConfig(`org_${orgId}_setting_admin_audit_export`);
      if (flag !== undefined && flag !== null && String(flag) !== '') {
        const s = String(flag).trim().toLowerCase();
        if (s === 'false' || s === '0' || s === 'no') {
          return res.status(403).json({ success: false, error: 'Audit export is disabled (see Settings → Administration).' });
        }
      }
    } catch (e) { /* default on */ }
    let rows;
    try {
      rows = await fetchAuditRows(catalystApp);
    } catch (e) {
      return res.status(503).json({ success: false, error: `Table 'UserAuditLog' is not provisioned.` });
    }
    const filtered = filterAuditRows(rows, req.query);
    const doc = csvDoc(`audit-${utcDay(new Date())}.csv`,
      ['Date', 'Actor', 'Role', 'Action', 'Entity', 'Entity ID', 'Entity Name', 'Old Value', 'New Value', 'IP'],
      filtered.map((r) => [r.created_at, r.actor_name, r.actor_role, r.action, r.entity_type, r.entity_id, r.entity_name, r.old_value, r.new_value, r.ip_address]));
    try {
      const ctxUser = orgUserContext.user || {};
      await logAuditLog(catalystApp, {
        userId: String(ctxUser.user_id || ctxUser.zaid || ''),
        actorId: String(ctxUser.user_id || ctxUser.zaid || ''),
        actorName: (orgUserContext.orgUser && orgUserContext.orgUser.display_name) || String(ctxUser.email || ctxUser.email_id || ''),
        actorRole: callerRole(orgUserContext),
        action: 'REPORT_EXPORTED',
        entityType: 'audit',
        entityId: '',
        entityName: `audit CSV (${filtered.length} rows)`,
        oldValue: '',
        newValue: doc.name,
        ip: auditIp(req),
        userAgent: String((req.headers && req.headers['user-agent']) || ''),
      });
    } catch (e) { /* export proceeds regardless */ }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${doc.name}"`);
    res.status(200).send(`\uFEFF${doc.content}`);
  } catch (error) {
    console.error('Error exporting audit CSV:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/admin/audit/export/pdf — branded audit PDF (Admin only + toggle). */
app.get('/api/admin/audit/export/pdf', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await requireAuth(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'export_audit')) return;
    const orgId = orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
    try {
      const bs = new ZohoBooksService(catalystApp, null);
      const flag = await bs.getConfig(`org_${orgId}_setting_admin_audit_export`);
      if (flag !== undefined && flag !== null && String(flag) !== '') {
        const s = String(flag).trim().toLowerCase();
        if (s === 'false' || s === '0' || s === 'no') {
          return res.status(403).json({ success: false, error: 'Audit export is disabled (see Settings → Administration).' });
        }
      }
    } catch (e) { /* default on */ }
    let rows;
    try {
      rows = await fetchAuditRows(catalystApp);
    } catch (e) {
      return res.status(503).json({ success: false, error: `Table 'UserAuditLog' is not provisioned.` });
    }
    const filtered = filterAuditRows(rows, req.query);
    const m = auditMetrics(filtered);
    const store = await getStoreProfile(catalystApp, orgId);
    const rangeBits = [];
    if (req.query && req.query.date_from) rangeBits.push(`from ${String(req.query.date_from).slice(0, 10)}`);
    if (req.query && req.query.date_to) rangeBits.push(`to ${String(req.query.date_to).slice(0, 10)}`);
    if (req.query && req.query.action) rangeBits.push(`action ${req.query.action}`);
    const doc = {
      company: String(store.store_name || store.company || 'CloudHub POS'),
      companySub: store.company && store.store_name ? String(store.company) : '',
      title: 'User Audit Report',
      rangeLabel: rangeBits.length > 0 ? rangeBits.join(' · ') : 'All events',
      generated: new Date().toISOString().slice(0, 16).replace('T', ' '),
      currency: String(store.currency || 'LKR'),
      footer: 'Generated by CloudHub POS — confidential',
      kpis: [
        { label: 'Total events', value: String(m.total_events) },
        { label: 'Users created', value: String(m.users_created) },
        { label: 'Role changes', value: String(m.role_changes) },
        { label: 'Deactivated', value: String(m.users_deactivated) },
      ],
      tables: [
        {
          title: 'Events by action', columns: ['Action', 'Count'], widths: [3, 1],
          rows: m.by_action.map((a) => [a.action, String(a.count)]),
        },
        {
          title: 'Audit trail', columns: ['Date', 'Actor', 'Action', 'Entity'], widths: [1.2, 1.6, 1.4, 2],
          rows: filtered.slice(0, 200).map((r) => [
            String(r.created_at ?? '').slice(0, 16),
            String(r.actor_name ?? ''),
            String(r.action ?? ''),
            [r.entity_type, r.entity_name || r.entity_id].filter(Boolean).join(': '),
          ]),
        },
      ],
    };
    try {
      const ctxUser = orgUserContext.user || {};
      await logAuditLog(catalystApp, {
        userId: String(ctxUser.user_id || ctxUser.zaid || ''),
        actorId: String(ctxUser.user_id || ctxUser.zaid || ''),
        actorName: (orgUserContext.orgUser && orgUserContext.orgUser.display_name) || String(ctxUser.email || ctxUser.email_id || ''),
        actorRole: callerRole(orgUserContext),
        action: 'REPORT_EXPORTED',
        entityType: 'audit',
        entityId: '',
        entityName: `audit PDF (${filtered.length} rows)`,
        oldValue: '',
        newValue: `audit-${utcDay(new Date())}.pdf`,
        ip: auditIp(req),
        userAgent: String((req.headers && req.headers['user-agent']) || ''),
      });
    } catch (e) { /* export proceeds regardless */ }
    const pdf = buildReportPdf(doc);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${utcDay(new Date())}.pdf"`);
    res.status(200).send(Buffer.from(pdf, 'latin1'));
  } catch (error) {
    console.error('Error exporting audit PDF:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   SET — STRUCTURED SETTINGS SERVICES
   --------------------------------------------------------------------------
   One source of truth per domain, all persisted as org-scoped
   Configurations keys (`org_<id>_setting_*`, legacy `pos_setting_*`
   fallback for the virtual tenant):

     CompanyProfileService  company_*    (+ legacy mirrors store_name,
                                         company, currency for receipts/PDFs)
     TaxService             tax_*        (+ legacy mirror tax_rate)
     NotificationService    notification_prefs, alert_email
     IntegrationService     read-only health rollup (no new writes except
                            the Books last-sync stamp written by /sync/books)

   No new Data Store tables. The company logo lives in FileStore
   (`CompanyAssets` folder, 5 MB cap, PNG/JPEG/WebP).
   ========================================================================== */

/** Read every org-scoped setting into a plain object. */
async function readOrgSettings(catalystApp, orgId) {
  const out = {};
  try {
    const booksService = new ZohoBooksService(catalystApp, null);
    const prefix = `org_${orgId}_setting_`;
    let rows = [];
    try {
      // Catalyst's ZCQL LIKE can return no rows for these keys even when the
      // exact prefix exists. Scan the bounded Configurations slice and filter
      // locally so virtual org_default and real-org viewers read the same
      // prefix that their save path writes.
      const r = await catalystApp.zcql().executeZCQLQuery(
        'SELECT config_key, config_value FROM Configurations LIMIT 300'
      );
      rows = (r || [])
        .map((x) => x.Configurations)
        .filter((row) => row && String(row.config_key || '').startsWith(prefix));
    } catch (e) { rows = []; }
    for (const row of rows) {
      out[String(row.config_key).slice(prefix.length)] = row.config_value;
    }
    void booksService;
  } catch (e) { /* empty map on failure */ }
  return out;
}

/**
 * Self-healing fallback: when this org owns no company keys at all, adopt
 * the company family from whichever prefix actually holds one in this
 * environment (older saves under org_default_* or another org id).
 * Returns a prefix-stripped map (with profile_source) or null.
 * Fail-soft: any error returns null and the caller keeps prior behavior.
 */
async function readAdoptedCompanySettings(catalystApp) {
  try {
    // Simplest possible read: whole table slice, NO where clause, NO like
    // patterns — match the company family in JS. If the rows exist in this
    // environment under any prefix, this finds them.
    const r = await catalystApp.zcql().executeZCQLQuery(
      `SELECT config_key, config_value FROM Configurations LIMIT 300`
    );
    const rows = (r || []).map((x) => x.Configurations).filter(Boolean);
    const hit = rows.find((row) => String(row.config_key || '').endsWith('_setting_company_name'));
    console.log('[COMPANY_API] adopted scan:', rows.length, 'rows;', hit ? `found ${hit.config_key}` : 'no company key in table');
    if (!hit) return null;
    const prefix = String(hit.config_key).slice(0, -'company_name'.length);
    const out = {};
    for (const row of rows) {
      const key = String(row.config_key || '');
      if (key.startsWith(prefix)) out[key.slice(prefix.length)] = row.config_value;
    }
    if (out.company_name === undefined) return null;
    out.profile_source = `adopted:${prefix}*`;
    return out;
  } catch (e) {
    return null;
  }
}

/* ---------------- CompanyProfileService (SET-01) ---------------- */

const COMPANY_FIELDS = [
  'company_name', 'legal_name', 'address1', 'address2', 'city', 'province',
  'postal_code', 'country', 'phone', 'email', 'website', 'reg_number', 'tax_number',
];

async function getCompanyProfile(catalystApp, orgId) {
  let s = await readOrgSettings(catalystApp, orgId);
  // Self-healing: primary prefix holds nothing → adopt whichever family
  // actually has company data in this environment (older org prefixes).
  // Primary keys always win when present; the adopted source is tagged.
  if (s.company_name === undefined && s.store_name === undefined) {
    const adopted = await readAdoptedCompanySettings(catalystApp);
    if (adopted) {
      const source = adopted.profile_source;
      delete adopted.profile_source;
      s = { ...adopted, ...s, profile_source: source };
    }
  }
  const str = (v) => (v === undefined || v === null ? '' : String(v));
  // Logo self-healing: profile read under one org prefix, upload saved
  // under another (org_default vs real org). Adopt any stratus logo ref
  // so Settings shows the image instead of "No logo yet".
  if (s.company_logo_file_id === undefined || String(s.company_logo_file_id || '') === '') {
    const adoptedLogo = await findAnyLogoRef(catalystApp);
    if (adoptedLogo) {
      s.company_logo_file_id = adoptedLogo.ref;
      if (s.company_logo_mime === undefined) s.company_logo_mime = adoptedLogo.mime;
      if (s.company_logo_name === undefined) s.company_logo_name = adoptedLogo.name;
      s.profile_source = s.profile_source || `adopted-logo:${adoptedLogo.source}`;
    }
  }
  const profile = {
    company_name: str(s.company_name ?? s.store_name),
    legal_name: str(s.company_legal_name ?? s.legal_name ?? s.company),
    address1: str(s.company_address1 ?? s.address1),
    address2: str(s.company_address2 ?? s.address2),
    city: str(s.company_city ?? s.city),
    province: str(s.company_province ?? s.province),
    postal_code: str(s.company_postal_code ?? s.postal_code),
    country: str(s.company_country ?? s.country),
    phone: str(s.company_phone ?? s.phone),
    email: str(s.company_email ?? s.email),
    website: str(s.company_website ?? s.website),
    reg_number: str(s.company_reg_number ?? s.reg_number),
    tax_number: str(s.company_tax_number ?? s.tax_number),
    currency: str(s.currency || 'LKR'),
    logo_file_id: str(s.company_logo_file_id),
    logo_name: str(s.company_logo_name),
    logo_mime: str(s.company_logo_mime),
    logo_url: str(s.company_logo_file_id) !== '' ? '/api/settings/company/logo' : '',
    profile_source: str(s.profile_source ?? ''),
  };
  // Legacy fallback (virtual tenant keys predate the company_* namespace).
  if (profile.company_name === '' || profile.legal_name === '' || profile.currency === 'LKR') {
    try {
      const legacy = await safeZcql(catalystApp,
        `SELECT config_key, config_value FROM Configurations WHERE config_key LIKE 'pos_setting_%'`
      );
      for (const row of (legacy || [])) {
        const key = String(row.Configurations.config_key).replace('pos_setting_', '');
        const val = str(row.Configurations.config_value);
        if (key === 'store_name' && profile.company_name === '') profile.company_name = val;
        if (key === 'company' && profile.legal_name === '') profile.legal_name = val;
        if (key === 'currency' && (profile.currency === '' || profile.currency === 'LKR') && val !== '') profile.currency = val;
      }
    } catch (e) { /* legacy optional */ }
  }
  return profile;
}

async function saveCompanyProfile(catalystApp, orgId, input) {
  const clean = {};
  for (const f of [...COMPANY_FIELDS, 'currency']) {
    if (input[f] !== undefined) clean[f] = String(input[f] ?? '').trim().slice(0, 300);
  }
  if (clean.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean.email)) {
    return { error: 'Company email looks invalid.' };
  }
  if (clean.website && !/^(https?:\/\/)?[^\s/$.?#].[^\s]*$/i.test(clean.website)) {
    return { error: 'Website looks invalid.' };
  }
  // Canonical company_* keys (company_name keeps its short key).
  const mapping = {
    company_name: 'company_name',
    legal_name: 'company_legal_name',
    address1: 'company_address1',
    address2: 'company_address2',
    city: 'company_city',
    province: 'company_province',
    postal_code: 'company_postal_code',
    country: 'company_country',
    phone: 'company_phone',
    email: 'company_email',
    website: 'company_website',
    reg_number: 'company_reg_number',
    tax_number: 'company_tax_number',
    currency: 'currency',
  };
  for (const [field, value] of Object.entries(clean)) {
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_${mapping[field]}`, value);
  }
  // Legacy mirrors keep receipts, PDFs and the General card working.
  if (clean.company_name !== undefined) {
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_store_name`, clean.company_name);
  }
  if (clean.legal_name !== undefined) {
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_company`, clean.legal_name);
  }
  return { profile: await getCompanyProfile(catalystApp, orgId) };
}

/* ---------------- TaxService (SET-02) ---------------- */

const TAX_MODES = ['exclusive', 'inclusive'];

async function getTaxSettings(catalystApp, orgId) {
  const s = await readOrgSettings(catalystApp, orgId);
  const num = (v, dflt) => {
    if (v === undefined || v === null || v === '') return dflt;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, 100) : dflt;
  };
  let profiles = [];
  try {
    const raw = s.tax_profiles;
    if (raw !== undefined && raw !== null && String(raw) !== '') {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) {
        profiles = parsed
          .filter((p) => p && String(p.name ?? '').trim() !== '')
          .map((p) => ({ name: String(p.name).trim().slice(0, 60), rate: Math.min(100, Math.max(0, Number(p.rate) || 0)) }))
          .slice(0, 20);
      }
    }
  } catch (e) { profiles = []; }
  const defaultRate = num(s.default_tax_rate ?? s.tax_rate, 0);
  const boolOf = (v, dflt) => {
    if (v === undefined || v === null || v === '') return dflt;
    const t = String(v).trim().toLowerCase();
    if (['true', '1', 'yes'].includes(t)) return true;
    if (['false', '0', 'no'].includes(t)) return false;
    return dflt;
  };
  return {
    enabled: boolOf(s.tax_enabled, true),
    name: String(s.tax_name ?? 'Tax').trim() || 'Tax',
    default_rate: defaultRate,
    mode: TAX_MODES.includes(String(s.tax_mode || '').trim().toLowerCase())
      ? String(s.tax_mode).trim().toLowerCase()
      : 'exclusive',
    round: boolOf(s.tax_round, true),
    profiles,
  };
}

async function saveTaxSettings(catalystApp, orgId, input) {
  const patch = {};
  if (input.enabled !== undefined) patch.tax_enabled = input.enabled === true ? 'true' : 'false';
  if (input.name !== undefined) {
    if (String(input.name).trim() === '') return { error: 'Tax name cannot be empty.' };
    patch.tax_name = String(input.name).trim().slice(0, 60);
  }
  if (input.default_rate !== undefined) {
    const n = Number(input.default_rate);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: 'Default tax rate must be 0–100.' };
    patch.default_tax_rate = String(n);
    patch.tax_rate = String(n); // legacy mirror (General card + old readers)
  }
  if (input.mode !== undefined) {
    const m = String(input.mode).trim().toLowerCase();
    if (!TAX_MODES.includes(m)) return { error: 'Tax mode must be exclusive or inclusive.' };
    patch.tax_mode = m;
  }
  if (input.round !== undefined) patch.tax_round = input.round === true ? 'true' : 'false';
  if (input.profiles !== undefined) {
    if (!Array.isArray(input.profiles)) return { error: 'Tax profiles must be a list.' };
    if (input.profiles.length > 20) return { error: 'At most 20 tax profiles.' };
    const cleaned = [];
    for (const p of input.profiles) {
      if (!p || String(p.name ?? '').trim() === '') return { error: 'Every tax profile needs a name.' };
      const rate = Number(p.rate);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { error: `Rate for "${p.name}" must be 0–100.` };
      cleaned.push({ name: String(p.name).trim().slice(0, 60), rate });
    }
    patch.tax_profiles = JSON.stringify(cleaned);
  }
  for (const [k, v] of Object.entries(patch)) {
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_${k}`, String(v));
  }
  return { tax: await getTaxSettings(catalystApp, orgId) };
}

/* ---------------- NotificationService (SET-04) ---------------- */

const NOTIFICATION_TYPES = [
  'low_stock', 'out_of_stock', 'order_confirmation', 'order_status',
  'receipt', 'order_void', 'order_refund', 'books_sync_fail',
  'inventory_sync_fail', 'audit_alerts', 'user_invite',
];

function defaultNotificationPrefs() {
  const on = (extra) => ({ enabled: true, channels: ['email'], ...(extra || {}) });
  const off = () => ({ enabled: false, channels: ['email'] });
  return {
    low_stock: on({ threshold: '', recipients: '', frequency: 'immediate' }),
    out_of_stock: on({}),
    order_confirmation: on({}),
    order_status: off(),
    receipt: on({}),
    order_void: on({}),
    order_refund: on({}),
    books_sync_fail: on({}),
    inventory_sync_fail: on({}),
    audit_alerts: off(),
    user_invite: on({}),
    alert_email: '',
  };
}

async function getNotificationSettings(catalystApp, orgId) {
  const prefs = defaultNotificationPrefs();
  try {
    const booksService = new ZohoBooksService(catalystApp, null);
    const raw = await booksService.getConfig(`org_${orgId}_setting_notification_prefs`);
    if (raw !== undefined && raw !== null && String(raw) !== '') {
      const parsed = JSON.parse(String(raw));
      for (const t of NOTIFICATION_TYPES) {
        if (parsed && parsed[t] && typeof parsed[t] === 'object') {
          prefs[t] = {
            enabled: parsed[t].enabled === true,
            channels: Array.isArray(parsed[t].channels) && parsed[t].channels.length > 0
              ? parsed[t].channels.filter((c) => ['email', 'in_app', 'system'].includes(String(c))).slice(0, 3)
              : ['email'],
          };
          if (t === 'low_stock') {
            prefs.low_stock.threshold = parsed.low_stock.threshold ?? '';
            prefs.low_stock.recipients = String(parsed.low_stock.recipients ?? '');
            const fq = String(parsed.low_stock.frequency ?? 'immediate').toLowerCase();
            prefs.low_stock.frequency = fq === 'daily' ? 'daily' : 'immediate';
          }
        }
      }
    }
    const alertEmail = await booksService.getConfig(`org_${orgId}_setting_alert_email`);
    if (alertEmail) prefs.alert_email = String(alertEmail);
  } catch (e) { /* defaults stand */ }
  return prefs;
}

async function saveNotificationSettings(catalystApp, orgId, input) {
  if (!input || typeof input !== 'object') return { error: 'Notification preferences object is required.' };
  const prefs = defaultNotificationPrefs();
  for (const t of NOTIFICATION_TYPES) {
    if (input[t] !== undefined && input[t] !== null && typeof input[t] === 'object') {
      prefs[t].enabled = input[t].enabled === true;
      if (Array.isArray(input[t].channels)) {
        const chans = input[t].channels.filter((c) => ['email', 'in_app', 'system'].includes(String(c))).slice(0, 3);
        if (chans.length > 0) prefs[t].channels = chans;
      }
    }
  }
  if (input.low_stock && typeof input.low_stock === 'object') {
    const th = input.low_stock.threshold;
    if (th !== undefined && th !== null && th !== '') {
      const n = Number(th);
      if (!Number.isFinite(n) || n < 0) return { error: 'Low-stock threshold must be 0 or more.' };
      prefs.low_stock.threshold = n;
    }
    if (input.low_stock.recipients !== undefined) {
      prefs.low_stock.recipients = String(input.low_stock.recipients ?? '').slice(0, 500);
    }
    if (input.low_stock.frequency !== undefined) {
      const fq = String(input.low_stock.frequency).toLowerCase();
      if (!['immediate', 'daily'].includes(fq)) return { error: 'Low-stock frequency must be immediate or daily.' };
      prefs.low_stock.frequency = fq;
    }
  }
  if (input.alert_email !== undefined) {
    const ae = String(input.alert_email ?? '').trim();
    if (ae !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ae)) {
      return { error: 'Alert email looks invalid.' };
    }
    prefs.alert_email = ae;
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_alert_email`, ae);
  }
  // In-app + system channels surface inside the app (badges/feeds); only
  // email leaves the deployment, always through the configured SMTP engine.
  await safeUpsertConfig(catalystApp, `org_${orgId}_setting_notification_prefs`, JSON.stringify(prefs));
  return { notifications: prefs };
}

async function getIntegrationHealth(catalystApp, orgUserContext) {
  const booksService = new ZohoBooksService(catalystApp, null);
  const orgId = orgUserContext && orgUserContext.orgUser ? String(orgUserContext.orgUser.org_id || '') : '';
  const health = {
    books: { connected: false, org_id: '', dc: '', token_expires_at: '', last_sync_at: '', last_sync_result: '' },
  };
  try {
    const connected = await booksService.getConfig(`zoho_books_connected_${orgId}`)
      || await booksService.getConfig('zoho_books_connected');
    health.books.connected = String(connected ?? '').toLowerCase() === 'true';
  } catch (e) { /* disconnected */ }
  try {
    const org = orgUserContext && orgUserContext.org ? orgUserContext.org : {};
    health.books.org_id = String(org.zoho_books_org_id || (await booksService.getConfig('zoho_org_id')) || '');
    health.books.dc = String(await booksService.getConfig(`zoho_dc_${orgId}`) || await booksService.getConfig('zoho_dc') || '');
  } catch (e) { /* blanks */ }
  // Token expiry derives from the SDK's 50-minute access-token cache stamp.
  try {
    const stamp = await booksService.getConfig(`zoho_token_time_${orgId}`)
      || await booksService.getConfig('zoho_token_time');
    const t = parseInt(String(stamp || ''), 10);
    if (Number.isFinite(t) && t > 0) {
      health.books.token_expires_at = new Date(t + 50 * 60 * 1000).toISOString();
    } else {
      health.books.token_expires_at = 'unknown';
    }
  } catch (e) {
    health.books.token_expires_at = 'unknown';
  }
  try {
    health.books.last_sync_at = String(await booksService.getConfig('last_books_sync_at') || '');
    health.books.last_sync_result = String(await booksService.getConfig('last_books_sync_result') || '');
  } catch (e) { /* blanks */ }
  return health;
}

/* ---------------- Personal staff profiles (self-service only) ---------------- */

function printerSettingsApp(req, context) {
  if (!context?.user || !context?.orgUser?.org_id || !roleCan(callerRole(context), 'signed_in')) throw new Error('Printer access requires an active company member.');
  return catalyst.initialize(req, { scope: 'admin' });
}

function qzEncryptionKey() {
  const value = String(process.env.QZ_KEY_ENCRYPTION_SECRET || '').trim();
  return /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null;
}

function validateQzCertificatePair(certificate, privateKey) {
  const crypto = require('crypto');
  if (typeof certificate !== 'string' || typeof privateKey !== 'string' || certificate.length > 32000 || privateKey.length > 32000) throw new Error('Select a certificate and private key file (maximum 32 KB each).');
  if (!certificate.trim() || !privateKey.trim()) throw new Error('Both files must contain data. Regenerate the QZ files if either file is empty.');
  let cert, key;
  try { cert = new crypto.X509Certificate(certificate); key = crypto.createPrivateKey(privateKey); }
  catch (_) { throw new Error('The certificate or private key is not a valid PEM file.'); }
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error('Use a QZ RSA private key with at least 2048 bits.');
  if (!cert.checkPrivateKey(key)) throw new Error('The private key does not match this certificate. Select the two files from the same QZ certificate folder.');
  if (Date.now() < Date.parse(cert.validFrom) || Date.now() > Date.parse(cert.validTo)) throw new Error('The certificate is not currently valid.');
  return { certificate: certificate.trim(), privateKey: key.export({ type: 'pkcs8', format: 'pem' }), subject: cert.subject, expires: cert.validTo };
}

function encryptQzPrivateKey(privateKey, key, orgId) {
  const crypto = require('crypto');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(String(orgId)));
  const encrypted = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') };
}

function decryptQzPrivateKey(encrypted, key, orgId) {
  const decipher = require('crypto').createDecipheriv('aes-256-gcm', key, Buffer.from(encrypted.iv, 'base64'));
  decipher.setAAD(Buffer.from(String(orgId)));
  decipher.setAuthTag(Buffer.from(encrypted.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encrypted.data, 'base64')), decipher.final()]).toString('utf8');
}

async function readQzSigningMaterial(app, orgId) {
  const rows = await safeZcql(app, `SELECT config_value FROM Configurations WHERE config_key = 'org_${orgId}_qz_signing' LIMIT 1`);
  if (rows?.length) {
    const saved = JSON.parse(rows[0].Configurations.config_value);
    const key = qzEncryptionKey();
    if (!key) throw new Error('QZ encryption secret is not configured on the server.');
    return { ...saved, privateKey: decryptQzPrivateKey(saved.encryptedKey, key, orgId) };
  }
  return { certificate: process.env.QZ_CERTIFICATE?.replace(/\\n/g, '\n') || '', privateKey: process.env.QZ_PRIVATE_KEY?.replace(/\\n/g, '\n') || '' };
}

app.get('/api/settings/printers/qz-certificate', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ error: 'Not authenticated' });
    if (!requirePermission(context, res, 'manage_settings')) return;
    const material = await readQzSigningMaterial(printerSettingsApp(req, context), String(context.orgUser.org_id));
    res.set('Cache-Control', 'no-store');
    res.json({ configured: !!(material.certificate && material.privateKey), uploadReady: !!qzEncryptionKey(), subject: material.subject || '', expires: material.expires || '' });
  } catch (_) { res.status(500).json({ error: 'Could not read certificate settings. Check the server encryption secret.' }); }
});

app.put('/api/settings/printers/qz-certificate', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ error: 'Not authenticated' });
    if (!requirePermission(context, res, 'manage_settings')) return;
    const key = qzEncryptionKey();
    if (!key) return res.status(503).json({ error: 'Configure QZ_KEY_ENCRYPTION_SECRET on the backend before uploading certificate files.' });
    let material;
    try { material = validateQzCertificatePair(req.body?.certificate, req.body?.privateKey); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const orgId = String(context.orgUser.org_id);
    const { privateKey, ...publicFields } = material;
    const saved = { ...publicFields, encryptedKey: encryptQzPrivateKey(privateKey, key, orgId) };
    await safeUpsertConfig(printerSettingsApp(req, context), `org_${orgId}_qz_signing`, JSON.stringify(saved));
    res.set('Cache-Control', 'no-store');
    res.json({ configured: true, uploadReady: true, subject: saved.subject, expires: saved.expires });
  } catch (_) { res.status(500).json({ error: 'Could not save certificate settings.' }); }
});

function qzSigningRequestAllowed(message, printers, now = Date.now()) {
  if (typeof message !== 'string' || message.length > 512000) return false;
  let request;
  try { request = JSON.parse(message); } catch (_) { return false; }
  if (!request || !Number.isFinite(request.timestamp) || Math.abs(now - request.timestamp) > 120000) return false;
  if (request.call === 'printers.find') return !request.params?.query || typeof request.params.query === 'string';
  if (request.call !== 'print') return false;
  const params = request.params;
  const selected = params?.printer?.name;
  if (!printers.some((p) => p.enabled !== false && p.active !== false && p.transport === 'qz' && p.osPrinter === selected)) return false;
  const copies = params.options?.copies ?? 1;
  if (!Number.isInteger(copies) || copies < 1 || copies > 5) return false;
  // Sign only our inline receipt documents, never raw commands, files, or device operations.
  return Array.isArray(params.data) && params.data.length === 1 && params.data.every((part) =>
    part.type === 'pixel' && part.format === 'html' && part.flavor === 'plain' &&
    typeof part.data === 'string' && !/<\s*(script|iframe|object|embed|img|link|base)\b|\b(?:src|href)\s*=|url\s*\(/i.test(part.data));
}

app.get('/api/printing/qz/certificate', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ error: 'Not authenticated' });
    if (!requirePermission(context, res, 'signed_in')) return;
    res.set('Cache-Control', 'no-store');
    const material = await readQzSigningMaterial(printerSettingsApp(req, context), String(context.orgUser.org_id));
    res.json({ certificate: material.privateKey ? material.certificate : '' });
  } catch (_) { res.status(500).json({ error: 'Could not load QZ configuration.' }); }
});

function createQzRequestSignature(message, privateKey) {
  const crypto = require('crypto');
  const digest = crypto.createHash('sha256').update(message, 'utf8').digest('hex');
  return crypto.sign('RSA-SHA512', Buffer.from(digest, 'utf8'), privateKey).toString('base64');
}

app.post('/api/printing/qz/sign', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ error: 'Not authenticated' });
    if (!requirePermission(context, res, 'signed_in')) return;
    const material = await readQzSigningMaterial(printerSettingsApp(req, context), String(context.orgUser.org_id));
    if (!material.certificate || !material.privateKey) return res.status(503).json({ error: 'QZ signing certificate is not configured.' });
    const message = req.body?.message;
    const printers = await getPrinters(printerSettingsApp(req, context), String(context.orgUser.org_id));
    if (!qzSigningRequestAllowed(message, printers)) return res.status(400).json({ error: 'Unsupported QZ printing request.' });
    const signature = createQzRequestSignature(message, material.privateKey);
    res.set('Cache-Control', 'no-store');
    res.json({ signature });
  } catch (_) { res.status(500).json({ error: 'Could not sign the print request.' }); }
});

function personalProfileKey(context) {
  const identity = JSON.stringify([String(context.orgUser.org_id), String(context.user.email).trim().toLowerCase()]);
  return `personal_profile_${require('crypto').createHash('sha256').update(identity).digest('hex')}`;
}

async function readPersonalProfile(catalystApp, context) {
  const key = personalProfileKey(context);
  const rows = await safeZcql(catalystApp, `SELECT config_value FROM Configurations WHERE config_key = '${key}' LIMIT 1`);
  if (!rows || !rows.length) return { name: context.orgUser.display_name || context.user.email, phone: '' };
  return JSON.parse(rows[0].Configurations.config_value);
}

function publicPersonalProfile(context, profile) {
  return {
    name: String(profile.name || context.orgUser.display_name || context.user.email),
    phone: String(profile.phone || ''),
    email: context.user.email,
    role: callerRole(context),
    avatar_version: profile.photo_ref ? String(profile.photo_updated_at) : '',
  };
}

function personalProfilePatch(body) {
  const name = String(body && body.name || '').trim();
  const phone = String(body && body.phone || '').trim();
  if (!name || name.length > 80) return { error: 'Enter a display name of 1–80 characters.' };
  if (phone.length > 32 || (phone && !/^[+0-9() .-]+$/.test(phone))) return { error: 'Enter a valid phone number (maximum 32 characters).' };
  // Email, role, company, and photo storage keys cannot be changed through this form.
  return { name, phone };
}

function parseProfilePhoto(body) {
  const raw = String(body && body.imageData || '');
  const match = raw.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) return { error: 'Choose a PNG, JPEG, or WebP photo.' };
  if (match[2].length > Math.ceil(2 * 1024 * 1024 / 3) * 4) return { error: 'Photo must be 2 MB or smaller.' };
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > 2 * 1024 * 1024) return { error: 'Photo must be 2 MB or smaller.' };
  const mime = match[1];
  const valid = mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : mime === 'image/jpeg' ? buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
    : buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) return { error: 'The file contents do not match the selected image type.' };
  return { buffer, mime, ext: mime === 'image/jpeg' ? 'jpg' : mime.split('/')[1] };
}

app.get('/api/profile/me', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(context, res, 'manage_profile')) return;
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, profile: publicPersonalProfile(context, await readPersonalProfile(app, context)) });
  } catch (error) { res.status(500).json({ success: false, error: 'Could not load your profile.' }); }
});

app.put('/api/profile/me', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(context, res, 'manage_profile')) return;
    const patch = personalProfilePatch(req.body);
    if (patch.error) return res.status(400).json({ success: false, error: patch.error });
    const profile = { ...await readPersonalProfile(app, context), ...patch, updated_at: Date.now() };
    await safeUpsertConfig(app, personalProfileKey(context), JSON.stringify(profile));
    res.json({ success: true, profile: publicPersonalProfile(context, profile) });
  } catch (error) { res.status(500).json({ success: false, error: 'Could not save your profile.' }); }
});

app.post('/api/profile/me/photo', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(context, res, 'manage_profile')) return;
    const photo = parseProfilePhoto(req.body);
    if (photo.error) return res.status(400).json({ success: false, error: photo.error });
    const profile = await readPersonalProfile(app, context);
    const key = `profiles/${personalProfileKey(context)}/${require('crypto').randomUUID()}.${photo.ext}`;
    await stratusUploadBuffer(app, key, photo.buffer, photo.mime);
    const updated = { ...profile, photo_ref: key, photo_mime: photo.mime, photo_updated_at: Date.now() };
    try { await safeUpsertConfig(app, personalProfileKey(context), JSON.stringify(updated)); }
    catch (error) { await stratusDeleteKey(app, key); throw error; }
    if (profile.photo_ref) await stratusDeleteKey(app, profile.photo_ref);
    res.json({ success: true, profile: publicPersonalProfile(context, updated) });
  } catch (error) { res.status(500).json({ success: false, error: 'Could not upload your photo. Please try again.' }); }
});

app.delete('/api/profile/me/photo', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(context, res, 'manage_profile')) return;
    const profile = await readPersonalProfile(app, context);
    const key = profile.photo_ref;
    const updated = { ...profile, photo_ref: '', photo_mime: '', photo_updated_at: Date.now() };
    await safeUpsertConfig(app, personalProfileKey(context), JSON.stringify(updated));
    if (key) await stratusDeleteKey(app, key);
    res.json({ success: true, profile: publicPersonalProfile(context, updated) });
  } catch (error) { res.status(500).json({ success: false, error: 'Could not remove your photo.' }); }
});

app.get('/api/profile/me/photo', async (req, res) => {
  try {
    const app = catalyst.initialize(req);
    const context = await requireAuth(req, app);
    if (!context) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(context, res, 'manage_profile')) return;
    const profile = await readPersonalProfile(app, context);
    if (!profile.photo_ref) return res.status(404).json({ success: false, error: 'No profile photo.' });
    const bytes = await stratusDownloadBuffer(app, profile.photo_ref);
    if (!bytes) return res.status(404).json({ success: false, error: 'Photo unavailable.' });
    res.set({ 'Content-Type': profile.photo_mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(bytes);
  } catch (error) { res.status(500).json({ success: false, error: 'Could not load your photo.' }); }
});

/* ---------------- company endpoints (SET-01) ---------------- */

app.get('/api/settings/company', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    res.status(200).json({ success: true, company: await getCompanyProfile(catalystApp, orgId) });
  } catch (error) {
    console.error('Error reading company profile:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/settings/company', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Company settings require Admin.')) return;
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const result = await saveCompanyProfile(catalystApp, orgId, req.body || {});
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.status(200).json({ success: true, message: 'Company profile saved.', company: result.profile });
  } catch (error) {
    console.error('Error saving company profile:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

const COMPANY_LOGO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB (SRS)
const COMPANY_LOGO_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

function parseLogoUpload(body) {
  const raw = String((body && body.imageData) || '');
  if (!raw) return { error: 'imageData is required (base64 data URL or raw base64).' };
  let mime = String((body && body.mimeType) || '').trim().toLowerCase();
  let b64 = raw;
  const dataUrl = raw.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (dataUrl) {
    if (dataUrl[1]) mime = String(dataUrl[1]).trim().toLowerCase();
    b64 = dataUrl[3] || '';
  }
  if (mime === 'image/jpg') mime = 'image/jpeg';
  if (!Object.prototype.hasOwnProperty.call(COMPANY_LOGO_MIME, mime)) {
    return { error: 'Unsupported logo type. Use PNG, JPG/JPEG, or WebP.' };
  }
  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch (e) {
    return { error: 'imageData is not valid base64.' };
  }
  if (buffer.length === 0) return { error: 'Empty logo upload.' };
  if (buffer.length > COMPANY_LOGO_MAX_BYTES) {
    return { error: `Logo exceeds 5 MB (${Math.round(buffer.length / 1024)} KB).` };
  }
  return { buffer, mime, ext: COMPANY_LOGO_MIME[mime] };
}



/* ---------------- Company logo storage (Stratus-first, FileStore fallback) --
   Stratus bucket holds objects like `company/<orgId>/logo.png`; the
   Configurations value is `stratus:<key>`. Legacy numeric FileStore ids
   keep working through the fallback paths below, so pre-migration uploads
   never 404. Bucket name is overridable per environment. */

const STRATUS_ASSETS_BUCKET = process.env.STRATUS_ASSETS_BUCKET || 'companyassets';

function stratusAssetsBucket(catalystApp) {
  return catalystApp.stratus().bucket(STRATUS_ASSETS_BUCKET);
}

/**
 * App-level (admin) Stratus handle — bypasses end-user bucket policies.
 * Auth checks stay on the user-context `catalystApp`; the actual bucket
 * I/O retries here on 403/access_forbidden because `initialize(req)`
 * evaluates Stratus policies against the App User ZUID, which fails for
 * virtual/roster users even when the bucket name + policy are correct.
 */
function stratusAdminBucket() {
  return catalyst.initialize().stratus().bucket(STRATUS_ASSETS_BUCKET);
}

function isAccessForbidden(err) {
  const msg = String((err && err.message) || err || '');
  return err && (err.status === 403 || err.code === 'access_forbidden' || /access_forbidden|denied by resource access policy/i.test(msg));
}

function companyLogoKey(orgId, ext) {
  const safeOrg = String(orgId || 'org_default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `company/${safeOrg}/logo.${ext}`;
}

function logoRefIsStratus(ref) {
  return typeof ref === 'string' && ref.startsWith('stratus:');
}

function logoKeyFromRef(ref) {
  return String(ref).slice('stratus:'.length);
}

/** Upload a buffer to Stratus (temp-file stream; overwrite for replace flow). */
async function stratusUploadBuffer(catalystApp, key, buffer, mime) {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const safeName = String(key.split('/').pop() || 'logo');
  const tmpPath = path.join(os.tmpdir(), `stratus-${Date.now()}-${safeName}`);
  await fs.promises.writeFile(tmpPath, buffer);
  const putWith = (bucket, streamFactory) => bucket.putObject(key, streamFactory(), {
    overwrite: true,
    contentType: mime,
  });
  try {
    try {
      await putWith(stratusAssetsBucket(catalystApp), () => fs.createReadStream(tmpPath));
    } catch (e) {
      if (!isAccessForbidden(e)) throw e;
      console.warn('[LOGO] Stratus put denied for user context, retrying with app context:', e.message);
      await putWith(stratusAdminBucket(), () => fs.createReadStream(tmpPath));
    }
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}

/** Download a Stratus object key to a Buffer (getObject → Readable). */
async function stratusDownloadBuffer(catalystApp, key) {
  const toBuffer = async (stream) => {
    if (!stream) return null;
    if (Buffer.isBuffer(stream)) return stream.length > 0 ? stream : null;
    const chunks = [];
    await new Promise((resolve, reject) => {
      stream.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    const out = Buffer.concat(chunks);
    return out.length > 0 ? out : null;
  };
  try {
    return await toBuffer(await stratusAssetsBucket(catalystApp).getObject(key));
  } catch (e) {
    if (!isAccessForbidden(e)) throw e;
    console.warn('[LOGO] Stratus get denied for user context, retrying with app context:', e.message);
    return await toBuffer(await stratusAdminBucket().getObject(key));
  }
}

/** Best-effort Stratus delete. Never throws. */
async function stratusDeleteKey(catalystApp, key) {
  try {
    try {
      await stratusAssetsBucket(catalystApp).deleteObject(key);
    } catch (e) {
      if (!isAccessForbidden(e)) throw e;
      console.warn('[LOGO] Stratus delete denied for user context, retrying with app context:', e.message);
      await stratusAdminBucket().deleteObject(key);
    }
    return true;
  } catch (e) {
    console.warn('[LOGO] Stratus delete skipped:', e.message);
    return false;
  }
}

/**
 * Resolve the stored logo reference to bytes. Stratus-first with legacy
 * FileStore fallback. Returns { bytes, mime } (bytes null when absent).
 * Self-healing: if this org has no logo ref (org_default vs real-org
 * mismatch after onboarding), adopt any stratus logo ref in the table.
 */
async function findAnyLogoRef(catalystApp) {
  try {
    const r = await catalystApp.zcql().executeZCQLQuery(
      `SELECT config_key, config_value FROM Configurations LIMIT 300`
    );
    const rows = (r || []).map((x) => x.Configurations).filter(Boolean);
    const hit = rows.find((row) =>
      String(row.config_key || '').endsWith('_setting_company_logo_file_id') &&
      String(row.config_value || '').startsWith('stratus:')
    );
    if (!hit) return null;
    const prefix = String(hit.config_key).slice(0, -'company_logo_file_id'.length);
    const val = (suffix) => {
      const row = rows.find((x) => String(x.config_key || '') === `${prefix}${suffix}`);
      return row ? String(row.config_value || '') : '';
    };
    return {
      ref: String(hit.config_value),
      mime: val('company_logo_mime') || 'image/png',
      name: val('company_logo_name'),
      source: `${prefix}*`,
    };
  } catch (e) { return null; }
}

async function getCompanyLogoBytes(catalystApp, orgId) {
  const booksService = new ZohoBooksService(catalystApp, null);
  let ref = await booksService.getConfig(`org_${orgId}_setting_company_logo_file_id`);
  let mime = (await booksService.getConfig(`org_${orgId}_setting_company_logo_mime`)) || 'image/png';
  if (!ref || !logoRefIsStratus(ref)) {
    const adopted = await findAnyLogoRef(catalystApp);
    if (!adopted) return { bytes: null, mime };
    console.log(`[LOGO] adopted logo ref from ${adopted.source} for org ${orgId}`);
    ref = adopted.ref;
    mime = adopted.mime || mime;
  }
  try {
    return { bytes: await stratusDownloadBuffer(catalystApp, logoKeyFromRef(ref)), mime };
  } catch (e) {
    console.warn('[LOGO] Stratus download failed:', e.message);
    return { bytes: null, mime };
  }
}

function productImageKey(rowId, ext) {
  return `products/${String(rowId).replace(/[^0-9]/g, '')}.${ext}`;
}

/** Resolve a product image ref (stratus: key) to bytes. */
async function getProductImageBytes(catalystApp, ref) {
  if (!ref || !logoRefIsStratus(ref)) return null;
  try {
    return await stratusDownloadBuffer(catalystApp, logoKeyFromRef(ref));
  } catch (e) {
    console.warn('[PRODUCT-IMG] Stratus download failed:', e.message);
    return null;
  }
}

/** POST /api/settings/company/logo — upload/replace (Admin only). */
app.post('/api/settings/company/logo', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Logo upload requires Admin.')) return;
    const parsed = parseLogoUpload(req.body || {});
    if (parsed.error) return res.status(400).json({ success: false, error: parsed.error });
    // Upload shape log (never body bytes, never secrets).
    try {
      const bodyKeys = req.body && typeof req.body === 'object' ? Object.keys(req.body) : typeof req.body;
      console.log('[LOGO] upload request:',
        `content-type=${req.get('content-type') || '(none)'}`,
        `body-keys=${JSON.stringify(bodyKeys)}`,
        `imageData-len=${String((req.body && req.body.imageData) || '').length}`,
        `mime-in=${String((req.body && req.body.mimeType) || '')}`,
        `decoded-bytes=${parsed.buffer.length}`,
        `mime=${parsed.mime}`);
    } catch (logErr) { console.log('[LOGO] diag failed:', logErr.message); }
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const booksService = new ZohoBooksService(catalystApp, null);
    const oldId = await booksService.getConfig(`org_${orgId}_setting_company_logo_file_id`);
    // Stratus is the only backend (FileStore retired with the migration).
    const objectKey = companyLogoKey(orgId, parsed.ext);
    await stratusUploadBuffer(catalystApp, objectKey, parsed.buffer, parsed.mime);
    const newRef = `stratus:${objectKey}`;
    console.log('[LOGO] Stratus upload ok:', `key=${objectKey}`, `mime=${parsed.mime}`, `bytes=${parsed.buffer.length}`);
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_company_logo_file_id`, newRef);
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_company_logo_name`, `company-logo.${parsed.ext}`);
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_company_logo_mime`, parsed.mime);
    if (oldId && oldId !== newRef) {
      if (logoRefIsStratus(oldId)) {
        await stratusDeleteKey(catalystApp, logoKeyFromRef(oldId));
      } else {
        console.warn('[LOGO] Skipping legacy FileStore cleanup for retired backend.');
      }
    }
    res.status(200).json({ success: true, message: 'Logo uploaded.', logo_url: '/api/settings/company/logo' });
  } catch (error) {
    console.error('Error uploading logo:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** DELETE /api/settings/company/logo — remove (Admin only). */
app.delete('/api/settings/company/logo', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Logo removal requires Admin.')) return;
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const booksService = new ZohoBooksService(catalystApp, null);
    const fileId = await booksService.getConfig(`org_${orgId}_setting_company_logo_file_id`);
    if (fileId && logoRefIsStratus(fileId)) {
      await stratusDeleteKey(catalystApp, logoKeyFromRef(fileId));
    }
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_company_logo_file_id`, '');
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_company_logo_name`, '');
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_company_logo_mime`, '');
    res.status(200).json({ success: true, message: 'Logo removed.' });
  } catch (error) {
    console.error('Error removing logo:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/settings/company/logo — stream stored bytes (authenticated). */
app.get('/api/settings/company/logo', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const { bytes, mime: storedMime } = await getCompanyLogoBytes(catalystApp, orgId);
    const mime = storedMime || 'image/png';
    if (!bytes) {
      const booksService = new ZohoBooksService(catalystApp, null);
      const ref = await booksService.getConfig(`org_${orgId}_setting_company_logo_file_id`);
      if (!ref) return res.status(404).json({ success: false, error: 'No logo uploaded.' });
      return res.status(404).json({ success: false, error: 'Logo file unavailable.' });
    }
    res.setHeader('Content-Type', String(mime));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).send(bytes);
  } catch (error) {
    console.error('Error streaming logo:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Decode a PNG buffer to raw RGB (8-bit, non-interlaced; gray / truecolor
 * / truecolor+alpha). Palette and interlaced images return null.
 */
function decodePngToRgb(buffer) {
  try {
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
      if (buffer[i] !== sig[i]) return null;
    }
    let pos = 8;
    let w = 0;
    let h = 0;
    let bitDepth = 0;
    let colorType = -1;
    let interlace = 0;
    const idat = [];
    while (pos + 8 <= buffer.length) {
      const len = buffer.readUInt32BE(pos);
      if (len > 50 * 1024 * 1024) return null;
      const type = buffer.toString('ascii', pos + 4, pos + 8);
      const data = buffer.slice(pos + 8, pos + 8 + len);
      if (type === 'IHDR') {
        w = data.readUInt32BE(0);
        h = data.readUInt32BE(4);
        bitDepth = data[8];
        colorType = data[9];
        interlace = data[12];
      } else if (type === 'IDAT') {
        idat.push(data);
      } else if (type === 'IEND') {
        break;
      }
      pos += 12 + len;
    }
    if (!w || !h || w > 3000 || h > 3000) return null;
    if (bitDepth !== 8 || interlace !== 0) return null;
    if (![0, 2, 6].includes(colorType)) return null;
    const channels = colorType === 0 ? 1 : (colorType === 2 ? 3 : 4);
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * channels;
    if (raw.length < h * (stride + 1)) return null;
    const rawRows = [];
    let p = 0;
    for (let y = 0; y < h; y++) {
      const filter = raw[p++];
      const cur = raw.slice(p, p + stride);
      p += stride;
      const prev = y === 0 ? Buffer.alloc(stride) : rawRows[y - 1];
      const recon = Buffer.alloc(stride);
      const bpp = channels;
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? recon[x - bpp] : 0;
        const b = prev[x];
        const c = x >= bpp ? prev[x - bpp] : 0;
        let v = cur[x];
        if (filter === 1) v += a;
        else if (filter === 2) v += b;
        else if (filter === 3) v += (a + b) >> 1;
        else if (filter === 4) {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
        }
        recon[x] = v & 255;
      }
      rawRows.push(recon);
    }
    const rgb = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) {
      const row = rawRows[y];
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 3;
        if (colorType === 0) {
          const g = row[x];
          rgb[o] = g; rgb[o + 1] = g; rgb[o + 2] = g;
        } else if (colorType === 2) {
          rgb[o] = row[x * 3]; rgb[o + 1] = row[x * 3 + 1]; rgb[o + 2] = row[x * 3 + 2];
        } else {
          rgb[o] = row[x * 4]; rgb[o + 1] = row[x * 4 + 1]; rgb[o + 2] = row[x * 4 + 2];
        }
      }
    }
    return { w, h, rgb, gray: colorType === 0 };
  } catch (e) {
    return null;
  }
}

/** Scan a JPEG for its SOF frame (dimensions + components). */
function parseJpegFrame(buffer) {
  try {
    if (buffer.length < 4 || buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null;
    let pos = 2;
    while (pos + 4 <= buffer.length) {
      if (buffer[pos] !== 0xFF) {
        pos += 1;
        continue;
      }
      const marker = buffer[pos + 1];
      if (marker === 0xD8 || marker === 0xD9 || (marker >= 0xD0 && marker <= 0xD7) || marker === 0x01) {
        pos += 2;
        continue;
      }
      if (pos + 4 > buffer.length) return null;
      const len = buffer.readUInt16BE(pos + 2);
      if (len < 2) return null;
      if (marker === 0xC0 || marker === 0xC2) {
        return {
          w: buffer.readUInt16BE(pos + 7),
          h: buffer.readUInt16BE(pos + 5),
          gray: buffer[pos + 9] === 1,
        };
      }
      if (marker === 0xDA) return null; // scan data reached without SOF
      pos += 2 + len;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Company logo as PDF-ready raster (PNG decoded to RGB, JPEG embedded
 * natively). Returns { bytes, mime, w, h, gray, encoding } or null when
 * unavailable, oversized (>400 KB for sane PDFs) or unsupported.
 */
async function getCompanyLogoImage(catalystApp, orgId) {
  try {
    const { bytes, mime: storedMime } = await getCompanyLogoBytes(catalystApp, orgId);
    const mime = String(storedMime || '').toLowerCase();
    if (!bytes || bytes.length === 0 || bytes.length > 400 * 1024) return null;
    if (mime === 'image/png') {
      const dec = decodePngToRgb(bytes);
      if (!dec) return null;
      return { bytes: dec.rgb, mime, w: dec.w, h: dec.h, gray: dec.gray, encoding: 'flate' };
    }
    if (mime === 'image/jpeg') {
      const frame = parseJpegFrame(bytes);
      if (!frame || !frame.w || !frame.h) return null;
      return { bytes, mime, w: frame.w, h: frame.h, gray: frame.gray, encoding: 'dct' };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/** Logo as a data URI for email receipts (best-effort, capped). */
async function getCompanyLogoDataUri(catalystApp, orgId) {
  try {
    const { bytes, mime: storedMime } = await getCompanyLogoBytes(catalystApp, orgId);
    const mime = storedMime || 'image/png';
    if (!bytes || bytes.length === 0 || bytes.length > 300 * 1024) return '';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch (e) {
    return '';
  }
}

/* ---------------- tax endpoints (SET-02) ---------------- */

app.get('/api/settings/tax', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    res.status(200).json({ success: true, tax: await getTaxSettings(catalystApp, orgId) });
  } catch (error) {
    console.error('Error reading tax settings:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/settings/tax', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Tax settings require Admin.')) return;
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const result = await saveTaxSettings(catalystApp, orgId, req.body || {});
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.status(200).json({ success: true, message: 'Tax settings saved.', tax: result.tax });
  } catch (error) {
    console.error('Error saving tax settings:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- notification endpoints (SET-04) ---------------- */

app.get('/api/settings/notifications', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const role = callerRole(orgUserContext);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Notification settings require Admin or Manager.' });
    }
    const orgId = String(orgUserContext.orgUser.org_id || '');
    res.status(200).json({ success: true, notifications: await getNotificationSettings(catalystApp, orgId) });
  } catch (error) {
    console.error('Error reading notification settings:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/settings/notifications', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Notification settings require Admin.')) return;
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const result = await saveNotificationSettings(catalystApp, orgId, req.body || {});
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    res.status(200).json({ success: true, message: 'Notification preferences saved.', notifications: result.notifications });
  } catch (error) {
    console.error('Error saving notification settings:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- loyalty campaigns + redemption ----------------
   Campaigns live as one org-scoped Configurations JSON document (small,
   rarely written) — no new table to provision. Redemption deducts the
   usable balance, keeps lifetime_points historical, and audits twice
   (CustomerActivity + UserAuditLog via the middleware mapping). */

async function getLoyaltyCampaigns(catalystApp, orgId) {
  try {
    const booksService = new ZohoBooksService(catalystApp, null);
    const raw = await booksService.getConfig(`org_${orgId}_setting_loyalty_campaigns`);
    if (raw === undefined || raw === null || String(raw) === '') return [];
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c) => c && String(c.id ?? '').trim() !== '').map((c) => ({
      id: String(c.id),
      name: String(c.name ?? ''),
      description: String(c.description ?? ''),
      points_cost: Math.max(1, Math.floor(Number(c.points_cost) || 1)),
      reward_type: c.reward_type === 'discount_flat' ? 'discount_flat' : 'discount_percent',
      reward_value: Math.max(0, Number(c.reward_value) || 0),
      active: c.active !== false,
      created_at: String(c.created_at ?? ''),
    }));
  } catch (e) {
    return [];
  }
}

async function saveLoyaltyCampaigns(catalystApp, orgId, list) {
  await safeUpsertConfig(catalystApp, `org_${orgId}_setting_loyalty_campaigns`, JSON.stringify(list));
}

app.get('/api/loyalty/campaigns', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const campaigns = await getLoyaltyCampaigns(catalystApp, orgId);
    const onlyActive = String((req.query && req.query.active) || '').toLowerCase() === 'true';
    res.status(200).json({
      success: true,
      count: campaigns.length,
      data: onlyActive ? campaigns.filter((c) => c.active) : campaigns,
    });
  } catch (error) {
    console.error('Error listing campaigns:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/loyalty/campaigns', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const role = callerRole(orgUserContext);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Campaigns require Admin or Manager.' });
    }
    const { name, description, points_cost, reward_type, reward_value, active } = req.body || {};
    if (!name || String(name).trim() === '') {
      return res.status(400).json({ success: false, error: 'Campaign name is required.' });
    }
    const cost = Math.floor(Number(points_cost) || 0);
    if (cost <= 0) return res.status(400).json({ success: false, error: 'Points cost must be at least 1.' });
    const rtype = reward_type === 'discount_flat' ? 'discount_flat' : 'discount_percent';
    const rval = Number(reward_value) || 0;
    if (rval <= 0 || (rtype === 'discount_percent' && rval > 100)) {
      return res.status(400).json({ success: false, error: 'Reward value must be positive (percent ≤ 100).' });
    }
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const list = await getLoyaltyCampaigns(catalystApp, orgId);
    const campaign = {
      id: `CMP-${Date.now().toString(36).toUpperCase()}`,
      name: String(name).trim().slice(0, 80),
      description: String(description ?? '').trim().slice(0, 300),
      points_cost: cost,
      reward_type: rtype,
      reward_value: rval,
      active: active !== false,
      created_at: formatCatalystDateTime(new Date()),
    };
    list.push(campaign);
    await saveLoyaltyCampaigns(catalystApp, orgId, list);
    res.status(201).json({ success: true, message: 'Campaign created.', campaign });
  } catch (error) {
    console.error('Error creating campaign:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/loyalty/campaigns/:id', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const role = callerRole(orgUserContext);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Campaigns require Admin or Manager.' });
    }
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const list = await getLoyaltyCampaigns(catalystApp, orgId);
    const idx = list.findIndex((c) => c.id === String(req.params.id));
    if (idx < 0) return res.status(404).json({ success: false, error: 'Campaign not found.' });
    const patch = req.body || {};
    if (patch.name !== undefined) {
      if (String(patch.name).trim() === '') return res.status(400).json({ success: false, error: 'Name cannot be empty.' });
      list[idx].name = String(patch.name).trim().slice(0, 80);
    }
    if (patch.description !== undefined) list[idx].description = String(patch.description).slice(0, 300);
    if (patch.points_cost !== undefined) {
      const cost = Math.floor(Number(patch.points_cost) || 0);
      if (cost <= 0) return res.status(400).json({ success: false, error: 'Points cost must be at least 1.' });
      list[idx].points_cost = cost;
    }
    if (patch.reward_type !== undefined) {
      list[idx].reward_type = patch.reward_type === 'discount_flat' ? 'discount_flat' : 'discount_percent';
    }
    if (patch.reward_value !== undefined) {
      const rval = Number(patch.reward_value) || 0;
      if (rval <= 0 || (list[idx].reward_type === 'discount_percent' && rval > 100)) {
        return res.status(400).json({ success: false, error: 'Reward value must be positive (percent ≤ 100).' });
      }
      list[idx].reward_value = rval;
    }
    if (patch.active !== undefined) list[idx].active = patch.active === true;
    await saveLoyaltyCampaigns(catalystApp, orgId, list);
    res.status(200).json({ success: true, message: 'Campaign updated.', campaign: list[idx] });
  } catch (error) {
    console.error('Error updating campaign:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/customers/:id/redeem { campaign_id } — redeem a campaign
 * reward against the usable points balance (Admin/Manager/Cashier at the
 * counter). Returns a voucher code the cashier applies as a POS discount.
 */
app.post('/api/customers/:id/redeem', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const role = callerRole(orgUserContext);
    if (!['Admin', 'Manager', 'Cashier'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Redeeming rewards requires Admin, Manager or Cashier.' });
    }
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const cfg = await getLoyaltyConfig(catalystApp, orgId);
    if (!cfg.enabled) {
      return res.status(400).json({ success: false, error: 'The loyalty program is disabled.' });
    }
    let c;
    try {
      c = await findCustomerById(catalystApp, req.params.id);
    } catch (e) {
      return res.status(503).json({ success: false, error: `Table 'Customers' is not provisioned.` });
    }
    if (!c) return res.status(404).json({ success: false, error: 'Customer not found.' });
    const { campaign_id } = req.body || {};
    const campaigns = await getLoyaltyCampaigns(catalystApp, orgId);
    const campaign = campaigns.find((x) => x.id === String(campaign_id || ''));
    if (!campaign) return res.status(404).json({ success: false, error: 'Campaign not found.' });
    if (!campaign.active) return res.status(400).json({ success: false, error: 'Campaign is not active.' });
    const balance = Number(c.loyalty_points) || 0;
    if (balance < campaign.points_cost) {
      return res.status(400).json({ success: false, error: `Insufficient points (has ${balance}, needs ${campaign.points_cost}).` });
    }
    const newPts = balance - campaign.points_cost;
    await catalystApp.datastore().table('Customers').updateRow({
      ROWID: c.ROWID,
      loyalty_points: newPts,
      updated_at: formatCatalystDateTime(new Date()),
    });
    const performedBy = await whActorEmail(req, catalystApp, orgUserContext);
    const voucher = `RWD-${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, '0')}`;
    await logCustomerActivity(catalystApp, {
      customerId: c.ROWID,
      delta: -campaign.points_cost,
      oldPoints: balance,
      newPoints: newPts,
      reason: `Redeemed "${campaign.name}" (${voucher})`,
      performedBy,
    });
    res.status(200).json({
      success: true,
      message: `Redeemed "${campaign.name}".`,
      voucher,
      campaign,
      loyalty_points: newPts,
      reward: campaign.reward_type === 'discount_flat'
        ? { type: 'flat', value: campaign.reward_value }
        : { type: 'percent', value: campaign.reward_value },
    });
  } catch (error) {
    console.error('Error redeeming reward:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- payment methods (SET-05 tender config) ----------------
   No external gateway is integrated (none credentialed on this project):
   this governs which manual tender methods the counter offers. POS and
   checkout both enforce the enabled set; at least one stays enabled. */

const TENDER_MODES = ['Cash', 'Card', 'Bank'];

async function getPaymentMethods(catalystApp, orgId) {
  const modes = TENDER_MODES.map((m) => ({ mode: m, enabled: true }));
  try {
    const booksService = new ZohoBooksService(catalystApp, null);
    const raw = await booksService.getConfig(`org_${orgId}_setting_payment_methods`);
    if (raw !== undefined && raw !== null && String(raw) !== '') {
      const parsed = JSON.parse(String(raw));
      if (Array.isArray(parsed)) {
        for (const m of modes) {
          const hit = parsed.find((p) => p && String(p.mode || '') === m.mode);
          if (hit) m.enabled = hit.enabled !== false;
        }
      }
    }
  } catch (e) { /* all enabled */ }
  return modes;
}

app.get('/api/settings/payments', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    res.status(200).json({
      success: true,
      methods: await getPaymentMethods(catalystApp, orgId),
      gateway: { connected: false, note: 'No external payment gateway is connected — manual tender only.' },
    });
  } catch (error) {
    console.error('Error reading payment methods:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/settings/payments', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Payment methods require Admin.')) return;
    const { methods } = req.body || {};
    if (!Array.isArray(methods)) return res.status(400).json({ success: false, error: 'methods must be a list.' });
    const next = TENDER_MODES.map((m) => {
      const hit = methods.find((x) => x && String(x.mode || '') === m);
      return { mode: m, enabled: !hit || hit.enabled !== false };
    });
    if (!next.some((m) => m.enabled)) {
      return res.status(400).json({ success: false, error: 'At least one payment method must stay enabled.' });
    }
    const orgId = String(orgUserContext.orgUser.org_id || '');
    await safeUpsertConfig(catalystApp, `org_${orgId}_setting_payment_methods`, JSON.stringify(next));
    res.status(200).json({ success: true, message: 'Payment methods saved.', methods: next });
  } catch (error) {
    console.error('Error saving payment methods:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ==========================================================================
   KOT + PRINT ROUTING (restaurant / industrial)
   --------------------------------------------------------------------------
   One order fans out to 2–3 printers: counter bill plus station chits
   (kitchen KOT, bar). The cloud never touches printers directly — it plans
   printJobs and the terminal (browser / QZ Tray / bridge) executes them.

   Storage (Configurations JSON, no new tables):
     org_<id>_setting_printers      [{id,name,station,width,transport,address,active}]
     org_<id>_setting_print_routing {byCategoryId,byCategoryName,defaultStation}
     org_<id>_setting_kot_seq_<day> daily KOT counter
     org_<id>_setting_kot_log       last 200 KOT entries (status FIRED/ACKED/DONE)
   ========================================================================== */

const PRINT_STATIONS = ['counter', 'kitchen', 'bar'];
const PRINT_TRANSPORTS = ['browser', 'qz', 'bridge', 'cloud'];
const KOT_STATUSES = ['FIRED', 'ACKED', 'DONE'];
const PRINTER_KNOWN_FIELDS = new Set(['id', 'name', 'station', 'width', 'transport', 'address', 'active', 'enabled', 'osPrinter']);

/** Preserve forward-compatible terminal metadata while normalizing known keys. */
function printerExtraFields(input) {
  const extras = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return extras;
  for (const [key, value] of Object.entries(input)) {
    if (!PRINTER_KNOWN_FIELDS.has(key) && !['__proto__', 'constructor', 'prototype'].includes(key)) extras[key] = value;
  }
  return extras;
}

function normPrintStation(v, dflt) {
  const s = String(v ?? '').trim().toLowerCase();
  return PRINT_STATIONS.includes(s) ? s : (dflt || 'counter');
}

async function getPrinters(catalystApp, orgId) {
  try {
    const key = sanitizeZcql(`org_${orgId}_setting_printers`);
    const rows = await safeZcql(catalystApp, `SELECT config_value FROM Configurations WHERE config_key = '${key}' LIMIT 1`);
    const raw = rows?.[0]?.Configurations?.config_value;
    if (raw === undefined || raw === null || String(raw) === '') return [];
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p) => p && String(p.id ?? '').trim() !== '').map((p) => ({
      ...printerExtraFields(p),
      id: String(p.id).trim().slice(0, 60),
      name: String(p.name ?? '').trim().slice(0, 80) || String(p.id).trim(),
      station: normPrintStation(p.station, 'counter'),
      width: Number(p.width) === 58 ? 58 : 80,
      transport: PRINT_TRANSPORTS.includes(String(p.transport || '').trim().toLowerCase())
        ? String(p.transport).trim().toLowerCase() : 'browser',
      address: String(p.address ?? '').trim().slice(0, 200),
      osPrinter: String(p.osPrinter ?? '').trim().slice(0, 200),
      // `active` is the persisted key.  Also expose `enabled` because the
      // terminal settings form uses that API field; accepting both keeps old
      // saved JSON and the terminal round-trip in agreement.
      active: p.active !== false && p.enabled !== false,
      enabled: p.active !== false && p.enabled !== false,
    })).slice(0, 20);
  } catch (e) {
    throw new Error(`Could not read company printers: ${extractSdkMessage(e)}`);
  }
}

async function savePrinters(catalystApp, orgId, list) {
  if (!Array.isArray(list)) return { error: 'printers must be a list.' };
  if (list.length > 20) return { error: 'At most 20 printers.' };
  const seen = new Set();
  const clean = [];
  for (const p of list) {
    if (!p || String(p.id ?? '').trim() === '') return { error: 'Every printer needs an id.' };
    const id = String(p.id).trim().slice(0, 60);
    if (seen.has(id.toLowerCase())) return { error: `Duplicate printer id "${id}".` };
    seen.add(id.toLowerCase());
    clean.push({
      ...printerExtraFields(p),
      id,
      name: String(p.name ?? '').trim().slice(0, 80) || id,
      station: normPrintStation(p.station, 'counter'),
      width: Number(p.width) === 58 ? 58 : 80,
      transport: PRINT_TRANSPORTS.includes(String(p.transport || '').trim().toLowerCase())
        ? String(p.transport).trim().toLowerCase() : 'browser',
      address: String(p.address ?? '').trim().slice(0, 200),
      osPrinter: String(p.osPrinter ?? '').trim().slice(0, 200),
      // Persist the established `active` key, while accepting the terminal's
      // `enabled` field.  A disabled printer must stay disabled after reload.
      active: p.active !== false && p.enabled !== false,
    });
  }
  await safeUpsertConfig(catalystApp, `org_${orgId}_setting_printers`, JSON.stringify(clean));
  return { printers: clean.map((p) => ({ ...p, enabled: p.active })) };
}

async function getPrintRouting(catalystApp, orgId) {
  const dflt = { byCategoryId: {}, byCategoryName: {}, defaultStation: 'counter' };
  try {
    const raw = await new ZohoBooksService(catalystApp, null).getConfig(`org_${orgId}_setting_print_routing`);
    if (raw === undefined || raw === null || String(raw) === '') return dflt;
    const parsed = JSON.parse(String(raw));
    if (!parsed || typeof parsed !== 'object') return dflt;
    const byCategoryId = {};
    for (const [k, v] of Object.entries(parsed.byCategoryId || {})) {
      if (/^[0-9]+$/.test(String(k).trim())) byCategoryId[String(k).trim()] = normPrintStation(v, 'counter');
    }
    const byCategoryName = {};
    for (const [k, v] of Object.entries(parsed.byCategoryName || {})) {
      if (String(k).trim() !== '') byCategoryName[String(k).trim().toLowerCase()] = normPrintStation(v, 'counter');
    }
    return { byCategoryId, byCategoryName, defaultStation: normPrintStation(parsed.defaultStation, 'counter') };
  } catch (e) {
    return dflt;
  }
}

async function savePrintRouting(catalystApp, orgId, input) {
  if (!input || typeof input !== 'object') return { error: 'Routing object is required.' };
  const byCategoryId = {};
  let count = 0;
  for (const [k, v] of Object.entries(input.byCategoryId || {})) {
    if (!/^[0-9]+$/.test(String(k).trim())) return { error: `Category id "${k}" must be digits.` };
    byCategoryId[String(k).trim()] = normPrintStation(v, 'counter');
    count += 1;
  }
  const byCategoryName = {};
  for (const [k, v] of Object.entries(input.byCategoryName || {})) {
    if (String(k).trim() === '') return { error: 'Category names cannot be empty.' };
    byCategoryName[String(k).trim().toLowerCase()] = normPrintStation(v, 'counter');
    count += 1;
  }
  if (count > 200) return { error: 'At most 200 routing rules.' };
  const routing = { byCategoryId, byCategoryName, defaultStation: normPrintStation(input.defaultStation, 'counter') };
  await safeUpsertConfig(catalystApp, `org_${orgId}_setting_print_routing`, JSON.stringify(routing));
  return { routing };
}

/** Category lookup for a batch of product ROWIDs (bounded, fail-soft). */
async function productStationMap(catalystApp, rowIds) {
  const map = new Map();
  const ids = [...new Set((rowIds || []).map((v) => String(v ?? '').trim()).filter((v) => /^[0-9]+$/.test(v)))].slice(0, 100);
  for (const id of ids) {
    try {
      const r = await safeZcql(catalystApp,
        `SELECT category_id, category FROM Products WHERE ROWID = ${id} LIMIT 1`);
      if (r && r.length > 0) map.set(id, r[0].Products);
    } catch (e) { /* unknown category reads as default station */ }
  }
  return map;
}

/**
 * Station for one line: category id → case-insensitive category-name match
 * → routing default. Name rules are substring matches; an exact match wins,
 * otherwise the longest matching configured name wins (then lexical order),
 * which makes overlapping rules deterministic for checkout and cancel chits.
 */
function stationForLine(live, routing, stationMap) {
  const id = live ? String(live.ROWID ?? '') : '';
  const info = (id !== '' && stationMap.get(id)) || null;
  const cid = info ? String(info.category_id ?? '').trim() : '';
  if (cid !== '' && routing.byCategoryId[cid]) return routing.byCategoryId[cid];
  const cname = info ? String(info.category ?? '').trim().toLowerCase() : '';
  if (cname !== '') {
    if (routing.byCategoryName[cname]) return routing.byCategoryName[cname];
    const match = Object.keys(routing.byCategoryName)
      .filter((name) => name !== '' && cname.includes(name))
      .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
    if (match) return routing.byCategoryName[match];
  }
  return routing.defaultStation || 'counter';
}

/** UTC day stamp YYYYMMDD for KOT numbering and per-day log keys. */
function kotDayStamp(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

/** Forward-only KOT transitions: FIRED → ACKED → DONE. */
function kotTransitionAllowed(from, to) {
  return KOT_STATUSES.indexOf(to) === KOT_STATUSES.indexOf(from) + 1;
}

function kotLogKey(orgId, day) {
  return `org_${orgId}_setting_kot_log_${day}`;
}

function kotRecentDays() {
  const days = [];
  for (let i = 0; i <= 6; i++) days.push(new Date(Date.now() - i * 86400000).toISOString().slice(0, 10));
  return days;
}

/** Daily KOT number (KOT-YYYYMMDD-NNN); skips numbers already in the log
   (concurrent-checkout race guard), time-suffixed fallback, never throws. */
async function allocKotNumber(catalystApp, orgId) {
  const day = kotDayStamp(new Date());
  const key = `org_${orgId}_setting_kot_seq_${day}`;
  try {
    const booksService = new ZohoBooksService(catalystApp, null);
    const cur = parseInt(String(await booksService.getConfig(key) || '0'), 10) || 0;
    const taken = new Set(
      (await readKotLog(catalystApp, orgId)).map((e) => e && e.number).filter((n) => typeof n === 'string')
    );
    let n = cur + 1;
    let guard = 0;
    let candidate = '';
    do {
      candidate = `KOT-${day}-${String(n).padStart(3, '0')}`;
      n += 1;
      guard += 1;
    } while (taken.has(candidate) && guard < 100);
    if (taken.has(candidate)) return `KOT-${day}-${Date.now().toString(36).toUpperCase()}`;
    await safeUpsertConfig(catalystApp, key, String(n - 1));
    return candidate;
  } catch (e) {
    return `KOT-${day}-${Date.now().toString(36).toUpperCase()}`;
  }
}

async function readKotDay(catalystApp, orgId, day) {
  try {
    const raw = await new ZohoBooksService(catalystApp, null).getConfig(kotLogKey(orgId, day));
    const arr = JSON.parse(String(raw || '[]'));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

/** Merged log, oldest-first: today + legacy single doc + previous 6 days. */
async function readKotLog(catalystApp, orgId) {
  const merged = [];
  const seen = new Set();
  const pushAll = (arr) => {
    for (const e of arr) {
      if (!e || typeof e.number !== 'string' || seen.has(e.number)) continue;
      seen.add(e.number);
      merged.push(e);
    }
  };
  const days = kotRecentDays();
  pushAll(await readKotDay(catalystApp, orgId, days[0]));
  try {
    const raw = await new ZohoBooksService(catalystApp, null).getConfig(`org_${orgId}_setting_kot_log`);
    const arr = JSON.parse(String(raw || '[]'));
    if (Array.isArray(arr)) pushAll(arr);
  } catch (e) { /* legacy key optional */ }
  for (const d of days.slice(1)) pushAll(await readKotDay(catalystApp, orgId, d));
  merged.sort((a, b) => (String(a.firedAt || '') < String(b.firedAt || '') ? -1 : 1));
  return merged;
}

async function writeKotDay(catalystApp, orgId, day, log) {
  await safeUpsertConfig(catalystApp, kotLogKey(orgId, day), JSON.stringify(log.slice(-200)));
}

async function appendKotLog(catalystApp, orgId, entries) {
  const today = new Date().toISOString().slice(0, 10);
  const log = await readKotDay(catalystApp, orgId, today);
  for (const e of entries) log.push(e);
  await writeKotDay(catalystApp, orgId, today, log);
}

async function setKotStatus(catalystApp, orgId, number, to, actor) {
  // Search today, then the legacy doc, then previous days (KOTs acked
  // across midnight); the entry is written back to the key it came from.
  const days = kotRecentDays();
  const candidates = [...days.map((day) => ({ kind: 'day', day })), { kind: 'legacy' }];
  for (const c of candidates) {
    let log;
    if (c.kind === 'legacy') {
      try {
        const raw = await new ZohoBooksService(catalystApp, null).getConfig(`org_${orgId}_setting_kot_log`);
        const arr = JSON.parse(String(raw || '[]'));
        log = Array.isArray(arr) ? arr : [];
      } catch (e) { continue; }
    } else {
      log = await readKotDay(catalystApp, orgId, c.day);
    }
    const e = log.find((x) => x && x.number === number);
    if (!e) continue;
    if (!kotTransitionAllowed(e.status, to)) {
      return { error: `KOT ${number} is already ${e.status}.` };
    }
    e.status = to;
    e.updated_at = new Date().toISOString();
    if (actor) e.actor = actor;
    if (c.kind === 'legacy') {
      await safeUpsertConfig(catalystApp, `org_${orgId}_setting_kot_log`, JSON.stringify(log.slice(-200)));
    } else {
      await writeKotDay(catalystApp, orgId, c.day, log);
    }
    return e;
  }
  return null;
}

/**
 * Cancel chit for voided/returned lines, grouped by station.
 * lines: [{ name, sku, qty, ref }] where ref is the product ROWID when known.
 */
async function buildCancelChit(catalystApp, orgId, lines, meta) {
  const items = (lines || []).filter((l) => l && Number(l.qty) > 0);
  if (items.length === 0) return null;
  const routing = await getPrintRouting(catalystApp, orgId);
  const stationMap = await productStationMap(catalystApp, items.map((l) => l.ref));
  const groups = new Map();
  for (const l of items) {
    const st = stationForLine(l.ref ? { ROWID: l.ref } : null, routing, stationMap);
    if (!groups.has(st)) groups.set(st, []);
    groups.get(st).push({ name: String(l.name || 'Item'), sku: String(l.sku || ''), qty: Number(l.qty) });
  }
  return {
    cancelRef: `CNL-${Date.now().toString(36).toUpperCase()}`,
    orderId: String((meta && meta.orderId) || ''),
    reason: String((meta && meta.reason) || ''),
    actor: String((meta && meta.actor) || ''),
    at: new Date().toISOString(),
    groups: [...groups.entries()].map(([station, stationItems]) => ({ station, items: stationItems })),
  };
}

function kotAuditPayload(ctx, action, number, detail) {
  const u = (ctx && ctx.user) || {};
  return {
    userId: String(u.user_id || u.zaid || ''),
    actorId: String(u.user_id || u.zaid || ''),
    actorName: (ctx.orgUser && ctx.orgUser.display_name) || String(u.email || u.email_id || ''),
    actorRole: callerRole(ctx),
    action,
    entityType: 'kot',
    entityId: String(number || ''),
    entityName: String(detail || ''),
    oldValue: '',
    newValue: String(number || ''),
    ip: '',
    userAgent: '',
  };
}

/* ---------------- printers registry (tender-style config) ---------------- */

app.get('/api/settings/printers', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    res.status(200).json({ success: true, printers: await getPrinters(printerSettingsApp(req, orgUserContext), orgId) });
  } catch (error) {
    console.error('Error reading printers:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/settings/printers', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Printers require Admin.')) return;
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const result = await savePrinters(printerSettingsApp(req, orgUserContext), orgId, (req.body || {}).printers);
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    try {
      await logAuditLog(catalystApp, kotAuditPayload(orgUserContext, 'SETTINGS_CHANGED', '', `printers (${result.printers.length})`));
    } catch (e) { /* audit best-effort */ }
    res.status(200).json({ success: true, message: 'Printers saved.', printers: result.printers });
  } catch (error) {
    console.error('Error saving printers:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/settings/print-routing', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    res.status(200).json({ success: true, routing: await getPrintRouting(catalystApp, orgId) });
  } catch (error) {
    console.error('Error reading print routing:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.put('/api/settings/print-routing', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    if (!requirePermission(orgUserContext, res, 'manage_settings', 'Print routing requires Admin.')) return;
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const result = await savePrintRouting(catalystApp, orgId, req.body || {});
    if (result.error) return res.status(400).json({ success: false, error: result.error });
    try {
      await logAuditLog(catalystApp, kotAuditPayload(orgUserContext, 'SETTINGS_CHANGED', '', 'print-routing'));
    } catch (e) { /* audit best-effort */ }
    res.status(200).json({ success: true, message: 'Print routing saved.', routing: result.routing });
  } catch (error) {
    console.error('Error saving print routing:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- KOT log, transitions, queue, reprint ---------------- */

app.get('/api/kot', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    let log = await readKotLog(catalystApp, orgId);
    const status = String((req.query && req.query.status) || '').trim().toUpperCase();
    if (status !== '' && KOT_STATUSES.includes(status)) log = log.filter((e) => e.status === status);
    const station = String((req.query && req.query.station) || '').trim().toLowerCase();
    if (station !== '' && PRINT_STATIONS.includes(station)) log = log.filter((e) => e.station === station);
    const limit = Math.min(200, Math.max(1, parseInt((req.query && req.query.limit) || '50', 10) || 50));
    res.status(200).json({ success: true, count: log.length, data: log.slice(-limit).reverse() });
  } catch (error) {
    console.error('Error listing KOTs:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

async function kotTransition(req, res, to, action) {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    // Kitchen pass, not Admin console: anyone holding a POS role (the same
    // roles allowed on the /sales/kitchen board) may ACK/Done. manage_settings
    // would lock out Chef/Storekeeper/Cashier and break the KOT workflow.
    // Roleless (Unassigned) logins are still blocked.
    if (!['Admin', 'Manager', 'Cashier', 'Storekeeper', 'Waiter', 'Chef'].includes(callerRole(orgUserContext))) {
      return res.status(403).json({ success: false, error: 'KOT transitions require a POS role.' });
    }
    const number = String(req.params.number || '').trim();
    if (number === '') return res.status(400).json({ success: false, error: 'KOT number is required.' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const actor = await whActorEmail(req, catalystApp, orgUserContext);
    const updated = await setKotStatus(catalystApp, orgId, number, to, actor);
    if (!updated) return res.status(404).json({ success: false, error: `KOT ${number} not found.` });
    if (updated.error) return res.status(400).json({ success: false, error: updated.error });
    try {
      await logAuditLog(catalystApp, kotAuditPayload(orgUserContext, action, number, `${number} → ${to}`));
    } catch (e) { /* audit best-effort */ }
    res.status(200).json({ success: true, message: `KOT ${number} ${to}.`, kot: updated });
  } catch (error) {
    console.error('Error transitioning KOT:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
}

app.post('/api/kot/:number/ack', async (req, res) => kotTransition(req, res, 'ACKED', 'KOT_ACKED'));
app.post('/api/kot/:number/done', async (req, res) => kotTransition(req, res, 'DONE', 'KOT_DONE'));

/**
 * GET /api/print-queue — read-only pending (FIRED) chits for bridges to
 * drain. Fetching never consumes a chit: a bridge must ACK it through the
 * normal KOT transition endpoint, after which it no longer appears here.
 */
app.get('/api/print-queue', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const since = String((req.query && req.query.since) || '').trim();
    const pending = (await readKotLog(catalystApp, orgId))
      .filter((e) => e.status === 'FIRED' && (since === '' || String(e.firedAt || '') >= since));
    res.status(200).json({ success: true, count: pending.length, data: pending });
  } catch (error) {
    console.error('Error reading print queue:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** GET /api/orders/:id/print?template=bill|kot|bar|cancel — reprint payload. */
app.get('/api/orders/:id/print', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const id = String(req.params.id || '').trim();
    if (!isDigitsId(id)) return res.status(400).json({ success: false, error: 'Invalid order id.' });
    const template = String((req.query && req.query.template) || 'bill').trim().toLowerCase();
    if (!['bill', 'kot', 'bar', 'cancel'].includes(template)) {
      return res.status(400).json({ success: false, error: 'template must be bill, kot, bar or cancel.' });
    }
    const orgId = String(orgUserContext.orgUser.org_id || '');
    if (template === 'bill') {
      const receipt = await buildReceiptData(catalystApp, orgId, id);
      if (!receipt) return res.status(404).json({ success: false, error: 'Order not found.' });
      return res.status(200).json({ success: true, template, jobId: `bill-${id}-reprint`, payload: { receipt } });
    }
    const detail = await getOrderDetails(catalystApp, orgId, id);
    if (!detail) return res.status(404).json({ success: false, error: 'Order not found.' });
    const lines = (detail.items || []).map((l) => ({
      name: String(l.product_name || ''), sku: String(l.sku || ''),
      qty: Number(l.quantity) || 0, ref: String(l.product_id || ''),
    }));
    const chit = await buildCancelChit(catalystApp, orgId, lines, {
      orderId: id, reason: template === 'cancel' ? 'Reprinted cancel chit' : 'Reprinted station chit', actor: '',
    });
    if (!chit) return res.status(404).json({ success: false, error: 'No printable lines.' });
    const groups = template === 'cancel'
      ? chit.groups
      : chit.groups.filter((g) => (template === 'bar' ? g.station === 'bar' : g.station !== 'counter'));
    try {
      await logAuditLog(catalystApp, kotAuditPayload(orgUserContext, 'KOT_REPRINTED', id, `${template} reprint`));
    } catch (e) { /* audit best-effort */ }
    res.status(200).json({ success: true, template, jobId: `${template}-${id}-reprint`, payload: { ...chit, groups } });
  } catch (error) {
    console.error('Error building reprint:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/* ---------------- low-stock digest trigger ---------------- */

app.post('/api/settings/notifications/digest', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const role = callerRole(orgUserContext);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Sending the digest requires Admin or Manager.' });
    }
    const orgId = String(orgUserContext.orgUser.org_id || '');
    const prefs = await getNotificationSettings(catalystApp, orgId);
    const to = alertRecipients(prefs, 'low_stock');
    if (to.length === 0) {
      return res.status(400).json({ success: false, error: 'No digest recipients configured (Notifications → Low-stock delivery or alert email).' });
    }
    const threshold = prefs.low_stock.threshold !== '' && prefs.low_stock.threshold !== undefined
      ? Number(prefs.low_stock.threshold)
      : null;
    const products = await fetchReportProducts(catalystApp);
    const low = products.filter((p) => {
      const s = Number(p.stock) || 0;
      const rl = threshold !== null && Number.isFinite(threshold) ? threshold : (Number(p.reorder_level) || 10);
      return s <= rl;
    }).map((p) => ({ sku: String(p.sku ?? ''), name: String(p.name ?? ''), stock: Number(p.stock) || 0 }));
    if (low.length === 0) {
      return res.status(200).json({ success: true, sent: false, message: 'No low-stock items — nothing to send.', count: 0 });
    }
    const rows = low.slice(0, 100).map((p) => `<tr><td>${escHtml(p.name)}</td><td>${escHtml(p.sku)}</td><td align="right">${p.stock}</td></tr>`).join('');
    const sent = await sendSmtpMail(catalystApp, {
      to: to.join(','),
      subject: `Low-stock digest: ${low.length} item${low.length === 1 ? '' : 's'} need reorder`,
      html: `<p>${low.length} items at or below threshold:</p><table border="1" cellpadding="6" cellspacing="0"><tr><th>Product</th><th>SKU</th><th>Stock</th></tr>${rows}</table><p>CloudHub POS · Inventory digest</p>`,
      text: `Low stock (${low.length}):\n` + low.slice(0, 100).map((p) => `- ${p.name} (${p.sku}): ${p.stock}`).join('\n'),
    });
    res.status(200).json({ success: true, sent, count: low.length, to });
  } catch (error) {
    console.error('Error sending digest:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/** Recipients for stock alerts: type recipients → global alert email. */
function alertRecipients(prefs, type) {
  const out = [];
  const push = (v) => String(v ?? '').split(',').map((s) => s.trim()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)).forEach((s) => {
    if (!out.includes(s)) out.push(s);
  });
  if (prefs && prefs[type]) push(prefs[type].recipients);
  if (prefs) push(prefs.alert_email);
  return out;
}

/** Immediate low-stock email (best-effort; daily digest needs a scheduler). */
async function maybeSendLowStockAlert(catalystApp, orgId, { productName, sku, newStock, reorderLevel }) {
  try {
    const prefs = await getNotificationSettings(catalystApp, orgId);
    const cfg = prefs.low_stock;
    if (!cfg.enabled || cfg.frequency !== 'immediate') return false;
    if (!cfg.channels.includes('email')) return false;
    const threshold = cfg.threshold !== '' && cfg.threshold !== undefined
      ? Number(cfg.threshold)
      : (Number.isFinite(Number(reorderLevel)) ? Number(reorderLevel) : 10);
    if ((Number(newStock) || 0) > threshold) return false;
    const to = alertRecipients(prefs, 'low_stock');
    if (to.length === 0) return false;
    return await sendSmtpMail(catalystApp, {
      to: to.join(','),
      subject: `Low stock: ${productName} (${newStock} left)`,
      html: `<p><strong>${escHtml(productName)}</strong> (${escHtml(sku || '')}) is at <strong>${Number(newStock) || 0}</strong> units (threshold ${threshold}).</p><p>CloudHub POS · Inventory alert</p>`,
      text: `Low stock: ${productName} (${sku || ''}) at ${Number(newStock) || 0} units (threshold ${threshold}).`,
    });
  } catch (e) {
    return false;
  }
}

/** Void notification email (best-effort). */
async function maybeSendVoidNotification(catalystApp, orgId, { orderNumber, customerEmail, total }) {
  try {
    const prefs = await getNotificationSettings(catalystApp, orgId);
    if (!prefs.order_void.enabled || !prefs.order_void.channels.includes('email')) return false;
    const to = String(customerEmail ?? '').trim();
    if (to === '' || to.toLowerCase() === 'walkin@pos.system') return false;
    return await sendSmtpMail(catalystApp, {
      to,
      subject: `Order ${orderNumber} voided`,
      html: `<p>Order <strong>${escHtml(orderNumber)}</strong> (${escHtml(String(total ?? ''))}) has been voided. Contact the store for assistance.</p>`,
      text: `Order ${orderNumber} (${total}) has been voided.`,
    });
  } catch (e) {
    return false;
  }
}

/* ---------------- IntegrationService (SET-05 health) ---------------- */

/* ---------------- integration health (SET-05) ---------------- */

app.get('/api/settings/integrations', async (req, res) => {
  try {
    const catalystApp = catalyst.initialize(req);
    const orgUserContext = await getCurrentOrgUser(req, catalystApp);
    if (!orgUserContext) return res.status(401).json({ success: false, error: 'Not authenticated' });
    const role = callerRole(orgUserContext);
    if (!['Admin', 'Manager'].includes(role)) {
      return res.status(403).json({ success: false, error: 'Integration health requires Admin or Manager.' });
    }
    res.status(200).json({ success: true, integrations: await getIntegrationHealth(catalystApp, orgUserContext) });
  } catch (error) {
    console.error('Error reading integration health:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});


module.exports = app;
