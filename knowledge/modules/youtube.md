# Modul — YouTube (Adapter Publikasi Mock + PUBLISH Handler)

**Status:** PARTIAL — adapter **mock** + handler PUBLISH + verify/reconcile COMPLETED; keputusan adapter nyata selesai (ADR-0008) dengan **A1 credential store** (`442d3be`) dan **A2 OAuth client** (`5cbe70b`) DONE; A3–A5 belum; upload nyata **UNVERIFIED**
**Sumber:** kode aktual (E1). Keputusan: `ADR-0005` (Y1–Y10), `ADR-0008` (OD-2/OD-5). Kontrak: LLD §11.1–§11.4.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/domain/src/publishing.ts` | Kontrak `SocialAdapter`, `PublishRequest`, `PublishResult`, `PlatformCapabilities` |
| `packages/domain/src/entities.ts` | Entitas `PublishAttempt` (status `pending/published/processing/failed/unknown`) |
| `packages/database/src/repositories/publish-attempts.ts` | `insertPublishAttempt` (id `pub_<uuid>`), `getPublishAttempt`, `getPublishAttemptByKey`, `updatePublishAttempt` |
| `packages/youtube/src/mock-adapter.ts` | `MockYouTubeAdapter` — hasil deterministik, idempoten per key, capability jujur |
| `packages/youtube/src/credential-store.ts` | `DpapiCredentialStore` — payload token terenkripsi DPAPI per akun (A1) |
| `packages/youtube/src/oauth-client.ts` | `pairYouTubeAccount`, `ensureFreshAccessToken`, `startLoopbackReceiver` — pairing PKCE + refresh token (A2) |
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

## Credential Store (A1, aktual)

| Aspek | Nilai |
|---|---|
| Kelas | `DpapiCredentialStore` — `save(name, payload)`, `load<T>(name)`, `remove(name)`, `pathFor(name)` |
| Lokasi | `%LOCALAPPDATA%\saa\credentials\<nama>.bin` (root dapat dioverride untuk test) |
| Enkripsi | DPAPI `CurrentUser` via helper PowerShell statis; rahasia lewat **stdin** (bukan argumen), timeout 10 s |
| Nama | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, tanpa `..` — mencegah keluar dari root |
| Isi | JSON payload (mis. refresh token + masa berlaku); DB hanya menyimpan `secret_ref` + `connection_status` |
| Penulisan | `.tmp` → rename (atomik); kegagalan menulis membersihkan berkas sementara |
| Error | `INVALID_NAME` · `NOT_SUPPORTED` (non-Windows) · `PROTECT_FAILED` · `UNPROTECT_FAILED` · `CORRUPT` |

Catatan: `%LOCALAPPDATA%` sudah dibatasi per user, dan ciphertext DPAPI tetap terikat ke akun Windows meski berkas disalin.

## OAuth Client (A2, aktual)

| Aspek | Nilai |
|---|---|
| API | `pairYouTubeAccount`, `ensureFreshAccessToken`, `exchangeAuthorizationCode`, `refreshAccessToken`, `startLoopbackReceiver`, `buildAuthorizationUrl`, `createPkcePair`, `credentialNameFor` |
| PKCE | verifier 32 byte acak (43 karakter base64url), challenge `S256`; `state` 32 byte base64url dibandingkan **konstan-waktu** |
| Loopback | `http://127.0.0.1:<port>` (port default acak) pada `/oauth2/callback`; satu callback, `timeoutMs` default 300 s, server ditutup setelah callback/galat/timeout |
| Consent | `access_type=offline` + `prompt=consent` + `include_granted_scopes=true`; scope `youtube.upload` + `youtube.readonly` |
| Token endpoint | `https://oauth2.googleapis.com/token` via `fetch` form-urlencoded, timeout default 15 s, respons dibatasi 16 KB |
| Token | Disimpan sebagai record JSON di `DpapiCredentialStore` nama `youtube-<accountId>`: `accessToken`, `refreshToken`, `tokenType`, `scope`, `expiresAt` (epoch ms), `clientId`, `pairedAt` |
| Refresh | Otomatis bila sisa usia < 60 s; `refresh_token` lama dipertahankan bila Google tidak mengirim yang baru |
| Error | `reauth_required` (invalid_grant / tanpa refresh token, kelas `AUTH`) · `authorization_denied` (`AUTH`) · `state_mismatch` (`SECURITY_CHALLENGE`) · `timeout` (`TRANSIENT_NETWORK`) · `cancelled` (`CANCELLED`) · `provider_error` (kelas mengikuti HTTP: `RATE_LIMIT`, `EXTERNAL_5XX`, `VALIDATION`, `AUTH`) · `invalid_response` (`EXTERNAL_5XX`) · `invalid_client_config` (`AUTH`) |
| Keamanan | Browser **tidak** dibuka oleh modul (callback `openUrl` disuntikkan); halaman callback statis tanpa echo parameter; tidak ada token di log/pesan error |

