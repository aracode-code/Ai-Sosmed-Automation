# Modul — Scheduler (P4 engine + P4b dispatch + P4c produksi)

**Status:** COMPLETED (engine + API + dispatch + produksi konten) 2026-10-30 · commit `4b513ab`, `bfc7c72`, `77fbb9c`, `5af62ca`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0003` D10–D14, `ADR-0006` S1–S9, `ADR-0007` C1–C7. Kontrak: LLD §8.1–8.3.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/scheduler/src/time.ts` | Konversi zona waktu tanpa dependensi: `localParts`, `formatLocalDate/Time`, `tzOffsetMs`, `localDateTimeToUtc` (iteratif), `addLocalDays` |
| `packages/scheduler/src/schedule.ts` | `withinWindow` (mendukung wrap), `pickDelayMinutes` (inklusif), `shiftIntoAllowedSlot` (maks. 6 iterasi), `computeNextRun` |
| `packages/scheduler/src/quota.ts` | `createDbQuotaGate`: hitung `publish_attempts` per `account + platform` dalam tanggal lokal schedule, mengecualikan attempt pra-unggah |
| `packages/scheduler/src/scheduler.ts` | `Scheduler.runOnce(enqueue)`, `pause`/`resume` via tabel `settings` |
| `packages/scheduler/src/dispatch.ts` | `enqueueDuePublicationJobs` + `createPublicationEnqueuer`: membuat job `PUBLISH` untuk konten siap (ADR-0006) |
| `packages/scheduler/src/production.ts` | `enqueueDueContentPlan` + `createContentProductionEnqueuer`: membuat job `PLAN_CONTENT` per slot dengan pipeline kedalaman satu (ADR-0007) |
| `packages/scheduler/src/dispatch-loop.ts` | `ScheduleDispatchLoop`: tick periodik pemanggil `runOnce` (timer `unref`, tick tidak tumpang tindih) |

Dependensi: `@saa/database`, `@saa/domain`. Tidak mengimpor `workflow`.

## Alur `runOnce`

1. Paused (`settings['scheduler.paused']`) → berhenti, `{paused:true}`.
2. `listDueSchedules(now)` = `enabled = 1` dan `next_run_at <= now`.
3. `next_run_at` null → seed `computeNextRun` (dihitung sekali; restart tidak mengacak ulang).
4. Kandidat di luar window/quiet → `shiftIntoAllowedSlot` dan simpan hasilnya (`shifted`).
5. Kuota habis → skip **tanpa** memajukan `next_run_at` (dicoba lagi tick berikutnya).
6. `enqueue(schedule, {now, localDate})` melempar → dicatat `{scheduleId, errorClass}`, `next_run_at` tidak maju.
7. Sukses → `next_run_at = computeNextRun(now)`.

Ringkasan hasil: `{paused, due, seeded, shifted, quotaSkipped, enqueued, failed[]}`.

## Dispatch Publikasi (P4b)

`createPublicationEnqueuer({ db, platforms })` mengembalikan `EnqueueFn`. Untuk setiap jadwal due:

1. `platforms` kosong → tidak ada job (tanpa adapter, job hanya akan `NO_HANDLER`).
2. Campaign harus ada dan `status === 'active'`.
3. Ambil **konten terbaru** campaign (`listContentByCampaign`, urut versi turun); `rejected` → berhenti.
4. Butuh aset media `valid` terakhir; tanpa itu → berhenti.
5. Akun kandidat = akun `connected` pada platform campaign yang adapter-nya terdaftar.
6. Per akun: caption platform wajib ada (`resolveCaption`); mode `required` wajib `approvalStatus === 'approved'` **dan** `getLatestApproval` + `checkApprovalBinding` cocok (caption hash dihitung dari peta caption yang sama).
7. Key idempoten `publish:<contentId>:v<version>:<accountId>:<platform>`; job yang sudah ada dilewati.
8. Job dibuat `QUEUED`, payload `{contentId, campaignId, accountId, platform}` — kontrak handler `PUBLISH`.

Konsekuensi yang disadari: hanya konten terbaru, satu batch per slot, slot tetap maju walau tidak ada job (ADR-0006 S3/S7).

## Produksi Konten per Slot (P4c)

