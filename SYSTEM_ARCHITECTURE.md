# CloudHub POS — System Architecture

## 1. Deployment model (one customer = one Catalyst project)

CloudPartners maintains a single template; each customer receives a dedicated
Catalyst project (database, auth, SMTP, Zoho Books connection). No shared
customer database, no cross-tenant code paths. Per-organization Settings keys
(`org_<id>_setting_*`, legacy `pos_setting_*` fallback) overlay a
single-tenant core.

## 2. Runtime topology

```
Browser ──/app/*──▶ Catalyst Client (react-app/dist, Vite SPA, basename /app)
Browser ──/server/pos_backend/api/*──▶ Advanced I/O function (Express, Node 18)
Function ──▶ Data Store (ZCQL reads + table() writes) · File Store (product images)
         ──▶ Catalyst Auth (session source of truth, userManagement)
         ──▶ Zoho Books (zohoBooksService: OAuth, items, invoices, payments)
         ──▶ SMTP (nodemailer receipts/notifications)
```

`functions/pos_backend/index.js` exports the Express app (`module.exports = app`;
Catalyst invokes it — no `app.listen()`). Reads go through `safeZcql()`
(missing-table tolerant); writes through `safeUpsertConfig()` /
`datastore().table()`; interpolated values pass `sanitizeZcql()`; datetimes use
`formatCatalystDateTime()` (UTC `YYYY-MM-DD HH:mm:ss`).

## Zoho Books connection (1 October 2026)

`booksIntegration.js` owns Admin setup and OAuth; `zohoBooksService.js` handles Books API calls. The saved connection is scoped to the authenticated POS company, resolved on the server and shared with authorized sellers. Client-supplied Books tokens/organization headers are ignored. OAuth does not create users or grant POS roles.

Configurations stores company credentials, expiring OAuth state, pending organization selection, the selected connection and import status. Books credentials are optional at startup, and this flow requires no Catalyst Connection. Product import requires `Products.org_id` and fails closed when company storage is unavailable.

Checkout posts contacts, invoices and supported payments to Books while retaining local sales in Catalyst. Product import pulls Books data into Catalyst manually; changes are not pushed to the POS in real time. Local purchasing, stock adjustments, voids/returns and historical orders are outside automatic sync. See [setup and current limits](docs/zoho-books-integration.md).

## 3. Data Store tables

| Table | Purpose | Key columns |
|---|---|---|
| `Products` | Catalog + aggregate stock | sku (unique), rate, cost_price, stock, reorder_level, category links, image refs |
| `Categories` | First-class groupings | name, status, display_order |
| `Orders` / `OrderItems` / `Payments` | Sales + ledger | customer_name/email, totals, payment_mode, status |
| `Warehouses` | Stock locations (INV-04) | name, code (unique), status, is_default |
| `WarehouseStock` | Per-product-per-warehouse qty (INV-01) | warehouse_id, product_id, quantity, reorder_level |
| `StockTransfers` / `TransferItems` | Transfer workflow (INV-05) | transfer_number, source/destination, status |
| `StockMovements` | Stock audit ledger (INV-06) | item, type, qty delta, before/after, reference, actor + warehouse columns |
| `Customers` | Profiles + loyalty (CUST-05) | name, phone, email, address, loyalty_points, lifetime_points, tier |
| `CustomerActivity` | Points audit | customer_id, delta, old/new points, reason, actor |
| `Organizations` / `OrgUsers` | Onboarding + roster | org mapping, roles |
| `Configurations` | Key-value store | settings, SMTP, OAuth, legacy `crm_*` contacts |
| `Shifts` | Till registers | cashier, floats, sales, variance, status |

Invariants: `Products.stock` = `SUM(WarehouseStock.quantity)` (mirrored on all
legacy writes); every stock change writes a `StockMovements` row; every points
change writes a `CustomerActivity` row.

### Orders read model (ORD-02/04)

- `GET /api/orders` filters server-side (`status`, `customer`, `cashier`,
  `date_from`/`date_to`, `payment_status`, `payment`, `search`, `limit`).
