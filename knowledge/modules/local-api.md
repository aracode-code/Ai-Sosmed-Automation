# Modul — Local API (App, Route, Composition Root)

**Status:** P1–P5 backend (mock publish) + worker loop + dispatch jadwal + produksi konten + pemicu konten manual + CLI kesiapan COMPLETED (2026-10-31) · aksi connect dari UI COMPLETED (2026-11-01, runner proses lokal) · kredensial AI (kunci DeepSeek DPAPI + planner lazy) COMPLETED (2026-11-02, ADR-0011) · approval rencana + publikasi satu gerbang COMPLETED (2026-11-02, `8b9a512`) · commit `debdaaf`, `4b513ab`, `6ad9547`, `7d13431`, `bfc7c72`, `77fbb9c`, `1f27cd5`, `bb1ba57`, `bbfe83a`, `1dfcadf`, `8b9a512`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0001` (konfigurasi), `ADR-0003` D15, `ADR-0004` (worker + registry), `ADR-0005` (publikasi mock), `ADR-0006` (dispatch jadwal), `ADR-0007` (produksi konten per slot), `ADR-0011` (kredensial AI).

## Peta Berkas

| Berkas | Tanggung jawab |
|---|---|
| `apps/local-api/src/config.ts` | Skema env (Zod), `AppConfig`, `loadAiCredentials` (fallback env; tidak masuk `AppConfig`) |
| `apps/local-api/src/ai-credentials.ts` | `AiCredentialManager`: store DPAPI `deepseek-api-key` menang atas env; `refresh`/`resolve`/`save`/`status`/`isConfigured`; `status()` tidak pernah memuat nilai kunci |
| `apps/local-api/src/lazy-planner.ts` | `createLazyPlanner`: resolusi kunci per `plan()`, cache `Planner` per nilai kunci, tanpa kunci → `AUTH` |
| `apps/local-api/src/app.ts` | `buildApp`: Fastify, error envelope, registrasi route, `workerActive` untuk health, `aiCredentials` opsional (default DPAPI) |
| `apps/local-api/src/handlers.ts` | `buildHandlerRegistry`: satu-satunya titik pendaftaran handler |
| `apps/local-api/src/server.ts` | Composition root: migrasi → recovery → kredensial AI → registry → dispatcher/worker → listen → start; shutdown berurutan |
| `apps/local-api/src/routes/*.ts` | Route HTTP per area (health, jobs, campaigns, approvals, plans, schedules, accounts, content, ai) |
| `apps/local-api/src/errors.ts` | `errorEnvelope` bersama (`{ error: { code, message, requestId, details? } }`) |
| `apps/local-api/src/preflight.ts` | Logika murni `collectPreflightChecks` — status PASS/WARN/FAIL tanpa akses jaringan dan tanpa mencetak rahasia |
| `apps/local-api/src/preflight-youtube.ts` | CLI `preflight:youtube` — probe database read-only, akun, blob DPAPI, aset media; exit 0/1/2 |
| `apps/local-api/src/connect-runner.ts` | `ConnectActionRunner`: spawn `flow-login`/`youtube-pair` sebagai proses anak, single-flight, timeout, kill tree, log memori tersunting |
| `apps/local-api/src/routes/connect-actions.ts` | 4 route aksi connect: status, mulai login Flow, mulai pairing YouTube, hentikan |
| `apps/local-api/src/routes/plans.ts` | Review rencana (`GET`) + keputusan approve/reject; transaksi keputusan + konten + job generate + audit |

## Composition Root (urutan boot)

```text
loadConfig → createLogger → openDatabase → runMigrations → runStartupRecovery
→ createAiCredentialManager + refresh (store DPAPI → env) → buildPublisher (opt-in mock)
→ buildHandlerRegistry (planner lazy selalu) → Dispatcher(worker_<pid>) → Worker
→ Scheduler + ScheduleDispatchLoop → buildApp → listen
→ worker.start() (bila WORKER_ENABLED) → dispatchLoop.start() (bila syarat S8 terpenuhi)
```

- `buildHandlerRegistry`: `GENERATE_VIDEO` selalu terdaftar (default `MockVideoGenerator` dengan `outputRoot = MEDIA_ROOT`); `PLAN_CONTENT` **selalu** terdaftar dan memakai `createLazyPlanner` (kunci diresolusi per job — ADR-0011 A3); `PUBLISH` **hanya** bila `publisher` disuntikkan (dari `YOUTUBE_ADAPTER=mock|api`).
- Tanpa kunci: `PLAN_CONTENT` tetap terdaftar; job berakhir `NEEDS_ATTENTION` + `AUTH`; produksi terjadwal **ditahan** sampai kunci diisi (`aiCredentials.isConfigured()`), sedangkan publikasi konten lama tetap berjalan.
- Kegagalan membaca store DPAPI: `storeError=true`, fallback env, peringatan boot; API tidak gagal start.
- Tanpa adapter: `YOUTUBE_ADAPTER=off` (default) → log peringatan, job `PUBLISH` berakhir `NEEDS_ATTENTION` + `NO_HANDLER`.
- `YOUTUBE_ADAPTER=mock` → `MockYouTubeAdapter` + log peringatan bahwa publikasi **PALSU** (ADR-0005 Y9).
- `YOUTUBE_ADAPTER=api` → `createYouTubeApiPublisher` (ADR-0008 A4–A7): aset dari `media_assets`, token DPAPI, `resolveUpload` dari `publish_attempts.external_post_id`, dan `accountId` = satu-satunya akun YouTube (agar `capabilities().authStatus` jujur; lebih dari satu akun → `disconnected`).
- `ScheduleDispatchLoop` memakai enqueuer komposit: `createPublicationEnqueuer({ db, platforms: [publisher.platform] })` **lalu** `createContentProductionEnqueuer({ db })` (produksi hanya bila planner ada). Loop hanya dijalankan bila `SCHEDULER_ENABLED=true`, adapter publikasi ada, dan worker aktif (ADR-0006 S6/S8). Tanpa adapter: log `adapter publikasi belum aktif; dispatch jadwal tidak dijalankan`. Tanpa planner: log `planner tidak aktif; produksi konten otomatis tidak dijalankan (hanya publikasi konten yang sudah ada)`.
- Urutan publikasi → produksi dalam satu tick disengaja: konten yang siap pada slot ini tidak boleh tertahan oleh perencanaan konten berikutnya (ADR-0007 C4).
- Shutdown (`SIGINT`/`SIGTERM`): `dispatchLoop.stop()` → `worker.stop()` → `app.close()` → `db.close()` (dispatch lebih dulu agar tidak ada job baru).
- `workerId = worker_<pid>`; satu worker per proses, satu job per siklus (ADR-0004 W8).

## Route Terdaftar (31)

| Area | Route |
|---|---|
| Health | `GET /health`, `GET /api/v1/health` (`workers.active` dari worker nyata) |
| Jobs | `GET /api/v1/jobs` — filter opsional `status`, `jobType` (divalidasi `JOB_TYPES`), `campaignId`, `limit`, `cursor`; `GET /api/v1/jobs/:id` |
| Campaigns | `POST /api/v1/campaigns`, `GET /api/v1/campaigns`, `GET /api/v1/campaigns/:id` |
| Approvals | `POST /api/v1/content/:id/approve`, `POST /api/v1/content/:id/reject` |
| Plans | `GET /api/v1/plans/:jobId` — rencana `PLAN_CONTENT` + `contents[]` + `bindingHash` + keputusan; 404 bila job tidak ada/bukan `PLAN_CONTENT`. `POST /api/v1/plans/:jobId/approve` dan `/reject` — body `{bindingHash, decidedBy?, reason?}`; 409 `PLAN_NOT_READY`/`PLAN_EMPTY`/`PLAN_ALREADY_DECIDED`/`PLAN_MISMATCH` (+`PLAN_INVALID` saat approve bila ada item tanpa `videoPrompt`); 201 `{approval, contentIds, enqueuedJobIds}` |
| Schedules | `POST /api/v1/schedules`, `GET /api/v1/schedules`, `PATCH /api/v1/schedules/:id`, `POST /api/v1/scheduler/pause`, `POST /api/v1/scheduler/resume` |
| Accounts | `GET /api/v1/accounts` (tanpa `secretRef`/`profileKey`) |
| Content | `POST /api/v1/content` — 202 `{jobId, status:'queued'|'duplicate'}`; key `plan:manual:<campaignId>:<requestId|uuid>`; 404 campaign, 409 `CAMPAIGN_INACTIVE`/`CAMPAIGN_NO_PLATFORM`/`PLAN_IN_PROGRESS`/`PIPELINE_BUSY` |
| Content detail | `GET /api/v1/content/:id?version=n` — konten (default versi tertinggi pada baris id itu), `campaign {platforms, approvalMode}`, `assets` tanpa `path`, `captionHash` dihitung server, `accounts` kandidat sesuai platform campaign; 404 konten/versi, 400 versi invalid |
| Dashboard | `GET /api/v1/dashboard/summary?recentFailures=n&trendDays=d` — hitungan job/attempt/campaign/konten/akun, `recentFailures` (default 5, maks 20), dan `trend` harian Asia/Jakarta (`jobs`, `published`, `failed`; default 7 hari, maks 30); 400 bila parameter di luar rentang |
| Jobs retry | `POST /api/v1/jobs/:id/retry` — hanya `NEEDS_ATTENTION` → `QUEUED` via `RECOVER_REQUEUE`; reset `attempts`/`lastErrorCode`/lease, `runAt = now`, audit `job.retry`; 202 `{jobId, status:"queued"}`, 409 `NOT_RETRYABLE`/`CONCURRENT_UPDATE`, 404 |
| Jobs cancel | `POST /api/v1/jobs/:id/cancel` — status terminal & `PUBLISHING`/`VERIFYING` ditolak; `CANCELLED` lewat state machine, `lastErrorCode="CANCELLED_BY_USER"`, `runAt`/lease dikosongkan, audit `job.cancel`; 202, 409 `NOT_CANCELLABLE`/`CONCURRENT_UPDATE`, 404 |
| Connections | `GET /api/v1/connections` — status CDP/Flow (terjangkau, tab project, prompt, tantangan), `adapter`/`privacy`/`appStatus`, kuota harian dari `data/flow-usage.json`, akun + `hasSecretRef` (boolean), dukungan platform; read-only, tanpa kredensial |
| Jobs timeline | `GET /api/v1/jobs/:id/events` — `job` ringkas, `events` (audit_logs resource job), `attempts` (publish_attempts terurut `attempted_at`); 404 bila job tidak ada |
| Connect status | `GET /api/v1/connections/actions` — snapshot per aksi (`idle`/`running`/`waiting`/`succeeded`/`failed`/`timed_out`/`cancelled`), waktu, exit code, `waitingFor`, error, 60 baris log terakhir |
| Connect Flow | `POST /api/v1/connections/flow/login` — 202 mulai `flow:login`; 412 `CONNECT_PREFLIGHT_FAILED` bila browser/channel tidak siap; 409 `CONNECT_ACTION_IN_PROGRESS` |
| Connect YouTube | `POST /api/v1/connections/youtube/pair` — body ketat berisi **tepat satu** `accountId` atau `label`; 202; 400 `ACCOUNT_NOT_FOUND`/`ACCOUNT_UNSUPPORTED`; 412 `MISSING_CREDENTIALS` bila `GOOGLE_OAUTH_CLIENT_ID` kosong |
| Connect stop | `POST /api/v1/connections/actions/:kind/stop` — 200 hentikan; 409 `CONNECT_ACTION_NOT_RUNNING` |
| AI status | `GET /api/v1/ai/status` — `{configured, source: 'store'|'env'|'none', storeError}`; memuat kunci bila belum pernah dibaca; tidak pernah memuat nilai kunci |
| AI credential | `POST /api/v1/ai/credentials` — body `.strict()` `{apiKey: string 10–200}` → 200 `{configured:true, source:'store'}`; menyimpan ke DPAPI `deepseek-api-key`; 400 `VALIDATION_ERROR` untuk field tambahan/panjang salah |

## Aksi Connect dari UI (`connect-runner.ts`)

- Runner memulai **proses anak Node** (`process.execPath` + `--import tsx` + `src/flow-login.ts` / `src/pair-youtube.ts`), bukan shell; argumen diteruskan (`--account <id>` / `--label <label>`), `cwd` = direktori paket, `env` proses induk + `NO_COLOR=1`.
- **Single-flight:** satu proses per jenis aksi; permintaan kedua → 409. State hanya di memori — restart API menghapus snapshot (UI kembali `idle`), proses anak yang masih hidup dihentikan saat `onClose` (`dispose`).
- **Timeout:** `flow-login` 15 menit, `youtube-pair` 10 menit; lewat batas → `timed_out` + kill tree (`taskkill /PID <pid> /T /F` di win32).
- **Fase `waiting`:** dideteksi dari baris log penanda (`Login ke Google Flow`, `Membuka browser untuk consent`) — itu tanda konsen manual di browser, bukan aksi otomatis.
- **Log:** hanya 60 baris terakhir, dipotong 400 karakter, ANSI dihapus, pola `access_token|refresh_token|client_secret|authorization` diganti `[disunting]`; stderr diberi prefiks `! `. Log tidak dipersistensi.
- **Tanpa kredensial lewat HTTP:** body pairing hanya `accountId`/`label` (`.strict()` menolak field lain); token tetap dibuat oleh CLI dan disimpan DPAPI.
- **Prasyarat aksi:** login Flow memakai `resolveFlowBrowserChannel()` + `checkFlowBrowser()` (412 bila Chromium tidak ada); pairing memeriksa `GOOGLE_OAUTH_CLIENT_ID` di env (412 bila kosong) tanpa mencetak nilainya.

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
| `FLOW_ADAPTER` | `mock` | `real` = `FlowPlaywrightGenerator` (tab Video) via CDP; default mock tidak memakai kredit. **Jalur ini belum memakai guard/ledger `flow-usage`** (ADR-0010 F33) — kredit yang dipakai worker tidak tercatat otomatis |
| `FLOW_CDP_ENDPOINT` | `http://127.0.0.1:9222` | **Wajib loopback**; endpoint non-loopback ditolak config |
| `DEEPSEEK_API_KEY` | — | **Fallback**; kunci dari DPAPI (`POST /api/v1/ai/credentials`) menang. Tidak pernah dilog/dipersistensi ke DB |

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
- Route untuk media/aset dan kontrol worker/scheduler (start/stop/status per proses).
- Pemicu `PLAN_CONTENT` manual ada di `POST /api/v1/content` (idempoten via `requestId`); pembatalan job dan pembacaan attempt publikasi tersedia lewat `POST /api/v1/jobs/:id/cancel` dan `GET /api/v1/jobs/:id/events`.
- Produksi konten ikut berhenti bila adapter publikasi tidak terdaftar, karena loop dispatch digerbangi adapter (ADR-0006 S8).
- Aksi connect **tidak** menyelesaikan konflik profil: `flow:login` gagal bila Chrome/CDP lain sudah memakai profil Flow yang sama (`Opening in existing browser session`). Menghentikan Chrome milik owner bukan wewenang API; kondisi ini diteruskan ke UI sebagai error aksi + catatan.
- Approval rencana tersedia lewat API (`/api/v1/plans/:jobId`) dan UI Campaigns (form permintaan, daftar job `PLAN_CONTENT`, panel keputusan — `1656c9f`); halaman Approvals masih per-konten dan belum menampilkan rencana.
