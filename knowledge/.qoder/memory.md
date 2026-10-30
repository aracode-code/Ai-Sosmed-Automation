# Project Memory (L1)

> Memori permanen terverifikasi. Entri 1–14 bersumber `HLD.md`/`LLD.md` v1.0 (E5).
> Entri bagian "Keputusan yang Sudah Diambil" yang menyebut commit bersumber kode aktual (E1).

## Invariant Wajib

1. **`PUBLISHED` butuh bukti.** Status hanya diberikan setelah verifikasi hasil eksternal. `unknown` tidak sama dengan `failed`. — HLD §7.1, §7.3; LLD §4.2, §11.4
2. **Idempotency sebelum aksi eksternal.** Tandai `PUBLISHING` + simpan `idempotency_key` unik sebelum upload; simpan external post ID segera. — HLD §7.3; LLD §5.1, §11.4
3. **Operasi ambigu wajib direkonsiliasi sebelum diulang.** — HLD §7.2; LLD §15
4. **Satu profil browser = satu worker.** Job `PUBLISHING`/`VERIFYING` tidak boleh diulang tanpa reconciliation. — LLD §7.3
5. **Approval terikat pada** `contentId + version + assetSha256 + captionHash + accountId + platform`; perubahan salah satunya membatalkan approval. — LLD §12.1
6. **Transisi status lewat domain murni** `transitionJob(current, event)`; transisi ilegal ditolak dan dicatat. — LLD §4.2
7. **Transaksi SQLite tidak ditahan** selama browser, API AI, atau upload berjalan; gunakan lease + perpanjangan. — LLD §5.3
8. **Kredensial:** API key/OAuth token hanya di Credential Manager/DPAPI; DB menyimpan `secret_ref`; redaksi di log/error. — HLD §9.1; LLD §13.1
9. **Local API bind loopback**, validasi Origin, token sesi lokal, rate limit; path file divalidasi terhadap root storage. — HLD §9.2; LLD §13.2
10. **Tanpa penghindaran proteksi platform** (CAPTCHA, anti-bot, login challenge): worker berhenti dan status menjadi `NEEDS_ATTENTION`. — HLD §2.2; LLD §10.3, §15
11. **Scheduler persisten:** `next_run_at` disimpan; restart tidak mengacak ulang; pause menghentikan dispatch baru, bukan menghapus jadwal. — HLD §8; LLD §8.2
12. **Kegagalan satu platform tidak menggagalkan publication job lain.** — HLD §5; LLD §4.3
13. **Output AI = data tidak tepercaya** sampai lolos skema + policy; JSON invalid → retry terbatas → `NEEDS_ATTENTION`. — LLD §9.1, §9.3
14. **`capabilities()` harus jujur:** fitur belum terverifikasi = `unknown`/`unsupported`. — HLD §6; LLD §11.3

## Batasan Eksternal yang Menentukan Prioritas

- Google Flow tidak diasumsikan punya API publik; adapter = UI automation yang rapuh → isolasi adapter + smoke test + fallback manual. — HLD §6; LLD §10.4, §19.1
- Publikasi langsung tiap platform bergantung izin/aplikasi yang disetujui. Adapter hanya ditandai lulus setelah diuji pada akun berwenang. — LLD §17, §19

## Keputusan yang Sudah Diambil

