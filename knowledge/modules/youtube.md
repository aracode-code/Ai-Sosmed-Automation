# Modul — YouTube (Adapter Publikasi Mock + PUBLISH Handler)

**Status:** PARTIAL — adapter **mock** + handler PUBLISH + verify/reconcile COMPLETED; keputusan adapter nyata selesai (ADR-0008) dengan **A1 credential store** (`442d3be`), **A2 OAuth client** (`5cbe70b`), **A3 adapter API** (`26e557a`), **A4 wiring + onboarding** (`0b4194f`), **A5 uji lintas lapisan** (`df9a2b7`, diperkuat `8b8a698`), **A6 resume 308** (`c310d1f`), dan **A7 rekonsiliasi lintas restart** (`a6dde05`, wiring `bb1ba57`) DONE; CLI kesiapan `preflight:youtube` (`bbfe83a`) tersedia; smoke live (pairing + unggah nyata) belum; upload nyata **UNVERIFIED**
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
| `packages/youtube/src/youtube-api-adapter.ts` | `YouTubeApiAdapter` — `videos.insert` resumable + `videos.list` + verifikasi `privacyStatus` (A3), hook `onReauthRequired` (A4), resume HTTP 308 (A6), `resolveUpload` lintas restart (A7) |
| `apps/local-api/src/publisher.ts` | `createYouTubeApiPublisher` — komposisi adapter `api`: aset dari `media_assets`, token DPAPI, sinkron `reauth_required` (A4), `resolveUpload` dari `publish_attempts`, `accountId` akun tunggal (A7) |
| `apps/local-api/src/pair-youtube.ts` | CLI `pair:youtube` — onboarding akun: pairing PKCE lalu `secret_ref` + `connection_status` (A4) |
| `packages/workflow/src/handlers/publish.ts` | Handler langkah `PUBLISH`: validasi → approval binding → attempt → publish → reconcile |
| `tests/integration/p5-publish-youtube-api.test.ts` | Rantai nyata handler → composition root → adapter API dengan `fetch` palsu (A5) |

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

Catatan: `ensureFreshAccessToken` mengembalikan `null` bila akun belum dipasangkan, `{ record, refreshed }` bila token siap dipakai, dan melempar `reauth_required` bila refresh tidak mungkin — sejak A4 wiring menandai `connection_status = 'reauth_required'` lewat hook adapter.

## Adapter API (A3, aktual)

| Aspek | Nilai |
|---|---|
| Konstruksi | `new YouTubeApiAdapter({ store, clientId, clientSecret?, resolveAsset, privacy?, categoryId?, accountId?, fetchImpl?, uploadEndpoint?, videosEndpoint?, tokenEndpoint?, uploadTimeoutMs?, requestTimeoutMs? })` |
| Aset | `resolveAsset(assetId) → { path, mimeType, sizeBytes } \| null` disuntikkan; paket tidak mengimpor `@saa/database` |
| Token | `ensureFreshAccessToken` (A2) → header `Authorization: Bearer …`; akun belum dipasangkan → `reauth_required` |
| `publish` | `POST …/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` → `PUT` seluruh byte ke session URI (tanpa streaming); HTTP 308 → lanjut `PUT` sisa byte dengan `content-range` (maks. 3 lanjutan); sukses → `{ status:'processing', externalPostId }` |
| Metadata | judul eksplisit atau fallback caption ≤100 (spasi dinormalkan); deskripsi = caption ≤5000; `<`/`>` ditolak; `categoryId` default `27`; `selfDeclaredMadeForKids=false` |
| Privasi | `request.visibility` (bila valid) → `options.privacy` → `private` (D4) |
| `getStatus` | `GET …/youtube/v3/videos?part=status&id=…`; `published` hanya bila `privacyStatus` sama dengan permintaan |
| Pemetaan key | `idempotencyKey → { videoId, privacy, accountId }` di memori, dengan fallback `resolveUpload(idempotencyKey)` (A7) sehingga restart tidak mengunggah ulang; publish ulang dengan key sama → `processing` |
| Capability | `adapterVersion 'api-1'`; `authStatus` dihitung bila `accountId` diisi (composition root mengisi id akun YouTube tunggal); `limitations` menyebut kuota, privasi public, uji live, batas lanjutan resume, dan ketergantungan `resolveUpload` |

