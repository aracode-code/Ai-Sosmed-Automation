# Modul — Workflow (Dispatcher + Handler Langkah)

**Status:** COMPLETED untuk P1/P2, PLAN_CONTENT, dan GENERATE_VIDEO (2026-10-30) · commit `70c7cec`, `826a732`, `013531a`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0003` (D1–D6, D22–D23). Kontrak: LLD §4.1, §9.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/workflow/src/dispatcher.ts` | Siklus `runOnce`: promosikan retry due → klaim satu job → jalankan handler → lepas lease; `HandlerContext.transition` adalah satu-satunya jalur ubah status |
| `packages/workflow/src/retry.ts` | `classify` (retry/escalate/fail/cancel), backoff eksponensial + jitter, `retryAfterMs` |
| `packages/workflow/src/recovery.ts` | Lease kedaluwarsa saat startup: reversibel → `QUEUED`, `PUBLISHING`/`VERIFYING` → `NEEDS_ATTENTION` |
| `packages/workflow/src/handlers/plan-content.ts` | Langkah PLAN_CONTENT: planner → konten + job `GENERATE_VIDEO` |
| `packages/workflow/src/handlers/generate-video.ts` | Langkah GENERATE_VIDEO: generator → validasi media → aset |
| `packages/workflow/src/index.ts` | Re-export publik |

Arah dependensi: `@saa/workflow` → `@saa/agent-core`, `@saa/browser-engine`, `@saa/database`, `@saa/domain`, `zod`.

## PLAN_CONTENT

- Payload: `{ campaignId, notes? }`; campaign wajib ada dan punya platform target, kalau tidak → `VALIDATION` → `FAILED`.
- Transisi: `START_PLANNING` → `PLANNING`; selesai `STEP_COMPLETED` → `COMPLETED`.
- Pemetaan keputusan planner: `needs_human` → `ESCALATE` + `PLANNER_NEEDS_HUMAN`; `wait` → `RETRY_WAIT` dengan `run_at = now + 6 jam` + `PLANNER_WAIT`; `revise_metadata` → `PlannerOutputError`; `create_video` → simpan konten.
- Konten: id `cnt_<jobId>`, versi 1, `approval_status` `pending`/`not_required`, caption dipetakan per platform.
- Job anak: `GENERATE_VIDEO` idempotent (`generate:<contentId>`), payload membawa `contentId`, `videoPrompt`, `aspectRatio`, `targets`.

## GENERATE_VIDEO

- Payload: `{ contentId, campaignId, videoPrompt, aspectRatio (default 9:16), targets? }`; konten wajib ada dan milik campaign.
- Transisi: `START_GENERATION` (QUEUED→GENERATING) → `STEP_COMPLETED` → `COMPLETED`.
- `checkAvailability()` gagal → `RESOURCE_BUSY` → retry (`RETRY_WAIT`).
- Output generator divalidasi `validateMediaFile` (containment, ukuran, magic MP4, sha256, probe opsional). Gagal → `VALIDATION` → `FAILED`.
- Aset disimpan `upsertMediaAsset` dengan id `med_<contentId>` dan `validation_status = 'valid'`; direktori relatif `content/<contentId>` di bawah `outputRoot`.
- Replay handler: generate ulang deterministik + upsert id yang sama → tetap satu baris aset.

## Perilaku Dispatcher (ringkas)

- Tanpa handler terdaftar → `NEEDS_ATTENTION` + `NO_HANDLER`.
- Handler melempar → `attempts + 1`; `classify`: `CANCELLED` → cancel, `AUTH`/`SECURITY_CHALLENGE`/`UI_CHANGED`/`AMBIGUOUS_RESULT`/`AI_OUTPUT_INVALID`/`DISK` → escalate, `VALIDATION` → fail, sisanya retry sampai `maxAttempts`.
- Transisi kegagalan yang ditolak state machine → eskalasi `NEEDS_ATTENTION` dengan log peringatan.

## Perintah

```bash
corepack pnpm --filter @saa/workflow typecheck
corepack pnpm vitest run packages/workflow      # dispatcher, retry, recovery, handler
corepack pnpm test                              # 179 test seluruh workspace
```

## Belum Ada

- Worker loop di proses nyata: `apps/local-api` belum menjalankan `Dispatcher.runOnce` periodik.
- Handler `DOWNLOAD_VIDEO`, `VALIDATE_MEDIA`, `CREATE_METADATA`, `REQUEST_APPROVAL`, `PUBLISH`, `VERIFY_PUBLICATION`, `RECONCILE_PUBLICATION`.
- Pemilihan generator per campaign/akun (saat ini satu `VideoGenerator` disuntikkan).
