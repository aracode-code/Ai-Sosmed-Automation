# L0 — Active Context

**Session:** SESSION-2026-11-02-1
**Updated:** 2026-11-02T08:06:00+07:00
**Autonomy:** L1 (BALANCED)
**Change class terakhir:** MEDIUM (Slice 3: migrasi `plan_approvals`, route rencana approve/reject, publikasi satu gerbang)

## Current Task

**Slice 3 COMPLETED — approval tahap rencana + publikasi satu gerbang.** Approval kini diputuskan **sekali per rencana** lewat `POST /api/v1/plans/:jobId/approve|reject` dengan binding `hashPlanBinding` (contentId + versi + hash caption, tanpa aset karena media belum ada). Approve membangkitkan `GENERATE_VIDEO` untuk **seluruh item** rencana dan menandai semua konten `approved`; enqueuer publikasi menerbitkan **semua** item rencana yang lolos gerbang, dan handler `PUBLISH` menerima gerbang rencana dengan fallback approval per-konten untuk data lama. Slice 4 (form permintaan di Campaigns + daftar approval batch di UI) **belum dimulai** — menunggu instruksi owner. P3 tetap PARTIAL: retest unduhan `GENERATE_VIDEO` lewat worker masih menunggu 1 kredit.

| Fase | Commit | Isi |
|---|---|---|
| A–H | `826a732` … `948bd8d` | planner wiring, P4 backend, P3 mock, worker loop, P5 mock, P4b/P4c + ADR |
| I–N | `8288450` … `8b8a698` | ADR-0008 dan slice A1–A5 adapter YouTube API |
| O–S | `c310d1f` … `bb1ba57` | resume 308, kuota pra-unggah, route konten manual, rekonsiliasi restart, authStatus |
| T–U | `bbfe83a`, `365643d` | CLI `preflight:youtube`, runbook + security docs |
| V | `8e27b27`, `04c5c23` | `apps/dashboard` + ADR-0009 |
| W | `5e8184b`, `406f1f5` | `GET /api/v1/content/:id` + aksi approval |
| F | `fd62314` | sesi profil Flow + `flow:login` (ADR-0010) |
| R | `989aa2f`, `acdcf17` | aksi connect dari UI (runner proses + route + halaman Connections beraksi) |
| S | `6fbd7fb` + `e8fcb1b` | smoke GENERATE_VIDEO lewat aplikasi + tambalan `setDownloadBehavior` + sinkronisasi knowledge |
| AI | `1dfcadf` | kredensial AI DPAPI + planner lazy + input UI (ADR-0011) |
| S2 | `df45977` | rencana batch `items[]` 1–5 + gerbang approval `PLAN_CONTENT` |
| S3 | `8b9a512` | approval rencana (`plan_approvals`) + publikasi satu gerbang |

Status fase: **P3 PARTIAL** (pembuatan via aplikasi VERIFIED; unduhan via aplikasi UNVERIFIED) · **P4 PARTIAL** (UI approval + aksi connect DONE; reauth belum) · **P4b/P4c COMPLETED** · **P5 PARTIAL** (A1–A7 DONE; unggahan nyata UNVERIFIED) · **Alur approval rencana kerja: Slice 1–3 DONE, Slice 4 NOT STARTED**.

## Konteks Minimum

- Boot urut §11.14: `state.json → index-state.json → context.md → memory.md → 00_INDEX.md → CURRENT.md`.
- Modul: `knowledge/modules/{foundation,agent-core,workflow,scheduler,browser-engine,youtube,local-api,dashboard}.md`.
- Keputusan: `ADR-0001…0010`. Operasional: `docs/runbook.md`, `docs/security.md`.
- HLD/LLD dibuka per bagian; jangan baca ulang penuh.

## Fakta Aktif (terverifikasi)