Hasil `getStatus` yang bukan `published`:

| Kondisi | Hasil |
|---|---|
| `privacyStatus` berbeda | `unknown` + `YT_PRIVACY_MISMATCH` → `NEEDS_ATTENTION` |
| `privacyStatus` tidak ada | `unknown` + `YT_PRIVACY_UNKNOWN` |
| `uploadStatus` `failed`/`rejected` | `failed` + `YT_UPLOAD_REJECTED` → `FAILED` |
| `uploadStatus` `deleted` | `failed` + `YT_VIDEO_DELETED` |
| `items` kosong / HTTP 404 | `unknown` + `YT_VIDEO_NOT_FOUND` |
| Key tidak dikenal (mis. setelah restart) | `unknown` + `YT_UNKNOWN_IDEMPOTENCY` |

Pemetaan error D6:

| Kejadian | Kelas |
|---|---|
| `quotaExceeded` / `dailyLimitExceeded` / `uploadLimitExceeded` | `AUTH` (eskalasi, **tanpa** retry) |
| HTTP 429 / `rateLimitExceeded` / `userRateLimitExceeded` | `RATE_LIMIT` (+`retryAfterMs`) |
| HTTP 401 / 403 lain | `AUTH` |
| HTTP 5xx saat **inisialisasi** sesi | `EXTERNAL_5XX` (aman retry — belum ada byte terkirim) |
| Jaringan / timeout saat inisialisasi | `TRANSIENT_NETWORK` |
| HTTP 400 saat inisialisasi | `VALIDATION` |
| Jaringan / 5xx sesudah `PUT` dikirim | **tidak dilempar** → `unknown` (`YT_UPLOAD_UNCERTAIN`) |
| HTTP 308 tanpa `Range` valid atau 3 lanjutan habis | **tidak dilempar** → `unknown` (`YT_UPLOAD_INCOMPLETE`) |
| HTTP 4xx lain sesudah `PUT` dikirim | `failed` + `YT_UPLOAD_REJECTED` |
| Respons sukses tanpa `id` | `unknown` + `YT_RESPONSE_INVALID` |

Alasan dua baris terakhir: `videos.insert` tidak idempoten — retry otomatis bisa menghasilkan video ganda, sehingga hasil tak pasti dieskalasi ke pemilik.

## Resume & Rekonsiliasi (A6–A7, aktual)

- **Resume 308 (A6, `c310d1f`):** balasan `308` dibaca dari header `Range` (`bytes=0-N`, N inklusif → lanjut dari `N+1`; `bytes=*/total` → mulai dari 0). Sisa byte dikirim dengan `content-range: bytes <start>-<end>/<total>`, maksimal 3 lanjutan per unggahan. Header hilang/tidak valid atau lanjutan habis → `unknown` + `YT_UPLOAD_INCOMPLETE`, bukan retry.
- **Rekonsiliasi lintas restart (A7, `a6dde05` + `bb1ba57`):** adapter menerima `resolveUpload(idempotencyKey)`; composition root membacanya dari `publish_attempts.external_post_id`, sehingga proses yang hidup kembali dapat memverifikasi video yang sudah terunggah tanpa mengunggah ulang. Handler menyimpan `externalPostId` begitu adapter mengembalikannya pada fase `processing`.
- **Batasan:** tanpa `externalPostId` tersimpan, restart tetap menghasilkan `unknown`; sesi resumable yang terputus tidak dilanjutkan lintas proses.

## Handler PUBLISH (urutan aktual)

