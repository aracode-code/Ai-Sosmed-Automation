# L0 — Active Context

**Session:** SESSION-2026-11-01-2
**Updated:** 2026-11-01T00:40:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** MEDIUM (dependensi Playwright + sesi profil Flow + CLI login)

## Current Task

**Tidak ada task aktif.** Owner meminta akses & menjalankan Flow; dipilih Playwright + Chromium dan urutan sesi lebih dulu. Sesi + `flow:login` selesai 2026-11-01 (`fd62314`); adapter generasi menunggu login owner.

| Fase | Commit | Isi |
|---|---|---|
| A–H | `826a732` … `948bd8d` | planner wiring, P4 backend, P3 mock, worker loop, P5 mock, P4b/P4c + ADR |
| I–N | `8288450` … `8b8a698` | ADR-0008 dan slice A1–A5 adapter YouTube API |
| O–S | `c310d1f` … `bb1ba57` | resume 308, kuota pra-unggah, route konten manual, rekonsiliasi restart, authStatus |
| T–U | `bbfe83a`, `365643d` | CLI `preflight:youtube`, runbook + security docs |
| V | `8e27b27`, `04c5c23` | `apps/dashboard` + ADR-0009 |
| W | `5e8184b`, `406f1f5` | `GET /api/v1/content/:id` + aksi approval |
| F | `fd62314` | sesi profil Flow + `flow:login` (ADR-0010) |

Status fase: **P3 PARTIAL** (Flow/OD-1) · **P4 PARTIAL** (UI approval beraksi DONE; pairing UI belum) · **P4b/P4c COMPLETED** · **P5 PARTIAL** (A1–A7 DONE; unggahan nyata UNVERIFIED).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api,dashboard}.md`.
- Keputusan: `ADR-0001…0009`. Operasional: `docs/runbook.md`, `docs/security.md`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api` + `apps/dashboard`; **138 file TS/TSX**, 44 file test, **357 test hijau** (commit `fd62314`); typecheck 10 paket + `tests/tsconfig.json` PASS.
- Migrasi tetap 3 berkas; 12 tabel; **17 route**.
- Rantai otomatis: slot → `PLAN_CONTENT` → `GENERATE_VIDEO` → media valid → `PUBLISH` + produksi slot berikutnya; publikasi lebih dulu dalam satu tick.
- Pipeline kedalaman satu: slot ditahan bila ada `PLAN_CONTENT` non-terminal atau konten terbaru belum punya job `PUBLISH`.
- Kunci idempoten: `plan:<scheduleId>:<slot>`, `publish:<contentId>:v<version>:<accountId>:<platform>`, `plan:manual:<campaignId>:<requestId|uuid>`, `publish:<jobId>`.
- Index kode: `LIGHTWEIGHT_GREP` / `DEGRADED` — `index-state.json`.
- **YouTube (E1):** `videos.insert` resumable + `videos.list` verifikasi `privacyStatus`; `private` default, `categoryId 27`; `quotaExceeded`/`uploadLimitExceeded` → `AUTH` tanpa retry; resume 308 maks. 3 lanjutan; `externalPostId` disimpan agar restart tidak mengunggah ulang.
- **Kredensial (E1):** token YouTube di DPAPI `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin`; DB hanya `secret_ref` + `connection_status`; OAuth client hanya dari env; aplikasi tidak membaca `.env`.
- **Konfigurasi (E1):** `YOUTUBE_ADAPTER=off|mock|api`, `YOUTUBE_UPLOAD_PRIVACY`, `YOUTUBE_APP_STATUS=testing|production|unknown` (status *Internal* diwakili `production`).
- **Preflight (E1, `bbfe83a`):** `preflight:youtube` — tanpa jaringan, tanpa mencetak rahasia; exit 0 lulus/peringatan, 1 FAIL, 2 konfigurasi.
- **Dashboard (E1, `8e27b27`, `406f1f5`):** `apps/dashboard` React 18 + Vite 6, dev `localhost:5174`, proxy `/api` + `/health` → `127.0.0.1:4317`; halaman Jobs/Campaigns/Approvals/Accounts; **aksi approve/reject** memakai binding dari `GET /api/v1/content/:id` (UI tidak menghitung hash), diblokir tanpa aset `valid`/akun `connected`, `APPROVAL_MISMATCH` → minta muat ulang. Tanpa router, tanpa Tailwind, tanpa test UI.
- **Endpoint detail konten (E1, `5e8184b`):** `GET /api/v1/content/:id?version=n` → konten (default versi tertinggi pada baris itu), `campaign {platforms, approvalMode}`, `assets` tanpa `path`, `captionHash` server-side, `accounts` kandidat; 7 test.
- **Drift skema (2026-11-01):** `content_items` PK `id` tunggal vs LLD §5 `unique(id, version)` → versi baru untuk id yang sama gagal; `version` saat ini selalu 1; menunggu keputusan owner.
- **Sesi Flow (E1, `fd62314`):** `playwright` + Chromium (`%LOCALAPPDATA%\ms-playwright\chromium-1248`); profil `%LOCALAPPDATA%\saa\browser\flow-profile` (`FLOW_PROFILE_DIR` absolut); `openFlowSession` memegang `.worker-lock.json` dan melepasnya pada close/launch gagal/goto gagal; `flow:login [--check]` — login manual headed, tanpa mengisi kredensial atau menembus CAPTCHA; `DEFAULT_FLOW_URL = https://labs.google/fx/tools/flow` (belum diverifikasi).
- **D7 (E1, ADR-0009 U6):** build UI = `vite build` (`dist` gitignored), typecheck = `tsc`; **lint belum dipilih**.
- **pnpm (E1):** argumen script diteruskan apa adanya; jangan memakai `--` pemisah. Root `typecheck` memakai `-r --if-present` sehingga paket UI ikut diverifikasi.

