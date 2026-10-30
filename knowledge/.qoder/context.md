# L0 — Active Context

**Session:** SESSION-2026-10-30-9
**Updated:** 2026-10-30T10:30:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** MEDIUM (modul adapter API baru di `@saa/youtube` + teks peringatan runtime; tanpa migrasi DB, route, dependensi, atau perubahan kontrak adapter)

## Current Task

**Tidak ada task aktif.** Permintaan owner **"lanjutkan ke A3"** dilanjutkan dengan **`YouTubeApiAdapter`** — selesai dan terverifikasi (2026-10-30, commit `26e557a`).

| Fase | Commit | Isi |
|---|---|---|
| A — wiring planner | `826a732` | `PLAN_CONTENT` handler, `COMPLETED` + `STEP_COMPLETED`, `campaigns.platforms_json` |
| B — P4 backend | `4b513ab` | Approval binding + API, engine scheduler, migrasi `0002` |
| C — P3 mock | `013531a`, `b8c85e0` | `@saa/browser-engine` (mock Flow, validasi media, lock profil), handler `GENERATE_VIDEO` |
| D — worker loop | `6ad9547` | `Worker` + `buildHandlerRegistry` + `/health` worker nyata |
| E — P5 mock publish | `7d13431` | `@saa/youtube` mock, kontrak `SocialAdapter`, repo `publish_attempts`, handler `PUBLISH`, `YOUTUBE_ADAPTER=mock` |
| F — P4b dispatch jadwal | `bfc7c72` | `enqueueDuePublicationJobs`, `ScheduleDispatchLoop`, `resolveCaption` di domain |
| G — P4c produksi konten | `77fbb9c` | `enqueueDueContentPlan` + `createContentProductionEnqueuer`, helper guard, komposisi publikasi→produksi |
| H — sinkronisasi P4c | `948bd8d` | ADR-0007 + seluruh knowledge P4c |
| I — OD-2/OD-5 YouTube | `8288450` | `ADR-0008`: kuota, privasi, metadata, error, OAuth, DPAPI, prasyarat owner |
| J — A1 credential store | `442d3be` | `DpapiCredentialStore` + `YOUTUBE_ADAPTER=api` + `loadYouTubeCredentials` |
| K — A2 OAuth client | `5cbe70b` | Pairing PKCE loopback, exchange/refresh `fetch`, `reauth_required`, record token di DPAPI |
| L — A3 adapter API | `26e557a` | `YouTubeApiAdapter`: `videos.insert` resumable, `videos.list` + verifikasi `privacyStatus`, pemetaan D6 |