`createContentProductionEnqueuer({ db })` mengembalikan `EnqueueFn` yang membuat satu job `PLAN_CONTENT` per slot bila pipeline kosong:

1. Campaign harus ada, `status === 'active'`, dan punya platform target.
2. Ada `PLAN_CONTENT` non-terminal untuk campaign (`NEEDS_ATTENTION` dihitung aktif) → tidak ada job baru.
3. Konten terbaru ada tetapi belum punya job `PUBLISH` → tidak ada job baru (kedalaman satu).
4. Selain itu: job `PLAN_CONTENT` `QUEUED` dibuat dengan key `plan:<scheduleId>:<slot>`, payload `{campaignId}`.

`slot` = `schedule.nextRunAt` saat jadwal due (fallback `context.now`). Helper `hasActiveJobForCampaign`/`hasJobForContent` tinggal di `@saa/database`.

**Urutan dalam satu tick:** publikasi lebih dulu, lalu produksi. Tanpa urutan ini, konten yang baru direncanakan (belum punya media) akan menahan publikasi slot berjalan.

Hasil berantai: slot 1 merencanakan konten → worker membuat konten + `GENERATE_VIDEO` → media valid → slot 2 menerbitkan konten itu **dan** merencanakan konten berikutnya.

## Loop Dispatch

`ScheduleDispatchLoop` (`dispatch-loop.ts`):

- `start()` → tick segera + interval `intervalMs` (default 5 000), `unref`.
- Tick dilewati bila tick sebelumnya masih berjalan (satu dispatch per proses).
- `stop()` → clear timer lalu menunggu tick berjalan selesai (dipanggil sebelum `worker.stop()`).
- Log: `scheduler: job publikasi dibuat` (info, bila `enqueued > 0`), `scheduler: dispatch gagal` (warn), `scheduler: siklus gagal` (error dengan kelas error).

## Semantik Waktu

- Window: ujung awal inklusif, ujung akhir inklusif; rentang yang melewati tengah malam didukung (`22:00–02:00`).
- Quiet hours: ujung akhir **eksklusif** — perbaikan bug; sebelumnya kandidat yang mendarat tepat di ujung quiet dianggap masih quiet sehingga shifter melompat satu hari per iterasi.
- `fixed` = `minMinutes`; `random`/`random_window` = integer inklusif `[minMinutes, maxMinutes]` dari `rng` yang disuntikkan.

## Kuota

- Dihitung per `account_id + platform` untuk campaign pada tanggal lokal schedule.
- Attempt dengan `error_code` `PUBLISH_VALIDATION`, `VALIDATION`, atau `DISK` **tidak** dihitung: ketiganya membuktikan tidak ada byte yang dikirim ke YouTube. Semua kode lain (AUTH, kuota, 5xx, `unknown`, sukses) tetap dihitung karena unggahan mungkin sudah terjadi — lebih aman melebihkan hitungan daripada melanggar batas harian YouTube.
- Kuota tidak menghitung job yang baru diantrekan; jeda antar-slot dan worker aktif diandalkan agar attempt tercipta sebelum slot berikutnya.

## API Terkait (apps/local-api)

| Endpoint | Perilaku |
|---|---|
| `POST /api/v1/schedules` | 201; `next_run_at` dihitung dari `now` yang disuntikkan |
| `GET /api/v1/schedules?campaignId=` | Daftar jadwal |
| `PATCH /api/v1/schedules/:id` | Hitung ulang `next_run_at`; `enabled=false` → `next_run_at = null` |
| `POST /api/v1/scheduler/pause` · `/resume` | Persisten di `settings` |

## Perintah

```bash
corepack pnpm --filter @saa/scheduler typecheck
corepack pnpm vitest run packages/scheduler    # time, schedule, quota, scheduler, dispatch, production, loop
```

## Belum Ada

- UI jadwal.
- Job `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` terpisah.
- Peninjauan ulang semantik "slot hangus" bila konten belum siap (ADR-0006 S7).
- Lebih dari satu konten per slot / antrean konten lebih dalam (ADR-0007 C2/C3).
- Kebijakan bila publikasi macet permanen: produksi saat ini ikut berhenti (ADR-0007 open item).
