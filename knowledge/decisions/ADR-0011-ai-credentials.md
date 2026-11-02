# ADR-0011 — Kunci DeepSeek: DPAPI lewat UI + Planner Lazy

**Status:** Accepted (diputuskan agen di L1 atas perintah owner "sediakan juga untuk input apikey deepsik", pilihan owner: **DPAPI via UI**, 2026-11-02)
**Tanggal:** 2026-11-02
**Konteks:** `PLAN_CONTENT` hanya terdaftar bila `DEEPSEEK_API_KEY` ada di environment proses API, sehingga kunci tidak dapat diisi dari aplikasi dan produksi konten otomatis praktis tidak bisa dipakai tanpa restart. Owner meminta alur kerja "manusia input permintaan → agen menyusun rencana → manusia menyetujui → agen bekerja"; kunci AI adalah prasyaratnya.
**Ruang lingkup:** **hanya Slice 1** — penyimpanan kunci + planner lazy + input UI. Rencana kerja ber-approval (slice 2–4) **belum** diimplementasikan.

## Keputusan

| ID | Keputusan | Alasan | Revisit bila |
|---|---|---|---|
| A1 | Kunci disimpan sebagai payload `{ apiKey }` di DPAPI dengan nama `deepseek-api-key` melalui `DpapiCredentialStore` yang sudah ada (`%LOCALAPPDATA%\saa\credentials\deepseek-api-key.bin`) | Satu jalur penyimpanan rahasia untuk seluruh aplikasi (token YouTube + kunci AI), tanpa tabel/kolom DB baru dan tanpa nilai rahasia di repo | Butuh multi-kunci (beberapa provider) → prefiks nama per provider |
| A2 | **Presedensi: DPAPI menang, environment fallback.** Manager memuat store lalu env; `source` melaporkan asal nilai | Owner mengetik kunci di UI dan mengharapkan efek langsung; env tetap jalan untuk CI/headless tanpa mengubah perilaku lama | Kebijakan "env selalu menang" diminta owner |
| A3 | Planner **selalu terdaftar**; `createLazyPlanner` meresolusi kunci **per job** dan membuat `Planner` baru bila kunci berubah | Kunci yang baru disimpan berlaku tanpa restart API; tanpa kunci, job `PLAN_CONTENT` berakhir `NEEDS_ATTENTION` dengan kelas `AUTH` (tidak di-retry), bukan `NO_HANDLER` yang menyesatkan | Planner perlu dibuat sekali saat boot karena alasan biaya |
| A4 | API hanya **tulis-saja** untuk nilai kunci: `POST /api/v1/ai/credentials` body `.strict()` `{ apiKey: string 10–200 }` → `200 { configured: true, source: 'store' }`; `GET /api/v1/ai/status` → `{ configured, source, storeError }` | Nilai kunci tidak pernah dikirim balik ke UI/log; `200` JSON (bukan `204`) karena `sendJson` dashboard selalu mem-parse JSON | Dashboard berhenti mem-parse JSON tanpa body |
| A5 | Produksi konten terjadwal **ditahan** saat `isConfigured() === false`; publikasi konten yang sudah ada tetap berjalan | Slot yang menghasilkan job `PLAN_CONTENT` tanpa kunci pasti berakhir `NEEDS_ATTENTION`; menahannya mencegah antrean sampah | Ada antrean job yang boleh menunggu kunci |
| A6 | Kegagalan membaca store tidak menjatuhkan API: `storeError=true`, fallback env, peringatan di log, dan UI menampilkan "isi ulang kunci" | Berkas DPAPI rusak/berpindah user tidak boleh membuat seluruh API gagal boot | Store mendukung rotasi otomatis |
| A7 | Validasi kunci di UI (tombol nonaktif < 10 karakter) **dan** server (`min(10).max(200)`, `trim`); nilai tidak pernah dirender (input `type=password`) | Lapisan UI saja tidak cukup; server tetap sumber kebenaran validasi | Format kunci provider berubah |
| A8 | Uji otomatis memakai `CredentialStore` palsu di memori; smoke DPAPI memakai `LOCALAPPDATA` scratch agar store asli tidak tercemar kunci uji | Kebijakan "jangan menulis rahasia uji ke store nyata"; test tidak boleh bergantung pada Windows | — |

## Konsekuensi

- `buildHandlerRegistry` menerima `planner` **selalu**; `buildHandlerRegistry({ db, mediaRoot })` tanpa planner tetap tidak mendaftarkan `PLAN_CONTENT` (kontrak test lama dipertahankan).
- Kunci yang diisi lewat UI langsung dipakai job berikutnya; job `PLAN_CONTENT` yang sudah `NEEDS_ATTENTION` karena `AUTH` perlu di-retry manual setelah kunci diisi.
- `state`/log/UI hanya memuat status (`configured`, `source`, `storeError`), tidak pernah nilai kunci.
- Alur approval rencana kerja (slice 2–4) belum ada; rencana tertulis: planner mengembalikan `items[]`, job menunggu approval sebelum `GENERATE_VIDEO`, migrasi `0003_plan_approvals.sql`, satu gerbang (setelah rencana disetujui, pembuatan + publikasi otomatis).

## Bukti

- Commit kode `1dfcadf`; file: `apps/local-api/src/{ai-credentials,lazy-planner}.ts`, `apps/local-api/src/routes/ai-credentials.ts`, wiring `app.ts`/`server.ts`, `apps/dashboard/src/{types.ts,pages/ConnectionsPage.tsx}`.
- Test: 3 berkas baru (15 test) → workspace **56 file / 458 test** hijau; typecheck 10 paket + `tests/tsconfig.json` PASS.
- Smoke UI headless 1280×900: status berubah `belum diisi → terkonfigurasi (DPAPI)`, kunci tidak muncul di DOM/log, input dikosongkan; berkas DPAPI scratch 262 byte; store asli `%LOCALAPPDATA%\saa\credentials` tidak berisi `deepseek-api-key.bin`. Scratch dihapus setelah verifikasi.
