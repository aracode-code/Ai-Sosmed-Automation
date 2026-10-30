# L0 — Active Context

**Session:** SESSION-2026-10-30-3
**Updated:** 2026-10-30T08:35:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** LARGE (paket baru `@saa/youtube`, kontrak domain, handler baru, wiring runtime; tanpa migrasi DB)

## Current Task

**Tidak ada task aktif.** Permintaan owner **"P5 YouTube (mock dulu)"** selesai dan terverifikasi (2026-10-30, commit `7d13431`).

| Fase | Commit | Isi |
|---|---|---|
| A — wiring planner | `826a732` | `PLAN_CONTENT` handler, `COMPLETED` + `STEP_COMPLETED`, `campaigns.platforms_json` |
| B — P4 backend | `4b513ab` | Approval binding + API, engine scheduler, migrasi `0002` |
| C — P3 mock | `013531a`, `b8c85e0` | `@saa/browser-engine` (mock Flow, validasi media, lock profil), handler `GENERATE_VIDEO` |
| D — worker loop | `6ad9547` | `Worker` + `buildHandlerRegistry` + `/health` worker nyata |
| E — P5 mock publish | `7d13431` | `@saa/youtube` mock, kontrak `SocialAdapter`, repo `publish_attempts`, handler `PUBLISH`, `YOUTUBE_ADAPTER=mock` |

Status fase: **P3 PARTIAL** (Flow nyata tertahan OD-1), **P4 PARTIAL** (UI approval + dispatch jadwal periodik), **P5 PARTIAL** (upload nyata UNVERIFIED; job publikasi belum dibuat otomatis).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api}.md`.
- Keputusan: `knowledge/decisions/ADR-0001…0005`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api`; 99 file TS tracked, 29 file test, **212 test hijau**; typecheck 9 paket + `tests/tsconfig.json` PASS.
- Migrasi tetap 3 berkas (`0000_init`, `0001_campaign_platforms`, `0002_scheduler_and_approval`); `publish_attempts` sudah ada di `0000_init`.
- Kontrak publikasi: `SocialAdapter` di `@saa/domain/src/publishing.ts` (`capabilities/validate/publish/getStatus`).
- Handler `PUBLISH`: binding approval sebelum aksi eksternal; attempt `publish:<jobId>` dicatat sebelum upload; status akhir hanya dari `getStatus`.
- `PUBLISH_STARTED` diterima dari `SCHEDULED` dan `QUEUED` (promosi retry → `QUEUED`).
- Retry publikasi: `PUBLISH_SUBMITTED → VERIFICATION_FAILED` → `RETRY_WAIT` + backoff; `maxAttempts` → `PERMANENT_FAILURE`.
- `processing`/`unknown` → `AMBIGUOUS_RESULT` → `NEEDS_ATTENTION` (tidak pernah dianggap `failed`).
- Adapter mock: post id `mock_yt_<11 hex>`, idempoten per key, `limitations` jujur, tanpa `maxUploadBytes`.
- Runtime opt-in: `YOUTUBE_ADAPTER=mock` (default `off`) → tanpa opt-in `PUBLISH` tidak terdaftar (`NO_HANDLER`).
- Smoke boot terverifikasi dua arah: mock → `handlers:["GENERATE_VIDEO","PUBLISH"]`, `workers.active=1`; off → hanya `GENERATE_VIDEO`.
- Index kode: `LIGHTWEIGHT_GREP` — `index-state.json`.

## Keputusan Sesi Ini (ADR-0005)

1. Kontrak adapter tinggal di domain (Y1); adapter YouTube hanya implementor.
2. Attempt dicatat sebelum aksi eksternal; satu key unik per job (Y2).
3. `PUBLISHED` hanya dari rekonsiliasi `getStatus`, bukan dari `publish()` (Y3).
4. Retry lewat `VERIFYING` karena `PUBLISHING` tidak bisa langsung `RETRY_WAIT` (Y5).
5. Error adapter retryable dikonversi handler; kelas escalate direthrow ke dispatcher (Y6).
6. Default runtime **tidak** mendaftarkan `PUBLISH`; opt-in eksplisit `YOUTUBE_ADAPTER=mock` (Y9).
7. Audit `content.publish` per hasil akhir (Y10).

## Langkah Berikutnya

Menunggu arahan owner: (a) dispatch jadwal periodik + pembuatan job `PUBLISH` otomatis, (b) approval UI desktop, (c) jawab OD-2/OD-5 untuk adapter YouTube nyata, (d) jawab OD-1 untuk adapter Flow nyata.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- OD-1…OD-7 tetap OPEN; upload YouTube nyata dan Flow nyata belum diuji.
- Adapter DeepSeek belum diuji live (status UNVERIFIED); sumber API key belum diputuskan.
- Kuota scheduler menghitung semua status `publish_attempts` — pengecualian belum ditetapkan.
- Tidak ada pemanggil yang membuat job `PUBLISH` (approval/scheduler belum meng-enqueue).
- Lint/build artefak belum dipilih (ADR-0001 D7); `AGENTS.md` masih untracked.
- Mock generator bukan video valid untuk pemutaran; mock adapter tidak mengunggah apa pun.
