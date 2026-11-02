# ADR-0012 — Dua Mode Generasi: Video dan Gambar

**Status:** Accepted (diputuskan agen di L1 atas perintah owner "tambahkam 2 mode generasi video atau image", 2026-11-02)
**Tanggal:** 2026-11-02
**Konteks:** Pipeline hanya mengenal satu jenis artefak: video MP4 (`VideoGenerator`, handler `GENERATE_VIDEO`) dan publikasi YouTube yang video-only. Owner meminta campaign dapat memilih menghasilkan **video** atau **gambar**. Pilihan ini harus terlihat di UI, tersimpan di DB, dan mengalir ke perencanaan, generator, validasi, dan penjadwalan tanpa merusak campaign lama.
**Ruang lingkup:** mode generasi end-to-end (domain → migrasi → API → planner → handler → generator/validasi → scheduler → dashboard). Publikasi gambar **tidak** termasuk: adapter yang terdaftar hanya YouTube (video).

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| G1 | `generationMode: 'video' \| 'image'` adalah atribut **campaign**, default `video`, disimpan di kolom `campaigns.generation_mode` (migrasi `0004_campaign_generation_mode.sql`) | Satu keputusan per campaign paling sederhana untuk alur "rencana → produksi"; default `video` menjaga perilaku data lama dan campaign yang dibuat sebelum migrasi | Butuh mode campuran per item/akun → pindah ke level konten |
| G2 | Tipe domain `GenerationMode`/`MediaKind` tinggal di `@saa/domain` (`generation.ts`); `Campaign.generationMode` wajib; `JOB_TYPES` bertambah `GENERATE_IMAGE` | Satu sumber tipe untuk DB, workflow, browser-engine, dan API; tidak ada union lokal yang bisa menyimpang | Mode ketiga (mis. audio) → perluas konstanta |
| G3 | Kosakata planner **tidak** diubah: keputusan `create_video` dan field `videoPrompt` tetap dipakai untuk kedua mode | Output model, skema Zod, policy, dan prompt tidak perlu diajarkan konsep baru; mode adalah kebijakan campaign, bukan keputusan model | Planner perlu memilih mode per item |
| G4 | `prompt_json` konten menyimpan `mediaKind`; `GET /api/v1/plans/:jobId` menampilkan `campaign.generationMode` dan `mediaKind` per item | Keputusan approval harus memperlihatkan artefak apa yang akan dibuat; mode tetap benar walau campaign diubah setelah rencana dibuat | Campaign boleh berganti mode setelah rencana disetujui |
| G5 | Kontrak generator digeneralisasi: `MediaGenerationRequest.kind?` (default `video`), `GeneratedMedia`, `MediaGenerator`; `MockMediaGenerator` menghasilkan MP4-shaped untuk video dan **PNG valid** (72×128 / 128×72 / 96×96 sesuai rasio) untuk gambar | Pemanggil lama tidak berubah; pipeline validasi/checksum/idempotensi/UI dapat diuji tanpa Flow dan tanpa kredit | Dibutuhkan artefak gambar non-PNG (WebP/JPEG) |
| G6 | Satu handler `createGenerateMediaHandler(deps, kind)` didaftarkan dua kali: `GENERATE_VIDEO` (video) dan `GENERATE_IMAGE` (image); id aset tetap `med_<contentId>` | Logika generate→validasi→upsert identik; memisahkan dua berkas hanya menggandakan kode | Perilaku per mode mulai berbeda (mis. jumlah gambar per konten) |
| G7 | `validateMediaFile` menerima `kind`: video wajib header `ftyp`, gambar wajib signature PNG/JPEG; probe durasi **hanya** video; `durationMs` gambar `null` | `ffprobe` tidak relevan untuk gambar; menerima MP4 sebagai "gambar" akan membuat aset salah tanpa terdeteksi | Butuh validasi dimensi/DPI gambar |
| G8 | `FlowPlaywrightGenerator` menerima `kind` (tab Video atau Gambar) dengan timeout render per jenis: video 15 menit, gambar 5 menit | Batas waktu gambar jauh lebih pendek; satu nilai untuk keduanya membuat job gambar menggantung terlalu lama | Angka terbukti tidak cocok pada akun nyata |
| G9 | Campaign `image` **tidak pernah** menerbitkan: enqueuer publikasi berhenti lebih awal, filter aset mensyaratkan `mimeType === 'video/mp4'`, dan handler `PUBLISH` menolak aset non-video (`VALIDATION` → `FAILED`) | Adapter yang ada (YouTube) hanya menerima video; mengizinkan gambar lolos akan menghasilkan kegagalan yang membingungkan atau unggahan salah | Adapter gambar (Instagram/Facebook) tersedia → hapus larangan per platform |
| G10 | Guard produksi `production.ts` melewati cek `listPlanContentsAwaitingPublish` untuk campaign `image`; `PIPELINE_BUSY` di `POST /api/v1/content` hanya berlaku untuk campaign `video` | Tanpa ini campaign gambar berhenti permanen karena item rencananya tidak akan pernah punya job `PUBLISH` | Kebijakan produksi berubah (mis. gambar boleh dipublikasikan) |
| G11 | UI: form Buat campaign menambahkan select **Mode generasi** (`video` default / `image`), tabel Campaigns menampilkan kolom **Generasi**, panel rencana menampilkan mode campaign dan mode per item; pesan sukses approve menyebut `GENERATE_IMAGE`/`GENERATE_VIDEO` sesuai mode | Mode harus terlihat sebelum dan sesudah keputusan; tanpa label, pengguna tidak tahu kenapa tidak ada publikasi | — |

