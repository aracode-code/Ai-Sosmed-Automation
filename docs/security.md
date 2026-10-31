# Keamanan Operasional

Sumber kanonik aturan keamanan adalah **`LLD.md` §13** (secrets, local API, threat model) dan
**`knowledge/decisions/ADR-0008-youtube-real-adapter-od2-od5.md`** (O3/O4/O5 untuk OAuth YouTube).
Dokumen ini **tidak menduplikasi** model ancaman; isinya adalah status penerapan aktual, aturan operator,
dan prosedur insiden.

## 1. Aturan operator (ringkas, mengikat)

1. Rahasia hanya dari environment variable atau credential store (DPAPI). Tidak dari berkas repo, knowledge, atau chat.
2. Nilai rahasia tidak boleh muncul di output CLI, log, `state.json`, index, snapshot, atau commit.
3. Jangan menempelkan nilai rahasia ke percakapan agen. Agen hanya boleh menerima nama variabel dan status ada/tidak.
4. Jangan menjalankan operasi Git destruktif untuk "membersihkan" sesuatu yang dicurigai.
5. Jangan menghapus rahasia sebelum ada cadangan yang terverifikasi.

## 2. Status kontrol (E1 — kode aktual)

| Kontrol | Status | Bukti |
|---|---|---|
| AI key & OAuth client hanya dari environment, tidak masuk `AppConfig` | **DONE** | `apps/local-api/src/config.ts` (`loadAiCredentials`, `loadYouTubeCredentials`) |
| Refresh token di DPAPI user-scope, berkas `0600`, tulis atomik `.tmp` → rename, secret lewat stdin | **DONE** | `packages/youtube/src/credential-store.ts` |
| Database hanya menyimpan `secret_ref` + `connection_status` (tanpa token) | **DONE** | `packages/database/src/repositories/accounts.ts` |
| Redaksi log (`authorization`, `cookie`, `*.token`, `*.secret`, `*.password`) + sanitasi objek konteks | **DONE** | `packages/observability/src/{logger,sanitize}.ts` |
| Local API bind loopback; non-loopback ditolak kecuali `APP_ALLOW_NETWORK=true` | **DONE** | `apps/local-api/src/config.ts` |
| Penolakan unggahan bila privasi hasil verifikasi tidak sesuai | **DONE** | `packages/youtube/src/youtube-api-adapter.ts` (`YT_PRIVACY_MISMATCH`) |
| Path media dicek terhadap root yang diizinkan | **DONE** (saat validasi media) | `packages/browser-engine/src/{storage,media}.ts` |
| Tool AI tanpa shell/eval, berbasis allowlist | **DONE** | `packages/agent-core/src/tools.ts` |
| Tidak ada upaya menembus CAPTCHA/anti-bot; kondisi itu → `NEEDS_ATTENTION` | **DONE** | ADR-0003/ADR-0005 (kelas `SECURITY_CHALLENGE`) |
| `.gitignore` menutup `data/`, `*.sqlite*`, `.env*`, storage state, cookies | **DONE** | `.gitignore` |
| **Autentikasi token local API + validasi `Origin`** | **BELUM** (LLD §13.2) | tidak ada `preHandler`/header auth di `apps/local-api/src` — mitigasi sementara: loopback + `APP_ALLOW_NETWORK=false` |
| **Rate limit / batas body eksplisit** | **BELUM** | hanya default Fastify; tidak ada `@fastify/rate-limit` |
| Klasifikasi scope OAuth `youtube.upload` (sensitive/restricted) | **UNKNOWN** | ADR-0008 F5 — bergantung hasil registrasi |

Celah yang tercatat di atas adalah pekerjaan P7; jangan menganggapnya selesai.

## 3. Secret yang ada di sistem

| Secret | Lokasi penyimpanan | Rotasi |
|---|---|---|
| `DEEPSEEK_API_KEY` | environment | ganti nilai, restart proses |
| `GOOGLE_OAUTH_CLIENT_ID` | environment | buat OAuth client baru di Google Cloud, pairing ulang |
| `GOOGLE_OAUTH_CLIENT_SECRET` | environment (opsional untuk Desktop app) | reset secret di Google Cloud, pairing ulang |
| Refresh token YouTube | blob DPAPI `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin` | cabut akses di akun Google, lalu pairing ulang |
| Session browser Flow (bila adapter nyata dipakai nanti) | storage state terproteksi ACL | hapus + login ulang |

