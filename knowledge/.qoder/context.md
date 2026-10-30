# L0 — Active Context

**Session:** SESSION-2026-10-30-13
**Updated:** 2026-10-30T13:20:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** MEDIUM (lima slice pada adapter YouTube, kuota scheduler, dan API lokal — satu route baru, query kuota berubah; tanpa migrasi, dependensi, atau perubahan kontrak `SocialAdapter`)

## Current Task

**Tidak ada task aktif.** Perintah owner **"lakukan semuanya"** ditindaklanjuti: lima backlog yang tidak memerlukan keputusan owner dikerjakan dan diverifikasi (2026-10-30, `c310d1f` … `bb1ba57`). Sisa: smoke live owner.

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
| M — A4 wiring + onboarding | `0b4194f` | `createYouTubeApiPublisher`, CLI `pair:youtube`, `updateAccountConnection`, env privasi/status app, hook `onReauthRequired` |
| N — A5 uji lintas lapisan | `df9a2b7`, `8b8a698` | Test integrasi handler `PUBLISH` × composition root × adapter API (8 skenario) + audit eskalasi adapter |
| O — A6 resume 308 | `c310d1f` | Lanjut `PUT` dari offset `Range`, maks. 3 lanjutan, `externalPostId` pada hasil `processing` |
| P — kuota pra-unggah | `5af62ca` | `PUBLISH_VALIDATION`/`VALIDATION`/`DISK` tidak dihitung kuota harian |
| Q — pemicu konten manual | `1f27cd5` | `POST /api/v1/content` + key `plan:manual:<campaignId>:<requestId|uuid>` |
| R — rekonsiliasi lintas restart | `a6dde05` | Handler menyimpan `externalPostId`; adapter `resolveUpload` |
| S — wiring resolver + authStatus | `bb1ba57` | `resolveUpload` dari `publish_attempts`; `accountId` akun YouTube tunggal |

