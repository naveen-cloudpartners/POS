# NewPOS — CloudHub POS (Zoho Catalyst)

A point-of-sale web app: a React shop page + a Node/Express backend,
both hosted on Zoho Catalyst. Think of it like this:
Catalyst is the hosting (like cPanel), `react-app/dist` is the
`public_html` folder, and `functions/pos_backend` is the Node backend.

## What's inside

| Folder | What it is |
|---|---|
| `react-app/` | Frontend: React 19 + TypeScript + Vite. Builds into `react-app/dist/`, served at `/app`. |
| `react-app/src/pages/` | Screens: Landing, Login, Register, Dashboard, Pos, Products, Inventory, Customers, Orders, Reports, Users, Settings + WorkspaceView (Categories, Warehouses, Transfers, Adjustments, Payments, Invoices, Returns, Kitchen, Loyalty, Rewards, Roles, Activity, Audit, Business, Automation). |
| `react-app/src/components/layout/navigation.ts` | Single source of truth for navigation: 9 SRS-ordered workspaces (Dashboard, POS, Products, Inventory, Customers, Orders, Reports, Administration, Settings). Rail + context panel + breadcrumbs all render from it. Routes live in `App.tsx` and are unchanged by nav edits. |
| `react-app/src/services/` | One file per topic that talks to the backend: `authService`, `productService`, `orderService`, `userService` (roster + admin lifecycle + audit), `settingsService`, `customerService` (profiles + loyalty), `inventoryService` (warehouses, stock, transfers), `dashboardService`, `reportService`, `printService` (printers, routing, KOT, reprint) + `utils/print.ts` bill/KOT/cancel templates (all through `api.ts`). |
| `react-app/src/styles/muster-type.css` | Scoped Muster layer (loaded last): Inter interface + Sora headings, 16/18/20 icons, 8/12/16 radii, table type scale, 48px touch targets. Fonts/sizes/corners/tables only — no color or layout changes. |
| `functions/pos_backend/` | Backend: Express app (Node 18, Advanced I/O). Ends with `module.exports = app` — Catalyst loads this, it does not listen on a port itself. |
| `catalyst.json` | Deploy map: which function folder ships, which folder is the website. Already correct — don't change without reason. |
| `docs/CloudHub_POS_Project_Status.md` | Full status report: SRS gap analysis, risks, roadmap. §4.7 maps the old nav tree; current nav lives in `navigation.ts`. |
| `.github/workflows/` | CI/CD: `build.yml` validates every push/PR (no deploy); `deploy-dev.yml` ships `main` to Development. |
| `scripts/deploy.sh` | Local deploy mirroring CI: build → syntax check → `catalyst deploy` (`all`/`functions`/`client`). |
| `docs/CI_CD_Guide.md` | Pipeline architecture, secrets setup, dev/production workflows, roadmap. |

## Zoho Books integration

Admin **Settings → Integrations** provides OAuth credential setup, a copyable callback URL, authorization, Books organization selection, connection testing, product import and disconnect. No extra Catalyst Connection is needed; the backend starts without Books credentials. Deploy both backend and client before using the new flow.

Catalyst retains POS users, roles, settings and operational records. New seller checkouts attempt Books customer/invoice/payment posting using their company's server-side connection. Books product changes appear only after manual import. Purchasing, local stock adjustments, voids/returns and historical sales are not automatically synchronized.

See [Books setup and Catalyst requirements](docs/zoho-books-integration.md). The implementation passed local build/type checks and mocked integration tests; live authorization remains pending.

## Shared workspace styling

`react-app/src/styles/workspace-theme.css` is imported after the base styles in `src/main.tsx` and aligns the authenticated workspace with the Purchasing UI. It covers shared cards, summary widgets, filters, tables, empty states, and responsive spacing. Page-owned layouts, including the compact POS terminal, remain in their page stylesheets.

The 30 Sep 2026 styling update passed TypeScript and the Vite production build. Visual checks across authenticated pages remain pending. See `CHANGELOG.md` and `docs/POS_Function_Checklist.md` for the checkpoint and review tasks.

## Data model (Catalyst Data Store)