- 8 paket workspace + `apps/local-api` + `apps/dashboard`; **171 file TS/TSX** (termasuk 57 file test), **486 test hijau**; typecheck 10 paket + `tests/tsconfig.json` PASS.
- Migrasi **4 berkas** (`0000_init` … `0003_plan_approvals`); **13 tabel** (termasuk `plan_approvals`); **31 route**.
- Rantai otomatis: slot → `PLAN_CONTENT` → (approval rencana) → `GENERATE_VIDEO` per item → media valid → `PUBLISH` seluruh item rencana + produksi slot berikutnya; publikasi lebih dulu dalam satu tick.
- Pipeline kedalaman satu: slot ditahan bila ada `PLAN_CONTENT` non-terminal atau **ada item rencana** yang belum punya job `PUBLISH`.
- Kunci idempoten: `plan:<scheduleId>:<slot>`, `generate:<contentId>`, `publish:<contentId>:v<version>:<accountId>:<platform>`, `plan:manual:<campaignId>:<requestId|uuid>`, `publish:<jobId>`.
- Index kode: `LIGHTWEIGHT_GREP` / `DEGRADED` — `index-state.json`.
- **YouTube (E1):** `videos.insert` resumable + `videos.list` verifikasi `privacyStatus`; `private` default, `categoryId 27`; `quotaExceeded`/`uploadLimitExceeded` → `AUTH` tanpa retry; resume 308 maks. 3 lanjutan; `externalPostId` disimpan agar restart tidak mengunggah ulang.
- **Kredensial (E1):** token YouTube di DPAPI `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin`; DB hanya `secret_ref` + `connection_status`; OAuth client hanya dari env; aplikasi tidak membaca `.env`.
- **Kredensial AI (E1, `1dfcadf`, ADR-0011):** kunci DeepSeek di DPAPI `deepseek-api-key` (diisi lewat Connections), **menang** atas `DEEPSEEK_API_KEY`; planner selalu terdaftar dengan `createLazyPlanner` (resolusi per job, `AUTH` bila kosong); produksi terjadwal ditahan bila kunci belum ada; `GET /api/v1/ai/status` + `POST /api/v1/ai/credentials` tidak pernah mengembalikan nilai kunci.
- **Rencana batch (E1, `df45977`):** `planDecisionSchema.items` 1–5 (`topic`, `videoPrompt`, `targets`) atau bentuk tunggal lama; `planItemsOf` menormalkan keduanya; `checkPlanAgainstCampaign` memvalidasi target per item; `maxTokens` planner default 2400. `PLAN_CONTENT`: konten batch `cnt_<jobId>_<n>` (tunggal tetap `cnt_<jobId>`), `prompt_json` memuat `planJobId`/`itemIndex`/`itemCount`; `approvalRequired=true` → semua konten `pending` dan **0** job `GENERATE_VIDEO`; otomatis → job generate per item.
- **Approval rencana (E1, `8b9a512`, Slice 3):** tabel `plan_approvals` (unique `plan_job_id`); binding `hashPlanBinding` = sha256 atas `[{contentId, contentVersion, captionHash}]` terurut `contentId` (tanpa aset — media belum ada saat approve). Route `GET /api/v1/plans/:jobId` (rencana + item + `bindingHash` + keputusan) dan `POST /api/v1/plans/:jobId/approve|reject` body `{bindingHash, decidedBy?, reason?}`; urutan tolak 404 → 409 `PLAN_NOT_READY`/`PLAN_EMPTY`/`PLAN_ALREADY_DECIDED`/`PLAN_MISMATCH` → (approve) 409 `PLAN_INVALID` bila ada item tanpa `videoPrompt`. Approve dalam satu transaksi: simpan keputusan, `approval_status` semua konten, `GENERATE_VIDEO` idempotent per item (`generate:<contentId>`, `parentJobId` = job rencana), audit `plan.approve`/`plan.reject`.
- **Publikasi satu gerbang (E1, `8b9a512`):** mode `required` → bila ada approval rencana `approved` dengan binding cocok, **semua** item rencana (kecuali `rejected`) menjadi kandidat; tanpa itu jatuh ke approval per-konten (data lama). Handler `PUBLISH` memakai `getPlanGate` dan hanya memeriksa approval per-konten bila gerbang rencana tidak valid. Guard produksi menahan slot sampai **setiap** item rencana punya job `PUBLISH`.
- **Celah tersisa (E1):** UI belum punya form permintaan rencana maupun daftar approval batch (Slice 4); approval rencana hanya bisa diputuskan lewat API.
- **Konfigurasi (E1):** `YOUTUBE_ADAPTER=off|mock|api`, `YOUTUBE_UPLOAD_PRIVACY`, `YOUTUBE_APP_STATUS=testing|production|unknown` (status *Internal* diwakili `production`).
- **Preflight (E1, `bbfe83a`):** `preflight:youtube` — tanpa jaringan, tanpa mencetak rahasia; exit 0 lulus/peringatan, 1 FAIL, 2 konfigurasi.
- **Dashboard (E1, `8e27b27`, `406f1f5`, `acdcf17`):** `apps/dashboard` React 18 + Vite 6, dev `localhost:5174`, proxy `/api` + `/health` → `127.0.0.1:4317`; halaman Overview/Jobs/Campaigns/Approvals/Accounts/Connections; **aksi approve/reject** memakai binding dari `GET /api/v1/content/:id` (UI tidak menghitung hash), diblokir tanpa aset `valid`/akun `connected`, `APPROVAL_MISMATCH` → minta muat ulang; **Connections beraksi** (login Flow + pairing dari UI). Tanpa router, tanpa Tailwind, tanpa test UI.
- **Endpoint detail konten (E1, `5e8184b`):** `GET /api/v1/content/:id?version=n` → konten (default versi tertinggi pada baris itu), `campaign {platforms, approvalMode}`, `assets` tanpa `path`, `captionHash` server-side, `accounts` kandidat; 7 test.
- **Drift skema (2026-11-01):** `content_items` PK `id` tunggal vs LLD §5 `unique(id, version)` → versi baru untuk id yang sama gagal; `version` saat ini selalu 1; menunggu keputusan owner.
- **Sesi Flow (E1, `fd62314`; diverifikasi 2026-11-02):** `playwright` + Chromium/Chrome (`FLOW_BROWSER_CHANNEL`, default `chrome`); profil `%LOCALAPPDATA%\saa\browser\flow-profile` (`FLOW_PROFILE_DIR` absolut); `openFlowSession` memegang `.worker-lock.json` dan melepasnya pada close/launch gagal/goto gagal; `flow:login [--check]` — login manual headed, tanpa mengisi kredensial atau menembus CAPTCHA; `DEFAULT_FLOW_URL = https://flow.google.com/`. Login dari UI berakhir `succeeded`; `flow:inspect` pada project `445c6cd0-…` melihat komposer "Apa yang ingin Anda buat?" → **sesi valid & persisten**.
- **Aksi connect (E1, `989aa2f`, `acdcf17`):** `ConnectActionRunner` spawn proses anak `flow:login`/`pair:youtube` tanpa shell; single-flight (409), timeout 15/10 menit + kill tree (`taskkill /T /F`), fase `idle|running|waiting|succeeded|failed|timed_out|cancelled`; log 60 baris di memori (ANSI dihapus, pola token → `[disunting]`); status hilang saat restart API. Route: `GET/POST /api/v1/connections/actions*`; body pairing `.strict()` tepat satu `accountId`/`label`; 412 bila Chromium tidak siap atau `GOOGLE_OAUTH_CLIENT_ID` kosong. UI Connections memantau tiap 2 s dan menyediakan Hentikan.
- **Konflik profil Flow (E1):** `flow:login` gagal bila Chrome/CDP lain memakai `flow-profile` (`Opening in existing browser session`); API tidak menutup browser owner — terverifikasi pada smoke 2026-11-01.
- **Smoke aplikasi (E1, 2026-11-02):** `POST /api/v1/jobs` `GENERATE_VIDEO` + `FLOW_ADAPTER=real` → worker memanggil Flow, prompt terkirim, tile `FLOW-VIDEO-TILE` muncul; job `job_0705ff16-…` berakhir `NEEDS_ATTENTION` (`UI_CHANGED`) karena unduhan; media `data/media/job_0705ff16-…/flow-video.mp4` 3.466.852 byte, `ftyp isom`, sha256 `59df3899…98051`, `media_assets` `med_cnt_smoke_p3_20261102` valid; audit `job.manual_reconciliation`. Kredit ledger 1/1 (2026-11-02 WIB, promptHash `bf91b35be2b757fc`).
- **Panel Setelan Flow (E1, 2026-11-02):** panel dirender asinkron setelah `tune`; `tune` tersembunyi selama panel terbuka; `Simpan` menyimpan **dan menutup** panel; rasio video 16:9/9:16, gambar 16:9/4:3/1:1/3:4/9:16; "Konfirmasi sebelum membuat" default `Selalu` (otomasi butuh `Jangan pernah`).
- **Kartu hasil video (E1, 2026-11-02):** tile `FLOW-VIDEO-TILE` dengan poster `img` (`/asb/`, 288×512, alt "Thumbnail video yang dihasilkan") + ikon `play_circle`; elemen `<video>` baru ada setelah tile dibuka (navigasi `/project/<id>/edit/<id>`). Menu kartu: Download → `270p GIF Animasi`, `720p Ukuran asli`, `1080p Resolusi ditingkatkan`, `4K Resolusi ditingkatkan`.
- **Unduhan CDP (E1, 2026-11-02):** pada Chrome berprofil pengguna yang di-attach, tanpa `Browser.setDownloadBehavior` klik Download membuka dialog native dan `waitForEvent('download')` tidak pernah terpicu. Tambalan: `behavior:'allow'` + `downloadPath` + `eventsEnabled:true` sebelum interaksi. Terbukti memicu event (berkas uji `Coffee_cup_on_wooden_table_f02d740a.mp4`).
- **Retry = kredit kedua (E1):** `TimeoutError` Playwright mentah → `UNKNOWN` → retry; handler `GENERATE_VIDEO` mengirim prompt lagi. Job yang sudah submit DILARANG di-retry sebelum kebijakan "tanpa submit ulang" ada.
- **Ledger jalur aplikasi (E1):** `FLOW_ADAPTER=real` via worker belum menulis `data/flow-usage.json`; entri video ditambahkan manual dan dua entri gambar lama dipulihkan (3/3 valid).
- **D7 (E1, ADR-0009 U6):** build UI = `vite build` (`dist` gitignored), typecheck = `tsc`; **lint belum dipilih**.
- **pnpm (E1):** argumen script diteruskan apa adanya; jangan memakai `--` pemisah. Root `typecheck` memakai `-r --if-present` sehingga paket UI ikut diverifikasi.

