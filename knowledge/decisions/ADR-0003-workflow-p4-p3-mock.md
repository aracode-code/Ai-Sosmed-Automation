# ADR-0003 — Wiring PLAN_CONTENT, Approval/Scheduler, dan P3 Mock

**Status:** Accepted (diputuskan agen di L1) — revisitable
**Tanggal:** 2026-10-30
**Konteks:** commit `826a732` (wiring planner), `4b513ab` (P4 approval + scheduler), `013531a` + `b8c85e0` (P3 mock)

## Konteks

P2 membekukan kontrak planner tetapi belum menyambungkannya ke dispatcher (ADR-0002 D9). Setelah itu tiga langkah dikerjakan berurutan atas instruksi owner ("jalankan ketiganya"), dengan satu commit per fase terverifikasi dan tanpa menyentuh OD-1…OD-7.

## Keputusan

### A. Workflow job per langkah (`826a732`)

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| D1 | Job langkah (PLAN_CONTENT, GENERATE_VIDEO, …) berakhir `COMPLETED` lewat event baru `STEP_COMPLETED`; publication tetap berakhir `PUBLISHED` | LLD §4.1: satu job = satu langkah; `COMPLETED` sudah ada di daftar status tetapi belum punya jalur transisi | Alur langkah diubah |
| D2 | Target platform campaign dipersistensi sebagai `campaigns.platforms_json` (migrasi `0001`) | Planner butuh daftar platform; kolom tunggal menghindari tabel relasi baru untuk data kecil | Butuh query per platform |
| D3 | `createPlanContentHandler` menerima interface `Planner`, bukan adapter vendor; `capabilities`/`availableAssets` disuntikkan pemanggil dan default = kosong (`unknown`) | Arah dependensi LLD §3; capability default jujur (ADR-0002 D8) | — |
| D4 | Keputusan planner dipetakan: `needs_human` → `ESCALATE` (`PLANNER_NEEDS_HUMAN`); `wait` → `RETRY_WAIT` 6 jam (`PLANNER_WAIT`); `revise_metadata` di langkah ini = `PlannerOutputError` | LLD §9.1/§9.3; `wait` bukan kegagalan | Jeda `wait` perlu dinamis |
| D5 | Konten disimpan dengan id deterministik `cnt_<jobId>`; job anak `GENERATE_VIDEO` di-enqueue lewat `insertJobIdempotent` (`generate:<contentId>`) | Replay handler setelah crash tidak boleh menggandakan konten/job | — |
| D6 | `approvalStatus` konten = `pending` bila planner menyatakan approval wajib, `not_required` bila tidak; campaign `required` tetap dipaksa planner (ADR-0002 D4) | Approval tidak boleh diturunkan model | — |

### B. P4 Approval & Scheduler (`4b513ab`)

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| D7 | Approval terikat `contentId + contentVersion + assetSha256 + captionHash + accountId + platform`; pelanggaran → `409 APPROVAL_MISMATCH` (`400 PLATFORM_MISMATCH` untuk platform akun yang salah) | LLD §12.1 | — |
| D8 | `captionHash` = sha256 dari JSON kanonik (`stableStringify` urut kunci) seluruh peta caption konten; `assetSha256` dicek hanya bila konten sudah punya media (harus cocok salah satu aset) | Hash harus stabil lintas serialisasi; approval sebelum generate tidak boleh mustahil | Caption per platform di-hash terpisah |
| D9 | Approval menyimpan `reason` (migrasi `0002`) dan audit `content.approve` / `content.reject` | Penolakan harus dapat diaudit | — |
| D10 | Scheduler menyimpan `next_run_at`, `quiet_start`, `quiet_end` + indeks `(enabled, next_run_at)`; `next_run_at` dihitung saat create/PATCH dan **tidak** diacak ulang saat restart | HLD §8 / LLD §8.2 (persisten) | — |
| D11 | Jendela/quiet memakai zona campaign (`Asia/Jakarta` default); ujung quiet **eksklusif**, ujung window inklusif | Bug ditemukan di test: ujung quiet inklusif membuat shifter melompat satu hari per iterasi | — |
| D12 | Quota dihitung per `account + platform + tanggal lokal` dari `publish_attempts`; terlampaui → skip **tanpa** memajukan `next_run_at` | Kuota harus terlihat setiap tick, bukan hilang setelah satu skip | P5 menetapkan status attempt yang dihitung |
| D13 | Pause disimpan di tabel `settings` (`scheduler.paused`) dan menghentikan dispatch baru; jadwal tidak dihapus | LLD §8.3; pause bukan delete | — |
| D14 | Scheduler menerima callback `enqueue` eksplisit; paket **tidak** membuat job publikasi sendiri | Job publikasi belum ada sampai P5; efek samping harus eksplisit | P5 menyambungkan worker loop |
| D15 | API baru: campaign create/list/detail, approve/reject, schedule create/list/PATCH, scheduler pause/resume, accounts (tanpa `secretRef`/`profileKey`) | P4 butuh jalur CRUD minimum; data sensitif tidak diekspos | UI approval (belum dibuat) |

