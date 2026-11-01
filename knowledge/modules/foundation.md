# Modul — Foundation (P1)

**Status:** COMPLETED (2026-10-30) · commit `debdaaf`
**Sumber:** kode aktual (E1), bukan desain.

## Peta Paket

| Paket | Tanggung jawab | Titik masuk |
|---|---|---|
| `@saa/domain` | Tipe entitas, `JobType`/`JobStatus`, kelas error, state machine murni | `packages/domain/src/{job,state-machine,errors,entities,platform}.ts` |
| `@saa/database` | Schema Drizzle 12 tabel, client + PRAGMA, migrator SQL, repository | `packages/database/src/{schema,client,migrate,paths}.ts`, `repositories/{jobs,audit,approvals,publish-attempts}.ts` |
| `@saa/youtube` | Adapter publikasi YouTube (mock) yang mengimplementasikan kontrak domain | `packages/youtube/src/mock-adapter.ts` (rinci di `modules/youtube.md`) |
| `@saa/workflow` | Dispatcher antrean, klasifikasi retry, recovery lease saat startup | `packages/workflow/src/{dispatcher,retry,recovery}.ts` |
| `@saa/observability` | Logger Pino + redaksi secret | `packages/observability/src/{logger,sanitize}.ts` |
| `@saa/local-api` | Konfigurasi env, Fastify app + route, composition root (registry + dispatcher + worker) | `apps/local-api/src/{config,app,handlers,server}.ts`, `routes/*.ts` (rinci di `modules/local-api.md`) |

Arah dependensi: `domain` ← `database` ← `workflow` ← `local-api`; `observability` berdiri sendiri.

## Perilaku Penting

- **State machine** (`packages/domain/src/state-machine.ts`): `PUBLISHED` hanya lewat `VERIFICATION_SUCCEEDED` dengan bukti `externalPostId`/`permalink` + `verifiedAt`; `RETRYABLE_FAILURE` ditolak dari `PUBLISHING`/`VERIFYING`; `AMBIGUOUS_RESULT` → `NEEDS_ATTENTION`; `RECOVER_REQUEUE` hanya untuk status yang bisa diulang; `PUBLISH_STARTED` diterima dari `SCHEDULED` **dan** `QUEUED` (ADR-0005 Y4).
- **Migrator** (`packages/database/src/migrate.ts`): idempoten, satu baris `schema_migrations` per berkas, dijalankan dalam transaksi per berkas.
- **Klaim antrean** (`repositories/jobs.ts`): `claimDueJob` memakai `db.transaction(...).immediate()` + `UPDATE` terjaga kondisi lease sehingga hanya satu worker berhasil; transaksi ditutup sebelum pekerjaan eksternal.
- **Transisi optimistis**: `applyTransition({from,to})` gagal (null) bila status sudah berubah — mencegah dua worker menimpa.
- **Recovery startup** (`packages/workflow/src/recovery.ts`): lease kedaluwarsa → `QUEUED` bila reversibel, `NEEDS_ATTENTION` untuk `PUBLISHING`/`VERIFYING` atau attempts habis; `lastErrorCode = LEASE_EXPIRED`.
- **API**: 19 route terdaftar (health, jobs, campaigns, approvals, schedules, accounts, content — daftar lengkap di `modules/local-api.md`); envelope error LLD §6.2; request id `req_<uuid>`.
- **Konfigurasi**: host non-loopback ditolak kecuali `APP_ALLOW_NETWORK=true`; `DATABASE_PATH` relatif diresolusi terhadap root workspace (`paths.ts`).

## Perintah

```bash
corepack pnpm typecheck                              # 9 paket + tests/ (per 2026-10-30)
corepack pnpm test                                   # seluruh workspace (235 test per 2026-10-30)
corepack pnpm migrate                                 # terapkan migrations/*.sql
corepack pnpm start                                   # local API di 127.0.0.1:4317
```

> Catatan lingkungan: `pnpm` tidak ada di PATH; selalu panggil lewat `corepack pnpm` (lihat ADR-0001 D7 & `01_PROJECT.md`).

## Belum Ada (P2+)

Adapter platform, UI dashboard/approval, Playwright Flow nyata, auth lokal, lint/build artefak. Worker loop + registrasi handler sudah ada (`6ad9547`); handler `PUBLISH` + adapter YouTube mock ada (`7d13431`) tetapi upload nyata UNVERIFIED dan job publikasi belum dibuat otomatis.
