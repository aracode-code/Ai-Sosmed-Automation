# ADR-0004 — Worker Loop dan Registrasi Handler di Composition Root

**Status:** Accepted (diputuskan agen di L1) — revisitable
**Tanggal:** 2026-10-30
**Konteks:** commit `6ad9547` · SESSION-2026-10-30-2

## Konteks

Setelah fase A/B/C, handler dan dispatcher sudah teruji tetapi hanya berjalan di dalam test: `apps/local-api` belum pernah memanggil `Dispatcher.runOnce` secara periodik dan belum punya registri handler. Instruksi owner: "Implementasikan worker loop + registrasi handler". Tanpa ini job `PLAN_CONTENT`/`GENERATE_VIDEO` tidak pernah diproses di runtime nyata.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| W1 | `Worker` hidup di `@saa/workflow` dan menerima `JobRunner` struktural (`{ runOnce(): Promise<Job \| null> }`); `Dispatcher` memenuhi kontrak itu tanpa `implements` | Loop dan dispatcher berbagi domain yang sama; antarmuka minimal membuat loop dapat diuji dengan runner palsu | Loop dipindah ke proses/binary terpisah |
| W2 | Siklus tidak pernah tumpang tindih: tick dilewati bila siklus sebelumnya masih berjalan; timer `.unref()`; `stop()` menunggu siklus berjalan lalu berhenti | Satu worker = satu klaim job pada satu waktu; `unref` mencegah timer menahan proses saat shutdown | Concurrency > 1 (OD-7) |
| W3 | Error dari `runOnce` ditelan dan dicatat (`errorClass` + `worker: siklus gagal`); loop tetap hidup | Kegagalan job sudah dipersist dispatcher (`handleFailure`); loop yang mati karena satu exception lebih berbahaya | — |
| W4 | Interval lewat `WORKER_INTERVAL_MS` (50–60 000, default 1 000); `WORKER_ENABLED=false` mematikan loop tetapi API tetap jalan | Operasi baca-saja/debug tanpa memproses antrean; batas bawah mencegah banjir query | Butuh scheduling adaptif |
| W5 | `buildHandlerRegistry` di `apps/local-api` menjadi satu-satunya tempat pendaftaran; `GENERATE_VIDEO` selalu terdaftar dengan `MockVideoGenerator` sebagai default | Composition root adalah titik yang boleh tahu semua adapter; mock tetap satu-satunya generator sampai OD-1 | Adapter Flow nyata tersedia |
| W6 | `PLAN_CONTENT` hanya didaftarkan bila `loadAiCredentials()` mengembalikan key; tanpa key, job akan menjadi `NEEDS_ATTENTION` + `NO_HANDLER` | Planner tanpa adapter nyata tidak boleh diganti fallback diam-diam; kegagalan harus terlihat | Planner lokal/mock disetujui — **sebagian digantikan** oleh ADR-0011 A3 (2026-11-02): planner selalu terdaftar, tanpa kunci → `AUTH` (bukan `NO_HANDLER`) |
| W7 | Kredensial AI dibaca hanya dari environment lewat `loadAiCredentials`; nilai **tidak** masuk `AppConfig` dan tidak pernah dicatat | `AppConfig` aman dilog; key tidak menyentuh state, log, atau commit (X-03) | Credential Manager/DPAPI dipilih owner |
| W8 | `workerId = worker_<pid>`; satu worker per proses, satu job per siklus | Default konservatif OD-7 (1 Flow worker); mencegah dua proses lokal saling klaim tanpa koordinasi | Multi-worker terdokumentasi |
| W9 | `/health` melaporkan `workers.active` dari callback `workerActive` yang disuntikkan `buildApp` (default `0`) | Laporan status harus berasal dari objek nyata, bukan asumsi; test lama tetap valid | Status lebih kaya (last tick, leased job) |
| W10 | Urutan boot: migrasi → recovery → registry → dispatcher/worker → `listen` → `worker.start()`; urutan shutdown: worker → Fastify → DB | Worker tidak boleh memproses job sebelum API siap, dan tidak boleh menulis DB setelah koneksi ditutup | — |

## Konsekuensi

- Job kini benar-benar diproses di runtime: PLAN_CONTENT (bila key ada) → GENERATE_VIDEO → aset media, terverifikasi di test rantai penuh dan smoke boot (`workers.active = 1`).
- Handler yang belum ada (`DOWNLOAD_VIDEO`, `PUBLISH`, …) tetap berakhir `NEEDS_ATTENTION` + `NO_HANDLER` — terlihat, bukan disembunyikan.
- **Scheduler tetap tidak berjalan periodik**: loop ini hanya mengambil job; dispatch jadwal → pembuatan job publikasi menunggu P5.
- Belum ada retry untuk kegagalan `checkAvailability` lintas restart selain mekanisme `run_at` yang sudah ada.

## Bukti

| Bukti | Hasil |
|---|---|
| Typecheck | 7 paket + `tests/tsconfig.json` PASS |
| Test suite | 27 file, **193 passed / 0 failed** |
| Test baru | `packages/workflow/src/worker.test.ts` (4), `apps/local-api/src/worker.test.ts` (4), config (11 total), health worker (12 total app) |
| Smoke boot | DB sementara + `WORKER_INTERVAL_MS=200` → `/health` `{workers:{active:1}}`, log `handlers:["GENERATE_VIDEO"]`, `worker dimulai`; proses dihentikan setelah uji |

## Open Items (jangan diisi tanpa keputusan)

- Sumber API key DeepSeek (env vs Credential Manager) — key **wajib** dari env sampai owner memutuskan.
- Apakah `WORKER_ENABLED` boleh default `false` di produksi sampai UI approval ada.
- OD-1…OD-7 tetap OPEN.
