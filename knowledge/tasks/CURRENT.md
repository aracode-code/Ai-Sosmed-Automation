# CURRENT — Task Aktif

**Session:** SESSION-2026-11-02-1
**Updated:** 2026-11-02T09:58:00+07:00
**Change class:** MEDIUM (route media baru + containment berkas + panel hasil generasi di UI)

## Active Task

Owner meminta **berkas hasil generasi ditampilkan di job** (`apakah kamu bisa menbambhkan file hasil generatenya di job`). **COMPLETED** sebagai slice **S7**: `GET /api/v1/media/:id/file` menyajikan aset media yang tercatat di `media_assets`, dan panel detail Jobs menampilkan **Hasil generasi** (`<img>` untuk gambar, `<video>` untuk video) beserta mime/ukuran/status validasi/sha256 + tautan **Unduh**. Tidak ada tabel, migrasi, atau dependensi baru.

Fitur sebelumnya (**S6 dua mode generasi video/gambar**, `81dd916`, ADR-0012) tetap VERIFIED dan tidak diubah.

| Field | Nilai |
|---|---|
| Slice | **S7** — berkas hasil generasi di detail job |
| Status | **COMPLETED (S7)** — video terverifikasi live + visual; cabang `<img>` baru diuji unit (belum ada aset gambar di DB nyata) |
| Mode eksekusi | SINGLE-WRITER sequential, L1 |
| Commit kode | `4ebdc9d` — 7 berkas, +350/−2 |

## Bukti Sesi Ini (aktual 2026-11-02 WIB)

| Bukti | Hasil |
|---|---|
| Route media | `apps/local-api/src/routes/media.ts`: `getMediaAsset` → `assertInsideRoot(MEDIA_ROOT)` (path DB tidak dipercaya) → mime allowlist → `statSync` → `createReadStream`; header `content-type`, `content-length`, `content-disposition: inline`, `x-media-sha256`; 404 `NOT_FOUND`/`MEDIA_MISSING`, 409 `MEDIA_UNSUPPORTED`/`MEDIA_OUTSIDE_ROOT` |
| Wiring | `buildApp` menerima `mediaRoot?` (default `resolve(config.mediaRoot)`); `server.ts` meneruskan `mediaRoot` yang sudah diresolusi — nilai sama dengan `outputRoot` generator |
| UI Jobs | `JobsPage` memuat `GET /api/v1/content/:contentId` lalu merender `JobResult` bila `assets.length > 0`: `<img>`/`<video controls preload="metadata">`, mime, ukuran terformat, `StatusPill`, sha256 12 karakter, tautan `download` bernama `<assetId>.<ext>` |
| Test | `corepack pnpm vitest run --no-file-parallelism` → **58 file / 506 test** hijau; `media-route.test.ts` 5 test (PNG 200 + header + payload, 404 `NOT_FOUND`, 409 `MEDIA_OUTSIDE_ROOT`, 404 `MEDIA_MISSING`, 409 `MEDIA_UNSUPPORTED`) |
| Quality gate | `corepack pnpm typecheck` exit 0 (10 paket + `tests/tsconfig.json`) |
| Smoke live | `curl -D - /api/v1/media/med_cnt_smoke_p3_20261102/file` → `200`, `content-type: video/mp4`, `content-length: 3466852`, `content-disposition: inline; filename="flow-video.mp4"`, `x-media-sha256: 59df3899…98051` |
| Smoke UI | Chromium headless (viewport **1126×792**) pada API `127.0.0.1:4317` + dashboard `localhost:5174`: job `job_0705ff16-…` (`NEEDS_ATTENTION`) menampilkan video 7 s dengan gambar nyata, `video/mp4`, `3.3 MB`, `valid`, sha256 `59df3899f62a…`, tombol **Unduh** → route media |
| Regresi | Halaman lain tidak diubah; `TONES` hanya menambah kunci `valid: 'ok'`; route lama tetap terdaftar (32 route) |
| Secret scan | Tidak ada kredensial di diff/log/UI; route tidak mengembalikan `path` filesystem, hanya `content-disposition` nama berkas |

## Temuan yang Mengikat

| Temuan | Dampak |
|---|---|
| Path DB tidak tepercaya | `media_assets.path` dapat menunjuk luar `MEDIA_ROOT` (data lama/uji); setiap permintaan divalidasi ulang dengan `assertInsideRoot`, bukan hanya saat tulis |
| Mime allowlist ketat | Hanya `video/mp4`, `image/png`, `image/jpeg`; nilai lain → 409 `MEDIA_UNSUPPORTED` (tidak menyajikan `text/html` atau tipe tak dikenal) |
| Bukan static directory | Route berbasis id + resolusi DB; tidak ada direktori media yang diekspos ke publik |
| Hasil parsial tetap terlihat | Panel dirender untuk job `COMPLETED` maupun `NEEDS_ATTENTION` — aset Flow yang sudah tersimpan dapat diperiksa/diunduh walau job gagal di tahap unduhan |
| Cabang `<img>` belum visual | Belum ada aset gambar di DB nyata; hanya unit test PNG/JPEG. Jangan klaim UI gambar terverifikasi |

## Impact Map

- **Kode diubah:** `apps/local-api/src/{app.ts,server.ts}`, `apps/local-api/src/routes/media.ts` (baru), `apps/local-api/src/media-route.test.ts` (baru), `apps/dashboard/src/pages/JobsPage.tsx`, `apps/dashboard/src/styles.css`, `apps/dashboard/src/components.tsx`.
- **Tidak berubah:** skema/tabel (13), migrasi (5), kontrak repository, handler workflow, scheduler, adapter YouTube/Flow, dependensi/lockfile, keputusan keamanan/rahasia.
- **Route:** 31 → **32**.

## Drift Tercatat

- Pratinjau `<img>` belum diuji visual (tidak ada aset gambar di DB nyata); route PNG/JPEG lolos unit test.
- Smoke UI memakai viewport 1126×792 (browser otomasi), bukan 1440 seperti smoke sebelumnya — dicatat apa adanya.
- Temuan lama tetap: P3 PARTIAL (unduhan via worker belum diuji ulang), P4 PARTIAL (reauth), P5 PARTIAL (unggah nyata), P7 auth/`Origin`, `content_items` PK drift, ledger kredit jalur aplikasi, lint (D7), publikasi media gambar (P6).

## Next Session Handoff

1. **Tunggu instruksi owner**; S7 selesai dan tidak ada slice berikutnya yang disetujui.
2. Jangan retry job `NEEDS_ATTENTION` yang sudah punya aset `valid` (retry = submit ulang Flow).
3. Retest unduhan `GENERATE_VIDEO` lewat Flow nyata **butuh 1 kredit**; tab Gambar Flow juga perlu uji berbayar sebelum mode gambar dinyatakan VERIFIED untuk Flow nyata.
4. Publikasi media gambar membutuhkan adapter platform baru (P6) — jangan mengaktifkan `PUBLISH` untuk gambar tanpa adapter tersebut.
5. Bila muncul aset gambar nyata (Flow tab Gambar/mock image di DB aplikasi), ambil screenshot panel **Hasil generasi** untuk menutup drift cabang `<img>`.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.
