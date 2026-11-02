# CURRENT — Task Aktif

**Session:** SESSION-2026-11-02-1
**Updated:** 2026-11-02T07:20:00+07:00
**Change class:** MEDIUM (perbaikan `flow-generator` + test; tanpa schema/migrasi/route)

## Active Task

Owner memilih **smoke lewat aplikasi (P3)**: job `GENERATE_VIDEO` dengan `FLOW_ADAPTER=real` agar worker benar-benar memanggil Flow, lalu verifikasi media tersimpan. Hasil: pembuatan nyata **berhasil** (video Veo 3.1 - Lite, 9:16, satu kredit), tetapi unduhan worker tertahan **dialog "Save As" native Chrome**; media dipulihkan dari URL video bertanda tangan dan dicatat sebagai aset `valid`. Job **tidak** ditandai COMPLETED (dieskalasi jujur ke `NEEDS_ATTENTION`).

| Field | Nilai |
|---|---|
| Job | `job_0705ff16-ab0c-45bd-aac1-48d240e6f1fb` → `NEEDS_ATTENTION`, `last_error_code=UI_CHANGED` |
| Konten | `cnt_smoke_p3_20261102` (campaign `cmp_6773ab06-…`, dibuat lewat repository aplikasi karena `DEEPSEEK_API_KEY` tidak ada) |
| Media | `data/media/job_0705ff16-ab0c-45bd-aac1-48d240e6f1fb/flow-video.mp4` — **3.466.852 byte**, `ftyp isom`, sha256 `59df3899…8051`, `durationMs=null` (ffprobe tidak tersedia) |
| Status | **P3 PARTIAL** — pembuatan via worker TERVERIFIKASI; unduhan via worker belum (fix sudah ditulis, belum diuji end-to-end karena butuh kredit baru) |
| Mode eksekusi | SINGLE-WRITER sequential, L1 |

## Bukti Sesi Ini (aktual 2026-11-02 WIB)

| Bukti | Hasil |
|---|---|
| Enqueue | `PLAN_CONTENT` tidak tersedia (tanpa `DEEPSEEK_API_KEY`); campaign/konten/job disisipkan lewat repository aplikasi (`insertCampaign`, `upsertContentItem`, `insertJobIdempotent`) dengan skrip sementara yang sudah dihapus |
| Worker nyata | API `FLOW_ADAPTER=real FLOW_CDP_ENDPOINT=http://127.0.0.1:9222 WORKER_INTERVAL_MS=1000` pada port 4317; job klaim → `GENERATING` |
| Pembuatan Flow | Prompt bubble terkirim; muncul tile `FLOW-VIDEO-TILE` (poster `img` 288×512, alt "Thumbnail video yang dihasilkan"); editor menampilkan timeline **00–11** → video jadi |
| Kegagalan unduhan | Dialog native **"Save As"** (`#32770`) terbuka → `waitForEvent('download')` tidak pernah menerima event; worker dihentikan manual sebelum timeout 120 s agar tidak retry (retry akan men-submit ulang = kredit kedua) |
| Akar masalah | Saat attach ke Chrome profil pengguna, perilaku unduhan Chrome tidak disetel; klik `Download → 720p Ukuran asli` memicu dialog native |
| Bukti perbaikan | Setelah `Browser.setDownloadBehavior {behavior:'allow', downloadPath, eventsEnabled:true}`, klik `Download → Ukuran asli` **memicu event `download`** (`Coffee_cup_on_wooden_table_f02d740a.mp4`) tanpa dialog (uji terkontrol, tanpa kredit) |
| Perbaikan kode | `generateFlowMedia` menyetel `Browser.setDownloadBehavior` sebelum interaksi; typecheck exit 0 |
| Pemulihan media | URL bertanda tangan `flow-content.google/video/<id>?Expires=…` → HTTP 200 `video/mp4` 3.466.852 byte → `validateMediaFile` (berkas aplikasi) → `upsertMediaAsset` `med_cnt_smoke_p3_20261102` `validationStatus=valid` |
| Rekonsiliasi job | `ESCALATE` `GENERATING → NEEDS_ATTENTION`, lease dilepas, audit `job.manual_reconciliation` (alasan + sha256 + ukuran) |
| Ledger kredit | Entri baru `2026-11-01T23:53:07.242Z` video `submitted=true` `succeeded`; pemakaian **1/1** untuk 2026-11-02 WIB; dua entri lama dipulihkan setelah bug pemanggilan `parseLedger({raw})` (sempat terbuang, sudah diperbaiki) |
| Quality gate | typecheck 10 paket + `tests/tsconfig.json` exit 0 · **53 file / 443 test** hijau (`vitest run --no-file-parallelism`) |

