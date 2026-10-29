# 01 — Project

## Identitas

| Atribut | Nilai | Status |
|---|---|---|
| Nama | AI Social Media Automation Agent | VERIFIED (HLD §1) |
| Root | `F:/AiSosmedAutomation` | VERIFIED |
| Tipe | Aplikasi desktop lokal Windows, satu pengguna utama | VERIFIED (HLD §2.3) |
| Deployment | Windows PC lokal; packaging Electron/Tauri belum dipilih | VERIFIED (HLD §4, LLD §19) |
| Dokumen induk | `HLD.md` v1.0 dan `LLD.md` v1.0 (keduanya berstatus Draft) | VERIFIED |
| Implementasi kode | **P1 Foundation selesai** — 5 paket workspace, 66 test hijau | VERIFIED (commit `debdaaf`, 2026-10-30) |

## Tujuan Produk

Mengotomatisasi alur produksi video dari perencanaan sampai publikasi lintas platform: DeepSeek sebagai planner → Google Flow via Playwright untuk generate + download → adapter platform untuk publikasi — dengan antrean persisten, retry, idempotency, approval, audit, dan recovery. (HLD §1)

## Ruang Lingkup

**Termasuk (HLD §2.1):** dashboard React, DeepSeek planner, Google Flow adapter, validasi media, metadata per platform, scheduler (fixed/random/random-window), antrean persisten, mode automatic + approval, 6 adapter platform (YouTube, TikTok, Instagram, Facebook, X, Threads), pengelolaan akun/sesi, retry/recovery/audit, storage aset lokal.

**Di luar MVP (HLD §2.2, LLD §1.2):** cloud multi-tenant, billing, marketplace/analitik lanjutan, pelatihan model, jaminan direct publishing tanpa verifikasi akses, **bypass CAPTCHA / anti-bot / pembatasan layanan**.

## Prinsip Desain (mengikat, HLD §1.2)

1. AI merencanakan; workflow engine mengontrol eksekusi.
2. Setiap platform diisolasi dalam adapter.
3. Semua job punya status + riwayat persisten.
4. Publikasi tidak diulang sebelum status percobaan sebelumnya diperiksa.
5. Kredensial dan sesi browser = data sensitif.
6. Tantangan keamanan yang butuh manusia menghentikan worker dengan aman (`NEEDS_ATTENTION`).
7. Otomatisasi mengikuti izin, batas, dan kebijakan layanan.

## Stack Baseline (HLD §4, LLD §2)

| Area | Pilihan | Catatan |
|---|---|---|
| Monorepo | pnpm workspace | lockfile wajib dikomit (LLD §2) |
| Runtime | Node.js LTS dipatok + TypeScript strict | shell saat ini: Node v22.15.0 |
| UI | React + Vite + Tailwind | tidak mengakses DB langsung |
| API | Fastify + Zod | bind `127.0.0.1` default |
| DB | SQLite + Drizzle, WAL, foreign_keys ON, migrasi versioned | waktu disimpan UTC ISO-8601 |
| Queue | SQLite persistent queue | satu sumber kebenaran status job |
| Browser | Playwright Chromium | satu profil = satu worker |
| AI | DeepSeek provider adapter | key hanya di secret store |
| Media | Filesystem + ffprobe | metadata di DB, file di storage |
| Logs | Pino | redaksi token/cookie/header |
| Tests | Vitest + Playwright Test | contract test per adapter |
| Secrets | Windows Credential Manager / DPAPI | DB hanya menyimpan `secret_ref` |

## Struktur Repo (aktual per 2026-10-30)

```text
apps/local-api            # Fastify app + route health/jobs + entrypoint
packages/domain           # entitas, JobType/JobStatus, error class, state machine
packages/database         # schema Drizzle, client, migrator SQL, repository jobs/audit
packages/workflow         # dispatcher, retry policy, recovery lease
packages/observability    # logger Pino + redaksi secret
tests/integration         # migrasi, restart recovery, klaim lintas koneksi, envelope API
```

Belum dibuat (P2–P7): `apps/desktop-ui`, `packages/{scheduler,agent-core,browser-engine,media,secrets}`, `packages/integrations/*`, `tests/{unit,e2e,fixtures}`, `docs/{security.md,runbook.md}`.

> Catatan: HLD/LLD berada di root repo (bukan `docs/`). Pindahkan hanya bila diputuskan di ADR — jangan memindahkan dokumen canonical tanpa jejak.

## Aturan Dependency (LLD §3)

`domain` tidak mengimpor adapter atau UI · adapter mengimplementasikan interface domain · workflow bergantung pada interface, bukan detail vendor.

## Konvensi Operasional

- Zona waktu scheduler default `Asia/Jakarta`; timestamp audit/log UTC ISO-8601.
- Retry awal: maksimal 3×, backoff eksponensial + jitter (LLD §15.1).
- `PUBLISHED` hanya setelah bukti verifikasi; status ambigu → reconciliation, bukan retry buta.
- Tidak ada shell tool untuk AI; tool registry = allowlist tervalidasi Zod (LLD §9.2–9.3).
- No secret di log, repo, state, index, atau snapshot.
- Semua perintah paket dijalankan sebagai `corepack pnpm ...` — `pnpm` tidak ada di PATH mesin ini.
- `DATABASE_PATH` relatif diresolusi terhadap root workspace (ADR-0001 D5).
- Migrasi hanya lewat `packages/database/migrations/*.sql` + `schema_migrations`; jurnal drizzle-kit tidak dipakai (ADR-0001 D3).
- Status job: 14 status LLD §4.2/§7.1 (bukan daftar HLD §7.1 — drift tercatat di ADR-0001 D6).
- Quality gate P1: `tsc` strict + Vitest; lint/build artefak belum ada (ADR-0001 D7).

## Status Implementasi

| Fase | Status |
|---|---|
| P0 Bootstrap knowledge OS | COMPLETED (2026-10-29) |
| P1 Foundation (workspace, DB, API, logs, state machine, queue) | **COMPLETED (2026-10-30, commit `debdaaf`)** |
| P2 Agent · P3 Flow · P4 Approval/Scheduler · P5 YouTube · P6 Platform lain · P7 Hardening | NOT STARTED |

Rincian fase + Definition of Done: `tasks/BACKLOG.md`. Bukti P1: `modules/foundation.md`.