Blob DPAPI hanya dapat dibuka akun Windows yang melakukan pairing; menyalin berkas ke mesin lain tidak
membuka token. Namun perlakukan tetap sebagai rahasia.

## 4. Permukaan serangan

- **Local API.** Tanpa autentikasi, siapa pun yang dapat menjalankan proses di mesin yang sama dapat
  memanggil route. Karena itu `APP_HOST` wajib loopback. Jangan aktifkan `APP_ALLOW_NETWORK=true`
  sampai autentikasi token dan validasi `Origin` tersedia.
- **Dashboard (dev).** `apps/dashboard` adalah UI yang dilayani Vite di `localhost:5174`
  dan memanggil API lewat proxy loopback (termasuk aksi approve/reject); UI tidak menyimpan token
  dan tidak memanggil DB. Dev server Vite **bukan** proses produksi: jangan bind ke LAN (`--host`)
  atau memakainya di luar mesin ini sampai autentikasi local API diterapkan.
- **AI (planner).** Output model tidak dipercaya: schema validation, tool allowlist, budget langkah,
  timeout; tidak ada akses shell. Campaign/capability/caption divalidasi di luar model (ADR-0002).
- **Adapter publikasi.** Setiap `PUBLISH` menulis `publish_attempts` (audit), memakai idempotency key,
  dan tidak mengunggah ulang ketika hasil ambigu (`videos.insert` tidak idempoten).
- **Filesystem.** Media divalidasi (mime, ukuran, sha256, containment). Database dan media berada di
  `data/` yang di-ignore Git.
- **Supply chain.** Dependensi baru butuh persetujuan (gate G5); lockfile dikomit; engine dipin
  (`>=22.12 <23`, `pnpm@9.15.4`).

## 5. Verifikasi rutin

```bash
# Rahasia tidak masuk working tree
git status --porcelain

# Pola kredensial pada berkas yang dilacak
git grep -nEI "(api[_-]?key|client[_-]?secret|refresh[_-]?token)[\"']?[[:space:]]*[:=][[:space:]]*[\"'][A-Za-z0-9_-]{16,}" -- . ':!pnpm-lock.yaml'

# Kesiapan konfigurasi YouTube (tidak mencetak nilai rahasia)
corepack pnpm --filter @saa/local-api preflight:youtube
```

`preflight:youtube` menampilkan PASS/WARN/FAIL untuk platform, adapter, kredensial OAuth (hanya status
ada/tidak), status app, privasi, database, akun + blob DPAPI, dan aset media.

## 6. Insiden

**Dugaan kebocoran secret (chat, log, commit, berkas publik):**

1. Hentikan proses yang memakai secret tersebut.
2. Rotasi: buat ulang API key / OAuth client / cabut refresh token di akun Google.
3. Catat kejadian di `knowledge/logs/YYYY-MM-DD.md` (waktu, secret apa, jalur kebocoran, tindakan) — tanpa menulis nilai secret.
4. Bila sudah ter-commit: laporkan; pembersihan history adalah keputusan owner (operasi Git destruktif).

**Akun YouTube ditandai / upload ditolak berulang:** hentikan publikasi otomatis, cek YouTube Studio dan
panel kebijakan, jangan mengulang unggahan yang sama (risiko duplikat dan penalti).

**Blob DPAPI tidak terbaca** (pindah mesin/user Windows): bukan insiden keamanan — jalankan pairing ulang.

## 7. Checklist sebelum P7 / rilis

- [ ] Autentikasi token local API + validasi `Origin` diterapkan dan diuji
- [ ] Rate limit + batas body eksplisit
- [ ] `APP_ALLOW_NETWORK` hanya dipakai bila autentikasi sudah ada
- [ ] Uji live YouTube selesai dan bukti tercatat (privacy `private` terverifikasi)
- [ ] `docs/security.md` dan `docs/runbook.md` ditinjau ulang terhadap kode terbaru
- [ ] Scan rahasia bersih pada paket rilis
