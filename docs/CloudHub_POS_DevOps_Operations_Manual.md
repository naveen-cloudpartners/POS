# CloudHub POS — DevOps Operations Manual

| Field | Value |
|---|---|
| Project | CloudHub POS (Zoho Catalyst) |
| Audience | Senior DevOps Engineers, Technical Leads, CloudPartners Operations, New Engineers, Auditors, Maintainers |
| Source of truth | This repo: `catalyst.json`, `.catalystrc`, `functions/pos_backend/`, `react-app/`, `docs/CloudHub_POS_Project_Status.md` |
| Status model | One customer = one dedicated Catalyst project (see §21) |

> This is an **operations** manual, not a developer, coding, or API guide. It describes what a Senior DevOps Engineer owns, what exists, what must exist, and exactly how to run it day to day.

---

## Books operational checkpoint — 1 October 2026

Deploy both backend and frontend to enable the new Admin Settings → Integrations flow. No extra Catalyst Connection is required. Company OAuth credentials may be saved through the form; ZOHO_CLIENT_ID/ZOHO_CLIENT_SECRET environment variables are optional shared defaults. Confirm Configurations access and Products.org_id before product import, then register the exact environment callback and authorize/select the Books company.

Local build/type checks and mocked integration tests passed; live authorization remains pending. Verify seller checkout invoice/payment totals after connecting. Product changes made in Books appear only after manual import. Inspect partial invoices/payments before retrying failed posting; void/return reversal and historical backfill remain manual. Follow [Books setup and limits](zoho-books-integration.md).

# 1. Purpose

**Why DevOps exists.** Code that works on a laptop is not a product. Production operations — repeatable deploys, guarded configuration, watched integrations, recoverable data, and practiced incident response — is what turns the CloudHub POS codebase into a store owners can trust with real money, tax records, and customer data.

**Why CloudHub POS needs DevOps.** The system sits at the intersection of four failure domains with real-world consequences:

- **Money flow:** POS checkout → Zoho Books invoices → payment records. A broken deploy or expired OAuth token silently stops revenue recognition.
- **Inventory truth:** stock levels drive purchasing and prevent overselling. Silent data loss here compounds daily.
- **Regulated data:** tax figures, invoices, and customer PII per customer deployment. Each deployment is isolated — which also means each must be independently monitored, backed up, and patched.
- **Third-party coupling:** Zoho Books OAuth, SMTP delivery, and Catalyst platform services can each degrade independently of our code.

**What "production operations" means here.** Every customer deployment, every day: known-good code running, secrets present and unexpired, tables provisioned, Books connected, mail flowing, movements logging, anomalies noticed within hours, and any change reversible within minutes.

---

# 2. CloudHub POS Architecture

## 2.1 Tiers

```
┌─ CLIENT ─────────────────────────────────────────────┐
│ React 19 + TypeScript + Vite SPA (`react-app/`)      │
│ Served as static hosting at URL prefix /app          │
│ Login · Register · Dashboard · POS · Products ·      │
│ Inventory · Customers · Orders · Reports · Users ·   │
│ Settings · Workspace views                           │
└───────────────────────┬──────────────────────────────┘
                        │ HTTPS REST/JSON, same origin
                        │ (/server/pos_backend/api/*)
┌─ APPLICATION ─────────▼──────────────────────────────┐
│ Catalyst Advanced I/O Function `pos_backend`          │
│ Node.js + Express (~4,300 lines, 49 routes)          │
│ Auth/RBAC iraqi · business logic · SMTP (nodemailer) │
│ Zoho Books connector · stock-movement ledger         │
└───────────────────────┬──────────────────────────────┘
                        │ Catalyst SDK (server-side only)
┌─ DATA ────────────────▼──────────────────────────────┐
│ Catalyst Data Store tables (per deployment):         │
│ Products · Categories · Orders · OrderItems ·        │
│ Organizations · OrgUsers · Configurations ·          │
│ Shifts · StockMovements (+ Payments, best-effort)    │
│ Catalyst File Store: ProductImages folder            │
└──────────────────────────────────────────────────────┘
```