## Temuan yang Mengikat

| Temuan | Dampak |
|---|---|
| Panel Setelan dirender **asinkron** | Klik `tune` tidak menjamin tombol model/radio ada; ekspresi rasio wajib menunggu (maks. 15×200 ms) |
| `Simpan` menutup panel | Verifikasi `aria-checked` harus di dalam ekspresi yang sama **sebelum** `Simpan`; membuka panel lagi untuk verifikasi menutupi komposer (`kotak prompt tidak terlihat`) |
| Setelan agen "Konfirmasi sebelum membuat" | Default `Selalu` membuat agen berhenti minta konfirmasi; untuk pembuatan otomatis project harus `Jangan pernah` (diubah manual lewat UI) |
| Hasil video = tile, bukan `<video>` | `MEDIA_PROBE` mengembalikan poster `img` (`/asb/`, 288×512); `OPEN_CARD_MENU` bekerja pada kartu tile |
| Unduhan butuh perilaku CDP | Tanpa `Browser.setDownloadBehavior`, Chrome memunculkan dialog native dan event `download` tidak pernah tiba |
| Jalur aplikasi ≠ ledger | `FlowPlaywrightGenerator` tidak memanggil guard/ledger `flow-usage`; kredit lewat aplikasi tidak tercatat otomatis (dicatat manual sesi ini) |
| `PLAN_CONTENT` butuh `DEEPSEEK_API_KEY` | Tanpa key, produksi konten otomatis tidak bisa dipakai; smoke memakai enqueue manual |

## Impact Map

- **Diubah:** `packages/browser-engine/src/flow-generator.ts` (perilaku unduhan CDP), `packages/browser-engine/src/flow-ratio.test.ts` (12 test, ekspresi rasio async + verifikasi satu langkah).
- **DB lokal (data, gitignored):** `media_assets` +1 baris, `jobs` 1 baris dieskalasi, `audit_logs` +1, `data/flow-usage.json` +1 entri video.
- **Tidak berubah:** schema/migrasi (3 berkas, 12 tabel), route (26), paket/workspace.

## Drift Tercatat

- **P3 PARTIAL**: pembuatan via worker terverifikasi; unduhan via worker **belum** (fix belum diuji end-to-end; perlu 1 kredit baru dengan izin owner).
- **Ledger aplikasi**: kredit via aplikasi tidak dicatat otomatis — perlu wiring `onSubmit`/guard ke `FlowPlaywrightGenerator` (backlog).
- **Durasi media** `null` karena ffprobe tidak terpasang; `validateMediaFile` menerima `probe` opsional.
- Halaman Flow project kini berada di mode editor (`/edit/<id>`) setelah tile diklik; buka ulang project sebelum smoke berikutnya.
- P4 PARTIAL (reauth), P5 PARTIAL (unggah nyata), P7 auth/`Origin` belum; `AGENTS.md` tetap untracked.

## Next Session Handoff

1. Minta izin owner untuk **1 kredit** guna menguji ulang jalur aplikasi end-to-end setelah fix `Browser.setDownloadBehavior` (guard 1/hari sudah 1/1 hari ini → tunggu 2026-11-03 WIB).
2. Sebelum smoke: buka project Flow yang bersih, set "Konfirmasi sebelum membuat" = `Jangan pernah`, pastikan komposer terlihat dan tidak ada panel terbuka.
3. Tambahkan guard/ledger ke `FlowPlaywrightGenerator` (maks. 1/hari + konfirmasi) agar jalur aplikasi tidak melewati batas kredit.
4. `PLAN_CONTENT` end-to-end masih menunggu `DEEPSEEK_API_KEY` di environment proses API.
5. Rekonsiliasi job `NEEDS_ATTENTION` yang sudah punya aset `valid`: **jangan** klik retry (akan men-submit ulang); putuskan kebijakan (retry tanpa submit / tandai selesai manual) sebelum UI retry dipakai.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.
