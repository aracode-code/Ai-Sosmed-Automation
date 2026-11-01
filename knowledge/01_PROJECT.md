# 01 — Project

## Identitas

| Atribut | Nilai | Status |
|---|---|---|
| Nama | AI Social Media Automation Agent | VERIFIED (HLD §1) |
| Root | `F:/AiSosmedAutomation` | VERIFIED |
| Tipe | Aplikasi desktop lokal Windows, satu pengguna utama | VERIFIED (HLD §2.3) |
| Deployment | Windows PC lokal; packaging Electron/Tauri belum dipilih | VERIFIED (HLD §4, LLD §19) |
| Dokumen induk | `HLD.md` v1.0 dan `LLD.md` v1.0 (keduanya berstatus Draft) | VERIFIED |
| Implementasi kode | **P1 + P2 + P3 mock + P4 backend + P4b/P4c otomatisasi + P5 mock + adapter YouTube API (A1–A7) + CLI preflight + dashboard (approval beraksi) + sesi Flow/login selesai** — 8 paket + `apps/local-api` + `apps/dashboard`, 416 test hijau | VERIFIED (commit `debdaaf` … `515f6ca`, 2026-11-01) |

## Tujuan Produk

Mengotomatisasi alur produksi video dari perencanaan sampai publikasi lintas platform: DeepSeek sebagai planner → Google Flow via Playwright untuk generate + download → adapter platform untuk publikasi — dengan antrean persisten, retry, idempotency, approval, audit, dan recovery. (HLD §1)

## Ruang Lingkup

**Termasuk (HLD §2.1):** dashboard React, DeepSeek planner, Google Flow adapter, validasi media, metadata per platform, scheduler (fixed/random/random-window), antrean persisten, mode automatic + approval, 6 adapter platform (YouTube, TikTok, Instagram, Facebook, X, Threads), pengelolaan akun/sesi, retry/recovery/audit, storage aset lokal.

**Di luar MVP (HLD §2.2, LLD §1.2):** cloud multi-tenant, billing, marketplace/analitik lanjutan, pelatihan model, jaminan direct publishing tanpa verifikasi akses, **bypass CAPTCHA / anti-bot / pembatasan layanan**.

## Prinsip Desain (mengikat, HLD §1.2)

1. AI merencanakan; workflow engine mengontrol eksekusi.
2. Setiap platform diisolasi dalam adapter.
3. Semua job punya status + riwayat persisten.
4. Publikasi tidak diulang sebelum status percobaan sebelumnya diperiksa.
5. Kredensial dan sesi browser = data sensitif.
6. Tantangan keamanan yang butuh manusia menghentikan worker dengan aman (`NEEDS_ATTENTION`).
7. Otomatisasi mengikuti izin, batas, dan kebijakan layanan.

## Stack Baseline (HLD §4, LLD §2)

| Area | Pilihan | Catatan |
|---|---|---|
| Monorepo | pnpm workspace | lockfile wajib dikomit (LLD §2) |
| Runtime | Node.js LTS dipatok + TypeScript strict | shell saat ini: Node v22.15.0 |
| UI | React 18 + Vite 6 (Tailwind ditunda — ADR-0009 U4) | tidak mengakses DB langsung; lewat proxy `/api` ke Local API |
| API | Fastify + Zod | bind `127.0.0.1` default |
| DB | SQLite + Drizzle, WAL, foreign_keys ON, migrasi versioned | waktu disimpan UTC ISO-8601 |
| Queue | SQLite persistent queue | satu sumber kebenaran status job |
| Browser | Playwright + Chromium (terpasang; sesi Flow saja) | satu profil = satu worker; login manual, tanpa bypass CAPTCHA (ADR-0010) |
| AI | DeepSeek provider adapter (`fetch`, tanpa SDK) — ADR-0002 D1 | key hanya di secret store |
| Media | Filesystem + ffprobe | metadata di DB, file di storage |
| Logs | Pino | redaksi token/cookie/header |
| Tests | Vitest + Playwright Test | contract test per adapter |
| Secrets | Windows Credential Manager / DPAPI | DB hanya menyimpan `secret_ref` |