## 2.2 Frontend
Vite SPA built to `react-app/dist`. No server-side rendering, no secrets in the bundle (all credentials stay server-side). Talks to the backend same-origin; dev proxy targets `localhost:3000`.

## 2.3 Backend
Single Express app exported via `module.exports = app` (Catalyst loads it; it never listens on a port). 48 routes covering health, setup/diagnostics, auth + onboarding, users, catalog, categories, orders + receipts + voids, stock adjustments, contacts, settings, SMTP, shifts, Books sync, dashboard aggregation, CSV import/export, and product images.

## 2.4 Database
Zoho Catalyst Data Store, one isolated set of tables per customer deployment. No shared customer database. See §9 for the table inventory.

## 2.5 Authentication
Catalyst-hosted auth + per-project user roster (`OrgUsers`). Sessions are verified server-side on every business route (401 without session). Role model: Admin, Manager, Cashier, Storekeeper (+ Waiter/Chef for floor use); Dashboard is Admin/Manager-only by nav + page guard.

## 2.6 Integrations
- **Zoho Books** (OAuth: invoice create, payment record, customer resolve, catalog pull). Per-deployment connection.
- **SMTP** (nodemailer; env vars first, Configurations-table fallback). Per-deployment credentials. Used for approval mails and receipt mails.

## 2.7 Deployment model

```
CloudPartners
    ↓  maintains
CloudHub POS Template (this repo)
    ↓  deployed per customer
Dedicated Catalyst Project
    ↓  contains
Dedicated Database · Dedicated Authentication ·
Dedicated SMTP · Dedicated Books Connection
```

Isolation is the product's core safety property: a breach, outage, or misconfiguration in one deployment cannot leak into another. The operational cost is N of everything — which is exactly what this manual systematizes.

---

# 3. Senior DevOps Responsibilities

| Area | Owns | Means in practice |
|---|---|---|
| Deployments | Every release to every environment | Build → verify → deploy → validate → rollback plan (§7–8) |
| Infrastructure | Catalyst projects, envs, domains, File Store | Provisioning, env parity, quota/headroom (§4–5) |
| Security | Secrets, access, audit trails | Env-var hygiene, OAuth renewals, permission reviews (§13) |
| Monitoring | App, API, business, and integration health | Daily checks + alert thresholds (§10–11) |
| Backups | Catalog, orders, ledger, config | Export cadence + restore drills (§14–15) |
| Documentation | This manual + deployment registry | Every customer deployment recorded (§21) |
| Incident response | P1–P4 triage through resolution | Runbooks + severity discipline (§16) |

A Senior DevOps Engineer does not write product features. They own everything that determines whether the product survives contact with production.

---

# 4. Environment Management

| Environment | Catalyst env | Purpose | Data | Who may change it |
|---|---|---|---|---|
| Development | Development (type 3) | Integration testing, Books sandbox, auth flows | Test/fake data only | Engineers |
| Testing | *(to provision — see below)* | Pre-production verification, release candidates | Anonymized snapshot | DevOps + QA lead |
| Production | Production (type 1) | Live customer traffic | Real customer data | DevOps only, via release process |

## Required per-environment configuration
1. All §6 environment variables set (values differ per env; never copy Production secrets into Development).
2. All §9 tables provisioned (verify via `GET /api/setup/status`).
3. Books OAuth connected to the correct Books organization (sandbox org for Dev/Test).
4. SMTP pointing at the correct mailbox (never customer-facing addresses from Dev/Test).
5. `CATALYST_APP_DOMAIN` set to the environment's domain (CORS + OAuth callbacks depend on it).

> **Gap to close:** no Testing environment exists today — Development doubles as integration. Provision one before the next production release (§22).

---

# 5. Zoho Catalyst Responsibilities

