# CURRENT — Task Aktif

**Session:** SESSION-2026-10-30-7
**Updated:** 2026-10-30T09:45:00+07:00
**Change class:** MEDIUM (kode baru di paket publikasi + config; tanpa migrasi DB, route, atau dependensi eksternal)

## Active Task

_Tidak ada task aktif._ **Slice A1 (ADR-0008) selesai**: credential store DPAPI + konfigurasi `YOUTUBE_ADAPTER=api` (commit `442d3be`).

| Field | Nilai |
|---|---|
| Task terakhir | **A1 — credential store DPAPI untuk token YouTube** |
| Status | **P5 PARTIAL** — A1 DONE, A2–A5 belum; upload nyata UNVERIFIED · **P4c/P4b COMPLETED** · P4 PARTIAL (UI) · P3 PARTIAL (Flow) |
| Mode eksekusi | SINGLE-WRITER sequential |
| DoD tercapai | ✅ store simpan/muat/hapus + ciphertext DPAPI · ✅ nama divalidasi · ✅ tulis atomik · ✅ test fake + DPAPI nyata · ✅ config `api` + loader env · ✅ typecheck + 248 test hijau · ✅ smoke boot |

## Bukti Slice A1 (aktual 2026-10-30)

| Bukti | Hasil |
|---|---|
| Commit | `442d3be` — `feat(p5-a1): credential store DPAPI untuk token YouTube` (6 file, +419/−5) |
| Berkas baru | `packages/youtube/src/credential-store.ts`, `packages/youtube/src/credential-store.test.ts` |
| Berkas diubah | `packages/youtube/src/index.ts`, `apps/local-api/src/{config,config.test,server}.ts` |
| Typecheck | PASS — 9 paket + `tests/tsconfig.json` |
| Test | `corepack pnpm test` → **35 file, 248 passed / 0 failed** (naik dari 235) |
| Smoke boot | `YOUTUBE_ADAPTER=api` port 4396 → log `YOUTUBE_ADAPTER=api belum diimplementasikan (slice A2–A4, ADR-0008); job PUBLISH tidak terdaftar`; `/health` `status ok`, `db ok`; port dibebaskan |
| Dependensi | **Tidak ada penambahan** (DPAPI via PowerShell `-EncodedCommand`, secret lewat stdin) |

## Kontrak A1 (yang harus dipakai A2)

| Hal | Nilai |
|---|---|
| API | `save(name, payload)` · `load<T>(name)` · `remove(name)` · `pathFor(name)` |
| Lokasi | `%LOCALAPPDATA%\saa\credentials\<name>.bin` (fallback `~/.local/share/...` di non-Windows; operasi → `NOT_SUPPORTED`) |
| Enkripsi | DPAPI `CurrentUser` (ciphertext terikat akun Windows) |
| Pola nama | `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$` |
| Payload | JSON apa pun; A2 memakai `{ refreshToken, scope, tokenType, obtainedAt, clientId }` |
| Tulis | `mkdir -p` → `.tmp` (mode 0600) → `rename`; gagal → `.tmp` dihapus |
| Error | `INVALID_NAME` · `NOT_SUPPORTED` · `PROTECT_FAILED` · `UNPROTECT_FAILED` · `CORRUPT` |
| Config | `YOUTUBE_ADAPTER=off|mock|api`; `loadYouTubeCredentials()` membaca `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` (tidak masuk `AppConfig`) |

## Impact Map

- **Modul:** `youtube` (paket bertambah 1 modul + test), `local-api` (config + cabang `api` di `buildPublisher`).
- **DB/route/migrasi:** tidak berubah (12 tabel, 15 route, 3 migrasi tetap).
- **Rahasia:** tidak ada token di kode, log, state, atau test; test DPAPI nyata menulis ke `%LOCALAPPDATA%` lalu menghapus berkasnya.

## Drift Tercatat

- A2–A5 belum ada: belum ada OAuth client, `YouTubeApiAdapter`, wiring nyata, maupun test HTTP palsu → **P5 tetap PARTIAL**.
- Upload nyata UNVERIFIED; F2 CONFLICT (project unverified: `private` atau tidak) hanya bisa dipastikan pada uji live.
- Klasifikasi scope `youtube.upload` UNKNOWN; batas unggahan per channel UNKNOWN.
- Drift lama: kuota scheduler menghitung semua status attempt; `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` belum job terpisah; `AGENTS.md` untracked.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.

## Next Session Handoff

1. Boot urut §11.14; jangan pindai ulang HLD/LLD.
2. **A2 — OAuth client** (`packages/youtube/src/oauth-client.ts`):
   - authorization code + PKCE (S256) pada loopback `127.0.0.1` porta acak, `state` acak dibandingkan konstan-waktu;
   - token exchange/refresh lewat `fetch` (tanpa SDK), timeout + batas ukuran respons;
   - simpan payload via `DpapiCredentialStore` dengan nama `youtube-<accountId>`;
   - `invalid_grant` → `reauth_required` (bukan retry); akses token **tidak** disimpan ke DB.
3. **A3** `YouTubeApiAdapter` (`validate`/`publish` resumable/`getStatus`) · **A4** wiring composition root + onboarding akun · **A5** test HTTP palsu + smoke manual owner.
4. **Prasyarat faktual owner** untuk uji live: project Google Cloud + billing, jenis akun Google (Workspace/gmail), channel target, izin membuat OAuth client Desktop, konfirmasi privasi awal (`private` dianjurkan).
5. Jangan menyatakan P5 COMPLETED sebelum ada unggahan nyata yang terverifikasi (bukti `videos.list`).
6. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet.