1. Payload `{ contentId, campaignId, accountId, platform }` (Zod). Adapter harus `platform` yang sama.
2. Campaign → konten (versi terbaru, harus milik campaign) → akun (harus ada, platform cocok, `connectionStatus === 'connected'`, kalau tidak `AUTH`).
3. Aset media `validation_status = 'valid'`; caption target platform wajib ada dan tidak kosong.
4. `approvalMode = 'required'`: `content.approvalStatus` harus `approved` **dan** approval terakhir untuk target harus lolos `checkApprovalBinding` (6 elemen, `captionHash` = hash JSON kanonik seluruh caption).
5. `PUBLISH_STARTED` (dari `SCHEDULED` atau `QUEUED`) → `PUBLISHING`.
6. Attempt get-or-create dengan `idempotency_key = publish:<jobId>` (dicatat sebelum aksi eksternal).
7. `adapter.validate` gagal → attempt `failed` + `PUBLISH_VALIDATION` + error `VALIDATION` (→ `FAILED`).
8. `adapter.publish` → `PUBLISH_SUBMITTED` → `VERIFYING`. Bila hasil `processing` membawa `externalPostId`, id itu langsung disimpan di attempt — rekonsiliasi setelah restart tetap punya bukti.
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

## Wiring Runtime (A4, aktual)

- `apps/local-api/src/handlers.ts`: `publisher?: SocialAdapter` → `registry.PUBLISH = createPublishHandler(...)`; tanpa adapter `PUBLISH` **tidak** terdaftar.
- `apps/local-api/src/publisher.ts`: `createYouTubeApiPublisher({ db, config, credentials, store?, fetchImpl? })` → `YouTubeApiAdapter` dengan `resolveAsset` dari `media_assets` (`getMediaAsset` → `path`/`mimeType`/`sizeBytes`), privasi dari `config.youtubeUploadPrivacy`, dan `onReauthRequired` yang menulis `social_accounts.connection_status = 'reauth_required'`. `youtubeSecretRef(id)` = `dpapi:youtube:<accountId>`.
- `apps/local-api/src/config.ts`: `YOUTUBE_ADAPTER=off|mock|api` (default `off`), `YOUTUBE_UPLOAD_PRIVACY=private|unlisted|public` (default `private`), `YOUTUBE_APP_STATUS=testing|production|unknown` (default `unknown`); `loadYouTubeCredentials` membaca `GOOGLE_OAUTH_CLIENT_ID` + `GOOGLE_OAUTH_CLIENT_SECRET` (opsional) dari env dan **tidak** memasukkannya ke `AppConfig`.
- `apps/local-api/src/server.ts`: `mock` → `new MockYouTubeAdapter()` + log "publikasi PALSU"; `api` → tanpa `GOOGLE_OAUTH_CLIENT_ID` adapter **tidak** dibuat (log eksplisit), `YOUTUBE_APP_STATUS=testing` → log level `error` (refresh token 7 hari), `unknown` → peringatan; `off` → log `job PUBLISH tidak terdaftar`.
- Tanpa adapter aktif: job `PUBLISH` → `NEEDS_ATTENTION` + `NO_HANDLER` (terlihat, bukan disembunyikan).

## Onboarding Akun (A4, aktual)

| Aspek | Nilai |
|---|---|
| Perintah | `corepack pnpm --filter @saa/local-api pair:youtube --account <id>` atau `--label "<label>"` (+ `--port` opsional). Jangan memakai `--` pemisah: argumen `--` ikut diteruskan dan ditolak CLI |
| Alur | DB dimigrasi → akun dicari/dibuat (`--label` idempoten) → `GOOGLE_OAUTH_CLIENT_ID` wajib ada → `pairYouTubeAccount` (browser via `rundll32 url.dll,FileProtocolHandler`, URL **tidak** lewat shell) → token DPAPI → `updateAccountConnection(connected, secretRef)` |
| Output | id akun, nama kredensial, `pairedAt`, waktu kedaluwarsa token; **tidak pernah** access/refresh token |
| Gagal | Akun dibuat tetap `disconnected`; exit 2 untuk kesalahan pemakaian/konfigurasi, exit 1 untuk galat runtime |
| Penanda reauth | `YouTubeAuthError` `reauth_required` (dari `publish` maupun `getStatus`) → hook adapter menulis `connection_status = 'reauth_required'`; kegagalan menulis tidak menutupi galat auth |
| Repository | `updateAccountConnection(raw, id, { connectionStatus, secretRef? })` — `secretRef: undefined` mempertahankan nilai lama; label/platform tidak disentuh |

## Adapter Nyata — Keputusan (ADR-0008; A1–A5 uji lintas selesai, uji live belum)

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

