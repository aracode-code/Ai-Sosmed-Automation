# Modul — Dashboard (`apps/dashboard`)

**Status:** PARTIAL — UI COMPLETED untuk Jobs/Campaigns/Approvals (termasuk aksi setujui/tolak) + Accounts (2026-11-01); pairing akun belum ada di UI
**Sumber:** kode aktual (E1). Keputusan: `ADR-0009` (U1–U8, U7 direvisi). Kontrak data: `LLD.md` §6 (route lokal).

## Peta Berkas

| Berkas | Tanggung jawab |
|---|---|
| `apps/dashboard/vite.config.ts` | Dev/preview server (`5174`/`5175`), proxy `/api` + `/health` → `http://127.0.0.1:4317` |
| `apps/dashboard/src/api.ts` | `getJson`, `sendJson`, `ApiError`, hook `useApi` (abort, loading, error); pesan khusus saat Local API mati |
| `apps/dashboard/src/types.ts` | Bentuk respons API yang dipakai UI (Job, Campaign, ContentItem, ContentDetail, AssetSummary, AccountSummary, Health) |
| `apps/dashboard/src/App.tsx` | Shell: sidebar (Overview/Jobs/Campaigns/Approvals/Accounts; default Overview), badge health, tombol muat ulang, `onChanged` untuk refresh setelah keputusan |
| `apps/dashboard/src/components.tsx` | `StatusPill`, `EmptyState`, `ErrorBox`, `Loading`, `Section`, formatter |
| `apps/dashboard/src/ApprovalDialog.tsx` | Dialog tinjau: detail konten, pilih aset `valid`, pilih akun `connected`, alasan, kirim approve/reject |
| `apps/dashboard/src/pages/OverviewPage.tsx` | Halaman awal: kartu ringkasan, **tren 7 hari** (bar job dibuat/terbit/gagal), maks. 5 campaign terbaru, dan kegagalan terbaru |
| `apps/dashboard/src/pages/JobsPage.tsx` | Kartu ringkasan + panel kegagalan + daftar job + filter status + panel detail dengan tombol **Retry job** (`NEEDS_ATTENTION`) dan **Batalkan** (bukan terminal, bukan `PUBLISHING`/`VERIFYING`) |
| `apps/dashboard/src/pages/CampaignsPage.tsx` | Daftar campaign + detail konten per versi |
| `apps/dashboard/src/pages/ApprovalsPage.tsx` | Konten `pending` dari seluruh campaign + tombol *Tinjau* |
| `apps/dashboard/src/pages/AccountsPage.tsx` | Akun + `connectionStatus` (tanpa `secretRef`) |
| `apps/dashboard/src/styles.css` | Token warna + komponen (tanpa Tailwind pada iterasi ini) |

## Perilaku Penting

- **Sumber data:** `GET /health`, `/api/v1/jobs`, `/api/v1/campaigns`, `/api/v1/campaigns/:id`, `/api/v1/accounts`, `GET /api/v1/content/:id` (dialog approval), dan `GET /api/v1/dashboard/summary` (kartu ringkasan).
- **Aksi approval:** dialog mengirim `{version, assetSha256, captionHash, accountId, platform, reason?}` yang **diterima dari server** ke `POST /api/v1/content/:id/approve|reject`; UI tidak menghitung hash sendiri.
- **Guard UI:** keputusan diblokir bila tidak ada aset `valid` atau akun `connected`; `APPROVAL_MISMATCH` menampilkan instruksi muat ulang.
- **Tanpa kredensial:** UI tidak menyimpan token apa pun; pairing tetap CLI.
- **Kegagalan API:** `getJson`/`sendJson` memetakan respons non-JSON ≥500 (proxy Vite) menjadi "Local API tidak merespons — jalankan corepack pnpm start"; sidebar menampilkan titik merah.
- **Health badge:** `GET /health` → `version`, `db`, `workers.active`; indikator hanya hijau bila `db === 'ok'`.
- **Layout sempit (<720px):** header menjadi dua baris (brand+health, lalu nav horizontal yang menggulir tanpa scrollbar halaman); `grid-template-columns: minmax(0,1fr)` + `min-width:0` mencegah overflow; tabel menggulir di dalam panel.
- **Approvals:** mengambil daftar campaign lalu detail tiap campaign secara paralel; baris = konten `approvalStatus === 'pending'`; setelah keputusan sukses daftar dimuat ulang.

## Perintah

```bash
corepack pnpm ui                                   # dev server 5174 (butuh API di 4317)
corepack pnpm --filter @saa/dashboard build        # dist (gitignored)
corepack pnpm --filter @saa/dashboard typecheck
```

## Batas / Belum Ada

- Alur pairing/reauth akun belum ada di UI (token tidak boleh melewati browser); tetap CLI.
- `GET /api/v1/dashboard/summary` dipakai halaman Jobs untuk lima kartu ringkasan (job aktif, perlu perhatian, menunggu approval, publikasi terbit, akun terhubung); kartu tidak menampilkan data sensitif.
- Belum ada test UI otomatis; verifikasi manual di browser (ADR-0009 U8) — alur approve dan reject sudah diuji end-to-end pada DB demo.
- Tailwind belum dipakai (ADR-0009 U4); router belum ada (U3).
- Belum ada autentikasi/`Origin` check pada Local API yang dilayani UI (celah P7, `docs/security.md`).
