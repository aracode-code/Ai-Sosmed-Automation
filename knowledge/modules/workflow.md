# Modul — Workflow (Dispatcher + Handler Langkah)

**Status:** COMPLETED untuk P1/P2, PLAN_CONTENT, GENERATE_VIDEO, GENERATE_IMAGE (dua mode, ADR-0012), PUBLISH (mock), worker loop (2026-10-30), dan gerbang approval rencana di PUBLISH (2026-11-02, `8b9a512`) · commit `70c7cec`, `826a732`, `013531a`, `6ad9547`, `7d13431`, `8b9a512`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0003` (D1–D6, D22–D23), `ADR-0004` (W1–W4, W8), `ADR-0005` (Y1–Y10), `ADR-0012` (G3–G6, G9). Kontrak: LLD §4.1, §9, §11.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/workflow/src/dispatcher.ts` | Siklus `runOnce`: promosikan retry due → klaim satu job → jalankan handler → lepas lease; `HandlerContext.transition` adalah satu-satunya jalur ubah status |
| `packages/workflow/src/worker.ts` | Loop polling in-process: siklus berkala tanpa tumpang tindih, `unref`, error ditelan + dicatat |
| `packages/workflow/src/retry.ts` | `classify` (retry/escalate/fail/cancel), backoff eksponensial + jitter, `retryAfterMs` |
| `packages/workflow/src/recovery.ts` | Lease kedaluwarsa saat startup: reversibel → `QUEUED`, `PUBLISHING`/`VERIFYING` → `NEEDS_ATTENTION` |
| `packages/workflow/src/handlers/plan-content.ts` | Langkah PLAN_CONTENT: planner → 1–5 konten (+ job `GENERATE_VIDEO`/`GENERATE_IMAGE` sesuai `campaign.generationMode` bila tidak menunggu approval); menyimpan `mediaKind` di `prompt_json` |
| `packages/workflow/src/handlers/generate-media.ts` | `createGenerateMediaHandler(deps, kind)` untuk GENERATE_VIDEO dan GENERATE_IMAGE: generator → validasi media (per jenis) → aset |
| `packages/workflow/src/handlers/publish.ts` | Langkah PUBLISH: approval binding → attempt → adapter → reconcile `getStatus` (rinci: `modules/youtube.md`); aset wajib `video/mp4` |
| `packages/workflow/src/index.ts` | Re-export publik |

Arah dependensi: `@saa/workflow` → `@saa/agent-core`, `@saa/browser-engine`, `@saa/database`, `@saa/domain`, `zod`.

## PLAN_CONTENT

- Payload: `{ campaignId, notes? }`; campaign wajib ada dan punya platform target, kalau tidak → `VALIDATION` → `FAILED`.
- Transisi: `START_PLANNING` → `PLANNING`; selesai `STEP_COMPLETED` → `COMPLETED`.
- Pemetaan keputusan planner: `needs_human` → `ESCALATE` + `PLANNER_NEEDS_HUMAN`; `wait` → `RETRY_WAIT` dengan `run_at = now + 6 jam` + `PLANNER_WAIT`; `revise_metadata` → `PlannerOutputError`; `create_video` → simpan konten.
- **Bentuk rencana:** `planItemsOf(plan)` menerima `items` 1–5 atau bentuk tunggal lama; handler menolak 0 item / > 5 item sebagai `PlannerOutputError`.
- Konten: id batch `cnt_<jobId>_<n>` (1-based), bentuk tunggal tetap `cnt_<jobId>`; versi 1; `approval_status` `pending`/`not_required`; caption dipetakan per platform dari target item. `prompt_json` memuat `planJobId`, `itemIndex`, `itemCount`, dan `mediaKind` (`campaign.generationMode`) untuk pencarian item satu rencana dan tampilan approval.
- **Gerbang approval:** `approvalRequired=true` → semua konten `pending` dan **tidak ada** job generate; keputusan diambil di tahap rencana (`POST /api/v1/plans/:jobId/approve`) yang meng-enqueue generate untuk seluruh item. `false` → satu job idempotent (`generate:<contentId>`) per item dengan payload `contentId`, `videoPrompt`, `aspectRatio`, `targets`; **jenis job mengikuti mode campaign** (`GENERATE_IMAGE` untuk `image`, selain itu `GENERATE_VIDEO`). Job `PLAN_CONTENT` sendiri tetap `COMPLETED` dengan `content_id` = item pertama.
- **Setelah Slice 3 (`8b9a512`):** publikasi memakai approval rencana (satu gerbang) — lihat bagian PUBLISH.
- **Rasio** ditentukan policy `aspectRatioForTargets` (`@saa/domain`, ADR-0010 F17): TikTok/Instagram/Threads `9:16`; YouTube/Facebook `16:9` kecuali `contentFormat` short/reel/story/klip; X `16:9`; campuran → `9:16`. `plan.aspectRatio` hanya dipakai bila planner tidak menghasilkan target (bentuk tunggal).

