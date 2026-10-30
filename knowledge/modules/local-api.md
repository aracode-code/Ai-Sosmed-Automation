# Modul — Local API (App, Route, Composition Root)

**Status:** P1–P4 backend + worker loop COMPLETED (2026-10-30) · commit `debdaaf`, `4b513ab`, `6ad9547`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0001` (konfigurasi), `ADR-0003` D15, `ADR-0004` (worker + registry).

## Peta Berkas

| Berkas | Tanggung jawab |
|---|---|
| `apps/local-api/src/config.ts` | Skema env (Zod), `AppConfig`, `loadAiCredentials` (key hanya dari env, tidak masuk `AppConfig`) |
| `apps/local-api/src/app.ts` | `buildApp`: Fastify, error envelope, registrasi route, `workerActive` untuk health |
| `apps/local-api/src/handlers.ts` | `buildHandlerRegistry`: satu-satunya titik pendaftaran handler |
| `apps/local-api/src/server.ts` | Composition root: migrasi → recovery → registry → dispatcher/worker → listen → start; shutdown berurutan |
| `apps/local-api/src/routes/*.ts` | Route HTTP per area (health, jobs, campaigns, approvals, schedules, accounts) |
| `apps/local-api/src/errors.ts` | `errorEnvelope` bersama (`{ error: { code, message, requestId, details? } }`) |

## Composition Root (urutan boot)

```text
loadConfig → createLogger → openDatabase → runMigrations → runStartupRecovery
→ loadAiCredentials (opsional) → buildHandlerRegistry → Dispatcher(worker_<pid>)
→ Worker → buildApp → listen → worker.start() (bila WORKER_ENABLED)
```

- `buildHandlerRegistry`: `GENERATE_VIDEO` selalu terdaftar (default `MockVideoGenerator` dengan `outputRoot = MEDIA_ROOT`); `PLAN_CONTENT` **hanya** bila `DEEPSEEK_API_KEY` ada (`createPlanner` + `createDeepSeekClient`).
- Tanpa key: log peringatan tanpa nilai key, job `PLAN_CONTENT` akan berakhir `NEEDS_ATTENTION` + `NO_HANDLER`.
- Shutdown (`SIGINT`/`SIGTERM`): `worker.stop()` → `app.close()` → `db.close()`.
- `workerId = worker_<pid>`; satu worker per proses, satu job per siklus (ADR-0004 W8).

## Route Terdaftar (15)

| Area | Route |
|---|---|
| Health | `GET /health`, `GET /api/v1/health` (`workers.active` dari worker nyata) |
| Jobs | `GET /api/v1/jobs`, `GET /api/v1/jobs/:id` |
| Campaigns | `POST /api/v1/campaigns`, `GET /api/v1/campaigns`, `GET /api/v1/campaigns/:id` |
| Approvals | `POST /api/v1/content/:id/approve`, `POST /api/v1/content/:id/reject` |
| Schedules | `POST /api/v1/schedules`, `GET /api/v1/schedules`, `PATCH /api/v1/schedules/:id`, `POST /api/v1/scheduler/pause`, `POST /api/v1/scheduler/resume` |
| Accounts | `GET /api/v1/accounts` (tanpa `secretRef`/`profileKey`) |

## Konfigurasi Penting

| Env | Default | Catatan |
|---|---|---|
| `APP_HOST` | `127.0.0.1` | Non-loopback ditolak kecuali `APP_ALLOW_NETWORK=true` |
| `DATABASE_PATH` | `./data/database/app.sqlite` | Relatif diresolusi terhadap root workspace |
| `MEDIA_ROOT` | `./data/media` | `outputRoot` generator **dan** validasi media (satu nilai, tidak boleh berbeda) |
| `WORKER_ENABLED` | `true` | `false` = API baca-saja, job tidak diproses |
| `WORKER_INTERVAL_MS` | `1000` | Rentang 50–60 000 |
| `DEEPSEEK_API_KEY` | — | Hanya lewat env; tidak pernah dilog/dipersistensi |

## Perintah

```bash
corepack pnpm start          # boot default 127.0.0.1:4317
corepack pnpm dev            # tsx watch
corepack pnpm test           # seluruh workspace
curl http://127.0.0.1:4317/health
```

## Belum Ada

- Auth lokal pada API (saat ini loopback-only sebagai batas keamanan).
- Route untuk media/aset, approval UI, dan kontrol worker (start/stop/status per proses).
- Scheduler periodik: loop ini hanya mengambil job, belum memicu dispatch jadwal (menunggu P5).
