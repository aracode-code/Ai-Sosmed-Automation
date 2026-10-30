# BACKLOG

Sumber fase + DoD: `LLD.md` §18. Urutan ini mengikat kecuali user menyatakan lain.

## Fase Implementasi

| ID | Fase | Output | DoD | Status |
|---|---|---|---|---|
| P1 | Foundation | Workspace pnpm, schema DB + migrasi, Local API dasar, logging, domain state machine, persistent queue | Migrations · unit tests · `/health` · restart recovery | **COMPLETED** (2026-10-30, `debdaaf`) — bukti di `CURRENT.md` |
| P2 | Agent | DeepSeek provider, planner, tool registry allowlist | Schema validation, budget/timeout, mock tests | **COMPLETED** (2026-10-30, `7d02a06`,`9cd360c`) — bukti di `CURRENT.md` |
| P3 | Flow | Playwright session manager, Google Flow adapter, validasi media | Smoke test pada akun sah, file tervalidasi | **PARTIAL** (2026-10-30, `013531a`) — mock + validasi media + lock profil selesai; Flow nyata tertahan OD-1 |
| P4 | Approval & Scheduler | Approval UI, schedules, quota, pause/resume | Approval binding + schedule persistence tests | **PARTIAL** (2026-10-30, `4b513ab`,`6ad9547`) — backend + engine + worker loop selesai; UI approval belum |
| P4b | Dispatch jadwal (turunan P4/P5) | Loop dispatch periodik + enqueuer job `PUBLISH` | Tick berulang tidak menggandakan job; siap-konten dinilai sebelum enqueue | **COMPLETED** (2026-10-30, `bfc7c72`) — ADR-0006 |
| P4c | Produksi konten (turunan P4/P5) | `PLAN_CONTENT` per slot, pipeline kedalaman satu, publikasi lebih dulu dalam tick | Slot tidak menumpuk job; konten baru terbit di slot berikutnya | **COMPLETED** (2026-10-30, `77fbb9c`) — ADR-0007 |
| P5 | YouTube | Adapter publikasi pertama | Authorized test upload, verify, retry/reconciliation tests | **PARTIAL** (2026-10-30, `7d13431`) — kontrak + adapter mock + PUBLISH handler + verify/reconcile + test retry selesai; upload nyata UNVERIFIED (OD-2/OD-5) |
| P6 | Platform lain | TikTok, Instagram, Facebook, X, Threads | Capability + contract test per adapter | NOT STARTED |
| P7 | Hardening | Packaging, backup, security review, runbook | Acceptance criteria + release checklist | NOT STARTED |

## Open Decisions (DILARANG diisi tanpa keputusan owner)

| ID | Keputusan | Dampak bila belum dijawab | Sumber |
|---|---|---|---|
| OD-1 | Akses/kebijakan Google Flow dan stabilitas alur UI-nya | P3 tidak bisa dinyatakan selesai (adapter boleh dibuat dengan mock) | LLD §19 |
| OD-2 | Izin/aplikasi publikasi per platform (TikTok app audit, Meta permissions, X tier/biaya) | **YouTube DIJAWAB** (`ADR-0008` D1–D7): Data API v3, kuota 100 upload/hari/project, privasi default `private`. TikTok/Meta/X tetap terbuka | LLD §19 · ADR-0008 |
| OD-3 | Packaging desktop: Electron vs Tauri | P7 tertunda; worker tidak terpengaruh | HLD §4, LLD §19 |
| OD-4 | Strategi scale antrean (tetap SQLite vs Redis/BullMQ) | Default SQLite dipertahankan sampai ada beban terukur | LLD §19 |
| OD-5 | App registration OAuth per platform (scope, refresh, storage) | **YouTube DIJAWAB** (`ADR-0008` O1–O7): Desktop client + PKCE loopback, DPAPI, app bukan `Testing`. Platform P6 tetap terbuka | LLD §19 · ADR-0008 |
| OD-6 | Retensi media & kapasitas disk | Tidak menghalangi P1–P4 | LLD §19 |
| OD-7 | Batas concurrency produksi (mulai 1 Flow worker) | Default konservatif dipakai sampai ada uji stabilitas | LLD §19 |

## Backlog Teknis (turunan, belum dijadwalkan)

- ~~Worker loop + registrasi handler di `apps/local-api`~~ DONE 2026-10-30 (`6ad9547`) — ADR-0004.
- ~~Kontrak adapter publikasi + adapter YouTube mock + handler `PUBLISH` + verify/reconcile~~ DONE 2026-10-30 (`7d13431`) — ADR-0005. Upload nyata tetap menunggu OD-2/OD-5.
- ~~Dispatch jadwal periodik + pembuatan job `PUBLISH` otomatis~~ DONE 2026-10-30 (`bfc7c72`) — ADR-0006. Sisa: pembuatan konten otomatis agar slot tidak hangus.
- ~~Pembuatan konten otomatis (`PLAN_CONTENT` periodik)~~ DONE 2026-10-30 (`77fbb9c`) — ADR-0007. Sisa keputusan: kebijakan bila publikasi macet permanen (`NEEDS_ATTENTION`) menahan produksi slot berikutnya.
- **Route konten manual** (`POST /api/v1/content` atau pemicu `PLAN_CONTENT` dari API) — saat ini produksi hanya lewat loop scheduler; operator belum bisa meminta satu konten di luar jadwal.
- **Kebijakan produksi saat `approvalMode=required`** — konten menunggu approval tidak punya job `PUBLISH`, sehingga slot produksi berikutnya tertahan (ADR-0007 C2). Perlu keputusan owner: lanjutkan produksi atau tunggu approval.
- **Approval UI** (React) di atas `POST /api/v1/content/:id/approve|reject`.
- **Tetapkan status `publish_attempts` yang dihitung kuota harian** (saat ini semua status dihitung, termasuk `failed`/`unknown`).
- **Adapter YouTube nyata** — keputusan OD-2/OD-5 sudah dijawab (`ADR-0008`); slice A1–A5 belum dikerjakan. Implementasi + test bisa jalan tanpa kredensial; **uji live** menunggu input faktual owner (project OAuth, jenis akun, channel).
- **Job `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` terpisah** belum ada; rekonsiliasi masih inline di handler `PUBLISH`.
- **Adapter Flow nyata** membutuhkan OD-1 (akses/kebijakan) dan sesi browser pada akun sah.
- Sumber API key DeepSeek (env vs Credential Manager): kode saat ini membaca `DEEPSEEK_API_KEY` dari env; Credential Manager/DPAPI belum dipilih + uji live pertama adapter (status UNVERIFIED).
- Keputusan owner: apakah planner menolak target dengan capability `unknown`, atau memberi peringatan (ADR-0002 D8).
- ~~Wiring planner → dispatcher `PLAN_CONTENT`~~ DONE 2026-10-30 (`826a732`) — ADR-0003 D1–D6.
- ~~Pin versi Node LTS + pnpm; komit lockfile.~~ DONE 2026-10-30 — `engines >=22.12 <23`, `packageManager pnpm@9.15.4`, `pnpm-lock.yaml` dikomit.
- Tentukan apakah `HLD.md`/`LLD.md` dipindah ke `docs/` (buat ADR bila ya).
- Siapkan `docs/security.md` dan `docs/runbook.md` sebelum P7.
- Putuskan tool lint + build artefak (ADR-0001 D7) sebelum UI desktop dimulai.
- Keputusan owner: `AGENTS.md` dikomit atau di-ignore.