## GENERATE_VIDEO / GENERATE_IMAGE

- Dua job type memakai satu implementasi `createGenerateMediaHandler(deps, kind)`; payload sama: `{ contentId, campaignId, videoPrompt, aspectRatio (default 9:16), targets? }` (nama `videoPrompt` dipertahankan untuk kedua mode, ADR-0012 G3). Konten wajib ada dan milik campaign.
- Transisi: `START_GENERATION` (QUEUED→GENERATING) → `STEP_COMPLETED` → `COMPLETED`.
- `checkAvailability()` gagal → `RESOURCE_BUSY` → retry (`RETRY_WAIT`).
- Output generator divalidasi `validateMediaFile` dengan `kind`: video → containment/ukuran/magic `ftyp`/sha256/probe; gambar → containment/ukuran/signature PNG atau JPEG/sha256 (probe tidak dipanggil). Gagal → `VALIDATION` → `FAILED`.
- Aset disimpan `upsertMediaAsset` dengan id `med_<contentId>`, `mimeType` hasil deteksi (`video/mp4`, `image/png`, `image/jpeg`), `durationMs` hanya video, dan `validation_status = 'valid'`; direktori relatif `content/<contentId>` di bawah `outputRoot`.
- Replay handler: generate ulang deterministik + upsert id yang sama → tetap satu baris aset.

## PUBLISH

- Payload `{ contentId, campaignId, accountId, platform }`; adapter harus platform yang sama.
- Prasyarat: campaign + konten (versi terbaru) + akun terhubung + aset `valid` **ber-`mimeType` `video/mp4`** + caption platform (`resolveCaption` di `@saa/domain`, dipakai juga oleh enqueuer scheduler). Aset gambar tidak pernah memenuhi syarat; job `PUBLISH` yang dipaksa pada konten gambar berakhir `FAILED` dengan `lastErrorCode = 'VALIDATION'` (ADR-0012 G9). Mode `required`: gerbang rencana valid (`getPlanGate` — `plan_approvals` + `hashPlanBinding` cocok) melewati cek approval per-konten; bila tidak valid, berlaku `getLatestApproval` + `checkApprovalBinding` seperti sebelumnya.
- `PUBLISH_STARTED` diterima dari `SCHEDULED` dan `QUEUED` (promosi retry mengembalikan job ke `QUEUED` — ADR-0005 Y4).
- Attempt dicatat sebelum aksi eksternal (`publish:<jobId>` unik); status akhir hanya dari `adapter.getStatus` (Y2–Y3).
- Retry lewat `PUBLISH_SUBMITTED → VERIFICATION_FAILED` karena `PUBLISHING` tidak dapat langsung ke `RETRY_WAIT` (Y5).
- Matriks kegagalan lengkap: `modules/youtube.md`.

## Perilaku Dispatcher (ringkas)

- Tanpa handler terdaftar → `NEEDS_ATTENTION` + `NO_HANDLER`.
- Handler melempar → `attempts + 1`; `classify`: `CANCELLED` → cancel, `AUTH`/`SECURITY_CHALLENGE`/`UI_CHANGED`/`AMBIGUOUS_RESULT`/`AI_OUTPUT_INVALID`/`DISK` → escalate, `VALIDATION` → fail, sisanya retry sampai `maxAttempts`.
- Transisi kegagalan yang ditolak state machine → eskalasi `NEEDS_ATTENTION` dengan log peringatan.

## Worker Loop

- `Worker({ runner, intervalMs, logger })` — `runner` cukup `{ runOnce() }`, dipenuhi `Dispatcher` (ADR-0004 W1).
- `start()` idempoten (timer ganda diabaikan), menjalankan satu siklus segera lalu tiap `intervalMs`; timer `.unref()`.
- Tick dilewati bila siklus sebelumnya belum selesai; `stop()` membersihkan timer dan menunggu siklus berjalan (`isRunning` menjadi `false`).
- Error `runOnce` ditelan dan dicatat (`errorClass`), loop tetap hidup; `runOnce()` publik mengembalikan job atau `null`.

## Perintah

```bash
corepack pnpm --filter @saa/workflow typecheck
corepack pnpm vitest run packages/workflow      # dispatcher, worker, retry, recovery, handler
corepack pnpm test                              # 501 test seluruh workspace (2026-11-02)
```

## Belum Ada

- Handler `DOWNLOAD_VIDEO`, `VALIDATE_MEDIA`, `CREATE_METADATA`, `REQUEST_APPROVAL`, `VERIFY_PUBLICATION`, `RECONCILE_PUBLICATION`.
- Satu instance `MediaGenerator` disuntikkan untuk kedua mode (mode hanya memilih `kind` dan job type); pemilihan generator berbeda per campaign/akun belum ada.
- Job `PUBLISH` kini dibuat otomatis oleh dispatch jadwal (`modules/scheduler.md`, ADR-0006), bukan oleh handler di paket ini. Publikasi media gambar belum didukung (ADR-0012).
