# ADR-0001 — Baseline Stack & Migrasi P1

**Status:** Accepted (default, owner-authorized 2026-10-29) — revisitable
**Tanggal:** 2026-10-30 (implementasi), keputusan disetujui 2026-10-29
**Konteks:** P1 Foundation — slice S1–S8 di `knowledge/tasks/CURRENT.md`

## Konteks

LLD v1.0 menetapkan Node.js/TypeScript sebagai runtime (LLD §2). Saat gate G5 (dependensi baru) dibuka, owner sempat mempertimbangkan Rust, lalu membatalkannya ("Batal, tetap Node/TS") dan memilih `better-sqlite3` sebagai driver. Keputusan itu sekaligus menyetujui daftar dependensi P1.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| D1 | pnpm 9.15.4 workspace, ESM (`"type": "module"`), TypeScript 5.9 strict, `moduleResolution: Bundler`, `noEmit` | LLD §2 mewajibkan pnpm + TS strict; `Bundler` cocok untuk source-only ESM dengan `tsx`/Vitest | CI memerlukan artefak build → tambah `tsc --build` + `exports` hasil dist |
| D2 | Lima paket: `@saa/domain`, `@saa/database`, `@saa/workflow`, `@saa/observability`, `apps/local-api` | Arah dependensi LLD §3: domain tidak mengenal adapter/UI; workflow bergantung pada interface | Muncul kebutuhan modul baru (scheduler, agent-core, dsb.) di P2+ |
| D3 | SQLite melalui `better-sqlite3` + `drizzle-orm` (schema saja); migrator **milik sendiri** yang menerapkan `packages/database/migrations/*.sql` dalam transaksi dan mencatat `schema_migrations` | LLD §5.1 mensyaratkan tabel `schema_migrations`; jurnal internal drizzle-kit tidak memenuhinya. `drizzle-kit generate` hanya menghasilkan SQL | Ada kebutuhan dialect lain (mis. PostgreSQL) |
| D4 | Fastify 5 dengan `FastifyServerOptions` eksplisit + envelope error `{error:{code,message,requestId,details}}` | Kontrak LLD §6.2; envelope ZodError → `VALIDATION_ERROR` 400, tanpa stack trace | Menambah auth lokal/rate limit di P7 |
| D5 | `DATABASE_PATH` relatif diresolusi terhadap **root workspace**, bukan cwd | pnpm menjalankan script di direktori paket; tanpa resolusi ini DB mendarat di `packages/database/data/` | Packaging desktop menentukan direktori data sendiri (P7) |
| D6 | Pipeline status job mengikuti **LLD §4.2/§7.1** (14 status), bukan daftar 13 status di HLD §7.1 | LLD adalah dokumen turunan yang lebih spesifik dan memuat `RECONCILE_PUBLICATION` | HLD direvisi agar selaras (perubahan dokumen belum dilakukan) |
| D7 | Quality gate saat ini = `tsc` strict + Vitest; lint, build artefak, dan Playwright E2E belum dikonfigurasi | Belum ada linter/build/UI yang dipilih di baseline; menambahkannya tanpa keputusan hanya menambah noise | Sebelum P2 selesai (agent) atau saat UI desktop dimulai |

## Konsekuensi

- Tidak ada artefak build; menjalankan aplikasi memakai `tsx` (`corepack pnpm start`).
- Migrasi wajib lewat `packages/database/migrations/` dan CLI `corepack pnpm migrate`; mengedit DB manual akan membuat `schema_migrations` tidak sinkron.
- Seluruh transisi status harus melalui `transitionJob` di `@saa/domain`; dispatcher tidak boleh menulis status langsung (ditegakkan lewat `HandlerContext.transition`).
- Drift terdokumentasi: daftar status HLD §7.1 vs LLD §4.2. HLD tidak diubah pada P1.

## Tidak Diputuskan di Sini

OD-1 (akses Google Flow), OD-2 (izin platform), OD-3 (Electron vs Tauri), OD-4 (skala antrean), OD-5 (registrasi OAuth), OD-6 (retensi media), OD-7 (concurrency produksi) tetap **OPEN** di `tasks/BACKLOG.md`.
