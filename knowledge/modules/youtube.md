# Modul — YouTube (Adapter Publikasi Mock + PUBLISH Handler)

**Status:** PARTIAL — adapter **mock** + handler PUBLISH + verify/reconcile COMPLETED (2026-10-30); upload nyata **UNVERIFIED** (OD-2/OD-5)
**Sumber:** kode aktual (E1). Keputusan: `ADR-0005` (Y1–Y10). Kontrak: LLD §11.1–§11.4.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/domain/src/publishing.ts` | Kontrak `SocialAdapter`, `PublishRequest`, `PublishResult`, `PlatformCapabilities` |
| `packages/domain/src/entities.ts` | Entitas `PublishAttempt` (status `pending/published/processing/failed/unknown`) |
| `packages/database/src/repositories/publish-attempts.ts` | `insertPublishAttempt` (id `pub_<uuid>`), `getPublishAttempt`, `getPublishAttemptByKey`, `updatePublishAttempt` |
| `packages/youtube/src/mock-adapter.ts` | `MockYouTubeAdapter` — hasil deterministik, idempoten per key, capability jujur |
| `packages/workflow/src/handlers/publish.ts` | Handler langkah `PUBLISH`: validasi → approval binding → attempt → publish → reconcile |

Arah dependensi: `@saa/youtube` → `@saa/domain`; `@saa/workflow` → `@saa/domain` + `@saa/database` (adapter disuntikkan, bukan diimpor).

## Kontrak Adapter (LLD §11.1)

```ts
SocialAdapter {
  platform: PlatformId
  capabilities(): Promise<PlatformCapabilities>   // fitur belum terverifikasi = false + limitations
  validate(request): Promise<{ ok, issues }>
  publish(request): Promise<PublishResult>         // status: published | processing | failed | unknown
  getStatus(idempotencyKey): Promise<PublishResult> // rekonsiliasi, bukan asumsi
}
```

`PublishRequest`: `{ accountId, assetId, caption, title?, visibility?, idempotencyKey }`.

## Adapter Mock (perilaku aktual)

- `MockYouTubeAdapter({ outcome?, statusOutcome?, now?, maxCaptionLength? })`; default hasil `published`.
- Post id deterministik: `mock_yt_` + 11 hex pertama `sha256(idempotencyKey)`; permalink `https://www.youtube.com/watch?v=<id>`.
- `publish()` idempoten per key (hasil `published` di-cache); `getStatus('key tak dikenal')` → `{ status:'unknown', retryable:true, errorCode:'MOCK_UNKNOWN_KEY' }`.
- `capabilities()`: `adapterVersion 'mock-1'`, `videoSupported true`, `textSupported false`, `directPublishSupported true`, `draftSupported/schedulingSupported false`, tanpa `maxUploadBytes`/`supportedAspectRatios`, `limitations` menyebut "tidak ada unggahan nyata" + "kuota/izin/batas media belum diverifikasi (OD-2/OD-5)".
- `validate()`: menolak `accountId`/`assetId`/`caption` kosong dan caption > 5000 karakter.

## Handler PUBLISH (urutan aktual)