| Service | What DevOps owns on it |
|---|---|
| **Functions** | Deploy `pos_backend` target; Node 18 stack; monitor cold starts, timeouts, error rates in Catalyst logs |
| **Data Store** | Table provisioning (§9), schema-change review, export cadence (§14) |
| **Authentication** | Project user roster hygiene; OAuth app credentials (`ZOHO_CLIENT_ID/SECRET`); session behavior |
| **Environment Variables** | Per-env values, rotation, never in code/logs (§6, §13) |
| **Domains** | `pos-*.development` vs production domain; TLS; `CATALYST_APP_DOMAIN` parity |
| **Connections** | Books OAuth connection per deployment (expiry/reconnect runbook §15) |
| **File Store** | `ProductImages` folder exists; quota vs 1.5 MB/upload cap |
| **Monitoring** | Catalyst console metrics + `GET /api/health` as external probe |

---

# 6. Environment Variables

Full inventory, read from `functions/pos_backend/index.js` + `zohoBooksService.js`:

| Variable | Purpose | Risk if missing/wrong | Required in |
|---|---|---|---|
| `ZOHO_CLIENT_ID` | SaaS master OAuth app id (all Books flows) | **Critical** — no Books connect, sync, or invoice posting | All envs |
| `ZOHO_CLIENT_SECRET` | SaaS master OAuth secret | **Critical** + leak risk — full Books API access | All envs |
| `ZOHO_DC` | Books data-center (`com` default) | Wrong DC → auth against wrong region, sync fails | All envs |
| `SMTP_HOST` | SMTP server | Receipt/approval mail silently dead | Prod (all recom.) |
| `SMTP_PORT` | SMTP port (587/465) | TLS mismatch → mail fails | Where SMTP used |
| `SMTP_USER` | SMTP login | Auth failure → mail fails | Where SMTP used |
| `SMTP_PASS` | SMTP password | **High** leak risk — mailbox takeover | Where SMTP used |
| `SMTP_FROM` | Sender address | Deliverability/spam classification | Where SMTP used |
| `CATALYST_APP_DOMAIN` | App domain (CORS allow-list + OAuth callbacks) | Callbacks rejected, browsers block API | All envs |

**Rules:** values live in Catalyst Console environment config only — never in code, chat, tickets, or logs (the codebase intentionally logs only presence booleans). Rotate `SMTP_PASS` immediately on staff departure; rotate `ZOHO_CLIENT_SECRET` per the OAuth app policy and reconnect every deployment the same day.

---

# 7. Deployment Operations

Standard deployment (function + client, either order; both from the same commit):

1. **Build** — `cd react-app && npm install && npm run build` (`tsc -b && vite build` must pass; archive `dist/` is committed, so a dirty `dist/` fails review).
2. **Verify** — `node --check functions/pos_backend/index.js`; confirm `git status` clean; confirm target env + commit hash in the release note.
3. **Deploy** — `catalyst deploy --only functions:pos_backend`, then `catalyst deploy --only client` (or full `catalyst deploy`). Never deploy a test `dist` over live pages.
4. **Validate** — `GET /api/health`, `GET /api/setup/status` (all tables exist), log in, open POS, Dashboard loads, `GET /api/auth/status` shows Books connected (if expected), send a test receipt if SMTP changed.
5. **Rollback** — redeploy the previous known-good commit's function + client (keep the last two `dist/` builds tagged; see §15).
6. **Post-deployment checks** — watch function logs 30 min; confirm a real checkout + movement row; confirm scheduled/pending syncs drain.

---

# 8. Release Process

