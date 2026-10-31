# BACKLOG

Sumber fase + DoD: `LLD.md` §18. Urutan ini mengikat kecuali user menyatakan lain.

## Fase Implementasi

| ID | Fase | Output | DoD | Status |
|---|---|---|---|---|
| P1 | Foundation | Workspace pnpm, schema DB + migrasi, Local API dasar, logging, domain state machine, persistent queue | Migrations · unit tests · `/health` · restart recovery | **COMPLETED** (2026-10-30, `debdaaf`) — bukti di `CURRENT.md` |
| P2 | Agent | DeepSeek provider, planner, tool registry allowlist | Schema validation, budget/timeout, mock tests | **COMPLETED** (2026-10-30, `7d02a06`,`9cd360c`) — bukti di `CURRENT.md` |
| P3 | Flow | Playwright session manager, Google Flow adapter, validasi media | Smoke test pada akun sah, file tervalidasi | **PARTIAL** (2026-10-30/11-01, `013531a`,`fd62314`,`f2e586e`,`5093c28`) — mock + validasi media + lock profil + sesi Playwright + `flow:login` + `flow:inspect` selesai (ADR-0010); adapter generasi & smoke menunggu sesi studio terautentikasi (saat ini `/about`) |
| P4 | Approval & Scheduler | Approval UI, schedules, quota, pause/resume | Approval binding + schedule persistence tests | **PARTIAL** (2026-10-30, `4b513ab`,`6ad9547`) — backend + engine + worker loop selesai; UI baca-saja ada (ADR-0009), aksi approval belum |
| P4b | Dispatch jadwal (turunan P4/P5) | Loop dispatch periodik + enqueuer job `PUBLISH` | Tick berulang tidak menggandakan job; siap-konten dinilai sebelum enqueue | **COMPLETED** (2026-10-30, `bfc7c72`) — ADR-0006 |
| P4c | Produksi konten (turunan P4/P5) | `PLAN_CONTENT` per slot, pipeline kedalaman satu, publikasi lebih dulu dalam tick | Slot tidak menumpuk job; konten baru terbit di slot berikutnya | **COMPLETED** (2026-10-30, `77fbb9c`) — ADR-0007 |
| P5 | YouTube | Adapter publikasi pertama | Authorized test upload, verify, retry/reconciliation tests | **PARTIAL** (2026-10-30, `7d13431`) — kontrak + adapter mock + PUBLISH handler + verify/reconcile + test retry selesai; upload nyata UNVERIFIED (OD-2/OD-5) |
| P6 | Platform lain | TikTok, Instagram, Facebook, X, Threads | Capability + contract test per adapter | NOT STARTED |
| P7 | Hardening | Packaging, backup, security review, runbook | Acceptance criteria + release checklist | NOT STARTED |

## Open Decisions (DILARANG diisi tanpa keputusan owner)

| ID | Keputusan | Dampak bila belum dijawab | Sumber |
|---|---|---|---|
| OD-1 | Akses/kebijakan Google Flow dan stabilitas alur UI-nya | P3 tidak bisa dinyatakan selesai (adapter boleh dibuat dengan mock). **Sebagian dijawab 2026-11-01** (`ADR-0010`): sesi Playwright + login manual tersedia; sisa faktual = apakah akun owner punya akses Flow, kuota, dan kebijakan otomasi | LLD §19 · ADR-0010 |
| OD-2 | Izin/aplikasi publikasi per platform (TikTok app audit, Meta permissions, X tier/biaya) | **YouTube DIJAWAB** (`ADR-0008` D1–D7): Data API v3, kuota 100 upload/hari/project, privasi default `private`. TikTok/Meta/X tetap terbuka | LLD §19 · ADR-0008 |
| OD-3 | Packaging desktop: Electron vs Tauri | P7 tertunda; worker tidak terpengaruh. Batasan agar konversi tetap murah dicatat di bagian *Backlog Teknis* ("Prasyarat konversi desktop") | HLD §4, LLD §19 |
| OD-4 | Strategi scale antrean (tetap SQLite vs Redis/BullMQ) | Default SQLite dipertahankan sampai ada beban terukur | LLD §19 |
| OD-5 | App registration OAuth per platform (scope, refresh, storage) | **YouTube DIJAWAB** (`ADR-0008` O1–O7): Desktop client + PKCE loopback, DPAPI, app bukan `Testing`. Platform P6 tetap terbuka | LLD §19 · ADR-0008 |
| OD-6 | Retensi media & kapasitas disk | Tidak menghalangi P1–P4 | LLD §19 |
| OD-7 | Batas concurrency produksi (mulai 1 Flow worker) | Default konservatif dipakai sampai ada uji stabilitas | LLD §19 |

## Backlog Teknis (turunan, belum dijadwalkan)

