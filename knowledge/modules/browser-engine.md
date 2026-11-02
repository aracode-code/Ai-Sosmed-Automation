# Modul — Browser Engine (P3 Mock Flow + Sesi Flow)

**Status:** PARTIAL — mock adapter (video + gambar) + sesi profil Flow + adapter generasi nyata (`FlowPlaywrightGenerator`, dua mode) selesai; smoke nyata lewat CLI (gambar) dan lewat aplikasi (video, pembuatan sukses) terverifikasi, unduhan via worker menunggu uji ulang · commit `013531a`, `fd62314`, `a7aad95`; mode ganda 2026-11-02 (ADR-0012)
**Sumber:** kode aktual (E1). Keputusan: `ADR-0003` D16–D21, `ADR-0010` (F1–F7), `ADR-0012` (G5–G8). Kontrak: LLD §10.1, §10.4, §13.2, §7.3.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/browser-engine/src/types.ts` | `MediaGenerator`, `MediaGenerationRequest` (`kind?`, default `video`), `GeneratedMedia`, `MediaProbe`, `ProbeResult`; `AspectRatio`/`MediaKind` di-re-export dari `@saa/domain` |
| `packages/browser-engine/src/storage.ts` | `assertInsideRoot`: resolusi absolut + containment (case-insensitive di Windows) |
| `packages/browser-engine/src/mock-generator.ts` | `MockMediaGenerator`: video MP4 deterministik dari sha256 `${kind}\|${aspectRatio}\|${prompt}\|${correlationId}`, atau PNG RGB valid berukuran 72×128 / 128×72 / 96×96 sesuai rasio |
| `packages/browser-engine/src/media.ts` | `validateMediaFile`: containment → ukuran → magic (`ftyp` untuk video; signature PNG/JPEG untuk gambar) → sha256 → probe (hanya video) |
| `packages/browser-engine/src/probe.ts` | `unavailableProbe`, `createFfprobeProbe` (execFile, timeout 5 s, gagal → `available:false`) |
| `packages/browser-engine/src/profile-lock.ts` | `acquireProfileLock`, `ProfileBusyError` (`RESOURCE_BUSY`) |
| `packages/browser-engine/src/flow-session.ts` | `resolveFlowProfileDir`, `detectInstalledBrowser`, `resolveFlowBrowserChannel`, `checkFlowBrowser`, `openFlowSession` — profil persisten + lock + launcher Playwright (ADR-0010) |
| `packages/browser-engine/src/flow-inspect.ts` | `collectPageOutline` — outline input/tombol/heading + deteksi halaman login, dievaluasi di halaman (read-only) |
| `packages/browser-engine/src/flow-readiness.ts` | `inspectFlowReady(endpoint)` — cek prompt/kirim/tantangan tanpa mengubah apa pun |
| `packages/browser-engine/src/flow-generator.ts` | `generateFlowMedia` — setel `Browser.setDownloadBehavior` (dialog native diblokir), tutup panel Setelan via toggle `tune`, terapkan rasio dalam satu ekspresi async (render panel asinkron, verifikasi `aria-checked` sebelum `Simpan`) → isi prompt ProseMirror → kirim → tunggu hasil (`FLOW-VIDEO-TILE` poster) → unduh via menu `Opsi lainnya → Download → Ukuran asli` |
| `packages/browser-engine/src/flow-usage.ts` | Guard hitungan: `parseFlowGuard`, `decideGeneration`, ledger `parseLedger`/`appendUsage`/`updateLastStatus`, `dayOf` (Asia/Jakarta); `FlowMediaKind` = alias `MediaKind` |
| `packages/browser-engine/src/flow-playwright-generator.ts` | `FlowPlaywrightGenerator` (`MediaGenerator`) — meneruskan `kind` ke `generateFlowMedia` (tab Video atau Gambar), timeout render per jenis (video 15 menit, gambar 5 menit), menghitung sha256/ukuran/mime; `checkAvailability` dari `inspectFlowReady` |

Dependensi: `@saa/domain` + `playwright` (Chromium di `%LOCALAPPDATA%\ms-playwright`; ADR-0010 F1).

## MockMediaGenerator

- `checkAvailability()` selalu `{available:true}` (mock tanpa jaringan).
- **Video:** box `ftyp` (`isom`/`iso2`/`avc1`/`mp41`) + box `mdat` berisi byte berantai sha256; panjang payload 4096–12287 byte; durasi 8000–20000 ms. **Bukan video yang dapat diputar** — hanya artefak MP4-shaped untuk menguji pipeline.
- **Gambar:** PNG RGB 8-bit yang benar-benar dapat dibuka (IHDR/IDAT/IEND + CRC32), piksel deterministik; dimensi 72×128 (`9:16`), 128×72 (`16:9`), 96×96 (`1:1`).
- Nama berkas `<correlationId>_<6 byte digest>.mp4` atau `.png` — prompt/rasio/mode berbeda tidak menimpa artefak lama.
- Direktori dibuat rekursif; kegagalan tulis → `AppError('DISK')`.

## Validasi Media

| Tahap | Aturan | Kegagalan |
|---|---|---|
| Containment | berkas wajib di dalam `root` | `VALIDATION` |
| Ukuran | 1 KB – 512 MB, harus berkas biasa | `VALIDATION` |
| Magic | video: byte 4–8 = `ftyp`; gambar: signature PNG `89 50 4E 47 0D 0A 1A 0A` atau JPEG `FF D8 FF` | `VALIDATION` |
| Checksum | sha256 streaming = `expectedSha256` | `VALIDATION` |
| Probe | durasi > 0 bila probe tersedia — **hanya video**; gambar `durationMs = null` | `VALIDATION` |

Probe yang gagal dieksekusi menandai `available:false` dan **tidak** menggagalkan validasi (X-16).

## Lock Profil

- Berkas `.worker-lock.json` di direktori profil; dibuat dengan `wx` (eksklusif).
- TTL default 10 menit; lock kedaluwarsa/rusak diambil alih lewat tulis temp + rename atomik.
- `release()` hanya menghapus bila token cocok — lock worker lain tidak boleh dihapus.
- Konflik aktif → `ProfileBusyError` (`RESOURCE_BUSY` → retry policy default).
- Batasan jujur: pengambilalihan bersamaan dari dua proses adalah best-effort (last-write-wins pada rename); cocok untuk satu mesin lokal.

## Sesi Profil Flow (ADR-0010)

- `resolveFlowProfileDir()`: default `%LOCALAPPDATA%\saa\browser\flow-profile` (atau `~/.local/share/saa/browser/flow-profile` di non-Windows); `FLOW_PROFILE_DIR` hanya diterima bila **absolut**, selain itu `VALIDATION`.
- `detectInstalledBrowser()` / `resolveFlowBrowserChannel()`: pilih `chrome` bila terpasang, lalu `msedge`, fallback `chromium`; `FLOW_BROWSER_CHANNEL=chrome|msedge|chromium` menimpa. Chromium bawaan ditolak Google pada sign-in (F9).
- `DEFAULT_FLOW_URL = https://flow.google.com/` (F5); `flow:inspect --url` dibatasi ke host itu.
- `openFlowSession({ profileDir, url?, lockOwnerId?, channel?, launcher?, gotoTimeoutMs?, tolerateGotoFailure? })`: ambil lock profil → buka browser persisten headed → `goto` `domcontentloaded` (timeout 60 s) → kembalikan `{ page, close, waitForClose, releaseLock, lockPath, channel, navigationError }`.
- Mode **toleran** (`tolerateGotoFailure: true`, dipakai `flow:login`) mempertahankan jendela bila navigasi lambat/gagal dan mengisi `navigationError`; mode ketat (default, untuk adapter) menutup browser + `TRANSIENT_NETWORK`.
- Jalur gagal: launcher gagal → lock dilepas (`UNKNOWN`); `goto` gagal → browser ditutup + lock dilepas (`TRANSIENT_NETWORK`); `close()` selalu melepas lock.
- Sesi kedua selama lock aktif → `ProfileBusyError` (`RESOURCE_BUSY`).
- `checkFlowBrowser()`: memuat `playwright`, menghitung `chromium.executablePath()`, memeriksa keberadaan berkas — tanpa membuka jendela.
- **Batas:** aplikasi tidak mengisi kredensial, tidak menembus CAPTCHA/verifikasi; login sepenuhnya manual (`flow:login`).

