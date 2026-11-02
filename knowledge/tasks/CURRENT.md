# CURRENT — Task Aktif

**Session:** SESSION-2026-11-02-1
**Updated:** 2026-11-02T07:46:00+07:00
**Change class:** MEDIUM (skema planner batch + handler PLAN_CONTENT; tanpa schema/migrasi)

## Active Task

Owner meminta alur **permintaan → rencana kerja → persetujuan → agen bekerja**, dengan kunci DeepSeek diisi dari UI. **Review Slice 1 lolos tanpa cacat penghambat**, dan **Slice 2 selesai**: planner dapat mengembalikan `items[]` (maks. 5 video), dan `PLAN_CONTENT` tidak meng-enqueue `GENERATE_VIDEO` selama rencana menunggu approval.

| Field | Nilai |
|---|---|
| Slice | **Slice 2** — rencana batch + gerbang approval (tanpa migrasi) |
| Keputusan owner | Setujui **sekali per rencana** · **satu gerbang** (setelah rencana disetujui, pembuatan + publikasi otomatis) · kunci **DPAPI via UI** |
| Status | **COMPLETED (Slice 2)** — slice 3–4 **belum dimulai**, menunggu review owner |
| Mode eksekusi | SINGLE-WRITER sequential, L1 |
| Commit kode | `df45977` |

## Review Slice 1 (sebelum Slice 2)

| Temuan | Status |
|---|---|
| Status AI dipanggil sebelum `refresh()` | Aman — route memanggil `resolve()` lebih dulu sehingga cache terisi |
| Validasi panjang kunci ganda (route + manager) | Disengaja: route memvalidasi batas HTTP, manager menjaga invariant store |
| Store DPAPI default dibuat di `buildApp` | Dapat diinjeksi di test; tidak ada kredensial nyata yang disentuh test |
| Cacat penghambat | **TIDAK ADA** |

## Bukti Sesi Ini (aktual 2026-11-02 WIB)

| Bukti | Hasil |
|---|---|
| Skema batch | `planItemSchema` (`topic`, `videoPrompt`, `targets`); `items` 1–5; field tunggal lama tetap valid (satu item) |
| Kebijakan | `checkPlanAgainstCampaign` memvalidasi target **per item** (`items[0].…`), platform campaign, duplikat, capability `unsupported`, batas caption; `enforceApproval` tidak berubah |
| Normalisasi | `planItemsOf` menyatukan bentuk batch dan bentuk tunggal; bentuk tunggal mempertahankan `aspectRatio` model bila tidak ada target |
| Prompt + budget | Prompt menjelaskan dua bentuk yang saling eksklusif; `maxTokens` default 1200 → **2400** agar 5 item + caption muat |
| Handler | Konten per item: batch `cnt_<jobId>_<n>` (1-based), tunggal tetap `cnt_<jobId>`; `prompt_json` memuat `planJobId`, `itemIndex`, `itemCount` (bahan Slice 3) |
| Gerbang approval | `approvalRequired=true` → `approval_status=pending`, **0 job** `GENERATE_VIDEO`; otomatis → job per item (`generate:<contentId>`) |
| Idempotensi | Replay handler batch: 2 konten + 2 job anak, tanpa duplikat (unique `(id, version)` + `insertJobIdempotent`) |
| Test baru | plan 4 tambahan (total 14), planner 1 (total 7), plan-content 3 (total 9) → **56 file / 466 test** hijau |
| Quality gate | `corepack pnpm typecheck` exit 0 (10 paket + `tests/tsconfig.json`) · `vitest run --no-file-parallelism` **466/466** hijau |

## Temuan yang Mengikat

| Temuan | Dampak |
|---|---|
| Batch = satu job `PLAN_CONTENT` berisi 1–5 konten | Job transisi `COMPLETED` dengan `content_id` = item pertama; item lain ditemukan lewat `prompt_json.planJobId`/id |
| Rencana `pending` tidak punya job `GENERATE_VIDEO` | Sesuai desain; pembuatan baru berjalan setelah Slice 3 menambahkan approval rencana |
| Guard produksi kedalaman satu tetap berlaku | Selama konten terbaru belum punya job `PUBLISH`, slot berikutnya ditahan — termasuk rencana pending (interim sampai Slice 3) |
| Publikasi masih memilih **konten terbaru saja** | Batch > 1 item: Slice 2 membuat semua item setelah approval otomatis, tetapi enqueuer publikasi hanya memilih satu; **single-gate publish milik Slice 3** |
| `planJobId` di `prompt_json` | Menghindari ketergantungan pada pola id saat Slice 3 mencari seluruh item satu rencana |

## Impact Map

- **Kode diubah:** `packages/agent-core/src/{plan,prompts,planner}.ts` + test; `packages/workflow/src/handlers/plan-content.ts` + test.
- **Tidak berubah:** schema/migrasi (3 berkas, 12 tabel), route (28), paket/workspace, lockfile, UI.
- **Dependensi baru:** tidak ada.

## Drift Tercatat

- Approval tahap rencana **belum ada** (Slice 3); `approvals.asset_sha256 NOT NULL` masih menjadi penghalang teknis.
- Publikasi batch belum ada: enqueuer masih memilih konten terbaru (Slice 3 "satu gerbang").
- `PLAN_CONTENT` live dengan kunci nyata belum diuji (belum ada kunci DeepSeek milik owner).
- Temuan lama tetap: P3 PARTIAL (unduhan via worker belum diuji ulang), P4 PARTIAL (reauth), P5 PARTIAL (unggah nyata), P7 auth/`Origin`, `content_items` PK drift, ledger kredit jalur aplikasi, lint (D7), `AGENTS.md` untracked.

## Next Session Handoff

1. **Tunggu review owner atas Slice 2**; jangan menyentuh skema sebelum disetujui.
2. Slice 3: migrasi `0003_plan_approvals.sql` (approval tahap rencana tanpa `asset_sha256` wajib) + `POST /api/v1/plans/:jobId/approve|reject` + enqueue `GENERATE_VIDEO` untuk **seluruh item** setelah approve + publikasi satu gerbang.
3. Slice 4: form permintaan di Campaigns + daftar approval batch di UI.
4. Isi kunci DeepSeek lewat Connections → uji satu siklus nyata (biaya sesuai guard Flow).
5. Rekonsiliasi job `NEEDS_ATTENTION` yang sudah punya aset `valid`: **jangan** klik retry (akan men-submit ulang).

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.