- ~~Worker loop + registrasi handler di `apps/local-api`~~ DONE 2026-10-30 (`6ad9547`) — ADR-0004.
- ~~Kontrak adapter publikasi + adapter YouTube mock + handler `PUBLISH` + verify/reconcile~~ DONE 2026-10-30 (`7d13431`) — ADR-0005. Upload nyata tetap menunggu OD-2/OD-5.
- ~~Dispatch jadwal periodik + pembuatan job `PUBLISH` otomatis~~ DONE 2026-10-30 (`bfc7c72`) — ADR-0006. Sisa: pembuatan konten otomatis agar slot tidak hangus.
- ~~Pembuatan konten otomatis (`PLAN_CONTENT` periodik)~~ DONE 2026-10-30 (`77fbb9c`) — ADR-0007. Sisa keputusan: kebijakan bila publikasi macet permanen (`NEEDS_ATTENTION`) menahan produksi slot berikutnya.
- ~~Route konten manual (`POST /api/v1/content`)~~ DONE 2026-10-30 (`1f27cd5`) — key `plan:manual:<campaignId>:<requestId>`, 202 queued/duplicate.
- **Kebijakan produksi saat `approvalMode=required`** — konten menunggu approval tidak punya job `PUBLISH`, sehingga slot produksi berikutnya tertahan (ADR-0007 C2). Perlu keputusan owner: lanjutkan produksi atau tunggu approval.
- ~~Approval UI beraksi~~ DONE 2026-11-01 (`5e8184b` endpoint `GET /api/v1/content/:id`, `406f1f5` dialog tinjau + aksi approve/reject di `apps/dashboard`). UI memakai binding dari server, memblokir keputusan tanpa aset `valid`/akun `connected`, dan menangani `APPROVAL_MISMATCH`.
- **Keputusan owner: dukungan revisi konten multi-versi.** `content_items` memakai PK `id` tunggal sementara LLD §5 menyebut `unique(id, version)`; insert versi baru untuk id yang sama gagal (`UNIQUE constraint failed`). Opsi: (a) migrasi ke PK komposit `(id, version)` + perubahan FK `media_assets`/`jobs`, atau (b) tetapkan satu baris per id dan hapus semantik versi dari binding approval. Tanpa keputusan ini, `version` selalu 1.
- ~~Tetapkan status `publish_attempts` yang dihitung kuota harian~~ DONE 2026-10-30 (`5af62ca`) — `PUBLISH_VALIDATION`/`VALIDATION`/`DISK` dikecualikan; kode ambigu tetap dihitung.
- **Adapter YouTube nyata** — keputusan OD-2/OD-5 dijawab (`ADR-0008`); **A1 credential store DPAPI DONE** (`442d3be`), **A2 OAuth client DONE** (`5cbe70b`), **A3 adapter API DONE** (`26e557a`), **A4 wiring + onboarding DONE** (`0b4194f`), **A5 uji lintas lapisan DONE** (`df9a2b7`), **A6 resume 308 DONE** (`c310d1f`), **A7 rekonsiliasi lintas restart DONE** (`a6dde05`, `bb1ba57`); sisa **smoke live** (pairing nyata + unggah `private` dengan bukti `videos.list`). Test bisa jalan tanpa kredensial; **uji live** menunggu input faktual owner (project OAuth, jenis akun, channel) dan pairing lewat `pair:youtube`.
- **Job `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` terpisah** — rekonsiliasi inline + lintas restart via `resolveUpload` sudah ada; job terjadwal menunggu keputusan owner (usulan: sekali pada +15 menit, maks. 2 polling, hanya attempt `unknown` ber-`externalPostId`; biaya 1 unit `videos.list`/panggilan).
- **Adapter Flow nyata** membutuhkan OD-1 (akses/kebijakan) dan sesi browser pada akun sah.
- Sumber API key DeepSeek (env vs Credential Manager): kode saat ini membaca `DEEPSEEK_API_KEY` dari env; Credential Manager/DPAPI belum dipilih + uji live pertama adapter (status UNVERIFIED).
- Keputusan owner: apakah planner menolak target dengan capability `unknown`, atau memberi peringatan (ADR-0002 D8).
- ~~Wiring planner → dispatcher `PLAN_CONTENT`~~ DONE 2026-10-30 (`826a732`) — ADR-0003 D1–D6.
- ~~Pin versi Node LTS + pnpm; komit lockfile.~~ DONE 2026-10-30 — `engines >=22.12 <23`, `packageManager pnpm@9.15.4`, `pnpm-lock.yaml` dikomit.
- Tentukan apakah `HLD.md`/`LLD.md` dipindah ke `docs/` (buat ADR bila ya).
- ~~Siapkan `docs/security.md` dan `docs/runbook.md` sebelum P7.~~ DONE 2026-10-31 (`365643d`) — runbook memuat prosedur smoke live; security mencatat celah auth/`Origin` local API sebagai pekerjaan P7. Tinjau ulang keduanya sebelum rilis.
- **Celah keamanan local API**: autentikasi token + validasi `Origin` + rate limit belum ada (LLD §13.2; tercatat di `docs/security.md`).
- Putuskan tool lint + build artefak (ADR-0001 D7) sebelum UI desktop dimulai.
- **Prasyarat konversi desktop (OD-3, ditunda 2026-11-01).** Rencana shell = Tauri v2 + sidecar Node yang membungkus UI + API yang sudah ada (bukan porting core). Konversi tetap murah **hanya bila** batasan ini dijaga selama versi web dibangun:
  - UI hanya memakai path relatif (`/api`, `/health`) dan tidak bergantung pada fitur dev server Vite (HMR/proxy); nanti `dist` disajikan sidecar agar satu origin.
  - Konfigurasi tetap env-driven dengan nilai absolut (`DATABASE_PATH`, `MEDIA_ROOT`, `APP_PORT`); app terpaket menulis ke `%LOCALAPPDATA%`, bukan folder instalasi yang read-only.
  - Tidak menyimpan state di cwd/repo; `resolveWorkspacePath` hanya untuk dev.
  - Tidak menaruh logika penting di script dev (`tsx watch`); packaging butuh build JS murni (Node SEA/esbuild) karena `tsconfig` memakai `noEmit`.
  - Penyesuaian pasti saat konversi: (a) route statis `dist` di Fastify, (b) sidecar berhenti bila proses induk mati (watchdog parent-death).
  - Verifikasi sebelum memilih shell: `better-sqlite3` + Node berjalan dari path read-only, DPAPI dari sidecar terpaket, Playwright Chromium diluncurkan dari sidecar, ukuran installer, auto-update.
- Keputusan owner: `AGENTS.md` dikomit atau di-ignore.