- `GET /api/orders/:id` returns summary, customer loyalty context (via
  `matchCustomerForOrder` + `recalculateCustomerMetrics`), cashier (role via
  `user_*` config), enriched lines with pro-rata tax shares, payment legs,
  derived totals and the `StockMovements` trail.
- `normalizeOrderStatus` / `derivePaymentStatus` canonicalize display states
  (Paid, Partially Paid, Unpaid, Pending, Void, Refunded).
- Checkout captures `cashier_name`/`created_by` (best-effort columns);
  frontline roles are auto-scoped to their own sales in list and detail.

### Reporting layer (RPT-01…06)

- Filter engine: `resolveReportRange()` (9 presets + custom, UTC days) and
  `reportFilters()` (customer/cashier/warehouse/category/payment/status).
- Services: `getRevenueReport` (trend, week/month buckets, prior-window
  growth), `getProductPerformanceReport` (best/worst/profit/turnover/slow),
  `getCustomerReport` (new/returning/frequency/loyalty/trend),
  `getProfitReport` (cost-basis actuals by product/category/day),
  `getRegisterReport` (cashiers, shifts, cash/card, refunds, voids).
- Endpoints: `GET /api/reports/revenue|products|customers|profit|registers`,
  `GET /api/reports/export/csv?type=`, `GET /api/reports/export/pdf?type=`.
- PDF: hand-rolled A4 engine (Helvetica, KPIs, auto-paged tables, vector
  bars, footers, page numbers) — zero npm dependencies. Branding from the
  store profile + `report_footer`; availability via `report_pdf_enabled`.
- Access: profit is Admin/Manager-only; frontline auto-scoped to own sales;
  Storekeeper limited to products/inventory exports.

### Structured settings (SET-01…05)

- One source of truth per domain over org-scoped Configurations keys
  (legacy `store_name`/`company`/`currency`/`tax_rate` mirrors kept):
  CompanyProfileService (`company_*`), TaxService (`tax_*` + ≤20 JSON
  profiles), NotificationService (`notification_prefs`, `alert_email`),
  IntegrationService (read-only health: Books connection/org/DC, token
  expiry from the 50-min cache stamp, last-sync stamp, SMTP status).
- Endpoints: `GET|PUT /api/settings/company|tax|notifications`,
  `GET /api/settings/integrations`, logo upload/stream/remove
  (`CompanyAssets` FileStore, 5 MB). Writes are Admin-only (audited as
  SETTINGS_CHANGED); reads allow Manager.
- Tax math: `posNormalizeLine(raw, {mode, round})` — exclusive default is
  byte-identical to legacy; inclusive extracts the tax portion with the
  sticker total unchanged; `round=false` defers rounding to the final
  total. Frontend `utils/tax` mirrors both functions exactly (proven by
  differential test); POS, checkout, receipts and order detail share them.
  Unset line rates inherit the default, 0 stays exempt.
- Notifications: preferences gate best-effort SMTP sends (immediate
  low-stock on deductions, void emails, Books-sync failure alerts).
  Daily digest is stored but needs scheduler infrastructure; an on-demand
  digest sender (`POST /api/settings/notifications/digest`) covers manual runs.
- Returns: `POST /api/orders/:id/return` validates against ordered-minus-
  returned (derived from RETURN movements, no schema change), restocks with
  mirrors, posts negative refund legs, flips full returns to Refunded and
  reverses loyalty points. `GET /api/stock-movements` serves the ledger page.
- Loyalty campaigns persist as one org-scoped Configurations JSON document;
  redemption deducts usable balance and issues voucher codes for manual POS
  discounts. Tender methods (`payment_methods`) are enforced in POS and
  checkout alike.
- PDFs embed raster logos natively (PNG decoded via zlib unfilter to RGB;
  JPEG via SOF parse + DCT passthrough; 400 KB cap, palette/interlaced
  PNGs fall back to text branding).

### Administration & audit (USR-01…05)

- Identity stays in Catalyst Auth (sessions, passwords, hosted login);
  the POS roster (`Configurations` `user_*` JSON + `OrgUsers`) carries role,
  lifecycle state and contact fields. `isAccountDeactivated()` folds
  suspension into `getCurrentOrgUser()` (returns unauthenticated).
