# CloudHub POS — Project Status Report

**Planned System (SRS v1.0) vs Current Implementation · Gap Analysis · Roadmap**

| Field | Value |
|---|---|
| Project | CloudHub POS — Cloud-Based Point of Sale & Retail Management System |
| Target baseline | `CloudHub_POS_SRS.pdf` v1.0 (18 Sep 2026, Draft for BA/Stakeholder review) |
| Current-state source | Full codebase read: `react-app/`, `functions/pos_backend/`, `catalyst.json`, configs (no assumptions; every claim below traces to a file) |
| Report date | 28 Sep 2026 |
| Audience | Business Analysts, Stakeholders, Developers, PMs, New joiners, Auditors, Maintainers |

**How to read this document:** Executive Summary first; §1 business model; §2 build order; §3 SRS target; §4 what the code does today; §5 line-by-line gap tables; §6 risks; §7 health; §8 remaining work; §9 roadmap; §10 completion math; §11 final recommendation.

> **Current Development checkpoint — UI polish + Purchasing workspace build-out:** the primary workspace rail is fixed/no-scroll, the CloudHub home mark has been removed, all rail entries remain visible together, and the active rail item now uses a slightly larger selected border box. The Purchasing workspace has been expanded into page-specific views for Purchase Orders, Vendors, Receive Stock, Vendor Bills, and Payments & Credits. Continue from Purchasing workflow validation and normal Development regression checks after each deployment.

---

## UI Checkpoint - 30 Sep 2026

The shared authenticated workspace theme now follows the Purchasing reference for summary cards, labels, spacing, empty states, and table interactions. Products and Customers widgets share the same visual treatment, with responsive summary grids on narrow screens. POS retains its compact layout; page actions remain in the workspace after the top-bar action experiment was rolled back.

Implementation: `react-app/src/styles/workspace-theme.css`, imported after the base styles in `react-app/src/main.tsx`. This checkpoint covers frontend CSS only and does not change business calculations or APIs.

Verification: TypeScript and the Vite production build passed. The existing large JavaScript chunk warning remains. Full authenticated visual regression checks, including POS with the context panel open and mobile layouts, are still pending. No deployment was performed for this update. The older report sections below retain their original assessment date and are not a new whole-system audit.

## Executive Summary

CloudHub POS is a cloud-native retail management system on Zoho Catalyst unifying POS billing, inventory, customers, orders, reports, users/roles and business configuration for retail SMEs.

- **Business Goal:** Replace manual billing, spreadsheets and fragmented tools with one real-time, role-secured retail platform (Retail POS, Inventory, Customers, Orders, Reports, Users, Settings, Zoho Catalyst/Books backbone).
- **Current Status:** ~85% overall (Frontend 88%, Backend 80%); MVP-ready at 90%; production-ready at 70%. All screens, onboarding + approval flow, Books invoice sync and the enterprise workspace are live.
- **Future Architecture Vision:** CloudHub POS is **not** a shared multi-tenant SaaS. CloudPartners will operate a **one-deployment-per-customer** model — each customer gets an isolated Catalyst project (own backend, database, auth, SMTP, Books connection, users), provisioned from a maintained CloudHub POS template and governed by plans, licenses and feature flags (see §1).
- **Major Risks:** Unknown users default to Admin; checkout never decrements local stock; approval links are unauthenticated GETs; Storekeeper role rejected by the backend; zero automated tests.
- **Recommended Next Action:** Execute Phase 1 (Correctness & Security, ~2–3 weeks) before any new features — then reporting/registers, then inventory depth. Do **not** start AI, Loyalty, WhatsApp or Forecasting until Phase 1 is closed.

---

# 1. Business Architecture

## 1.1 CloudPartners Model
CloudHub POS is **not a traditional multi-tenant SaaS**. There is no shared customer database and no shared authentication plane. CloudPartners owns and maintains a single **CloudHub POS Template**, and every customer receives **one dedicated deployment** of that template:
- Own Catalyst Project · own backend (`pos_backend` function) · own database (Data Store tables)
- Own Authentication (Catalyst users per project) · own SMTP configuration
- Own Zoho Books connection · own user accounts · optional own domain

Each deployment is fully isolated: data, sessions, integrations and credentials never cross customer boundaries. The current codebase already fits this model — per-organization settings keys (`org_<id>_setting_*`), env-driven SMTP/credentials, and per-project Catalyst auth require no shared-tenant machinery.

## 1.2 Customer Deployment Model
```
CloudPartners Template ─┬─▶ Customer A ── Catalyst Project A (backend + DB + auth + SMTP + Books)
                        ├─▶ Customer B ── Catalyst Project B (backend + DB + auth + SMTP + Books)
                        └─▶ Customer C ── Catalyst Project C (backend + DB + auth + SMTP + Books)
```
- **Isolation guarantees:** no shared customer database · no shared authentication · no shared SMTP · no shared Books connection. A breach, outage, or misconfiguration in one deployment cannot leak into another.
- **Trade-off accepted:** N deployments to operate instead of one (see §1.4).

## 1.3 Deployment Strategy
CloudHub POS uses a **dedicated deployment model** (not shared multi-tenancy):
```
CloudPartners
        ↓
CloudHub POS Template
        ↓
Dedicated Customer Deployment
        ↓
Own Catalyst Project
        ↓
Own Database
        ↓
Own Users
        ↓
Own Billing
```
Each customer receives a **dedicated Catalyst Project** containing a **dedicated Database**, **dedicated Authentication**, **dedicated SMTP**, and a **dedicated Zoho Books Connection**. CloudPartners maintains the master template and deploys customer instances from that template. When a customer purchases: new Catalyst project → template deployment (function + client) → environment configuration (env vars, SMTP, Books app, domain) → initial organization record → approval → handover to the Organization Admin.

## 1.4 Multi-Deployment Strategy
Pipeline per customer: **Template → Customer Deployment → Configuration → Operation → Maintenance.**
- **Benefits:** blast-radius isolation; per-customer Books/SMTP/auth with no cross-tenant logic; simple single-tenant code (no `org_id` plumbing in Products/Orders); independent upgrades and rollbacks; regulatory/data-residency flexibility per customer.
- **Challenges:** N projects to monitor, update and support; template drift risk (deployments diverging); repeated provisioning effort; license/feature entitlement must be enforced per deployment.
- **Why this model:** the product handles money, tax records and customer PII for independent merchants. Isolation removes entire classes of cross-tenant bugs and compliance findings, and it matches how the code is already written (virtual single-tenant with per-org settings overlay).
- **Fit & conflicts with current code:** compatible — SKU uniqueness, stock logic and settings prefixes all assume one business per database. Gaps to close: no license enforcement, no feature flags, no Super Admin role, no internal deployment portal, updates are manual `catalyst deploy` today.

## 1.5 CloudPartners Operating Model
CloudPartners acts as the **platform provider** for every customer deployment. Responsibilities:
- Create customer projects
- Deploy CloudHub POS (template → project)
- Approve onboarding (organization approval flow)
- Manage upgrades (template versions → staged customer rollouts)
- Configure features (per-deployment enablement)
- Provide support (diagnostics, ticket context, health checks)

## 1.6 Roles & Hierarchy
| Level | Role | Capabilities (target) |
|---|---|---|
| Platform | **CloudPartners Super Admin** | Approve organizations · manage licenses · enable/disable features · set user limits · support · manage deployments · push updates |
| Organization | **Organization Admin** | Manage products, inventory, reports, users · assign roles · manage settings |
| Store | **Manager** | Operations, reports, inventory visibility, customer management |
| Counter | **Cashier** | POS, orders, payments, customer lookup |
| Warehouse | **Storekeeper** | Products (read), inventory, adjustments, transfers |

Notes: the Super Admin tier does not exist in code yet (platform role for the future portal: Organization Approval, License Control, Feature Flags, User Limits, Deployment Status, Support Tools, Upgrade Management). In-code roles today are Admin/Manager/Cashier/Storekeeper plus Waiter/Chef; `update-role` currently rejects Storekeeper (§8) — must be fixed before the hierarchy above is enforceable.