## Struktur Repo (aktual per 2026-10-30)

```text
apps/local-api            # Fastify + composition root: health, jobs, campaigns, approvals, schedules, accounts; worker loop
apps/dashboard            # React 18 + Vite: shell + halaman Jobs/Campaigns/Approvals (aksi approve/reject)/Accounts, proxy ke API
packages/domain           # entitas, JobType/JobStatus, error class, state machine, approval binding, schedule config, kontrak SocialAdapter
packages/database         # schema Drizzle 12 tabel, client, migrator SQL, repository (termasuk publish_attempts)
packages/workflow         # dispatcher, worker loop, retry, recovery, handler PLAN_CONTENT + GENERATE_VIDEO + PUBLISH
packages/observability    # logger Pino + redaksi secret
packages/agent-core       # skema PlanDecision + planner + adapter DeepSeek + tool allowlist
packages/scheduler        # zona waktu, window/quiet, kuota harian, Scheduler pause/runOnce, enqueuer PUBLISH + dispatch loop
packages/browser-engine   # kontrak VideoGenerator, mock Flow, validasi media, lock profil
packages/youtube          # adapter YouTube mock (kontrak SocialAdapter), idempoten per key
tests/integration         # migrasi, restart recovery, klaim lintas koneksi, envelope API
docs                      # runbook operasional + security checklist (merujuk LLD §13, tidak menduplikasi)
```

Belum dibuat (P3 penuh–P7): adapter Flow nyata, `packages/integrations/*`, aksi approval/pairing di UI.

> Catatan: HLD/LLD berada di root repo (bukan `docs/`). Pindahkan hanya bila diputuskan di ADR — jangan memindahkan dokumen canonical tanpa jejak.

## Aturan Dependency (LLD §3)

`domain` tidak mengimpor adapter atau UI · adapter mengimplementasikan interface domain · workflow bergantung pada interface, bukan detail vendor.

## Konvensi Operasional

