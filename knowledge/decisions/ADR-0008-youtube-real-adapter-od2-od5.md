# ADR-0008 — Adapter YouTube Nyata: Jawaban OD-2 & OD-5

**Status:** Accepted (diputuskan agen di L1 atas perintah owner "lanjutkan ke opsi b jawab OD-2 dan OD-5 adapter YouTube", 2026-10-30)
**Tanggal:** 2026-10-30
**Konteks:** ADR-0005 (mock) · P5 PARTIAL · OD-2/OD-5 di `tasks/BACKLOG.md` dan LLD §19
**Ruang lingkup:** **hanya YouTube**. OD-2/OD-5 untuk TikTok/Instagram/Facebook/X/Threads tetap terbuka sampai P6.

## Fakta Terverifikasi (dokumentasi resmi Google, dibaca 2026-10-30)

| # | Fakta | Status | Sumber |
|---|---|---|---|
| F1 | Kuota default YouTube Data API v3 = **10.000 unit/hari per project**; `videos.insert` = **1 unit**, dengan batas terpisah **100 panggilan `videos.insert`/hari** | VERIFIED | [Quota Calculator](https://developers.google.com/youtube/v3/determine_quota_cost), [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| F2 | Referensi `videos.insert` saat ini menyatakan project yang belum diverifikasi **tidak** dibatasi private | VERIFIED (isi dokumen) · **CONFLICT** dengan [issue tracker 572863050](https://issuetracker.google.com/issues/572863050) (2026-10-13) yang mempertanyakan inkonsistensi dokumen | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| F3 | Scope `videos.insert`: `youtube.upload` (minimum), atau `youtube`/`youtubepartner`/`youtube.force-ssl` | VERIFIED | [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) |
| F4 | App OAuth **eksternal** berstatus **Testing** → refresh token **kedaluwarsa 7 hari** | VERIFIED | [OAuth 2.0](https://developers.google.com/identity/protocols/oauth2) |
| F5 | Halaman verifikasi scope sensitif/terbatas (dibaca 2026-10-30) **tidak mencantumkan** `youtube.upload`; halaman itu menyebut privacy policy, demo video, dan domain verification untuk scope yang direview | VERIFIED (isi halaman) · klasifikasi final scope = **UNKNOWN** sampai registrasi | [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) |
| F6 | Batas unggahan harian **per channel** tetap ada (`uploadLimitExceeded`); angkanya tidak dipublikasikan | VERIFIED (keberadaan) · **UNKNOWN** (angka) | referensi error `videos.insert` |
| F7 | Upload API memerlukan `status.selfDeclaredMadeForKids` | INFERRED (pengetahuan API; akan terbukti saat uji nyata pertama) | — |

**Konsekuensi F2:** adapter **wajib** memverifikasi `status.privacyStatus` hasil `videos.list` setelah upload. Bila privasi yang diminta tidak terpenuhi, hasil bukan `PUBLISHED` — lihat D4.

## Keputusan OD-2 — Izin & Aplikasi Publikasi (YouTube)

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| D1 | YouTube Data API v3 dengan scope `youtube.upload` + `youtube.readonly` | Minimum privilege; `youtube` penuh ditolak karena memberi akses tulis di luar kebutuhan; `youtube.readonly` diperlukan `videos.list`/`channels.list` untuk verifikasi | Butuh operasi playlist/komentar |
| D2 | Satu baris `social_accounts` = satu channel; `secret_ref = dpapi:youtube:<accountId>`; `profile_key = null` | Struktur lama sudah mendukung referensi kredensial per akun; adapter API tidak memakai profil browser | Multi-channel per akun Google dalam satu baris |
| D3 | Memakai kuota default (10.000 unit + 100 upload/hari/**project**); tidak mengajukan kuota tambahan di MVP | Cukup untuk cadence MVP; kuota tambahan butuh audit/justifikasi yang belum perlu | Kebutuhan >100 upload/hari/project → satu project per brand atau ajukan kuota |
| D4 | Privasi unggahan default **`private`**; `YOUTUBE_UPLOAD_PRIVACY=private|unlisted|public`. Naik ke `public` hanya setelah uji nyata membuktikan privasi yang diminta benar-benar diterapkan | F2 masih CONFLICT; jangan mengklaim publikasi publik tanpa bukti empiris. Adapter memverifikasi `privacyStatus` via `videos.list`; mismatch → `NEEDS_ATTENTION` + `limitations: ['privacy_not_applied']`, **bukan** `PUBLISHED` | Owner mengonfirmasi unggahan publik stabil |
| D5 | Metadata wajib: `snippet.title` ≤100, `snippet.description` ≤5000, `snippet.categoryId` (env, default `27` = Education), `snippet.defaultLanguage` opsional, `status.privacyStatus`, `status.selfDeclaredMadeForKids=false` | Batas API + syarat upload; konten bukan untuk anak (D5 eksplisit agar tidak memicu kepatuhan COPPA salah) | Konten anak (tidak direncanakan) |
| D6 | `quotaExceeded` dan `uploadLimitExceeded` → **tanpa retry hari itu**, job `NEEDS_ATTENTION` (kelas eskalasi); `invalid_grant` → `connection_status = reauth_required`; 5xx/timeout → retry policy yang ada; upload memakai protokol resumable | Retry pada kuota habis hanya membakar kuota/loop; reauth tidak bisa diperbaiki otomatis | Kuota naik / limit channel berubah |
| D7 | Channel milik owner (pribadi atau brand account); **tidak** memakai `onBehalfOfContentOwner` (CMS/MCN) | Aplikasi single-tenant, bukan multi-channel network | Owner memakai CMS |

## Keputusan OD-5 — App Registration OAuth (YouTube)

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| O1 | OAuth client tipe **Desktop app** (public client) dengan redirect loopback `http://127.0.0.1:<port>/oauth2/callback` + **PKCE S256** | Aplikasi lokal single-user; loopback sesuai model desktop app Google dan tidak butuh domain | Butuh onboarding web/multi-user (nanti: Web application + domain verification) |
| O2 | Consent `access_type=offline` + `prompt=consent` saat pairing; token endpoint `https://oauth2.googleapis.com/token`; access token diperbarui bila sisa <60 s | Refresh token hanya terbit dengan `offline`; refresh proaktif menghindari kegagalan upload di tengah jalan | — |
| O3 | Status publikasi app: **Internal** bila owner memakai Google Workspace; **In production** bila akun gmail pribadi. **DILARANG** beroperasi harian dalam status **Testing** | F4: token Testing mati 7 hari = kegagalan senyap; Internal tidak terkena aturan itu; In production untuk app eksternal | Owner memilih Workspace |
| O4 | Refresh token disimpan **DPAPI** (user scope) di `%LOCALAPPDATA%\saa\credentials\youtube-<accountId>.bin`, ACL hanya user; enkripsi/dekripsi lewat helper PowerShell `ProtectedData` dengan secret via **stdin** (bukan argumen); masa berlaku token ikut di dalam blob. DB hanya menyimpan `secret_ref` + `connection_status` | LLD §13.1 (Credential Manager/DPAPI); tidak ada dependensi npm baru (G5 tidak dipicu); tidak ada migrasi schema | Butuh multi-user/multi-proses → `@napi-rs/keyring` (G5) |
| O5 | Konfigurasi baru (nilai tidak pernah dicetak): `YOUTUBE_ADAPTER=off|mock|api`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` (opsional untuk desktop, tetap diperlakukan rahasia), `YOUTUBE_UPLOAD_PRIVACY`, `YOUTUBE_CATEGORY_ID`, `YOUTUBE_DEFAULT_LANGUAGE`, `GOOGLE_OAUTH_REDIRECT_PORT` (opsional). Refresh token **tidak boleh** berasal dari env | Mengikuti pola `DEEPSEEK_API_KEY` + ADR-0005 (adapter opt-in); rahasia tidak masuk `AppConfig`/log/state | — |
| O6 | Implementasi OAuth + upload resumable memakai `fetch`, **tanpa SDK `googleapis`** | Konsisten ADR-0002; menghindari dependensi baru (G5) | Butuh fitur lanjutan (chunk tuning, batch) |
| O7 | Pairing akun satu kali lewat perintah lokal (loopback), hasil `connection_status = connected`; kegagalan refresh → `reauth_required` dan job `NEEDS_ATTENTION` | Kredensial tidak boleh dimasukkan lewat chat/berkas knowledge | UI desktop menyediakan alur pairing |

## Prasyarat Faktual dari Owner (bukan keputusan desain)

Implementasi dan test bisa berjalan dengan HTTP palsu tanpa ini; **uji live** menunggu:

1. **Google Cloud project** (ID) + billing account — kuota dasar gratis, billing diperlukan bila mengajukan kuota tambahan.
2. **Jenis akun Google** pemilik channel: Workspace (→ Internal) atau gmail (→ In production).
3. **Channel target** (nama/ID; brand account atau bukan).
4. Persetujuan membuat **OAuth client Desktop** + consent screen di project tersebut.
5. Konfirmasi privasi awal: `private` (rekomendasi) atau langsung `public`.

## Konsekuensi

- P5 tetap **PARTIAL** sampai ada unggahan nyata yang terverifikasi; ADR ini hanya menutup ketidakpastian keputusan, bukan status implementasi.
- Kapasitas maksimum bawaan: **100 upload/hari per project** (bukan per channel) — cukup untuk MVP, menjadi batas keras untuk multi-akun.
- Mode `Testing` adalah jebakan operasional (token 7 hari); onboarding wajib mencatat status publikasi app dan tanggal pairing.
- Tidak ada perubahan schema DB, route API, atau dependensi npm pada keputusan ini.

## Rencana Implementasi (slice, belum dikerjakan)

| Slice | Isi | Status |
|---|---|---|
| A1 | Config `YOUTUBE_ADAPTER=api` + nama env auth; credential store DPAPI (helper), tanpa dependensi baru | **DONE** (2026-10-30, `442d3be`) |
| A2 | OAuth client: pairing loopback + PKCE, refresh token, `reauth_required` | belum |
| A3 | `YouTubeApiAdapter`: `validate`, `publish` (resumable upload), `getStatus` (`videos.list`), pemetaan error D6 | belum |
| A4 | Wiring composition root + onboarding akun + log status app (Testing/Production) saat boot | belum |
| A5 | Test dengan HTTP palsu (tanpa kredensial) + smoke manual oleh owner pada channel sah | belum |

### A1 — yang sudah ada (E1)

- `packages/youtube/src/credential-store.ts`: `DpapiCredentialStore` (`save`/`load`/`remove`), `CredentialStoreError` (`INVALID_NAME`, `NOT_SUPPORTED`, `PROTECT_FAILED`, `UNPROTECT_FAILED`, `CORRUPT`), penulisan atomik `.tmp` → rename, nama divalidasi (`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`, tanpa `..`).
- Path: `%LOCALAPPDATA%\saa\credentials\<nama>.bin` (dapat dioverride untuk test); ciphertext DPAPI `CurrentUser`; rahasia dikirim ke PowerShell statis lewat **stdin**, bukan argumen; timeout 10 s.
- Payload JSON (masa berlaku token ikut di dalam blob); DB hanya `secret_ref` + `connection_status` — tidak ada migrasi.
- `apps/local-api/src/config.ts`: `YOUTUBE_ADAPTER=off|mock|api`, `loadYouTubeCredentials` (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` opsional) — tidak masuk `AppConfig`.
- `apps/local-api/src/server.ts`: `api` → peringatan `belum diimplementasikan (slice A2–A4)`; `PUBLISH` tidak terdaftar (job → `NEEDS_ATTENTION` + `NO_HANDLER`).
- Bukti: typecheck 9 paket PASS; 35 file test, **248 passed / 0 failed**; smoke boot `YOUTUBE_ADAPTER=api` port 4396 → `/health` ok + peringatan eksplisit, port bebas setelah stop.

## Open Items

- F2 (privat vs publik untuk project unverified) baru bisa dipastikan dari respons API saat uji nyata pertama.
- Klasifikasi resmi scope `youtube.upload` (sensitif/terbatas) belum eksplisit di halaman verifikasi; periksa saat membuat consent screen.
- Angka batas unggahan per channel tidak dipublikasikan; tangani lewat `uploadLimitExceeded` (D6).
- OD-2/OD-5 untuk platform P6 belum dijawab.
