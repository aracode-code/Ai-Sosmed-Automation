# Modul — Dashboard (`apps/dashboard`)

**Status:** PARTIAL — UI untuk Jobs/Campaigns (form buat campaign `4650d90`, form permintaan rencana + keputusan rencana `1656c9f`), Approvals (aksi setujui/tolak per-konten), Accounts, dan Connections **beraksi** (login Flow + pairing YouTube dari UI, 2026-11-01; kunci AI DeepSeek via DPAPI, 2026-11-02); reauth akun tetap CLI
**Sumber:** kode aktual (E1). Keputusan: `ADR-0009` (U1–U8, U7 direvisi). Kontrak data: `LLD.md` §6 (route lokal).

## Peta Berkas

| Berkas | Tanggung jawab |
|---|---|
| `apps/dashboard/vite.config.ts` | Dev/preview server (`5174`/`5175`), proxy `/api` + `/health` → `http://127.0.0.1:4317` |
| `apps/dashboard/src/api.ts` | `getJson`, `sendJson`, `ApiError`, hook `useApi` (abort, loading, error); pesan khusus saat Local API mati |
| `apps/dashboard/src/types.ts` | Bentuk respons API yang dipakai UI (Job, Campaign, ContentItem, ContentDetail, AssetSummary, AccountSummary, Health) |
| `apps/dashboard/src/App.tsx` | Shell: sidebar (Overview/Jobs/Campaigns/Approvals/Accounts; default Overview), badge health, tombol muat ulang, `onChanged` untuk refresh setelah keputusan |
| `apps/dashboard/src/components.tsx` | `StatusPill`, `EmptyState`, `ErrorBox`, `Loading`, `Section`, formatter |
| `apps/dashboard/src/CreateCampaignForm.tsx` | Form **Buat campaign**: nama, niche, mode approval (`required`/`automatic`), checkbox platform; `POST /api/v1/campaigns` → notice + pilih baris baru (`4650d90`) |
| `apps/dashboard/src/ApprovalDialog.tsx` | Dialog tinjau: detail konten, pilih aset `valid`, pilih akun `connected`, alasan, kirim approve/reject |
| `apps/dashboard/src/PlanReviewPanel.tsx` | Tinjauan rencana `PLAN_CONTENT`: memuat `GET /api/v1/plans/:jobId`, tabel item, `bindingHash`, alasan, kirim approve/reject; mode `automatic` baca-saja |
| `apps/dashboard/src/pages/ConnectionsPage.tsx` | Status koneksi + **aksi connect**: tombol buka jendela login Flow, form pairing (akun terdaftar atau label baru), panel status/ fase/ log aksi dengan tombol Hentikan, polling 2 s selama aksi berjalan; **kunci AI (DeepSeek)**: pill status DPAPI/environment, input password tulis-saja, simpan via `POST /api/v1/ai/credentials` (ADR-0011) |
| `apps/dashboard/src/pages/OverviewPage.tsx` | Halaman awal: kartu ringkasan, **tren 7/14/30 hari** (bar job dibuat/terbit/gagal, mode kompak >14 hari), maks. 5 campaign terbaru, dan kegagalan terbaru |
| `apps/dashboard/src/pages/JobsPage.tsx` | Kartu ringkasan + panel kegagalan + daftar job + filter status + panel detail (spesifikasi, **percobaan publikasi**, **riwayat aksi**) dengan tombol **Retry job** (`NEEDS_ATTENTION`) dan **Batalkan** (bukan terminal, bukan `PUBLISHING`/`VERIFYING`) |
| `apps/dashboard/src/pages/CampaignsPage.tsx` | Daftar campaign + detail konten per versi; **form "Minta rencana"** (`POST /api/v1/content`), daftar job `PLAN_CONTENT` per campaign (`GET /api/v1/jobs?jobType=PLAN_CONTENT&campaignId=…&limit=5`), tombol *Tinjau* → `PlanReviewPanel`; notice `queued`/`duplicate` |
| `apps/dashboard/src/pages/ApprovalsPage.tsx` | Konten `pending` dari seluruh campaign + tombol *Tinjau* |
| `apps/dashboard/src/pages/AccountsPage.tsx` | Akun + `connectionStatus` (tanpa `secretRef`) |
| `apps/dashboard/src/styles.css` | Token warna + komponen (tanpa Tailwind pada iterasi ini) |

## Perilaku Penting

