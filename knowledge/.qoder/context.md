# L0 — Active Context

**Session:** SESSION-2026-10-30-4
**Updated:** 2026-10-30T08:50:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** LARGE (paket `@saa/scheduler` bertambah enqueuer + loop, `@saa/domain` bertambah helper caption, wiring runtime + konfigurasi; tanpa migrasi DB atau route baru)

## Current Task

**Tidak ada task aktif.** Permintaan owner **"pilih (a): dispatch jadwal periodik + pembuatan job PUBLISH otomatis"** selesai dan terverifikasi (2026-10-30, commit `bfc7c72`).

| Fase | Commit | Isi |
|---|---|---|
| A — wiring planner | `826a732` | `PLAN_CONTENT` handler, `COMPLETED` + `STEP_COMPLETED`, `campaigns.platforms_json` |
| B — P4 backend | `4b513ab` | Approval binding + API, engine scheduler, migrasi `0002` |
| C — P3 mock | `013531a`, `b8c85e0` | `@saa/browser-engine` (mock Flow, validasi media, lock profil), handler `GENERATE_VIDEO` |
| D — worker loop | `6ad9547` | `Worker` + `buildHandlerRegistry` + `/health` worker nyata |
| E — P5 mock publish | `7d13431` | `@saa/youtube` mock, kontrak `SocialAdapter`, repo `publish_attempts`, handler `PUBLISH`, `YOUTUBE_ADAPTER=mock` |
| F — P4b dispatch jadwal | `bfc7c72` | `enqueueDuePublicationJobs` + `createPublicationEnqueuer`, `ScheduleDispatchLoop`, `resolveCaption` di domain, `SCHEDULER_ENABLED`/`SCHEDULER_INTERVAL_MS` |

Status fase: **P3 PARTIAL** (Flow nyata tertahan OD-1), **P4 PARTIAL** (UI approval belum ada), **P4b COMPLETED** (dispatch jadwal → job `PUBLISH` otomatis), **P5 PARTIAL** (upload nyata UNVERIFIED — OD-2/OD-5).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api}.md`.
- Keputusan: `knowledge/decisions/ADR-0001…0006`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api`; 103 file TS tracked, 32 file test, **228 test hijau**; typecheck 9 paket + `tests/tsconfig.json` PASS.
- Migrasi tetap 3 berkas (`0000_init`, `0001_campaign_platforms`, `0002_scheduler_and_approval`); `publish_attempts` sudah ada di `0000_init`.
- Kontrak publikasi: `SocialAdapter` di `@saa/domain/src/publishing.ts` (`capabilities/validate/publish/getStatus`).
- Caption satu platform dihitung sekali lewat `resolveCaption` (`@saa/domain`) — dipakai handler `PUBLISH` **dan** enqueuer scheduler, sehingga hash binding approval identik.
- Dispatch: `ScheduleDispatchLoop` (default 5 s) memanggil `Scheduler.runOnce(createPublicationEnqueuer(...))`; hanya konten **terbaru** campaign aktif dengan aset valid, akun terhubung, caption platform tersedia, dan approval terikat valid.
- Kunci idempoten job `PUBLISH`: `publish:<contentId>:v<version>:<accountId>:<platform>`; replay tidak menggandakan job.
- Dispatch tidak membuat job untuk platform tanpa adapter terdaftar (`platforms` dari `publisher.platform`), dan tidak berjalan bila `SCHEDULER_ENABLED=false` / worker off / adapter off.
- Slot jadwal **tetap maju** walau tidak ada job terbuat (kontrak `EnqueueFn` tidak punya sinyal penundaan) — ADR-0006 S7.
- Handler `PUBLISH`: binding approval sebelum aksi eksternal; attempt `publish:<jobId>` dicatat sebelum upload; status akhir hanya dari `getStatus`.
- `PUBLISH_STARTED` diterima dari `SCHEDULED` dan `QUEUED` (promosi retry → `QUEUED`).
- Retry publikasi: `PUBLISH_SUBMITTED → VERIFICATION_FAILED` → `RETRY_WAIT` + backoff; `maxAttempts` → `PERMANENT_FAILURE`; `processing`/`unknown` → `NEEDS_ATTENTION`.
- Adapter mock: post id `mock_yt_<11 hex>`, idempoten per key, `limitations` jujur, tanpa `maxUploadBytes`; opt-in `YOUTUBE_ADAPTER=mock` (default `off`).
- Smoke boot terverifikasi: mock (port 4393) → `dispatch jadwal dimulai`, `scheduler: job publikasi dibuat` (`enqueued:1`), job `PUBLISH` berakhir `PUBLISHED`; off (port 4394) → `adapter publikasi belum aktif; dispatch jadwal tidak dijalankan`.
- Index kode: `LIGHTWEIGHT_GREP` — `index-state.json`.

## Keputusan Sesi Ini (ADR-0006)

1. Dispatch dipisah dari engine: loop tipis memanggil `runOnce` dengan enqueuer; engine tidak tahu isi job (S1).
2. Satu job `PUBLISH` per (konten, versi, akun, platform) dengan kunci idempoten deterministik (S2).
3. Hanya konten **terbaru** per campaign yang di-enqueue (S3).
4. Kesiapan konten dinilai sebelum enqueue: approval terikat, aset valid, akun `connected`, caption platform ada (S4).
5. Platform tanpa adapter tidak pernah di-enqueue (S5).
6. `resolveCaption` dipindah ke domain agar handler dan enqueuer tidak bisa berbeda tafsir (S6).
7. Slot jadwal tetap maju walau tidak ada job — konsekuensi kontrak enqueue yang ada (S7).
8. Loop dimatikan bila scheduler/worker/adapter tidak aktif (S8).
9. Konfigurasi `SCHEDULER_ENABLED` + `SCHEDULER_INTERVAL_MS` (1000–300000, default 5000) (S9).

## Langkah Berikutnya

Menunggu arahan owner: (a) approval UI desktop di atas API yang ada, (b) jawab OD-2/OD-5 untuk adapter YouTube nyata, (c) jawab OD-1 untuk adapter Flow nyata, (d) otomatisasi pembuatan konten (rantai `PLAN_CONTENT` → `GENERATE_VIDEO` belum dipicu campaign).

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- OD-1…OD-7 tetap OPEN; upload YouTube nyata dan Flow nyata belum diuji.
- Adapter DeepSeek belum diuji live (status UNVERIFIED); sumber API key belum diputuskan.
- Pembuatan konten belum otomatis: campaign harus sudah punya konten + aset; bila tidak, slot jadwal hangus (ADR-0006 S7).
- Kuota scheduler menghitung semua status `publish_attempts` — pengecualian belum ditetapkan.
- Lint/build artefak belum dipilih (ADR-0001 D7); `AGENTS.md` masih untracked.
- Mock generator bukan video valid untuk pemutaran; mock adapter tidak mengunggah apa pun.
