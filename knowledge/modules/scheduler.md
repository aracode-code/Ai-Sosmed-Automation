# Modul — Scheduler (P4 engine + P4b dispatch)

**Status:** COMPLETED (engine + API + dispatch periodik) 2026-10-30 · commit `4b513ab`, `bfc7c72`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0003` D10–D14, `ADR-0006` S1–S9. Kontrak: LLD §8.1–8.3.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/scheduler/src/time.ts` | Konversi zona waktu tanpa dependensi: `localParts`, `formatLocalDate/Time`, `tzOffsetMs`, `localDateTimeToUtc` (iteratif), `addLocalDays` |
| `packages/scheduler/src/schedule.ts` | `withinWindow` (mendukung wrap), `pickDelayMinutes` (inklusif), `shiftIntoAllowedSlot` (maks. 6 iterasi), `computeNextRun` |
| `packages/scheduler/src/quota.ts` | `createDbQuotaGate`: hitung `publish_attempts` per `account + platform` dalam tanggal lokal schedule |
| `packages/scheduler/src/scheduler.ts` | `Scheduler.runOnce(enqueue)`, `pause`/`resume` via tabel `settings` |
| `packages/scheduler/src/dispatch.ts` | `enqueueDuePublicationJobs` + `createPublicationEnqueuer`: membuat job `PUBLISH` untuk konten siap (ADR-0006) |
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
- Semua status `publish_attempts` dihitung (termasuk `failed`/`unknown`); pengecualian status belum ditetapkan (ADR-0005 open item).
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
corepack pnpm vitest run packages/scheduler    # time, schedule, quota, scheduler, dispatch, loop
```

## Belum Ada

- Pembuatan konten otomatis (`PLAN_CONTENT` periodik / route konten); dispatch hanya bekerja pada konten yang sudah ada.
- UI jadwal.
- Job `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` terpisah.
- Peninjauan ulang semantik "slot hangus" bila konten belum siap (ADR-0006 S7).