- **Sumber data:** `GET /health`, `/api/v1/jobs` (termasuk filter `jobType`/`campaignId`), `/api/v1/jobs/:id/events`, `/api/v1/campaigns`, `/api/v1/campaigns/:id`, `/api/v1/accounts`, `/api/v1/connections`, `GET /api/v1/content/:id` (dialog approval), `GET /api/v1/plans/:jobId` (panel rencana), dan `GET /api/v1/dashboard/summary` (kartu ringkasan + tren).
- **Buat campaign:** form di Campaigns mengirim `{name, niche, approvalMode, platforms}` ke `POST /api/v1/campaigns` (202 `{campaignId, status:'created'}`); tombol nonaktif sampai nama + niche terisi dan ≥1 platform dipilih; sukses mengosongkan form, menampilkan `campaignId`, memilih baris baru, dan memicu `onChanged`. Tidak ada form edit/status/hapus maupun form jadwal.
- **Permintaan rencana (Campaigns):** tombol **Minta rencana** mengirim `{campaignId, notes?}` ke `POST /api/v1/content`; respons 202 `queued`/`duplicate` ditampilkan sebagai notice dan daftar job dimuat ulang. Form diblokir bila campaign tidak aktif atau tidak punya platform; campaign `automatic` diberi keterangan bahwa pembuatan berjalan otomatis.
- **Daftar + keputusan rencana:** tabel 5 job `PLAN_CONTENT` terbaru (status, dibuat) dengan tombol *Tinjau*; `PlanReviewPanel` memuat rencana + item + `bindingHash`, menampilkan kolom alasan hanya untuk mode `required` dan belum diputuskan, lalu mengirim `{bindingHash, decidedBy:'local-user', reason?}`. `PLAN_MISMATCH`/`PLAN_ALREADY_DECIDED`/`PLAN_NOT_READY`/`PLAN_EMPTY`/`PLAN_INVALID` dipetakan ke pesan; setelah sukses panel memuat ulang dan `onChanged` menyegarkan daftar job/campaign.
- **Aksi connect:** tombol memanggil `POST /api/v1/connections/flow/login` atau `/youtube/pair` lalu memantau `GET /api/v1/connections/actions` tiap 2 detik selama fase `running`/`waiting`. Fase `waiting` menandakan jendela browser menunggu login/consent manual — UI tidak mengisi kredensial. Tombol Hentikan memanggil `.../actions/:kind/stop`. Setelah aksi selesai, data koneksi dimuat ulang lewat `onChanged`.
- **Batas aksi connect:** aksi berjalan sebagai proses lokal di mesin yang menjalankan API; status hanya di memori (restart API → UI kembali `idle`). Selain itu UI memindahkan field `accountId`/`label` saja — tidak ada token/secret di body.
- **Peringatan profil Flow:** bila `flow.reachable && flow.pageOpen`, UI menjelaskan bahwa `flow:login` kemungkinan gagal karena Chrome/CDP sedang memakai profil yang sama.
- **Aksi approval:** dialog mengirim `{version, assetSha256, captionHash, accountId, platform, reason?}` yang **diterima dari server** ke `POST /api/v1/content/:id/approve|reject`; UI tidak menghitung hash sendiri.
- **Guard UI:** keputusan diblokir bila tidak ada aset `valid` atau akun `connected`; `APPROVAL_MISMATCH` menampilkan instruksi muat ulang.
- **Tanpa kredensial:** UI tidak menyimpan token maupun secret apa pun; pairing hanya meneruskan `accountId`/`label`, sedangkan token dibuat CLI dan disimpan DPAPI.
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

- Campaign hanya bisa **dibuat**; edit, aktif/nonaktif, hapus, dan form jadwal belum ada di UI (dipakai lewat API/CLI).
- Halaman **Approvals** masih per konten dengan binding aset; rencana yang menunggu keputusan hanya tampil di halaman Campaigns (integrasi ke Approvals belum diminta).
- Panel rencana tidak menampilkan aset (media belum ada saat keputusan); yang ditampilkan hanya item + caption + status approval.
- Alur **reauth** akun (token kedaluwarsa/`reauth_required`) belum ada di UI; pairing awal sudah bisa dimulai dari UI tetapi tetap dijalankan proses lokal CLI.
- `GET /api/v1/dashboard/summary` dipakai halaman Jobs untuk lima kartu ringkasan (job aktif, perlu perhatian, menunggu approval, publikasi terbit, akun terhubung); kartu tidak menampilkan data sensitif.
- Belum ada test UI otomatis; verifikasi manual di browser (ADR-0009 U8) — alur approve/reject per-konten, aksi connect, form/keputusan rencana (1440×1000), dan form buat campaign (1440×1100, DB nyata) sudah diuji.
- Tailwind belum dipakai (ADR-0009 U4); router belum ada (U3).
- Belum ada autentikasi/`Origin` check pada Local API yang dilayani UI (celah P7, `docs/security.md`).