1. Payload `{ contentId, campaignId, accountId, platform }` (Zod). Adapter harus `platform` yang sama.
2. Campaign → konten (versi terbaru, harus milik campaign) → akun (harus ada, platform cocok, `connectionStatus === 'connected'`, kalau tidak `AUTH`).
3. Aset media `validation_status = 'valid'`; caption target platform wajib ada dan tidak kosong.
4. `approvalMode = 'required'`: `content.approvalStatus` harus `approved` **dan** approval terakhir untuk target harus lolos `checkApprovalBinding` (6 elemen, `captionHash` = hash JSON kanonik seluruh caption).
5. `PUBLISH_STARTED` (dari `SCHEDULED` atau `QUEUED`) → `PUBLISHING`.
6. Attempt get-or-create dengan `idempotency_key = publish:<jobId>` (dicatat sebelum aksi eksternal).
7. `adapter.validate` gagal → attempt `failed` + `PUBLISH_VALIDATION` + error `VALIDATION` (→ `FAILED`).
8. `adapter.publish` → `PUBLISH_SUBMITTED` → `VERIFYING`.
9. `adapter.getStatus` sebagai sumber kebenaran:
   - `published` + (`externalPostId` atau `permalink`) + `verifiedAt` → `VERIFICATION_SUCCEEDED` → `PUBLISHED`; attempt `published`; audit `content.publish/published`.
   - `published` tanpa identitas → `AMBIGUOUS_RESULT` → `NEEDS_ATTENTION` + `PUBLISH_EVIDENCE_INCOMPLETE`.
   - `failed` retryable → attempt `failed` lalu jalur retry (lihat tabel).
   - `failed` non-retryable → `PERMANENT_FAILURE` → `FAILED`; audit `failed`.
   - `processing`/`unknown` → `AMBIGUOUS_RESULT` → `NEEDS_ATTENTION`; attempt menyimpan status apa adanya.

### Matriks kegagalan

| Kejadian | Status job | Attempt | Catatan |
|---|---|---|---|
| `publish`/`getStatus` melempar kelas retry (`TRANSIENT_NETWORK`, `RATE_LIMIT`, `EXTERNAL_5XX`, `RESOURCE_BUSY`, `UNKNOWN`) | `RETRY_WAIT` (+`run_at` backoff) | `failed` + `errorClass` | `attempts + 1`; `maxAttempts` → `FAILED` |
| Melempar kelas escalate (`AUTH`, `SECURITY_CHALLENGE`, `UI_CHANGED`, `AMBIGUOUS_RESULT`, `AI_OUTPUT_INVALID`, `DISK`) | `NEEDS_ATTENTION` | `unknown` + `errorClass` | Dispatcher melakukan eskalasi standar |
| `validate` menolak / approval tidak valid / akun tidak terhubung | `FAILED` atau `NEEDS_ATTENTION` (AUTH) | tidak ada attempt (validasi) / tidak ada (AUTH sebelum attempt) | Binding dicek sebelum aksi eksternal |
| `processing` / `unknown` | `NEEDS_ATTENTION` | status asli | Rekonsiliasi manual / job berikutnya |

## Wiring Runtime

- `apps/local-api/src/handlers.ts`: `publisher?: SocialAdapter` → `registry.PUBLISH = createPublishHandler(...)`; tanpa adapter `PUBLISH` **tidak** terdaftar.
- `apps/local-api/src/config.ts`: `YOUTUBE_ADAPTER=off|mock` (default `off`).
- `apps/local-api/src/server.ts`: `YOUTUBE_ADAPTER=mock` → `new MockYouTubeAdapter()` + log peringatan "publikasi PALSU"; `off` → log `job PUBLISH tidak terdaftar`.
- Tanpa opt-in: job `PUBLISH` → `NEEDS_ATTENTION` + `NO_HANDLER` (terlihat, bukan disembunyikan).

## Perintah

```bash
corepack pnpm --filter @saa/youtube typecheck
corepack pnpm vitest run packages/youtube packages/workflow/src/handlers/publish.test.ts
corepack pnpm test                              # 235 test seluruh workspace
YOUTUBE_ADAPTER=mock corepack pnpm start        # boot dengan adapter mock
```

## Belum Ada

- Adapter YouTube nyata (OAuth, upload resumable, kuota, batas media) — menunggu OD-2/OD-5; status UNVERIFIED.
- Handler `VERIFY_PUBLICATION` / `RECONCILE_PUBLICATION` sebagai job terpisah.
- Pembuatan job `PUBLISH` otomatis (dari approval/dispatch jadwal) — belum ada pemanggil.
- Klasifikasi `publish_attempts` untuk kuota harian (semua status masih dihitung).
