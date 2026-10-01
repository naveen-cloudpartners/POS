# CloudHub POS — Function Prerequisites & Verification Checklist

## Books integration verification - 1 Oct 2026

- [x] Local backend tests (78), receipt-printing tests (6), TypeScript and production build passed.
- [x] Mocked OAuth verifies Admin permissions, company/user-bound state, expiry, organization selection and token-free browser responses.
- [ ] Deploy both function and client to the intended environment.
- [ ] Verify Configurations read/write access and Products.org_id before importing.
- [ ] Register the displayed callback URI, save credentials/region, authorize and choose the company.
- [ ] Test the connection and verify product import preserves zero stock and local categories.
- [ ] Verify Cashier/Manager sales use the Admin-created company connection.
- [ ] Compare Books invoice taxes, discounts, totals and split payments against the POS receipt.
- [ ] Confirm incomplete posting is visible and review any partial remote invoice before retrying.
- [ ] Change a Books product and confirm it appears after manual import; disconnect and confirm POS records remain.

No extra Catalyst Connection is required. Live checks remain pending. See [Books setup](zoho-books-integration.md).

## Shared UI Review - 30 Sep 2026

- [x] TypeScript project check passed for the shared Purchasing-style theme update.
- [x] Vite production build passed (large-chunk warning remains).
- [ ] Review Dashboard, Products, Inventory, Customers, Orders, Reports, Administration, Settings, and Purchasing with an authenticated session.
- [ ] Verify page actions remain visible and clickable in the workspace.
- [ ] Check summary values, selected product filters, empty states, and keyboard focus outlines.
- [ ] Check narrow screens for clipped text, overlapping controls, and unexpected horizontal scrolling.
- [ ] Verify POS with the context panel open and closed, including large quantities and checkout controls.
- [ ] Deploy the client and repeat the visual checks on the deployed app.

These checks track the latest CSS update only; unchecked items have not been verified.

Companion to the end-to-end flow explanation. Same order: for every function,
what must exist **before** it can work, which UI + API + table to check,
and the usual fault + fix. Work top to bottom — each section's green checks
are the next section's prerequisites.

> Legend: ✅ check passes · 🔧 fix action · Console = Catalyst console · MCP = Catalyst MCP server.

---

## 0. Platform prerequisites (everything below needs these)

