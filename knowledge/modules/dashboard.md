# Modul — Dashboard (`apps/dashboard`)

**Status:** PARTIAL — kerangka UI baca-saja COMPLETED (2026-10-31); aksi approval/pairing belum ada
**Sumber:** kode aktual (E1). Keputusan: `ADR-0009` (U1–U8). Kontrak data: `LLD.md` §6 (route lokal).

## Peta Berkas

| Berkas | Tanggung jawab |
|---|---|
| `apps/dashboard/vite.config.ts` | Dev/preview server (`5174`/`5175`), proxy `/api` + `/health` → `http://127.0.0.1:4317` |
| `apps/dashboard/src/api.ts` | `getJson`, `ApiError`, hook `useApi` (abort, loading, error); pesan khusus saat Local API mati |
| `apps/dashboard/src/types.ts` | Bentuk respons API yang dipakai UI (Job, Campaign, ContentItem, AccountSummary, Health) |
| `apps/dashboard/src/App.tsx` | Shell: sidebar (Jobs/Campaigns/Approvals/Accounts), badge health, tombol muat ulang |
| `apps/dashboard/src/components.tsx` | `StatusPill`, `EmptyState`, `ErrorBox`, `Loading`, `Section`, formatter |
| `apps/dashboard/src/pages/JobsPage.tsx` | Daftar job + filter status + panel detail (payload JSON, lease, kunci idempoten) |
| `apps/dashboard/src/pages/CampaignsPage.tsx` | Daftar campaign + detail konten per versi |
| `apps/dashboard/src/pages/ApprovalsPage.tsx` | Agregasi konten `pending` dari seluruh campaign (baca-saja) |
| `apps/dashboard/src/pages/AccountsPage.tsx` | Akun + `connectionStatus` (tanpa `secretRef`) |
| `apps/dashboard/src/styles.css` | Token warna + komponen (tanpa Tailwind pada iterasi ini) |

## Perilaku Penting

- **Tanpa route API baru:** semua data berasal dari `GET /health`, `/api/v1/jobs`, `/api/v1/campaigns`, `/api/v1/campaigns/:id`, `/api/v1/accounts`.
- **Baca-saja:** tidak ada tombol yang mengubah state; approve/reject menunggu endpoint binding (ADR-0009 U7).
- **Tanpa kredensial:** UI tidak menyimpan token apa pun; pairing tetap CLI.
- **Kegagalan API:** `getJson` memetakan respons non-JSON ≥500 (proxy Vite) menjadi "Local API tidak merespons — jalankan corepack pnpm start"; sidebar menampilkan titik merah.
- **Health badge:** `GET /health` → `version`, `db`, `workers.active`; indikator hanya hijau bila `db === 'ok'`.
- **Approvals:** mengambil daftar campaign lalu detail tiap campaign secara paralel; baris = konten `approvalStatus === 'pending'`.

## Perintah

```bash
corepack pnpm ui                                   # dev server 5174 (butuh API di 4317)
corepack pnpm --filter @saa/dashboard build        # dist (gitignored)
corepack pnpm --filter @saa/dashboard typecheck
```

## Batas / Belum Ada

- Aksi approve/reject dan alur pairing belum ada (ADR-0009 U7).
- `GET /dashboard/summary` (LLD §6) belum dibuat; ringkasan dihitung dari daftar job.
- Belum ada test UI otomatis; verifikasi manual di browser (ADR-0009 U8).
- Tailwind belum dipakai (ADR-0009 U4); router belum ada (U3).
- Belum ada autentikasi/`Origin` check pada Local API yang dilayani UI (celah P7, `docs/security.md`).