Status fase: **P3 PARTIAL** (Flow nyata, OD-1) · **P4 PARTIAL** (UI approval) · **P4b COMPLETED** · **P4c COMPLETED** · **P5 PARTIAL** (A1–A7 DONE; smoke live + upload nyata UNVERIFIED).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api}.md`.
- Keputusan: `knowledge/decisions/ADR-0001…0008`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api`; 120 file TS tracked, 41 file test, **321 test hijau** (commit `bb1ba57`); typecheck 9 paket + `tests/tsconfig.json` PASS.
- Migrasi tetap 3 berkas (`0000_init`, `0001_campaign_platforms`, `0002_scheduler_and_approval`); 12 tabel; **16 route**.
- Rantai otomatis penuh: slot 1 → `PLAN_CONTENT` → `GENERATE_VIDEO` → media valid → slot 2 → `PUBLISH` + `PLAN_CONTENT` berikutnya → berulang.
- Pipeline kedalaman satu: slot ditahan bila ada `PLAN_CONTENT` non-terminal (termasuk `NEEDS_ATTENTION`) atau konten terbaru belum punya job `PUBLISH`.
- Kunci idempoten produksi `plan:<scheduleId>:<slot>`; publikasi `publish:<contentId>:v<version>:<accountId>:<platform>`; manual `plan:manual:<campaignId>:<requestId|uuid>`.
- Dalam satu tick: publikasi **lebih dulu**, lalu produksi (ADR-0007 C4).
- Produksi hanya aktif bila planner tersedia; startup mencatat `planner tidak aktif; produksi konten otomatis tidak dijalankan`.
- Caption satu platform dihitung lewat `resolveCaption` (`@saa/domain`).
- Dispatch/loop hanya berjalan bila `SCHEDULER_ENABLED=true`, worker aktif, dan adapter publikasi terdaftar.
- Index kode: `LIGHTWEIGHT_GREP` / `DEGRADED` — `index-state.json`.
- **YouTube (E5, dibaca 2026-10-30):** kuota 10.000 unit/hari per project; `videos.insert` 1 unit + batas 100 panggilan/hari; referensi resmi menyatakan project unverified tidak dibatasi private, tetapi issue tracker Google 572863050 mempertanyakannya → CONFLICT; app OAuth eksternal berstatus Testing → refresh token 7 hari (VERIFIED).
- **Credential store (E1, `442d3be`):** `DpapiCredentialStore` menulis ciphertext DPAPI `CurrentUser` ke `%LOCALAPPDATA%\saa\credentials\<name>.bin` secara atomik; nama `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; error `INVALID_NAME|NOT_SUPPORTED|PROTECT_FAILED|UNPROTECT_FAILED|CORRUPT`.
- **OAuth client (E1, `5cbe70b`):** `pairYouTubeAccount` (loopback `127.0.0.1` port acak, PKCE S256, state konstan-waktu, `access_type=offline`+`prompt=consent`), `exchangeAuthorizationCode`/`refreshAccessToken` via `fetch` (timeout 15 s, respons ≤16 KB), `ensureFreshAccessToken` (refresh bila sisa <60 s), record `youtube-<accountId>` di DPAPI. `openUrl` disuntikkan.
- **Adapter API (E1, `26e557a` + `c310d1f` + `a6dde05`):** `videos.insert` resumable (`uploadType=resumable`, `part=snippet,status`) lalu `videos.list?part=status`; `published` hanya bila `privacyStatus` sama dengan permintaan (`private` default, `categoryId 27`, `selfDeclaredMadeForKids=false`); `quotaExceeded`/`uploadLimitExceeded` → kelas `AUTH`; kegagalan setelah PUT → `unknown` tanpa retry. Resume 308 memakai `Range` + `content-range` (maks. 3 lanjutan); `resolveUpload` memulihkan `videoId` dari DB setelah restart.
- **Konfigurasi (E1):** `YOUTUBE_ADAPTER=off|mock|api`; `YOUTUBE_UPLOAD_PRIVACY=private|unlisted|public` (default `private`); `YOUTUBE_APP_STATUS=testing|production|unknown` (default `unknown`). `loadYouTubeCredentials()` membaca `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` di luar `AppConfig`.
- **Wiring + onboarding (E1, `0b4194f` + `bb1ba57`):** `createYouTubeApiPublisher` (aset dari `media_assets`, token DPAPI, privasi dari config, `onReauthRequired` → `connection_status='reauth_required'`, `resolveUpload` dari `publish_attempts`, `accountId` akun tunggal); CLI `pair:youtube` menulis `secret_ref='dpapi:youtube:<id>'` + `connected`.
- **Uji lintas lapisan (E1, `df9a2b7` + `8b8a698`):** 8 skenario rantai nyata dengan `fetch` palsu (published, privacy mismatch, rejected, kuota 403, reauth, refresh, invalid_grant, aset hilang); Bearer hanya pada inisialisasi & verifikasi; audit `needs_attention` pada eskalasi adapter.
- **Kuota (E1, `5af62ca`):** attempt dengan `error_code` `PUBLISH_VALIDATION`/`VALIDATION`/`DISK` dikecualikan; kode lain dihitung.
- **Pemicu manual (E1, `1f27cd5`):** `POST /api/v1/content` → 202 `queued`/`duplicate`; 404 campaign; 409 `CAMPAIGN_INACTIVE`/`CAMPAIGN_NO_PLATFORM`/`PLAN_IN_PROGRESS`/`PIPELINE_BUSY`.

## Keputusan Sesi Ini ("lakukan semuanya")

1. Resume 308 hanya melanjutkan bila `Range` valid dan `start < total`; kegagalan lain tetap `unknown` karena `videos.insert` tidak idempoten.
2. Kuota mengecualikan hanya kode yang membuktikan tidak ada panggilan jaringan; kode ambigu (AUTH/5xx/`unknown`) tetap dihitung agar batas 100 unggahan/hari tidak terlampaui.
3. Route manual memakai key `plan:manual:<campaignId>:<requestId|uuid>` dan dicek **sebelum** guard pipeline, sehingga permintaan berulang tidak berubah menjadi 409.
4. `externalPostId` disimpan segera setelah adapter mengembalikannya; adapter menerima `resolveUpload` agar restart tidak mengunggah ulang.
5. `capabilities().authStatus` memakai akun YouTube tunggal; bila ada lebih dari satu akun hasilnya `disconnected` (tidak menebak).
6. Job `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` terpisah **tidak** dibuat: kadensi polling dan biaya kuota `videos.list` adalah keputusan owner. Usulan default: rekonsiliasi sekali pada +15 menit, maksimal 2 polling, hanya untuk attempt `unknown` yang punya `externalPostId`.

## Langkah Berikutnya

1. **Smoke live owner** — pairing nyata via `pair:youtube` dengan `GOOGLE_OAUTH_CLIENT_ID` sah, lalu satu unggahan `private` beserta bukti `videos.list`; catat respons nyata untuk F2/F6/F7.
2. Prasyarat faktual owner: project Google Cloud + billing, jenis akun Google (Workspace/gmail), channel target, izin membuat OAuth client Desktop, status app (Production/Internal), konfirmasi privasi awal.
3. Jangan menyatakan P5 COMPLETED sebelum unggahan nyata terverifikasi.
4. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet, keputusan job rekonsiliasi terjadwal.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- Apakah project unverified benar-benar boleh upload `public` (F2 CONFLICT) — hanya bisa dipastikan dari respons API pada uji nyata.
- Klasifikasi resmi scope `youtube.upload`, dan batas unggahan harian per channel (tidak dipublikasikan).
- Status publikasi app OAuth (Internal/In production/Testing) tidak tersedia lewat API — hanya dari laporan owner lewat `YOUTUBE_APP_STATUS`.
- Onboarding nyata (browser + consent Google) belum pernah dijalankan; `pair:youtube` baru diuji pada jalur gagal dan pada pembuatan akun `disconnected`.
- `capabilities().authStatus` kini `connected` hanya bila tepat satu akun YouTube punya token; multi-akun sengaja `disconnected`.
- OD-1 (Flow), OD-3, OD-4, OD-6, OD-7 tetap OPEN; OD-2/OD-5 hanya terjawab untuk YouTube.
- Adapter DeepSeek belum diuji live; sumber API key belum diputuskan.
- Mode approval `required` menahan produksi berikutnya; slot terlewat hangus.
- Lint/build artefak belum dipilih (ADR-0001 D7); `AGENTS.md` masih untracked.
- Mock generator bukan video valid untuk pemutaran; mock adapter tidak mengunggah apa pun.
- DPAPI hanya teruji pada Windows 10 host ini; perilaku di mesin lain (termasuk domain-joined/roaming profile) belum diverifikasi.
- OAuth, refresh, resume 308, dan adapter API hanya diuji dengan `fetch` palsu; belum pernah bertemu server Google sungguhan.
- Sesi resumable yang terputus tidak dilanjutkan lintas proses; video yatim harus dihapus manual di YouTube Studio.