| # | Prerequisite | Where | Check |
|---|---|---|---|
| 0.1 | Function `pos_backend` (Node 18, Advanced I/O) **deployed** | Console → Functions | MCP: function status = deployed, recent update time |
| 0.2 | Client (`react-app/dist`) **deployed** (incl. `404.html` SPA fallback) | Console → Client / Hosting | Deep link `/app/admin/users` loads instead of 404 |
| 0.3 | Env vars: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` (optional shared Books credentials; company setup can use Admin settings), optional `STRATUS_ASSETS_BUCKET` (default `companyassets`), `CATALYST_APP_DOMAIN` | Console → Functions → Environment | Function cold-start log shows `[ENV]` true + `[BUILD]` stamp |
| 0.4 | Data Store tables exist (see table map in §11) | Console → Data Store | `GET /api/setup/status` → `all_tables_ready: true` |
| 0.5 | Stratus bucket `companyassets` exists + policy allows authenticated `GetObject, PutObject, DeleteObject` on `companyassets::/*` | Console → Stratus | Logo/product image round-trip works (§3) |
| 0.6 | Same project + environment everywhere (CloudPartners → POS → **Development**) | Console / MCP prompts | Always pin org + project + env in every check |

🔧 If any step below fails mysteriously, re-verify 0.1–0.6 first — 9 out of 10
"bugs" in this project have been undeployed code or a missing table, not logic.

---

## 1. Login & session

**Prerequisites:** 0.1, 0.2. A Catalyst user account for the tester.
**UI to check:** `/landing` → `/login` → hosted login → `/dashboard`; rail matches role.
**API to check:** `GET /api/auth/me` returns user + role (401 when logged out).
**Tables touched:** `Organizations`, `OrgUsers` (role lookup), roster fallback in `Configurations` (`user_*`).
**Typical faults:**
- Redirect loop / 401 after login → session cookie blocked (third-party cookies) or wrong project environment. 🔧 Test in the deployed domain, not localhost against prod.
- Wrong role shown → no `OrgUsers` row for that email; virtual `org_default` fallback applies. 🔧 Invite the user via Administration → Users so roster + `OrgUsers` rows exist.

## 2. One-time setup (company, tax, payments, printers, SMTP)

**Prerequisites:** §1 green (Admin login).
**UI to check:** Settings → General, Business, Taxes, Payments, Printers, Email — save each, reload, values persist.
**API to check:** `PUT /api/settings/company|tax|payments|printers|smtp|notifications` → 200; `GET` returns saved values.
**Tables touched:** `Configurations` keys `org_<id>_setting_*` (+ legacy `pos_setting_*` mirrors).
**Typical faults:**
- Save 500s → missing `Configurations` table or ZCQL error; read function logs. 🔧 Provision table, redeploy.
- Logo upload 403 → Stratus bucket/policy mismatch (see 0.5). 🔧 Keep bucket `companyassets`, keep authenticated Get+Put+Delete.
- Logo saved but not displayed → open backend URL `/server/pos_backend/api/settings/company/logo` directly. If PNG returns, the app is fine — never use `https://companyassets-*.zohostratus.com/...` object URLs in the browser (authenticated bucket → 403 by design).

## 3. Products (catalog)

**Prerequisites:** §1, §2 (Admin/Manager/Storekeeper login). `Products`, `Categories` tables.
**UI to check:** Products page — table + grid, search/filter, New (SKU unique enforced), edit drawer, image upload/preview/remove, stock-adjust modal, bulk delete, Books sync button, CSV import/export. New product appears as a POS tile.
**API to check:** `GET|POST /api/items`, `PUT|DELETE /api/items/:id`, `POST /api/items/stock-adjust`, `/api/items/export`, `/api/items/import`, `/api/categories*`.
**Tables touched:** `Products`, `Categories`, `StockMovements` (adjustments), Stratus `products/<id>.*`.
**Typical faults:**
- Duplicate SKU 409 on create → by design; edit keeps SKU immutable. 🔧 Change SKU.
- Delete blocked with order count → by design; deactivate instead.
- Image missing → Stratus key is `stratus:products/<ROWID>.<ext>` in the product row; re-upload.

## 4. Warehouses, transfers, movements

**Prerequisites:** §3 green. `Warehouses`, `WarehouseStock`, `StockTransfers`, `TransferItems`, `StockMovements` tables.
**UI to check:** Warehouses (CRUD, set default, 409-on-stock delete) · Transfers (create → Draft → Pending → Approved → Completed/Cancelled + cancel) · Stock-page Adjust modal (warehouse picker + required reason) · Movements ledger (filters, in/out summary, CSV).
**API to check:** `/api/warehouses*`, `/api/warehouse-stock*`, `/api/transfers*` (+ `/approve|/complete|/cancel`), `GET /api/stock-movements`.
**Rule:** `Products.stock` = SUM(`WarehouseStock.quantity`); EVERY stock change writes a `StockMovements` row.
**Typical faults:**
- Transfer stuck → status transition called out of order or by wrong role (approve = Admin/Manager). 🔧 Check transfer detail + role.
- `503` with table name → that table isn't provisioned in this environment. 🔧 Create it in console, no code change needed.

## 5. Customers & loyalty

**Prerequisites:** §1. `Customers`, `CustomerActivity` tables.
**UI to check:** Customers directory (tier/VIP filters), New/Edit/Delete, profile (balances, tier, frequency, LTV) + purchase timeline + loyalty activity, manual Adjust points (Admin/Manager), Rewards (campaigns, redeem-to-voucher), Membership view, CSV export.
**API to check:** `/api/customers*`, `/api/customers/:id/loyalty|adjust-points|redeem`, `/api/loyalty/campaigns*`.
**Rule:** checkout awards 1 pt / LKR 100 (configurable); every points change → `CustomerActivity` row.
**Typical faults:**
- Points not awarded → loyalty disabled in Settings → Loyalty, or order voided/refunded (correct reversal). 🔧 Check loyalty settings + order status.

## 6. Sale (counter)

**Prerequisites:** §3 (products with stock), §2 (payments/tax), §5 optional (customer), SMTP optional (email receipt), Books optional (invoice sync), printers optional (KOT).
**UI to check:** POS — categories, search/SKU entry, cart qty/discounts, customer select + email autofill, tender (single/split, must-match), stock-cap messages, Charge → receipt modal (Print / per-KOT print / Download / Email / Void).
**API to check:** `POST /api/orders` (single call does: validate → decrement + SALE movements → `Orders`/`OrderItems`/`Payments` rows + cashier stamp → loyalty → Books invoice → `printJobs`/`kot_numbers`).
**Tables touched:** `Products`, `WarehouseStock`, `StockMovements`, `Orders`, `OrderItems`, `Payments`, `Customers`, `CustomerActivity`.
**Typical faults:**
- Tender mismatch rejected → correct behavior; legs must equal total.
- Oversell blocked at counter → correct; adjustresp. transfer stock first.
- No Books invoice → Books not connected (Settings → Integrations). Sale still completes locally. 🔧 Connect Books.
- No email receipt → SMTP not configured. 🔧 Settings → Email.

## 7. After sale (orders, returns, kitchen, payments)

**Prerequisites:** §6 (at least one order).
**UI to check:** Orders (filters, 6-section detail drawer, CSV, void, reprint/email) · Returns (order lookup, line quantities, refund mode, recent feed) · Kitchen board (Ack/Done, station filters) · Payments/Invoices views.
**API to check:** `/api/orders*`, `/api/orders/:id/void|return|receipt|email-receipt|print`, `/api/kot*`, `/api/print-queue`.
**Rules:** void restores stock + `VOID` movements + cancel chit (Admin/Manager); return validates ordered-minus-returned, restocks + `RETURN` movements, posts refund legs, reverses loyalty.
**Typical faults:**
- Return rejected → quantities exceed ordered-minus-returned. 🔧 Check movement trail in order detail.
- KOT missing for an order → its lines map to counter-only stations. 🔧 Check Settings → Printers routing + category stations.

## 8. Team & audit

**Prerequisites:** §1 (Admin), SMTP (for the 1 confirm mail), Catalyst Authentication **signup enabled** (else the register link errors).
**UI to check:** Administration → Users (roster incl. Catalyst logins, Unassigned badge for roleless accounts), Invite, Role modal, Edit, Activate/Deactivate, Delete, Reset password; Roles matrix; Activity feed; Audit (filters, detail, CSV/PDF).
**API to check:** `/api/admin/users*` (`POST` invite + legacy alias `/api/users/invite`), `/activate|/deactivate|/reset-password|/change-role`, `GET /api/admin/audit*`.
**Tables touched:** roster JSON (`user_*` in `Configurations`), `OrgUsers`, Catalyst Auth accounts, `UserAuditLog`.
**Single-mail rule:** invite sends EXACTLY ONE mail (Catalyst registerUser confirm mail). No recovery mail, no SMTP welcome on invites. Reset-password endpoint keeps its mails (recovery by design).
**Typical faults:**
- `Login account not created (...)` → read the bracket text: it names the real `/project-user` rejection. Past cases: `INVALID_INPUT` (fixed: payload now matches `ICatalystSignupUserConfig`), signup disabled (console setting).
- Invited user missing from page → hard-refresh; roleless logins show as `Unassigned` until a role is assigned.
- Deactivated user still in lists → they show Inactive and their API access is blocked; session cookie itself expires naturally.

## 9. Reports & dashboard (read-only)

**Prerequisites:** §§3–7 (data to report on). Profit = Admin/Manager only.
**UI to check:** Reports — Revenue, Inventory, Customers, Profit, Register; ranges + filters recalc everything; per-section CSV + PDF. Dashboard — KPIs, pipeline, low stock, top products, activity.
**Rule:** these never write data. A wrong number means the bug is in §§3–7 — don't "fix" reports.

## 10. Full-system manual pass (in order)

1. ☐ Login → role-correct rail (§1)
2. ☐ Settings saves persist after reload (§2)
3. ☐ 2 products created (1 with photo) → POS tiles (§3)
4. ☐ Second warehouse → transfer 5 units → complete → stock moved + movements (§4)
5. ☐ Customer created (§5)
6. ☐ POS sale to that customer, split Cash+Card, email receipt → order listed, stock dropped, points added, Books invoice, KOT on kitchen board (§6)
7. ☐ Return 1 line → stock restored, status updated (§7)
8. ☐ Invite test user → 1 confirm mail → registers → listed with role (§8)
9. ☐ Reports revenue shows the sale; CSV + PDF open (§9)
10. ☐ Movements + Audit contain a trail row for every action above (§§4, 8)

All 10 green = system fully works: every step is `page → API → Catalyst table → back to page`.

## 11. Table map (provision per environment)

`Products`, `Categories`, `Orders`, `OrderItems`, `Payments`, `Warehouses`,
`WarehouseStock`, `StockTransfers`, `TransferItems`, `StockMovements`,
`Customers`, `CustomerActivity`, `Organizations`, `OrgUsers`, `Configurations`,
`Shifts`, `UserAuditLog`. Plus Stratus bucket `companyassets` and SMTP/Books credentials.
