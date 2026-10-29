# CURRENT — Task Aktif

**Session:** SESSION-2026-10-29-1
**Updated:** 2026-10-29T23:52:00+07:00
**Change class:** LARGE (greenfield foundation: > 8 file baru, menyentuh DB/API)

## Active Task

| Field | Nilai |
|---|---|
| Task | **P1 — Foundation** |
| Status | **PLANNED** — menunggu persetujuan gate (G5: dependensi baru) |
| Mode eksekusi | SINGLE-WRITER sequential (justifikasi di bawah) |
| DoD | Migrasi DB jalan di DB kosong · unit + integration test hijau · `GET /health` 200 · restart recovery terverifikasi (LLD §18) |

## DAG P1

```text
S1 scaffold ──► S2 domain ──► S3 database ──► S4 workflow ──► S6 local-api ──► S7 integration ──► S8 sync
                                   │                             ▲
                                   └────────► S5 observability ───┘
```

Tidak ada slice yang boleh dimulai sebelum slice prasyaratnya hijau (typecheck + test).

| Slice | Isi | Exit criteria |
|---|---|---|
| S1 Scaffold | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.nvmrc`, `engines`, 5 `tsconfig` package | `pnpm -r typecheck` jalan tanpa error |
| S2 Domain | entitas, `PlatformId`, `JobType`/`JobStatus`, error class, `transitionJob(current, event)` | unit test transisi legal/ilegal hijau |
| S3 Database | Drizzle schema 12 tabel, migrasi `0001_init.sql`, client + PRAGMA (WAL, foreign_keys), repo `jobs`/`audit` | migrasi di DB kosong + repository test hijau |
| S4 Workflow | claim atomik (BEGIN IMMEDIATE), lease + perpanjangan, recovery lease kedaluwarsa, classifier retry, dispatcher + registry handler | test 2 worker tidak bisa claim job sama · lease recovery hijau |
| S5 Observability | Pino + redaksi token/cookie/header + correlation id | test redaksi hijau |
| S6 Local API | config Zod dari env, Fastify bind `127.0.0.1:4317`, `GET /health`, `GET /jobs`, `GET /jobs/:id`, graceful shutdown | `inject('/health')` 200 + shape sesuai LLD §6 |
| S7 Integration | restart recovery, migrasi di DB kosong, error envelope | 4 test integration hijau |
| S8 Sync | update `01_PROJECT`/`state`/`index-state`, ADR-0001 stack, targeted index | drift NONE, index bukan UNAVAILABLE lagi |

## Impact Map

- **Kode existing terdampak:** tidak ada (greenfield). Semua file baru, tidak ada file HLD/LLD yang diubah.
- **DB:** database baru `data/database/app.sqlite` (gitignored); 12 tabel LLD §5.1.
- **API:** route baru `/api/v1/health`, `/api/v1/jobs`, `/api/v1/jobs/:id`.
- **Dokumentasi:** `knowledge/01_PROJECT.md` (status fase), `decisions/ADR-0001`, `tasks/*`, `logs/`.
- **Index:** dibangun ulang setelah S3 ada file sumber.
- **Security:** redaksi log, loopback bind, Zod di semua boundary, tidak ada shell tool.

## Justifikasi SINGLE-WRITER

Semua slice berbagi schema/tipe domain yang sama dan dibuat dari nol; memecah ke gelombang paralel akan menciptakan seam tanpa manfaat dan melanggar §10.12. Dicatat sebagai **SINGLE-WRITER JUSTIFIED** (§10.14). Satu penulis = LEAD.

## Dependensi Baru (GATE G5 — butuh persetujuan user)

```text
runtime : fastify, zod, drizzle-orm, better-sqlite3, pino
dev     : typescript, tsx, vitest, @types/node, drizzle-kit, pino-pretty
tool    : corepack prepare pnpm (bukan dependency project)
```

Preseden jika `better-sqlite3` gagal build di Windows: ganti ke `@libsql/client` (satu titik ganti: `packages/database/src/client.ts`).

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.

## Next Session Handoff

1. Boot urut §11.14; jangan pindai ulang HLD/LLD.
2. Bila gate disetujui: `IMPLEMENT P1` mulai dari S1, commit per slice.
3. Bila ditolak/berubah: revisi DAG di berkas ini sebelum menyentuh kode.