- RBAC: `roleCan()` matrix (sell, manage_products, adjust_stock,
  manage_inventory, view_reports, manage_users, delete_users,
  manage_settings, export_audit) plus `requireAuth` / `requireRole` /
  `requirePermission` / `requireOwnership` handler guards. Fixed gaps:
  Storekeeper role assignment, role checks on user delete/role change,
  settings/SMTP/master-key writes, catalog writes, legacy stock adjust,
  checkout sell check, dashboard aggregates, shifts, Books sync.
- Lifecycle: `POST /api/admin/users` (invite + best-effort Catalyst
  `registerUser`), `PUT`, `DELETE` (Admin, self + last-Admin guards;
  removes roster JSON, `OrgUsers`, and the Catalyst Auth project user using
  its `user_id`, with an honest best-effort fallback message),
  `activate` / `deactivate` (Admin, last-Admin guard),
  `reset-password` (re-invite), `change-role` (Manager cannot touch Admin).
- Audit: `auditMiddleware` (registered post-CORS) appends a `UserAuditLog`
  row after every successful mutating call — actor, role, action
  (`auditActionFor`), entity (`auditEntityFor`), sanitized new value, IP,
  user agent. Fail-open; reads/health/auth/export-GETs skipped (exports log
  explicitly as `REPORT_EXPORTED`). `GET /api/admin/audit` filters
  (date/actor/action/entity/search) + metrics + retention sweep; CSV/PDF
  exports reuse the report engines. Admin-only throughout.

## 4. Backend service layer (`index.js` inline)

- Auth: `getCurrentOrgUser()` (Catalyst session → OrgUsers → virtual fallback)
- Config: `getLoyaltyConfig()`, `getBackordersAllowed()` (org-scoped Settings)
- Loyalty: `calculateLoyaltyPoints`, `calculateCustomerTier`,
  `calculateLifetimeValue`, `calculatePurchaseFrequency`,
  `recalculateCustomerMetrics`, `accrueLoyaltyForOrder` (checkout hook),
  `matchCustomerForOrder`, `backfillCustomers` (legacy migration)
- Warehouse: `ensureDefaultWarehouse`, `backfillWarehouseStock`,
  `syncProductStock`, `mirrorDeltaToDefaultWarehouse`, `loadTransfer`
- Mail/receipts: `sendSmtpMail`, `buildReceiptData`

RBAC matrix (server-enforced): Admin (all + deletes), Manager (manage +
approve + adjust), Storekeeper (warehouse/transfer ops, read-only customers),
Cashier (sell + customer view/create).

## 5. Frontend (`react-app/src`)

- Shell: `App.tsx` routes (basename `/app`) → `ProtectedRoute` → `MainLayout`
  (rail + context panel from `components/layout/navigation.ts`, breadcrumbs).
- Pages: Dashboard, Pos (+ Kitchen board via `WorkspaceView` router),
  Products, Inventory (+ Warehouses, Transfers via `WorkspaceView` router),
  Customers (+ Loyalty, Rewards, Membership views), Orders (bill/KOT
  reprint in the detail drawer), Reports, Users, Settings (+ Printers
  tab: registry + station routing).
- Services (all via `services/api.ts` → `apiFetch`): `customerService`
  (directory + loyalty, 503-fallback to legacy `/contacts`),
  `inventoryService` (warehouses/stock/transfers), `productService`,
  `orderService`, `dashboardService`, `settingsService`, `authService`,
  `printService` (printers, routing, KOT log/ack/done, queue, reprint).
- Print templates (`utils/print.ts`): 80mm bill/KOT/cancel documents plus
  the popup dispatcher (blocked-popup messaging); QZ/bridge agents reuse
  the same job payloads.
- Design: Muster language — Inter/Sora, glass cards, `ch-*` tokens, shared
  Table/Modal/FilterBar/StatusBadge/StatCard/SearchBar components.
- Layout rules: cards carry no outer margin — stacked rhythm comes from
  `.ch-card-body` gaps plus `.ch-card + .ch-grid-stats` top margin; shared
  toolbar classes (`.orders-dates`) live in `styles/ui.css` only, never in
  page stylesheets, so filter rows render identically on every page.

