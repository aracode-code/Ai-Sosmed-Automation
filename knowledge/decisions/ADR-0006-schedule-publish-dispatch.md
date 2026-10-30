# ADR-0006 — Dispatch Jadwal Periodik dan Pembuatan Job PUBLISH Otomatis

**Status:** Accepted (diputuskan agen di L1) — revisitable
**Tanggal:** 2026-10-30
**Konteks:** commit `bfc7c72` · SESSION-2026-10-30-4

> Label: milestone ini disebut **P4b** (turunan P4/P5). Prefiks commit `feat(p6)` adalah label sesi saat penulisan dan **bukan** fase P6 kanonik (P6 = adapter platform lain, LLD §18).

## Konteks

P4 membangun engine scheduler (`Scheduler.runOnce`) dan API jadwal, tetapi tidak ada proses yang memanggilnya, dan tidak ada pemanggil yang membuat job `PUBLISH`. Akibatnya publikasi hanya bisa terjadi lewat penyisipan job manual, sehingga P4/P5 belum tersambung. Owner memilih opsi **(a) dispatch jadwal periodik + pembuatan job `PUBLISH` otomatis**.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| S1 | Loop `ScheduleDispatchLoop` di `@saa/scheduler` memanggil `Scheduler.runOnce(enqueue)` per interval (`SCHEDULER_INTERVAL_MS`, default 5 000 ms); timer `unref`, tick tidak tumpang tindih, `stop()` menunggu tick berjalan | Pola sama dengan `Worker` (ADR-0004 W1–W3); `Scheduler` tetap murni, loop hanya penggerak waktu | Scheduler perlu berjalan di proses terpisah |
| S2 | Job `PUBLISH` dibuat oleh `createPublicationEnqueuer` (paket scheduler), bukan oleh handler `GENERATE_VIDEO` | LLD §8 menempatkan enqueue publikasi di scheduler; handler tetap satu langkah | Publikasi harus dibuat segera setelah approval |
| S3 | Hanya **konten terbaru** campaign yang dipertimbangkan; konten `rejected` diabaikan seluruhnya | Konten ditolak/superseded tidak boleh tayang; tidak memilih versi lama secara diam-diam | Campaign butuh antrean banyak konten siap |
| S4 | Syarat siap per target: media `valid`, caption platform ada, akun `connected`, dan pada mode `required` approval ada + binding (6 elemen) sah | Job yang pasti gagal tidak boleh masuk antrean | Aturan siap berubah |
| S5 | Idempotency key job = `publish:<contentId>:v<version>:<accountId>:<platform>`; job yang sudah ada tidak dibuat/dihitung ulang | Tick berulang dan restart tidak menggandakan publikasi | Perlu publikasi ulang konten yang sama |
| S6 | Hanya platform yang adapter publikasinya terdaftar yang di-enqueue (`platforms` dari composition root) | Tanpa adapter job hanya berakhir `NO_HANDLER` | Adapter platform lain ditambahkan |
| S7 | Slot jadwal tetap maju walau tidak ada job dibuat; kontrak `EnqueueFn` (array id job) tidak diubah | Menjaga kontrak + test P4 dan menghindari polling 1 detik saat approval belum datang | Owner ingin slot dipertahankan untuk approval yang terlambat |
| S8 | Dispatch hanya berjalan bila `SCHEDULER_ENABLED=true`, adapter publikasi aktif, dan worker aktif; selain itu log peringatan eksplisit | Mencegah antrean menumpuk saat worker mati atau tidak ada adapter | — |
| S9 | `resolveCaption` dipindah ke `@saa/domain` dan dipakai handler `PUBLISH` + enqueuer | Satu interpretasi caption; `captionHash` approval dihitung dari caption yang sama | — |

## Konsekuensi

- Alur runtime lengkap: jadwal due → job `PUBLISH` `QUEUED` → worker → `PUBLISHED` (adapter mock) dengan attempt + audit, terverifikasi lewat test integrasi dan smoke boot.
- Scheduler kini punya dua peran: menjaga `next_run_at` (P4) dan memutuskan target publikasi yang layak (P4b).
- **Konten belum dibuat otomatis**: tidak ada pembuat job `PLAN_CONTENT` maupun route konten, sehingga dispatch hanya bekerja pada konten yang sudah ada (drift).
- **Slot bisa hangus**: bila konten belum siap saat jadwal due, jadwal tetap maju ke slot berikutnya (S7).
- Satu konten per campaign per slot; publikasi ke beberapa akun/platform terjadi serentak dalam satu slot.
- Kuota harian tetap dihitung dari `publish_attempts`, bukan dari job yang diantrekan.

## Bukti

| Bukti | Hasil |
|---|---|
| Typecheck | 9 paket + `tests/tsconfig.json` PASS |
| Test suite | 32 file, **228 passed / 0 failed** |
| Test baru | `packages/scheduler/src/dispatch.test.ts` (9), `dispatch-loop.test.ts` (4), `apps/local-api/src/scheduler-dispatch.test.ts` (2), config +1 |
| Smoke boot (mock) | port 4393, DB benih berisi campaign/konten/media/akun/jadwal due → log `dispatch jadwal dimulai` + `scheduler: job publikasi dibuat` (`enqueued:1`); `GET /api/v1/jobs` → `PUBLISH` `PUBLISHED`; proses dihentikan, port bebas |
| Smoke boot (default off) | port 4394 tanpa `YOUTUBE_ADAPTER` → log `handlers:["GENERATE_VIDEO"]` + `adapter publikasi belum aktif; dispatch jadwal tidak dijalankan`; proses dihentikan, port bebas |
| Jaringan | Tidak ada panggilan YouTube/DeepSeek nyata; tidak ada kredensial diset saat smoke |

## Open Items (jangan diisi tanpa keputusan)

- Pembuatan konten otomatis (job `PLAN_CONTENT` periodik atau route konten) belum ada.
- Semantik slot saat konten belum siap (S7) dapat ditinjau ulang.
- Status `publish_attempts` yang dihitung kuota harian belum ditetapkan (ADR-0005 open item tetap).
- ~~Adapter YouTube nyata tetap terkunci sampai OD-2/OD-5.~~ **Diperbarui 2026-10-30:** OD-2/OD-5 untuk YouTube sudah dijawab di `ADR-0008`; adapter nyata belum diimplementasikan.