- Catalog table is **`Products`** (renamed from `Items`). All ZCQL + `table()` calls use `Products`. API routes stay `/api/items*` for backward compatibility.
- `StockMovements` ledger keeps `item_rowid` / `item_name` column names (history-safe), plus `warehouse_id` / `from_warehouse_id` / `to_warehouse_id` for transfer audit.
- Inventory Phase 2: `Warehouses`, `WarehouseStock` (per-product-per-warehouse), `StockTransfers` + `TransferItems`. `Products.stock` = `SUM(WarehouseStock.quantity)`; legacy writes mirror into the default warehouse.
- Customer Loyalty: `Customers` (profile + `loyalty_points`, `lifetime_points`, `tier`, `joined_at`, `last_activity_at`) + `CustomerActivity` audit log. Legacy `crm_*` contacts in `Configurations` are backfilled once on first read; `/api/contacts` is unchanged.
- Administration: team roster lives in `Configurations` `user_*` JSON (+ `OrgUsers` rows) with lifecycle state (active/inactive) — Catalyst Auth keeps owning identity/sessions/passwords. `UserAuditLog` records every successful mutating API call (actor, action, entity, old/new values, IP, user agent) via auto-middleware; `GET /api/admin/audit` + CSV/PDF exports are Admin-only. Roles: Admin, Manager, Cashier, Storekeeper built-in (Waiter/Chef retained); deactivated accounts resolve to unauthenticated.
- Stock states share one definition (`utils/format.ts`): healthy = `stock > reorder_level AND stock > 0`, low = `0 < stock <= reorder_level`, out = `stock <= 0`, fallback `reorder_level = 10`. Warehouse rows add `Backordered` when quantity < 0.

## What the backend can do

- Health check: `GET /api/health`
- Setup: `GET /api/setup/status` (requires `Products` table)
- Auth: Catalyst login session (`/api/auth/me`); company-scoped Books OAuth (`/api/auth/url`, `/api/auth/callback`) and Admin-only disconnect. Legacy global master credential save/seed routes are retired.
- Users: roster list, invite (creates Catalyst user best-effort + roster entry), update, activate/deactivate (last-admin + self guards), delete (Admin-only, last-admin + self guards), password re-invite, change role (Manager cannot touch Admins; Storekeeper now assignable), plus legacy `/api/users/*` (hardened: delete Admin-only, Storekeeper role fixed)
- Audit: auto-logged trail (`GET /api/admin/audit` with date/actor/action/entity/search filters + metrics), filtered CSV/PDF exports, retention sweep, Administration settings (`admin_audit_retention_days`, `admin_audit_export`, `admin_allow_invitations`)
- Shop data: products list/add/edit/delete, stock adjust, contacts list/add (legacy `/api/contacts` untouched)
- Customers + loyalty: CRUD (`GET|POST /api/customers`, `GET|PUT|DELETE /api/customers/:id`), loyalty balances (`GET /api/customers/:id/loyalty`), manual adjustments (`POST /api/customers/:id/adjust-points`, Admin/Manager, audited). Checkout auto-awards 1 pt per LKR 100 (configurable) and recalculates tiers.
- Warehouses: CRUD (`GET|POST /api/warehouses`, `GET|PUT|DELETE /api/warehouses/:id`, `POST /api/warehouses/:id/default`), per-warehouse stock (`GET /api/warehouse-stock`, `POST /api/warehouse-stock/adjust`)
- Transfers: create/list/detail (`POST|GET /api/transfers`), approve/complete/cancel workflow with `TRANSFER_OUT` + `TRANSFER_IN` ledger entries
- Orders: server-filtered history (`GET /api/orders` with status/customer/cashier/date/payment_status/search), full detail (`GET /api/orders/:id` with lines, payments, loyalty + cashier context, movement trail), create (`POST /api/orders`, decrements stock + awards loyalty + captures cashier), void, receipt, email receipt. New deployments track `cashier_name`/`created_by` per order; frontline roles are auto-scoped to their own sales.
- Reports: filter-driven services (`GET /api/reports/revenue|products|customers|profit|registers` with period presets, custom range, customer/cashier/warehouse/category/payment/status), server CSV (`GET /api/reports/export/csv?type=`) and branded PDF (`GET /api/reports/export/pdf?type=`, zero-dependency engine with KPIs, tables, bar charts, raster logo, footers, page numbers). Profit is managers-only; frontline roles are auto-scoped to own sales.
- Returns: `POST /api/orders/:id/return` (Admin/Manager; per-line validation against ordered-minus-returned via RETURN movements, restock + mirrors, negative refund legs, full returns flip to Refunded, loyalty reversal, customer email) + Returns page (order lookup, line quantities, refund mode) + recent-returns feed
- Ledger: `GET /api/stock-movements` (product/type/warehouse/reference/search/date filters + in/out summary) + Movements page in Inventory nav
- Loyalty campaigns: `GET|POST /api/loyalty/campaigns`, `PUT /api/loyalty/campaigns/:id`, `POST /api/customers/:id/redeem` (voucher codes for POS discounts) + Rewards page management
- KOT/print routing: printers registry + category→station routing (`GET|PUT /api/settings/printers|print-routing`), `print_jobs` + `kot_numbers` in checkout, cancel chits in void/return, reprint (`GET /api/orders/:id/print?template=`), KOT states (`GET /api/kot`, `POST /api/kot/:number/ack|done`, `GET /api/print-queue`)
- Storage: company logo + product images on Stratus (`company/<org>/logo.*`, `products/<rowId>.*`, `overwrite: true`); reads dual-shape tolerant; FileStore code removed
- Tender config: `GET|PUT /api/settings/payments` (enabled Cash/Card/Bank enforced in POS + checkout) + low-stock digest trigger (`POST /api/settings/notifications/digest`)
- Shifts: open, close, list
- Settings + SMTP config (email receipts via nodemailer) — includes `allow_backorders`, `loyalty_*`, `report_*`, `admin_*` keys
- Company profile (`GET|PUT /api/settings/company`, logo upload/stream/remove in FileStore `CompanyAssets`, 5 MB PNG/JPG/WebP; emailed receipts embed the logo + address block)
- Tax engine (`GET|PUT /api/settings/tax`: enable, name, default rate, exclusive/inclusive mode, per-line rounding, ≤20 profiles). Checkout, POS display, receipts and order detail all share one formula set (verified identical); exclusive default preserves legacy totals; unset line rates inherit the default, 0 stays exempt
- Notifications (`GET|PUT /api/settings/notifications`: 11 types × email/in-app/system channels, low-stock threshold/recipients/immediate-vs-daily, alert email). Wired: immediate low-stock emails on deductions, void emails to customers, Books-sync failure alerts — all best-effort via SMTP
- Integration health (`GET /api/settings/integrations`): company Books connection, organization, region and latest product import result.
- Zoho Books sync (`POST /api/sync/books`, diagnose) — see `zohoBooksService.js`

