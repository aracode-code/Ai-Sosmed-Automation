# ADR-0010 — Akses Flow: Sesi Profil Persisten dan `flow:login`

**Status:** Accepted (diputuskan agen di L1 atas perintah owner "buat agar bisa akses dan menjalankan google flow", pilihan owner: Playwright + Chromium, urutan "session + `flow:login` dulu", 2026-11-01)
**Tanggal:** 2026-11-01
**Konteks:** P3 PARTIAL (adapter Flow masih mock, ADR-0003 D16–D17); OD-1 terbuka (akses/kebijakan Flow); gate G5 untuk dependensi baru
**Ruang lingkup:** **hanya** sesi browser + login manual. Adapter generasi Flow nyata dan smoke satu video **belum** termasuk.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| F1 | Dependensi `playwright` (bukan `playwright-core`) dengan Chromium terunduh lewat `playwright install chromium` | Versi browser deterministik dan terisolasi; `playwright-core` mengikuti update Chrome/Edge pengguna yang dapat mematahkan selektor | Ukuran distribusi menjadi masalah (paket desktop) |
| F2 | Profil persisten di `%LOCALAPPDATA%\saa\browser\flow-profile`; override hanya lewat `FLOW_PROFILE_DIR` **absolut** | Konsisten dengan lokasi kredensial DPAPI; di luar repo sehingga tidak pernah ter-commit; profil berisi cookie sesi Google | Butuh multi-profil/multi-akun (satu profil = satu akun Google) |
| F3 | Login **manual** oleh pemilik akun di jendela yang dibuka `flow:login`; aplikasi tidak mengisi kredensial, tidak melewati CAPTCHA, tidak menyentuh verifikasi | Batas keamanan §13 dan kebijakan layanan; tantangan apa pun → berhenti `NEEDS_ATTENTION` | Tidak ada — batas ini permanen |
| F4 | Satu profil = satu proses. `.worker-lock.json` diambil sebelum browser dibuka dan dilepas pada semua jalur (sukses, launch gagal, navigasi gagal, browser ditutup) | Mencegah dua proses menulis profil yang sama (korupsi profil, sesi bertabrakan) | Butuh banyak worker paralel → profil terpisah per worker |
| F5 | URL default `https://labs.google/fx/tools/flow`, dapat diganti lewat `openFlowSession({ url })` | URL Flow belum diverifikasi dari akun nyata; **UNKNOWN** apakah stabil atau butuh parameter produk | URL berubah / tersedia jalur lain |
| F6 | Slice ini **tidak** memuat adapter generasi: selektor/DOM Flow belum dipetakan dan tidak boleh ditulis tanpa bukti | Menulis selektor tanpa akun nyata = kode fiktif; urutan dipilih owner: login dulu, lalu petakan DOM, baru adapter | — |
| F7 | Login berjalan **headed** (`headless: false`, `viewport: null`, `--start-maximized`) | Login Google tidak dapat diselesaikan headless | Adapter generasi mungkin boleh headless — UNKNOWN |

## Konsekuensi

- P3 tetap **PARTIAL**: belum ada `FlowVideoGenerator` nyata, belum ada smoke generate.
- Chromium (~150 MB) berada di `%LOCALAPPDATA%\ms-playwright`, **tidak** masuk repo; lockfile mencatat versi `playwright`.
- Profil Flow memuat cookie sesi Google → diperlakukan sebagai material sensitif (jangan disalin ke mesin lain kecuali untuk migrasi dengan kesadaran penuh).
- OD-1 tetap terbuka pada bagian **faktual**: apakah akun owner benar-benar punya akses Flow, kuota/limit Flow, dan kebijakan penggunaan otomasi.
- `flow:login --check` memberi bukti lokal tanpa membuka jendela (Chromium ada, profil dapat diresolusi).

## Bukti Implementasi (E1, 2026-11-01)

- Commit `fd62314`: `packages/browser-engine/src/flow-session.ts` (`resolveFlowProfileDir`, `openFlowSession`, `checkFlowBrowser`), `apps/local-api/src/flow-login.ts`, script `flow:login`.
- Test: `packages/browser-engine/src/flow-session.test.ts` — 10 test (default/override/relatif ditolak, lock dipegang & dilepas, sesi kedua `ProfileBusyError`, launch gagal, navigasi gagal).
- `corepack pnpm typecheck` exit 0 (10 paket) · `corepack pnpm test` **44 file / 357 test** hijau.
- `corepack pnpm --filter @saa/local-api flow:login --check` → profil `C:\Users\sayaa\AppData\Local\saa\browser\flow-profile`, Chromium `...\ms-playwright\chromium-1248\chrome-win64\chrome.exe`, exit 0.
- Belum: login nyata, pemetaan DOM Flow, adapter generasi, smoke satu video.
