# Project Memory (L1)

> Memori permanen terverifikasi. Entri 1–14 bersumber `HLD.md`/`LLD.md` v1.0 (E5).
> Entri bagian "Keputusan yang Sudah Diambil" yang menyebut commit bersumber kode aktual (E1).

## Invariant Wajib

1. **`PUBLISHED` butuh bukti.** Status hanya diberikan setelah verifikasi hasil eksternal. `unknown` tidak sama dengan `failed`. — HLD §7.1, §7.3; LLD §4.2, §11.4
2. **Idempotency sebelum aksi eksternal.** Tandai `PUBLISHING` + simpan `idempotency_key` unik sebelum upload; simpan external post ID segera. — HLD §7.3; LLD §5.1, §11.4
3. **Operasi ambigu wajib direkonsiliasi sebelum diulang.** — HLD §7.2; LLD §15
4. **Satu profil browser = satu worker.** Job `PUBLISHING`/`VERIFYING` tidak boleh diulang tanpa reconciliation. — LLD §7.3
5. **Approval terikat pada** `contentId + version + assetSha256 + captionHash + accountId + platform`; perubahan salah satunya membatalkan approval. — LLD §12.1
6. **Transisi status lewat domain murni** `transitionJob(current, event)`; transisi ilegal ditolak dan dicatat. — LLD §4.2
7. **Transaksi SQLite tidak ditahan** selama browser, API AI, atau upload berjalan; gunakan lease + perpanjangan. — LLD §5.3
8. **Kredensial:** API key/OAuth token hanya di Credential Manager/DPAPI; DB menyimpan `secret_ref`; redaksi di log/error. — HLD §9.1; LLD §13.1
9. **Local API bind loopback**, validasi Origin, token sesi lokal, rate limit; path file divalidasi terhadap root storage. — HLD §9.2; LLD §13.2
10. **Tanpa penghindaran proteksi platform** (CAPTCHA, anti-bot, login challenge): worker berhenti dan status menjadi `NEEDS_ATTENTION`. — HLD §2.2; LLD §10.3, §15
11. **Scheduler persisten:** `next_run_at` disimpan; restart tidak mengacak ulang; pause menghentikan dispatch baru, bukan menghapus jadwal. — HLD §8; LLD §8.2
12. **Kegagalan satu platform tidak menggagalkan publication job lain.** — HLD §5; LLD §4.3
13. **Output AI = data tidak tepercaya** sampai lolos skema + policy; JSON invalid → retry terbatas → `NEEDS_ATTENTION`. — LLD §9.1, §9.3
14. **`capabilities()` harus jujur:** fitur belum terverifikasi = `unknown`/`unsupported`. — HLD §6; LLD §11.3

## Batasan Eksternal yang Menentukan Prioritas

- Google Flow tidak diasumsikan punya API publik; adapter = UI automation yang rapuh → isolasi adapter + smoke test + fallback manual. — HLD §6; LLD §10.4, §19.1
- Publikasi langsung tiap platform bergantung izin/aplikasi yang disetujui. Adapter hanya ditandai lulus setelah diuji pada akun berwenang. — LLD §17, §19

## Keputusan yang Sudah Diambil

- 2026-10-29 — Root canonical knowledge = `knowledge/`; `HLD.md`/`LLD.md` tetap di root repo sebagai sumber arsitektur canonical dan tidak disalin ke `knowledge/architecture/`, agar tidak ada dua salinan yang bisa drift.
- 2026-10-30 — (E1) Transisi status **tidak boleh** ditulis langsung: dispatcher hanya bisa lewat `HandlerContext.transition` yang memanggil `transitionJob`; `VERIFICATION_SUCCEEDED` tanpa `externalPostId`/`permalink` + `verifiedAt` ditolak.
- 2026-10-30 — (E1) Migrasi = `packages/database/migrations/*.sql` + tabel `schema_migrations`; `drizzle-kit generate` hanya menghasilkan SQL, jurnal `__drizzle_migrations` tidak dipakai.
- 2026-10-30 — (E1) Klaim antrean memakai transaksi `immediate()` + `UPDATE` terjaga kondisi lease; transaksi ditutup sebelum pekerjaan eksternal (sesuai invariant 7).
- 2026-10-30 — (E1) Script pnpm berjalan di direktori paket: `DATABASE_PATH` relatif wajib diresolusi terhadap root workspace (`packages/database/src/paths.ts`).
- 2026-10-30 — Detail keputusan: `knowledge/decisions/ADR-0001-p1-stack-baseline.md`.
