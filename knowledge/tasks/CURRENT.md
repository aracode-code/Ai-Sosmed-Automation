# CURRENT — Task Aktif

**Session:** SESSION-2026-10-30-10
**Updated:** 2026-10-30T11:45:00+07:00
**Change class:** MEDIUM (komposisi runtime + repository + CLI baru; tanpa migrasi DB, route baru, dependensi, atau perubahan kontrak `SocialAdapter`)

## Active Task

_Tidak ada task aktif._ **Slice A4 (ADR-0008) selesai**: wiring composition root + onboarding akun YouTube (commit `0b4194f`).

| Field | Nilai |
|---|---|
| Task terakhir | **A4 — wiring + onboarding akun** |
| Status | **P5 PARTIAL** — A1+A2+A3+A4 DONE, A5 belum; upload nyata UNVERIFIED · **P4c/P4b COMPLETED** · P4 PARTIAL (UI) · P3 PARTIAL (Flow) |
| Mode eksekusi | SINGLE-WRITER sequential |
| DoD tercapai | ✅ adapter `api` dibuat composition root · ✅ `resolveAsset` dari `media_assets` · ✅ env privat/status app · ✅ CLI pairing menulis `secret_ref` + `connection_status` · ✅ `reauth_required` disinkronkan · ✅ 9 test baru · ✅ typecheck + 301 test · ✅ smoke boot + smoke CLI |

## Bukti Slice A4 (aktual 2026-10-30)

| Bukti | Hasil |
|---|---|
| Commit | `0b4194f` — `feat(p5-a4): wiring composition root dan onboarding akun YouTube` (11 file, +667/−24) |
| Berkas baru | `apps/local-api/src/publisher.ts`, `apps/local-api/src/publisher.test.ts`, `apps/local-api/src/pair-youtube.ts`, `packages/database/src/repositories/accounts.test.ts` |
| Berkas diubah | `apps/local-api/src/{config,config.test,server}.ts`, `apps/local-api/package.json`, `packages/database/src/repositories/accounts.ts`, `packages/youtube/src/youtube-api-adapter{,.test}.ts` |
| Typecheck | PASS — 9 paket + `tests/tsconfig.json` |
| Test | `corepack pnpm test` → **39 file, 301 passed / 0 failed** (naik dari 292) |
| Test baru | 9: repository `updateAccountConnection` (3), `createYouTubeApiPublisher` (3), hook `onReauthRequired` (2), config env baru (1) |
| Smoke boot | `YOUTUBE_ADAPTER=api` + `YOUTUBE_APP_STATUS=testing` port 4411 → log `error` Testing, log adapter aktif (`privacy: private`), `handlers: ["GENERATE_VIDEO","PUBLISH"]`, `/health` ok, port bebas |
| Smoke CLI | `pair:youtube` tanpa argumen / akun hilang / port invalid / tanpa client id → exit 2 dengan pesan tepat; `--label` dua kali → tetap 1 baris akun `disconnected` |
| Dependensi | **Tidak ada penambahan** |

## Kontrak A4 (yang harus dipakai A5)

| Hal | Nilai |
|---|---|
| Konstruksi | `createYouTubeApiPublisher({ db, config, credentials, store?, fetchImpl? })` → `SocialAdapter` (platform `youtube`) |
| Aset | `resolveAsset` membaca `getMediaAsset(db, assetId)`; `null` → `validate` menolak & `publish` melempar `VALIDATION` |
| Privasi | `AppConfig.youtubeUploadPrivacy` (env `YOUTUBE_UPLOAD_PRIVACY`, default `private`) |
| Status app | `AppConfig.youtubeAppStatus` (env `YOUTUBE_APP_STATUS`, default `unknown`); `testing` → log `error` saat boot; tidak dapat dibaca dari API |
| Reauth | Hook `onReauthRequired(accountId)` → `updateAccountConnection(…, 'reauth_required')`; panggilan `publish`/`getStatus` berikutnya ditolak handler (`AUTH`) sampai pairing ulang |
| Onboarding | `corepack pnpm --filter @saa/local-api pair:youtube -- --account <id> \| --label "<label>" [--port <n>]`; butuh `GOOGLE_OAUTH_CLIENT_ID` |
| `secret_ref` | `dpapi:youtube:<accountId>` (helper `youtubeSecretRef`) |
| Browser | `rundll32 url.dll,FileProtocolHandler <url>` — URL tidak melewati shell |

## Impact Map

- **Modul:** `youtube` (hook adapter), `database` (update akun), `local-api` (composition root, CLI, config).
- **DB/route/migrasi:** tidak berubah (12 tabel, 15 route, 3 migrasi).
- **Rahasia:** token hanya di blob DPAPI + header `Authorization`; CLI mencetak nama kredensial dan waktu, bukan token; `GOOGLE_OAUTH_CLIENT_ID` tetap di luar `AppConfig`.
- **Belum tersambung:** uji lintas handler `PUBLISH` + adapter nyata dan smoke live (A5).

## Drift Tercatat

- A5 belum ada → **P5 tetap PARTIAL**; upload nyata UNVERIFIED.
- `capabilities().authStatus` adapter `api` masih `disconnected` karena `accountId` tidak diisi composition root (dipakai hanya bila satu akun dipilih manual).
- Pemetaan idempotency → videoId hilang saat restart (hasil `unknown`, bukan tebakan); resume bertahap HTTP 308 belum ada.
- F2 CONFLICT (privasi project unverified) dan klasifikasi scope `youtube.upload` hanya bisa dipastikan saat uji live.
- Drift lama: kuota scheduler menghitung semua status attempt; `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` belum job terpisah; `AGENTS.md` untracked.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.

## Next Session Handoff

1. Boot urut §11.14; jangan pindai ulang HLD/LLD.
2. **A5 — uji lintas handler + smoke live**:
   - test integrasi `PUBLISH` handler + `YouTubeApiAdapter` dengan HTTP palsu: jalur `published`, `failed` non-retryable, `processing` → `NEEDS_ATTENTION`, dan `reauth_required` → attempt `unknown` + akun `reauth_required`;
   - verifikasi handler menolak akun `reauth_required` sebelum aksi eksternal (`AUTH` → `NEEDS_ATTENTION`, tanpa attempt baru);
   - smoke manual owner: pairing nyata lalu unggah satu video `private`, bukti dari `videos.list`.
3. **Prasyarat faktual owner** untuk uji live: project Google Cloud + billing, jenis akun Google (Workspace/gmail), channel target, izin membuat OAuth client Desktop, status app (Production/Internal), konfirmasi privasi awal.
4. Jangan menyatakan P5 COMPLETED sebelum ada unggahan nyata yang terverifikasi (bukti `videos.list`).
5. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet.
