# L0 — Active Context

**Session:** SESSION-2026-10-30-1
**Updated:** 2026-10-30T08:07:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** LARGE (wiring workflow + paket baru scheduler/browser-engine + migrasi 0001–0002)

## Current Task

**Tidak ada task aktif.** Tiga fase berurutan selesai dan terverifikasi (2026-10-30):

| Fase | Commit | Isi |
|---|---|---|
| A — wiring planner | `826a732` | `PLAN_CONTENT` handler, status `COMPLETED` + `STEP_COMPLETED`, `campaigns.platforms_json` |
| B — P4 backend | `4b513ab` | Approval binding + API, engine scheduler (time/window/kuota/pause), migrasi `0002` |
| C — P3 mock | `013531a`, `b8c85e0` | Paket `@saa/browser-engine` (mock Flow, validasi media, lock profil), handler `GENERATE_VIDEO` |

Status fase: **P4 PARTIAL** (UI approval + loop worker belum ada), **P3 PARTIAL** (Flow nyata tertahan OD-1).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine}.md`.
- Keputusan: `knowledge/decisions/ADR-0001…0003`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 7 paket workspace + `apps/local-api`; 88 file TS tracked, 25 file test, **179 test hijau** (typecheck 7 paket + tests/tsconfig PASS).
- Migrasi: `0000_init.sql`, `0001_campaign_platforms.sql`, `0002_scheduler_and_approval.sql`.
- API: 15 route terdaftar (health ×2, jobs ×2, campaigns ×3, approvals ×2, schedules ×3, scheduler pause/resume ×2, accounts ×1).
- Job langkah berakhir `COMPLETED` (`STEP_COMPLETED`); publication tetap `PUBLISHED` dan wajib bukti.
- `GENERATE_VIDEO`: `START_GENERATION` → generator → validasi media → aset `med_<contentId>` → `STEP_COMPLETED`. Generator tidak tersedia = `RESOURCE_BUSY` → retry; media invalid = `VALIDATION` → `FAILED`.
- Scheduler: `next_run_at` persisten, ujung quiet eksklusif, kuota per akun+platform per tanggal lokal, pause lewat `settings`.
- Approval: hash caption kanonik + versi konten + sha aset (bila ada media) + akun + platform; mismatch → 409.
- Index kode: `LIGHTWEIGHT_GREP` (tidak ada tool SQLite index) — `index-state.json`.

## Keputusan Sesi Ini

1. Satu job = satu langkah; status `COMPLETED` dipakai untuk job langkah (ADR-0003 D1).
2. Approval tidak mensyaratkan aset sudah ada — sha aset dicek hanya bila media sudah tercatat (D7–D8).
3. Scheduler tidak membuat job publikasi sendiri; `enqueue` disuntikkan (D14).
4. P3 dibangun di atas kontrak `VideoGenerator` dengan mock; artefak **bukan** video nyata (D16–D17).
5. Media wajib di dalam `outputRoot`; validasi magic + checksum sebelum dicatat (D18–D19).
6. Lock profil = berkas `wx` + TTL + pengambilalihan atomik; `ProfileBusyError` → `RESOURCE_BUSY` (D21).

## Langkah Berikutnya

Menunggu arahan owner: (a) worker loop + registrasi handler di `apps/local-api`, (b) P5 YouTube (publish/verify/reconcile), (c) approval UI, (d) jawab OD-1 untuk adapter Flow nyata.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- OD-1…OD-7 tetap OPEN; P3 penuh dan P5/P6 tertahan.
- Sumber API key DeepSeek belum diputuskan; adapter belum diuji live.
- Lint/build artefak belum dipilih (ADR-0001 D7).
- `AGENTS.md` masih **untracked**.
- Kuota menghitung semua status `publish_attempts` sampai P5 mendefinisikan status yang dikecualikan.
- Mock generator bukan video valid untuk pemutaran; tidak boleh dipakai sebagai bukti kualitas media.