- Zona waktu scheduler default `Asia/Jakarta`; timestamp audit/log UTC ISO-8601.
- Retry awal: maksimal 3×, backoff eksponensial + jitter (LLD §15.1).
- `PUBLISHED` hanya setelah bukti verifikasi; status ambigu → reconciliation, bukan retry buta.
- Tidak ada shell tool untuk AI; tool registry = allowlist tervalidasi Zod (LLD §9.2–9.3).
- Output DeepSeek = data tidak tepercaya: Zod + kebijakan campaign ditegakkan di luar model; output invalid setelah 1 perbaikan → `NEEDS_ATTENTION` (ADR-0002 D3, D5).
- Tool AI: budget 8 panggilan/run, timeout 10 s, nama shell/exec/eval ditolak (ADR-0002 D7).
- No secret di log, repo, state, index, atau snapshot.
- Semua perintah paket dijalankan sebagai `corepack pnpm ...` — `pnpm` tidak ada di PATH mesin ini.
- `DATABASE_PATH` relatif diresolusi terhadap root workspace (ADR-0001 D5).
- Migrasi hanya lewat `packages/database/migrations/*.sql` + `schema_migrations`; jurnal drizzle-kit tidak dipakai (ADR-0001 D3).
- Media: generator menulis ke `outputRoot` (relatif `content/<contentId>`); setiap path divalidasi containment + checksum sebelum dicatat sebagai `media_assets` (ADR-0003 D18–D19).
- Approval: terikat versi konten + sha256 aset + hash caption + akun + platform; mismatch → `409 APPROVAL_MISMATCH` (ADR-0003 D7–D9).
- Scheduler: `next_run_at` persisten, kuota harian per akun+platform, pause lewat `settings` — tidak menghapus jadwal (ADR-0003 D10–D14).
- P3 saat ini memakai generator **mock** (MP4-shaped, bukan video yang dapat diputar); Flow asli menunggu OD-1 (ADR-0003 D16–D17).
- Status job: 15 status (termasuk `COMPLETED` untuk job langkah); publication tetap berakhir `PUBLISHED`.
- Worker: loop in-process, satu job per siklus, `WORKER_INTERVAL_MS` default 1000, `WORKER_ENABLED=false` = API baca-saja; `PLAN_CONTENT` hanya terdaftar bila `DEEPSEEK_API_KEY` tersedia (ADR-0004).
- `DEEPSEEK_API_KEY` hanya dibaca dari environment dan **tidak** masuk `AppConfig` (aman dilog); nilainya tidak pernah ditulis ke output/log/state.
- `MEDIA_ROOT` (default `./data/media`) adalah satu-satunya akar media: `outputRoot` generator = akar validasi.
- Publikasi: `PUBLISH` mencatat `publish_attempts` sebelum aksi eksternal; status akhir hanya dari `adapter.getStatus`; `processing`/`unknown` → `NEEDS_ATTENTION` (ADR-0005).
- Adapter YouTube saat ini **mock** (`YOUTUBE_ADAPTER=mock`, default `off`); post id `mock_yt_*` dan upload nyata UNVERIFIED (ADR-0005).
- YouTube nyata (ADR-0008): Data API v3 dengan scope `youtube.upload` + `youtube.readonly`; kuota bawaan 10.000 unit/hari + **100 `videos.insert`/hari per project**; privasi default **`private`** dan hasil diverifikasi lewat `videos.list` (mismatch → `NEEDS_ATTENTION`); `quotaExceeded`/`uploadLimitExceeded` tidak di-retry.
- OAuth YouTube (ADR-0008): desktop client + PKCE loopback; refresh token disimpan DPAPI di `%LOCALAPPDATA%\saa\credentials\`, DB hanya `secret_ref`; app **dilarang** beroperasi pada status Testing (refresh token 7 hari).
- Credential store (A1, `442d3be`): `DpapiCredentialStore` menulis payload JSON terenkripsi DPAPI secara atomik; rahasia lewat stdin ke helper PowerShell, nama berkas divalidasi; kredensial OAuth hanya dari env (`GOOGLE_OAUTH_CLIENT_ID`/`_SECRET`) dan tidak masuk `AppConfig`.
- OAuth client (A2, `5cbe70b`): pairing satu kali lewat loopback `127.0.0.1` + PKCE S256 (state konstan-waktu), token endpoint `fetch` tanpa SDK, record token `youtube-<accountId>` di DPAPI, refresh otomatis <60 s; `invalid_grant`/tanpa refresh token → `reauth_required` (kelas `AUTH`) dan bukan retry.
- Adapter API (A3, `26e557a`): `YouTubeApiAdapter` memakai `videos.insert` resumable + `videos.list` sebagai bukti; `published` hanya bila `privacyStatus` cocok (`private` default, `categoryId 27`); kegagalan setelah unggahan dikirim menjadi `unknown` (tanpa retry) karena `videos.insert` tidak idempoten; kuota/limit → kelas `AUTH` (eskalasi). Pemetaan idempotency → videoId hanya di memori.
- Wiring + onboarding (A4, `0b4194f`): composition root membuat adapter `api` (`createYouTubeApiPublisher`) dengan aset dari `media_assets` dan token DPAPI; env baru `YOUTUBE_UPLOAD_PRIVACY` (default `private`) dan `YOUTUBE_APP_STATUS` (default `unknown`, `testing` → log `error`); CLI `pair:youtube` memasangkan akun lalu menulis `secret_ref='dpapi:youtube:<id>'` + `connection_status='connected'`; `reauth_required` menandai akun di DB lewat hook adapter.
- Uji lintas lapisan (A5, `df9a2b7` + `8b8a698`): `tests/integration/p5-publish-youtube-api.test.ts` menjalankan `Dispatcher` → handler `PUBLISH` → composition root → adapter API dengan `fetch` palsu; membuktikan `PUBLISHED` (bukti videoId/permalink + header `Authorization`), privasi mismatch → `NEEDS_ATTENTION`, video ditolak → `FAILED`, kuota → `AUTH` tanpa byte terunggah + audit `needs_attention`, akun belum dipasangkan → `reauth_required` + job berikutnya ditolak sebelum aksi eksternal, refresh token kedaluwarsa → token baru dipakai, `invalid_grant` → `reauth_required`, dan aset tidak terbaca → `PUBLISH_VALIDATION` tanpa panggilan jaringan. Smoke live belum.
- Resume unggahan (A6, `c310d1f`): respons `308` dibaca dari header `Range` (`bytes=0-N` inklusif, atau `bytes=*/total`), sisa byte dikirim dengan `content-range: bytes start-end/total`; maksimal 3 lanjutan per unggahan. `Range` hilang/tidak valid atau lanjutan habis → `unknown` + `YT_UPLOAD_INCOMPLETE` (bukan retry — byte mungkin sudah terunggah).
- Rekonsiliasi lintas restart (A7, `a6dde05` + `bb1ba57`): handler menyimpan `externalPostId` segera setelah adapter mengembalikannya pada fase `processing`; adapter menerima `resolveUpload(key)` yang dibaca composition root dari `publish_attempts.external_post_id`, sehingga proses yang hidup kembali memverifikasi video tanpa mengunggah ulang. Tanpa `externalPostId` tersimpan, hasil tetap `unknown`.
- Kuota harian scheduler (`5af62ca`): attempt dengan `error_code` `PUBLISH_VALIDATION`/`VALIDATION`/`DISK` tidak dihitung karena tidak ada byte terkirim; kode lain tetap dihitung (konservatif terhadap batas YouTube).
- Pemicu konten manual (`1f27cd5`): `POST /api/v1/content` membuat job `PLAN_CONTENT` `QUEUED` dengan key `plan:manual:<campaignId>:<requestId|uuid>`; `requestId` sama → 202 `duplicate`; campaign/pipeline sibuk → 409.
- Kesiapan uji live (`bbfe83a`): `corepack pnpm --filter @saa/local-api preflight:youtube` memeriksa platform, adapter, kredensial OAuth (status ada/tidak), `YOUTUBE_APP_STATUS`, privasi, database, akun + blob DPAPI, dan aset media; exit 0 lulus/peringatan, 1 ada FAIL, 2 konfigurasi/pemakaian. Tidak memanggil Google dan tidak mencetak rahasia.
- Dokumen operasional (`365643d`): `docs/runbook.md` (perintah, env, prosedur smoke live + bukti, troubleshooting kode galat adapter, backup) dan `docs/security.md` (status kontrol aktual, celah auth/`Origin` local API, insiden, checklist P7). LLD §13 tetap kanonik.
- Aplikasi tidak membaca `.env`; semua konfigurasi dari environment proses. Perintah script pakai `pnpm run <script> <flag>` tanpa `--` pemisah (argumen `--` ikut diteruskan dan ditolak CLI).
- Dashboard (ADR-0009): `apps/dashboard` React 18 + Vite, dev di `localhost:5174` dengan proxy `/api` dan `/health` ke `127.0.0.1:4317`; halaman Jobs/Campaigns/Approvals/Accounts. **Aksi approve/reject** memakai binding dari `GET /api/v1/content/:id` (UI tidak menghitung hash); pairing akun tetap CLI. Tanpa router dan tanpa Tailwind pada iterasi ini; tidak ada test UI otomatis.
- D7 dijawab sebagian oleh ADR-0009 U6: artefak build dashboard = `vite build` (`apps/dashboard/dist`, gitignored), typecheck = `tsc`, **lint belum dipilih**.
- **Drift skema (2026-11-01):** `content_items` memakai PK `id` tunggal sementara LLD §5 menyebut `unique(id, version)`; versi baru untuk id yang sama tidak dapat disimpan (`UNIQUE constraint failed`). Saat ini satu baris per konten (versi selalu 1); revisi multi-versi menunggu keputusan owner (migrasi PK komposit vs tetapkan satu baris per id).
- Flow (ADR-0010): `playwright` + **Chrome/Edge terpasang** (fallback Chromium; `FLOW_BROWSER_CHANNEL` menimpa) karena Google menolak sign-in di Chromium for Testing. Profil persisten `%LOCALAPPDATA%\saa\browser\flow-profile` (`FLOW_PROFILE_DIR` absolut); `openFlowSession` memegang lock profil dan melepasnya pada semua jalur; URL Flow **`https://flow.google.com/`**. `flow:login` membuka browser headed untuk login manual (tanpa mengisi kredensial/menembus CAPTCHA); `flow:inspect` memetakan DOM read-only. Sesi tersimpan belum terautentikasi (`/about`), sehingga adapter generasi belum ditulis.
- Dispatch jadwal: `ScheduleDispatchLoop` (default 5 s) hanya membuat job `PUBLISH` untuk **konten terbaru** campaign aktif dengan aset valid, akun terhubung, caption platform tersedia, dan approval terikat valid; kunci idempoten `publish:<contentId>:v<version>:<accountId>:<platform>` (ADR-0006).
- Dispatch hanya berjalan bila `SCHEDULER_ENABLED=true`, worker aktif, dan adapter publikasi terdaftar; slot jadwal tetap maju walau tidak ada job terbuat (ADR-0006 S7).
- Produksi konten: satu `PLAN_CONTENT` per slot dengan pipeline **kedalaman satu** — perencanaan berjalan atau konten terbaru tanpa job `PUBLISH` menahan slot berikutnya; publikasi dijalankan lebih dulu dalam tick yang sama (ADR-0007).
- Quality gate P1: `tsc` strict + Vitest; lint/build artefak belum ada (ADR-0001 D7).

