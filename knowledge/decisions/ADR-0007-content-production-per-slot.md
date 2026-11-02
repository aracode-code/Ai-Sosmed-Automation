# ADR-0007 — Produksi Konten per Slot (Pipeline Kedalaman Satu)

**Status:** Accepted (diputuskan agen di L1) — revisitable
**Tanggal:** 2026-10-30
**Konteks:** commit `77fbb9c` · SESSION-2026-10-30-5

> Label: milestone ini disebut **P4c** (turunan P4/P5). Bukan fase kanonik baru di LLD §18.

## Konteks

Setelah ADR-0006, jadwal due menghasilkan job `PUBLISH` untuk konten yang **sudah ada**. Tidak ada pemanggil yang membuat `PLAN_CONTENT`, sehingga campaign baru tidak pernah punya konten, dan campaign yang sudah punya satu konten hanya terbit sekali — slot berikutnya tidak melakukan apa pun (drift "slot hangus" pada ADR-0006). LLD §2.2 menempatkan permintaan planning pada pembuatan campaign, tetapi itu tetap hanya menghasilkan satu konten per campaign dan tidak menyambung ke cadence jadwal.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| C1 | Produksi konten dipicu **scheduler per slot**, satu `PLAN_CONTENT` per jadwal due | Cadence jadwal (interval + `dailyLimit`) adalah satu-satunya definisi "berapa posting per hari"; tidak perlu setting baru | Campaign butuh beberapa konten per slot |
| C2 | Pipeline **kedalaman satu**: slot ditahan bila (a) ada `PLAN_CONTENT` non-terminal untuk campaign, atau (b) konten terbaru belum punya job `PUBLISH` | Mencegah penumpukan konten (khususnya mode approval `required` yang menunggu manusia) dan menjaga ADR-0006 S3 tetap konsisten karena hanya ada satu konten "terbaru" yang belum terbit | Owner ingin antrean konten lebih dalam |
| C3 | Idempotency key `plan:<scheduleId>:<slot>` dengan `slot = schedule.nextRunAt` | Tick berulang pada jam yang sama dan restart tidak menggandakan perencanaan; jadwal berbeda untuk campaign yang sama tidak saling menahan | Perlu lebih dari satu konten per slot |
| C4 | Dalam satu tick, **publikasi dijalankan lebih dulu**, lalu produksi | Konten yang siap pada slot ini tidak boleh tertahan oleh perencanaan konten berikutnya; setelah job `PUBLISH` dibuat, guard C2 mengizinkan produksi berikutnya | — |
| C5 | Produksi hanya didaftarkan bila planner tersedia (`PLAN_CONTENT` handler terdaftar) | Tanpa planner, job hanya akan berakhir `NO_HANDLER`; log peringatan eksplisit saat startup — **diperbarui** oleh ADR-0011 A5 (2026-11-02): handler selalu terdaftar, enqueue produksi digerbangi `aiCredentials.isConfigured()` | — |
| C6 | Guard memakai helper repo `hasActiveJobForCampaign` + `hasJobForContent`; `NEEDS_ATTENTION` dihitung **aktif** | Pekerjaan yang menunggu manusia tidak boleh ditumpuk job baru secara diam-diam | Kebijakan eskalasi berubah |
| C7 | Campaign harus `active` dan punya platform target | Campaign non-aktif tidak boleh memproduksi konten | — |

## Konsekuensi

- Rantai otomatis penuh: campaign aktif + jadwal → slot 1 membuat konten → `GENERATE_VIDEO` → media → slot 2 menerbitkan konten itu **dan** merencanakan konten berikutnya → berulang.
- Konten baru diproduksi satu interval sebelum publikasinya, sehingga tidak ada penumpukan dan approval manusia tetap punya waktu.
- **Stall yang disadari:** jika publikasi konten terbaru macet permanen (mis. media invalid), produksi berhenti sampai job itu diselesaikan manusia — sinyalnya terlihat sebagai job `NEEDS_ATTENTION`/`FAILED`, bukan antrean yang membengkak diam-diam.
- Mode approval `required` menahan produksi berikutnya sampai approval diberikan; slot yang terlewat hangus (kontrak `EnqueueFn`, ADR-0006 S7).
- Tidak ada perubahan schema DB, route API, atau konfigurasi baru.

## Bukti

| Bukti | Hasil |
|---|---|
| Typecheck | 9 paket + `tests/tsconfig.json` PASS |
| Test suite | 34 file, **235 passed / 0 failed** |
| Test baru | `packages/scheduler/src/production.test.ts` (6), `apps/local-api/src/content-production.test.ts` (1 integrasi dua slot) |
| Smoke boot | `YOUTUBE_ADAPTER=mock` tanpa `DEEPSEEK_API_KEY`, port 4395 → `handlers:["GENERATE_VIDEO","PUBLISH"]`, `worker dimulai`, `planner tidak aktif; produksi konten otomatis tidak dijalankan`, `dispatch jadwal dimulai`, `/health` `{workers:{active:1}}`; proses dihentikan, port bebas |
| Jaringan | Tidak ada panggilan DeepSeek/YouTube nyata; tidak ada kredensial diset saat smoke |

## Open Items (jangan diisi tanpa keputusan)

- Kebijakan bila publikasi macet permanen: saat ini produksi ikut berhenti (C2) — perlu keputusan apakah konten baru tetap dibuat.
- Jumlah konten per slot > 1 dan kedalaman antrean konten belum didukung (C2/C3).
- Produksi tidak berjalan bila adapter publikasi tidak terdaftar, karena loop dispatch digerbangi adapter (ADR-0006 S8).
- Adapter DeepSeek masih UNVERIFIED; produksi baru terbukti dengan planner stub.
