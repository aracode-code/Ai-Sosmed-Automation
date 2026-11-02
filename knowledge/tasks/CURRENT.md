# CURRENT — Task Aktif

**Session:** SESSION-2026-11-02-1
**Updated:** 2026-11-02T09:30:00+07:00
**Change class:** MEDIUM (mode generasi baru lintas domain → DB → workflow → scheduler → UI)

## Active Task

Owner meminta **dua mode generasi: video atau gambar** (`tambahkam 2 mode generasi video atau image`). **COMPLETED** sebagai slice **S6**: campaign memiliki `generationMode` (`video` default / `image`) yang tersimpan di DB, mengalir ke perencanaan (`PLAN_CONTENT` menyimpan `mediaKind`), produksi (`GENERATE_VIDEO`/`GENERATE_IMAGE` dengan generator `MediaGenerator`), validasi media (MP4 vs PNG/JPEG), penjadwalan (campaign gambar tidak menerbitkan), dan dashboard (select + kolom mode). Desain dicatat di `decisions/ADR-0012-generation-modes.md`.

| Field | Nilai |
|---|---|
| Slice | **S6** — mode generasi video/gambar |
| Status | **COMPLETED (S6)** — dua mode tersedia end-to-end; mode gambar berhenti di produksi media (publikasi gambar belum ada) |
| Mode eksekusi | SINGLE-WRITER sequential, L1 |
| Commit kode | `81dd916` — 37 berkas, +731/−162 |

## Bukti Sesi Ini (aktual 2026-11-02 WIB)

| Bukti | Hasil |
|---|---|
| Domain + DB | `GenerationMode`/`MediaKind` (`packages/domain/src/generation.ts`); `Campaign.generationMode`; `JOB_TYPES` + `GENERATE_IMAGE`; migrasi `0004_campaign_generation_mode.sql` (`campaigns.generation_mode` default `video`); repository memetakan nilai tak dikenal → `video` |
| API campaign | `POST /api/v1/campaigns` menerima `generationMode: 'video'|'image'` default `video`; respons campaign menyertakan `generationMode` |
| Generator | `MediaGenerator`/`MediaGenerationRequest.kind?` (default `video`); `MockMediaGenerator` menulis MP4-shaped atau **PNG valid** 72×128 / 128×72 / 96×96; `FlowPlaywrightGenerator` meneruskan `kind` + timeout render video 15 menit / gambar 5 menit |
| Validasi | `validateMediaFile({kind})`: video wajib `ftyp`, gambar wajib signature PNG/JPEG; probe durasi hanya video; gambar `durationMs = null` |
| Workflow | `createGenerateMediaHandler(deps, kind)` didaftarkan untuk `GENERATE_VIDEO` dan `GENERATE_IMAGE`; `PLAN_CONTENT` menyimpan `mediaKind` dan memilih job type sesuai mode; `PUBLISH` mensyaratkan aset `video/mp4` (aset gambar → `FAILED` + `VALIDATION`) |
| Scheduler | `enqueueDuePublicationJobs` berhenti untuk campaign non-video dan filter aset `video/mp4`; guard `listPlanContentsAwaitingPublish` dilewati untuk campaign gambar; `PIPELINE_BUSY` hanya untuk video |
| Rencana | `GET /api/v1/plans/:jobId` menampilkan `campaign.generationMode` + `mediaKind` per item; approve meng-enqueue `GENERATE_IMAGE`/`GENERATE_VIDEO` sesuai mode item |
| UI | `CreateCampaignForm` select **Mode generasi** (dua opsi, default video); tabel Campaigns kolom **Generasi**; `PlanReviewPanel` menampilkan mode campaign + item dan pesan sukses sesuai job type |
| Test | `corepack pnpm vitest run --no-file-parallelism` → **57 file / 501 test** hijau (sebelumnya 489; +12 test; `generate-video.ts`+test diganti `generate-media.ts`+test, beberapa test lain disesuaikan) |
| Quality gate | `corepack pnpm typecheck` exit 0 (10 paket + `tests/tsconfig.json`) |
| Smoke UI | Playwright headless Chromium **1440×900** pada API `127.0.0.1:4317` + dashboard `localhost:5174`: select mode menampilkan `video — diproduksi dan dapat diterbitkan` + `image — diproduksi, belum diterbitkan`, opsi `image` dapat dipilih, kolom **GENERASI** menampilkan `video`; screenshot `data/tmp/campaign-generation-mode.png` + `-image.png` (gitignored). Tidak ada campaign gambar yang dikirim ke planner (menghindari panggilan DeepSeek berbayar) |
| Migrasi runtime | API dev di-restart; migrasi `0004` diterapkan; `GET /api/v1/campaigns` mengembalikan `generationMode:"video"` untuk campaign lama |
| Secret scan | Tidak ada kredensial di diff/log/UI; screenshot tidak memuat rahasia |

