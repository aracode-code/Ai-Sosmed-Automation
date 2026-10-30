# CURRENT — Task Aktif

**Session:** SESSION-2026-10-30-8
**Updated:** 2026-10-30T10:00:00+07:00
**Change class:** MEDIUM (modul OAuth baru di paket publikasi + pesan runtime; tanpa migrasi DB, route, dependensi, atau perubahan kontrak adapter)

## Active Task

_Tidak ada task aktif._ **Slice A2 (ADR-0008) selesai**: OAuth client YouTube — pairing PKCE loopback + refresh token (commit `5cbe70b`).

| Field | Nilai |
|---|---|
| Task terakhir | **A2 — OAuth client YouTube** |
| Status | **P5 PARTIAL** — A1+A2 DONE, A3–A5 belum; upload nyata UNVERIFIED · **P4c/P4b COMPLETED** · P4 PARTIAL (UI) · P3 PARTIAL (Flow) |
| Mode eksekusi | SINGLE-WRITER sequential |
| DoD tercapai | ✅ PKCE S256 + state konstan-waktu · ✅ loopback satu callback + timeout · ✅ exchange/refresh tanpa SDK · ✅ token ke DPAPI A1 · ✅ `reauth_required` · ✅ 21 test baru · ✅ typecheck + 269 test · ✅ smoke boot |

## Bukti Slice A2 (aktual 2026-10-30)

| Bukti | Hasil |
|---|---|
| Commit | `5cbe70b` — `feat(p5-a2): oauth client youtube dengan pkce loopback dan refresh token` (4 file, +1133/−1) |
| Berkas baru | `packages/youtube/src/oauth-client.ts`, `packages/youtube/src/oauth-client.test.ts` |
| Berkas diubah | `packages/youtube/src/index.ts`, `apps/local-api/src/server.ts` (pesan slice A3–A4) |
| Typecheck | PASS — 9 paket + `tests/tsconfig.json` |
| Test | `corepack pnpm test` → **36 file, 269 passed / 0 failed** (naik dari 248) |
| Test paket | `vitest run packages/youtube` → 36 test (21 OAuth + 9 credential store + 6 mock) |
| Smoke boot | `YOUTUBE_ADAPTER=api` port 4397 → `handlers: ["GENERATE_VIDEO"]`, peringatan `belum terhubung ke handler (slice A3–A4)`, `/health` `status ok`, port bebas |
| Dependensi | **Tidak ada penambahan** (node:crypto, node:http, fetch global) |

## Kontrak A2 (yang harus dipakai A3/A4)

| Hal | Nilai |
|---|---|
| Pairing | `pairYouTubeAccount({ accountId, clientId, clientSecret?, store, openUrl, ... })` → `{ credentialName, token }` |
| Akses | `ensureFreshAccessToken({ accountId, clientId, store, ... })` → `null` (belum dipasangkan) atau `{ record, refreshed }` |
| Record | `YouTubeTokenRecord` = `accessToken`, `refreshToken`, `tokenType`, `scope`, `expiresAt`, `clientId`, `pairedAt` |
| Nama kredensial | `credentialNameFor(accountId)` → `youtube-<accountId>`; `accountId` `^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$` |
| Refresh | otomatis bila sisa usia < 60 s; refresh token lama dipertahankan bila tidak dikirim ulang |
| Error | `reauth_required` (AUTH) · `authorization_denied` (AUTH) · `missing_refresh_token` (AUTH) · `invalid_client_config` (AUTH) · `state_mismatch` (SECURITY_CHALLENGE) · `timeout`/`provider_error` (TRANSIENT_NETWORK/EXTERNAL_5XX/RATE_LIMIT sesuai HTTP) · `invalid_response` (EXTERNAL_5XX) · `cancelled` (CANCELLED) |

## Impact Map

- **Modul:** `youtube` (dependensi internal `oauth-client` → `credential-store` + `@saa/domain`), `local-api` (hanya teks peringatan).
- **DB/route/migrasi:** tidak berubah (12 tabel, 15 route, 3 migrasi).
- **Rahasia:** tidak ada token di kode/log/test; test memakai HTTP palsu (`fetchImpl`) + loopback lokal; `openUrl` disuntikkan sehingga modul tidak memanggil shell.
- **Belum tersambung:** `connection_status` belum ditulis ke DB (A4), belum ada perintah pairing dari CLI/UI, adapter HTTP YouTube belum ada.

## Drift Tercatat

- A3–A5 belum ada → **P5 tetap PARTIAL**; upload nyata UNVERIFIED.
- F2 CONFLICT (project unverified: `private` atau tidak) dan klasifikasi scope `youtube.upload` tetap hanya bisa dipastikan saat uji live.
- Status publikasi app OAuth (Internal/In production/Testing) belum bisa dibaca dari API — A4 hanya bisa mencatat apa yang dilaporkan owner.
- Drift lama: kuota scheduler menghitung semua status attempt; `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` belum job terpisah; `AGENTS.md` untracked.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.

## Next Session Handoff

1. Boot urut §11.14; jangan pindai ulang HLD/LLD.
2. **A3 — `YouTubeApiAdapter`** (`packages/youtube/src/youtube-api-adapter.ts`):
   - `validate`: batas judul ≤100, deskripsi ≤5000, caption sebagai deskripsi, aset ada/`valid`, privasi dari config;
   - `publish`: `videos.insert` **resumable** (`uploadType=resumable`) dengan `fetch`, `selfDeclaredMadeForKids=false`, `categoryId` default `27`;
   - `getStatus`: `videos.list?part=status,snippet` → verifikasi `privacyStatus` (mismatch → `limitations: ['privacy_not_applied']`, **bukan** `PUBLISHED`);
   - pemetaan error D6: `quotaExceeded`/`uploadLimitExceeded` → `NEEDS_ATTENTION` tanpa retry; `invalid_grant` → `reauth_required`; 5xx/timeout → retry policy.
3. **A4** wiring composition root + onboarding akun (`connection_status`, `secret_ref = dpapi:youtube:<accountId>`) + log status app saat boot · **A5** test HTTP palsu lengkap + smoke manual owner.
4. **Prasyarat faktual owner** untuk uji live: project Google Cloud + billing, jenis akun Google (Workspace/gmail), channel target, izin membuat OAuth client Desktop, konfirmasi privasi awal (`private` dianjurkan).
5. Jangan menyatakan P5 COMPLETED sebelum ada unggahan nyata yang terverifikasi (bukti `videos.list`).
6. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet.
