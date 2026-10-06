# AINO Platform — Copilot Agent Instructions

**Trust these instructions.** Every command below was run and verified on a clean checkout. Search the codebase only when something here is incomplete or proves wrong.

## What this repo is
AINO (formerly "WorkPulse") is a multi-tenant workforce SaaS app: time tracking, agile tasks/sprints, leave approvals, real-time chat, WebRTC calls/meetings, calendar, and a notes wiki. This repo has the **backend, web client, Electron desktop app, API contracts, and infra**. Native mobile apps live in other repos (`aino-android`, `aino-ios`). About 1,300 tracked files, all TypeScript/Node. There is **no root workspace**. `server/`, `client/`, `desktop/`, and `infra/cloudflare/` are separate npm projects, each with its own `package-lock.json`.
- **server/**: Node + Express 5, TypeScript (CommonJS, `strict`), PostgreSQL (`pg`, one DB per tenant plus a master DB), Redis/ioredis, BullMQ, `ws` WebSockets, Hocuspocus/Yjs, Pino. Tests: Jest + ts-jest + Supertest.
- **client/**: React 19, React Router 7, Vite 7, TanStack Query, axios. Tests: Vitest + jsdom + Testing Library. The same build is also the Electron renderer (`VITE_ELECTRON=true`).
- **desktop/**: Electron 33 + electron-builder. The TS main process compiles **in place** (`outDir "."`). Tests: `node --test`.
- CI uses **Node 22** and the Docker image uses Node 20. Node 24 / npm 11 also work locally. npm 11 prints `npm warn allow-scripts ...` for esbuild/sharp/unrs-resolver. That warning is harmless.

## Build, test, and validate (run from repo root unless noted)
Always run `npm ci` in a sub-project before building or testing it. Root guardrails and contract checks need **no install**.

| Step | Command | Time |
|---|---|---|
| Root guardrails (all) | `npm run check:guardrails` | ~18s |
| Contracts | `npm run contracts:validate` | ~4s |
| Server | `cd server; npm ci; npm run typecheck; npm run lint:deps; npm run build; npm run test:ci` | ci 63s, tsc 25s, deps 5s, build 55s, tests ~2min |
| Server post-build checks (root) | `node scripts/verify-docker-migrations.mjs; node scripts/a2-verify-baseline.mjs` (run after `server` build) | <5s |
| Client | `cd client; npm ci; npm run typecheck; npm test; npm run build` then from root `node scripts/verify-spa-build.mjs client/dist` | ci 63s, tsc 40s, tests 40s, build ~2min |
| Desktop | Build `client` first, then `cd desktop; npm ci; npm run typecheck; npm test` | ~40s total |
| Edge router | `cd infra/cloudflare; npm test` (no install needed) | ~3s |

Notes:
- Server tests need **no real Postgres or Redis**. `server/jest.setup.ts` mocks tenant/db modules. CI sets `JWT_SECRET=ci-test-secret` and a dummy `DATABASE_URL`, and the defaults also work. Expected noise you can ignore: JSON log lines, "A worker process has failed to exit gracefully", and "Force exiting Jest". The baseline is 122 suites / 1268 tests passing. To run one suite: `cd server; npx jest <name>`.
- Client baseline: 41 files / 272 tests. A Vite warning that "chunks larger than 500 kB" is expected.
- Local dev: `cd server; npm run dev` (tsx watch, :5000) plus `cd client; npm run dev` (Vite :3000, which proxies `/api`, `/ws`, `/collab`, `/uploads` to :5000). The server needs real `DATABASE_URL`/`JWT_SECRET` (see `server/.env.example`). Docker: `docker compose up`.

## CI (`.github/workflows/ci.yml`, on PRs and pushes to `master`)
These jobs run: `repository-hygiene` (all root `check:*` scripts and `contracts:validate`), `server`, `client`, `desktop` (also runs `npx electron-builder --linux --dir --publish never`), `edge-router`, then `docker-build`. Replicate them with the table above. Pushes to `master` auto-deploy (Railway + `web-release.yml`), so **never push to master directly**. `v*` tags trigger `desktop-release.yml`.

## Guardrails that commonly break PRs
1. **File-size ratchets (600-line limit for non-test `.ts/.tsx`).** Server ceilings are hard-coded in `scripts/check-server-file-sizes.mjs`. Client and desktop ceilings are in `scripts/{client,desktop}-file-sizes-baseline.json` and are **exact**: if a baselined file *shrinks*, CI fails until you lower its number in the JSON. Remove the entry if you delete or move the file. Split new code into new files instead of growing large ones.
2. **No SQL in routes.** `server/modules/**/*.routes.ts` must contain zero SQL. Legacy `server/routes/**` SQL counts are pinned in `scripts/sql-in-routes-baseline.json` and can only shrink. A new route file with SQL fails the check. After removing SQL, re-pin with `node scripts/check-no-sql-in-routes.mjs --update`.
3. **Layering (`server/.dependency-cruiser.cjs`, `npm run lint:deps`).** The flow is routes → service → repository → db. Routes must not import `db.ts`. Repositories must not import express/middleware. Modules may use another module's service, never its repository. `platform/` must not import routes, services, or middleware. No circular imports.
4. **Every `server/modules/<feature>/` needs a `README.md`.** Follow `server/modules/attendance/README.md`.
5. **Route snapshot.** Adding, removing, or renaming an endpoint changes `server/__tests__/__snapshots__/routes.snapshot.test.ts.snap`. Update it deliberately with `cd server; npx jest routes.snapshot -u`. For a pure refactor, this diff must be empty. New `app.use("/api/...")` mounts in `server/http/routes.ts` must also be added to `contracts/http-route-inventory.json` (regenerate with `node contracts/generate-baseline.mjs` and review the diff), or `contracts:validate` fails.
6. **Statelessness.** Do not add module-level `Map`/`Set` state in `server/utils/ws.ts` or `server/realtime/*`. Cross-replica state belongs in Redis.
7. **Desktop.** Several compiled `desktop/*.js` files are **tracked** in git (`config.js`, `ipc-contract.js`, `protocol.js`, …). After editing `desktop/*.ts`, run `cd desktop; npm run build:main` and commit any changed `.js` files. IPC channels must be declared in `desktop/ipc-contract.ts` and must have both a producer and a consumer (`check:desktop-ipc`).
8. **Never commit** `graphify-out/`, absolute paths, or references to the legacy `vvronline/WorkPulse` repo (`check:repo-independence`).
9. **DB schema changes.** Add a new numbered `.sql` file in `server/platform/db/migrations/` (master DB: `migrations/master/`). It must be idempotent (`IF NOT EXISTS`). Never edit `0002_migration_catchup.sql`. `server/scripts/copy-sql-assets.mjs` copies the SQL into `dist` during `npm run build`.

## Project layout
- Root: `package.json` (guardrail scripts only), `Dockerfile` (multi-stage client + server), `docker-compose.yml`, `README.md`, `ARCHITECTURE.md` (detailed guide), `API_DOCUMENTATION.md`, `scripts/` (guardrails, release, verification), `contracts/` (OpenAPI 3.1, AsyncAPI realtime, push schemas; `node --test`), `infra/` (cloudflare edge router, coturn, pgbouncer, observability), `docs/` (plans, ADRs in `docs/adr`), `specs/` and `.specify/` (Spec Kit; read `.specify/memory/constitution.md` for project principles).
- `server/`: `index.ts` is the entry point (env → bootstrap → `roles/` dispatch by `ROLE=all|web|realtime|worker`). `app.ts` composes Express. `http/routes.ts` handles **all router mounts**. `routes/*.ts` holds legacy domain routers. `modules/<feature>/` holds migrated modules (`*.routes.ts → *.service.ts → *.repository.ts`, plus `*.schema.ts` and `*.types.ts`). `middleware/` covers auth, rbac, tenant, and webOnly. `platform/` contains db (pool, tenantPools, tenantSchema, migrations), storage (local/R2), metrics, and pushNotifications. `realtime/` and `utils/ws.ts`/`utils/wsHandlers/` handle WebSocket work. `services/` holds services. `jobs.ts` contains BullMQ jobs. `__tests__/` holds Jest suites. `db.ts` is the legacy db facade.
- `client/src/`: `main.tsx` and `App.tsx` (routes), `*Context.tsx` (global state), `api/*.ts` (axios wrappers by domain; `client.ts` is the shared instance), `pages/`, `components/`, `hooks/`, `utils/`, and `__tests__/` (Vitest; setup in `src/test-setup.ts`). CSS modules sit next to components.
- Conventions: every request is tenant-scoped through middleware (`req.db`). Mutating `/api` requests require the `X-Requested-With: AINO` header. Admin routes are web-only (`middleware/webOnly.ts`). WebSocket handlers must be idempotent and validated (`utils/wsIdempotency.ts`, `utils/wsValidate.ts`). New API routes need a Jest + Supertest test, and client mutations need a Vitest test.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:
`specs/20260617-024245-call-notification-parity/plan.md`
<!-- SPECKIT END -->