## 6. CI/CD

`build.yml` validates (no deploy); `deploy-dev.yml` ships Development
(functions then client); Production via console promotion. See
`docs/CI_CD_Guide.md` and `docs/CloudHub_POS_DevOps_Operations_Manual.md`.

## 7. Print routing (restaurant / industrial)

One order fans out to 2–3 printers: counter **bill** (prices, tax, totals,
logo) plus station chits such as **KOT – kitchen** and **bar** (items only,
no prices), plus cancel/void chits. Design rule: **backend decides routing,
terminal executes printing.**

### 7.1 Why printing starts at the terminal

The `pos_backend` function runs in Zoho's cloud and cannot reach a
restaurant's LAN/USB printers. So the cloud never pushes bytes to a printer.
On `POST /api/orders` the backend returns the order **plus a `printJobs`
list** (`printerId`, template `bill|kot|bar|cancel`, copies); a dispatcher
running on the POS terminal (browser or local agent) delivers each job to
its printer. Cloud-connected printers (vendor ePrint/cloud APIs) are the
only exception — the function can call those directly.

### 7.2 Transport options

| Option | How | Pros | Cons | Fit |
|---|---|---|---|---|
| Browser print (`window.print` + `@media print` CSS) | One template per print dialog via OS driver | Zero installs, any USB printer | Manual dialog per printer, no silent multi-print | MVP: bill + manual KOT reprint |
| QZ Tray (local agent on terminal) | Silent raw/ESC/POS to USB + LAN printers, status back | Auto-print bill+KOT on order create, copies, drawer kick | Java agent installed per terminal | Recommended restaurant default |
| Pi/PC print bridge (small Node service) | Polls backend for pending jobs (or websocket), prints ESC/POS | Survives browser closed, offline queue, 2–3 printers | Extra box/service to operate | Industrial / multi-counter |
| Vendor cloud print | Function calls printer-cloud API | No local agent, works from Catalyst directly | Vendor lock-in, internet-dependent, per-page cost | Optional where hardware supports it |

Rollout: Phase 1 shipped — browser-print bill + per-KOT buttons from the
checkout payload, Orders reprint, kitchen Ack/Done board, printers +
routing in Settings. Phase 2 — QZ Tray or Pi bridge for silent auto-print
on create/void/return (same payloads, no backend changes).

### 7.3 Data + endpoints (implemented, incl. terminal tier)

Browser-print execution is live: POS prints per-KOT buttons from the
checkout payload, Orders reprints any template, and `/sales/kitchen`
runs the Ack/Done board; printers + routing are managed in Settings.

- `Configurations`: `org_<id>_setting_printers` (JSON: id, name, station
  `counter|kitchen|bar`, width `58|80mm`, transport, address, active) and
  `org_<id>_setting_print_routing` (category → station map; category-name
  rules are case-insensitive substring matches, with an exact or longest
  match winning; unmapped categories fall back to the selected default
  station, initially counter).
- Catalog: `Categories.station` (or `Products` override) drives the split —
  Food → kitchen KOT, Beverages → bar, everything → counter bill.
- Order flow: `POST /api/orders` validates + writes rows, then builds
  `printJobs` (bill ×1 counter; one KOT per station with lines; KOT numbers
  `KOT-<day-seq>`); void/return appends `cancel` chits. `GET
  /api/orders/:id/print?template=` re-renders any chit for reprint; every
  print/void is a `StockMovements`-style audit entry.
- Health: printer online/offline joins the Integrations card
  (`GET /api/settings/integrations`); failed jobs sit in a pending queue
  drained by the bridge, reprintable from Orders.

### 7.4 Templates

- **Bill** (80mm counter): store header + logo, lines with rates, discounts,
  tax split (shared `posNormalizeLine` math), tender legs, KOT refs, footer.
- **KOT/bar** (58/80mm kitchen): big token/table number, time, station
  lines with qty + modifiers, no prices; void chits in inverse video with
  reason + actor.
- Kitchen hardware: heat-tolerant 80mm with buzzer; cash-drawer kick codes
  ride on the bill job only.

