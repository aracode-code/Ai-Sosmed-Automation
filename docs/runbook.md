# Runbook Operasional

Panduan operator untuk menjalankan, memverifikasi, dan memulihkan aplikasi.
Kontrak API, skema database, dan model ancaman **tidak diduplikasi** di sini — sumber kanonik ada di
`knowledge/` (modul + ADR), `LLD.md` §5–§6 dan §13.

Status saat ini: **P5 PARTIAL** — adapter YouTube nyata (A1–A7) terpasang dan teruji dengan HTTP palsu,
tetapi belum ada unggahan nyata yang terverifikasi. Satu-satunya bukti yang dapat menaikkan status itu
adalah prosedur *Smoke live* di bawah.

## 1. Prasyarat

| Item | Nilai |
|---|---|
| Node.js | `>=22.12 <23` (lihat `engines`) |
| pnpm | 9.15.4 lewat corepack — jangan pasang pnpm global |
| OS | Windows 10/11 (token YouTube memakai DPAPI user-scope) |
| Lokasi kerja | root repo; semua perintah dijalankan dari root |

Aplikasi **tidak** membaca berkas `.env`. Semua konfigurasi berasal dari environment variable
(shell sesi, atau *User environment variables* Windows).

## 2. Perintah

| Tujuan | Perintah |
|---|---|
| Typecheck + test | `corepack pnpm typecheck` · `corepack pnpm test` |
| Migrasi database | `corepack pnpm migrate` |
| Jalankan server | `corepack pnpm start` |
| Buka dashboard | `corepack pnpm ui` → `http://localhost:5174` |
| Build dashboard | `corepack pnpm --filter @saa/dashboard build` |
| Cek kesiapan YouTube | `corepack pnpm --filter @saa/local-api preflight:youtube` |
| Login Google Flow | `corepack pnpm --filter @saa/local-api flow:login` (`--check` untuk cek tanpa jendela) |
| Pairing akun YouTube | `corepack pnpm --filter @saa/local-api pair:youtube --label "YouTube Utama"` |

Catatan: argumen CLI **tidak** memakai `--` pemisah. `pnpm run <script> --label "x"` diteruskan apa adanya;
`-- --label "x"` membuat `--` ikut terbaca sebagai argumen dan ditolak.

Kode keluar `preflight:youtube`: `0` = lulus/peringatan, `1` = ada item FAIL, `2` = konfigurasi/pemakaian salah.

## 3. Konfigurasi

Nilai rahasia **hanya** dari environment; jangan pernah ditulis ke berkas repo, chat, atau log.

| Variabel | Default | Rahasia | Catatan |
|---|---|---|---|
| `APP_HOST` | `127.0.0.1` | — | non-loopback ditolak kecuali `APP_ALLOW_NETWORK=true` |
| `APP_PORT` | `4317` | — | |
| `DATABASE_PATH` | `./data/database/app.sqlite` | — | relatif diresolusi terhadap root repo |
| `MEDIA_ROOT` | `./data/media` | — | |
| `WORKER_ENABLED` / `WORKER_INTERVAL_MS` | `true` / `1000` | — | |
| `SCHEDULER_ENABLED` / `SCHEDULER_INTERVAL_MS` | `true` / `5000` | — | dispatch jadwal → job `PUBLISH` |
| `YOUTUBE_ADAPTER` | `off` | — | `off` · `mock` (palsu) · `api` (nyata) |
| `YOUTUBE_UPLOAD_PRIVACY` | `private` | — | `private` · `unlisted` · `public` |
| `YOUTUBE_APP_STATUS` | `unknown` | — | `production` · `testing` · `unknown`; `testing` dilarang (ADR-0008 O3) |
| `DEEPSEEK_API_KEY` | — | **ya** | tanpa ini planner tidak aktif, `PLAN_CONTENT` tidak terdaftar |
| `GOOGLE_OAUTH_CLIENT_ID` | — | **ya** | wajib untuk pairing dan adapter `api` |
| `GOOGLE_OAUTH_CLIENT_SECRET` | — | **ya** (opsional) | opsional untuk OAuth client Desktop |

Refresh token tidak pernah dibaca dari environment. Lokasi blob: `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin`
(terenkripsi DPAPI user-scope, hanya dapat dibuka akun Windows yang melakukan pairing).

## 4. Smoke live YouTube (prosedur bukti P5)

Prasyarat dari owner: project Google Cloud + billing, jenis akun Google (Workspace → app *Internal*,
gmail → *In production*), channel target, OAuth client Desktop yang diizinkan, dan keputusan privasi awal.