## Perintah

```bash
corepack pnpm --filter @saa/browser-engine typecheck
corepack pnpm vitest run packages/browser-engine   # test paket: media (video/gambar), generator, lock, flow-session, flow-ratio, flow-usage
corepack pnpm --filter @saa/local-api flow:login --check   # cek profil + browser tanpa membuka jendela
corepack pnpm --filter @saa/local-api flow:login           # login manual, tunggu jendela ditutup
corepack pnpm --filter @saa/local-api flow:inspect [--url https://flow.google.com/…] [--wait ms]
corepack pnpm --filter @saa/local-api flow:generate --dry-run            # tanpa biaya
corepack pnpm --filter @saa/local-api flow:generate --kind image --prompt "…" --yes
```

Guard: `FLOW_MAX_GENERATIONS_PER_DAY` (default 1), `FLOW_REQUIRE_CONFIRM` (default true → butuh `--yes`), `FLOW_DRY_RUN`. Ledger: `data/flow-usage.json`. Hari dihitung Asia/Jakarta. Satu run bisa menghasilkan beberapa item (mis. gambar x2) — guard menghitung **run**, bukan item.

## Belum Ada (P3 penuh — tertahan OD-1)

- Smoke unduhan **lewat aplikasi** end-to-end: fix `Browser.setDownloadBehavior` sudah ada dan mekanismenya terbukti di uji terkontrol, tetapi handler worker belum dijalankan ulang (butuh 1 kredit dengan izin owner; ADR-0010 F31/F34).
- Tab **Gambar** Flow nyata belum diuji lewat aplikasi; timeout gambar 5 menit dan pemilihan tab hanya diuji dengan launcher palsu (ADR-0012).
- Guard/ledger `flow-usage` di jalur aplikasi (`FlowPlaywrightGenerator` tidak menerima `onSubmit` dan tidak membaca ledger; ADR-0010 F33).
- Retry tanpa submit untuk job yang medianya sudah tersimpan (retry saat ini men-submit ulang; ADR-0010 F34).
- Durasi media `null` bila `ffprobe` tidak terpasang (probe opsional).
- Pembersihan artefak lama dan kebijakan retensi media (OD-6).