- 2026-10-29 — Root canonical knowledge = `knowledge/`; `HLD.md`/`LLD.md` tetap di root repo sebagai sumber arsitektur canonical dan tidak disalin ke `knowledge/architecture/`, agar tidak ada dua salinan yang bisa drift.
- 2026-10-30 — (E1) Transisi status **tidak boleh** ditulis langsung: dispatcher hanya bisa lewat `HandlerContext.transition` yang memanggil `transitionJob`; `VERIFICATION_SUCCEEDED` tanpa `externalPostId`/`permalink` + `verifiedAt` ditolak.
- 2026-10-30 — (E1) Migrasi = `packages/database/migrations/*.sql` + tabel `schema_migrations`; `drizzle-kit generate` hanya menghasilkan SQL, jurnal `__drizzle_migrations` tidak dipakai.
- 2026-10-30 — (E1) Klaim antrean memakai transaksi `immediate()` + `UPDATE` terjaga kondisi lease; transaksi ditutup sebelum pekerjaan eksternal (sesuai invariant 7).
- 2026-10-30 — (E1) Script pnpm berjalan di direktori paket: `DATABASE_PATH` relatif wajib diresolusi terhadap root workspace (`packages/database/src/paths.ts`).
- 2026-10-30 — (E1) Output AI invalid setelah perbaikan terbatas memakai kelas `AI_OUTPUT_INVALID` → retry policy `escalate` → `NEEDS_ATTENTION`; `VALIDATION` tetap untuk input/payload invalid (→ `FAILED`). Aturan campaign (platform, capability `unsupported`, batas caption, approval `required`) ditegakkan di `checkPlanAgainstCampaign`/`enforceApproval`, bukan di prompt.
- 2026-10-30 — (E1) Tool AI hanya dapat dipanggil lewat `ToolRegistry` allowlist: Zod validasi input+output, budget 8 panggilan/run, timeout 10 s, nama shell/exec/eval/spawn ditolak; `ToolContext` tidak membawa secret.
- 2026-10-30 — (E1) Job langkah berakhir `COMPLETED` lewat event `STEP_COMPLETED`; `GENERATE_VIDEO` masuk `GENERATING` lewat `START_GENERATION` (QUEUED→GENERATING). Publication tetap hanya `PUBLISHED` dengan bukti.
- 2026-10-30 — (E1) Handler `PLAN_CONTENT` menyimpan konten id deterministik `cnt_<jobId>` dan meng-enqueue `GENERATE_VIDEO` idempotent; `needs_human` → `NEEDS_ATTENTION`, `wait` → `RETRY_WAIT` 6 jam, output AI invalid → `NEEDS_ATTENTION`.
- 2026-10-30 — (E1) Approval mengikat `contentId + version + assetSha256 + captionHash(JSON kanonik seluruh caption) + accountId + platform`; aset hanya dicek bila media sudah ada; `decidedBy` + `reason` diaudit.
- 2026-10-30 — (E1) Scheduler: `next_run_at` dihitung saat create/PATCH dan tidak diacak ulang saat restart; ujung quiet eksklusif; kuota dihitung per akun+platform per tanggal lokal dari `publish_attempts` dan skip tidak memajukan jadwal; pause disimpan di `settings` dan tidak menghapus jadwal.
- 2026-10-30 — (E1) Media: generator menulis di bawah `outputRoot` (relatif `content/<contentId>`); validasi containment + ukuran + magic `ftyp` + sha256 + probe opsional; probe absen tidak menggagalkan validasi; aset id `med_<contentId>`.
- 2026-10-30 — (E1) Lock profil = `.worker-lock.json` (`wx`, TTL 10 menit, pengambilalihan atomik, release hanya pemilik token) → `ProfileBusyError` kelas `RESOURCE_BUSY` (retry).
- 2026-10-30 — (E1) P3 saat ini **mock**: `MockVideoGenerator` menghasilkan artefak MP4-shaped deterministik, bukan video yang dapat diputar; Flow nyata menunggu OD-1.
- 2026-10-30 — (E1) Worker loop in-process di `@saa/workflow`: siklus tidak tumpang tindih, timer `unref`, error siklus ditelan + dicatat; satu worker per proses (`worker_<pid>`), satu job per siklus.
- 2026-10-30 — (E1) `apps/local-api/src/handlers.ts` adalah satu-satunya titik registrasi handler: `GENERATE_VIDEO` selalu (mock generator), `PLAN_CONTENT` hanya bila `DEEPSEEK_API_KEY` ada, `PUBLISH` hanya bila adapter disuntikkan; tanpa dependensi job → `NEEDS_ATTENTION` + `NO_HANDLER` (tanpa fallback diam-diam).
- 2026-10-30 — (E1) Kontrak publikasi `SocialAdapter` (`capabilities`/`validate`/`publish`/`getStatus`) tinggal di `@saa/domain`; `PublishAttempt` dicatat **sebelum** aksi eksternal dengan key `publish:<jobId>` unik dan status akhir hanya diambil dari `getStatus` — `processing`/`unknown` → `NEEDS_ATTENTION`, bukan `failed`.
- 2026-10-30 — (E1) `PUBLISH_STARTED` diterima dari `SCHEDULED` dan `QUEUED` (promosi retry selalu mengembalikan job ke `QUEUED`); retry publikasi lewat `PUBLISH_SUBMITTED → VERIFICATION_FAILED → RETRY_WAIT` dengan backoff, `maxAttempts` → `PERMANENT_FAILURE`.
- 2026-10-30 — (E1) Adapter YouTube memakai prefiks `mock_` dan `limitations` eksplisit; runtime hanya mendaftarkannya lewat opt-in `YOUTUBE_ADAPTER=mock` (default `off`) agar tidak pernah ada `PUBLISHED` palsu tanpa keputusan owner.
- 2026-10-30 — (E1) `DEEPSEEK_API_KEY` dibaca hanya lewat `loadAiCredentials` dari env dan sengaja **tidak** masuk `AppConfig`; `MEDIA_ROOT` tunggal dipakai sebagai `outputRoot` generator dan akar validasi; `/health` `workers.active` berasal dari `worker.isRunning`.
- 2026-10-30 — (E1) Dispatch jadwal = `ScheduleDispatchLoop` → `Scheduler.runOnce(createPublicationEnqueuer(...))`; engine scheduler tidak mengetahui isi job, enqueuer yang memutuskan kelayakan.
- 2026-10-30 — (E1) Satu job `PUBLISH` per `contentId + versi + accountId + platform`, kunci idempoten `publish:<contentId>:v<version>:<accountId>:<platform>`; hanya **konten terbaru** campaign aktif yang di-enqueue, sehingga draft lama tidak pernah terbit tak sengaja.
- 2026-10-30 — (E1) Syarat enqueue: campaign `active`, konten terbaru tidak `rejected`, aset `valid` terakhir ada, akun `connected` dan platform-nya sama dengan campaign **dan** punya adapter terdaftar, caption platform tersedia; mode approval `required` menuntut approval `approved` + binding terikat valid.
- 2026-10-30 — (E1) Tafsir caption satu platform dipusatkan di `resolveCaption` (`@saa/domain`), dipakai handler `PUBLISH` dan enqueuer — hash binding approval dijamin dihitung dari semantik yang sama.
- 2026-10-30 — (E1) Dispatch **tidak** berjalan bila `SCHEDULER_ENABLED=false`, worker nonaktif, atau tidak ada adapter publikasi; slot jadwal **tetap maju** walau tidak ada job terbuat (kontrak `EnqueueFn` tidak punya sinyal penundaan) — tercatat sebagai konsekuensi, bukan bug tersembunyi.
- 2026-10-30 — (E1) Produksi konten dipicu scheduler **per slot** (`enqueueDueContentPlan`), bukan saat pembuatan campaign; pipeline **kedalaman satu**: slot ditahan bila ada `PLAN_CONTENT` non-terminal (`NEEDS_ATTENTION` dihitung aktif) atau konten terbaru belum punya job `PUBLISH`.
- 2026-10-30 — (E1) Dalam satu tick publikasi dijalankan **lebih dulu**, lalu produksi; tanpa urutan ini konten baru yang belum punya media akan menahan publikasi slot berjalan.
- 2026-10-30 — (E1) Kunci idempoten produksi `plan:<scheduleId>:<slot>` dengan slot = `nextRunAt` saat due; guard memakai `hasActiveJobForCampaign`/`hasJobForContent` di `@saa/database`.
- 2026-10-30 — Detail keputusan: `knowledge/decisions/ADR-0001-p1-stack-baseline.md`, `knowledge/decisions/ADR-0002-p2-agent-core.md`, `knowledge/decisions/ADR-0003-workflow-p4-p3-mock.md`, `knowledge/decisions/ADR-0004-worker-loop-registry.md`, `knowledge/decisions/ADR-0005-youtube-mock-publish.md`, `knowledge/decisions/ADR-0006-schedule-publish-dispatch.md`, `knowledge/decisions/ADR-0007-content-production-per-slot.md`.
