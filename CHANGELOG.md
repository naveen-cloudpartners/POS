# CloudHub POS — Changelog

## Unreleased

### 2026-10-01 - Purchasing access and error handling

- Switched purchasing table operations to server SDK scope after authentication and existing role checks, addressing Catalyst table privilege failures for authorized POS staff.
- Preserved successfully loaded purchasing sections when another section fails; kept validation errors visible inside open dialogs.
- Hid supplier creation/approval controls from Storekeeper and skipped its payables requests.
- Included live Books item/tax fields in sale product lookup so checkout can use the saved accounting mappings.

Validation: 81 backend and 8 frontend regression tests passed, with TypeScript and scoped ESLint checks passing. Changes are local; deployed Purchasing and live Books posting require verification.

### 2026-10-01 - Company Books setup and integration

- Added Admin integration setup for Client ID/Secret, region, callback URL, authorization, organization selection, connection testing, product import and disconnect.
- Kept OAuth tokens on the server and bound authorization state to the initiating Admin/company. Removed browser token exposure, hardcoded credential defaults and global account adoption.
- Made Books credentials optional at backend startup; the OAuth flow does not require a Catalyst Connection.
- Corrected Books organization IDs during product import; added pagination, company-scoped matching and zero-stock preservation.
- Used live product/tax mappings and discounted net rates during checkout; recorded supported split payment legs and reported incomplete posting.
- Documented manual Books-to-POS product import and the absence of full two-way sync, historical backfill and automatic void/return reversal.

Validation: 78 backend tests and 6 receipt-printing tests passed; TypeScript, ESLint (no errors) and the Vite production build passed. Existing lint/bundle warnings remain. Live Zoho authorization and accounting verification are pending; this checkpoint is local, not deployed.

### 2026-09-30 - Shared Purchasing-style UI

- Updated `react-app/src/styles/workspace-theme.css` so shared summary cards use consistent spacing, larger values, stable icon tracks, and Purchasing-style labels.
- Aligned Products and Customers summary widgets with the shared cards, retaining the selected product filter outline.
- Standardized empty-state icons, text spacing, table hover treatment, and keyboard focus outlines.
- Added narrow-screen summary grid rules; retained the compact POS layout and existing page actions.
- Frontend styling only in this update; no API or business-logic changes.

Validation: TypeScript project check and Vite production build passed. Vite reported its large-chunk warning. Authenticated visual checks across all pages and viewport sizes remain pending; this update has not been deployed.

### UI Polish: Primary rail and Purchasing workspace

Changed:

- Primary workspace rail is fixed with all main modules visible at once; the old top CloudHub home mark is removed.
- Active rail item styling now uses a slightly larger selected border box so the current module is clearer without changing routes or behavior.
- Purchasing workspace now has dedicated page layouts for Purchase Orders, Vendors, Receive Stock, Vendor Bills, and Payments & Credits instead of repeated in-page navigation.

Notes:

- CSS-only adjustment for the latest active rail border tweak; rebuild and redeploy the client to see it live.

### Storage, KOT, Pagination, Tests (all code-only, no Console changes)

Added:

- Product images on Stratus (`products/<rowId>.<ext>`, `overwrite: true`) with the same dual-read adapter as the logo; legacy FileStore IDs retired with the logo paths (FileStore code fully removed)
- KOT/print routing backend (§7/KOT-01…10): printers registry (`GET|PUT /api/settings/printers`), category→station routing (`GET|PUT /api/settings/print-routing`), `print_jobs` + `kot_numbers` in checkout responses, cancel chits in void/return responses, reprint (`GET /api/orders/:id/print?template=`), KOT states (`GET /api/kot`, `POST /api/kot/:number/ack|done`, `GET /api/print-queue`), audited (`KOT_ACKED/DONE/REPRINTED`)
- ZCQL pagination helper (`fetchAllZcql`, ROWID-cursor, 300/page): customers, report products, warehouse stock, backfills — same rows while small, pages transparently when large
- `node:test` suites (`npm test` in `functions/pos_backend`): checkout math, loyalty, order statuses, storage keys, KOT routing, plus regression guards (no `LIMIT > 300`, company write/read key symmetry) — 19 tests green
- `[BUILD]` cold-start stamp so deploys are provable from function logs

Fixed:

