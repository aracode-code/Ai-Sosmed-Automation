# CURRENT — Task Aktif

**Session:** SESSION-2026-11-02-1
**Updated:** 2026-11-02T08:06:00+07:00
**Change class:** MEDIUM (migrasi `0003_plan_approvals.sql`, route rencana, gerbang publikasi)

## Active Task

Owner meminta alur **permintaan → rencana kerja → persetujuan → agen bekerja**. **Slice 1** (kunci DeepSeek via DPAPI + planner lazy), **Slice 2** (rencana batch `items[]` + gerbang `PLAN_CONTENT`), dan **Slice 3** (approval tahap rencana + publikasi satu gerbang) **selesai**. Owner menyetujui desain: **setujui sekali per rencana**, **satu gerbang** (setelah rencana disetujui pembuatan + publikasi otomatis), kunci AI via DPAPI.

| Field | Nilai |
|---|---|
| Slice | **Slice 3** — approval tahap rencana + publikasi satu gerbang |
| Status | **COMPLETED (Slice 3)** — slice 4 (form UI + daftar approval batch) **belum dimulai** |
| Mode eksekusi | SINGLE-WRITER sequential, L1 |
| Commit kode | `8b9a512` |

## Bukti Sesi Ini (aktual 2026-11-02 WIB)

| Bukti | Hasil |
|---|---|
| Migrasi | `0003_plan_approvals.sql` — tabel `plan_approvals` (FK `jobs`/`campaigns`, unique `plan_job_id`, index `campaign_id`); total 4 migrasi / 13 tabel |
| Binding rencana | `hashPlanBinding` = sha256 kanonik `[{contentId, contentVersion, captionHash}]` terurut `contentId`; `planApprovalAllows` menolak keputusan selain `approved` atau hash berbeda; `planJobIdOfPrompt` membaca `prompt_json.planJobId` |
| Route | `GET /api/v1/plans/:jobId` (rencana + item + `bindingHash` + keputusan); `POST .../approve` dan `.../reject` body `{bindingHash, decidedBy?, reason?}` |
| Tolak-masalah | 404 `NOT_FOUND` · 409 `PLAN_NOT_READY` (job belum `COMPLETED`) · `PLAN_EMPTY` · `PLAN_ALREADY_DECIDED` · `PLAN_MISMATCH` · (approve) `PLAN_INVALID` bila item tanpa `videoPrompt` |
| Efek approve | Satu transaksi: `plan_approvals`, `content_items.approval_status='approved'` untuk semua item, `GENERATE_VIDEO` idempotent per item (`generate:<contentId>`, `parentJobId` = job rencana), audit `plan.approve`; respons `201 {approval, contentIds, enqueuedJobIds}` |
| Efek reject | Semua item `rejected`, **0** job generate, audit `plan.reject` |
| Publikasi satu gerbang | `planGateOrder` memilih kandidat: bila approval rencana valid → **seluruh** item rencana (kecuali `rejected`); tanpa itu jatuh ke konten terbaru + approval per-konten (kompatibel data lama) |
| Handler `PUBLISH` | `getPlanGate` → gerbang rencana valid melewati cek approval per-konten; bila tidak valid, jalur lama (`getLatestApproval` + `checkApprovalBinding`) tetap berlaku |
| Guard produksi | Slot ditahan sampai **setiap** item rencana punya job `PUBLISH` (`listPlanContentsAwaitingPublish`); route `POST /api/v1/content` memakai guard yang sama |
| Test baru | domain +4 (total 14), API rencana +7 (baru), scheduler dispatch +5, produksi +1, handler publish +3 → **57 file / 486 test** hijau |
| Quality gate | `corepack pnpm typecheck` exit 0 (10 paket + `tests/tsconfig.json`) · `vitest run --no-file-parallelism` **486/486** hijau |
| Secret scan | Diff hanya memuat peringatan CRLF; tidak ada nilai rahasia |

## Temuan yang Mengikat

| Temuan | Dampak |
|---|---|
| Binding rencana **tidak** memuat aset | Media belum ada saat approve; perubahan media tidak membatalkan keputusan, tetapi perubahan **caption** atau jumlah/versi item membatalkan (`PLAN_MISMATCH`) |
| Satu keputusan per rencana | Unique `plan_job_id`; keputusan kedua → 409, tidak ada job/konten ganda |
| Fallback approval per-konten dipertahankan | Rencana lama (tanpa `planJobId`) dan konten manual tetap dapat terbit dengan `approvals` lama |
| `rejected` per rencana berlaku menyeluruh | Reject rencana menandai semua item; item yang sudah `rejected` dilewati enqueuer |
| `GENERATE_VIDEO` idempotent per item | Approve ulang tidak mungkin; replay internal tidak menggandakan job |
| Konten rencana baru `pending` tidak punya job `PUBLISH` | Slot berikutnya tertahan sampai approve + generate + publish — perilaku kedalaman satu diperluas ke seluruh item |

## Impact Map

- **Kode diubah:** `packages/domain/src/{approval,entities}.ts`; `packages/database/src/{schema,index}.ts`, `repositories/{content,plan-approvals}.ts`; `packages/scheduler/src/{dispatch,production}.ts`; `packages/workflow/src/handlers/publish.ts`; `apps/local-api/src/{app.ts,routes/content.ts,routes/plans.ts}` + test masing-masing; migrasi `0003_plan_approvals.sql`.
- **Tidak berubah:** dashboard, adapter YouTube/Flow, konfigurasi env, dependensi/lockfile.
- **Dependensi baru:** tidak ada.

## Drift Tercatat

- UI belum memakai route rencana: form permintaan dan daftar approval batch = Slice 4.
- `PLAN_CONTENT` live dengan kunci nyata belum diuji (belum ada kunci DeepSeek milik owner).
- Temuan lama tetap: P3 PARTIAL (unduhan via worker belum diuji ulang), P4 PARTIAL (reauth), P5 PARTIAL (unggah nyata), P7 auth/`Origin`, `content_items` PK drift, ledger kredit jalur aplikasi, lint (D7), `AGENTS.md` untracked.

## Next Session Handoff

1. **Tunggu instruksi owner**; jangan mulai Slice 4 sebelum diminta.
2. Slice 4: form permintaan di Campaigns + daftar approval batch di UI (memakai `GET /api/v1/plans/:jobId` dan tombol approve/reject).
3. Isi kunci DeepSeek lewat Connections → uji satu siklus nyata (biaya sesuai guard Flow).
4. Rekonsiliasi job `NEEDS_ATTENTION` yang sudah punya aset `valid`: **jangan** klik retry (akan men-submit ulang).

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.
