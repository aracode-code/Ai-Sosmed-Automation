# CURRENT — Task Aktif

**Session:** SESSION-2026-10-30-11
**Updated:** 2026-10-30T12:45:00+07:00
**Change class:** SMALL (hanya menambah test integrasi lintas lapisan; tanpa perubahan kode produksi, migrasi, route, atau dependensi)

## Active Task

_Tidak ada task aktif._ **Slice A5 (ADR-0008) sebagian selesai**: uji lintas lapisan `PUBLISH` handler × `YouTubeApiAdapter` (commit `df9a2b7`). Sisa A5: smoke live owner.

| Field | Nilai |
|---|---|
| Task terakhir | **A5 — uji lintas lapisan (`tests/integration/p5-publish-youtube-api.test.ts`)** |
| Status | **P5 PARTIAL** — A1–A5 (uji lintas) DONE; smoke live + upload nyata UNVERIFIED · **P4c/P4b COMPLETED** · P4 PARTIAL (UI) · P3 PARTIAL (Flow) |
| Mode eksekusi | SINGLE-WRITER sequential |
| DoD tercapai | ✅ rantai nyata handler → composition root → adapter API · ✅ 5 skenario (published/mismatch/rejected/kuota/reauth) · ✅ typecheck + 306 test · ✅ bukti 0 panggilan eksternal untuk akun `reauth_required` |

## Bukti Slice A5 (aktual 2026-10-30)

| Bukti | Hasil |
|---|---|
| Commit | `df9a2b7` — `test(p5-a5): uji lintas lapisan handler publish dan adapter youtube api` (1 file, +357) |
| Berkas baru | `tests/integration/p5-publish-youtube-api.test.ts` |
| Typecheck | PASS — 9 paket + `tests/tsconfig.json` |
| Test | `corepack pnpm test` → **40 file, 306 passed / 0 failed** (naik dari 301) |
| Skenario 1 — sukses | job `PUBLISHED`; attempt `published` + `externalPostId 'yt_vid_a5'` + permalink + `verifiedAt`; urutan `POST`/`PUT`/`GET`; body init `categoryId 27`, `privacyStatus private`, `selfDeclaredMadeForKids false` |
| Skenario 2 — privasi beda | attempt `unknown` + `YT_PRIVACY_MISMATCH`, job `NEEDS_ATTENTION`, attempts 0 |
| Skenario 3 — video ditolak | job `FAILED` + `YT_UPLOAD_REJECTED`, attempt `failed`, attempts 1, tanpa retry |
| Skenario 4 — kuota 403 | job `NEEDS_ATTENTION` + `AUTH`, attempt `unknown`, attempts 1, `runAt` null, **1 panggilan** (tidak ada byte terunggah), akun tetap `connected` |
| Skenario 5 — belum dipasangkan | attempt `unknown` + `AUTH`, akun → `reauth_required` lewat hook, **0 panggilan**; job kedua ditolak penjaga `connection_status` (0 attempt, 0 panggilan) |

## Temuan yang Mengikat A6/uji live

| Temuan | Dampak |
|---|---|
| `Dispatcher.handleFailure` menaikkan `attempts` pada eskalasi (`ESCALATE` → `NEEDS_ATTENTION`) | Asersi "tanpa retry" harus memeriksa `runAt === null`, bukan `attempts === 0`; jalur `unknown` dari `getStatus` tidak menaikkan attempts (eskalasi internal handler) |
| `YouTubeApiAdapter.getStatus` tidak pernah mengembalikan `processing` | Jalur "belum terverifikasi" diwakili `unknown` (privasi beda / video tak ditemukan / idempoten tak dikenal); handler memperlakukannya sebagai `NEEDS_ATTENTION` |
| Handler menolak akun non-`connected` **sebelum** `adapter.validate`/`publish` | `reauth_required` tidak pernah menghasilkan unggahan atau attempt baru — dikonfirmasi lintas lapisan, bukan hanya unit |
| Token tidak ada di DPAPI → `ensureFreshAccessToken` mengembalikan `null` tanpa memanggil jaringan | Uji reauth aman dijalankan tanpa kredensial nyata |

## Impact Map

- **Modul:** `tests/integration` (baru), memakai `@saa/workflow`, `@saa/database`, `@saa/domain`, dan `apps/local-api/src/{config,publisher}`.
- **DB/route/migrasi:** tidak berubah (12 tabel, 15 route, 3 migrasi).
- **Rahasia:** token hanya di store memori; tidak ada kredensial nyata, tidak ada panggilan jaringan.
- **Catatan dependensi:** `@saa/youtube` tidak ada di `devDependencies` root, sehingga test memakai bentuk struktural `CredentialStore` alih-alih impor paket; tidak ada perubahan `package.json`/lockfile.

## Drift Tercatat

- Smoke live belum → **P5 tetap PARTIAL**; upload nyata UNVERIFIED.
- `capabilities().authStatus` adapter `api` masih `disconnected` karena composition root tidak mengisi `accountId` (status nyata ada di `social_accounts.connection_status`).
- Pemetaan idempotency → videoId hilang saat restart (hasil `unknown`, bukan tebakan); resume bertahap HTTP 308 belum ada.
- F2 CONFLICT (privasi project unverified) dan klasifikasi scope `youtube.upload` hanya bisa dipastikan saat uji live.
- Drift lama: kuota scheduler menghitung semua status attempt; `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` belum job terpisah; `AGENTS.md` untracked.

## Team Scope

_Tidak ada gelombang aktif._ `state.open_wave = null`.

## Next Session Handoff

1. Boot urut §11.14; jangan pindai ulang HLD/LLD.
2. **Sisa A5 — smoke live (owner)**: pairing nyata `corepack pnpm --filter @saa/local-api pair:youtube -- --label "<channel>"` dengan `GOOGLE_OAUTH_CLIENT_ID` valid, lalu satu unggahan `private` dan bukti `videos.list` (`privacyStatus private`). Catat respons nyata untuk F2/F6/F7.
3. **Prasyarat faktual owner**: project Google Cloud + billing, jenis akun Google (Workspace/gmail), channel target, izin membuat OAuth client Desktop, status app (Production/Internal), konfirmasi privasi awal.
4. Jangan menyatakan P5 COMPLETED sebelum ada unggahan nyata yang terverifikasi (bukti `videos.list`).
5. Pilihan lain yang masih terbuka: approval UI desktop, OD-1 (Flow nyata), kebijakan saat publikasi macet.