## Keputusan Sesi Ini (Flow)

1. `playwright` (bukan `playwright-core`) + Chromium terunduh; versi browser deterministik (ADR-0010 F1).
2. Satu profil = satu proses; lock diambil sebelum browser dibuka dan dilepas di semua jalur (F4).
3. Login hanya manual lewat `flow:login`; aplikasi tidak mengisi kredensial, tidak menembus CAPTCHA (F3).
4. Satu ekspresi untuk set rasio + verifikasi `aria-checked` sebelum `Simpan`; tanpa membuka ulang panel (F30).
5. `Browser.setDownloadBehavior` wajib pada browser CDP berprofil pengguna (F31).
6. "Konfirmasi sebelum membuat" harus `Jangan pernah` untuk otomasi tanpa intervensi (F32).
7. Jalur aplikasi tidak boleh menyimpang dari guard/ledger CLI (F33).
8. Job yang prompt-nya sudah terkirim tidak boleh dinyatakan `COMPLETED` tanpa artefak; eskalasi + rekonsiliasi manual + audit (F34).

## Langkah Berikutnya

1. Slice 4 (bila diminta owner): form permintaan rencana di halaman Campaigns + daftar approval batch (`GET /api/v1/plans/:jobId`) dengan tombol setujui/tolak.
2. Uji live `PLAN_CONTENT` dengan kunci DeepSeek nyata; satu siklus rencana → approve → generate → publish (biaya sesuai guard Flow).
3. Retest unduhan `GENERATE_VIDEO` lewat aplikasi — **butuh 1 kredit**; guard 2026-11-02 sudah 1/1 sehingga menunggu izin owner (paling cepat 2026-11-03 WIB).
4. Sambungkan guard/ledger ke jalur `FLOW_ADAPTER=real`; tambahkan jalur "unduh ulang tanpa submit" (downloadOnly).
5. Menunggu owner lain: pairing YouTube (`GOOGLE_OAUTH_CLIENT_ID`), keputusan revisi multi-versi konten, smoke live YouTube, lint (D7), `AGENTS.md`.