## Status Implementasi

| Fase | Status |
|---|---|
| P0 Bootstrap knowledge OS | COMPLETED (2026-10-29) |
| P1 Foundation (workspace, DB, API, logs, state machine, queue) | **COMPLETED (2026-10-30, commit `debdaaf`)** |
| P2 Agent core (kontrak planner, adapter DeepSeek, tool allowlist) | **COMPLETED (2026-10-30, commits `7d02a06`,`9cd360c`)** |
| P3 Flow (mock adapter + validasi media + handler GENERATE_VIDEO) | **PARTIAL (2026-10-30/11-01, commits `013531a`,`b8c85e0`,`fd62314`)** — mock + validasi media selesai; sesi profil Flow + `flow:login` selesai (ADR-0010); adapter generasi nyata & smoke menunggu login owner |
| P4 Approval & Scheduler (backend + engine + worker loop) | **PARTIAL (2026-10-30, commits `4b513ab`,`6ad9547`)** — UI baca-saja ada (ADR-0009, 2026-10-31); aksi approve/reject di UI belum |
| P4b Dispatch jadwal → job `PUBLISH` otomatis (milestone turunan P4/P5) | **COMPLETED (2026-10-30, commit `bfc7c72`)** |
| P4c Produksi konten per slot (milestone turunan P4/P5) | **COMPLETED (2026-10-30, commit `77fbb9c`)** — pipeline kedalaman satu |
| P5 YouTube (adapter mock + PUBLISH handler + verify/reconcile) | **PARTIAL (2026-10-30, commit `7d13431`)** — upload nyata UNVERIFIED; OD-2/OD-5 dijawab (ADR-0008) dan slice **A1 credential store** (`442d3be`) + **A2 OAuth client** (`5cbe70b`) + **A3 adapter API** (`26e557a`) + **A4 wiring/onboarding** (`0b4194f`) + **A5 uji lintas lapisan** (`df9a2b7`, diperkuat `8b8a698`) + **A6 resume 308** (`c310d1f`) + **A7 rekonsiliasi lintas restart** (`a6dde05`, `bb1ba57`) DONE, ditambah **CLI `preflight:youtube`** (`bbfe83a`) dan **runbook/security docs** (`365643d`); smoke live belum |
| P6 Platform lain · P7 Hardening | NOT STARTED |

Rincian fase + Definition of Done: `tasks/BACKLOG.md`. Bukti: `modules/foundation.md` (P1), `modules/agent-core.md` (P2), `modules/workflow.md`, `modules/scheduler.md` (P4 engine + P4b/P4c), `modules/browser-engine.md`, `modules/youtube.md`, `modules/local-api.md` (worker + dispatch loop + composition root), `decisions/ADR-0006-schedule-publish-dispatch.md` (P4b), `decisions/ADR-0007-content-production-per-slot.md` (P4c), `decisions/ADR-0008-youtube-real-adapter-od2-od5.md` (OD-2/OD-5 YouTube).
