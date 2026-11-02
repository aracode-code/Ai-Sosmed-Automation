# ADR-0002 — Kontrak Planner, Output AI & Tool Allowlist (P2)

**Status:** Accepted (default, diputuskan agen di L1) — revisitable
**Tanggal:** 2026-10-30
**Konteks:** P2 Agent — commit `7d02a06` (implementasi) dan `9cd360c` (perbaikan pemetaan error)

## Konteks

LLD §9 menetapkan agent memakai DeepSeek sebagai planner dengan output JSON tervalidasi, tool registry allowlist, dan larangan shell tool. P2 membangun kontrak itu **tanpa** menunggu OD-1/OD-2 (Flow/platform) dan **tanpa** API key nyata.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| D1 | DeepSeek diakses lewat `fetch` bawaan Node (tanpa SDK); key diberikan pemanggil `createDeepSeekClient({apiKey})`, paket tidak membaca env sendiri | Menghindari dependensi baru (gate G5); sumber key tetap keputusan lapisan pemanggil | SDK resmi dibutuhkan untuk fitur tertentu |
| D2 | Kontrak output = `PlanDecision` (4 jenis: `create_video`, `revise_metadata`, `wait`, `needs_human`) dengan `campaignId`, `approvalRequired`, `rationale` wajib | LLD §9.1 — output tervalidasi, bukan instruksi bebas | Alur baru butuh jenis keputusan lain |
| D3 | Aturan yang tidak boleh dipercayakan ke model ditegakkan **di luar model** (`checkPlanAgainstCampaign`): campaign cocok, target ⊆ platform campaign, duplikat platform ditolak, capability `unsupported` menolak target video, batas caption | Deterministik dan dapat diuji tanpa model | — |
| D4 | `approvalMode: required` tidak dapat diturunkan model (`enforceApproval` memaksa `approvalRequired: true`) | Approval tidak boleh dilewati oleh output model (LLD §12.1) | — |
| D5 | Output invalid/di luar kebijakan → 1 perbaikan (total 2 panggilan) → `PlannerOutputError` kelas `AI_OUTPUT_INVALID` → retry policy `escalate` = `NEEDS_ATTENTION` | LLD §9.3 ("retry terbatas … lalu NEEDS_ATTENTION"). Cacat ditemukan saat sync: kelas `VALIDATION` memetakan ke `FAILED` | Batas perbaikan diubah setelah ada data kegagalan nyata |
| D6 | Input planner tidak valid (`PlannerInput`) tetap `PlannerError` kelas `VALIDATION` → `FAILED`; model tidak dipanggil | Itu bug pemanggil, bukan output model | — |
| D7 | Tool AI hanya lewat `ToolRegistry` allowlist: pola nama `^[a-z][a-z0-9_]{2,63}$`, nama shell/exec/eval/spawn ditolak saat registrasi, Zod validasi input+output, budget 8 panggilan per run, timeout 10 s, dukungan abort, `ToolContext` tanpa secret | LLD §9.2–9.3: tidak ada shell tool; tool hanya menerima data minimum | Ada tool yang butuh durasi lebih panjang → timeout per-tool |
| D8 | Capability platform 3-nilai (`supported`/`unsupported`/`unknown`), default `unknown`; hanya `unsupported` memblokir target video di planner | `unknown ≠ unsupported` (LLD §11.3); gerbang akhir tetap di adapter + approval | Owner memutuskan planner harus menolak `unknown` |
| D9 | P2 **tidak** menyambungkan planner ke dispatcher; handler `PLAN_CONTENT` (butuh record campaign/aset) menjadi follow-up | Kontrak dibekukan lebih dulu; wiring butuh schema konten yang belum ada | Saat wiring: `PlannerOutputError` wajib berakhir `NEEDS_ATTENTION` |
| D10 | Test P2 memakai LLM skrip + `fetch` palsu; tidak ada panggilan DeepSeek nyata. Status uji live = **UNVERIFIED** | Tidak ada API key; test tidak boleh menyentuh jaringan | Owner menyediakan key (sumber env vs Credential Manager belum diputuskan) |

**Diperbarui 2026-11-02:** sumber kunci diputuskan di ADR-0011 (DPAPI `deepseek-api-key` lewat UI, env sebagai fallback) dan **uji live DeepSeek VERIFIED** — satu siklus `PLAN_CONTENT` dengan kunci nyata mengembalikan 2 item dalam ±2 s, tanpa panggilan jaringan pada test suite.

## Konsekuensi

- Paket keenam `@saa/agent-core` bergantung pada `@saa/domain` + `zod`; tidak mengimpor `database`/`workflow`, sehingga arah dependensi tetap.
- `AI_OUTPUT_INVALID` adalah kelas implementasi tambahan di luar tabel LLD §15; ditambahkan karena §15 tidak punya kelas untuk output AI dan §9.3 menetapkan `NEEDS_ATTENTION`.
- Capability `unknown` tidak memblokir rencana; keputusan akhir tetap di approval/verifikasi. Risiko ini dicatat, bukan disembunyikan.
- Adapter DeepSeek sudah diuji terhadap API nyata (2026-11-02, `PLAN_CONTENT` 2 item); test suite tetap memakai `fetch` palsu.

## Tidak Diputuskan di Sini

- Sumber API key DeepSeek (env var vs Credential Manager/DPAPI) — bagian secret store/P7.
- OD-1…OD-7 tetap **OPEN** di `tasks/BACKLOG.md`.
