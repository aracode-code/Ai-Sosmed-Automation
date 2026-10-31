# CURRENT — Task Aktif

**Session:** SESSION-2026-11-01-1
**Updated:** 2026-11-01T00:30:00+07:00
**Change class:** MEDIUM (satu route baca baru + aksi approval di UI; tanpa migrasi, tanpa dependensi baru)

## Active Task

_Tidak ada task aktif._ Owner meminta fokus ke versi web; slice berikutnya dari handoff (aksi approval) dikerjakan: endpoint baca binding, dialog tinjau, aksi setujui/tolak, lalu verifikasi end-to-end.

| Field | Nilai |
|---|---|
| Task terakhir | **W1 + W2** — `GET /api/v1/content/:id`, dialog approval + aksi approve/reject |
| Status | **P4 PARTIAL** — UI approval beraksi DONE; pairing tetap CLI · P5 PARTIAL (smoke live) · P3 PARTIAL (Flow) |
| Mode eksekusi | SINGLE-WRITER sequential |
| DoD tercapai | ✅ 7 test route baru · ✅ typecheck 10 paket · ✅ 347 test · ✅ build UI · ✅ approve & reject terverifikasi end-to-end di DB demo |

## Bukti Sesi Ini (aktual 2026-11-01)

| Bukti | Hasil |
|---|---|
| Commit | `5e8184b` endpoint detail konten · `406f1f5` dialog + aksi approval · `docs+knowledge` sesi ini |
| Typecheck | PASS — 10 paket + `tests/tsconfig.json` (exit 0) |
| Test | `corepack pnpm test` → **43 file, 347 passed / 0 failed** (naik dari 340; 7 test baru) |
| Build UI | `vite build` exit 0 — 163,24 kB JS / 7,81 kB CSS |
| Alur approve (browser) | Approvals → *Tinjau* → dialog memuat `captionHash` + aset `valid` + akun `connected` → *Setujui* → notice "Keputusan tersimpan", baris hilang |
| DB setelah approve | `content_items.approval_status = approved`; baris `approvals` (`decision=approved`, `platform=youtube`, `decided_by=local-user`); audit `content.approve` success |
| Alur reject (browser) | reset demo ke `pending` → *Tinjau* → *Tolak* → baris hilang; DB `approval_status = rejected`, `approvals.decision = rejected` |
| Kebersihan | API & dev server dihentikan; port 4317/5174 diverifikasi bebas |

## Temuan yang Mengikat

| Temuan | Dampak |
|---|---|
| `content_items` ber-PK `id` tunggal, padahal LLD §5 menyebut `unique(id, version)` | Menyimpan versi baru untuk id sama gagal (`UNIQUE constraint failed`); `version` saat ini selalu 1 — keputusan owner dicatat di BACKLOG |
| Route approve tidak memeriksa `assetSha256` bila konten belum punya aset | Perilaku lama; UI menutup celah dengan memblokir keputusan tanpa aset `valid` |
| Binding harus diterima dari server | UI tidak menghitung `captionHash`; server menghitung ulang saat keputusan dikirim dan menolak dengan `APPROVAL_MISMATCH` bila berubah |

## Impact Map

- **Berkas baru:** `apps/local-api/src/content-detail.test.ts`, `apps/dashboard/src/ApprovalDialog.tsx`.
- **Diubah:** `apps/local-api/src/routes/content.ts` (route `GET /:id`), `apps/dashboard/src/{api.ts,types.ts,App.tsx,styles.css}`, `apps/dashboard/src/pages/ApprovalsPage.tsx`, `docs/runbook.md`.
- **DB/route/migrasi:** route **16 → 17**; 12 tabel & 3 migrasi tidak berubah; tanpa dependensi baru.
- **Rahasia:** detail konten tidak memuat `path` aset maupun `secretRef` akun (dijaga test).

## Drift Tercatat

- PK `content_items` vs LLD §5 (menunggu keputusan owner).
- P5 tetap PARTIAL (smoke live); P3 PARTIAL (Flow/OD-1).
- Pairing akun di UI belum ada (tetap CLI).
- `GET /dashboard/summary` belum ada.
- `AGENTS.md` untracked.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.

## Next Session Handoff

1. Boot urut §11.14; jangan pindai ulang HLD/LLD.
2. UI: `corepack pnpm start` + `corepack pnpm ui`; alur approval ada di tab Approvals.
3. Kandidat berikutnya: `GET /dashboard/summary` (LLD §6) untuk kartu ringkasan, lalu filter/pencarian job, atau pairing di UI bila disetujui desainnya.
4. Menunggu owner: keputusan revisi multi-versi konten, smoke live YouTube, job rekonsiliasi terjadwal, OD-1 Flow, lint (D7), `AGENTS.md`.
