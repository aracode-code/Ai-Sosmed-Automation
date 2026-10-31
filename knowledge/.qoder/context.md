# L0 — Active Context

**Session:** SESSION-2026-10-31-2
**Updated:** 2026-10-31T23:58:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** LARGE (paket aplikasi baru `apps/dashboard`; tanpa perubahan schema, route, atau dependensi backend)

## Current Task

**Tidak ada task aktif.** Owner memilih opsi B: dashboard minimal sekarang. `apps/dashboard` (React 18 + Vite 6, baca-saja) dibuat dan diverifikasi 2026-10-31 (`8e27b27`, `04c5c23`).

| Fase | Commit | Isi |
|---|---|---|
| A–H | `826a732` … `948bd8d` | planner wiring, P4 backend, P3 mock, worker loop, P5 mock, P4b/P4c + ADR |
| I–N | `8288450` … `8b8a698` | ADR-0008 dan slice A1–A5 adapter YouTube API |
| O–S | `c310d1f` … `bb1ba57` | resume 308, kuota pra-unggah, route konten manual, rekonsiliasi restart, authStatus |
| T–U | `bbfe83a`, `365643d` | CLI `preflight:youtube`, runbook + security docs |
| V — dashboard | `8e27b27`, `04c5c23` | `apps/dashboard` baca-saja, ADR-0009, runbook UI, catatan keamanan dev server |

Status fase: **P3 PARTIAL** (Flow/OD-1) · **P4 PARTIAL** (UI baca-saja ada, aksi approval belum) · **P4b/P4c COMPLETED** · **P5 PARTIAL** (A1–A7 DONE; unggahan nyata UNVERIFIED).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api,dashboard}.md`.
- Keputusan: `ADR-0001…0009`. Operasional: `docs/runbook.md`, `docs/security.md`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api` + `apps/dashboard`; **133 file TS/TSX**, 42 file test, **340 test hijau** (commit `04c5c23`); typecheck 10 paket + `tests/tsconfig.json` PASS.
- Migrasi tetap 3 berkas; 12 tabel; **16 route**; UI tidak menambah route.
- Rantai otomatis: slot → `PLAN_CONTENT` → `GENERATE_VIDEO` → media valid → `PUBLISH` + produksi slot berikutnya; publikasi lebih dulu dalam satu tick.
- Pipeline kedalaman satu: slot ditahan bila ada `PLAN_CONTENT` non-terminal atau konten terbaru belum punya job `PUBLISH`.
- Kunci idempoten: `plan:<scheduleId>:<slot>`, `publish:<contentId>:v<version>:<accountId>:<platform>`, `plan:manual:<campaignId>:<requestId|uuid>`, `publish:<jobId>`.
- Index kode: `LIGHTWEIGHT_GREP` / `DEGRADED` — `index-state.json`.
- **YouTube (E1):** `videos.insert` resumable + `videos.list` verifikasi `privacyStatus`; `private` default, `categoryId 27`; `quotaExceeded`/`uploadLimitExceeded` → `AUTH` tanpa retry; resume 308 maks. 3 lanjutan; `externalPostId` disimpan agar restart tidak mengunggah ulang.
- **Kredensial (E1):** token YouTube di DPAPI `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin`; DB hanya `secret_ref` + `connection_status`; OAuth client hanya dari env; aplikasi tidak membaca `.env`.
- **Konfigurasi (E1):** `YOUTUBE_ADAPTER=off|mock|api`, `YOUTUBE_UPLOAD_PRIVACY`, `YOUTUBE_APP_STATUS=testing|production|unknown` (status *Internal* diwakili `production`).
- **Preflight (E1, `bbfe83a`):** `preflight:youtube` — tanpa jaringan, tanpa mencetak rahasia; exit 0 lulus/peringatan, 1 FAIL, 2 konfigurasi.
- **Dashboard (E1, `8e27b27`):** `apps/dashboard` React 18 + Vite 6, dev `localhost:5174`, proxy `/api` + `/health` → `127.0.0.1:4317`; halaman Jobs/Campaigns/Approvals/Accounts **baca-saja**; tanpa router, tanpa Tailwind, tanpa test UI; `getJson` memetakan respons non-JSON ≥500 menjadi "Local API tidak merespons".
- **D7 (E1, ADR-0009 U6):** build UI = `vite build` (`dist` gitignored), typecheck = `tsc`; **lint belum dipilih**.
- **pnpm (E1):** argumen script diteruskan apa adanya; jangan memakai `--` pemisah. Root `typecheck` memakai `-r --if-present` sehingga paket UI ikut diverifikasi.

## Keputusan Sesi Ini (dashboard)

1. UI hanya lewat proxy loopback; tidak menyentuh DB dan tidak menyimpan token (ADR-0009 U2).
2. Tanpa router & Tailwind pada iterasi pertama; dicatat sebagai penyimpangan LLD yang dapat ditinjau (U3/U4).
3. Aksi approve/reject ditunda karena binding (`assetSha256`, `captionHash`, `accountId`, `platform`) belum diekspos API; menghitung hash di browser akan menduplikasi `hashCaption` (U7).
4. Tanpa test UI otomatis; verifikasi di browser sungguhan (U8).

## Langkah Berikutnya

1. Buka UI: `corepack pnpm start` + `corepack pnpm ui`.
2. Kandidat kerja UI berikutnya: endpoint baca binding approval → aksi approve/reject di halaman Approvals → `GET /dashboard/summary`.
3. Menunggu owner: smoke live YouTube (`docs/runbook.md` §4), job rekonsiliasi terjadwal, OD-1 Flow, lint (D7), `AGENTS.md`.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- Apakah project unverified benar-benar boleh upload `public` (F2 CONFLICT) — hanya terbukti saat uji nyata.
- Klasifikasi resmi scope `youtube.upload` dan batas unggahan per channel (tidak dipublikasikan).
- Status publikasi app OAuth hanya diketahui dari laporan owner lewat `YOUTUBE_APP_STATUS`.
- Onboarding nyata (browser + consent Google) belum pernah dijalankan.
- DPAPI hanya teruji di Windows 10 host ini; OAuth/refresh/resume hanya dengan `fetch` palsu.
- Adapter DeepSeek belum diuji live; sumber API key belum diputuskan.
- Dashboard hanya diuji di Chromium desktop (viewport ~818px, layout sidebar); perilaku di resolusi lain belum diverifikasi.
- Flow nyata, aksi approval di UI, dan lint belum ada.