Catatan: `ensureFreshAccessToken` mengembalikan `null` bila akun belum dipasangkan, `{ record, refreshed }` bila token siap dipakai, dan melempar `reauth_required` bila refresh tidak mungkin — A3/A4 yang memutuskan penandaan `connection_status`.

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
- `apps/local-api/src/config.ts`: `YOUTUBE_ADAPTER=off|mock|api` (default `off`); `loadYouTubeCredentials` membaca `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (opsional) dari env dan **tidak** memasukkannya ke `AppConfig`.
- `apps/local-api/src/server.ts`: `mock` → `new MockYouTubeAdapter()` + log "publikasi PALSU"; `api` → log `belum terhubung ke handler (slice A3–A4)`; `off` → log `job PUBLISH tidak terdaftar`.
- Tanpa adapter aktif: job `PUBLISH` → `NEEDS_ATTENTION` + `NO_HANDLER` (terlihat, bukan disembunyikan).

## Adapter Nyata — Keputusan (ADR-0008; A1–A2 selesai, adapter belum)

| Aspek | Keputusan |
|---|---|
| API | YouTube Data API v3; scope `youtube.upload` + `youtube.readonly` (D1) |
| Kuota | Bawaan **10.000 unit/hari** + **100 `videos.insert`/hari per project**; `videos.insert` = 1 unit (F1/D3) |
| Privasi | Default **`private`**; `YOUTUBE_UPLOAD_PRIVACY=private|unlisted|public`; hasil diverifikasi via `videos.list`, mismatch → `NEEDS_ATTENTION` (D4) |
| Metadata | title ≤100, description ≤5000, `categoryId` (default `27`), `selfDeclaredMadeForKids=false` (D5) |
| Error | `quotaExceeded`/`uploadLimitExceeded` → `NEEDS_ATTENTION` tanpa retry; `invalid_grant` → `reauth_required` (D6) |
| OAuth | Desktop client + PKCE loopback `127.0.0.1`; `access_type=offline` + `prompt=consent` (O1–O2) |
| Status app | Internal (Workspace) atau In production (gmail); **dilarang** Testing karena refresh token 7 hari (F4/O3) |
| Token | DPAPI file `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin`; DB hanya `secret_ref` + `connection_status` (O4) |
| Dependensi | Tanpa SDK `googleapis`; OAuth + resumable upload lewat `fetch` (O6) |

Catatan konflik: referensi resmi `videos.insert` (2026-10-30) menyatakan project unverified **tidak** dibatasi private, sementara issue tracker Google 572863050 mempertanyakan inkonsistensi dokumen. Karena itu privasi `public` tidak boleh diasumsikan sampai terbukti pada uji nyata.

## Perintah

```bash
corepack pnpm --filter @saa/youtube typecheck
corepack pnpm vitest run packages/youtube packages/workflow/src/handlers/publish.test.ts
corepack pnpm test                              # 269 test seluruh workspace
YOUTUBE_ADAPTER=mock corepack pnpm start        # boot dengan adapter mock
```

## Belum Ada

- Adapter YouTube nyata: slice A3–A5 (adapter API resumable + `videos.list`, wiring/onboarding, uji live) — A1 (`442d3be`) dan A2 (`5cbe70b`) selesai.
- Handler `VERIFY_PUBLICATION` / `RECONCILE_PUBLICATION` sebagai job terpisah.
- Klasifikasi `publish_attempts` untuk kuota harian (semua status masih dihitung).
