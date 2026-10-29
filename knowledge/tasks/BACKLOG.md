# BACKLOG

Sumber fase + DoD: `LLD.md` §18. Urutan ini mengikat kecuali user menyatakan lain.

## Fase Implementasi

| ID | Fase | Output | DoD | Status |
|---|---|---|---|---|
| P1 | Foundation | Workspace pnpm, schema DB + migrasi, Local API dasar, logging, domain state machine, persistent queue | Migrations · unit tests · `/health` · restart recovery | **COMPLETED** (2026-10-30, `debdaaf`) — bukti di `CURRENT.md` |
| P2 | Agent | DeepSeek provider, planner, tool registry allowlist | Schema validation, budget/timeout, mock tests | **COMPLETED** (2026-10-30, `7d02a06`,`9cd360c`) — bukti di `CURRENT.md` |
| P3 | Flow | Playwright session manager, Google Flow adapter, validasi media | Smoke test pada akun sah, file tervalidasi | NOT STARTED (tertahan OD-1) |
| P4 | Approval & Scheduler | Approval UI, schedules, quota, pause/resume | Approval binding + schedule persistence tests | NOT STARTED |
| P5 | YouTube | Adapter publikasi pertama | Authorized test upload, verify, retry/reconciliation tests | NOT STARTED |
| P6 | Platform lain | TikTok, Instagram, Facebook, X, Threads | Capability + contract test per adapter | NOT STARTED |
| P7 | Hardening | Packaging, backup, security review, runbook | Acceptance criteria + release checklist | NOT STARTED |

## Open Decisions (DILARANG diisi tanpa keputusan owner)

| ID | Keputusan | Dampak bila belum dijawab | Sumber |
|---|---|---|---|
| OD-1 | Akses/kebijakan Google Flow dan stabilitas alur UI-nya | P3 tidak bisa dinyatakan selesai (adapter boleh dibuat dengan mock) | LLD §19 |
| OD-2 | Izin/aplikasi publikasi per platform (TikTok app audit, Meta permissions, X tier/biaya) | P5/P6 tertahan di gate verifikasi eksternal | LLD §19 |
| OD-3 | Packaging desktop: Electron vs Tauri | P7 tertunda; worker tidak terpengaruh | HLD §4, LLD §19 |
| OD-4 | Strategi scale antrean (tetap SQLite vs Redis/BullMQ) | Default SQLite dipertahankan sampai ada beban terukur | LLD §19 |
| OD-5 | App registration OAuth per platform (scope, refresh, storage) | P5/P6 butuh ini untuk uji nyata | LLD §19 |
| OD-6 | Retensi media & kapasitas disk | Tidak menghalangi P1–P4 | LLD §19 |
| OD-7 | Batas concurrency produksi (mulai 1 Flow worker) | Default konservatif dipakai sampai ada uji stabilitas | LLD §19 |

## Backlog Teknis (turunan, belum dijadwalkan)

- Wiring planner → dispatcher: handler `PLAN_CONTENT` memanggil `createPlanner`, memetakan `PlannerOutputError` → `NEEDS_ATTENTION`; butuh schema campaign/konten/aset (ADR-0002 D9).
- Sumber API key DeepSeek (env vs Credential Manager) + uji live pertama adapter (status saat ini UNVERIFIED).
- Keputusan owner: apakah planner menolak target dengan capability `unknown`, atau memberi peringatan (ADR-0002 D8).
- ~~Pin versi Node LTS + pnpm; komit lockfile.~~ DONE 2026-10-30 — `engines >=22.12 <23`, `packageManager pnpm@9.15.4`, `pnpm-lock.yaml` dikomit.
- Tentukan apakah `HLD.md`/`LLD.md` dipindah ke `docs/` (buat ADR bila ya).
- Siapkan `docs/security.md` dan `docs/runbook.md` sebelum P7.
- Putuskan tool lint + build artefak (ADR-0001 D7) sebelum UI desktop dimulai.
- Keputusan owner: `AGENTS.md` dikomit atau di-ignore.
