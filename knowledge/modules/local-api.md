# Modul — Local API (App, Route, Composition Root)

**Status:** P1–P5 backend (mock publish) + worker loop + dispatch jadwal COMPLETED (2026-10-30) · commit `debdaaf`, `4b513ab`, `6ad9547`, `7d13431`, `bfc7c72`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0001` (konfigurasi), `ADR-0003` D15, `ADR-0004` (worker + registry), `ADR-0005` (publikasi mock), `ADR-0006` (dispatch jadwal).

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
→ loadAiCredentials (opsional) → buildPublisher (opt-in mock) → buildHandlerRegistry
→ Dispatcher(worker_<pid>) → Worker → Scheduler + ScheduleDispatchLoop → buildApp → listen
→ worker.start() (bila WORKER_ENABLED) → dispatchLoop.start() (bila syarat S8 terpenuhi)
```

- `buildHandlerRegistry`: `GENERATE_VIDEO` selalu terdaftar (default `MockVideoGenerator` dengan `outputRoot = MEDIA_ROOT`); `PLAN_CONTENT` **hanya** bila `DEEPSEEK_API_KEY` ada (`createPlanner` + `createDeepSeekClient`); `PUBLISH` **hanya** bila `publisher` disuntikkan (dari `YOUTUBE_ADAPTER=mock`).
- Tanpa key: log peringatan tanpa nilai key, job `PLAN_CONTENT` akan berakhir `NEEDS_ATTENTION` + `NO_HANDLER`.
- Tanpa adapter: `YOUTUBE_ADAPTER=off` (default) → log peringatan, job `PUBLISH` berakhir `NEEDS_ATTENTION` + `NO_HANDLER`.
- `YOUTUBE_ADAPTER=mock` → `MockYouTubeAdapter` + log peringatan bahwa publikasi **PALSU** (ADR-0005 Y9).
- `ScheduleDispatchLoop` memakai `createPublicationEnqueuer({ db, platforms: [publisher.platform] })`; loop hanya dijalankan bila `SCHEDULER_ENABLED=true`, adapter publikasi ada, dan worker aktif (ADR-0006 S6/S8). Tanpa adapter: log `adapter publikasi belum aktif; dispatch jadwal tidak dijalankan`.
- Shutdown (`SIGINT`/`SIGTERM`): `dispatchLoop.stop()` → `worker.stop()` → `app.close()` → `db.close()` (dispatch lebih dulu agar tidak ada job baru).
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
| `SCHEDULER_ENABLED` | `true` | Loop dispatch jadwal → job `PUBLISH` |
| `SCHEDULER_INTERVAL_MS` | `5000` | Rentang 1 000–300 000 |
| `YOUTUBE_ADAPTER` | `off` | `mock` = adapter palsu (tanpa unggahan nyata); tidak ada opsi live sampai OD-2/OD-5 |
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
- Route untuk media/aset, approval UI, dan kontrol worker/scheduler (start/stop/status per proses).
- Pembuatan konten otomatis: tidak ada pembuat job `PLAN_CONTENT` maupun route konten, sehingga dispatch jadwal hanya memproses konten yang sudah ada.
