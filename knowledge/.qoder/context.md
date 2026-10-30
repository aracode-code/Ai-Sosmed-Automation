# L0 — Active Context

**Session:** SESSION-2026-10-30-6
**Updated:** 2026-10-30T09:15:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** SMALL (keputusan + dokumentasi; tanpa perubahan kode, schema, route, atau dependensi)

## Current Task

**Tidak ada task aktif.** Permintaan owner **"lanjutkan ke opsi b jawab OD-2 dan OD-5 adapter YouTube"** diselesaikan sebagai **ADR-0008** (keputusan saja). Implementasi adapter nyata (slice A1–A5) belum dikerjakan.

| Fase | Commit | Isi |
|---|---|---|
| A — wiring planner | `826a732` | `PLAN_CONTENT` handler, `COMPLETED` + `STEP_COMPLETED`, `campaigns.platforms_json` |
| B — P4 backend | `4b513ab` | Approval binding + API, engine scheduler, migrasi `0002` |
| C — P3 mock | `013531a`, `b8c85e0` | `@saa/browser-engine` (mock Flow, validasi media, lock profil), handler `GENERATE_VIDEO` |
| D — worker loop | `6ad9547` | `Worker` + `buildHandlerRegistry` + `/health` worker nyata |
| E — P5 mock publish | `7d13431` | `@saa/youtube` mock, kontrak `SocialAdapter`, repo `publish_attempts`, handler `PUBLISH`, `YOUTUBE_ADAPTER=mock` |
| F — P4b dispatch jadwal | `bfc7c72` | `enqueueDuePublicationJobs`, `ScheduleDispatchLoop`, `resolveCaption` di domain |
| G — P4c produksi konten | `77fbb9c` | `enqueueDueContentPlan` + `createContentProductionEnqueuer`, helper guard, komposisi publikasi→produksi |
| H — sinkronisasi P4c | `948bd8d` | ADR-0007 + seluruh knowledge P4c |
| I — OD-2/OD-5 YouTube | _(docs commit sesi ini)_ | `ADR-0008`: kuota, privasi, metadata, error, OAuth, DPAPI, prasyarat owner |

Status fase: **P3 PARTIAL** (Flow nyata, OD-1) · **P4 PARTIAL** (UI approval) · **P4b COMPLETED** · **P4c COMPLETED** · **P5 PARTIAL** (keputusan OD-2/OD-5 selesai, upload nyata UNVERIFIED).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api}.md`.
- Keputusan: `knowledge/decisions/ADR-0001…0008`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api`; 107 file TS tracked, 34 file test, **235 test hijau** (hasil run terakhir, commit `77fbb9c`); typecheck 9 paket + `tests/tsconfig.json` PASS.
- Migrasi tetap 3 berkas (`0000_init`, `0001_campaign_platforms`, `0002_scheduler_and_approval`); 12 tabel; 15 route.
- Rantai otomatis penuh: slot 1 → `PLAN_CONTENT` → `GENERATE_VIDEO` → media valid → slot 2 → `PUBLISH` + `PLAN_CONTENT` berikutnya → berulang.
- Pipeline kedalaman satu: slot ditahan bila ada `PLAN_CONTENT` non-terminal (termasuk `NEEDS_ATTENTION`) atau konten terbaru belum punya job `PUBLISH`.
- Kunci idempoten produksi `plan:<scheduleId>:<slot>`; kunci publikasi `publish:<contentId>:v<version>:<accountId>:<platform>`.
- Dalam satu tick: publikasi **lebih dulu**, lalu produksi (ADR-0007 C4).
- Produksi hanya aktif bila planner tersedia; startup mencatat `planner tidak aktif; produksi konten otomatis tidak dijalankan`.
- Caption satu platform dihitung lewat `resolveCaption` (`@saa/domain`).
- Dispatch/loop hanya berjalan bila `SCHEDULER_ENABLED=true`, worker aktif, dan adapter publikasi terdaftar.
- Index kode: `LIGHTWEIGHT_GREP` / `DEGRADED` — `index-state.json`.
- **YouTube (E5, dibaca 2026-10-30):** kuota 10.000 unit/hari per project; `videos.insert` 1 unit + batas 100 panggilan/hari; referensi resmi menyatakan project unverified tidak dibatasi private, tetapi issue tracker Google 572863050 mempertanyakannya → CONFLICT; app OAuth eksternal berstatus Testing → refresh token 7 hari (VERIFIED).
- Kode saat ini: `YOUTUBE_ADAPTER` hanya menerima `off|mock`; tidak ada kolom token di `social_accounts` (`secret_ref` + `connection_status` saja).

## Keputusan Sesi Ini (ADR-0008)

1. **OD-2 / D1–D7:** Data API v3, scope `youtube.upload` + `youtube.readonly`; kuota bawaan dipakai (100 upload/hari/project); privasi default `private` dan diverifikasi via `videos.list` (mismatch → `NEEDS_ATTENTION`); metadata wajib termasuk `selfDeclaredMadeForKids=false`; `quotaExceeded`/`uploadLimitExceeded` tanpa retry; channel owner tanpa `onBehalfOfContentOwner`.
2. **OD-5 / O1–O7:** desktop OAuth client + PKCE loopback; `access_type=offline` + `prompt=consent`; app Internal (Workspace) atau In production (gmail), **bukan** Testing; refresh token di DPAPI `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin` dengan secret via stdin; DB hanya `secret_ref`; tanpa SDK `googleapis`.
3. Implementasi dibagi slice A1–A5; test bisa memakai HTTP palsu tanpa kredensial.

## Langkah Berikutnya

1. Implementasi adapter nyata **A1–A5** (config + credential store → OAuth → adapter → wiring → test), dengan HTTP palsu; uji live menunggu prasyarat owner.
2. Prasyarat faktual owner: project Google Cloud + billing, jenis akun Google, channel target, izin membuat OAuth client Desktop, konfirmasi privasi awal.
3. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- Apakah project unverified benar-benar boleh upload `public` (F2 CONFLICT) — hanya bisa dipastikan dari respons API pada uji nyata.
- Klasifikasi resmi scope `youtube.upload`, dan batas unggahan harian per channel (tidak dipublikasikan).
- OD-1 (Flow), OD-3, OD-4, OD-6, OD-7 tetap OPEN; OD-2/OD-5 hanya terjawab untuk YouTube.
- Adapter DeepSeek belum diuji live; sumber API key belum diputuskan.
- Mode approval `required` menahan produksi berikutnya; slot terlewat hangus.
- Kuota scheduler menghitung semua status `publish_attempts`.
- Lint/build artefak belum dipilih (ADR-0001 D7); `AGENTS.md` masih untracked.
- Mock generator bukan video valid untuk pemutaran; mock adapter tidak mengunggah apa pun.
