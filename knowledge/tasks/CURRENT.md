# CURRENT — Task Aktif

**Session:** SESSION-2026-11-02-1
**Updated:** 2026-11-02T07:36:00+07:00
**Change class:** MEDIUM (manager kredensial + planner lazy + 2 route + UI; tanpa schema/migrasi)

## Active Task

Owner meminta alur **permintaan → rencana kerja → persetujuan → agen bekerja**, dengan kunci DeepSeek diisi dari UI. Slice 1 (prasyarat) **selesai dan diverifikasi**: kunci disimpan terenkripsi DPAPI lewat halaman Connections, planner meresolusi kunci per job, dan produksi konten terjadwal ditahan selama kunci belum ada.

| Field | Nilai |
|---|---|
| Slice | **Slice 1** — kredensial AI + planner lazy + input UI (ADR-0011) |
| Keputusan owner | Setujui **sekali per rencana** · **satu gerbang** (setelah rencana disetujui, pembuatan + publikasi otomatis) · kunci **DPAPI via UI** |
| Status | **COMPLETED (Slice 1)** — slice 2–4 (rencana ber-approval + migrasi) **belum dimulai**, menunggu review owner |
| Mode eksekusi | SINGLE-WRITER sequential, L1 |
| Commit kode | `1dfcadf` |

## Bukti Sesi Ini (aktual 2026-11-02 WIB)

| Bukti | Hasil |
|---|---|
| Presedensi kunci | `createAiCredentialManager`: store DPAPI dibaca lebih dulu, env fallback; `save()` menimpa cache sehingga kunci baru berlaku tanpa restart |
| Planner lazy | `createLazyPlanner`: kunci diresolusi per `plan()`; tanpa kunci → `AppError('AUTH')` → `NEEDS_ATTENTION` tanpa retry; `Planner` di-cache per nilai kunci |
| Route | `GET /api/v1/ai/status` → `{configured, source, storeError}`; `POST /api/v1/ai/credentials` body `.strict()` `{apiKey 10–200}` → `200 {configured:true, source:'store'}`; nilai kunci tidak pernah dikembalikan |
| Wiring | `server.ts`: `refresh()` saat boot, peringatan `storeError`/belum terkonfigurasi, planner **selalu** terdaftar, enqueue produksi digerbangi `aiCredentials.isConfigured()`; `app.ts` mendaftarkan route dengan store DPAPI default |
| UI | Section "Kunci AI (DeepSeek)" di Connections: pill status (`terkonfigurasi (DPAPI|environment)`/`belum diisi`), input password, tombol nonaktif < 10 karakter, error/berhasil, peringatan `storeError` |
| Test baru | `ai-credentials.test.ts` 7 · `lazy-planner.test.ts` 4 · `ai-credentials-route.test.ts` 4 → **56 file / 458 test** hijau |
| Smoke UI | Headless 1280×900 (viewport terpakai 1044 px): status `belum diisi → terkonfigurasi (DPAPI)`, kunci tidak ada di DOM/log, input dikosongkan; berkas DPAPI scratch 262 byte; store asli tidak tersentuh; scratch (`data/tmp-slice1`) dihapus |
| Quality gate | `corepack pnpm typecheck` exit 0 (10 paket + `tests/tsconfig.json`) · `vitest run --no-file-parallelism` **56 file / 458 test** hijau |

## Temuan yang Mengikat

| Temuan | Dampak |
|---|---|
| Kunci di store **menang** atas env | Nilai yang diketik owner langsung dipakai; env tetap fallback untuk CI/headless |
| Planner selalu terdaftar | Tanpa kunci, job `PLAN_CONTENT` berakhir `AUTH` (bukan `NO_HANDLER`); job lama perlu retry manual setelah kunci diisi |
| Gerbang produksi di `server.ts` | Slot tidak menghasilkan job `PLAN_CONTENT` yang pasti gagal selama kunci belum ada; publikasi konten lama tetap jalan |
| `sendJson` selalu mem-parse JSON | Endpoint simpan mengembalikan `200` JSON, bukan `204` |
| Store rusak tidak fatal | `storeError` dilaporkan di status + log; API tetap boot memakai env |
| Approval aset tidak bisa dipakai untuk rencana | `approvals.asset_sha256 NOT NULL` — slice 3 butuh migrasi `0003_plan_approvals.sql` |

## Impact Map

- **Kode baru:** `apps/local-api/src/ai-credentials.ts`, `lazy-planner.ts`, `routes/ai-credentials.ts` + 3 berkas test.
- **Kode diubah:** `apps/local-api/src/app.ts`, `server.ts`, `apps/dashboard/src/types.ts`, `pages/ConnectionsPage.tsx`.
- **Tidak berubah:** schema/migrasi (3 berkas, 12 tabel), paket/workspace, lockfile.
- **Route:** 26 → **28**.

## Drift Tercatat

- Alur approval rencana kerja **belum ada** (slice 2–4); desain disetujui owner, menunggu review setelah Slice 1.
- `PLAN_CONTENT` live dengan kunci nyata belum diuji (belum ada kunci DeepSeek milik owner).
- Temuan lama tetap: P3 PARTIAL (unduhan via worker belum diuji ulang), P4 PARTIAL (reauth), P5 PARTIAL (unggah nyata), P7 auth/`Origin`, `content_items` PK drift, ledger kredit jalur aplikasi, lint (D7), `AGENTS.md` untracked.

## Next Session Handoff

1. **Tunggu review owner atas Slice 1**; jangan menyentuh skema sebelum disetujui.
2. Slice 2 (setelah disetujui): planner mengembalikan `items[]` (maks. 5), `PLAN_CONTENT` tidak meng-enqueue `GENERATE_VIDEO` selama rencana `pending`.
3. Slice 3: migrasi `0003_plan_approvals.sql` (tanpa `asset_sha256` wajib) + `POST /api/v1/plans/:jobId/approve|reject` + publikasi satu gerbang.
4. Slice 4: form permintaan di Campaigns + daftar approval batch di UI.
5. Isi kunci DeepSeek lewat Connections → retry job `PLAN_CONTENT` `AUTH` bila ada → uji satu siklus nyata (biaya sesuai guard Flow).
6. Rekonsiliasi job `NEEDS_ATTENTION` yang sudah punya aset `valid`: **jangan** klik retry (akan men-submit ulang).

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.