## 8. Code-only backlog (no Catalyst Console changes required)

Everything below ships by code deploy alone — no new tables, buckets, env
vars, or permissions. Status as of the Stratus logo migration.

### 8.1 Shipped (verify on Development, then keep)

- ZCQL 300-row cap: all `LIMIT 500/1000/2000` → `LIMIT 300` (platform
  rejects larger; was blanking company reads and 503ing customers).
- `fetchAllZcql()` ROWID-cursor pager wired into customers, report
  products, warehouse stock, and backfills (time-ordered histories keep
  the 300 cap by design).
- Company reader: `company_*`-first with legacy + any-prefix adoption.
- Settings-save TDZ crash (`POST /api/config/settings` used its session
  before resolving it) and orders-slice `limit: 500` cap.
- Company logo + product images on Stratus (`company/<org>/logo.<ext>`,
  `products/<rowId>.<ext>`, `overwrite: true`); FileStore code removed.
- Session resolution + onboarding tolerate both `Organizations` shapes
  (template columns and the project's `organization_name/status` shape).
- KOT/print routing backend (§7/KOT-01…10): printers registry,
  category→station routing, `print_jobs` + `kot_numbers` in checkout,
  cancel chits in void/return, reprint, KOT states + print queue, audit;
  race-guarded numbering and per-day log keys with legacy merge.
- Diagnostics cleaned; `[BUILD]` cold-start stamp; `[CUSTOMERS_503]` +
  `[LOGO]`/`[PRODUCT-IMG]` kept as permanent logging.
- `node:test` suites (`npm test` in `functions/pos_backend`, 19 green)
  with LIMIT + key-symmetry regression guards.
- Settings UX: single-section view, 12-tab sidebar, full-width 3-up
  compact cards, inline-editable Business company card.

### 8.2 Next (ordered)

1. **KOT terminal dispatcher (frontend/agent)** — backend plans
   `printJobs`; execution (browser/QZ/bridge) remains. Biggest value.
2. **Verify on Development** — company save→reload, customers 200,
   logo + product image round-trips, one full KOT cycle, `npm test`.
3. **Pagination for time-ordered histories** — only if tables exceed
   300 rows *and* full history is needed (reports aggregate server-side).
4. **Test growth** — tax parity vs frontend `utils/tax`, RBAC matrix
   probes, report smoke fixtures.

### 8.3 Needs Console + code together (not code-only)

- Missing tables (`OrgUsers`), `Organizations` column alignment,
  bucket-per-environment + `STRATUS_ASSETS_BUCKET`, SMTP/Books credentials.

### 7.5 KOT requirements (Kitchen Order Ticket)

| Req | Requirement | Rule |
|---|---|---|
| KOT-01 | Auto-generate on order create | Every order with kitchen-station lines emits ≥1 KOT; number `KOT-<YYYYMMDD>-<seq>`, unique per day per deployment |
| KOT-02 | Station split | Lines group by `Categories.station`; one chit per station printer (kitchen, bar); counter-only orders emit bill only |
| KOT-03 | Chit content | Token/order no., table, timestamp, cashier, item + qty + modifiers/notes; **no prices, no tax, no totals** |
| KOT-04 | Add-on items | Items added after first fire print as `KOT-…-A<n>` addendum with **only the new lines**, linked to the parent KOT |
| KOT-05 | Cancel / void chit | Voided line or order emits a cancel chit (inverse/highlight) with reason + actor; kitchen never guesses deletions |
| KOT-06 | Reprint | Any KOT reprintable from Orders (`GET /api/orders/:id/print?template=kot`); each reprint is audit-logged |
| KOT-07 | Running table ticket | Same table + open order appends to one running ticket; bill prints only on settle |
| KOT-08 | Fulfilment state | `FIRED → ACKED → DONE` per KOT (button or KDS confirm); POS shows pending-KOT age per table |
| KOT-09 | Offline resilience | Failed jobs queue per terminal and auto-retry; nothing is lost if kitchen printer is down |
| KOT-10 | Audit | Every fire/addendum/cancel/reprint writes who, when, which printer, and which lines |