## 1.7 Licensing Model
Plans (target state):

| Plan | Users | Profile |
|---|---|---|
| Starter | 4 users | Single counter, first professional system |
| Business | 10 users | Multi-counter + warehouse operations |
| Enterprise | Unlimited | Chains, advanced modules, priority support |

User limits are **enforced by the application** (roster-size check at invite/approve time against the deployment's plan). **Catalyst does not enforce licensing.** No license enforcement exists in code today — plan + entitlement store is Phase 3 work.

## 1.8 Feature Management
Target: a per-deployment **feature-flag system** letting CloudPartners enable/disable modules without redeploying code. Flag surface (mapped to real modules where they exist):
- Core (shipped, flag-ready): POS · Inventory · Reports · Customers
- Gated futures: Loyalty · Rewards · WhatsApp · AI Assistant · Offline POS · Forecasting

CloudPartners can enable or disable features per customer deployment once the flag service lands. No flag system exists in code today (all modules render for all entitled roles) — flags arrive after correctness and licensing are settled.

## 1.9 Customer Provisioning Workflow
```
Customer Purchase
    ↓
CloudPartners Creates Catalyst Project
    ↓
CloudHub POS Template Deployment
    ↓
Organization Registration         (Register page → POST /api/organizations/register)
    ↓
Pending Approval                  (status = pending)
    ↓
CloudPartners Approval            (approve-org link → approved)
    ↓
Catalyst User Created             (registerUser, duplicate-safe)
    ↓
Owner Sets Password               (Catalyst activation email)
    ↓
Organization Admin Login          (hosted auth → /dashboard)
    ↓
Create Staff                      (Users module, roles)
    ↓
Business Operations Start
```
Steps from Organization Registration onward already operate end-to-end in code; project creation and template deployment are the CloudPartners provisioning motion. Project creation, environment configuration and handover are CloudPartners responsibilities (§1.5).

## 1.10 Internal CloudPartners Administration
Future internal portal (no code exists yet) for operating all customer deployments from one pane:
- **Deployments** — project inventory, versions, health
- **Organizations** — onboarding queue, approvals, status
- **Licenses** — plans, user counts vs limits, renewals
- **Updates** — template versions, staged rollouts per deployment
- **Support** — impersonation-safe diagnostics, ticket context
- **Diagnostics** — setup-status, sync health, error aggregates
- **Feature Flags** — per-deployment module toggles

---

# 2. Product Development Strategy

Recommended build order — what first, what later, what not yet, and why. (Relation to §9: same work, re-sequenced so **data correctness and security gate everything else**; §9 remains the effort-scoped view.)

## Phase 1 — Core Business Data (P0)
**Purpose:** Ensure all business data becomes trustworthy. **Focus:** Products · Inventory · Orders · Customers · Payments.
**Tasks:** Stock decrement on checkout · inventory accuracy reconciliation · order correctness (totals, taxes, statuses) · payment correctness (modes, amounts, invoice linkage) · customer data integrity (dedupe, history linkage).
**Rule:** No advanced feature should be built until these are correct — every report, flag, forecast and loyalty calculation consumes this data.

## Phase 2 — Security & Access Control (P0)
**Purpose:** Ensure only authorized users can access data. **Focus:** Authentication · Authorization · Roles · Approvals.
**Tasks:** Unknown-user deny policy · Storekeeper role fix · Dashboard restriction decision (restrict vs re-baseline) · signed, expiring approval links · invite workflow repair.
**Rule:** Security must be completed before scaling — one deployment per customer multiplies every access flaw.

## Phase 3 — Operational Completeness (P1)
**Purpose:** Provide a complete day-to-day retail workflow. **Focus:** Orders · Receipts · Reports · Registers · Shifts.
**Tasks:** PDF reports · date-range reports · order line items in detail view · printable/emailed receipts · Shifts UI on the existing API.

## Phase 4 — Inventory Depth (P1)
**Purpose:** Support larger retail operations. **Focus:** Warehouses · Transfers · Stock Movement Logs · Reorder Rules.
**Tasks:** Warehouses table · audited transfers · movement ledger · per-product reorder levels · backorder policy.

## Phase 5 — Organization Administration (P2)
**Purpose:** Enable the customer organization to manage itself. **Focus:** Users · Permissions · Organization Settings · Configuration Controls.
**Tasks:** Role completion (all six roles enforceable) · organization profile (incl. logo) · user administration (activate/deactivate) · configuration governance (currency, tax modes, notification prefs).

## Phase 6 — CloudPartners Platform (P2)
**Purpose:** Support customer deployments at fleet scale. **Focus:** CloudPartners Super Admin · Deployments · Licensing · Support · Feature Management.
**Tasks:** Organization management · deployment registry · license enforcement · user limits · feature flags · support tooling.
**Why this waits:** platform tooling governs an operationally complete POS — building the control plane before the product is trustworthy inverts priorities and bakes today's gaps into every future deployment.

## Phase 7 — Advanced Features (P3)
**Purpose:** Differentiate the product. **Features:** Loyalty · Rewards · WhatsApp · AI Assistant · Offline POS · Forecasting · Business Health Score.
**Why these wait:** each consumes inventory and reporting data as ground truth. Forecasting on non-decrementing stock manufactures confident wrong answers; loyalty without an audit log is a fraud vector; WhatsApp/AI expand the blast radius before privilege holes close.

## Development Priority Summary
| Phase | Priority | Reason |
|---|---|---|
| Phase 1 — Core Business Data | P0 | Data correctness; everything downstream depends on it |
| Phase 2 — Security & Access Control | P0 | Security; customer-isolated model multiplies every flaw |
| Phase 3 — Operational Completeness | P1 | Daily operations; stakeholder-visible completeness |
| Phase 4 — Inventory Depth | P1 | Inventory control for larger operations |
| Phase 5 — Organization Administration | P2 | Customer administration; self-sufficient orgs |
| Phase 6 — CloudPartners Platform | P2 | CloudPartners management; fleet-scale operations |
| Phase 7 — Advanced Features | P3 | Advanced features; differentiation after trust is earned |

---

# 3. Target System (SRS Vision)

## 3.1 Project Vision & Business Goal
Build a modern, cloud-native retail management ecosystem on Zoho Catalyst that unifies billing, inventory, customers, orders, reporting, users/roles and business configuration into one web application — replacing manual billing, spreadsheets, disconnected inventory tools and manual bookkeeping for small/medium retailers.

## 3.2 Problem Statement (SRS §2.2)
- **Sales:** manual error-prone billing, poor cross-counter order tracking, no performance visibility.
- **Inventory:** recorded-vs-actual discrepancies, no real-time multi-location visibility, hard large-catalog management.
- **Customers:** fragmented records, no purchase-history visibility, no loyalty/retention mechanism.
- **Reporting:** no actionable insights, manual report generation, no real-time analytics.
- **Fragmentation:** Excel + separate billing + separate inventory + manual books → duplication and reconciliation errors.

## 3.3 Target Users
| Role | Access |
|---|---|
| Admin | Everything incl. Settings + Users |
| Manager | POS, Products, Inventory, Customers, Orders, Reports; limited Settings/Users |
| Cashier | POS billing, basic customer lookup, own history |
| Storekeeper | Inventory, adjustments, transfers; read-only Products |

## 3.4 Target Modules (SRS §6)
- **DASH-01…08:** revenue/orders/customer summaries, profit estimate, activity feed, insights, low-stock flags, Admin/Manager-only dashboard.
- **POS-01…12:** search/SKU/barcode, categories, cart, walk-in/customer, discounts, tax calc, multi-method payment, split (C), receipt, auto stock-decrement, reconcile guard, void (S).
- **PROD-01…09:** CRUD + SKU uniqueness + categories + stock linkage + cost/sale pricing (M); images (S); CSV import/export (C).
- **INV-01…08:** per-warehouse quantities, valuation, adjustments with reason, multi-warehouse, audited transfers, movement log, reorder flags, no-negative guard.
- **CUST-01…06:** profiles, purchase history, analytics, LTV, loyalty_points field ✅, search — 100% complete.
- **ORD-01…05:** full history, line/discount/tax/payment detail, payment-status tracking, filters, search.
- **RPT-01…06:** revenue (date ranges), product, customer, profit, register/shift reports; CSV/PDF export.
- **USR-01…05:** create users, 4 roles, RBAC everywhere, activate/deactivate/delete, action audit log (C).
- **SET-01…05:** company profile, tax rules, SMTP, notification prefs, integrations.
- **NFRs:** checkout <2s, metrics <3s, 50 concurrent users, HTTPS, RBAC client+server, Catalyst-held credentials, atomic checkout, responsive desktop/tablet/mobile.

## 3.5 Target Architecture (SRS §3)
```
┌─ CLIENT LAYER ─────────────────────────────┐
│ React 19 + TS + Router + Vite │ POS/Dash/  │
│ Lucide + CSS                 │ Inv/Rep UI  │  Desktop/Tablet/Mobile
└──────────────┬─────────────────────────────┘
               │ HTTPS / REST (JSON)
┌──────────────▼─────────────────────────────┐
│ APPLICATION LAYER — Zoho Catalyst          │
│ Auth/RBAC │ Adv I/O Functions (Node.js)    │
│ Business logic │ Cache/Cron │ File Store   │
│ Notification (SMTP) + Integration connectors│
└──────────────┬─────────────────────────────┘
               │ Data Store SDK
┌──────────────▼─────────────────────────────┐
│ DATA LAYER — Catalyst Data Store           │
│ Products Categories Inventory Warehouses   │
│ Orders OrderItems Payments Customers Users │
│ Settings StockMovements                    │
└──────────────┬─────────────────────────────┘
               │
┌──────────────▼─────────────────────────────┐
│ INTEGRATIONS: Zoho Books · Payment GW ·    │
│ SMTP · WhatsApp (planned) · AI (planned)   │
└────────────────────────────────────────────┘
```

## 3.6 Target Data Model (SRS §5)
Category → Product → Inventory → Warehouse; StockMovement audits Inventory; Customer → Order → OrderItem → Product; Payment settles Order; User processes Order; BusinessSettings holds tax/SMTP.

## 3.7 Planned Future Enhancements (SRS §9, out of scope)
Loyalty Program, Rewards, AI Assistant, WhatsApp, Smart Reordering, Health Score, **Offline POS**, Forecasting.

---

# 4. Current Implementation

## 4.1 Current Frontend
React **19.1** + TypeScript **~5.8** + React Router **7.18** + Vite **6** + lucide-react. SPA with `basename: '/app'`, served from `react-app/dist` via `catalyst.json` (`url_prefix: /app`, SPA fallback via `404.html`). Glassmorphism enterprise design system (`styles/app.css`, `ui.css`, `workspace.css`): tokens `#5D8EF9/#3A76F8/#22B378/#FD9134/#E84646/#F5F7FC`. 13 shared UI primitives (Card, StatCard, Table, Modal, Skeleton, Empty/Error, Badge, Search/Filter, etc.).

## 4.2 Current Backend
Express **4.19** on Node.js as a single Catalyst Advanced I/O function (`pos_backend`, `module.exports = app`; 2,494 lines). **35 REST routes** covering catalog, checkout (Books invoice + payment + local rows), adjustments, contacts, settings, SMTP, shifts, onboarding/approval, OAuth chain. Sanitized ZCQL interpolation with safe fallbacks; `zcatalyst-sdk-node` 3.4, axios, nodemailer.

## 4.3 Current Authentication
Catalyst-only identity: hosted login page (full-tab; no iframe) → session cookie → `RootEntry` gates `/` → `ProtectedRoute` re-verifies via `GET /api/auth/me` → `AuthContext` resolves role from roster (`master_admin`→Admin; **unknown email defaults to Admin**) → rail/panel filter by role → logout destroys Catalyst session → `/login`. Registration decoupled: org row (`pending`) → admin email GET-links → Catalyst user + activation mail. No localStorage tokens, no OTP state.

## 4.4 Current Database
`Products` (sku, name, rate, stock, category, tax_%, books_item_id) · `Orders` + `OrderItems` (invoice/payment fields embedded) · `Organizations` (registration + approve/reject + `approved_at`) · `OrgUsers` (+ legacy `user_*` config JSON) · `Configurations` (key-value: settings, SMTP, Zoho creds, legacy `crm_*` contacts) · `Shifts` · `StockMovements` (ledger: item, sku, type, qty delta, before/after, reference, reason, actor + warehouse columns) · `Warehouses` + `WarehouseStock` + `StockTransfers`/`TransferItems` (multi-warehouse + transfers) · `Customers` (profile + loyalty_points/lifetime_points/tier/joined/last-activity) + `CustomerActivity` (points audit) · `UserAuditLog` (actor/action/entity/old/new/IP/user-agent for every mutating call). **Absent as tables:** Payments, Roles (payments embedded; roster = `user_*` JSON + `OrgUsers`).
```
Products ──< OrderItems >── Orders ──(books_invoice_id)──▶ Zoho Books
  │                        │── customer_name (denormalized string)
  │                        └── payment_mode/status (embedded)
Organizations ──< OrgUsers ──▶ Catalyst users (approval flow)
Configurations (settings/SMTP/creds/crm_*) · Shifts (API-only)
```

## 4.5 Current Integrations
Active: **Zoho Books** (OAuth connect, org/item/contact pull, invoice + payment recording on checkout, catalog sync, ~460-line service) · **SMTP** (configurable; password never returned; approval/status mails). Planned (absent): payment gateway (modes are labels), WhatsApp, AI.

## 4.6 Current Hosting
Zoho Catalyst hosts both tiers (function `pos_backend` + static client at `/app`). Vite build with `base: '/app/'`; SPA fallback via generated `dist/404.html`. API base same-origin `/server/pos_backend/api` in PROD (`localhost:3000` in dev). Development + Production envs provisioned.

## 4.7 Current Navigation
Level 1 = 70px dark icon rail (tooltips, glow active state). Level 2 = 220px glass context panel (collapsible, sticky selection, section-grouped). Level 3 = workspace with `Dashboard › Module › Page` breadcrumbs; single-active-tab guarantee; tablet/mobile drawers; Mobile Device Gate for phones/tablets (`cloudhub_mobile_override`).
```
Dashboard (rail only — single-section modules hide the panel)

Inventory
├ Products          (/inventory/products, alias /products)
├ Categories        (/inventory/categories)
├ Stock             (/inventory)
├ Warehouses        (/inventory/warehouses)
├ Transfers         (/inventory/warehouses#transfers)
└ Adjustments       (/inventory/adjustments)

Sales
├ POS               (/sales/pos, alias /pos)
├ Orders            (/sales/orders, alias /orders)
├ Payments          (/sales/payments)
├ Returns           (/sales/returns)
└ Invoices          (/sales/invoices)

Customers
├ Customers         (/customers)
├ Loyalty           (/customers/loyalty)
└ Rewards           (/customers/rewards)

Reports (in-page anchors on /reports)
├ Sales             (#revenue)
├ Inventory         (#inventory)
├ Customers         (#customers)
└ Profit            (#profit)

Administration
├ Users             (/admin/users, alias /users)
├ Roles             (/admin/roles)
├ Activity          (/admin/activity)
└ Audit             (/admin/audit)

Settings (grouped sections)
Business Settings
├ General           (/settings#general, alias /settings)
├ Business          (/settings/business)
└ Taxes             (/settings#taxes)
Store Configuration
├ Notifications     (/settings#email)
├ Integrations      (/settings#integrations)
└ Automation        (/settings/automation)
```
Notes: `/customers/membership` and the Reports `#register` section exist in code but were deliberately left out of the rail/panel map.

## 4.8 Current Pages
| Route(s) | Page | Purpose (as built) | Done |
|---|---|---|---|
| `/landing` | Landing | Marketing: hero + CSS product mockups + features/stats/demo/integrations/pricing | 95% |
| `/login` | Login | Catalyst hosted-login embed + fallback, session polling | 95% |
| `/register` | Register | 3-step org onboarding → `POST /api/organizations/register` → pending + approval email | 95% |
| `/dashboard` | Dashboard | KPI row, slim hero, sales-activity pipeline, recent orders, low stock, insights, top products, activity | 95% |
| `/sales/pos` (`/pos`) | POS | Category browse, search/SKU scan, cart, customer, % discount, Cash/Card/Bank, receipt banner | 80% |
| `/inventory/products` (`/products`) | Products | Table/grid, filters, bulk delete, Books sync, drawer details, stock adjust modal | 85% |
| `/inventory`, `/inventory/{categories,adjustments,warehouses}` | Inventory + WorkspaceView | Stock table + adjust; category/brand grouping; adjustment console; single-location summary + transfers empty state | 70% |
| `/customers`, `/customers/{loyalty,rewards,membership}` | Customers + views | Directory + tiers/filter, VIP widgets, profile + timeline + loyalty balances/activity, real loyalty ranking, rewards disabled-state, CSV export | 100% |
| `/sales/orders` (`/orders`), `/sales/{payments,invoices,returns}` | Orders + views | Server-filtered history + six-section detail drawer + CSV export + cashier attribution; payment split; invoice list; full Returns flow | 100% |
| `/reports` (+ `#revenue/#inventory/#customers/#profit/#register`) | Reports | Global range/filter bar, server revenue/profit/customer/register/performance, per-section CSV + branded PDF, role scoping | 100% |
| `/admin/users` (`/users`), `/admin/{roles,activity,audit}` | Users + views | Lifecycle (invite/activate/deactivate/delete/reset/role), scope matrix, business activity feed, actor audit log with exports | 100% |
| `/settings` (+ anchors), `/settings/{business,automation}` | Settings + views | Company profile + logo, tax modes/profiles/calculator, notifications, SMTP, health-aware integrations, role-gated saves | 100% |

## 4.9 Current APIs (35 routes, base `/server/pos_backend/api`)
| Endpoint | Purpose | Used by UI? | Status |
|---|---|---|---|
| `GET /api/health`, `GET /api/setup/status` | Health / table diagnostics | Indirect (docs) | ✅ |
| `GET /api/auth/me` | Session truth (401 if none) | AuthContext, guards, Login, RootEntry | ✅ |
| `GET /api/auth/url`, `GET /api/auth/callback` | Zoho OAuth chain (Books) | Settings connect | ✅ |
| `POST /api/auth/disconnect` | Unlink Books | Settings | ✅ |
| `POST /api/auth/save-master-credentials`, `/seed-credentials` | Dev credential seeding | — (manual/ops) | ⚠️ unused by UI |
| `GET /api/organizations`, `GET /api/organization` | Books orgs / current org | — | ⚠️ unused by UI |
| `POST /api/organizations/register`, `GET /api/admin/approve-org`, `/reject-org` | Onboarding + email approval + Catalyst user creation | Register | ✅ |
| `GET /api/users`, `POST /api/users/update-role`, `POST /api/users/delete` | Roster (session+OrgUsers+legacy merge), role change, remove | Users, AuthContext | ✅ |
| *(no route)* `POST /api/users/invite` | — | Users invites → **always 404** | ❌ broken |
| `GET/POST /api/items`, `PUT/DELETE /api/items/:id` (409 on dup SKU at create) | Catalog CRUD | Products, POS, Inventory | ✅ |
| `POST /api/items/stock-adjust` (clamped ≥ 0, writes `StockMovements`, returns `movement_logged`) | Adjustments + audit | Products, Inventory, Adjustments view | ✅ |
| `POST /api/orders` (Books invoice + payment + local rows; **does not decrement local stock**) | Checkout | POS | ✅ with gap |
| `GET /api/orders` (latest 100) | History | Orders, Dashboard, Customers, Reports, Workspace | ✅ |
| `GET/POST /api/contacts` (Books or `crm_*` config JSON) | Customers | Customers | ✅ |
| `GET/POST /api/config/settings` (per-org prefixed keys) | Store profile/tax | Settings, Business view | ✅ |
| `GET/POST /api/config/smtp` (password never returned) | SMTP | Settings, Automation view | ✅ |
| `GET /api/auth/status` | Books connection state | Settings, Automation view | ✅ |
| `POST /api/sync/books`, `GET /api/sync/diagnose` | Books pull / diagnostics | Sync button; diagnose unused | ✅/⚠️ |
| `POST /api/shifts/open|close`, `GET /api/shifts` | Shift float/reconcile/history | — | ⚠️ no UI |

## 4.10 Technology Stack
Evidence-only: versions are declared ranges from `react-app/package.json` and `functions/pos_backend/package.json`.
**Frontend:** React 19.1 (`^19.1.0`) — components/hooks · TypeScript ~5.8 — types/services · Vite 6.3.5 (+ plugin-react 4.4.1) — dev/build (`base: '/app/'`) · React Router DOM 7.18.3 — SPA routing · Lucide (`^1.45.0`) — icons · Hand-rolled CSS, no framework · `@zcatalyst/auth` 0.0.4 — hosted sign-in SDK.
**Backend:** Catalyst Advanced I/O Functions · Node.js (README: Node 18 local) · Express 4.19.2 (35 routes) · `zcatalyst-sdk-node` 3.4.0 · axios 1.7.2 (Books/OAuth) · nodemailer 9.0.3 (SMTP) · dotenv 16.6.1.
**Tooling:** npm + lockfiles · `tsc -b` (build-blocking) · ESLint 9 (non-blocking) · Catalyst CLI (`catalyst.json`, `.catalystrc`: project `POS`, Dev+Prod, `Asia/Colombo`) · Git (note: `node_modules`/`dist`/`.build` were committed before ignore existed).
```
React 19 + TS + Router (SPA, /app) → REST/JSON (same-origin)
→ Catalyst Function `pos_backend` (Express: auth, 35 routes, Books service, SMTP)
→ Catalyst Datastore (Products, Orders+OrderItems, Organizations, OrgUsers, Configurations, Shifts) + Zoho Books API
```

## 4.11 Categories Stabilization Pass (completed)
- **BigInt-safe ROWID handling:** all category/product row identifiers travel as exact digit strings end-to-end. `parseInt()`/`Number()` on 17-digit ROWIDs silently rounded one id onto another row (wrong-row writes, phantom 404s) — eliminated from every category/item write path (remaining `parseInt` uses are ports/quantities/shift rows, all small or out of scope).
- **Correct edit behavior:** verified create→POST / edit→PUT split; edit updates the same ROWID, never inserts (prior "edit duplicates" reports traced to rounded-id writes landing on wrong rows).
- **Category lifecycle finalized:** Create (unique, Active default) → Edit (rename propagates via link) → Deactivate (reversible, products unaffected) → Delete (blocked with count when linked, hard delete at zero) → Repair (`POST /api/categories/repair` fixes unambiguous links, reports the rest).
- **Display chain:** `category_id → Categories.name → legacy text → General`, with invalid-link warnings in the product drawer and a one-click audit on the Categories page.

---

# 5. SRS vs Implementation

**Legend:** ✅ done · ◐ partial · ❌ missing. % = share of the requirement's acceptance evidenced in code.

## 5.1 Dashboard (DASH)
| Req | Planned | Implemented | % | St |
|---|---|---|---|---|
| DASH-01 | Revenue summary | Today + week + month + lifetime + 7-day chart + CSV | 100 | ✅ |
| DASH-02 | Orders count + status | Counts + pipeline strip (pending/offline/synced/invoiced) | 100 | ✅ |
| DASH-03 | New vs returning | Total + new + returning + active from order history (walk-ins excluded) | 100 | ✅ |
| DASH-04 | Profit from cost data | Actual margin from OrderItems × Products.cost_price (unknown-cost lines reported, never guessed) | 100 | ✅ |
| DASH-05/06 | Activity feed + insights | Orders + stock-movement audit trail, top sellers by units, slow movers, recommendations | 100 | ✅ |
| DASH-07 | Reorder-level flags | Per-product `reorder_level` via shared helpers (fallback 10 only when unset) | 100 | ✅ |
| DASH-08 | Admin/Manager only | Nav hidden + page guard redirects other roles to POS | 100 | ✅ |

## 5.2 POS (POS)
| Req | Implemented | % | St |
|---|---|---|---|
| POS-01/02/03/04/06/07 | Search/SKU scan, categories, cart, walk-in/customer + directory email fill, tax calc, Cash/Card/Bank | 100 | ✅ |
| POS-05 discounts | Order-level % + per-line %/flat (server-canonical math) | 100 | ✅ |
| POS-08 split payments | Cash/Card/Bank legs in Payments ledger, tender must equal total | 100 | ✅ |
| POS-09 receipt | Receipt modal + print + download + SMTP email | 100 | ✅ |
| POS-10 auto-decrement | Validated sale decrements `Products.stock` + SALE movements | 100 | ✅ |
| POS-11 reconcile guard | Server-verified totals; tender mismatch rejected | 100 | ✅ |
| POS-12 void | Admin/Manager void restores stock + VOID movements, order VOIDED | 100 | ✅ |
| Returns/RMA | `POST /api/orders/:id/return` validates ordered-minus-returned, restocks + RETURN movements, negative refund legs, Refunded flip, loyalty reversal, customer email; Returns page + recent-returns feed | 100 | ✅ |

## 5.3 Products (PROD)
PROD-01/02/06/07 ✅ · PROD-03 delete blocked with order count when referenced (409 + deactivate path) ✅ · PROD-04 unique SKU on create ✅ (update keeps SKU immutable) · PROD-05 multi-category via `category_ids` array, primary link + legacy text preserved ✅ · PROD-08 File Store images (upload/replace/delete/preview, 1.5 MB cap, avatar fallback) ✅ · PROD-09 CSV export + validated import (per-row errors) ✅.

## 5.4 Inventory (INV)
INV-01 per-warehouse stock ✅ (`WarehouseStock` + per-warehouse view/filter) · INV-02 valuation ✅ · INV-03 adjustments + quick ±1 ✅ (legacy + warehouse-scoped) · INV-04 multi-warehouse ✅ (`Warehouses` CRUD, default, deactivate, 409-on-stock delete) · INV-05 transfers ✅ (Draft→Pending→Approved→Completed/Cancelled, TRANSFER_OUT/IN ledger) · INV-06 movement log ✅ (adjust/POS/void/transfer/return paths; `GET /api/stock-movements` + Movements ledger page with filters, summary and CSV) · INV-07 per-product reorder levels ✅ · INV-08 backorder policy ✅ (`allow_backorders` setting; 400 Insufficient Stock when off, Backordered status when on). `Products.stock` = `SUM(WarehouseStock.quantity)` with best-effort mirrors on all legacy writes.

## 5.5 Customers (CUST) — 100% complete
CUST-01 profiles ✅ (name/phone/email/address/company + edit/delete with role gates) · CUST-02 purchase history ✅ (profile timeline + detail API recent orders) · CUST-03 analytics ✅ (AOV, 30-day frequency, totals, growth, top spenders, retention widgets) · CUST-04 LTV ✅ (server-computed from non-voided orders; verified against client totals) · CUST-05 loyalty ✅ (`Customers.loyalty_points` + `lifetime_points` + `tier`; 1 pt / LKR 100 auto-accrual at checkout; Admin/Manager manual adjustments audited in `CustomerActivity`; campaigns + redeem-to-voucher on the Rewards page) · CUST-06 search ✅ (name/email/phone/company, partial, case-insensitive, server + client filtering).

## 5.6 Orders (ORD) — 100% complete
ORD-01 history ✅ · ORD-02 full detail ✅ (lines with discount/tax/line-total, split-payment breakdown, totals, customer loyalty context, cashier, movement trail) · ORD-03 payment status ✅ (derived Paid/Partially Paid/Unpaid/Pending/Void/Refunded) · ORD-04 server-side filters ✅ (status, payment status, customer autocomplete, cashier autocomplete, today/yesterday/week/month/custom ranges) · ORD-05 search ✅ (order/invoice/reference/customer/email, partial).

## 5.7 Reports (RPT) — 100% complete
RPT-01 date ranges ✅ (9 presets + custom; every card recalculates server-side) · RPT-02 product performance ✅ (best/worst/profit/turnover/slow movers) · RPT-03 customer analytics ✅ (new/returning/frequency/loyalty/trend) · RPT-04 cost-basis profit ✅ (revenue/COGS/margin by product/category/day; heuristic kept as fallback) · RPT-05 registers ✅ (per-cashier, shifts with variance, cash/card, refunds, voids) · RPT-06 CSV ×7 server-built ✅ + branded PDF ✅ (zero-dependency engine: KPIs, tables, bar charts, footers, page numbers).

## 5.8 Users/Roles (USR) — 100% complete
USR-01 invites ✅ (Catalyst register best-effort + roster + audit; toggle in Settings) · USR-02 four built-in roles + Waiter/Chef compat ✅ (Storekeeper 400 fixed) · USR-03 RBAC ✅ (`roleCan` matrix + handler guards; settings/SMTP/keys, catalog, stock, checkout, dashboard, shifts, sync, user endpoints all gated) · USR-04 lifecycle ✅ (activate/deactivate/delete with self + last-Admin guards; suspension enforced in session resolution) · USR-05 audit ✅ (auto-middleware `UserAuditLog` with actor/action/entity/IP; filterable Admin view with metrics, detail drawer, CSV/PDF exports, retention sweep).

## 5.9 Settings (SET) — 100% complete
SET-01 company profile ✅ (name/legal/address/city/province/postal/country/phone/email/website/reg + tax numbers; logo upload 5 MB PNG/JPG/WebP with preview/replace/remove, embedded in emailed receipts) · SET-02 tax rules ✅ (enable, name, default rate, exclusive/inclusive modes, per-line rounding, ≤20 profiles; product Use-default/Custom/Exempt selector; preview calculator; checkout/POS/receipts share one proven formula set) · SET-03 SMTP ✅ (untouched engine; notifications reuse it) · SET-04 notifications ✅ (11 types × channels, low-stock threshold/recipients/immediate-vs-daily, alert email; immediate low-stock + void + sync-failure emails wired; on-demand digest sender; scheduled delivery still pending infra) · SET-05 integrations ✅ (Zoho connect preserved; health card adds token expiry, last sync time/result, SMTP status; tender methods configurable and enforced; no external gateway credentialed — manual tender only). Company logo ✅ embedded in emailed receipts and natively in PDF exports (PNG/JPEG); display currency follows store settings.

## 5.10 Module roll-up
| Module | Planned | Implemented | % | Status |
|---|---|---|---|---|
| Dashboard | Revenue+insights+low stock | All + pipeline, minus DASH-03/04/08 gaps | 95 | ✅ |
| POS | Full checkout | Checkout minus split/void/print/decrement | 80 | ◐ |
| Products | Catalog CRUD | CRUD + grid/drawer/sync, minus images/import/cost | 85 | ◐ |
| Inventory | Multi-warehouse control | Warehouses + per-warehouse stock + transfers + backorder policy; aggregates stay in sync | 100 | ✅ |
| Customers | Profiles+history+LTV | All + loyalty engine (points, tiers, audit) + analytics + CSV export | 100 | ✅ |
| Orders | History+detail+status | Full detail drawer + server filters + export + cashier attribution | 100 | ✅ |
| Reports | 5 reports + export | 5 server reports + global filters + CSV ×7 + branded PDF + role scoping | 100 | ✅ |
| Users/Roles | 4 roles + audit | Lifecycle + RBAC gates + auto audit trail + exports + admin settings | 100 | ✅ |
| Settings | Profile/tax/SMTP/notif/integrations | Company + logo, tax modes/profiles, notification prefs + wired alerts, integration health, role-gated saves | 100 | ✅ |
| Auth/Landing/Login/Register | Catalyst session + onboarding | Complete incl. approval flow | 95 | ✅ |
| Navigation/UX | Enterprise shell | Rail+panel+gate, skeletons, responsive | 95 | ✅ |

---

# 6. Risk Assessment

## 6.1 Security Risks
| # | Risk | Impact | Severity |
|---|---|---|---|
| R-01 | Unknown Catalyst users default to Admin role | Any authenticated email outside the roster gets full access | **High** |
| R-03 | Approve/reject org links are unauthenticated GETs | Anyone with the link can approve/reject organizations | **High** |
| R-05 | ~~No user-action audit log (USR-05)~~ ✅ `UserAuditLog` auto-middleware + Admin view + exports | Residual: LOGIN/LOGOUT are session-native (Catalyst-owned) and not logged as events | **Low** |
| R-08 | Open CORS (`*`) unless env-locked; no rate limiting seen | API abuse surface larger than necessary | **Medium** |

## 6.2 Data Integrity Risks
| # | Risk | Impact | Severity |
|---|---|---|---|
| R-02 | Checkout never decrements `Products.stock` | Stock accuracy decays with every sale; replenishment signals go stale | **High** |
| R-09 | Profit/LTV are fixed-heuristic estimates (no cost data) | Margin decisions made on approximations | **Low** |

## 6.3 Operational Risks
| # | Risk | Impact | Severity |
|---|---|---|---|
| R-04 | `update-role` rejects Storekeeper (400) while UI offers it | Role assignment fails for a core SRS role | **Medium** |
| R-07 | No external payment gateway credentialed (manual tender only; methods configurable + enforced) | Real card/digital settlement unproven end-to-end | **Medium** |
| R-10 | ~~Currency selector not applied (LKR hardcoded)~~ ✅ display currency follows store settings (per-call override retained) | — | **Low** |

## 6.4 Technical Risks
| # | Risk | Impact | Severity |
|---|---|---|---|
| R-06 | Zero automated tests (no runner, no suites) | Every release risks silent regression; verification is manual | **Medium** |

---

# 7. Project Health

| Area | Score | Why |
|---|---|---|
| Frontend | 9 | Typed, modular, primitives, skeletons, responsive; cost-basis profit, store-driven currency |
| Backend | 8 | 35 routes, sanitized ZCQL, safe fallbacks; gaps: no stock decrement, no invite route, Storekeeper 400 |
| Authentication | 8 | Catalyst-only, server-verified, approval flow; minus: unknown→Admin default, diag logs |
| Routing | 9 | Canonical+alias model, breadcrumbs, SPA fallback present |
| API Design | 8 | Consistent JSON + status codes; minus: unused/shift/invite/diagnose surface |
| Database Design | 8 | Denormalized pragmatism: warehouses, transfers, customers, audit log tables live; roster/campaigns/tender config in Configurations JSON; ledger covers all stock paths + queryable API |
| UI Quality | 9 | Unified glass system across app + onboarding |
| UX Quality | 9 | Workflow-first nav, density, empty/loading states; mobile gate instead of full mobile UI |
| Security | 6 | HTTPS, RBAC, no plaintext creds, secrets server-side; minus: unknown→Admin, unauthenticated approve/reject GET links, default-open CORS, no rate limiting seen |
| Scalability | 8 | Serverless + stateless functions; orders capped at 100/300 rows (fine now, paginate later) |
| Maintainability | 8 | Service-per-topic, navigation model, shared UI; minus: 2.5k-line backend file, `any` remnants in landing demo |
| Documentation | 5 | README + code comments good; **no API reference, no ERD doc, no runbook** — this file is step one |
| Testing | 2 | No test runner, no unit/integration/E2E seen; verification is manual + `tsc`/build |
| Deployment | 7 | `catalyst.json` + scripts correct; Dev+Prod envs exist; refresh-404 mitigated via `404.html` |

## Current System Status
| Indicator | State | Why |
|---|---|---|
| Internal Demo Ready | ✅ | Full journey runs: landing → login → POS sale → reports |
| Business Review Ready | ✅ | KPIs, pipelines and Books sync demonstrable on live data |
| Stakeholder Review Ready | ✅ | SRS traceability (this document) complete |
| Pilot Ready | ✅ | Single-store pilot feasible under supervision |
| Production Hardening Needed | ⚠️ | R-01–R-03, CORS, approval-link signing still open |
| Production Certified | ❌ | No test automation, no audit log, no load validation |

## Project Maturity Summary
| Area | Completion % | Status | Risk | Priority |
|---|---|---|---|---|
| Frontend | 88% | ✅ Advanced | Low | P2 |
| Backend | 80% | ◐ Substantial | Medium | P1 |
| Authentication | 90% | ✅ Advanced | Medium (R-01) | P0 |
| POS | 80% | ◐ Substantial | High (R-02) | P0 |
| Inventory | 100% | ✅ Complete (§5.4) | Medium | P1 |
| Orders | 100% | ✅ Complete (§5.6) | Low | P1 |
| Reports | 100% | ✅ Complete (§5.7) | Low | P1 |
| Users | 100% | ✅ Complete (§5.8) | Medium (R-04) | P0 |
| Settings | 100% | ✅ Complete (§5.9) | Low | P2 |
| Testing | 5% | ❌ Missing (R-06) | High | P0 |
| Documentation | 65% | ◐ Growing (this file) | Low | P2 |
| Security | 60% | ⚠️ Hardening needed (R-01/03/08) | High | P0 |

---

# 8. Work Remaining

## Critical (correctness / SRS Must-Haves)
- Decrement `Products.stock` on checkout (POS-10) + reconcile Books vs local counts
- Unknown-user → Admin default (NFR-SEC-02): explicit deny or pending state
- `update-role` accepting Storekeeper (or remove role from UI) — USR-02 400-path
- Restrict Dashboard to Admin/Manager (DASH-08) or re-baseline SRS
- In-app invite: add `POST /api/users/invite` or remove dead UI path (USR-01)
- Approve/reject links: add token + expiry (state-changing authed GETs today)

## Important (Should-Haves)
- Reports date ranges + PDF export; register/shift UI for existing Shifts API
- Order line-items in detail modal; cashier filter; activate/deactivate users
- Per-product reorder levels; replace fixed ≤10 flag
- Product images (File Store), cost price, CSV import, multi-category

## Optional / Future (SRS §9)
~~Loyalty points field + program~~ ✅ shipped (points engine, tiers, audit, auto-accrual, campaigns + redeem-to-voucher) · ~~multi-warehouse~~ ✅ shipped (warehouses, transfers, backorders) · ~~user-action audit log~~ ✅ shipped (`UserAuditLog` auto-trail + Admin view + exports) · ~~voids/returns~~ ✅ shipped (RMA endpoint + Returns page + ledger) · AI assistant, WhatsApp, smart reordering, health score, **offline POS**, forecasting, hardware peripherals, split payments, external payment gateway.

---

# 9. Roadmap

## Phase 1 — Correctness & Security (S–M, ~2–3 wks) — Priority: P0
Goal: close Must-Have gaps. Stock decrement + recount tool; RBAC hardening (unknown-deny, Dashboard gate, Storekeeper role); signed/expiring approval links; CORS lockdown; remove diag logs. *Modules: POS, Users, Auth, Settings.*

## Phase 2 — Reporting & Registers (S, ~2 wks) — P1
Goal: SRS-grade analytics. Date-range engine, PDF export, Shifts UI (open/close/history from existing API), cashier filter, line-items in order detail. *Modules: Reports, Orders, Users.*

## Phase 3 — Inventory Depth (M, ~3 wks) — P1
Goal: real warehouse control. Warehouses table, transfers with ledger (extend `StockMovements` to POS/returns/transfers), per-product reorder levels, backorder policy, negative-stock guard. *Modules: Inventory, Products.*

## Phase 4 — Commerce Completeness (M, ~3 wks) — P2
Goal: checkout parity. Split payments, voids/returns ✅ shipped, printable + emailed receipts (SMTP) ✅, product images, cost/profit truth, CSV import, tender-method governance ✅ (external gateway still open). *Modules: POS, Products, Customers, Settings.*

## Phase 5 — Growth & Intelligence (L, phased) — P3
Goal: SRS §9 futures. Loyalty/Rewards schema + UI, WhatsApp, AI insights, forecasting, health score, offline POS, peripherals. *Requires separate scoping per item.*

## Platform Track (new — CloudPartners operations)
- Deployment management: templated provisioning runbook → scripted project creation, env/SMTP/Books/domain checklist, deployment registry, per-customer health checks.
- Licensing: plan catalog (Starter/Business/Enterprise), entitlement store per deployment, application-enforced user limits, renewal/expiry handling.
- Feature flags: flag service + admin UI, per-deployment toggles for Loyalty/Rewards/WhatsApp/AI/Offline/Forecasting, safe defaults.
- Advanced modules: warehouses/transfers ledger, commerce completeness, then intelligence features — each unlocked behind flags per plan.

---

# 10. Project Completion

| Dimension | Estimate | Basis |
|---|---|---|
| Frontend | **88%** | All screens + nav + onboarding live; gaps are depth (ranges, PDF, images, prefs) |
| Backend | **80%** | 35 routes live; missing decrement, invite, warehouses, movements, audit |
| **Overall** | **~85%** | Weighted by SRS Must-Haves present |
| MVP readiness | **90%** | A store can sell, stock-take, report and onboard today |
| Production readiness | **70%** | Pending Phase-1 security/correctness items + zero automated tests |

> Auditor's note: percentages measure SRS Must/Should coverage evidenced in code, not effort. The single highest-leverage fixes are the checkout stock-decrement, the unknown→Admin default, and signed approval links — all Phase 1.

---

# 11. Technical Recommendation (Final)

**Build next, in this order:** Phase 1 Correctness & Security (stock decrement, unknown-deny, Storekeeper role, Dashboard gate, invite fix, signed approval links, CORS lockdown) → Phase 2 Reporting (date ranges, PDF, Shifts UI, line-items, cashier filter) → Phase 3 Inventory Depth (warehouses, transfers ledger, movements, reorder levels) → Phase 4 Commerce Completeness (split/void/receipts, images, import, gateway) → Phase 5 Future Enhancements.

**Do NOT build yet:** AI Assistant, Loyalty program, WhatsApp integration, and Forecasting — explicitly deferred until the Phase-1 correctness defects (R-01, R-02, R-03) are closed, since each future feature compounds on inventory accuracy, role trust, and approval integrity.

**Sequencing rationale:** correctness before depth (nothing built on drifting stock), security before scale (unknown-Admin + open links gate production), reporting before intelligence (AI/forecasting need trusted history first).

---

# Appendix A — Catalyst Development environment, actual state (25 Sep 2026)

Verified from live `GET /api/health`, `GET /api/setup/status`, `GET /api/auth/status`, console table schemas pasted by owner, function/user/bucket listings, and code cross-checks (`functions/pos_backend/index.js` line refs). No code changed for this appendix.

## A.1 Live checks

- `/api/health` → `ok` (`Cloud POS SaaS`). Function `pos_backend` (Node 18, AdvancedIO) exists — but created **Jun 23**, so Sep code (KOT, Stratus, tests) may not be deployed. **Redeploy functions before testing anything below.**
- `/api/auth/status` → `catalyst_connection: true`, `master_configured: true`, `dc: com`, `org_id: null`, `connected: false`. Zoho Books is **not connected** — action is in-app (Settings → Connect), no console work.
- 8 Catalyst app users exist (roles live in `OrgUsers`, not in console).
- Stratus bucket `companyassets` exists (Sep 24). Env var presence (`STRATUS_ASSETS_BUCKET` etc.) still unverified — check console.
- `node test_tables_exist.js` fails locally with `app/invalid_app_object` — **expected**: the SDK needs function context. Use `catalyst serve` or the live `/api/setup/status` instead.

## A.2 Tables: have vs missing (`all_tables_ready: false`)

| Have (rows) | Missing |
|---|---|
| Products (1), Orders (1), OrderItems (1), Configurations (1), Organizations (1), StockMovements (1), Categories (1), Customers (0), CustomerActivity (0) | `OrgUsers`, `Warehouses`, `WarehouseStock`, `StockTransfers`, `TransferItems` |

`Payments`, `UserAuditLog` are not in the setup matrix — `Shifts` exists (schema pasted), other two **must be eyeballed in console**.

## A.3 Column gaps (code SELECTs vs pasted schemas — add these)

| Table | Add (type) | Evidence |
|---|---|---|
| `Products` | `category_ids`, `image_id`, `image_name`, `image_mime` (text) | `:2032` SELECT; multi-category + Stratus images break without them |
| `Orders` | `cashier_name`, `created_by` (text) | `:2540` insert, `:2794-2795` read; best-effort today, registers/attribution need them |
| `StockMovements` | confirm `warehouse_id`/`warehouse_name` present if per-warehouse adjusts write them | `:5667`, `:5865` read them |

Correction to §7.3: KOT station split does **not** use a `Categories.station` column — `stationForLine` maps `Products.category_id/category` through the routing JSON (`:11247+`). No Categories change needed. Customer metrics (`order_count`, `lifetime_value`, …) are computed in code (`:6471+`), no new Customer columns required.

## A.4 Create these tables with exactly these columns

- `OrgUsers`: `org_id`, `user_id`, `role`, `display_name` (`:625`, `:4515-4521`). Then insert one roster row per staff email (owner → `master_admin`/`Admin`); until then R-01 applies (everyone resolves Admin).
- `Warehouses`: `name`, `code`, `description`, `address`, `contact_person`, `contact_phone`, `status`, `is_default`, `created_at`, `updated_at` (`:5028`).
- `WarehouseStock`: `warehouse_id`, `product_id`, `quantity`, `reorder_level`, `created_at`, `updated_at` (`:5156`).
- `StockTransfers`: `transfer_number`, `source_warehouse_id`, `destination_warehouse_id`, `status`, `notes`, `created_by`, `approved_by`, `completed_by`, `created_at`, `approved_at`, `completed_at` (`:6017-6029`).
- `TransferItems`: `transfer_id`, `product_id`, `quantity` (`:5904`).
- `Payments`: `order_id`, `mode`, `amount` (`:2567`; fail-open, but register ledger needs it).
- `UserAuditLog`: `user_id`, `actor_id`, `actor_name`, `actor_role`, `action`, `entity_type`, `entity_id`, `entity_name`, `old_value`, `new_value`, `ip_address`, `user_agent`, `created_at` (`:9063-9077`; fail-open, audit trail needs it).

## A.5 What remains Catalyst-console work vs code work

Console (no code): create 5–7 tables + 6 column adds (§A.3–A.4) → insert `OrgUsers` roster rows → confirm env vars → redeploy `pos_backend` → in-app Zoho Connect → re-run `/api/setup/status` until `all_tables_ready: true`.
Code (after console is green): KOT terminal dispatcher; `npm test` + verify on Development (company save→reload, customers 200, logo/image round-trips, full KOT cycle); then Phase-1 security items (unknown-deny R-01, signed approval links R-03, CORS lockdown R-08).

## A.6 Decision (25 Sep 2026): Zoho Books integration DEFERRED

Owner parked Zoho Connect for later. Impact: checkout runs in `Offline Pending` mode (orders kept locally, Books invoice/payment sync skipped by design); catalog sync from Books unavailable (use CSV import + manual products instead). Nothing else is blocked — KOT, transfers, reports, audit, loyalty, verification all run without Books. Revisit: Settings → Connect when ready; no code or console rework needed then.

## A.7 Sync verification — created tables vs code (25 Sep 2026, read-only audit)

Owner pasted all 15 created schemas; every read (`SELECT`) and write (`insertRow`) in `index.js` was traced. Verdict: **14 of 17 tables fully in sync. Nothing hard-breaks** (all risky writes have try/catch fallbacks), but 2 tables silently lose data and 1 column corrupts data:

| Table | Reads | Writes | Status |
|---|---|---|---|
| `Organizations`, `Categories`, `Customers`, `CustomerActivity`, `Warehouses`, `WarehouseStock`, `TransferItems`, `StockTransfers`, `UserAuditLog`, `Shifts`, `Configurations`, `OrgUsers`, `Products` (+4 new cols), `Orders` (+2 new cols) | all selected columns exist | all inserted keys exist | ✅ Fully synced |
| `OrderItems` | ✅ | ⚠️ `discount_value`, `discount_type` missing — `:2556` falls back to base insert, per-line discount detail lost | Add `discount_value` (double), `discount_type` (text) |
| `StockMovements` | ✅ base | ⚠️ `warehouse_id`, `from_warehouse_id`, `to_warehouse_id` missing — `:203-260` falls back to legacy movement, per-warehouse audit lost | Add 3× text columns |
| `Payments` | ✅ | ❌ `amount` is `int` — LKR cents truncated on every leg | Change to double/Decimal (table empty, safe) |

Type advisories (only if fractional units are sold): `WarehouseStock.quantity`/`reorder_level` and `TransferItems.quantity` are `int` while `Products.stock` is `double` — prefer double/Decimal.
Confirmed not needed: `Categories.station` (routing is JSON-driven, `:11247+`), new `Customers` metric columns (computed in code, `:6471+`).
Requirements status: tables requirement ✅ done pending the 5 column adds + 1 type fix above; remaining requirements unchanged — roster rows → env confirm → redeploy → Zoho Connect → setup/status green → code phase.

## A.8 Setup green (25 Sep 2026)

Owner reports: `OrgUsers` created with first roster row; `/api/setup/status` → `"all_tables_ready": true` (all 14 tables exist; new tables at 0 rows as expected). Deploy date in console still shows the first deployment — freshness unverified. Zoho stays deferred (§A.6). Pending: full roster rows, deploy-freshness check, env confirm.

## A.9 Invite/role hardening (25 Sep 2026, code — uncommitted)

Owner's rule "only Admin invites, roster auto-maintained" is now code: `syncOrgUserRole` upserts `OrgUsers` rows (email-keyed) on invite (`POST /api/admin/users`), both role-change endpoints, and session login self-heals numeric-id rows to email keys; `OrgUsers` lookup matches numeric id OR email. `POST /api/admin/users` is Admin-only (button gated to `isAdmin`, backend 403s non-Admin). Hardcoded dev Admin bypass removed — that account now resolves like everyone else (still Admin via fallback until its roster row exists). Verified: `node --check` clean, `npm test` 37/37 green, `vite build` clean. R-01 stays open until roster is complete; unknown-deny is a separate future step (would lock out row-less staff today).

## A.10 Invite diagnosis + retry fix (25 Sep 2026, code — uncommitted)

Symptom: invite created the Catalyst auth user but sent no password mail, wrote no `OrgUsers` row, and retry 409'd. Causes: (1) `registerUser` (SDK) never sends password mail — Catalyst emails it only for console invites; members set first passwords via Reset password / hosted-login "Forgot password". (2) Deployed backend predates the upsert, so no row was written. (3) 409 was correct duplicate protection with a dead end. Fix: invite retry is now idempotent — it heals the missing `OrgUsers` row and returns 200 guiding to the password path. Verified: `node --check` clean, `npm test` 37/37 green. Action: deploy, then retry the stuck invite once (heals row) + Reset password for mail.

## A.11 Invite emails via store SMTP (25 Sep 2026, code — uncommitted)

Owner asked why no mail can be sent and whether code can do it — yes: new `sendInviteEmail` helper (best-effort, never blocks) sends a welcome mail through the store SMTP (role, sign-in link to hosted login, first-time "Forgot password" instructions). Wired into fresh invites, idempotent retries, and reset-password (whose message now reports the real mail outcome instead of implying `registerUser` mailed). Requires SMTP configured (env or Settings → SMTP) or responses honestly direct to "Forgot password". Verified: `node --check` clean, `npm test` 37/37 green. Action: deploy, then invite/retry sends real mail.

## A.12 Platform password link via resetPassword API (25 Sep 2026, code — uncommitted)

Owner reported: welcome mail arrives and `OrgUsers` row is created, but no Authentication account and the mail holds a login link, not a signup link. Root causes: (1) retry path never called `registerUser`, so a missing auth account stayed missing; (2) `registerUser` sends no reliable mail. Fix: new `ensureAuthAccount` helper — `registerUser`, then `resetPassword(email, {platform_type})` which hits `/project-user/forgotpassword` and makes Catalyst itself email a password link; outcome surfaced as `auth_account/password_email_sent`. Used in fresh invites, idempotent retries (now also repairs missing auth accounts), and reset-password (primary channel, SMTP reminder as backup). Verified: `node --check` clean, `npm test` 37/37 green. Action: deploy, retry invite once, confirm both mails arrive.

## A.13 Lifecycle persistence fix (25 Sep 2026, code - uncommitted)

Owner suspected role-change/delete work UI-only, and user data living in the browser. Findings: browser holds only UI prefs (mobile-override flag, workspace/panel keys) plus the SDK's internal ZAID cache - no roles/tokens/user data (role refetched from `/api/users` every mount). But delete was half-persistent: it removed only the Configurations row while the `OrgUsers` row survived, so "deleted" users kept signing in. Fix: new `adoptRosterUser` (console-only staff become manageable - role/status/profile edits auto-create their roster record) and `deleteOrgUserRows` helpers; change-role, update-role, activate, deactivate, PUT profile all adopt; both delete paths now remove roster + `OrgUsers` rows (last-Admin guard preserved). Verified: `node --check` clean, `npm test` 37/37 green. Remaining honesty notes: platform-login removal stays manual, and fully unknown emails still resolve Admin (R-01) until unknown-deny lands.

## A.14 Platform mail + org_id fix (25 Sep 2026, code - uncommitted)

Owner reported: welcome mail arrives and `OrgUsers` row is created, but no Authentication account exists and the mail holds a login link, not a signup link; plus invite rows stamped `org_id = org_default`. Findings: (1) Deployed code predates the `resetPassword` mail path (A.12, uncommitted) — only it makes Catalyst email a password link, i.e. the platform invite mail the owner wants. Deploy it, then one invite produces both mails. (2) Retry path skipped account creation — now repaired via `ensureAuthAccount` in retries too. (3) `org_default` stamps came from the inviter resolving via virtual fallback; new `resolveOrgId` reads the real Organizations ROWID, heals stale stamps on update, and the roster listing now merges `org_default` rows so mixed teams list completely. To repair existing rows now: change each affected user's role once (upsert heals `org_id`), or wait for their next login (self-heal covers `user_id`). Verified: `node --check` clean, `npm test` 37/37 green. Action: deploy, invite once, confirm both mails + real `org_id` on the row.

## A.15 Fetch-reduction pass (25 Sep 2026, code - uncommitted)

Free-tier Datastore Fetch exhausted; measured burns: auth tax up to 5 reads/endpoint, Reports firing 6 heavy endpoints per filter change, login 2.5s + kitchen 20s polling. Changes: (1) Reports loads only the visible tab's endpoints (orders slice capped 500 to 200, other tabs keep last-loaded data); tab switches and Refresh fetch just that tab. (2) Auth diet: email-first `OrgUsers` lookup (one query common case), project-shape Organizations query first (one query common case) - typical request now 3 reads, zero behavior change. (3) Polling hygiene: login poll caps at ~5 min + pauses when tab hidden; kitchen 20s to 60s + pauses when hidden (manual Refresh kept). Verified: `node --check` clean, `npm test` 37/37 green, `vite build` clean. Action: deploy after quota resets, then confirm one tab-switch fires one report endpoint (function logs).