## Temuan yang Mengikat

| Temuan | Dampak |
|---|---|
| Publikasi gambar tidak ada | Adapter terdaftar hanya YouTube (video). Mode gambar = produksi media saja; `PUBLISH` dipaksa → `VALIDATION` (ADR-0012 G9) |
| Kosakata planner dipertahankan | `create_video`/`videoPrompt` dipakai untuk kedua mode agar output model lama tetap valid; mode adalah kebijakan campaign (G3) |
| Guard kedalaman berbeda | Campaign gambar tidak menunggu job `PUBLISH`; slot berikutnya langsung merencanakan konten baru (G10) |
| Mode tidak dapat diubah dari UI | Campaign hanya bisa dibuat; edit mode menunggu form edit campaign di backlog |

## Impact Map

- **Kode diubah:** `packages/domain/src/{generation.ts,index.ts,entities.ts,job.ts}`; `packages/database/{migrations/0004_campaign_generation_mode.sql,schema.ts,repositories/campaigns.ts,migrate.test.ts}`; `packages/browser-engine/src/{types.ts,mock-generator.ts,media.ts,flow-usage.ts,flow-playwright-generator.ts}` (+test); `packages/workflow/src/handlers/{generate-media.ts,plan-content.ts,publish.ts}` (+test), `index.ts`; `packages/scheduler/src/{dispatch.ts,production.ts}` (+test); `apps/local-api/src/{handlers.ts,routes/campaigns.ts,routes/plans.ts,routes/content.ts}` (+test); `apps/dashboard/src/{types.ts,CreateCampaignForm.tsx,PlanReviewPanel.tsx,pages/CampaignsPage.tsx}`.
- **Dihapus:** `packages/workflow/src/handlers/generate-video.ts` + test (digantikan `generate-media.ts`).
- **Tidak berubah:** kontrak `SocialAdapter`/adapter YouTube, route/jumlah endpoint (31), tabel selain `campaigns`, dependensi/lockfile, keputusan keamanan/rahasia.
- **Dependensi baru:** tidak ada.

## Drift Tercatat

- Flow tab **Gambar** nyata belum diuji lewat aplikasi (butuh kredit); hanya launcher palsu pada test.
- Publikasi gambar belum ada; adapter gambar (Instagram/Facebook) adalah pekerjaan P6.
- Temuan lama tetap: P3 PARTIAL (unduhan via worker belum diuji ulang), P4 PARTIAL (reauth), P5 PARTIAL (unggah nyata), P7 auth/`Origin`, `content_items` PK drift, ledger kredit jalur aplikasi, lint (D7), `AGENTS.md` untracked.

## Next Session Handoff

1. **Tunggu instruksi owner**; dua mode generasi selesai dan tidak ada slice berikutnya yang disetujui.
2. Jangan retry job `NEEDS_ATTENTION` yang sudah punya aset `valid` (retry = submit ulang Flow).
3. Retest unduhan `GENERATE_VIDEO` lewat Flow nyata **butuh 1 kredit**; tab Gambar Flow juga perlu uji berbayar sebelum mode gambar dinyatakan VERIFIED untuk Flow nyata.
4. Publikasi media gambar membutuhkan adapter platform baru (P6) — jangan mengaktifkan `PUBLISH` untuk gambar tanpa adapter tersebut.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.
