# L0 — Active Context

**Session:** SESSION-2026-10-30-7
**Updated:** 2026-10-30T09:45:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** MEDIUM (modul baru di `@saa/youtube` + config/cabang runtime; tanpa migrasi DB, route, atau dependensi eksternal)

## Current Task

**Tidak ada task aktif.** Permintaan owner **"lanjutkan ke tahap A1 implementasikan credential store DPAPI"** selesai dan terverifikasi (2026-10-30, commit `442d3be`).

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

Status fase: **P3 PARTIAL** (Flow nyata, OD-1) · **P4 PARTIAL** (UI approval) · **P4b COMPLETED** · **P4c COMPLETED** · **P5 PARTIAL** (A1 DONE; A2–A5 dan upload nyata UNVERIFIED).

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api}.md`.
- Keputusan: `knowledge/decisions/ADR-0001…0008`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api`; 109 file TS tracked, 35 file test, **248 test hijau** (commit `442d3be`); typecheck 9 paket + `tests/tsconfig.json` PASS.
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
- **Credential store (E1, `442d3be`):** `DpapiCredentialStore` menulis ciphertext DPAPI `CurrentUser` ke `%LOCALAPPDATA%\saa\credentials\<name>.bin` secara atomik; nama `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`; error `INVALID_NAME|NOT_SUPPORTED|PROTECT_FAILED|UNPROTECT_FAILED|CORRUPT`; DPAPI dipanggil via PowerShell statis `-EncodedCommand`, secret lewat stdin. Non-Windows → `NOT_SUPPORTED`.
- **Konfigurasi (E1):** `YOUTUBE_ADAPTER=off|mock|api`; `api` belum berfungsi (job `PUBLISH` tidak didaftarkan, ada peringatan eksplisit). `loadYouTubeCredentials()` membaca `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` di luar `AppConfig`; refresh token tidak pernah dari env.

## Keputusan Sesi Ini (ADR-0008 A1)

1. Token disimpan sebagai payload JSON lewat store generik; kedaluwarsa ikut payload → **tanpa** kolom/migrasi baru, `social_accounts` tetap `secret_ref` + `connection_status`.
2. DPAPI diakses tanpa dependensi baru (G5 dihindari): skrip PowerShell statis via `-EncodedCommand`, plaintext via stdin, plus batas waktu.
3. `YOUTUBE_ADAPTER=api` diterima config tetapi **tidak** mendaftarkan handler sampai A3/A4 selesai — opt-in tidak boleh menghasilkan klaim palsu.
4. Kredensial OAuth client hidup di luar `AppConfig` (pola `loadAiCredentials`) agar objek config aman dicatat.

## Langkah Berikutnya

1. **A2 OAuth client** — PKCE S256 loopback `127.0.0.1` (porta acak), `state` dibandingkan konstan-waktu, exchange/refresh via `fetch` dengan timeout, simpan payload ke `DpapiCredentialStore` nama `youtube-<accountId>`, `invalid_grant` → `reauth_required`.
2. **A3** `YouTubeApiAdapter` · **A4** wiring composition root + onboarding akun · **A5** test HTTP palsu + smoke manual owner.
3. Prasyarat faktual owner untuk uji live: project Google Cloud + billing, jenis akun Google, channel target, izin membuat OAuth client Desktop, konfirmasi privasi awal.
4. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- Apakah project unverified benar-benar boleh upload `public` (F2 CONFLICT) — hanya bisa dipastikan dari respons API pada uji nyata.
- Klasifikasi resmi scope `youtube.upload`, dan batas unggahan harian per channel (tidak dipublikasikan).
- OD-1 (Flow), OD-3, OD-4, OD-6, OD-7 tetap OPEN; OD-2/OD-5 hanya terjawab untuk YouTube.
- Adapter DeepSeek belum diuji live; sumber API key belum diputuskan.
- Mode approval `required` menahan produksi berikutnya; slot terlewat hangus.
- Kuota scheduler menghitung semua status `publish_attempts`.
- Lint/build artefak belum dipilih (ADR-0001 D7); `AGENTS.md` masih untracked.
- Mock generator bukan video valid untuk pemutaran; mock adapter tidak mengunggah apa pun.
- DPAPI hanya teruji pada Windows 10 host ini; perilaku di mesin lain (termasuk domain-joined/roaming profile) belum diverifikasi.
