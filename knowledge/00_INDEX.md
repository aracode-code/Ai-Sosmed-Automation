# 00 — Index Navigasi Pengetahuan

**Project:** AI Social Media Automation Agent
**Dibuat:** 2026-10-29 (SESSION-2026-10-29-1)
**Status:** P1 + P2 COMPLETED, P4 backend + P3 mock + P5 mock PARTIAL, worker loop + handler registration COMPLETED (2026-10-30) — kode aktual ada di `apps/` + `packages/`.

---

## 1. Sumber Canonical (jangan diduplikasi)

| Fakta | Sumber canonical |
|---|---|
| Arsitektur, komponen, alur bisnis, keputusan teknologi, roadmap | [`HLD.md`](../HLD.md) — §3 komponen, §4 stack, §5 alur, §6 integrasi, §14 keputusan arsitektur |
| Struktur repo, domain model, state machine, schema DB, kontrak API, workflow, scheduler, agent, adapter, security, testing, acceptance criteria | [`LLD.md`](../LLD.md) — §3–§19 |
| Keputusan implementasi & penyimpangan | [`decisions/ADR-0001-p1-stack-baseline.md`](decisions/ADR-0001-p1-stack-baseline.md) (stack P1, migrator, status drift HLD §7.1) · [`decisions/ADR-0002-p2-agent-core.md`](decisions/ADR-0002-p2-agent-core.md) (kontrak planner, output AI, tool allowlist) · [`decisions/ADR-0003-workflow-p4-p3-mock.md`](decisions/ADR-0003-workflow-p4-p3-mock.md) (job per langkah, approval binding, scheduler, P3 mock) · [`decisions/ADR-0004-worker-loop-registry.md`](decisions/ADR-0004-worker-loop-registry.md) (worker loop, registrasi handler, kredensial AI) · [`decisions/ADR-0005-youtube-mock-publish.md`](decisions/ADR-0005-youtube-mock-publish.md) (adapter publikasi, PUBLISH, verify/reconcile, adapter YouTube mock) |
| Perilaku modul yang sudah diimplementasikan | [`modules/foundation.md`](modules/foundation.md) (P1) · [`modules/agent-core.md`](modules/agent-core.md) (P2) · [`modules/workflow.md`](modules/workflow.md) (dispatcher + worker + handler) · [`modules/scheduler.md`](modules/scheduler.md) (P4 engine) · [`modules/browser-engine.md`](modules/browser-engine.md) (P3 mock) · [`modules/youtube.md`](modules/youtube.md) (P5 adapter mock + PUBLISH) · [`modules/local-api.md`](modules/local-api.md) (route + composition root) |
| State mesin (commit, task, index, validasi) | `.qoder/state.json` |
| Status index kode | `.qoder/index/index-state.json` |
| Konteks sesi aktif | `.qoder/context.md` |
| Memori proyek L1 (invariant terverifikasi) | `.qoder/memory.md` |
| Task aktif, backlog, arsip | `tasks/CURRENT.md`, `tasks/BACKLOG.md`, `tasks/DONE.md` |
| Riwayat sesi | `logs/YYYY-MM-DD.md` |

**Aturan anti-duplikasi:** `knowledge/` TIDAK menyalin schema DB, kontrak API, atau threat model — semuanya sudah canonical di HLD/LLD. Duplikat akan dibuat hanya bila dokumen asal tidak lagi menjadi sumber aktif.

---

## 2. Struktur `knowledge/`

```text
knowledge/
├── 00_INDEX.md              # berkas ini
├── 01_PROJECT.md            # identitas, ruang lingkup, konvensi, status implementasi
├── decisions/ADR-*.md       # keputusan implementasi (0001 baseline P1, 0002 agent P2, 0003 workflow/P4/P3, 0004 worker, 0005 publish YouTube mock)
├── modules/<MODULE>.md      # foundation, agent-core, workflow, scheduler, browser-engine, youtube, local-api
├── .qoder/
│   ├── state.json           # state mesin (§3.1 AGENTS.md)
│   ├── project.json         # identitas + stack terdeteksi
│   ├── context.md           # L0 konteks aktif
│   ├── memory.md            # L1 memori proyek
│   ├── .lock                # (runtime) lock penulis tunggal
│   └── index/index-state.json
├── tasks/{CURRENT,BACKLOG,DONE}.md
└── logs/
```

Belum dibuat (dibuat hanya saat ada isi nyata): `architecture/`, `database/`, `api/`, `security/`, `references/`, `.qoder/skills/`, `.qoder/mcp/`, `.qoder/cache/`.

---

## 3. Alur Boot (AGENTS.md §11.14)

```text
state.json → index/index-state.json → context.md → memory.md → 00_INDEX.md → tasks/CURRENT.md
```

Jangan memindai ulang repo bila baseline di atas valid.

---

## 4. Titik Masuk per Peran

- **Mulai kerja:** `tasks/CURRENT.md` → modul terkait di `LLD.md`.
- **Butuh kontrak data:** `LLD.md` §4 (domain) + §5 (schema) + §6 (API).
- **Butuh aturan keselamatan:** `LLD.md` §13 (security) + §15 (error/retry) + `.qoder/memory.md`.
- **Butuh keputusan yang masih terbuka:** `tasks/BACKLOG.md` bagian *Open Decisions*.