### C. P3 Mock Flow (`013531a`, `b8c85e0`)

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| D16 | Paket `@saa/browser-engine` memakai kontrak `VideoGenerator` (LLD §10.1) dengan implementasi `MockVideoGenerator`; Flow asli tetap tertahan OD-1 | P3 penuh butuh keputusan owner soal akses/kebijakan Flow | OD-1 dijawab |
| D17 | Mock menghasilkan artefak deterministik: MP4 `ftyp` + `mdat` dari sha256 `${aspectRatio}|${prompt}|${correlationId}`; durasi 8–20 s; nama berkas memuat sidik permintaan | Pipeline validasi/checksum/idempotensi bisa diuji tanpa jaringan; prompt baru tidak menimpa artefak lama | Adapter nyata tersedia |
| D18 | Semua path media wajib berada di `outputRoot` (containment, case-insensitive di Windows) | LLD §13.2 (path divalidasi terhadap root storage) | — |
| D19 | `validateMediaFile`: ukuran 1 KB–512 MB, magic `ftyp` di offset 4, sha256 streaming dibandingkan dengan checksum generator, probe opsional; kegagalan = `VALIDATION` | Media harus terverifikasi sebelum dicatat sebagai aset | Batas ukuran berubah |
| D20 | Probe ffprobe tidak melempar error: biner absen/gagal → `{available:false}` dan pipeline lanjut tanpa durasi terukur | Degradasi wajib (X-16), bukan blocker | ffprobe diwajibkan |
| D21 | Lock profil berbasis `.worker-lock.json` (`wx`), TTL 10 menit, pengambilalihan lock kedaluwarsa/rusak lewat rename atomik, pelepasan hanya oleh pemilik token; konflik → `ProfileBusyError` kelas `RESOURCE_BUSY` | LLD §7.3 "satu profil = satu worker"; worker mati tidak boleh memblokir selamanya | Multi-profil paralel |
| D22 | Handler `GENERATE_VIDEO`: `START_GENERATION` (QUEUED→GENERATING) → cek availability → generate → validasi → `upsertMediaAsset` id `med_<contentId>` → `STEP_COMPLETED` | Satu job satu langkah; asset id deterministik membuat replay aman | Konten multi-aset |
| D23 | Generator tidak tersedia → `RESOURCE_BUSY` → retry (`RETRY_WAIT`); media invalid → `VALIDATION` → `FAILED` | Ketersediaan bersifat sementara; artefak rusak adalah kegagalan permanen sampai ada perubahan | — |
| D24 | Durasi yang disimpan = hasil probe; bila probe absen dipakai durasi yang dilaporkan generator (tidak ditandai di schema DB) | Tidak menambah kolom untuk data yang belum dipakai | P5 butuh pembeda |

## Konsekuensi

- Paket workspace menjadi 7 (`+@saa/scheduler`, `+@saa/browser-engine`) + `apps/local-api`; `@saa/workflow` kini bergantung pada `@saa/browser-engine`.
- `RESOURCE_BUSY` adalah kelas error tambahan di luar tabel LLD §15 (default retry).
- Handler belum terdaftar di proses mana pun: `apps/local-api` belum menjalankan worker loop; scheduler belum dijalankan periodik.
- Approval UI belum ada; API approval dipakai lewat HTTP langsung.
- Draft konten multi-aset tidak didukung (satu aset per konten, id deterministik).

## Tidak Diputuskan di Sini

- OD-1…OD-7 tetap **OPEN** di `tasks/BACKLOG.md`.
- Status `publish_attempts` yang dihitung kuota ditetapkan di P5.
- Sumber API key DeepSeek tetap terbuka (ADR-0002 D10).