Status fase: **P3 PARTIAL** (Flow nyata, OD-1) · **P4 PARTIAL** (UI approval) · **P4b COMPLETED** · **P4c COMPLETED** · **P5 PARTIAL** (A1+A2+A3 DONE; A4–A5 dan upload nyata UNVERIFIED).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api}.md`.
- Keputusan: `knowledge/decisions/ADR-0001…0008`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api`; 113 file TS tracked, 37 file test, **292 test hijau** (commit `26e557a`); typecheck 9 paket + `tests/tsconfig.json` PASS.
- Migrasi tetap 3 berkas (`0000_init`, `0001_campaign_platforms`, `0002_scheduler_and_approval`); 12 tabel; 15 route.
- Rantai otomatis penuh: slot 1 → `PLAN_CONTENT` → `GENERATE_VIDEO` → media valid → slot 2 → `PUBLISH` + `PLAN_CONTENT` berikutnya → berulang.
- Pipeline kedalaman satu: slot ditahan bila ada `PLAN_CONTENT` non-terminal (termasuk `NEEDS_ATTENTION`) atau konten terbaru belum punya job `PUBLISH`.
- Kunci idempoten produksi `plan:<scheduleId>:<slot>`; kunci publikasi `publish:<contentId>:v<version>:<accountId>:<platform>`.
- Dalam satu tick: publikasi **lebih dulu**, lalu produksi (ADR-0007 C4).
- Produksi hanya aktif bila planner tersedia; startup mencatat `planner tidak aktif; produksi konten otomatis tidak dijalankan`.
- Caption satu platform dihitung lewat `resolveCaption` (`@saa/domain`).
- Dispatch/loop hanya berjalan bila `SCHEDULER_ENABLED=true`, worker aktif, dan adapter publikasi terdaftar.
- Index kode: `LIGHTWEIGHT_GREP` / `DEGRADED` — `index-state.json`.
- **YouTube (E5, dibaca 2026-10-30):** kuota 10.000 unit/hari per project; `videos.insert` 1 unit + batas 100 panggilan/hari; referensi resmi menyatakan project unverified tidak dibatasi private, tetapi issue tracker Google 572863050 mempertanyakannya → CONFLICT; app OAuth eksternal berstatus Testing → refresh token 7 hari (VERIFIED).
- **Credential store (E1, `442d3be`):** `DpapiCredentialStore` menulis ciphertext DPAPI `CurrentUser` ke `%LOCALAPPDATA%\saa\credentials\<name>.bin` secara atomik; nama `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; error `INVALID_NAME|NOT_SUPPORTED|PROTECT_FAILED|UNPROTECT_FAILED|CORRUPT`; non-Windows → `NOT_SUPPORTED`.
- **OAuth client (E1, `5cbe70b`):** `pairYouTubeAccount` (loopback `127.0.0.1` port acak, PKCE S256, state konstan-waktu, `access_type=offline`+`prompt=consent`), `exchangeAuthorizationCode`/`refreshAccessToken` via `fetch` (timeout 15 s, respons ≤16 KB), `ensureFreshAccessToken` (refresh bila sisa <60 s), record `youtube-<accountId>` di DPAPI (`accessToken`, `refreshToken`, `tokenType`, `scope`, `expiresAt`, `clientId`, `pairedAt`). `openUrl` disuntikkan — modul tidak memanggil shell.
- **Adapter API (E1, `26e557a`):** `YouTubeApiAdapter` memakai `ensureFreshAccessToken` → header `Authorization`; `videos.insert` resumable (`uploadType=resumable`, `part=snippet,status`) lalu `videos.list?part=status`; `published` hanya bila `privacyStatus` sama dengan permintaan (`private` default, `categoryId 27`, `selfDeclaredMadeForKids=false`). `quotaExceeded`/`uploadLimitExceeded` → kelas `AUTH` (eskalasi tanpa retry); kegagalan setelah PUT dikirim → `unknown` (tidak pernah retry) karena `videos.insert` tidak idempoten.
- **Konfigurasi (E1):** `YOUTUBE_ADAPTER=off|mock|api`; `api` belum mendaftarkan handler `PUBLISH` (peringatan `slice A4`). `loadYouTubeCredentials()` membaca `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` di luar `AppConfig`.

## Keputusan Sesi Ini (A3)

1. `videos.insert` tidak idempoten: kegagalan setelah byte dikirim dikembalikan sebagai `unknown` (`YT_UPLOAD_UNCERTAIN`/`YT_UPLOAD_INCOMPLETE`, `retryable:false`), **bukan** dilempar sebagai kelas retry — auto-retry akan menggandakan video.
2. `quotaExceeded`/`dailyLimitExceeded`/`uploadLimitExceeded` dipetakan ke kelas `AUTH` karena hanya kelas itu yang mengeskalasi tanpa retry (`packages/workflow/src/retry.ts`); detail alasan tetap ada di pesan error.
3. Privasi diverifikasi lewat `videos.list`; mismatch → `unknown` + `YT_PRIVACY_MISMATCH` (domain `PublishResult` tidak punya `limitations`, jadi kode error dipakai sebagai penyampai).
4. `resolveAsset` disuntikkan (handler hanya membawa `assetId`); paket `@saa/youtube` tetap tidak bergantung pada DB.
5. Pemetaan `idempotencyKey → videoId` hanya di memori; setelah restart hasilnya `unknown` (eskalasi manual), bukan tebakan dan bukan unggahan ulang.

## Langkah Berikutnya

1. **A4 — wiring + onboarding**: `buildPublisher` cabang `api` membuat `YouTubeApiAdapter` (store DPAPI, `loadYouTubeCredentials`, `resolveAsset` dari `getMediaAsset`, env `YOUTUBE_UPLOAD_PRIVACY` default `private`); perintah pairing menulis `secret_ref = dpapi:youtube:<accountId>` + `connection_status`; `AUTH`/`reauth_required` menandai akun perlu pairing ulang.
2. **A5** — perluas test HTTP palsu lintas handler `PUBLISH` + adapter (retry/eskalasi), lalu smoke manual owner.
3. Prasyarat faktual owner untuk uji live: project Google Cloud + billing, jenis akun Google, channel target, izin membuat OAuth client Desktop, konfirmasi privasi awal.
4. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- Apakah project unverified benar-benar boleh upload `public` (F2 CONFLICT) — hanya bisa dipastikan dari respons API pada uji nyata.
- Klasifikasi resmi scope `youtube.upload`, dan batas unggahan harian per channel (tidak dipublikasikan).
- Status publikasi app OAuth (Internal/In production/Testing) tidak tersedia lewat API — hanya dari laporan owner.
- OD-1 (Flow), OD-3, OD-4, OD-6, OD-7 tetap OPEN; OD-2/OD-5 hanya terjawab untuk YouTube.
- Adapter DeepSeek belum diuji live; sumber API key belum diputuskan.
- Mode approval `required` menahan produksi berikutnya; slot terlewat hangus.
- Kuota scheduler menghitung semua status `publish_attempts`.
- Lint/build artefak belum dipilih (ADR-0001 D7); `AGENTS.md` masih untracked.
- Mock generator bukan video valid untuk pemutaran; mock adapter tidak mengunggah apa pun.
- DPAPI hanya teruji pada Windows 10 host ini; perilaku di mesin lain (termasuk domain-joined/roaming profile) belum diverifikasi.
- OAuth baru diuji dengan HTTP palsu + loopback lokal; belum pernah bertemu server Google sungguhan.
- Adapter API baru diuji dengan HTTP palsu; bentuk respons `videos.insert`/`videos.list` yang sebenarnya belum diverifikasi pada channel sah.
- Resume bertahap (HTTP 308 + `Content-Range`) belum diimplementasikan; unggahan ulang setelah 308 memulai sesi baru.
- Pemetaan idempotency → videoId hilang saat proses restart, sehingga rekonsiliasi lintas restart belum tersedia.
