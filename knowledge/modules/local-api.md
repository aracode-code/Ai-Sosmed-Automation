# Modul — Local API (App, Route, Composition Root)

**Status:** P1–P5 backend (mock publish) + worker loop + dispatch jadwal + produksi konten + pemicu konten manual + CLI kesiapan COMPLETED (2026-10-31) · commit `debdaaf`, `4b513ab`, `6ad9547`, `7d13431`, `bfc7c72`, `77fbb9c`, `1f27cd5`, `bb1ba57`, `bbfe83a`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0001` (konfigurasi), `ADR-0003` D15, `ADR-0004` (worker + registry), `ADR-0005` (publikasi mock), `ADR-0006` (dispatch jadwal), `ADR-0007` (produksi konten per slot).

## Peta Berkas

| Berkas | Tanggung jawab |
|---|---|
| `apps/local-api/src/config.ts` | Skema env (Zod), `AppConfig`, `loadAiCredentials` (key hanya dari env, tidak masuk `AppConfig`) |
| `apps/local-api/src/app.ts` | `buildApp`: Fastify, error envelope, registrasi route, `workerActive` untuk health |
| `apps/local-api/src/handlers.ts` | `buildHandlerRegistry`: satu-satunya titik pendaftaran handler |
| `apps/local-api/src/server.ts` | Composition root: migrasi → recovery → registry → dispatcher/worker → listen → start; shutdown berurutan |
| `apps/local-api/src/routes/*.ts` | Route HTTP per area (health, jobs, campaigns, approvals, schedules, accounts, content) |
| `apps/local-api/src/errors.ts` | `errorEnvelope` bersama (`{ error: { code, message, requestId, details? } }`) |
| `apps/local-api/src/preflight.ts` | Logika murni `collectPreflightChecks` — status PASS/WARN/FAIL tanpa akses jaringan dan tanpa mencetak rahasia |
| `apps/local-api/src/preflight-youtube.ts` | CLI `preflight:youtube` — probe database read-only, akun, blob DPAPI, aset media; exit 0/1/2 |

## Composition Root (urutan boot)

```text
loadConfig → createLogger → openDatabase → runMigrations → runStartupRecovery
→ loadAiCredentials (opsional) → buildPublisher (opt-in mock) → buildHandlerRegistry
→ Dispatcher(worker_<pid>) → Worker → Scheduler + ScheduleDispatchLoop → buildApp → listen
→ worker.start() (bila WORKER_ENABLED) → dispatchLoop.start() (bila syarat S8 terpenuhi)
```

- `buildHandlerRegistry`: `GENERATE_VIDEO` selalu terdaftar (default `MockVideoGenerator` dengan `outputRoot = MEDIA_ROOT`); `PLAN_CONTENT` **hanya** bila `DEEPSEEK_API_KEY` ada (`createPlanner` + `createDeepSeekClient`); `PUBLISH` **hanya** bila `publisher` disuntikkan (dari `YOUTUBE_ADAPTER=mock|api`).
- Tanpa key: log peringatan tanpa nilai key, job `PLAN_CONTENT` akan berakhir `NEEDS_ATTENTION` + `NO_HANDLER`.
- Tanpa adapter: `YOUTUBE_ADAPTER=off` (default) → log peringatan, job `PUBLISH` berakhir `NEEDS_ATTENTION` + `NO_HANDLER`.
- `YOUTUBE_ADAPTER=mock` → `MockYouTubeAdapter` + log peringatan bahwa publikasi **PALSU** (ADR-0005 Y9).
- `YOUTUBE_ADAPTER=api` → `createYouTubeApiPublisher` (ADR-0008 A4–A7): aset dari `media_assets`, token DPAPI, `resolveUpload` dari `publish_attempts.external_post_id`, dan `accountId` = satu-satunya akun YouTube (agar `capabilities().authStatus` jujur; lebih dari satu akun → `disconnected`).
- `ScheduleDispatchLoop` memakai enqueuer komposit: `createPublicationEnqueuer({ db, platforms: [publisher.platform] })` **lalu** `createContentProductionEnqueuer({ db })` (produksi hanya bila planner ada). Loop hanya dijalankan bila `SCHEDULER_ENABLED=true`, adapter publikasi ada, dan worker aktif (ADR-0006 S6/S8). Tanpa adapter: log `adapter publikasi belum aktif; dispatch jadwal tidak dijalankan`. Tanpa planner: log `planner tidak aktif; produksi konten otomatis tidak dijalankan (hanya publikasi konten yang sudah ada)`.
- Urutan publikasi → produksi dalam satu tick disengaja: konten yang siap pada slot ini tidak boleh tertahan oleh perencanaan konten berikutnya (ADR-0007 C4).
- Shutdown (`SIGINT`/`SIGTERM`): `dispatchLoop.stop()` → `worker.stop()` → `app.close()` → `db.close()` (dispatch lebih dulu agar tidak ada job baru).
- `workerId = worker_<pid>`; satu worker per proses, satu job per siklus (ADR-0004 W8).

## Route Terdaftar (16)

| Area | Route |
|---|---|
| Health | `GET /health`, `GET /api/v1/health` (`workers.active` dari worker nyata) |
| Jobs | `GET /api/v1/jobs`, `GET /api/v1/jobs/:id` |
| Campaigns | `POST /api/v1/campaigns`, `GET /api/v1/campaigns`, `GET /api/v1/campaigns/:id` |
| Approvals | `POST /api/v1/content/:id/approve`, `POST /api/v1/content/:id/reject` |
| Schedules | `POST /api/v1/schedules`, `GET /api/v1/schedules`, `PATCH /api/v1/schedules/:id`, `POST /api/v1/scheduler/pause`, `POST /api/v1/scheduler/resume` |
| Accounts | `GET /api/v1/accounts` (tanpa `secretRef`/`profileKey`) |
| Content | `POST /api/v1/content` — 202 `{jobId, status:'queued'|'duplicate'}`; key `plan:manual:<campaignId>:<requestId|uuid>`; 404 campaign, 409 `CAMPAIGN_INACTIVE`/`CAMPAIGN_NO_PLATFORM`/`PLAN_IN_PROGRESS`/`PIPELINE_BUSY` |

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
| `YOUTUBE_ADAPTER` | `off` | `mock` = adapter palsu (tanpa unggahan nyata); `api` = adapter YouTube Data API v3 (ADR-0008), hanya aktif bila `GOOGLE_OAUTH_CLIENT_ID` ada |
| `YOUTUBE_UPLOAD_PRIVACY` | `private` | `private`/`unlisted`/`public`; hasil diverifikasi `videos.list` |
| `YOUTUBE_APP_STATUS` | `unknown` | `testing`/`production`/`unknown`; `testing` dicatat `error` saat boot (ADR-0008 O3) |
| `DEEPSEEK_API_KEY` | — | Hanya lewat env; tidak pernah dilog/dipersistensi |

## Perintah

```bash
corepack pnpm start          # boot default 127.0.0.1:4317
corepack pnpm dev            # tsx watch
corepack pnpm test           # seluruh workspace
corepack pnpm --filter @saa/local-api pair:youtube --label "YouTube Utama"
corepack pnpm --filter @saa/local-api preflight:youtube   # exit 0 lulus/peringatan, 1 FAIL, 2 konfigurasi
curl http://127.0.0.1:4317/health
```

Argumen script diteruskan apa adanya; jangan memakai `--` pemisah (`--` ikut menjadi argumen dan ditolak CLI).

## Belum Ada

- Auth lokal pada API (saat ini loopback-only sebagai batas keamanan). Celah autentikasi token + validasi `Origin` + rate limit dicatat di `docs/security.md` sebagai pekerjaan P7.
- Route untuk media/aset, approval UI, dan kontrol worker/scheduler (start/stop/status per proses).
- Pemicu `PLAN_CONTENT` manual ada di `POST /api/v1/content` (idempoten via `requestId`); belum ada route untuk membatalkan job atau membaca attempt publikasi.
- Produksi konten ikut berhenti bila adapter publikasi tidak terdaftar, karena loop dispatch digerbangi adapter (ADR-0006 S8).