```bash
# 1. Environment (sesi shell)
export YOUTUBE_ADAPTER=api
export YOUTUBE_UPLOAD_PRIVACY=private
export YOUTUBE_APP_STATUS=production       # dipakai untuk app Internal maupun In production; JANGAN testing
export GOOGLE_OAUTH_CLIENT_ID=...          # jangan tempel nilainya ke chat/log
export GOOGLE_OAUTH_CLIENT_SECRET=...      # opsional

# 2. Skema database siap
corepack pnpm migrate

# 3. Baseline: FAIL pada adapter/client id/akun memang diharapkan sebelum pairing
corepack pnpm --filter @saa/local-api preflight:youtube

# 4. Pairing (browser Google terbuka; consent sekali; loopback + PKCE)
corepack pnpm --filter @saa/local-api pair:youtube --label "YouTube Utama"

# 5. Preflight ulang: target 0 FAIL (WARN media boleh selama belum ada aset video)
corepack pnpm --filter @saa/local-api preflight:youtube

# 6. Jalankan server (worker + scheduler aktif)
corepack pnpm start
```

Langkah pemicu unggahan — pilih salah satu:

- **Manual:** `POST /api/v1/content` dengan `{ "campaignId": "<id>", "requestId": "<unik>" }` (perlu `DEEPSEEK_API_KEY`).
- **Terjadwal:** biarkan loop dispatcher membuat job `PUBLISH` saat slot jatuh tempo.

Jika campaign memakai `approvalMode=required`, setujui lewat
`POST /api/v1/content/:id/approve` dengan payload binding (`version`, `assetSha256`, `captionHash`,
`accountId`, `platform`) — kontrak lengkap di `knowledge/modules/local-api.md`.

Bukti yang harus dicatat (tanpa token):

| Bukti | Cara |
|---|---|
| Job `PUBLISH` berstatus `PUBLISHED` | `GET /api/v1/jobs/:id` |
| `externalPostId` + `permalink` + `verifiedAt` | `GET /api/v1/jobs/:id` hanya memuat job; pakai kueri di bawah |
| Privasi `private` benar-benar diterapkan | adapter sudah memanggil `videos.list`; job tidak akan `PUBLISHED` bila privasi berbeda |
| Video tampak di channel | YouTube Studio → *Content* → privasi *Private* |
| Tanggal, akun, status app, videoId | tulis di `knowledge/logs/YYYY-MM-DD.md` |

```bash
# Read-only; path absolut ke database
corepack pnpm --filter @saa/database exec node -e "const D=require('better-sqlite3');const db=new D(process.argv[1],{readonly:true});console.log(db.prepare('SELECT job_id,status,external_post_id,permalink,verified_at,error_code FROM publish_attempts ORDER BY attempted_at DESC LIMIT 5').all())" "F:/AiSosmedAutomation/data/database/app.sqlite"
```

Jangan nyatakan P5 COMPLETED sebelum seluruh baris bukti di atas terisi.

## 5. Troubleshooting

| Gejala / kode | Arti | Tindakan |
|---|---|---|
| `AUTH` + `quotaExceeded` / `uploadLimitExceeded` | kuota project atau batas unggahan channel habis | jangan retry; tunggu reset harian (zona Google); cek Quota Calculator |
| `reauth_required` + `invalid_grant` | refresh token dicabut/kedaluwarsa (app *Testing*) | pairing ulang dengan `pair:youtube --account <id>`; pastikan app bukan *Testing* |
| `YT_PRIVACY_MISMATCH` | privasi hasil `videos.list` ≠ yang diminta | video tetap ada di channel; jangan naikkan `public`; periksa status project/review |
| `YT_UPLOAD_REJECTED` | YouTube menolak unggahan | perbaiki konten/metadata; tidak ada retry otomatis |
| `YT_UPLOAD_UNCERTAIN` / `YT_UPLOAD_INCOMPLETE` | hasil tidak pasti / resume 308 gagal | cek YouTube Studio sebelum mengunggah ulang — `videos.insert` tidak idempoten |
| `NO_HANDLER` | adapter publikasi tidak terdaftar | set `YOUTUBE_ADAPTER=api` + `GOOGLE_OAUTH_CLIENT_ID`; restart |
| `LEASE_EXPIRED` | proses berhenti saat job berjalan | job dipulihkan saat start; periksa apakah publikasi sudah terjadi sebelum mengulang |
| `EADDRINUSE` saat start | port dipakai proses lain | hentikan proses lama atau ubah `APP_PORT` |
| preflight `FAIL` pada `akun:<id>` | blob DPAPI hilang/tak terbaca | jalankan pairing ulang dengan akun Windows yang sama |
| `flow:login` berhenti (exit 134/OOM) tetapi jendela Chromium masih terbuka | proses Node mati, browser menjadi yatim | selesaikan login di jendela itu lalu tutup; bila CLI tidak berjalan lagi, tunggu lock kedaluwarsa (10 menit) sebelum menjalankan `flow:login` |
| `.worker-lock.json` menahan profil Flow | sesi sebelumnya mati tanpa melepas lock | hapus hanya bila **tidak ada** proses `chrome.exe` dengan `--user-data-dir` profil Flow |
| `flow:login` melaporkan "halaman belum selesai dimuat" | SPA Flow lambat / jaringan lambat | muat ulang halaman di jendela tersebut; login tetap bisa dilakukan |
| Login berakhir di `flow.google.com/about` | sesi belum valid atau akun belum punya akses Flow | login ulang dan pastikan studio tampil; bila tetap `/about`, catat sebagai blokir akses (OD-1) |
| `Gagal: konfigurasi tidak valid … APP_HOST` | host non-loopback tanpa izin | pakai `127.0.0.1` atau set `APP_ALLOW_NETWORK=true` secara sadar |

