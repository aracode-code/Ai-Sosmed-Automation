# ADR-0009 — Dashboard Baca-Saja: Scaffold React + Vite dan Keputusan D7

**Status:** Accepted (diputuskan agen di L1 atas pilihan owner "B — bangun dashboard minimal sekarang", 2026-10-31)
**Tanggal:** 2026-10-31
**Konteks:** P4 PARTIAL (UI approval belum ada), ADR-0001 D7 (tool lint + artefak build belum dipilih), LLD §2 dan §6 (React + Vite + Tailwind, UI tidak mengakses DB)
**Ruang lingkup:** kerangka UI desktop untuk empat area yang datanya sudah diekspos API lokal. Bukan approval UI beraksi, bukan packaging desktop.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| U1 | Paket baru `apps/dashboard` = React 18 + Vite 6 + TypeScript strict | Stack sudah ditetapkan LLD §2; Vite memberi dev server + build tanpa konfigurasi tambahan | Butuh SSR/desktop shell (Electron/Tauri, OD-3) |
| U2 | UI **hanya** memanggil Local API lewat proxy Vite (`/api`, `/health` → `http://127.0.0.1:4317`) | Menghindari CORS, menegakkan aturan "UI tidak mengakses DB" (LLD §2), dan UI tidak menyimpan kredensial apa pun | Ada kebutuhan akses non-loopback (butuh auth dulu) |
| U3 | Tanpa router pihak ketiga; navigasi = tab state di `App.tsx` | Empat halaman, tanpa deep link; menambah dependensi hanya bila kebutuhan navigasi nyata muncul | Butuh URL yang dapat dibagikan/refresh per halaman |
| U4 | Styling memakai CSS bertoken (`src/styles.css`), **bukan** Tailwind pada iterasi pertama | Menghindari rantai build tambahan sebelum ada kebutuhan desain; LLD menyebut Tailwind — penyimpangan ini dicatat, bukan disembunyikan | UI tumbuh >4 halaman atau desain mulai bervariasi |
| U5 | Halaman: Jobs (filter + detail), Campaigns (master-detail termasuk konten), Approvals (agregasi `pending`, baca-saja), Accounts | Semua datanya sudah tersedia dari route yang ada; tidak perlu route API baru | Butuh ringkasan dashboard (`GET /dashboard/summary`) atau aksi approval |
| U6 | **D7 dijawab sebagian:** artefak build = `vite build` → `apps/dashboard/dist` (gitignored); typecheck = `tsc -p tsconfig.json`; **lint belum dipilih** | Menutup kebutuhan build agar UI bisa diverifikasi; menambah ESLint tanpa aturan proyek akan menghasilkan kebisingan, bukan mutu | Akan menambah lint saat aturan gaya proyek disepakati |
| U7 | Aksi approve/reject **belum** dibuat di UI pada iterasi pertama; **direvisi 2026-11-01** setelah `GET /api/v1/content/:id` tersedia — dialog tinjau kini mengirim binding yang diterima dari server | Endpoint approval memerlukan `version`, `assetSha256`, `captionHash`, `accountId`, `platform`; media & hash tidak diekspos route mana pun — menghitung hash di browser akan menduplikasi semantik `hashCaption` di domain, jadi nilai diambil dari server | Server berhenti mengembalikan hash/binding (mis. karena caching) |
| U8 | Belum ada test UI otomatis | Tidak menambah jsdom/testing-library sebelum ada kebutuhan; verifikasi dilakukan di browser sungguhan (dev server + API lokal) | Halaman mulai punya logika non-trivial atau regresi berulang |

## Konsekuensi

- P4 tetap **PARTIAL**: UI baca-saja ada, aksi approval dan pairing tetap lewat API/CLI.
- Dependensi baru di `apps/dashboard`: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `@types/react`, `@types/react-dom` (lockfile berubah). Tidak ada dependensi baru di paket backend.
- UI tidak menambah permukaan serangan baru selain dev server Vite di `localhost:5174`; Local API tetap tanpa autentikasi (celah P7 di `docs/security.md`).
- `GET /dashboard/summary` (LLD §6) masih belum ada; halaman menghitung ringkasan dari `GET /jobs`.

## Bukti Implementasi (E1, 2026-10-31)

- Commit: `8e27b27` (aplikasi + script `ui` + lockfile) · `04c5c23` (runbook + security).
- `apps/dashboard/src/{main.tsx,App.tsx,api.ts,types.ts,components.tsx,styles.css}` + `src/pages/{JobsPage,CampaignsPage,ApprovalsPage,AccountsPage}.tsx`.
- `vite.config.ts`: `server.port 5174` (strict), proxy `/api` + `/health`; `preview.port 5175`.
- Scripts: root `pnpm ui`; paket `dev`/`build`/`preview`/`typecheck`.
- Verifikasi: `corepack pnpm typecheck` exit 0 (10 paket) · `corepack pnpm --filter @saa/dashboard build` exit 0 (`dist` 157,94 kB JS) · `corepack pnpm test` 42 file / 340 test hijau (tidak berubah — tidak ada test UI).
- Verifikasi browser (dev server + API demo): Jobs (kosong), Campaigns (1 campaign demo + panel konten), Approvals (banner baca-saja), Accounts (kosong), dan keadaan API mati (titik merah + "Local API tidak merespons"). Tanpa error konsol selain info Vite/React DevTools.
