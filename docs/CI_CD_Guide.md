# CloudHub POS — CI/CD Guide

Covers the two GitHub Actions workflows (`.github/workflows/`), the local
deploy script (`scripts/deploy.sh`), required secrets, and the roadmap.
For day-to-day deploy commands also see `README.md` ("Ship it").

## Pipeline architecture

```text
Developer
  │ push / pull_request
  ▼
┌─────────────────────────┐
│ build.yml (validation)  │  checkout → Node 18 → npm ci → npm run build
│ runs on: push, PR       │  → node --check → verify catalyst.json +
│ deploys: NOTHING        │  .catalystrc → upload react-app/dist (7 days)
└─────────────────────────┘
  │ push to main only
  ▼
┌─────────────────────────┐
│ deploy-dev.yml          │  build steps, then: zcatalyst-cli install →
│ runs on: push to main   │  token check → deploy functions:pos_backend →
│ deploys: DEVELOPMENT    │  deploy client → (smoke checks: manual, below)
└─────────────────────────┘
  │ console promotion (manual)
  ▼
Production (Catalyst console — never automated today)
```

Concurrency guard `catalyst-dev-deploy` serializes deploys so two pushes
cannot race each other on the Development environment.

## Build flow (build.yml)

| Stage | Command | Fails the run when… |
|---|---|---|
| Checkout | `actions/checkout@v4` | repo unreachable |
| Setup Node | `actions/setup-node@v4`, Node 18, npm cache | — |
| Install | `npm ci` in `react-app/` | lockfile/registry problem |
| Frontend validation | `npm run build` (`tsc -b && vite build`) | TypeScript or Vite error |
| Backend validation | `node --check functions/pos_backend/index.js` | syntax error (parses only, never executes) |
| Verify files | `test -f catalyst.json`, `.catalystrc`, `-d react-app/dist` | deploy map, project binding, or build output missing |
| Artifact | `actions/upload-artifact@v4` (`client-dist`, 7 days) | upload failure |

Node 18 matches both this repo's local toolchain and the Catalyst
`pos_backend` function stack. `npm ci` (not `npm install`) keeps builds
reproducible from `react-app/package-lock.json`.

## Deployment flow (deploy-dev.yml)

1. Same checkout → Node 18 → `npm ci` → `npm run build` → `node --check` as build.yml.
2. `npm install -g zcatalyst-cli` (CLI needs Node ≥ 14).
3. Token presence check — fails fast with a clear message instead of a
   cryptic deploy error later. Secrets are only ever passed via `--token`
   flags, never echoed.
4. `catalyst deploy --only functions:pos_backend --token … --dc …`
   (functions first — the client calls these APIs).
5. `catalyst deploy --only client --token … --dc …` (serves `/app`).
6. Smoke checks stay **manual for now** (documented below).

### Catalyst-specific facts this pipeline relies on (verified in CLI docs)

- CLI deploy from a terminal targets the **Development environment only**.
  Reaching Production is a separate, manual console promotion — that is why
  no `deploy-prod.yml` exists yet (see Roadmap).
- CI auth uses a token from `catalyst token:generate` (run once on a
  logged-in machine), passed per command with `--token`, scoped with `--dc`.
  Tokens stay valid until revoked and are bound to one data center.
- Functions deploy before the client; Node.js functions deploy directly
  (no compile step, unlike Java).

## Secrets configuration

Create under repository → Settings → Secrets and variables → Actions:

| Secret | Value | How to obtain |
|---|---|---|
| `CATALYST_TOKEN` | CLI token string | On a logged-in machine: `catalyst login`, then `catalyst token:generate`; copy the output once |
| `CATALYST_DC` | Data-center code, e.g. `in` | The DC of the account the token was generated with (`com`/`us` style regions map to `us`, `eu`, `in`, `jp`, … — use the code matching your project) |

Rules: rotate `CATALYST_TOKEN` on staff departure (`catalyst token:revoke <id>` from the generating terminal, then generate fresh); never print secrets in logs (workflows only reference `${{ secrets.* }}` inside env/flags); Production promotion stays out of CI so no production credential ever lives in GitHub.

## Post-deploy checks (manual runbook for now)

After any deploy, against the Development URL:

1. `GET /api/health` → success.
2. `GET /api/setup/status` → all required tables exist.
3. Log in, open POS, confirm Dashboard loads and `GET /api/auth/status`
   shows the expected Books connection state.
4. If SMTP or Books settings changed: send one test receipt / run one
   `POST /api/sync/books` and confirm success.
5. Watch function logs ~30 minutes after production-adjacent changes.

## Development workflow

```text
git checkout -b feat/xyz
# ... edit ...
cd react-app && npm run build        # local gate
node --check ../functions/pos_backend/index.js
./scripts/deploy.sh                  # optional: push to Dev for live testing
git push  →  build.yml validates  →  open PR  →  merge to main
→ deploy-dev.yml ships Development automatically
```

`scripts/deploy.sh` mirrors CI locally with `set -euo pipefail` (exit on
first failure): same build, same syntax check, then `catalyst deploy`
(`functions` / `client` / `all`). It assumes an already-authenticated CLI
(`catalyst login`); CI uses `--token` instead.

## Production workflow (current, manual by design)

1. Confirm `main` is green (build.yml) and Development has soaked the change.
2. Promote Development → Production from the Catalyst console.
3. Run the post-deploy checks above against Production.
4. Keep the previous working state deployable for rollback (re-run the same
   steps from the prior commit if needed).

## Future improvements (documented, not implemented)

- `deploy-prod.yml`: environment protection rules + manual approval gate,
  still promoting via console-supported flow — research first, CLI cannot
  push to Production directly today.
- Automated smoke tests hitting `/api/health` + `/api/setup/status`
  (needs the live Dev URL + session handling).
- Inventory/POS/security checks: stock-decrement verification, auth-gate
  probes, secret-scan on PRs.
- PR preview environments, bundle-size budgets, E2E suite.