## Table-page layout standard

Every table page follows: Page Header → Stats → Toolbar Card → Table → Pagination. Shared `.ch-card-body` (20px gap, 22px padding) owns the spacing and all `.ch-toolbar` bars are static, so the filter bar sits pinned at the card top on every page — same as Products. Stacked sections keep the same rhythm via `.ch-card + .ch-grid-stats { margin-top: 20px }`, and the shared `.orders-dates` filter-row class lives in `styles/ui.css` (never in a page stylesheet) so toolbar inputs can't blow out on any page.

## What's wired vs not (read from the code, not run-tested)

- Working shape: backend exports the app, frontend builds, deploy map is correct.
- Login / Register pages say in their own code comments: UI only, no API calls wired yet.
- `react-app/src/services/api.ts` points to `http://localhost:3000/...` — fine on your laptop, but the hosted site needs a relative path (`/server/pos_backend/api`) or those calls break online.

## Run it (laptop)

```bash
cd react-app
npm install
npm run dev      # frontend only, hot reload
npm run build    # outputs react-app/dist/
```

Backend needs Catalyst services (database), so test it after deploying to Development, not on the laptop.

## Ship it

```bash
catalyst deploy --only functions:pos_backend   # backend only
catalyst deploy --only client                   # website only
```

Never deploy a test `dist` while the live site matters — it replaces the live pages.

## CI/CD (GitHub Actions)

```text
push / PR  →  build.yml validates (no deploy)
push to main  →  deploy-dev.yml ships Development (functions, then client)
```

- `build.yml`: `npm ci` → `npm run build` (`tsc -b && vite build`) → `node --check functions/pos_backend/index.js` → verifies `catalyst.json`, `.catalystrc`, `dist/` → uploads `dist/` artifact (7 days).
- `deploy-dev.yml`: same gates, then `npm install -g zcatalyst-cli` and `catalyst deploy --only functions:pos_backend` + `--only client` using a CLI token (`catalyst token:generate`), passed via `--token`/`--dc`.
- Local equivalent: `./scripts/deploy.sh [all|functions|client]` (assumes logged-in CLI).
- CLI deploys reach **Development only** — promote to Production from the Catalyst console.
- Required repo secrets: `CATALYST_TOKEN`, `CATALYST_DC`. Full setup + smoke-test runbook: `docs/CI_CD_Guide.md`.

## Known quirks (do not "fix" blindly)

1. The function folder, target name, and deploy name are all `pos_backend`
   now (renamed from `pos_function` on 2026-09-15 to fix `catalyst serve`,
   which loads `.build/functions/<target>/index.js`). Do not rename one
   without the others.
2. The app uses `BrowserRouter` with no URL rewrite rules in `catalyst.json` —
   refreshing a page like `/app/orders` on the live site can give 404.
3. `node_modules`, `dist`, and `.build` were committed before the
   `.gitignore` existed, so git still tracks them. To stop tracking
   (files stay on disk): `git rm -r --cached node_modules react-app/dist .build`
   then commit. Ask before running this.