## Konsekuensi

- **Data lama aman:** migrasi memberi nilai `video` pada seluruh baris; repository memetakan nilai tak dikenal ke `video`; API campaign default `video`.
- **Mode gambar adalah mode produksi saja:** artefak dibuat dan divalidasi (`media_assets` valid), tetapi `PUBLISH` tidak dibuat oleh scheduler dan akan gagal `VALIDATION` bila dipaksa lewat API. Ini batas produk yang disengaja, bukan bug.
- **Kedalaman produksi berbeda:** slot campaign `image` tidak lagi menunggu job `PUBLISH`; setelah konten dan medianya selesai, slot berikutnya dapat merencanakan konten baru.
- **Nama job berbeda di UI/API:** `JOB_TYPES` kini 10 nilai; filter `jobType` di `GET /api/v1/jobs` menerima `GENERATE_IMAGE`.
- **Belum ada:** adapter publikasi gambar, pilihan mode per item, dan UI edit mode setelah campaign dibuat. Flow nyata untuk tab Gambar belum diuji (butuh kredit).

## Bukti

- Migrasi `0004_campaign_generation_mode.sql`; repository `campaigns.ts`; route `POST /api/v1/campaigns` (`generationMode` default `video`).
- Domain `packages/domain/src/generation.ts` + `JOB_TYPES` (`GENERATE_IMAGE`).
- Browser-engine: `types.ts`, `mock-generator.ts` (PNG valid), `media.ts` (PNG/JPEG), `flow-playwright-generator.ts` (kind + timeout).
- Workflow: `handlers/generate-media.ts` (menggantikan `generate-video.ts`), `handlers/plan-content.ts`, `handlers/publish.ts`.
- Scheduler: `dispatch.ts` (skip campaign non-video, filter MIME), `production.ts` (guard per mode).
- Local API: `routes/plans.ts`, `routes/content.ts`, `handlers.ts`; dashboard: `CreateCampaignForm.tsx`, `CampaignsPage.tsx`, `PlanReviewPanel.tsx`, `types.ts`.
- Test: `vitest run --no-file-parallelism` → **57 file / 501 test** hijau; `corepack pnpm typecheck` exit 0 (10 paket + `tests/tsconfig.json`).
- Smoke UI: Playwright headless Chromium 1440×900 pada API `127.0.0.1:4317` + dashboard `localhost:5174` — select mode menampilkan dua opsi, nilai `image` dapat dipilih, tabel menampilkan kolom GENERASI (`video`); screenshot `data/tmp/campaign-generation-mode.png` dan `data/tmp/campaign-generation-mode-image.png` (gitignored). Tidak ada campaign gambar yang dikirim ke planner agar tidak memicu panggilan DeepSeek berbayar.