## Keputusan Sesi Ini (Flow)

1. `playwright` (bukan `playwright-core`) + Chromium terunduh; versi browser deterministik (ADR-0010 F1).
2. Satu profil = satu proses; lock diambil sebelum browser dibuka dan dilepas di semua jalur (F4).
3. Login hanya manual lewat `flow:login`; aplikasi tidak mengisi kredensial, tidak menembus CAPTCHA (F3).
4. Adapter generasi & selektor **tidak** ditulis sebelum ada bukti DOM dari akun nyata (F6).

## Langkah Berikutnya

1. `corepack pnpm --filter @saa/local-api flow:login` → login Google Flow → tutup jendela.
2. Petakan DOM Flow dari sesi nyata, lalu implementasi `FlowVideoGenerator` + pemetaan `SECURITY_CHALLENGE`/`UI_CHANGED`, lalu smoke satu video.
3. Menunggu owner lain: keputusan revisi multi-versi konten, smoke live YouTube, job rekonsiliasi terjadwal, pairing akun di UI, lint (D7), `AGENTS.md`.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- Apakah akun owner benar-benar punya akses Flow, kuota/limit, dan kebijakan penggunaannya (OD-1 sisa faktual).
- URL default Flow stabil/tidak; apakah generasi bisa berjalan headless (keduanya UNKNOWN).
- Apakah project unverified benar-benar boleh upload `public` (F2 CONFLICT) — hanya terbukti saat uji nyata.
- Klasifikasi resmi scope `youtube.upload` dan batas unggahan per channel (tidak dipublikasikan).
- Status publikasi app OAuth hanya diketahui dari laporan owner lewat `YOUTUBE_APP_STATUS`.
- DPAPI hanya teruji di Windows 10 host ini; OAuth/refresh/resume hanya dengan `fetch` palsu.
- Adapter DeepSeek belum diuji live; sumber API key belum diputuskan.
- Dashboard hanya diuji di Chromium desktop (viewport ~818px).
- Revisi konten multi-versi tidak dapat disimpan (PK `content_items` = `id`); `version` selalu 1.
- Flow nyata dan lint belum ada; pairing akun tetap CLI.