## Uji Lintas Lapisan (A5, aktual)

`tests/integration/p5-publish-youtube-api.test.ts` menjalankan rantai **tanpa adapter mock**: `Dispatcher` → `createPublishHandler` → `createYouTubeApiPublisher` → `YouTubeApiAdapter` → `fetch` palsu, dengan token di store memori dan aset di disk sementara.

| Skenario | Hasil yang ditegakkan |
|---|---|
| Unggahan sukses | job `PUBLISHED`; attempt `published` + `externalPostId`/`permalink`/`verifiedAt`; urutan panggilan `POST` → `PUT` → `GET`; header `Authorization: Bearer` pada inisialisasi & verifikasi, tidak pada PUT sesi; body init memuat title/description/`categoryId 27`/`selfDeclaredMadeForKids false` |
| Privasi tidak sesuai | attempt `unknown` + `YT_PRIVACY_MISMATCH`, job `NEEDS_ATTENTION`, attempts 0, `runAt` null |
| Video ditolak YouTube | job `FAILED` + `YT_UPLOAD_REJECTED`, attempt `failed`, tanpa retry |
| Kuota habis (403 `quotaExceeded`) | job `NEEDS_ATTENTION` + `AUTH`, attempt `unknown`, hanya 1 panggilan, audit `needs_attention`, akun tetap `connected` |
| Belum dipasangkan | akun → `reauth_required` via hook; **0 panggilan eksternal**; job berikutnya ditolak penjaga `connection_status` (0 attempt, 0 panggilan) |
| Refresh token kedaluwarsa | `POST` ke token endpoint `grant_type=refresh_token`; token baru tersimpan ulang, unggahan/verifikasi memakai token baru, job `PUBLISHED` |
| Refresh dicabut (`invalid_grant`) | `AUTH` → `NEEDS_ATTENTION`, hanya 1 panggilan (token endpoint), akun → `reauth_required`, tanpa unggahan |
| Aset tidak terbaca | `PUBLISH_VALIDATION` → job `FAILED` + `VALIDATION`, attempt `failed`, **0 panggilan** |

Catatan: `getStatus` adapter API tidak pernah mengembalikan `processing`; jalur "belum terverifikasi" diwakili `unknown` (privasi beda / video tak ditemukan), dan handler memperlakukannya sama (`NEEDS_ATTENTION`). Eskalasi error adapter (AUTH/kuota/DISK) menulis audit `needs_attention` lewat `handleAdapterError`, bukan hanya lewat `escalateUnverified`.

## Perintah

```bash
corepack pnpm --filter @saa/youtube typecheck
corepack pnpm vitest run packages/youtube packages/workflow/src/handlers/publish.test.ts
corepack pnpm vitest run tests/integration/p5-publish-youtube-api.test.ts
corepack pnpm test                              # 340 test seluruh workspace
YOUTUBE_ADAPTER=mock corepack pnpm start        # boot dengan adapter mock
YOUTUBE_ADAPTER=api GOOGLE_OAUTH_CLIENT_ID=<id> YOUTUBE_APP_STATUS=production corepack pnpm start
corepack pnpm --filter @saa/local-api preflight:youtube            # kesiapan uji live
corepack pnpm --filter @saa/local-api pair:youtube --label "kanal utama"
```

## Belum Ada

- Smoke live: pairing nyata + satu unggahan `private` dengan bukti `videos.list` (sisa slice A5; butuh prasyarat owner). Kesiapan lokal dicek lebih dulu dengan `corepack pnpm --filter @saa/local-api preflight:youtube` (`bbfe83a`; prosedur `docs/runbook.md` §4).
- Job `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` terpisah: rekonsiliasi saat ini hanya terjadi bila job `PUBLISH` dijalankan ulang; kadensi polling dan biaya kuota `videos.list` menunggu keputusan owner.
- Resume 308 tidak menyimpan state sesi di disk: proses yang mati di tengah unggahan memulai sesi baru (video yatim harus dihapus manual di YouTube Studio).
- `resolveUpload` hanya mengenali attempt yang sudah punya `externalPostId`; attempt `unknown` tanpa id tidak dapat direkonsiliasi otomatis.
