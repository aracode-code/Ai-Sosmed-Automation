# CURRENT — Task Aktif

**Session:** SESSION-2026-10-30-9
**Updated:** 2026-10-30T10:30:00+07:00
**Change class:** MEDIUM (modul adapter API baru di paket publikasi yang sudah ada; tanpa migrasi DB, route, dependensi, atau perubahan kontrak `SocialAdapter`)

## Active Task

_Tidak ada task aktif._ **Slice A3 (ADR-0008) selesai**: `YouTubeApiAdapter` — unggahan resumable + verifikasi privasi (commit `26e557a`).

| Field | Nilai |
|---|---|
| Task terakhir | **A3 — `YouTubeApiAdapter`** |
| Status | **P5 PARTIAL** — A1+A2+A3 DONE, A4–A5 belum; upload nyata UNVERIFIED · **P4c/P4b COMPLETED** · P4 PARTIAL (UI) · P3 PARTIAL (Flow) |
| Mode eksekusi | SINGLE-WRITER sequential |
| DoD tercapai | ✅ `validate` metadata + aset · ✅ `videos.insert` resumable via `fetch` · ✅ `getStatus` + verifikasi `privacyStatus` · ✅ pemetaan error D6 · ✅ 23 test baru · ✅ typecheck + 292 test · ✅ smoke boot |

## Bukti Slice A3 (aktual 2026-10-30)

| Bukti | Hasil |
|---|---|
| Commit | `26e557a` — `feat(p5-a3): adapter YouTube API dengan unggahan resumable dan verifikasi privasi` (4 file, +1124/−1) |
| Berkas baru | `packages/youtube/src/youtube-api-adapter.ts`, `packages/youtube/src/youtube-api-adapter.test.ts` |
| Berkas diubah | `packages/youtube/src/index.ts` (export), `apps/local-api/src/server.ts` (pesan `slice A4`) |
| Typecheck | PASS — 9 paket + `tests/tsconfig.json` |
| Test | `corepack pnpm test` → **37 file, 292 passed / 0 failed** (naik dari 269) |
| Test paket | `vitest run packages/youtube` → **59 test** (23 adapter + 21 OAuth + 9 credential store + 6 mock) |
| Smoke boot | `YOUTUBE_ADAPTER=api` port 4397 → peringatan `belum terhubung ke handler (slice A4)`, `/health` ok, port bebas |
| Dependensi | **Tidak ada penambahan** (node:fs, fetch global) |

## Kontrak A3 (yang harus dipakai A4)

| Hal | Nilai |
|---|---|
| Konstruksi | `new YouTubeApiAdapter({ store, clientId, clientSecret?, resolveAsset, privacy?, categoryId?, accountId?, fetchImpl?, ...endpoint/timeout })` |
| Resolusi aset | `resolveAsset(assetId) → { path, mimeType, sizeBytes } \| null` — disuntikkan; paket ini tidak menyentuh DB |
| Privasi | `request.visibility` (bila valid) → `options.privacy` → default `private`; `categoryId` default `27`; `selfDeclaredMadeForKids=false` |
| `publish` | Sesi `uploadType=resumable` → PUT seluruh berkas; sukses → `{ status:'processing' }` (bukti final dari `getStatus`) |
| Pemetaan idempoten | `idempotencyKey → { videoId, privacy, accountId }` **hanya di memori**; publish ulang dengan key sama tidak mengunggah lagi |
| `getStatus` | `videos.list?part=status&id=…`: `published` hanya bila `privacyStatus` sama dengan yang diminta; `failed/rejected/deleted` → `failed`; id tak dikenal → `unknown` |
| Error D6 | `quotaExceeded`/`dailyLimitExceeded`/`uploadLimitExceeded` → kelas `AUTH` (eskalasi, **tanpa** retry) · 401/403 → `AUTH` · 429 → `RATE_LIMIT` · 5xx saat inisialisasi → `EXTERNAL_5XX` · jaringan → `TRANSIENT_NETWORK` · 400 → `VALIDATION` |
| Pasca-unggah | Kegagalan setelah PUT dikirim **tidak** dilempar sebagai kelas retry; hasil `unknown` (`YT_UPLOAD_UNCERTAIN`/`YT_UPLOAD_INCOMPLETE`) → `NEEDS_ATTENTION` (hindari duplikat) |
| `capabilities` | `adapterVersion 'api-1'`; `authStatus` hanya bermakna bila `accountId` diisi (tanpa itu `disconnected`, bukan klaim palsu) |

Catatan penyimpangan rencana: `PublishResult` tidak punya field `limitations`, jadi mismatch privasi dinyatakan sebagai `errorCode: 'YT_PRIVACY_MISMATCH'` (→ `NEEDS_ATTENTION`), bukan `limitations: ['privacy_not_applied']`.

## Impact Map

- **Modul:** `youtube` (adapter API baru), `local-api` (hanya teks peringatan).
- **DB/route/migrasi:** tidak berubah (12 tabel, 15 route, 3 migrasi).
- **Rahasia:** token hanya dari `ensureFreshAccessToken` → header `Authorization`; session URI tidak pernah dicatat/dilog; test memakai HTTP palsu.
- **Belum tersambung:** composition root belum membuat adapter `api` (A4); `connection_status` belum ditulis; belum ada perintah pairing dari CLI/UI.

## Drift Tercatat

- A4–A5 belum ada → **P5 tetap PARTIAL**; upload nyata UNVERIFIED.
- Pemetaan idempotency → videoId hilang saat restart (hasil `unknown`, bukan tebakan) dan resume bertahap HTTP 308 belum diimplementasikan.
- F2 CONFLICT (privasi project unverified) dan klasifikasi scope `youtube.upload` hanya bisa dipastikan saat uji live.
- Drift lama: kuota scheduler menghitung semua status attempt; `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` belum job terpisah; `AGENTS.md` untracked.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.

## Next Session Handoff

1. Boot urut §11.14; jangan pindai ulang HLD/LLD.
2. **A4 — wiring + onboarding**:
   - `buildPublisher` cabang `api`: `new YouTubeApiAdapter({ store: new DpapiCredentialStore(), clientId/clientSecret dari loadYouTubeCredentials(), resolveAsset: (id) => { const m = getMediaAsset(db, id); return m === null ? null : { path: m.path, mimeType: m.mimeType, sizeBytes: m.sizeBytes }; }, privacy: env baru YOUTUBE_UPLOAD_PRIVACY (default private) })`;
   - perintah pairing akun (CLI/route) → `pairYouTubeAccount` + tulis `social_accounts.secret_ref = 'dpapi:youtube:<accountId>'` + `connection_status='connected'`;
   - kegagalan `AUTH`/`reauth_required` dari adapter → set akun `reauth_required` (bukan retry);
   - log boot status app OAuth hanya dari laporan owner (tidak bisa dibaca API).
3. **A5** — perluas test HTTP palsu lintas handler `PUBLISH` + adapter (retry/eskalasi), lalu smoke manual owner di channel sah.
4. **Prasyarat faktual owner** untuk uji live: project Google Cloud + billing, jenis akun Google (Workspace/gmail), channel target, izin membuat OAuth client Desktop, konfirmasi privasi awal (`private` dianjurkan).
5. Jangan menyatakan P5 COMPLETED sebelum ada unggahan nyata yang terverifikasi (bukti `videos.list`).
6. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet.
