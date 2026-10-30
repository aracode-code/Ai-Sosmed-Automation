# ADR-0008 — Adapter YouTube Nyata: Jawaban OD-2 & OD-5

**Status:** Accepted (diputuskan agen di L1 atas perintah owner "lanjutkan ke opsi b jawab OD-2 dan OD-5 adapter YouTube", 2026-10-30)
**Tanggal:** 2026-10-30
**Konteks:** ADR-0005 (mock) · P5 PARTIAL · OD-2/OD-5 di `tasks/BACKLOG.md` dan LLD §19
**Ruang lingkup:** **hanya YouTube**. OD-2/OD-5 untuk TikTok/Instagram/Facebook/X/Threads tetap terbuka sampai P6.

## Fakta Terverifikasi (dokumentasi resmi Google, dibaca 2026-10-30)

| # | Fakta | Status | Sumber |
|---|---|---|---|
| F1 | Kuota default YouTube Data API v3 = **10.000 unit/hari per project**; `videos.insert` = **1 unit**, dengan batas terpisah **100 panggilan `videos.insert`/hari** | VERIFIED | [Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost), [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| F2 | Referensi `videos.insert` saat ini menyatakan project yang belum diverifikasi **tidak** dibatasi private | VERIFIED (isi dokumen) · **CONFLICT** dengan [issue tracker 572863050](https://issuetracker.google.com/issues/572863050) (2026-10-13) yang mempertanyakan inkonsistensi dokumen | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| F3 | Scope `videos.insert`: `youtube.upload` (minimum), atau `youtube`/`youtubepartner`/`youtube.force-ssl` | VERIFIED | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| F4 | App OAuth **eksternal** berstatus **Testing** → refresh token **kedaluwarsa 7 hari** | VERIFIED | [OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) |
| F5 | Halaman verifikasi scope sensitif/terbatas (dibaca 2026-10-30) **tidak mencantumkan** `youtube.upload`; halaman itu menyebut privacy policy, demo video, dan domain verification untuk scope yang direview | VERIFIED (isi halaman) · klasifikasi final scope = **UNKNOWN** sampai registrasi | [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) |
| F6 | Batas unggahan harian **per channel** tetap ada (`uploadLimitExceeded`); angkanya tidak dipublikasikan | VERIFIED (keberadaan) · **UNKNOWN** (angka) | referensi error `videos.insert` |
| F7 | Upload API memerlukan `status.selfDeclaredMadeForKids` | INFERRED (pengetahuan API; akan terbukti saat uji nyata pertama) | — |

**Konsekuensi F2:** adapter **wajib** memverifikasi `status.privacyStatus` hasil `videos.list` setelah upload. Bila privasi yang diminta tidak terpenuhi, hasil bukan `PUBLISHED` — lihat D4.

## Keputusan OD-2 — Izin & Aplikasi Publikasi (YouTube)

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| D1 | YouTube Data API v3 dengan scope `youtube.upload` + `youtube.readonly` | Minimum privilege; `youtube` penuh ditolak karena memberi akses tulis di luar kebutuhan; `youtube.readonly` diperlukan `videos.list`/`channels.list` untuk verifikasi | Butuh operasi playlist/komentar |
| D2 | Satu baris `social_accounts` = satu channel; `secret_ref = dpapi:youtube:<accountId>`; `profile_key = null` | Struktur lama sudah mendukung referensi kredensial per akun; adapter API tidak memakai profil browser | Multi-channel per akun Google dalam satu baris |
| D3 | Memakai kuota default (10.000 unit + 100 upload/hari/**project**); tidak mengajukan kuota tambahan di MVP | Cukup untuk cadence MVP; kuota tambahan butuh audit/justifikasi yang belum perlu | Kebutuhan >100 upload/hari/project → satu project per brand atau ajukan kuota |
| D4 | Privasi unggahan default **`private`**; `YOUTUBE_UPLOAD_PRIVACY=private|unlisted|public`. Naik ke `public` hanya setelah uji nyata membuktikan privasi yang diminta benar-benar diterapkan | F2 masih CONFLICT; jangan mengklaim publikasi publik tanpa bukti empiris. Adapter memverifikasi `privacyStatus` via `videos.list`; mismatch → `NEEDS_ATTENTION` + `limitations: ['privacy_not_applied']`, **bukan** `PUBLISHED` | Owner mengonfirmasi unggahan publik stabil |
| D5 | Metadata wajib: `snippet.title` ≤100, `snippet.description` ≤5000, `snippet.categoryId` (env, default `27` = Education), `snippet.defaultLanguage` opsional, `status.privacyStatus`, `status.selfDeclaredMadeForKids=false` | Batas API + syarat upload; konten bukan untuk anak (D5 eksplisit agar tidak memicu kepatuhan COPPA salah) | Konten anak (tidak direncanakan) |
| D6 | `quotaExceeded` dan `uploadLimitExceeded` → **tanpa retry hari itu**, job `NEEDS_ATTENTION` (kelas eskalasi); `invalid_grant` → `connection_status = reauth_required`; 5xx/timeout → retry policy yang ada; upload memakai protokol resumable | Retry pada kuota habis hanya membakar kuota/loop; reauth tidak bisa diperbaiki otomatis | Kuota naik / limit channel berubah |
| D7 | Channel milik owner (pribadi atau brand account); **tidak** memakai `onBehalfOfContentOwner` (CMS/MCN) | Aplikasi single-tenant, bukan multi-channel network | Owner memakai CMS |

## Keputusan OD-5 — App Registration OAuth (YouTube)

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| O1 | OAuth client tipe **Desktop app** (public client) dengan redirect loopback `http://127.0.0.1:<port>/oauth2/callback` + **PKCE S256** | Aplikasi lokal single-user; loopback sesuai model desktop app Google dan tidak butuh domain | Butuh onboarding web/multi-user (nanti: Web application + domain verification) |
| O2 | Consent `access_type=offline` + `prompt=consent` saat pairing; token endpoint `https://oauth2.googleapis.com/token`; access token diperbarui bila sisa <60 s | Refresh token hanya terbit dengan `offline`; refresh proaktif menghindari kegagalan upload di tengah jalan | — |
| O3 | Status publikasi app: **Internal** bila owner memakai Google Workspace; **In production** bila akun gmail pribadi. **DILARANG** beroperasi harian dalam status **Testing** | F4: token Testing mati 7 hari = kegagalan senyap; Internal tidak terkena aturan itu; In production untuk app eksternal | Owner memilih Workspace |
| O4 | Refresh token disimpan **DPAPI** (user scope) di `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin`, ACL hanya user; enkripsi/dekripsi lewat helper PowerShell `ProtectedData` dengan secret via **stdin** (bukan argumen); masa berlaku token ikut di dalam blob. DB hanya menyimpan `secret_ref` + `connection_status` | LLD §13.1 (Credential Manager/DPAPI); tidak ada dependensi npm baru (G5 tidak dipicu); tidak ada migrasi schema | Butuh multi-user/multi-proses → `@napi-rs/keyring` (G5) |
| O5 | Konfigurasi baru (nilai tidak pernah dicetak): `YOUTUBE_ADAPTER=off|mock|api`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (opsional untuk desktop, tetap diperlakukan rahasia), `YOUTUBE_UPLOAD_PRIVACY`, `YOUTUBE_CATEGORY_ID`, `YOUTUBE_DEFAULT_LANGUAGE`, `GOOGLE_OAUTH_REDIRECT_PORT` (opsional). Refresh token **tidak boleh** berasal dari env | Mengikuti pola `DEEPSEEK_API_KEY` + ADR-0005 (adapter opt-in); rahasia tidak masuk `AppConfig`/log/state | — |
| O6 | Implementasi OAuth + upload resumable memakai `fetch`, **tanpa SDK `googleapis`** | Konsisten ADR-0002; menghindari dependensi baru (G5) | Butuh fitur lanjutan (chunk tuning, batch) |
| O7 | Pairing akun satu kali lewat perintah lokal (loopback), hasil `connection_status = connected`; kegagalan refresh → `reauth_required` dan job `NEEDS_ATTENTION` | Kredensial tidak boleh dimasukkan lewat chat/berkas knowledge | UI desktop menyediakan alur pairing |

## Prasyarat Faktual dari Owner (bukan keputusan desain)

Implementasi dan test bisa berjalan dengan HTTP palsu tanpa ini; **uji live** menunggu:

1. **Google Cloud project** (ID) + billing account — kuota dasar gratis, billing diperlukan bila mengajukan kuota tambahan.
2. **Jenis akun Google** pemilik channel: Workspace (→ Internal) atau gmail (→ In production).
3. **Channel target** (nama/ID; brand account atau bukan).
4. Persetujuan membuat **OAuth client Desktop** + consent screen di project tersebut.
5. Konfirmasi privasi awal: `private` (rekomendasi) atau langsung `public`.

## Konsekuensi

- P5 tetap **PARTIAL** sampai ada unggahan nyata yang terverifikasi; ADR ini hanya menutup ketidakpastian keputusan, bukan status implementasi.
- Kapasitas maksimum bawaan: **100 upload/hari per project** (bukan per channel) — cukup untuk MVP, menjadi batas keras untuk multi-akun.
- Mode `Testing` adalah jebakan operasional (token 7 hari); onboarding wajib mencatat status publikasi app dan tanggal pairing.
- Tidak ada perubahan schema DB, route API, atau dependensi npm pada keputusan ini.

## Rencana Implementasi (slice, status aktual)

| Slice | Isi | Status |
|---|---|---|
| A1 | Config `YOUTUBE_ADAPTER=api` + nama env auth; credential store DPAPI (helper), tanpa dependensi baru | **DONE** (2026-10-30, `442d3be`) |
| A2 | OAuth client: pairing loopback + PKCE, refresh token, `reauth_required` | **DONE** (2026-10-30, `5cbe70b`) |
| A3 | `YouTubeApiAdapter`: `validate`, `publish` (resumable upload), `getStatus` (`videos.list`), pemetaan error D6 | **DONE** (2026-10-30, `26e557a`) |
| A4 | Wiring composition root + onboarding akun + log status app (Testing/Production) saat boot | **DONE** (2026-10-30, `0b4194f`) |
| A5 | Test dengan HTTP palsu (tanpa kredensial) + smoke manual oleh owner pada channel sah | **SEBAGIAN** — uji lintas lapisan DONE (`df9a2b7`, diperkuat `8b8a698`); smoke live belum |

### A1 — yang sudah ada (E1)

- `packages/youtube/src/credential-store.ts`: `DpapiCredentialStore` (`save`/`load`/`remove`), `CredentialStoreError` (`INVALID_NAME`, `NOT_SUPPORTED`, `PROTECT_FAILED`, `UNPROTECT_FAILED`, `CORRUPT`), penulisan atomik `.tmp` → rename, nama divalidasi (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, tanpa `..`).
- Path: `%LOCALAPPDATA%\saa\credentials\<nama>.bin` (dapat dioverride untuk test); ciphertext DPAPI `CurrentUser`; rahasia dikirim ke PowerShell statis lewat **stdin**, bukan argumen; timeout 10 s.
- Payload JSON (masa berlaku token ikut di dalam blob); DB hanya `secret_ref` + `connection_status` — tidak ada migrasi.
- `apps/local-api/src/config.ts`: `YOUTUBE_ADAPTER=off|mock|api`, `loadYouTubeCredentials` (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` opsional) — tidak masuk `AppConfig`.
- `apps/local-api/src/server.ts`: `api` → peringatan `belum diimplementasikan (slice A2–A4)`; `PUBLISH` tidak terdaftar (job → `NEEDS_ATTENTION` + `NO_HANDLER`).
- Bukti: typecheck 9 paket PASS; 35 file test, **248 passed / 0 failed**; smoke boot `YOUTUBE_ADAPTER=api` port 4396 → `/health` ok + peringatan eksplisit, port bebas setelah stop.

### A2 — yang sudah ada (E1)

- `packages/youtube/src/oauth-client.ts`:
  - `createPkcePair()` (verifier 32 byte base64url, challenge S256), `createOAuthState()`, `buildAuthorizationUrl()` (`access_type=offline`, `prompt=consent`, `include_granted_scopes=true`, dua scope D1).
  - `startLoopbackReceiver()` — server `127.0.0.1` port acak pada `/oauth2/callback`, `state` dibandingkan konstan-waktu, satu callback, timeout 300 s, halaman callback statis tanpa echo parameter, CSP `default-src 'none'`.
  - `exchangeAuthorizationCode()` / `refreshAccessToken()` — `fetch` form-urlencoded ke `https://oauth2.googleapis.com/token`, timeout 15 s, respons dibatasi 16 KB, tanpa SDK (O6).
  - `pairYouTubeAccount()` — pairing satu kali: buka URL lewat `openUrl` yang disuntikkan (modul tidak memanggil shell), tukar kode, simpan record ke `DpapiCredentialStore` nama `youtube-<accountId>`.
  - `ensureFreshAccessToken()` — refresh otomatis bila sisa usia < 60 s; `null` bila belum dipasangkan; `reauth_required` bila refresh token tidak ada/dicabut.
  - `YouTubeAuthError` membawa `code` + kelas dispatcher: `reauth_required`/`authorization_denied`/`missing_refresh_token`/`invalid_client_config` → `AUTH`; `state_mismatch` → `SECURITY_CHALLENGE`; `timeout` → `TRANSIENT_NETWORK`; `provider_error` mengikuti status HTTP; `invalid_response` → `EXTERNAL_5XX`; `cancelled` → `CANCELLED`.
- Record token (`YouTubeTokenRecord`): `accessToken`, `refreshToken`, `tokenType`, `scope`, `expiresAt`, `clientId`, `pairedAt` — semuanya di dalam blob DPAPI, **tidak** ada kolom DB baru.
- `apps/local-api/src/server.ts`: pesan `api` diperbarui menjadi `belum terhubung ke handler (slice A3–A4)`; `PUBLISH` tetap tidak terdaftar.
- Bukti: typecheck 9 paket + `tests/tsconfig.json` PASS; **36 file test, 269 passed / 0 failed** (21 test OAuth baru); smoke boot `YOUTUBE_ADAPTER=api` port 4397 → `/health` ok, `handlers: ["GENERATE_VIDEO"]`, port bebas setelah stop.
- Belum: `connection_status` belum ditulis ke DB (diputuskan di A4), belum ada pemanggil pairing dari CLI/UI, adapter HTTP YouTube belum ada.

### A3 — yang sudah ada (E1)

- `packages/youtube/src/youtube-api-adapter.ts` — `YouTubeApiAdapter implements SocialAdapter`:
  - `validate`: judul eksplisit ≤100 (fallback caption ≤100 dengan spasi dinormalkan), deskripsi = caption ≤5000, `<`/`>` ditolak (aturan YouTube), `visibility` hanya `private|unlisted|public`, aset ada di resolver + `mimeType` video + ukuran >0 + berkas terbaca.
  - `publish`: `POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status` dengan `X-Upload-Content-Type/Length`, lalu `PUT` seluruh byte ke session URI. Body `snippet { title, description, categoryId }` + `status { privacyStatus, selfDeclaredMadeForKids:false }`; default `private` (D4), `categoryId '27'` (D5). Sukses → `{ status:'processing' }`.
  - `getStatus`: `GET https://www.googleapis.com/youtube/v3/videos?part=status&id=…`; `published` hanya bila `privacyStatus` sama dengan permintaan, `uploadStatus failed/rejected/deleted` → `failed`, `items` kosong/404 → `unknown`, privasi berbeda → `unknown` + `YT_PRIVACY_MISMATCH`.
  - Pemetaan D6: `quotaExceeded`/`dailyLimitExceeded`/`uploadLimitExceeded` → kelas `AUTH` (eskalasi tanpa retry); 429/`rateLimitExceeded` → `RATE_LIMIT` + `retryAfterMs`; 401/403 lain → `AUTH`; 5xx inisialisasi → `EXTERNAL_5XX`; jaringan/timeout → `TRANSIENT_NETWORK`; 400 inisialisasi → `VALIDATION`.
  - `videos.insert` tidak idempoten: kegagalan setelah PUT dikirim (jaringan/5xx/308) dikembalikan sebagai `unknown` (`YT_UPLOAD_UNCERTAIN`/`YT_UPLOAD_INCOMPLETE`, `retryable:false`) agar handler tidak mengunggah ulang.
  - `resolveAsset(assetId)` disuntikkan — paket tidak menyentuh DB; pemetaan `idempotencyKey → { videoId, privacy, accountId }` hanya di memori (restart → `unknown`).
  - `capabilities`: `adapterVersion 'api-1'`, `authStatus` dihitung hanya bila `accountId` diberikan, `limitations` memuat kuota/privasi/uji live/resume 308/pemetaan memori.
- `apps/local-api/src/server.ts`: pesan `api` menjadi `belum terhubung ke handler (slice A4)`; `PUBLISH` tetap tidak terdaftar.
- Bukti: typecheck 9 paket + `tests/tsconfig.json` PASS; **37 file test, 292 passed / 0 failed** (23 test adapter baru); smoke boot `YOUTUBE_ADAPTER=api` port 4397 → `/health` ok, peringatan `slice A4`, port bebas setelah stop.
- Belum: composition root `api` (A4), penulisan `connection_status`, pairing dari CLI/UI, resume bertahap HTTP 308, rekonsiliasi lintas restart, uji live.

### A4 — yang sudah ada (E1)

- `apps/local-api/src/publisher.ts` — `createYouTubeApiPublisher({ db, config, credentials, store?, fetchImpl? })`:
  - `resolveAsset` dibaca dari `media_assets` (`getMediaAsset` → `path`/`mimeType`/`sizeBytes`), sehingga paket `@saa/youtube` tetap tanpa ketergantungan database.
  - `privacy` dari `AppConfig.youtubeUploadPrivacy`, `clientId`/`clientSecret` dari `loadYouTubeCredentials()` (tetap di luar `AppConfig`), store default `DpapiCredentialStore`.
  - `onReauthRequired` → `updateAccountConnection(db, accountId, { connectionStatus: 'reauth_required' })`.
  - `youtubeSecretRef(accountId)` = `dpapi:youtube:<accountId>` — satu-satunya nilai `secret_ref` untuk YouTube.
- `packages/youtube/src/youtube-api-adapter.ts` — opsi baru `onReauthRequired(accountId)`; dipanggil saat `ensureFreshAccessToken` mengembalikan `null` atau melempar `reauth_required` (dari `publish` maupun `getStatus`). Kegagalan callback diabaikan agar galat auth asli tidak tertutupi.
- `packages/database/src/repositories/accounts.ts` — `updateAccountConnection(raw, id, { connectionStatus, secretRef? })`: `secretRef: undefined` mempertahankan nilai lama, `null` mengosongkan; akun tak dikenal → `null`; label/platform tidak diubah.
- `apps/local-api/src/pair-youtube.ts` + script `pair:youtube`:
  - Argumen `--account <id>` (wajib ada, platform harus `youtube`) atau `--label "<label>"` (idempoten: label sama dipakai ulang, kalau tidak dibuat `disconnected`), `--port` opsional.
  - `GOOGLE_OAUTH_CLIENT_ID` wajib; tanpa itu berhenti sebelum membuka browser.
  - Browser dibuka lewat `rundll32 url.dll,FileProtocolHandler <url>` — URL **tidak** melewati shell (query memuat `&`).
  - Sukses → `connection_status='connected'` + `secret_ref`; output hanya id akun, nama kredensial, `pairedAt`, kedaluwarsa token (tanpa token). Gagal → akun tetap `disconnected`; exit 2 untuk pemakaian/konfigurasi, exit 1 untuk galat runtime.
- `apps/local-api/src/config.ts` — env baru `YOUTUBE_UPLOAD_PRIVACY=private|unlisted|public` (default `private`) dan `YOUTUBE_APP_STATUS=testing|production|unknown` (default `unknown`); keduanya masuk `AppConfig` (bukan rahasia).
- `apps/local-api/src/server.ts` — cabang `api`: tanpa client id → peringatan + `PUBLISH` tidak terdaftar; `YOUTUBE_APP_STATUS=testing` → log level `error` (ADR melarang operasi), `unknown` → peringatan; adapter aktif → log `privacy` + `handlers: ["GENERATE_VIDEO","PUBLISH"]`.
- Bukti: typecheck 9 paket + `tests/tsconfig.json` PASS; **39 file test, 301 passed / 0 failed** (9 test baru: 3 repository, 3 publisher, 2 hook adapter, 1 config); smoke boot `YOUTUBE_ADAPTER=api` + `YOUTUBE_APP_STATUS=testing` port 4411 → log `error` Testing, `handlers` memuat `PUBLISH`, `/health` ok, port bebas; CLI `pair:youtube` tanpa argumen/akun hilang/port invalid → exit 2 dengan pesan benar, `--label` berulang tidak menggandakan akun (1 baris `disconnected`).
- Belum: uji lintas handler `PUBLISH` + adapter nyata dan smoke live (A5); resume 308; rekonsiliasi lintas restart.

### A5 — uji lintas lapisan (E1)

`tests/integration/p5-publish-youtube-api.test.ts` menyusun rantai **nyata** tanpa mock adapter: `Dispatcher` → `createPublishHandler` → `createYouTubeApiPublisher` → `YouTubeApiAdapter` → `fetch` palsu (token di store memori, aset media di disk sementara, DB sqlite hasil migrasi). Delapan skenario:

| Skenario | Jalur | Hasil terverifikasi |
|---|---|---|
| Unggahan sukses | `POST` sesi → `PUT` byte → `videos.list` privasi `private` | job `PUBLISHED`; attempt `published` + `externalPostId`/`permalink`/`verifiedAt`; body init memuat `title`/`description`/`categoryId 27`/`selfDeclaredMadeForKids false`; 3 panggilan eksternal (POST/PUT/GET); header `Authorization: Bearer <token>` pada inisialisasi & verifikasi, **tidak** pada PUT sesi |
| Privasi tidak sesuai | `videos.list` melaporkan `public` | attempt `unknown` + `YT_PRIVACY_MISMATCH`, job `NEEDS_ATTENTION`, attempts tetap 0, `runAt` null (tanpa retry) |
| Video ditolak YouTube | `uploadStatus: rejected` | job `FAILED` + `YT_UPLOAD_REJECTED`, attempt `failed`, attempts 1, tanpa retry |
| Kuota habis | `403 quotaExceeded` pada inisialisasi | job `NEEDS_ATTENTION` + `AUTH`, attempt `unknown`, hanya 1 panggilan (tidak ada byte terunggah), audit `needs_attention` tercatat, akun tetap `connected` (kuota bukan masalah pairing) |
| Belum dipasangkan | store tanpa token | attempt `unknown` + `AUTH`, akun ditulis `reauth_required` oleh hook composition root, **0 panggilan eksternal**; job berikutnya ditolak di penjaga `connection_status` (0 attempt, 0 panggilan baru) |
| Refresh token kedaluwarsa | `access_token` kedaluwarsa → `POST https://oauth2.googleapis.com/token` (`grant_type=refresh_token`) | token baru tersimpan ulang di store (refresh token lama dipertahankan), unggahan & verifikasi memakai `Bearer` baru, job `PUBLISHED`, akun tetap `connected` |
| Refresh dicabut | token endpoint `400 invalid_grant` | `reauth_required` (kelas `AUTH`), **1 panggilan** (hanya token endpoint), akun → `reauth_required`, tidak ada unggahan |
| Aset tidak terbaca | berkas media dihapus sebelum dispatch | handler menolak di `adapter.validate` (`PUBLISH_VALIDATION`), job `FAILED` + `VALIDATION`, **0 panggilan**, attempt `failed` |

Perbaikan hasil review: eskalasi error adapter (AUTH/kuota/DISK) kini menulis audit `needs_attention`; sebelumnya attempt menjadi `unknown` tanpa jejak audit karena jalur itu tidak melewati `escalateUnverified`.

Catatan penyimpangan dari rencana handoff: `YouTubeApiAdapter.getStatus` **tidak pernah** mengembalikan `processing` — ia memetakan ke `published` (privasi cocok), `failed` (ditolak/dihapus), atau `unknown` (privasi beda/tidak ditemukan). Karena itu skenario "processing → `NEEDS_ATTENTION`" diuji sebagai `unknown` → `NEEDS_ATTENTION`, yang merupakan jalur nyata adapter.

- Bukti: typecheck 9 paket + `tests/tsconfig.json` PASS; **40 file test, 309 passed / 0 failed** (8 test integrasi).
- Belum: smoke live (pairing + unggah `private` nyata dengan bukti `videos.list`) — butuh prasyarat owner.

## Open Items

- F2 (privat vs publik untuk project unverified) baru bisa dipastikan dari respons API saat uji nyata pertama.
- Klasifikasi resmi scope `youtube.upload` (sensitif/terbatas) belum eksplisit di halaman verifikasi; periksa saat membuat consent screen.
- Angka batas unggahan per channel tidak dipublikasikan; tangani lewat `uploadLimitExceeded` (D6).
- OD-2/OD-5 untuk platform P6 belum dijawab.