## Developer workflow
Feature branch → `npm run build` green → PR with test evidence (logic sims where Catalyst services can't run locally; backend needs deployed Dev to truly test).

## Code review workflow
Reviewer checks: no secrets, ZCQL sanitized (`sanitizeZcql`), ROWIDs as exact digit strings (never `parseInt`), fail-open diagnostics where tables may not exist, response-shape compatibility.

## Deployment workflow
Dev first, soak 24h, then Testing (once provisioned), then Production per §7 with validation + rollback ready.

## Production release workflow
1. Freeze, tag commit, record in deployment registry (§21).
2. Deploy off-peak for the store's timezone (project default: Asia/Colombo).
3. Validate (§7 step 4) + keep rollback window open 2h.
4. Announce in support channel with commit + validator names.

---

# 9. Database Governance

## Current tables (all per-deployment, single-tenant)

| Table | Holds | Ops notes |
|---|---|---|
| Products | Catalog: sku, name, rate, cost_price, stock, reorder_level, category/ids, tax, barcode, unit, status, image refs | + `category_ids` (JSON), `image_id/name/mime`; never delete referenced rows (API 409s) |
| Categories | name, description, status, display_order | Delete blocked while linked; repair endpoint exists |
| Orders | Header: customer, subtotal/tax/total, payment_mode, status, invoice ids | Statuses incl. `Voided`; never edit rows manually |
| OrderItems | Lines: order_id, item_id, quantity, rate, discounts | Append-only; source for profit/top-seller math |
| Organizations | Registration + approval state | PII — restricted access |
| OrgUsers | Roster: user_id, org_id, role | Source of RBAC truth |
| Configurations | Key-value: settings, SMTP, creds, `crm_*` | Secrets live here as fallback — treat as sensitive |
| Shifts | Register open/close, floats, variances | Financial record |
| StockMovements | Ledger: item, qty delta, before/after, actor, reason | **Append-only. Never edit or delete.** |
| Payments | Split-tender legs (best-effort table) | Rebuildable from orders if lost |

## Governance responsibilities
- **Schema reviews:** every new column/table needs a written migration note (backfill + fallback when absent — the codebase pattern is fail-open reads).
- **Migration reviews:** additive-only; renames go through alias/dual-read periods (cf. Items→Products precedent: routes kept, readers tolerant).
- **Change management:** production schema changes ride the release process (§8) with a pre-change CSV export (§14).

---

# 10. Monitoring & Observability

| Layer | Signal | How | Alert when |
|---|---|---|---|
| Application | Function errors, latency, cold starts | Catalyst logs + `/api/health` probe (5 min) | error burst, p95 > 3s |
| API | 4xx/5xx by route | Log scan daily | 401 spike (auth), 500 on checkout/sync |
| Business | Orders/day, revenue trend | Dashboard + `/api/dashboard/summary` | sudden drop to zero |
| Inventory | Out-of-stock count, negative stock | Dashboard low-stock + weekly query | negatives appear (should be impossible) |
| Orders | Offline-pending queue depth | Orders page / sync diagnose | grows 3 days running |
| Authentication | Failed logins, unknown-user defaults | Auth/user review | unfamiliar admin emails |
| Books sync | Last successful sync, failures | `POST /api/sync/books` + diagnose | >24h without success |
| SMTP | Receipt/approval sends | Test mail weekly; failure logs | any `sendMail` failure in prod |

---

# 11. Business Event Monitoring

Track these domain events (all visible via UI or logs — no extra tooling required today):

| Event | Where to see it | Healthy pattern |
|---|---|---|
| Order Created | Orders page, Dashboard activity | Steady with store hours |
| Order Voided | Order status `Voided` + VOID movement | Rare; every void has actor + reason |
| Stock Adjustment | `StockMovements` (`ADJUSTMENT`/`MANUAL`) | Reason + actor always present |
| SALE StockMovement | Movements feed, Dashboard activity | One per checkout line, `POS_ORDER` ref |
| VOID StockMovement | Movements feed | Mirrors a voided order's lines |
| Books Sync | Sync response + diagnose | Daily success, zero failures |
| Category Changes | Categories + product links | No orphan `category_id`s (repair endpoint) |
| Product Changes | Products history (edits, imports) | Imports reviewed via per-row error reports |

---

# 12. Logging Standards

**Log:** checkout totals + order ids (never card data — the app never sees it), sync inserted/updated/failed counts, movement ids + deltas, auth failures (email only), deployment commit + validator, void actor + reason.
**Never log:** secrets, tokens, passwords, SMTP credentials, full customer PII dumps, request bodies containing emails at scale.
**Retention:** Catalyst function logs per platform retention; export a weekly JSONL snapshot of `StockMovements` + `Orders` headers alongside backups (§14); keep 90 days online, 12 months archived.

---

# 13. Security Operations

- **Public API review (quarterly):** enumerate the 49 routes; confirm every business route 401s without session; confirm Admin/Manager-only paths (user delete/role, voids, SMTP save) reject other roles (403).
- **Authentication review (monthly):** roster vs staff list; unknown-user default (currently Admin — tracked risk, verify compensating review until closed); OAuth app secret age.
- **Secret management:** env-only; rotation on departure/incident;no secrets in `dist/`, tickets, or chat.
- **Permission audits (monthly):** sample role assignments against the matrix (Admin > Manager > Cashier/Storekeeper); verify Dashboard gate holds.
- **Incident audits:** every P1/P2 gets a blameless postmortem filed with the deployment registry entry.

---

# 14. Backup Strategy

| Data | Method | Cadence | Owner |
|---|---|---|---|
| Products + Categories | `GET /api/items/export` CSV | Weekly + pre-release | DevOps |
| Orders + OrderItems | ZCQL export via Console (headers + lines) | Weekly | DevOps |
| StockMovements | Append-only export (JSONL) | Weekly (never purge online) | DevOps |
| Configurations | Key export minus secrets | Monthly + pre-release | DevOps |
| Shifts | ZCQL export | Monthly | DevOps |
| ProductImages | File Store folder listing + re-upload set | Monthly | DevOps |

Store backups per customer deployment, encrypted at rest, with a manifest (date, commit, row counts). Test one restore quarterly — an untested backup is not a backup.

---

# 15. Disaster Recovery

| Scenario | Runbook |
|---|---|
| Bad deploy | Rollback: redeploy last known-good commit (function + client), validate §7-step-4, postmortem |
| Database recovery | Recreate tables → re-import latest CSV/JSONL exports in dependency order (Categories → Products → Orders → OrderItems → ledger) → reconcile counts → verify app |
| Function recovery | Redeploy from tag; if Catalyst-side outage, status page + customer notice, no code changes under pressure |
| Books integration recovery | Re-run OAuth connect flow; verify with `auth/status` + test sync; reconcile `Offline Pending` queue (never bulk-delete it) |
| SMTP recovery | Verify vars → test mail → check Configurations fallback → confirm receipt flow end-to-end |

RTO targets: rollback < 30 min; data recovery < 4h. RPO: ≤ 24h (daily-sensitive data backed up weekly minimum — tighten per customer SLA).

---

# 16. Incident Management

| Severity | Definition | Response |
|---|---|---|
| **P1** | Checkout down / data loss suspected / suspected breach | All hands, 15-min ack, rollback/contain first, updates every 30 min |
| **P2** | Sync/SMTP/auth degraded; single-store outage | 1h ack, workaround + fix same day |
| **P3** | Non-blocking bugs, slow reports, cosmetic | Next release train |
| **P4** | Questions, minor polish | Backlog |

Procedure: detect → severity → contain (rollback/disable) → communicate → fix forward → postmortem → registry entry. Never debug production data with live customer PII beyond the minimum necessary.

---

# 17. Daily DevOps Checklist

**Morning**
- [ ] `/api/health` green on all production deployments
- [ ] Function error logs reviewed (last 24h), anomalies ticketed
- [ ] Offline-pending order queue not growing
- [ ] Books last-sync timestamps current

**Midday**
- [ ] New user approvals / role changes reviewed
- [ ] Stock-movement ledger flowing (spot-check counts vs orders)
- [ ] Any customer-reported issue acknowledged with severity

**End of day**
- [ ] Deployments (if any) validated + registry updated
- [ ] Handover note for the next shift / next day

---

# 18. Weekly DevOps Checklist

- [ ] Infrastructure review: quotas, File Store usage vs 1.5 MB/upload budget, function usage
- [ ] Security review: roster diff, failed-auth scan, secret age check
- [ ] Deployment review: registry complete, rollback tags present
- [ ] Backup validation: fresh exports exist + manifest counts sane
- [ ] Test-mail + test-sync end-to-end on one deployment
- [ ] Dependency scan: `npm audit` on `react-app` and `functions/pos_backend`

---

# 19. Monthly DevOps Checklist

- [ ] Capacity planning: order/line/movement growth vs Data Store limits
- [ ] Cost analysis: Catalyst usage per deployment vs plan pricing
- [ ] Performance review: checkout p95, dashboard summary latency, bundle size
- [ ] Compliance review: PII handling, secret hygiene, access recertification
- [ ] Restore drill (quarterly minimum): one table, timed
- [ ] Roadmap input: toil reduction, missing alerting, Testing-env status

---

# 20. Production Readiness Checklist

Before any customer goes live, all must hold:

- [ ] Production Catalyst project exists, separate from Development
- [ ] All §6 variables set with production values (no Dev secrets)
- [ ] All §9 tables provisioned (`/api/setup/status` all-green)
- [ ] `ProductImages` folder created (first upload auto-creates; pre-create it)
- [ ] Books connected to the correct live Books organization
- [ ] SMTP sends to a monitored mailbox; test receipt delivered
- [ ] Admin + staff roster created with least-privilege roles
- [ ] Test checkout → movement row → void → restore verified end-to-end
- [ ] CSV export verified (backup path proven on day one)
- [ ] Rollback commit tagged and recorded
- [ ] Customer handover: owner sets password via activation mail, confirms login

---

# 21. CloudPartners Operations Model

Future state: one customer = one Catalyst project, all operated from a registry.

- **Deployment Registry** (to build): per customer — project id, env ids, template version/commit, owner contact, plan, Books org, SMTP status, last deploy, last backup, health snapshot.
- **Licensing:** Starter (4 users) / Business (10) / Enterprise (unlimited) — enforced in-app; DevOps audits roster size vs plan monthly.
- **Feature Flags:** per-deployment module toggles (Loyalty/Rewards/WhatsApp/AI/Offline/Forecasting when they land) with safe defaults off.
- **Support:** ticket context = registry row + recent logs + sync status; no customer-data fishing.
- **Health Checks:** extend §10 probes per deployment; aggregate into one fleet view.
- **Template rollouts:** staged (1 pilot → 25% → 100%) with per-stage validation gates; any stage can halt the train.

---

# 22. Tooling Recommendations

| Need | Current | Future |
|---|---|---|
| Deploy | Catalyst CLI by hand | Tagged releases + checklist-driven runs; CI running `tsc`/`vite build`/`node --check` on PRs |
| Monitoring | Console logs + manual probes | Uptime prober on `/api/health` + log aggregation + sync-age alert |
| Automation | Manual CSV exports | Scheduled export job + manifest store |
| CI/CD | None | PR checks now; guarded auto-deploy to Dev; manual Production gate |
| Secrets | Console env vars | Same + rotation calendar + break-glass procedure |

---

# 23. New DevOps Engineer Onboarding

**Knowledge required:** Zoho Catalyst (Functions, Data Store, Auth, File Store, envs), this manual, the status report (`CloudHub_POS_Project_Status.md`), the release + incident processes.
**Access required:** Catalyst project roles (Dev first, Production after sign-off), Books sandbox org, support mailbox, deployment registry, on-call rotation.
**Setup steps:** clone repo → `npm install` + `npm run build` in `react-app` → `node --check functions/pos_backend` → shadow one full release cycle → run one supervised deploy + rollback drill.
**30-day plan:** week 1 — read + shadow checks; week 2 — own daily checklist; week 3 — lead a Dev deploy + backup validation; week 4 — own a Production release with a buddy, then solo on-call.

---

# 24. Success Metrics

| Signal | Target |
|---|---|
| Deployment success | 100% of production releases validate first try; rollbacks rehearsed, rarely needed |
| System uptime | 99.5%+ checkout availability per deployment |
| Incident response | P1 ack ≤ 15 min; P2 same-day fix; every P1/P2 with postmortem |
| Operational maturity | Zero "works on my machine" releases; registry complete; backups tested, not just taken |

*When a new engineer can take a pager, run a release, survive an incident, and hand back a cleaner registry — DevOps is working.*
