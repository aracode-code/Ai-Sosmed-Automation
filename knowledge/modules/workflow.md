# Modul — Workflow (Dispatcher + Handler Langkah)

**Status:** COMPLETED untuk P1/P2, PLAN_CONTENT, GENERATE_VIDEO, PUBLISH (mock), dan worker loop (2026-10-30) · commit `70c7cec`, `826a732`, `013531a`, `6ad9547`, `7d13431`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0003` (D1–D6, D22–D23), `ADR-0004` (W1–W4, W8), `ADR-0005` (Y1–Y10). Kontrak: LLD §4.1, §9, §11.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/workflow/src/dispatcher.ts` | Siklus `runOnce`: promosikan retry due → klaim satu job → jalankan handler → lepas lease; `HandlerContext.transition` adalah satu-satunya jalur ubah status |
| `packages/workflow/src/worker.ts` | Loop polling in-process: siklus berkala tanpa tumpang tindih, `unref`, error ditelan + dicatat |
| `packages/workflow/src/retry.ts` | `classify` (retry/escalate/fail/cancel), backoff eksponensial + jitter, `retryAfterMs` |
| `packages/workflow/src/recovery.ts` | Lease kedaluwarsa saat startup: reversibel → `QUEUED`, `PUBLISHING`/`VERIFYING` → `NEEDS_ATTENTION` |
| `packages/workflow/src/handlers/plan-content.ts` | Langkah PLAN_CONTENT: planner → konten + job `GENERATE_VIDEO` |
| `packages/workflow/src/handlers/generate-video.ts` | Langkah GENERATE_VIDEO: generator → validasi media → aset |
| `packages/workflow/src/handlers/publish.ts` | Langkah PUBLISH: approval binding → attempt → adapter → reconcile `getStatus` (rinci: `modules/youtube.md`) |
| `packages/workflow/src/index.ts` | Re-export publik |

Arah dependensi: `@saa/workflow` → `@saa/agent-core`, `@saa/browser-engine`, `@saa/database`, `@saa/domain`, `zod`.

## PLAN_CONTENT

- Payload: `{ campaignId, notes? }`; campaign wajib ada dan punya platform target, kalau tidak → `VALIDATION` → `FAILED`.
- Transisi: `START_PLANNING` → `PLANNING`; selesai `STEP_COMPLETED` → `COMPLETED`.
- Pemetaan keputusan planner: `needs_human` → `ESCALATE` + `PLANNER_NEEDS_HUMAN`; `wait` → `RETRY_WAIT` dengan `run_at = now + 6 jam` + `PLANNER_WAIT`; `revise_metadata` → `PlannerOutputError`; `create_video` → simpan konten.
- Konten: id `cnt_<jobId>`, versi 1, `approval_status` `pending`/`not_required`, caption dipetakan per platform.
- Job anak: `GENERATE_VIDEO` idempotent (`generate:<contentId>`), payload membawa `contentId`, `videoPrompt`, `aspectRatio`, `targets`.
- **Rasio** ditentukan policy `aspectRatioForTargets` (`@saa/domain`, ADR-0010 F17): TikTok/Instagram/Threads `9:16`; YouTube/Facebook `16:9` kecuali `contentFormat` short/reel/story/klip; X `16:9`; campuran → `9:16`. `plan.aspectRatio` hanya dipakai bila planner tidak menghasilkan target.

## GENERATE_VIDEO

- Payload: `{ contentId, campaignId, videoPrompt, aspectRatio (default 9:16), targets? }`; konten wajib ada dan milik campaign.
- Transisi: `START_GENERATION` (QUEUED→GENERATING) → `STEP_COMPLETED` → `COMPLETED`.
- `checkAvailability()` gagal → `RESOURCE_BUSY` → retry (`RETRY_WAIT`).
- Output generator divalidasi `validateMediaFile` (containment, ukuran, magic MP4, sha256, probe opsional). Gagal → `VALIDATION` → `FAILED`.
- Aset disimpan `upsertMediaAsset` dengan id `med_<contentId>` dan `validation_status = 'valid'`; direktori relatif `content/<contentId>` di bawah `outputRoot`.
- Replay handler: generate ulang deterministik + upsert id yang sama → tetap satu baris aset.

## PUBLISH

- Payload `{ contentId, campaignId, accountId, platform }`; adapter harus platform yang sama.
- Prasyarat: campaign + konten (versi terbaru) + akun terhubung + aset `valid` + caption platform (`resolveCaption` di `@saa/domain`, dipakai juga oleh enqueuer scheduler); mode `required` wajib approval yang masih mengikat.
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
corepack pnpm test                              # 235 test seluruh workspace
```

## Belum Ada

- Handler `DOWNLOAD_VIDEO`, `VALIDATE_MEDIA`, `CREATE_METADATA`, `REQUEST_APPROVAL`, `VERIFY_PUBLICATION`, `RECONCILE_PUBLICATION`.
- Pemilihan generator per campaign/akun (saat ini satu `VideoGenerator` disuntikkan).
- Job `PUBLISH` kini dibuat otomatis oleh dispatch jadwal (`modules/scheduler.md`, ADR-0006), bukan oleh handler di paket ini.
