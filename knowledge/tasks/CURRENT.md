# CURRENT — Task Aktif

**Session:** SESSION-2026-11-02-1
**Updated:** 2026-11-02T08:22:19+07:00
**Change class:** MEDIUM (filter job per campaign/tipe, form permintaan + keputusan rencana di UI)

## Active Task

Owner meminta alur **permintaan → rencana kerja → persetujuan → agen bekerja**. **Slice 1** (kunci DeepSeek via DPAPI + planner lazy), **Slice 2** (rencana batch `items[]` + gerbang `PLAN_CONTENT`), **Slice 3** (approval tahap rencana + publikasi satu gerbang), dan **Slice 4** (form permintaan + keputusan rencana di Campaigns) **selesai**. Owner menyetujui desain: **setujui sekali per rencana**, **satu gerbang** (setelah rencana disetujui pembuatan + publikasi otomatis), kunci AI via DPAPI.

| Field | Nilai |
|---|---|
| Slice | **Slice 4** — form permintaan + keputusan rencana di Campaigns |
| Status | **COMPLETED (Slice 4)** — alur approval rencana kerja Slice 1–4 tuntas; menunggu instruksi owner |
| Mode eksekusi | SINGLE-WRITER sequential, L1 |
| Commit kode | `1656c9f` |

## Bukti Sesi Ini (aktual 2026-11-02 WIB)

| Bukti | Hasil |
|---|---|
| Filter job | `GET /api/v1/jobs` menerima `jobType` (validasi `JOB_TYPES`) dan `campaignId`; `ListJobsQuery`/`listJobs` memakai binding `NULL` untuk filter opsional; `jobType` asing → 400 `VALIDATION_ERROR` (`details[0].path='jobType'`) |
| Form permintaan | Halaman Campaigns: textarea `notes` + tombol **Minta rencana** → `POST /api/v1/content` `{campaignId, notes?}`; 202 `queued`/`duplicate` ditampilkan; form diblokir bila campaign tidak aktif atau tanpa platform |
| Daftar rencana | Tabel 5 job `PLAN_CONTENT` terbaru per campaign (`limit=5`) dengan status + tombol **Tinjau**; dimuat ulang lewat `refreshToken` setelah aksi |
| Panel keputusan | `PlanReviewPanel.tsx` memuat `GET /api/v1/plans/:jobId` (rencana, item, `bindingHash`, keputusan) dan mengirim `{bindingHash, decidedBy:'local-user', reason?}` ke approve/reject; `PLAN_MISMATCH` → instruksi muat ulang, `PLAN_ALREADY_DECIDED`/`PLAN_NOT_READY`/`PLAN_EMPTY`/`PLAN_INVALID` dipetakan ke pesan |
| Mode campaign | `automatic` → tinjauan baca-saja (pembuatan sudah otomatis di handler); `required` → kolom alasan + tombol Tolak/Setujui rencana; tombol disembunyikan setelah keputusan ada |
| Test baru | repository jobs +1, API jobs +2 (filter dan validasi `jobType`) → **57 file / 489 test** hijau |
| Quality gate | `corepack pnpm typecheck` exit 0 (10 paket + `tests/tsconfig.json`) · `vitest run --no-file-parallelism` **489/489** hijau |
| Smoke UI | Playwright headless (Chrome, 1440×1000) + DB scratch: form tampil, job rencana dibuat (`QUEUED` → `NEEDS_ATTENTION` karena kunci DeepSeek belum ada), panel menampilkan `bindingHash` + item, aksi **Tolak** sukses → notice dan status konten `rejected`; tidak ada kredensial di body/UI |
| Secret scan | Diff hanya memuat peringatan CRLF; tidak ada nilai rahasia |

## Temuan yang Mengikat

| Temuan | Dampak |
|---|---|
| Filter `jobType`/`campaignId` diperlukan di route lama | Tanpa filter, daftar rencana tidak dapat ditemukan setelah reload; endpoint baru tidak perlu |
| Tinjauan `automatic` baca-saja | Handler sudah men-enqueue `GENERATE_VIDEO`; keputusan rencana hanya bermakna untuk `required`, tetapi panel tetap menampilkan item + binding untuk transparansi |
| `bindingHash` selalu dari server | UI tidak menghitung hash; keputusan dikirim apa adanya dan server tetap menghitung ulang (`PLAN_MISMATCH`) |
| Form memakai `POST /api/v1/content` yang sudah ada | Idempotensi `requestId` dan guard pipeline (`PLAN_IN_PROGRESS`/`PIPELINE_BUSY`) tetap berlaku; UI tidak menambah jalur tulis baru |
| Halaman Approvals tidak diubah | Masih per-konten dengan binding aset; rencana menunggu keputusan hanya terlihat di Campaigns |

## Impact Map

- **Kode diubah:** `packages/database/src/repositories/jobs.ts` (+test); `apps/local-api/src/routes/jobs.ts`, `apps/local-api/src/app.test.ts`; `apps/dashboard/src/{App.tsx,types.ts,PlanReviewPanel.tsx,pages/CampaignsPage.tsx}`.
- **Tidak berubah:** migrasi/skema DB, route rencana, handler workflow, scheduler, adapter YouTube/Flow, konfigurasi env, dependensi/lockfile.
- **Dependensi baru:** tidak ada.

## Drift Tercatat

- Halaman Approvals belum menampilkan rencana yang menunggu keputusan (integrasi opsional, belum diminta).
- `PLAN_CONTENT` live dengan kunci nyata belum diuji (belum ada kunci DeepSeek milik owner) — smoke UI berakhir `NEEDS_ATTENTION`/`AUTH` sesuai desain.
- Temuan lama tetap: P3 PARTIAL (unduhan via worker belum diuji ulang), P4 PARTIAL (reauth), P5 PARTIAL (unggah nyata), P7 auth/`Origin`, `content_items` PK drift, ledger kredit jalur aplikasi, lint (D7), `AGENTS.md` untracked.

## Next Session Handoff

1. **Tunggu instruksi owner**; alur Slice 1–4 selesai dan tidak ada slice berikutnya yang disetujui.
2. Isi kunci DeepSeek lewat Connections → uji satu siklus nyata (biaya sesuai guard Flow).
3. Rekonsiliasi job `NEEDS_ATTENTION` yang sudah punya aset `valid`: **jangan** klik retry (akan men-submit ulang).
4. Retest unduhan `GENERATE_VIDEO` lewat aplikasi **butuh 1 kredit** — menunggu izin owner.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.
