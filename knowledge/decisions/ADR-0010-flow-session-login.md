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
| F5 | URL default **`https://flow.google.com/`** (bukan lagi `labs.google/fx/tools/flow`), dapat diganti lewat `openFlowSession({ url })`; `flow:inspect --url` dibatasi ke host `flow.google.com` | Terverifikasi 2026-11-01: URL lama mengalihkan ke `flow.google.com/about`; rute tanpa sesi valid juga berakhir di `/about` | URL berubah / tersedia jalur lain |
| F6 | Slice ini **tidak** memuat adapter generasi: selektor/DOM Flow belum dipetakan dan tidak boleh ditulis tanpa bukti | Menulis selektor tanpa akun nyata = kode fiktif; urutan dipilih owner: login dulu, lalu petakan DOM, baru adapter | — |
| F7 | Login berjalan **headed** (`headless: false`, `viewport: null`, `--start-maximized`) | Login Google tidak dapat diselesaikan headless | Adapter generasi mungkin boleh headless — UNKNOWN |
| F8 | Navigasi memakai `domcontentloaded` + timeout 60 s; `flow:login` memakai mode **toleran** (jendela tetap terbuka bila navigasi lambat, `navigationError` dilaporkan). Adapter generasi memakai mode ketat | Percobaan pertama memakai `load` penuh → timeout 30 s lalu sesi ditutup; Flow adalah SPA berat | Flow berubah menjadi halaman ringan |
| F9 | Browser memakai **build resmi terpasang** (`channel: chrome`, fallback `msedge`, terakhir `chromium` bawaan); `FLOW_BROWSER_CHANNEL` menimpa | Google menolak sign-in di Chromium for Testing ("browser or app may not be secure"). Memakai Chrome/Edge sesuai saran pesan; **dilarang** stealth/UA-spoof/cookie-copy | Mesin tanpa Chrome/Edge |
| F10 | `flow:inspect` (read-only) memetakan DOM + tangkapan layar untuk memastikan sesi valid sebelum adapter ditulis | Menulis selektor tanpa bukti = kode fiktif; `/about` menandakan sesi belum login/akun tanpa akses | — |
| F11 | **Guard pemakaian berbasis hitungan**: `FLOW_MAX_GENERATIONS_PER_DAY` (default 1), `FLOW_REQUIRE_CONFIRM` (default true → wajib `--yes`), `FLOW_DRY_RUN`, ledger `data/flow-usage.json`; hari dihitung pada `Asia/Jakarta` | Tidak ada API saldo kredit, dan setelan "Konfirmasi sebelum membuat" milik agen Flow **tidak** melindungi pembuatan langsung dari kotak prompt | Ada sumber saldo kredit resmi |
| F12 | CLI `flow:generate [--kind image|video] [--prompt …] [--dry-run] [--yes] [--endpoint]` memasang guard lalu menjalankan generator | Membuat jalur uji berbiaya terkendali sebelum menyambungkannya ke handler `GENERATE_VIDEO` | Adapter disambungkan ke workflow |
| F13 | Attach CDP tidak punya "disconnect" tanpa menutup browser → proses CLI keluar eksplisit setelah selesai | Chrome milik pengguna harus tetap terbuka | Playwright menyediakan detach murni |
| F14 | Mode media dipilih lewat **tab `Gambar` / `Video`** di sisi kiri studio; panel Setelan harus **ditutup** (Escape) karena menutupi komposer (ukuran prompt menjadi 0×0) | Terverifikasi saat smoke: komposer tidak terlihat saat panel terbuka | UI Flow berubah |
| F15 | Hasil media memakai URL `https://flow.google.com/asb/…` (gambar 1376×768) dan `storage.googleapis.com/ai-sandbox-videofx/…` — **bukan** hanya `googleusercontent`; probe harus mencakup ketiganya | Probe lama melewatkan hasil sehingga CLI menunggu sampai timeout walau pembuatan sukses | URL hasil berubah |
| F16 | Wiring produksi: `FLOW_ADAPTER=mock|real` (default `mock`) + `FLOW_CDP_ENDPOINT` **wajib loopback**; `FlowPlaywrightGenerator` mengimplementasikan `VideoGenerator` (tab `Video`) dan menghitung sha256/ukuran/mime dari berkas hasil | Menyambung generator nyata ke handler `GENERATE_VIDEO` tanpa mengubah default; endpoint non-loopback ditolak config | Generator dipakai untuk image juga, atau butuh multi-akun |
| F17 | **Policy rasio per platform** di `@saa/domain` (`aspectRatioForTargets`): TikTok/Instagram/Threads → `9:16`; YouTube/Facebook → `16:9` kecuali `contentFormat` short/reel/story/klip → `9:16`; X → `16:9`; campuran → `9:16`; tanpa target → `9:16`. `PLAN_CONTENT` memakai policy ini (planner hanya dipakai bila tidak ada target), dan adapter memilih radio rasio di panel Setelan sesuai bagian model | Keputusan model tidak boleh menebak rasio: Reels/TikTok vertikal, YouTube reguler horizontal; salah rasio = konten terpotong/berbingkai | Platform baru (P6) atau butuh `1:1` |
| F18 | Cakupan section dicari **berdasarkan kontrak** (tepat satu tombol model + ada radio, maks 3 level); `Simpan` dicari **global** (footer panel); hasil diverifikasi dengan membuka panel lagi dan memeriksa `aria-checked`, jika tidak → `UI_CHANGED` | Review menemukan: naik 5 level mencampur bagian gambar+video sehingga untuk `kind=video` radio `9:16` milik bagian **gambar** yang terklik, lalu Simpan tetap diklik → setelan salah tersimpan tanpa error | Struktur panel Flow berubah |

