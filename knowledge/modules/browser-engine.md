# Modul — Browser Engine (P3 Mock Flow)

**Status:** PARTIAL — mock adapter selesai; Flow asli tertahan OD-1 (2026-10-30) · commit `013531a`
**Sumber:** kode aktual (E1). Keputusan: `ADR-0003` D16–D21. Kontrak: LLD §10.1, §10.4, §13.2, §7.3.

## Peta Paket

| Berkas | Tanggung jawab |
|---|---|
| `packages/browser-engine/src/types.ts` | `VideoGenerator`, `VideoGenerationRequest`, `GeneratedVideo`, `MediaProbe`, `ProbeResult` |
| `packages/browser-engine/src/storage.ts` | `assertInsideRoot`: resolusi absolut + containment (case-insensitive di Windows) |
| `packages/browser-engine/src/mock-generator.ts` | `MockVideoGenerator`: artefak MP4 deterministik dari sha256 `${aspectRatio}\|${prompt}\|${correlationId}` |
| `packages/browser-engine/src/media.ts` | `validateMediaFile`: containment → ukuran → magic `ftyp` → sha256 → probe opsional |
| `packages/browser-engine/src/probe.ts` | `unavailableProbe`, `createFfprobeProbe` (execFile, timeout 5 s, gagal → `available:false`) |
| `packages/browser-engine/src/profile-lock.ts` | `acquireProfileLock`, `ProfileBusyError` (`RESOURCE_BUSY`) |

Dependensi: `@saa/domain` saja — tidak ada Playwright, ffprobe, atau database.

## MockVideoGenerator

- `checkAvailability()` selalu `{available:true}` (mock tanpa jaringan).
- Berkas = box `ftyp` (`isom`/`iso2`/`avc1`/`mp41`) + box `mdat` berisi byte berantai sha256.
- Panjang payload 4096–12287 byte; durasi 8000–20000 ms; keduanya diturunkan dari digest permintaan.
- Nama berkas `<correlationId>_<6 byte digest>.mp4` — prompt berbeda tidak menimpa artefak lama.
- Direktori dibuat rekursif; kegagalan tulis → `AppError('DISK')`.
- **Bukan video yang dapat diputar** — hanya artefak MP4-shaped untuk menguji pipeline.

## Validasi Media

| Tahap | Aturan | Kegagalan |
|---|---|---|
| Containment | berkas wajib di dalam `root` | `VALIDATION` |
| Ukuran | 1 KB – 512 MB, harus berkas biasa | `VALIDATION` |
| Magic | byte 4–8 = `ftyp` | `VALIDATION` |
| Checksum | sha256 streaming = `expectedSha256` | `VALIDATION` |
| Probe | durasi > 0 bila probe tersedia | `VALIDATION` |

Probe yang gagal dieksekusi menandai `available:false` dan **tidak** menggagalkan validasi (X-16).

## Lock Profil

- Berkas `.worker-lock.json` di direktori profil; dibuat dengan `wx` (eksklusif).
- TTL default 10 menit; lock kedaluwarsa/rusak diambil alih lewat tulis temp + rename atomik.
- `release()` hanya menghapus bila token cocok — lock worker lain tidak boleh dihapus.
- Konflik aktif → `ProfileBusyError` (`RESOURCE_BUSY` → retry policy default).
- Batasan jujur: pengambilalihan bersamaan dari dua proses adalah best-effort (last-write-wins pada rename); cocok untuk satu mesin lokal.

## Perintah

```bash
corepack pnpm --filter @saa/browser-engine typecheck
corepack pnpm vitest run packages/browser-engine   # 13 test (media, generator, lock)
```

## Belum Ada (P3 penuh — tertahan OD-1)

- Adapter Flow nyata (Playwright session manager, unggah prompt, unduh hasil, deteksi tantangan keamanan).
- Pemetaan `SECURITY_CHALLENGE`/`UI_CHANGED` dari halaman Flow.
- `checkAvailability` berbasis sesi/akun nyata.
- Pembersihan artefak lama dan kebijakan retensi media (OD-6).