## 6. Operasional harian

- **Health:** `GET /health` → `{ status, db, workers: { active } }`.
- **Antrean:** `GET /api/v1/jobs?status=<STATUS>&limit=<n>`.
- **Jeda dispatch:** `POST /api/v1/scheduler/pause` · `POST /api/v1/scheduler/resume`.
- **Berhenti:** `Ctrl+C` — shutdown menutup worker → dispatcher → database secara berurutan.
- **Log:** stdout proses (JSON terstruktur); nilai sensitif diredaksi otomatis.

### Backup dan pemulihan

1. Hentikan server.
2. Salin `data/database/app.sqlite`, `app.sqlite-wal`, `app.sqlite-shm` bersama-sama (satu set konsisten).
3. Salin `data/media` bila media tidak dapat dibuat ulang.
4. Blob kredensial (`%LOCALAPPDATA%\saa\credentials`) hanya berguna pada akun Windows yang sama; simpan di media terproteksi.
5. Pemulihan: hentikan server, kembalikan berkas, jalankan `corepack pnpm migrate` (idempoten), lalu start.

Jangan menyalin berkas SQLite saat server berjalan.

### Dashboard lokal

```bash
corepack pnpm start   # terminal 1 — Local API 127.0.0.1:4317
corepack pnpm ui      # terminal 2 — http://localhost:5174 (proxy /api → 4317)
```

- Halaman: **Jobs** (filter status + detail payload), **Campaigns** (daftar + konten per campaign),
  **Approvals** (konten `pending` + aksi tinjau), **Accounts** (status koneksi).
- **Aksi approval**: tombol *Tinjau* membuka dialog yang memuat versi konten, aset, `captionHash`,
  dan akun kandidat dari `GET /api/v1/content/:id`; keputusan dikirim ke `approve`/`reject` dengan
  binding tersebut. Keputusan diblokir bila belum ada aset `valid` atau akun `connected`.
  Bila konten berubah di antara buka dialog dan kirim, API menolak dengan `APPROVAL_MISMATCH`.
- Pairing/reauth tetap lewat CLI (`pair:youtube`).
- Proxy dev hanya mengarah ke `127.0.0.1:4317`; jika Local API mati, halaman menampilkan
  "Local API tidak merespons".

## 7. Login Google Flow (akses awal)

```bash
corepack pnpm --filter @saa/local-api flow:login --check   # profil + browser, tanpa membuka jendela
corepack pnpm --filter @saa/local-api flow:login           # buka browser untuk login manual
corepack pnpm --filter @saa/local-api flow:inspect         # petakan DOM + tangkapan layar (read-only)
```

- Flow berada di **`https://flow.google.com/`**; URL lama `labs.google/fx/tools/flow` mengalihkan ke sana.
- Login **wajib memakai Chrome/Edge terpasang** (otomatis dideteksi; `FLOW_BROWSER_CHANNEL` untuk menimpa).
  Chromium bawaan Playwright ditolak Google dengan pesan "browser or app may not be secure" — jangan dicoba
  diakali (tidak ada stealth/spoof/cookie-copy).
- Setelah login, pastikan URL **tetap di `flow.google.com`** dan terlihat studio Flow (kolom prompt/daftar project).
  Bila yang muncul `/about` (halaman marketing: "Create with Google Flow", "Try in Google Flow"), sesi belum valid
  atau akun belum punya akses Flow.
- Aplikasi tidak mengisi kredensial, tidak memecahkan CAPTCHA, dan tidak menembus verifikasi apa pun.
  Bila Flow menampilkan tantangan, pekerjaan berhenti (`NEEDS_ATTENTION`).
- Satu profil hanya boleh dipakai satu proses. `flow:login` memegang lock; bila ada worker yang
  sedang memakai profil, perintah menolak dengan `RESOURCE_BUSY` — hentikan worker dulu.
- Adapter generasi Flow **belum ada**; langkah berikutnya memetakan UI Flow dari sesi ini
  sebelum menulis adapter (ADR-0010).

## 8. Batas yang diketahui

- Local API belum memiliki autentikasi token/Origin check (LLD §13.2) — jangan aktifkan `APP_ALLOW_NETWORK`.
- Job `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` terjadwal belum ada; rekonsiliasi hanya berjalan inline saat `PUBLISH` dan saat restart (via `externalPostId` tersimpan).
- Dashboard: aksi approve/reject tersedia; pairing akun tetap lewat CLI.
- Adapter Flow masih mock; sesi/login sudah tersedia, generasi nyata belum.
- Publikasi platform lain (P6) belum ada.
- Prosedur ini hanya divalidasi untuk Windows.
