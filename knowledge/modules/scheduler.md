# Modul — Scheduler (P4)

**Status:** COMPLETED (engine + API) 2026-10-30 · commit `4b513ab`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0003` D10–D14. Kontrak: LLD §8.1–8.3.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/scheduler/src/time.ts` | Konversi zona waktu tanpa dependensi: `localParts`, `formatLocalDate/Time`, `tzOffsetMs`, `localDateTimeToUtc` (iteratif), `addLocalDays` |
| `packages/scheduler/src/schedule.ts` | `withinWindow` (mendukung wrap), `pickDelayMinutes` (inklusif), `shiftIntoAllowedSlot` (maks. 6 iterasi), `computeNextRun` |
| `packages/scheduler/src/quota.ts` | `createDbQuotaGate`: hitung `publish_attempts` per `account + platform` dalam tanggal lokal schedule |
| `packages/scheduler/src/scheduler.ts` | `Scheduler.runOnce(enqueue)`, `pause`/`resume` via tabel `settings` |

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

## Semantik Waktu

- Window: ujung awal inklusif, ujung akhir inklusif; rentang yang melewati tengah malam didukung (`22:00–02:00`).
- Quiet hours: ujung akhir **eksklusif** — perbaikan bug; sebelumnya kandidat yang mendarat tepat di ujung quiet dianggap masih quiet sehingga shifter melompat satu hari per iterasi.
- `fixed` = `minMinutes`; `random`/`random_window` = integer inklusif `[minMinutes, maxMinutes]` dari `rng` yang disuntikkan.

## Kuota

- Dihitung per `account_id + platform` untuk campaign pada tanggal lokal schedule.
- Semua status `publish_attempts` dihitung (termasuk `failed`/`unknown`); pengecualian status belum ditetapkan — P5 mock belum mengubah aturan ini (ADR-0005 open item).

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
corepack pnpm vitest run packages/scheduler    # time, schedule, quota, scheduler
```

## Belum Ada

- Loop periodik yang memanggil `runOnce` (belum ada; worker loop `6ad9547` hanya mengambil job, belum memicu jadwal).
- `enqueue` nyata: job publikasi baru ada di P5; saat ini callback disediakan pemanggil.
- UI jadwal.