## Asumsi Terbuka (jangan dibangun di atasnya tanpa verifikasi)

- Apakah akun owner benar-benar punya akses Flow, kuota/limit, dan kebijakan penggunaannya (OD-1 sisa faktual).
- URL default Flow stabil/tidak; apakah generasi bisa berjalan headless (keduanya UNKNOWN).
- Apakah project unverified benar-benar boleh upload `public` (F2 CONFLICT) — hanya terbukti saat uji nyata.
- Klasifikasi resmi scope `youtube.upload` dan batas unggahan per channel (tidak dipublikasikan).
- Status publikasi app OAuth hanya diketahui dari laporan owner lewat `YOUTUBE_APP_STATUS`.
- DPAPI hanya teruji di Windows 10 host ini; OAuth/refresh/resume hanya dengan `fetch` palsu.
- Adapter DeepSeek belum diuji live; kunci kini dapat diisi lewat DPAPI tetapi belum ada kunci nyata dari owner.
- Dashboard hanya diuji di Chromium desktop (viewport ~818px).
- Revisi konten multi-versi tidak dapat disimpan (PK `content_items` = `id`); `version` selalu 1.
- Unduhan lewat worker baru terbukti dengan ekspresi Playwright terpisah (bukan jalur handler penuh) setelah tambalan.
- Batch > 1 item sudah diuji di level API, enqueuer, dan handler (approve → 2 job generate → 2 job publish), tetapi belum dijalankan end-to-end dengan kunci DeepSeek dan adapter publikasi nyata.
- Approval rencana hanya dapat diputuskan lewat API; UI Slice 4 belum ada.
- Lint belum dipilih; pairing akun tetap CLI.