- Settings-save TDZ crash (`POST /api/config/settings` used its session before resolving it — every generic settings save 500'd)
- Orders report/PDF + `?limit=` over 300 (sliced through the same 300-row cap via `fetchOrdersSlice`)
- Session resolution against the project `Organizations` shape (`organization_name/status` fallback alongside the template columns)
- Onboarding auto-provision tries the template `Organizations` shape, then the project shape, before the safe `org_default` fallback

Changed:

- Temporary incident diagnostics removed (`[AUTH_ORG]`, `[READ_SETTINGS]`, `[COMPANY_API]`, `[COMPANY_SAVE]`, `[AUTH-DIAG]`); `[CUSTOMERS_503]` + `[LOGO]`/`[PRODUCT-IMG]` kept as permanent logging

Notes:

- Cashiers can read printers/routing/KOT (terminals print); writes stay Admin-only
- Time-ordered histories (orders/movements/audit) keep the 300 cap by design; collections page via `fetchAllZcql`

### KOT terminal tier (browser-print execution + management UI)

Added:

- POS receipt modal prints one button per fired KOT (payloads ride the checkout response — zero extra fetches); bill print unchanged
- Orders detail drawer reprints bill/KOT/cancel chits via `GET /api/orders/:id/print?template=`
- Kitchen board (`/sales/kitchen`, POS sidebar): live FIRED/ACKED/DONE tickets, station + status filters, Ack/Done transitions, 20s quiet polling
- Printers + station-routing management in Settings (new Printers tab): printer registry (station/width/transport/address/enabled) and category-name routing rules; writes stay Admin-only, reads open to counter/kitchen roles
- Shared client layer: `services/printService.ts` (all print/KOT APIs) + `utils/print.ts` (80mm bill/KOT/cancel templates, popup dispatcher with blocked-popup messaging) for the future QZ/bridge tier
- Tests: RBAC matrix, audit-action routing, report-range suites (37/37 green)

### KOT hardening follow-up

Fixed:

- KOT number race guard: allocation skips numbers already present in the recent log (concurrent checkouts), time-suffixed fallback preserved
- Per-day KOT log keys (`kot_log_<YYYYMMDD>`, 7-day + legacy merge on read) so no single `Configurations` value grows without bound; transitions locate entries across midnight
- Removed the stale TASK-9 label on the logo upload diagnostic

Tests:

- `kotDayStamp` / `kotTransitionAllowed` / `kotLogKey` suites added (21/21 green)

### UI Fix: Reports filter/stat card collision

Fixed:

- Filter card sat flush against the KPI stat cards below it (`.ch-card` carries no outer margin and nothing separated stacked sections). Added `.ch-card + .ch-grid-stats { margin-top: 20px }` in shared `styles/ui.css`, matching the existing 20px rhythm.
- `.orders-dates` (filter-row inputs) was defined only in `Orders.css` but used by Orders, Reports, Movements and Audit views. Moved to shared `styles/ui.css` with wrap/width guards so inputs can't blow out the toolbar on any page. Removed the `Orders.css` duplicate (identical values — Order page renders pixel-identical).

Notes:

- CSS-only fix; no markup, colors, glass, spacing scale, or behavior changed. Rebuild + redeploy the client (`catalyst deploy --only client`) and hard-refresh to see it live.

### Gap Closure: Returns, Ledger, Campaigns, Tender, PDF Logo, Currency

Added:

- Returns/RMA flow (`POST /api/orders/:id/return`: line validation, exact pro-rata refunds, restock + RETURN ledger entries, negative refund legs, Refunded status, loyalty reversal, customer email) + Returns page with recent-returns feed
- Stock movement ledger (`GET /api/stock-movements` with filters + summary) + Movements page in the Inventory workspace
- Reward campaigns (create/toggle via settings-backed store) + redeem-to-voucher flow + Rewards page management
- Payment methods config (Admin toggles; POS + checkout enforce the enabled set; honest manual-tender-only gateway note)
- Low-stock digest trigger (on-demand email via SMTP; scheduled delivery still needs scheduler infra)
- PDF raster logos (PNG gray/RGB/RGBA + JPEG embedded natively, verified by codec + document tests)
- Multi-currency display (store currency drives all `currency()` output; per-call override retained)

Notes:

- Refund endpoints beyond order returns (standalone refunds without a sale) remain future work, as do redemption campaigns settled automatically at POS (vouchers apply as manual discounts today).

### Settings Module Completion (SET-01…05 ✅ — Settings 100%)

Added:

- Company Profile Management (`GET|PUT /api/settings/company`: name, legal name, full address, phone/email/website, registration + tax numbers; legacy mirrors keep receipts/PDFs working)
- Logo Upload (FileStore `CompanyAssets`, 5 MB PNG/JPG/WebP, preview/replace/remove; embedded in emailed receipts; PDFs keep text branding — no raster support in the zero-dependency engine)
- Business Contact Information (receipt header + Business profile view extended)
- Tax Inclusive/Exclusive Modes (settings-driven; inclusive extracts the tax portion with unchanged totals; per-line rounding toggle; shared client/server formulas proven identical by differential test)
- Tax Profiles (≤20 named presets; product form Use-default/Custom/Exempt selector; default-rate inheritance for unset line rates; Taxes tab preview calculator + coverage)
- Notification Preferences (11 types × channels, low-stock threshold/recipients/frequency, alert email; Notifications tab grouped cards)
- Low Stock Alert Settings (immediate emails on deductions via SMTP; daily digest stored, pending scheduler infrastructure)
- Order Notification Settings (void emails to customers; confirmation/receipt/status/refund flags stored and honored where flows exist)
- Integration Health Monitoring (token expiry, last sync time/result stamped by `/sync/books`, SMTP status on the Integrations tab; Books-sync failure alerts)
- Settings Audit Logging (new `/api/settings/*` paths map to SETTINGS_CHANGED; role gates: Admin writes, Manager reads)

Notes:

- Daily-digest delivery needs scheduler infrastructure (preference stored, delivery pending) — same standing item as scheduled reports.
- PDF raster logos are now embedded natively (PNG gray/RGB/RGBA + JPEG; see Gap Closure entry above) — the earlier text-branding limitation no longer applies.

### Administration Module Completion (USR-01…05 ✅ — User & Role Management 100%)

Added:

- User Invitations (Admin/Manager; Catalyst `registerUser` best-effort + roster entry + audit; toggle via Settings)
- Role Assignment (Admin full; Manager blocked from Admin grant/modify; Storekeeper assignable — legacy 400 fixed)
- User Activation/Deactivation (Admin-only; self + last-active-Admin guards; deactivated accounts resolve to unauthenticated)
- User Deletion (Admin-only; self + last-Admin guards; order-history-style preservation N/A — roster only)
- Password Reset (Admin-only re-invite; passwords remain in Catalyst Auth with hosted self-service)
- RBAC Hardening (`roleCan` matrix + `requireAuth`/`requireRole`/`requirePermission`/`requireOwnership` helpers; gates added to settings, SMTP, master keys, catalog, stock, checkout sell check, dashboard, shifts, sync, contacts; legacy user endpoints hardened)
- User Audit Logs (`UserAuditLog` table; auto-middleware logs every successful mutating call with actor/action/entity/old/new/IP/user-agent; rich entries for role and status changes)
- Audit Analytics (totals, created/deleted/deactivated, role changes, orders, exports, by-action breakdown)
- Audit Export (filtered CSV + branded PDF, Admin-only, Settings toggle)
- Administration Settings (audit retention days with read-time sweep, audit export toggle, invitations toggle)

Notes:

- Deactivation suspends POS API access immediately; the Catalyst session itself persists until expiry (platform-owned).
- Self-service password reset and password-policy enforcement stay in Catalyst Auth (no local credentials exist to govern).

### Reports Module Completion (RPT-01…06 ✅ — Reports & Analytics 100%)

Added:

- Date Range Reporting (Today, Yesterday, Last 7/30 Days, This Week/Month, Last Month, This Year, Custom, All Time) with automatic recalculation of every card
- Custom Report Filters (customer, cashier with autocomplete, warehouse, category, payment, status) on a global filter bar
- Revenue Analytics (trend, by day/week/month, growth vs prior window, payment split, top customers/cashiers)
- Profit Analytics (cost-basis actuals: revenue, COGS, gross profit, margin with line coverage, by product/category/day)
- Customer Analytics (new/returning/frequency, loyalty distribution, VIP, revenue trend)
- Cashier Analytics (per-cashier revenue/cash/card, shifts with variance, voids & refunds)
- PDF Export Framework (zero-dependency A4 engine: branded header, KPIs, auto-paged tables, bar charts, footer, page numbers; per-section buttons; Settings toggle)
- Advanced CSV Export (server-built, filter-honoring: revenue, products, customers, profit, registers, orders, inventory)
- Report Branding (company name from store profile, configurable footer) and Reporting Settings (default range, PDF toggle)
- Role-scoped reporting (profit managers-only; frontline auto-scoped to own sales; storekeeper inventory-only)

Notes:

- Scheduled-report delivery is future work (no scheduler infrastructure on Catalyst yet); the range/PDF/CSV/branding foundation is in place for it.
- PDF raster logos are not embedded (no logo upload exists in Settings); branding is company-name text + custom footer.

### Order Management Completed (ORD-01…05 ✅ — Orders 100%)

Added:

- Server-side order filtering (`status`, `customer`, `cashier`, `date_from`/`date_to`, `payment_status`, `payment`, `search`, `limit`)
- Full order detail endpoint (`GET /api/orders/:id`): enriched lines (product/sku/discount/pro-rata tax/line total), payment breakdown with split legs, derived payment status, customer loyalty context, cashier attribution + role, inventory-movement trail
- Order repository layer (`getOrderHistory`, `getOrderDetails`, `getOrdersByCustomer`, `getOrdersByCashier`, `searchOrders`) plus canonical status mapping (`normalizeOrderStatus`, `derivePaymentStatus`)
- Cashier attribution at checkout (`cashier_name`/`created_by`, best-effort columns) with frontline auto-scoping (own sales; legacy unattributed rows stay visible)
- Orders UI: six-section detail drawer (summary, customer, lines, payments, totals, inventory), status/payment/date-preset/customer/cashier filters with autocomplete, CSV export, Admin void action
- Reports: orders-by-status, top cashiers, voids & refunds sections; Dashboard: pending orders + top cashier widgets (append-only)

### Customer Loyalty Foundation Completed (CUST-05 ✅ — Customer Management 100%)

Added:

- Loyalty Points Engine (`calculateLoyaltyPoints`, 1 pt per LKR 100, config-driven via `loyalty_points_per_currency`)
- Customer Tier System (`calculateCustomerTier`: New / Active / Loyal / VIP from `lifetime_points` against configurable thresholds)
- Customer service layer (`calculateLifetimeValue`, `calculatePurchaseFrequency`, `recalculateCustomerMetrics`, shared by checkout/adjust/detail flows)
- Loyalty APIs: `GET /api/customers`, `GET /api/customers/:id`, `POST /api/customers`, `PUT /api/customers/:id`, `DELETE /api/customers/:id`, `GET /api/customers/:id/loyalty`, `POST /api/customers/:id/adjust-points`
- Loyalty Analytics: loyalty ranking, tier distribution, issued/redeemed totals, VIP reports, customer growth, CSV export
- Customer Metrics Enhancements: profile loyalty block (balances, tier, frequency, LTV), Points + Last Activity columns, AOV/retention widgets, address field
- Customer Reporting: Reports loyalty section (tier table, VIP + LTV summary, growth, Customers CSV)
- Settings Integration: Customer Loyalty card (enable, earn rate, tier thresholds, manual adjustments, no-email customers)
- Order Integration: checkout auto-accrual with find-or-create, audit entries in `CustomerActivity`
- Data: `Customers` table (backfilled once from legacy `crm_*` contacts; `/api/contacts` unchanged) + `CustomerActivity` audit table

### Inventory Phase 2 Completed (INV-01/04/05/08 ✅ — Inventory 100%)

Added:

- Multi-warehouse support (`Warehouses` table + CRUD, default warehouse, 409-on-stock delete)
- Per-warehouse inventory (`WarehouseStock`, per-warehouse view/filter/adjust, `Products.stock` = aggregate)
- Transfer workflow (`StockTransfers`/`TransferItems`, Draft → Pending → Approved → Completed/Cancelled, dual ledger entries)
- Backorder policy (`allow_backorders` setting, `Backordered` status, 400 guards)
- Warehouse valuation + transfer history in Reports; warehouse widgets on Dashboard

## Notes

- New tables to provision per deployment (Catalyst Console → Data Store): `Warehouses`, `WarehouseStock`, `StockTransfers`, `TransferItems`, `Customers`, `CustomerActivity`. Optional: `warehouse_id` / `from_warehouse_id` / `to_warehouse_id` columns on `StockMovements` (code falls back without them).
- All new APIs return `503` with the missing table name when unprovisioned; legacy callers (`/api/contacts`, aggregate stock flows) are unaffected.