## Konsekuensi

- P3 tetap **PARTIAL**: belum ada `FlowVideoGenerator` nyata, belum ada smoke generate.
- Chromium (~150 MB) berada di `%LOCALAPPDATA%\ms-playwright`, **tidak** masuk repo; lockfile mencatat versi `playwright`.
- Profil Flow memuat cookie sesi Google → diperlakukan sebagai material sensitif (jangan disalin ke mesin lain kecuali untuk migrasi dengan kesadaran penuh).
- OD-1 tetap terbuka pada bagian **faktual**: apakah akun owner benar-benar punya akses Flow, kuota/limit Flow, dan kebijakan penggunaan otomasi.
- `flow:login --check` memberi bukti lokal tanpa membuka jendela (Chromium ada, profil dapat diresolusi).

## Bukti Implementasi (E1, 2026-11-01)

- Commit `fd62314`: `packages/browser-engine/src/flow-session.ts` (`resolveFlowProfileDir`, `openFlowSession`, `checkFlowBrowser`), `apps/local-api/src/flow-login.ts`, script `flow:login`.
- Commit `260ac52`: navigasi `domcontentloaded` + `gotoTimeoutMs` (60 s) + `tolerateGotoFailure` untuk login; 11 test sesi.
- Commit `f2e586e`: deteksi Chrome/Edge terpasang + `FLOW_BROWSER_CHANNEL`; 18 test sesi. Chromium bawaan ditolak Google pada sign-in ("browser or app may not be secure") — diverifikasi pada sesi nyata.
- Commit `5093c28`: `flow:inspect` (outline DOM + screenshot, read-only) dan koreksi `DEFAULT_FLOW_URL` ke `https://flow.google.com/`.
- Commit `a7aad95`: guard pemakaian (`flow-usage.ts`, 11 test), `flow-generator.ts` (prompt → kirim → tunggu → unduh via menu), `flow-readiness.ts`, CLI `flow:generate` (`--dry-run`/`--yes`).
- Verifikasi guard: `flow:generate --dry-run` → `Prompt: ada`, `Tombol kirim: ada`, `Tantangan: tidak`, `Pemakaian 0/1 (2026-11-01 WIB)`, exit 0 tanpa biaya.
- Commit `3bef04d`: probe hasil mencakup `/asb/` + `storage.googleapis.com`, Escape panel + pilih tab mode, ledger `submitted` (hanya dihitung setelah kirim).
- Smoke image nyata (2026-11-01, setelan Flow `x1`): Flow membuat **1 gambar** ("Coffee cup on wooden table") dan kredit terpakai; CLI timeout 300 s karena probe lama tidak mengenali URL `/asb/`. Setelah perbaikan, probe mengembalikan `{ok:true, w:1376}` untuk hasil yang sama — unduhan otomatis belum diulang (kuota harian 1/1).
- Commit `f3565f6`: `FlowPlaywrightGenerator` + `FLOW_ADAPTER`/`FLOW_CDP_ENDPOINT` + composition root. Verifikasi tanpa kredit: typecheck 10 paket exit 0, suite **385 test** hijau, 5 test generator (kind `video`, sha/mime/size, berkas kosong, kesiapan/tantangan), 4 test config (default mock, `real`, nilai asing ditolak, endpoint non-loopback ditolak), boot smoke port 4398 mencatat "generator Flow nyata aktif; pembuatan akan memakai kredit akun".
- Commit `70d7e49`: `aspectRatioForTargets` (5 test), `PLAN_CONTENT` memakai policy rasio, adapter memilih radio rasio per bagian model dan gagal eksplisit bila radio tidak ada; suite **390 test** hijau.
- Commit `100af90`: perbaikan cakupan rasio + verifikasi. Bukti DOM (panel terbuka): aturan baru memilih depth **1** untuk video (6 radio, satu `9:16`) dan depth **1** untuk gambar (9 radio), `Simpan` ada secara global. 10 test baru (`flow-ratio.test.ts`), suite **400 test** hijau.
- Test: `packages/browser-engine/src/flow-session.test.ts` — 18 test.
- `corepack pnpm typecheck` exit 0 (10 paket) · `flow:login --check` → `chrome — C:\Program Files\Google\Chrome\Application\chrome.exe`.
- `flow:inspect` pada sesi tersimpan (2026-11-01): URL berakhir di `https://flow.google.com/about`, judul "Google Flow — AI Creative Studio…", **0 input**, 60 tombol marketing ("Create with Google Flow", "Try in Google Flow") → **sesi belum terautentikasi / akun belum punya akses studio**; bukti di `data/flow-inspect-*.json` + `.png`.
- Belum: login studio nyata (bukan `/about`), pemetaan DOM studio, adapter generasi, smoke satu video.

