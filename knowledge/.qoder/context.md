# L0 — Active Context

**Session:** SESSION-2026-10-30-8
**Updated:** 2026-10-30T10:00:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** MEDIUM (modul OAuth baru di `@saa/youtube` + teks peringatan runtime; tanpa migrasi DB, route, dependensi, atau perubahan kontrak adapter)

## Current Task

**Tidak ada task aktif.** Permintaan owner **"lanjutkan"** dilanjutkan dengan **A2 OAuth client YouTube** — selesai dan terverifikasi (2026-10-30, commit `5cbe70b`).

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

Status fase: **P3 PARTIAL** (Flow nyata, OD-1) · **P4 PARTIAL** (UI approval) · **P4b COMPLETED** · **P4c COMPLETED** · **P5 PARTIAL** (A1+A2 DONE; A3–A5 dan upload nyata UNVERIFIED).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api}.md`.
- Keputusan: `knowledge/decisions/ADR-0001…0008`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api`; 111 file TS tracked, 36 file test, **269 test hijau** (commit `5cbe70b`); typecheck 9 paket + `tests/tsconfig.json` PASS.
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
- **Konfigurasi (E1):** `YOUTUBE_ADAPTER=off|mock|api`; `api` belum mendaftarkan handler `PUBLISH` (peringatan `slice A3–A4`). `loadYouTubeCredentials()` membaca `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` di luar `AppConfig`.

## Keputusan Sesi Ini (A2)

1. Browser tidak dibuka oleh modul; `openUrl` disuntikkan pemanggil (A4/CLI) agar tidak ada eksekusi shell tersembunyi.
2. Token endpoint dipanggil dengan `fetch` form-urlencoded + batas ukuran/timeout; `invalid_grant` = `reauth_required` (kelas `AUTH`, tanpa retry), `invalid_client`/`unauthorized_client` = `AUTH`.
3. Halaman callback statis tanpa echo parameter (anti-XSS) + CSP `default-src 'none'` + `no-store`.
4. Token tanpa `refresh_token` saat pairing = kegagalan (`missing_refresh_token`), bukan sesi yang akan mati diam-diam.
5. `connection_status` **tidak** disentuh di A2; penulisan status akun diputuskan di A4 bersama onboarding.

## Langkah Berikutnya

1. **A3 `YouTubeApiAdapter`** — `validate` batas metadata; `publish` `videos.insert` resumable (`selfDeclaredMadeForKids=false`, `categoryId` env); `getStatus` `videos.list` + verifikasi `privacyStatus` (mismatch → `limitations: ['privacy_not_applied']`); pemetaan `quotaExceeded`/`uploadLimitExceeded` → `NEEDS_ATTENTION`.
2. **A4** wiring composition root + onboarding akun (`connection_status`, `secret_ref = dpapi:youtube:<accountId>`) + log status app · **A5** test HTTP palsu lengkap + smoke manual owner.
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
