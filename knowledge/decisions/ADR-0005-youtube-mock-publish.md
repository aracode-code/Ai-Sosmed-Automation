# ADR-0005 — Publikasi YouTube Mock, PUBLISH Handler, Verify/Reconcile

**Status:** Accepted (diputuskan agen di L1) — revisitable
**Tanggal:** 2026-10-30
**Konteks:** commit `7d13431` · SESSION-2026-10-30-3

## Konteks

Fase P5 menuntut adapter publikasi pertama (LLD §11.1, §11.4) beserta alur verify/reconcile dan test retry. Owner memilih **"P5 YouTube (mock dulu)"**: bangun kontrak + adapter mock + handler, tandai upload nyata **UNVERIFIED** sampai OD-2/OD-5 dijawab. Tanpa fase ini job `PUBLISH` selalu berakhir `NEEDS_ATTENTION` + `NO_HANDLER`.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| Y1 | Kontrak `SocialAdapter` (`capabilities`/`validate`/`publish`/`getStatus`) dan tipe `PublishRequest`/`PublishResult`/`PlatformCapabilities` hidup di `@saa/domain` | Adapter mengimplementasikan interface domain (LLD §3); workflow bergantung pada kontrak, bukan vendor | Kontrak perlu field per platform yang tak dapat digeneralisasi |
| Y2 | `PublishAttempt` dicatat **sebelum** aksi eksternal dengan `idempotency_key = publish:<jobId>` (unik di DB); replay memakai baris yang sama | Invariant "idempotency sebelum aksi eksternal" (HLD §7.3); replay tidak boleh menggandakan attempt | Butuh attempt per target dalam satu job |
| Y3 | Status akhir **hanya** dari rekonsiliasi `getStatus`, bukan dari `publish()`; `processing`/`unknown` → `AMBIGUOUS_RESULT` → `NEEDS_ATTENTION` | `unknown` ≠ `failed` (HLD §7.1); retry buta dilarang (HLD §7.2) | Adapter menyediakan bukti kuat saat publish |
| Y4 | `PUBLISH_STARTED` diterima dari `SCHEDULED` **dan** `QUEUED` | `promoteDueRetries` selalu mengembalikan job retry ke `QUEUED`; tanpa ini retry publikasi tidak akan pernah bisa jalan | `claimDueJob` diubah agar mempertahankan status retry |
| Y5 | Jalur retry publikasi: `PUBLISHING → PUBLISH_SUBMITTED → VERIFYING → VERIFICATION_FAILED → RETRY_WAIT`; handler menaikkan `attempts` dan menulis `run_at = now + backoff`; `maxAttempts` → `PERMANENT_FAILURE` | `RETRYABLE_FAILURE` ditolak dari `PUBLISHING` (ADR-0003); `VERIFYING` adalah jalur resmi ke `RETRY_WAIT` | State machine diubah eksplisit (butuh ADR baru) |
| Y6 | Error adapter yang `classify` = `retry` dikonversi handler menjadi jadwal retry; kelas escalate (`AUTH`, `SECURITY_CHALLENGE`, …) direthrow agar dispatcher mengeksekusi eskalasi standar; `VALIDATION` → `FAILED` | Satu kebijakan retry: `retry.ts`; tidak ada logika ganda | — |
| Y7 | Binding approval (6 elemen) ditegakkan sebelum aksi eksternal; mismatch → `VALIDATION` **tanpa** attempt | Approval yang berubah membatalkan izin (LLD §12.1) | — |
| Y8 | Adapter mock memakai prefiks `mock_` untuk semua post id dan mendeklarasikan `limitations` (tanpa unggahan nyata, kuota/izin belum diverifikasi) | Baris DB tidak dapat disalahartikan sebagai publikasi nyata; `capabilities()` wajib jujur (LLD §11.3) | Adapter YouTube nyata tersedia |
| Y9 | Runtime opt-in `YOUTUBE_ADAPTER=mock` (default `off`); tanpa opt-in, `PUBLISH` tidak terdaftar → job `NEEDS_ATTENTION` + `NO_HANDLER` + log peringatan | Default tidak boleh menghasilkan `PUBLISHED` palsu di data owner | Adapter nyata terverifikasi |
| Y10 | Audit `content.publish` (`published`/`failed`/`needs_attention`) ditulis ke `audit_logs` dengan `resource_type = publish_attempt` | Jejak tindakan eksternal harus dapat diaudit (LLD §13) | — |

## Konsekuensi

- Job publikasi kini berjalan end-to-end di runtime mock: konten disetujui → `PUBLISH` → `PUBLISHED` dengan bukti `mock_yt_*` + `verifiedAt`, terverifikasi lewat test dan smoke boot.
- **Upload nyata tetap UNVERIFIED**: tidak ada OAuth, kuota, izin, atau batas media YouTube yang diuji. Adapter nyata menunggu OD-2/OD-5.
- Kuota scheduler masih menghitung semua baris `publish_attempts` tanpa pengecualian status (lihat open items).
- `VERIFY_PUBLICATION` dan `RECONCILE_PUBLICATION` belum menjadi job terpisah; rekonsiliasi terjadi inline di handler `PUBLISH`.
- Tidak ada yang membuat job `PUBLISH` secara otomatis: dispatch jadwal periodik dan pembuatan job publikasi masih belum ada (P4 PARTIAL).

## Bukti

| Bukti | Hasil |
|---|---|
| Typecheck | 9 paket (`domain`, `database`, `workflow`, `youtube`, `agent-core`, `browser-engine`, `observability`, `scheduler`, `local-api`) + `tests/tsconfig.json` PASS |
| Test suite | 29 file, **212 passed / 0 failed** |
| Test baru | `packages/youtube/src/mock-adapter.test.ts` (6), `packages/workflow/src/handlers/publish.test.ts` (10), state-machine +1, registry/composition root +2, config +1 |
| Smoke boot (mock) | `YOUTUBE_ADAPTER=mock` port 4391 → `/health` `{workers:{active:1}}`; log `handlers:["GENERATE_VIDEO","PUBLISH"]` + peringatan mock; proses dihentikan |
| Smoke boot (default off) | port 4392 tanpa `YOUTUBE_ADAPTER` → log `handlers:["GENERATE_VIDEO"]` + peringatan `off`; proses dihentikan, kedua port diverifikasi bebas |
| Jaringan | Tidak ada panggilan YouTube/DeepSeek nyata; tidak ada kredensial diset saat smoke |

## Open Items (jangan diisi tanpa keputusan)

- OD-2 (izin/aplikasi publikasi) dan OD-5 (OAuth per platform) tetap OPEN → adapter YouTube nyata belum boleh dibangun/diklaim lulus.
- Status `publish_attempts` yang dihitung kuota harian belum ditetapkan (saat ini semua status dihitung).
- Job `VERIFY_PUBLICATION`/`RECONCILE_PUBLICATION` terpisah: perlu diputuskan bila verifikasi perlu berjalan asinkron di job sendiri.
