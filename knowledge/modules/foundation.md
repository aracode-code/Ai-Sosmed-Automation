# Modul — Foundation (P1)

**Status:** COMPLETED (2026-10-30) · commit `debdaaf`
**Sumber:** kode aktual (E1), bukan desain.

## Peta Paket

| Paket | Tanggung jawab | Titik masuk |
|---|---|---|
| `@saa/domain` | Tipe entitas, `JobType`/`JobStatus`, kelas error, state machine murni | `packages/domain/src/{job,state-machine,errors,entities,platform}.ts` |
| `@saa/database` | Schema Drizzle 12 tabel, client + PRAGMA, migrator SQL, repository | `packages/database/src/{schema,client,migrate,paths}.ts`, `repositories/{jobs,audit}.ts` |
| `@saa/workflow` | Dispatcher antrean, klasifikasi retry, recovery lease saat startup | `packages/workflow/src/{dispatcher,retry,recovery}.ts` |
| `@saa/observability` | Logger Pino + redaksi secret | `packages/observability/src/{logger,sanitize}.ts` |
| `@saa/local-api` | Konfigurasi env, Fastify app + route, entrypoint | `apps/local-api/src/{config,app,server}.ts`, `routes/{health,jobs}.ts` |

Arah dependensi: `domain` ← `database` ← `workflow` ← `local-api`; `observability` berdiri sendiri.

## Perilaku Penting

- **State machine** (`packages/domain/src/state-machine.ts`): `PUBLISHED` hanya lewat `VERIFICATION_SUCCEEDED` dengan bukti `externalPostId`/`permalink` + `verifiedAt`; `RETRYABLE_FAILURE` ditolak dari `PUBLISHING`/`VERIFYING`; `AMBIGUOUS_RESULT` → `NEEDS_ATTENTION`; `RECOVER_REQUEUE` hanya untuk status yang bisa diulang.
- **Migrator** (`packages/database/src/migrate.ts`): idempoten, satu baris `schema_migrations` per berkas, dijalankan dalam transaksi per berkas.
- **Klaim antrean** (`repositories/jobs.ts`): `claimDueJob` memakai `db.transaction(...).immediate()` + `UPDATE` terjaga kondisi lease sehingga hanya satu worker berhasil; transaksi ditutup sebelum pekerjaan eksternal.
- **Transisi optimistis**: `applyTransition({from,to})` gagal (null) bila status sudah berubah — mencegah dua worker menimpa.
- **Recovery startup** (`packages/workflow/src/recovery.ts`): lease kedaluwarsa → `QUEUED` bila reversibel, `NEEDS_ATTENTION` untuk `PUBLISHING`/`VERIFYING` atau attempts habis; `lastErrorCode = LEASE_EXPIRED`.
- **API**: `GET /health` + `/api/v1/health`, `GET /api/v1/jobs`, `GET /api/v1/jobs/:id`; envelope error LLD §6.2; request id `req_<uuid>`.
- **Konfigurasi**: host non-loopback ditolak kecuali `APP_ALLOW_NETWORK=true`; `DATABASE_PATH` relatif diresolusi terhadap root workspace (`paths.ts`).

## Perintah

```bash
corepack pnpm typecheck                              # 7 paket + tests/ (per 2026-10-30)
corepack pnpm test                                   # seluruh workspace (179 test per 2026-10-30)
corepack pnpm migrate                                 # terapkan migrations/*.sql
corepack pnpm start                                   # local API di 127.0.0.1:4317
```

> Catatan lingkungan: `pnpm` tidak ada di PATH; selalu panggil lewat `corepack pnpm` (lihat ADR-0001 D7 & `01_PROJECT.md`).

## Belum Ada (P2+)

Worker loop yang terus-menerus polling dan registrasi handler di `apps/local-api`, adapter platform, UI dashboard, Playwright, auth lokal, lint/build artefak. (Scheduler + handler PLAN_CONTENT/GENERATE_VIDEO sudah ada — lihat `modules/scheduler.md`, `modules/workflow.md`.)