## Peta DOM Studio Flow (E1, 2026-11-01, sesi terautentikasi)

Diambil read-only lewat `flow:inspect` + attach CDP (`127.0.0.1:9222`) pada akun pemilik. **Tidak** ada klik Generate, tidak ada prompt diketik.

| Elemen | Selektor terverifikasi | Catatan |
|---|---|---|
| Root studio | `https://flow.google.com/?pli=1` | daftar project; tombol `Create a character`, `Project baru`, `Buka project`, `Edit judul project`, `Hapus project` |
| Layar project | `https://flow.google.com/project/<uuid>` | judul project + sesi; heading `Sesi tanpa judul`, prompt `Apa yang ingin Anda buat?` |
| **Kolom prompt** | `div[role="textbox"][contenteditable="true"]` (kelas `ProseMirror`) | aria-label **berbahasa Indonesia** "Apa yang ingin Anda buat?" |
| **Tombol kirim** | `button[aria-label="Mulai pembuatan"]` (ikon `arrow_forward`) | **disabled** saat prompt kosong |
| Lampiran bahan | `button[aria-label="Tambahkan bahan ke kotak perintah"]` | opsional |
| Setelan | `button[aria-label="Setelan"]` (ikon `tune`) | rasio/model |
| Sesi baru | `button[aria-label="Mulai sesi baru"]` | |
| Biaya | tombol `Pelajari biaya pembuatan`; banner "50 additional Flow credits daily" | pembuatan memakai kredit |

Konsekuensi untuk adapter:
- Label UI **dilokalkan** (Indonesia). Selektor harus toleran locale (cocokkan ID+EN) atau memakai anchor struktural (`ProseMirror`, ikon `arrow_forward`) — jangan hardcode satu bahasa.
- Tidak ada `data-testid`; andalkan `aria-label`/role.
- Ada iframe **reCAPTCHA Enterprise** → tantangan apa pun = `SECURITY_CHALLENGE` → `NEEDS_ATTENTION`, tanpa bypass.

### Alur generasi & unduhan (E1, dua pembuatan uji nyata)

| Tahap | Fakta terverifikasi |
|---|---|
| Jenis media | Prompt menentukan model: prompt gambar → **Nano Banana 2.1** (2 gambar, aria `Model default pembuatan gambar`); prompt "Buat video 5 detik …" → **Veo 3.1 - Lite** (1 video, aria `Model default pembuatan video`). Tidak ada tombol mode terpisah yang dapat ditemukan |
| Kirim | `button[aria-label="Mulai pembuatan"]` **disabled** saat prompt kosong, aktif setelah teks diketik; saat proses berjalan tombol berubah menjadi **"Hentikan"** lalu hilang ketika selesai |
| Hasil video | elemen `<video>` dengan `src` bertanda tangan `https://flow.google.com/asb/…` (durasi terukur **9,96 s**) — jangan andalkan URL ini untuk unduh |
| Unduhan | kartu → `button[aria-label="Opsi lainnya"]` → menuitem **Download** → submenu kualitas: `270p`, `GIF Animasi`, `720p`, **`Ukuran asli`**, `1080p (Upgrade)`, `4K (Upgrade)` |
| Bukti unduh | "Ukuran asli" → **2.923.700 byte**, nama `<Judul_slug>_<8 hex>.mp4`, `ftyp mp42` (valid MP4) |
| Menu kartu lain | Favorit, Gunakan kembali perintah, Tambahkan ke adegan/perintah, Salin, Ganti nama, Bagikan, **Publikasikan ke YouTube**, Tetapkan sampul, Laporkan, Pindahkan ke sampah |
| Setelan agen project | "Konfirmasi sebelum membuat": `Selalu` (default) / `Jangan pernah` (agen membuat media dan **otomatis memotong kredit**) |

Catatan penting:
- **"Publikasikan ke YouTube"** ada di Flow — alternatif jalur publikasi tanpa API; keputusan owner bila ingin dipakai (bukan bagian adapter saat ini).
- Kuota kredit dan biaya per model **belum** terukur; pembuatan uji memakai kredit akun owner.
- Unduhan harus lewat UI (menu), bukan URL bertanda tangan.
