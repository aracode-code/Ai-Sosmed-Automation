# Low-Level Design (LLD)
## AI Social Media Automation Agent

**Versi:** 1.0  
**Status:** Draft implementasi — baseline teknis  
**Dokumen induk:** HLD v1.0  
**Target:** Windows PC lokal

---

> Catatan: Markdown ini dikonversi dari LLD DOCX v1.0. Tabel dan struktur utama dipertahankan. Periksa kembali blok kode dan diagram sebelum menjadikannya kontrak final implementasi.

LOW-LEVEL DESIGN

# AI Social Media
Automation Agent

Spesifikasi implementasi untuk coding agent


|Atribut|Nilai|

|---|---|

|Versi dokumen|LLD v1.0|

|Status|Draft implementasi — baseline teknis|

|Dokumen induk|HLD v1.0 — AI Social Media Automation Agent|

|Target runtime|Windows PC, proses lokal|

|Platform target|YouTube, TikTok, Instagram, Facebook, X, Threads|

|Integrasi AI/video|DeepSeek API dan Google Flow melalui Playwright|

|Prinsip utama|Persistent jobs, modular adapters, secure sessions, explicit verification|



Disusun untuk menjadi kontrak teknis implementasi dan pengujian.


## Daftar Isi

- 1. Tujuan, ruang lingkup, dan definisi
- 2. Baseline arsitektur dan keputusan implementasi
- 3. Struktur repository
- 4. Domain model dan state machine
- 5. Database schema
- 6. Kontrak API lokal
- 7. Workflow engine dan job dispatcher
- 8. Scheduler
- 9. DeepSeek agent dan tool registry
- 10. Google Flow Playwright adapter
- 11. Social publishing adapters
- 12. Approval dan content versioning
- 13. Keamanan dan secret management
- 14. Logging, observability, dan recovery
- 15. Error model dan retry policy
- 16. Testing strategy
- 17. Acceptance criteria
- 18. Rencana implementasi dan definition of done
- 19. Risiko, asumsi, dan keputusan terbuka

## 1. Tujuan, Ruang Lingkup, dan Definisi

Dokumen ini menetapkan detail modul, kontrak data, transisi status, endpoint, kebijakan retry, pengamanan sesi, dan pengujian untuk aplikasi lokal Windows yang mengotomatisasi produksi serta publikasi video. Dokumen mengikuti HLD v1.0 dan tidak menganggap ketersediaan API Google Flow.


### 1.1 Dalam ruang lingkup

- React dashboard dan Local API.
- DeepSeek planner dengan output terstruktur dan tool registry allowlist.
- Google Flow browser adapter dengan Playwright, sesi persisten, download, dan validasi aset.
- Scheduler fixed/random, kuota, quiet hours, pause/resume.
- SQLite persistent job queue, retry, lease, recovery, dan idempotency.
- Adapter terpisah untuk enam platform sosial media.
- Mode automatic dan approval-required.
- Audit log, secret protection, dan end-to-end tests.

### 1.2 Di luar ruang lingkup MVP

- Multi-tenant cloud service, billing, creator marketplace, atau analytics lanjutan.
- Bypass CAPTCHA, anti-bot protections, login challenges, atau batasan layanan.
- Jaminan direct publishing pada platform yang belum memberi akses dan izin.
- Jaminan exactly-once untuk operasi eksternal yang tidak mendukung idempotency.

### 1.3 Definisi


|Istilah|Definisi|

|---|---|

|Campaign|Unit konfigurasi produksi konten dan daftar target platform.|

|Content item|Satu konsep/konten beserta versi prompt, aset, caption, dan metadata.|

|Media asset|File video lokal yang tervalidasi dan memiliki checksum.|

|Workflow job|Unit kerja persisten yang dieksekusi oleh worker.|

|Publication job|Job terpisah untuk satu akun pada satu platform.|

|Adapter|Modul yang mengimplementasikan kontrak integrasi eksternal.|

|Reconciliation|Pemeriksaan status eksternal setelah hasil aksi tidak diketahui.|

|Lease|Klaim sementara sebuah job oleh worker tertentu.|




## 2. Baseline Arsitektur dan Keputusan Implementasi


|Area|Baseline LLD|Catatan|

|---|---|---|

|Runtime|Node.js LTS yang dipatok di CI; TypeScript strict|Versi Node dan package dipatok saat repo dibuat.|

|Package manager|pnpm workspace|Lockfile wajib dikomit.|

|UI|React + Vite + Tailwind|Dashboard tidak mengakses database secara langsung.|

|API|Fastify + Zod|Bind ke loopback saja secara default.|

|DB|SQLite + Drizzle ORM|Foreign keys aktif, WAL, migrasi versioned.|

|Queue|SQLite persistent queue|Satu sumber kebenaran untuk job status.|

|Browser|Playwright Chromium|Profil terpisah per integrasi/akun.|

|AI|DeepSeek provider adapter|API key hanya di secret store.|

|Media|Filesystem lokal + ffprobe|Metadata di DB, file di storage.|

|Logs|Pino|Redaksi token, cookie, prompt sensitif bila perlu.|

|Tests|Vitest + Playwright Test|API dan adapter punya contract tests.|




### 2.1 Batas proses

- UI berjalan sebagai proses frontend dan berkomunikasi dengan Local API melalui HTTP serta WebSocket/SSE.
- Local API, scheduler, workflow engine, dan database berjalan dalam runtime lokal yang dikendalikan aplikasi.
- Browser worker berjalan dengan lifecycle yang dikendalikan backend; jangan menjalankan job yang sama secara paralel pada profil browser yang sama.
- Aksi eksternal tidak boleh dilakukan dari handler HTTP secara sinkron sampai selesai; handler membuat job dan mengembalikan ID job.

### 2.2 Diagram sequence ringkas

User -> UI: Create campaign

UI -> Local API: POST /campaigns

Local API -> DB: Validate and persist campaign

Local API -> Agent: Request content plan job

Agent -> DeepSeek: Structured planning request

DeepSeek -> Agent: JSON plan

Agent -> Workflow: Validate plan and enqueue generation

Workflow -> Flow Adapter: Generate video job

Flow Adapter -> Playwright: UI steps and download

Flow Adapter -> Media Storage: Save and validate file

Workflow -> Approval: Await or auto-approve

Scheduler -> Queue: Claim due publication jobs

Publisher -> Platform Adapter: Publish request

Platform Adapter -> External Platform: Upload/publish

Publisher -> DB: Save verified result

UI <- Local API: Live job status


## 3. Struktur Repository

social-auto-agent/

apps/

desktop-ui/src/

app/

pages/

components/

features/{dashboard,campaigns,content,approvals,scheduler,accounts,jobs,settings}/

lib/

local-api/src/

routes/

middleware/

server.ts

packages/

domain/src/{entities,schemas,errors,state-machine}/

database/src/{schema,migrations,repositories}/

workflow/src/{dispatcher,queue,leases,retry,recovery}/

scheduler/src/

agent-core/src/{planner,prompts,tools,policies}/

browser-engine/src/{profiles,contexts,downloads}/

integrations/

deepseek/src/

google-flow/src/

social/{youtube,tiktok,instagram,facebook,x,threads}/src/

media/src/{probe,validation,storage,checksum}/

secrets/src/

observability/src/

tests/{unit,integration,e2e,fixtures}/

docs/{HLD.md,LLD.md,security.md,runbook.md}

pnpm-workspace.yaml

package.json

tsconfig.base.json

Aturan dependency: domain tidak mengimpor adapter atau UI; adapter mengimplementasikan interface domain; workflow bergantung pada interface, bukan detail vendor.


## 4. Domain Model dan State Machine


### 4.1 Entitas


|Entitas|Identitas|Tanggung jawab|

|---|---|---|

|Campaign|campaignId|Niche, tujuan, mode approval default, platform target, batas campaign.|

|ContentItem|contentId|Versi prompt, hasil AI, caption, approval status.|

|MediaAsset|assetId|Path aman, checksum, MIME, ukuran, durasi, validasi.|

|SocialAccount|accountId|Platform, label akun, status koneksi, secret reference.|

|Job|jobId|Satu langkah workflow, status, jadwal, lease, retry, idempotency.|

|Approval|approvalId|Versi konten yang disetujui/ditolak, actor, waktu.|

|PublishAttempt|attemptId|Satu percobaan eksternal, status, post ID, permalink.|

|Schedule|scheduleId|Mode, rentang interval, jendela waktu, kuota, timezone.|

|AuditEvent|eventId|Aktor, tindakan, objek, hasil, waktu.|




### 4.2 State machine job

QUEUED -> PLANNING -> GENERATING -> DOWNLOADING -> VALIDATING

VALIDATING -> AWAITING_APPROVAL | SCHEDULED | NEEDS_ATTENTION

AWAITING_APPROVAL -> SCHEDULED | CANCELLED | NEEDS_ATTENTION

SCHEDULED -> PUBLISHING

PUBLISHING -> VERIFYING

VERIFYING -> PUBLISHED | RETRY_WAIT | NEEDS_ATTENTION

Any active state -> CANCELLED only if no irreversible external action is in progress

Retryable failure -> RETRY_WAIT -> previous safe state / next attempt

Permanent failure -> FAILED

Implementasikan transisi sebagai fungsi domain murni transitionJob(current, event). Transisi ilegal harus ditolak dan dicatat. Status PUBLISHED memerlukan bukti verifikasi.


### 4.3 Aturan publication state

- Satu content item dapat memiliki beberapa publication job, masing-masing untuk kombinasi accountId dan platform.
- Kegagalan satu publication job tidak mengubah status publication job lain.
- Status eksternal unknown tidak sama dengan failed; status harus direkonsiliasi.
- Approval berlaku hanya untuk contentVersion, asset checksum, caption hash, accountId, dan platform yang disetujui.

## 5. Database Schema

Gunakan migrasi SQL versioned. Aktifkan PRAGMA foreign_keys=ON dan journal_mode=WAL. Semua waktu disimpan sebagai UTC ISO-8601; timezone dipertahankan pada konfigurasi schedule.


### 5.1 Tabel utama


|Tabel|Kolom inti|Constraint/index|

|---|---|---|

|settings|key, value_json, updated_at|key PK; secret tidak boleh disimpan di sini.|

|campaigns|id, name, niche, status, approval_mode, created_at|id PK.|

|social_accounts|id, platform, label, connection_status, secret_ref, profile_key|id PK; platform enum domain.|

|content_items|id, campaign_id, version, topic, prompt_json, caption_json, approval_status|FK campaign; unique(id, version).|

|media_assets|id, content_id, path, sha256, mime_type, size_bytes, duration_ms, validation_status|FK content; unique(sha256, path).|

|jobs|id, campaign_id, content_id, parent_job_id, job_type, status, payload_json, run_at, attempts, max_attempts, lease_owner, lease_until, idempotency_key|id PK; unique idempotency_key; index(status, run_at).|

|job_dependencies|job_id, depends_on_job_id|Composite PK; no self-reference.|

|schedules|id, campaign_id, mode, min_minutes, max_minutes, window_start, window_end, timezone, daily_limit, enabled|CHECK min <= max; timezone required.|

|approvals|id, content_id, content_version, asset_sha256, caption_hash, account_id, platform, decision, decided_at, decided_by|FK content/account; approval version immutable.|

|publish_attempts|id, job_id, account_id, platform, idempotency_key, status, external_post_id, permalink, attempted_at, verified_at, error_code|Unique idempotency key; FK job/account.|

|audit_logs|id, actor_type, actor_id, action, resource_type, resource_id, result, metadata_json, created_at|Append-only by application policy.|

|schema_migrations|version, applied_at|version PK.|




### 5.2 DDL inti

PRAGMA foreign_keys = ON;

PRAGMA journal_mode = WAL;

CREATE TABLE jobs (

id TEXT PRIMARY KEY,

campaign_id TEXT REFERENCES campaigns(id),

content_id TEXT REFERENCES content_items(id),

parent_job_id TEXT REFERENCES jobs(id),

job_type TEXT NOT NULL,

status TEXT NOT NULL,

payload_json TEXT NOT NULL,

run_at TEXT,

attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),

max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 0),

lease_owner TEXT,

lease_until TEXT,

idempotency_key TEXT NOT NULL UNIQUE,

last_error_code TEXT,

created_at TEXT NOT NULL,

updated_at TEXT NOT NULL

);

CREATE INDEX idx_jobs_due ON jobs(status, run_at);

CREATE INDEX idx_jobs_lease ON jobs(lease_until);


### 5.3 Queue claim transaction

BEGIN IMMEDIATE;

-- Select one due QUEUED/RETRY_WAIT job with no active lease.

-- Update status/lease_owner/lease_until atomically.

-- Commit before invoking external work.

COMMIT;

Jangan menahan transaksi SQLite saat browser, API AI, atau upload berjalan. Lease harus diperpanjang oleh worker aktif dan dipulihkan setelah kedaluwarsa.


## 6. Kontrak API Lokal

Prefix API: /api/v1. Semua endpoint memvalidasi request dengan Zod. Endpoint yang membuat pekerjaan mengembalikan 202 Accepted dan jobId, bukan menunggu operasi eksternal selesai.


|Method & endpoint|Fungsi|Respons utama|

|---|---|---|

|GET /health|Health check lokal|status, version, db, workers|

|GET /dashboard/summary|Ringkasan job dan publikasi|counts, recentFailures|

|POST /campaigns|Buat campaign|campaign|

|GET /campaigns|Daftar campaign|items, cursor|

|GET /campaigns/:id|Detail campaign|campaign, content|

|POST /campaigns/:id/plan|Buat job perencanaan AI|202 + jobId|

|POST /content/:id/generate|Minta generasi video|202 + jobId|

|POST /content/:id/approve|Setujui versi konten|approval record|

|POST /content/:id/reject|Tolak konten|approval record|

|POST /content/:id/schedule|Jadwalkan publikasi|publication job IDs|

|POST /jobs/:id/retry|Retry job aman|202 + jobId|

|POST /jobs/:id/cancel|Batalkan job|current status|

|GET /jobs|Daftar job dengan filter|items, cursor|

|GET /jobs/:id|Detail dan timeline job|job, attempts, events|

|POST /scheduler/pause|Pause scheduler|scheduler state|

|POST /scheduler/resume|Resume scheduler|scheduler state|

|GET /accounts|Daftar akun terhubung|account summaries|

|POST /accounts/:id/reconnect|Mulai alur login ulang|manual action status|

|GET /integrations/capabilities|Kemampuan adapter yang teruji|per-platform capabilities|

|GET /events|SSE untuk pembaruan UI|event stream|




### 6.1 Contoh create campaign

POST /api/v1/campaigns

{

"name": "Edukasi AI",

"niche": "edukasi teknologi",

"approvalMode": "required",

"platforms": ["youtube", "tiktok", "instagram"],

"scheduleId": "schedule_01"

}

202 Accepted

{

"campaignId": "cmp_...",

"status": "created"

}


### 6.2 Error envelope

{

"error": {

"code": "VALIDATION_ERROR",

"message": "Request tidak valid",

"requestId": "req_...",

"details": []

}

}

Jangan mengembalikan stack trace, token, cookie, local secret path, atau detail autentikasi eksternal kepada UI.


## 7. Workflow Engine dan Dispatcher


### 7.1 Job contract

type JobType =

| "PLAN_CONTENT"

| "GENERATE_VIDEO"

| "DOWNLOAD_VIDEO"

| "VALIDATE_MEDIA"

| "CREATE_METADATA"

| "REQUEST_APPROVAL"

| "PUBLISH"

| "VERIFY_PUBLICATION"

| "RECONCILE_PUBLICATION";

type JobStatus =

| "QUEUED" | "RUNNING" | "RETRY_WAIT"

| "AWAITING_APPROVAL" | "SCHEDULED"

| "PUBLISHED" | "NEEDS_ATTENTION"

| "FAILED" | "CANCELLED";


### 7.2 Dispatcher algorithm

1. Ambil satu job due dengan transaksi claim atomik.
1. Validasi payload dan prasyarat status.
1. Buat lease dengan TTL dan worker ID.
1. Jalankan handler terdaftar berdasarkan jobType.
1. Simpan hasil dan transisi status dalam transaksi singkat.
1. Pada kegagalan, klasifikasikan retryable/permanent/ambiguous.
1. Lepas lease atau biarkan recovery menanganinya bila proses crash.

### 7.3 Aturan concurrency

- Satu browser profile hanya boleh digunakan oleh satu worker pada satu waktu.
- Concurrency generasi dan publikasi dikonfigurasi terpisah.
- Default MVP: satu Google Flow generation worker aktif.
- Publication concurrency dibatasi per akun dan platform berdasarkan limit terverifikasi.
- Job dengan status PUBLISHING/VERIFYING tidak boleh diulang tanpa reconciliation.

## 8. Scheduler


### 8.1 Konfigurasi

type ScheduleConfig = {

id: string;

mode: "fixed" | "random" | "random_window";

minMinutes?: number;

maxMinutes?: number;

windowStart?: string; // HH:mm local

windowEnd?: string;   // HH:mm local

timezone: string;     // default Asia/Jakarta

dailyLimit: number;

quietHours?: { start: string; end: string };

enabled: boolean;

};


### 8.2 Aturan

- Validasi minMinutes >= 1 dan maxMinutes >= minMinutes.
- Simpan next_run_at saat jadwal dihitung; jangan menghitung ulang saat restart.
- Periksa kuota per accountId + platform + tanggal lokal sebelum enqueue publication.
- Random interval menggunakan batas inklusif dan PRNG standar untuk scheduling, bukan mekanisme pengelakan deteksi.
- Waktu di luar window atau quiet hours digeser ke slot valid berikutnya.
- Pause menghentikan dispatch job baru, bukan menghapus jadwal atau membatalkan job yang sedang upload.
- Perubahan schedule berlaku pada job baru; job yang sudah dipublish tidak diubah.

### 8.3 Pseudocode

while (schedulerEnabled) {

const dueSchedules = await scheduleRepo.findDue(nowUtc);

for (const schedule of dueSchedules) {

if (!withinWindow(schedule, nowUtc)) continue;

if (await quotaRepo.isExceeded(schedule, localDate(schedule))) continue;

const nextAt = computeNextRun(schedule, nowUtc);

await db.transaction(async tx => {

await tx.enqueueDuePublicationJobs(schedule);

await tx.scheduleRepo.setNextRun(schedule.id, nextAt);

});

}

await sleep(POLL_INTERVAL_MS);

}


## 9. DeepSeek Agent dan Tool Registry


### 9.1 Agent input/output

Input planner terdiri dari campaign config, platform capability snapshots, policy, aset yang tersedia, dan job context. Output harus berupa JSON tervalidasi, bukan instruksi bebas untuk dieksekusi.

type PlanDecision = {

campaignId: string;

decision: "create_video" | "revise_metadata" | "wait" | "needs_human";

topic?: string;

videoPrompt?: string;

aspectRatio?: "9:16" | "16:9" | "1:1";

targets?: Array<{

platform: PlatformId;

contentFormat: string;

caption: string;

title?: string;

}>;

approvalRequired: boolean;

rationale: string;

};


### 9.2 Tool allowlist


|Tool|Input penting|Batas|

|---|---|---|

|create_content_plan|campaignId, constraints|Tidak memanggil platform.|

|generate_video_prompt|topic, duration, aspect ratio|Output prompt saja.|

|request_video_generation|contentId, promptRef|Membuat job; tidak mengendalikan browser langsung.|

|inspect_media_asset|assetId|Hanya baca metadata/validasi.|

|create_platform_metadata|assetId, platform|Output metadata terstruktur.|

|request_approval|contentVersion, target set|Membuat approval request.|

|schedule_publication|contentVersion, account targets|Memeriksa approval dan quota.|

|request_publication|publicationJobId|Enqueue saja.|

|get_job_status|jobId|Read-only.|

|report_failure|jobId, errorCode|Tidak boleh menghapus audit.|




### 9.3 Guardrails

- Semua tool input/output divalidasi menggunakan Zod.
- Agent tidak memiliki akses langsung ke API key, cookie, atau profil browser.
- Batasi jumlah tool call per run, total token, timeout, dan budget.
- Jangan mengeksekusi prompt sebagai shell atau JavaScript.
- Konten hasil model dianggap tidak tepercaya sampai lolos validasi kebijakan dan format.
- Jika model mengeluarkan JSON invalid, retry terbatas dengan instruksi perbaikan; lalu NEEDS_ATTENTION.

## 10. Google Flow Playwright Adapter


### 10.1 Interface

type VideoGenerationRequest = {

prompt: string;

aspectRatio: "9:16" | "16:9" | "1:1";

outputDirectory: string;

correlationId: string;

};

type GeneratedVideo = {

filePath: string;

mimeType: string;

sizeBytes: number;

sha256: string;

durationMs?: number;

};

interface VideoGenerator {

checkAvailability(): Promise<{

available: boolean;

reason?: string;

}>;

generate(request: VideoGenerationRequest): Promise<GeneratedVideo>;

}


### 10.2 Langkah worker

1. Acquire exclusive lock untuk flow-profile.
1. Buka persistent browser context dari direktori profil yang dilindungi.
1. Periksa login dan indikator halaman yang diizinkan.
1. Jika perlu login ulang/CAPTCHA, hentikan job dengan NEEDS_ATTENTION.
1. Navigasi ke alur generasi melalui locator yang tervalidasi.
1. Masukkan prompt dan parameter yang didukung UI saat ini.
1. Tunggu status generasi selesai dengan timeout yang dapat dikonfigurasi.
1. Download melalui alur UI yang tersedia; tunggu file selesai ditulis.
1. Validasi lokasi file berada di bawah output directory yang diizinkan.
1. Jalankan ffprobe, periksa ukuran/durasi/format, hitung SHA-256.
1. Simpan asset metadata dan lepaskan browser lock.

### 10.3 Ketentuan browser

- Jangan bergantung pada selector DOM yang rapuh jika role/label/text locator tersedia.
- Jangan menganggap klik tombol sebagai bukti pekerjaan selesai.
- Download harus memiliki timeout dan verifikasi file final.
- Jangan mem-bypass proteksi keamanan atau mekanisme anti-bot.
- Jangan memasukkan storage state atau profil autentikasi ke Git.
- Gunakan test fixtures/mock adapter untuk CI; jangan memerlukan akun nyata dalam unit tests.

### 10.4 Batas integrasi

Google Flow adapter adalah UI automation yang rentan terhadap perubahan. Sebelum produksi, lakukan smoke test manual pada akun yang sah dan catat kemampuan yang benar-benar tersedia. Tidak ada asumsi API publik generasi video.


## 11. Social Publishing Adapters


### 11.1 Interface umum

type PlatformId =

| "youtube" | "tiktok" | "instagram"

| "facebook" | "x" | "threads";

type PublishRequest = {

accountId: string;

assetId: string;

caption: string;

title?: string;

visibility?: string;

idempotencyKey: string;

};

type PublishResult = {

status: "published" | "processing" | "failed" | "unknown";

platformPostId?: string;

permalink?: string;

errorCode?: string;

retryable: boolean;

};

interface SocialAdapter {

capabilities(): Promise<PlatformCapabilities>;

validate(request: PublishRequest): Promise<ValidationResult>;

publish(request: PublishRequest): Promise<PublishResult>;

getStatus(idempotencyKey: string): Promise<PublishResult>;

}


### 11.2 Adapter responsibilities


|Adapter|Tanggung jawab|Prasyarat yang harus diverifikasi|

|---|---|---|

|YouTube|OAuth, upload, metadata, privacy, status|API access, quota, upload status, video constraints.|

|TikTok|Upload/direct post jika diizinkan|Scope, app audit/approval, account capabilities.|

|Instagram|Publishing untuk format yang didukung|Professional account, permissions, publishing flow.|

|Facebook|Publishing pada target Page yang didukung|Page access, permissions, media limits.|

|X|Post dan media sesuai akses API|Tier/access, cost, rate limits, media capabilities.|

|Threads|Create/publish media atau text sesuai API|Permissions, supported formats, publishing flow.|




### 11.3 Capability registry

type PlatformCapabilities = {

platform: PlatformId;

adapterVersion: string;

authStatus: "connected" | "reauth_required" | "disconnected";

textSupported: boolean;

videoSupported: boolean;

directPublishSupported: boolean;

draftSupported: boolean;

schedulingSupported: boolean;

maxUploadBytes?: number;

supportedAspectRatios?: string[];

lastVerifiedAt?: string;

limitations: string[];

};

Capability harus mencerminkan pengujian dan dokumentasi yang berlaku. Jika belum terverifikasi, gunakan status unsupported/unknown; jangan mengarang dukungan fitur.


### 11.4 Publishing flow

1. Periksa capability snapshot dan status autentikasi.
1. Validasi media dan metadata terhadap aturan adapter.
1. Periksa approval yang cocok dengan versi konten.
1. Buat publication attempt dengan idempotency key unik.
1. Tandai job PUBLISHING sebelum memulai aksi eksternal.
1. Jalankan publish sesuai mekanisme adapter.
1. Jika response sukses, simpan external ID dan lakukan verifikasi.
1. Jika hasil ambigu, lakukan getStatus/reconciliation; jangan retry buta.
1. Set PUBLISHED hanya setelah bukti sukses cukup.

## 12. Approval dan Content Versioning


### 12.1 Approval binding

Approval terikat pada contentId + version, asset SHA-256, caption hash, accountId, dan platform. Perubahan pada salah satu elemen membatalkan approval terkait.


### 12.2 Mode


|Mode|Perilaku|

|---|---|

|automatic|Konten dapat dijadwalkan otomatis setelah policy checks lolos.|

|required|Semua konten target harus disetujui sebelum publikasi.|

|per-campaign/per-content|Mode default dapat ditimpa oleh kebijakan yang lebih ketat pada konten tertentu.|




### 12.3 Approval API behavior

- Approve memerlukan versi dan hash yang terlihat oleh reviewer.
- Reject wajib memiliki alasan opsional/terkonfigurasi.
- Revisi konten membuat versi baru; versi lama tetap tersimpan untuk audit.
- Tidak boleh mengubah caption atau aset setelah approval lalu tetap memakai approval lama.

## 13. Keamanan dan Secret Management


### 13.1 Secrets

- Simpan DeepSeek API key dan OAuth secrets di Windows Credential Manager atau enkripsi DPAPI.
- Database hanya menyimpan secret reference dan metadata minimal.
- Browser profile dan storage state dilindungi ACL Windows untuk pengguna yang menjalankan aplikasi.
- Jangan menyimpan token, cookie, password, atau header Authorization ke log.
- Jangan menaruh file profil browser, .env lokal, database produksi, atau media pribadi dalam Git.

### 13.2 Local API

- Bind ke 127.0.0.1, bukan 0.0.0.0, kecuali pengguna secara eksplisit mengaktifkan akses jaringan.
- Gunakan token sesi lokal/CSRF protection sesuai model UI dan validasi Origin.
- Validasi semua path file terhadap root storage yang diizinkan.
- Batasi ukuran request dan upload; jangan membuka endpoint arbitrary file read.
- Jangan mengekspos port debugging Chromium ke LAN.

### 13.3 Threat model ringkas


|Ancaman|Kontrol|

|---|---|

|Pencurian session cookie|Profil terisolasi, ACL, redaksi log, akses lokal terbatas.|

|Prompt injection dari konten|Tool allowlist, schema validation, tidak ada shell tool.|

|Path traversal|Canonical path check dan root storage allowlist.|

|Local API abuse|Loopback bind, auth token, Origin validation, rate limiting.|

|Accidental duplicate post|Idempotency, reconciliation, status unknown.|

|Secret commit ke Git|.gitignore, secret scan, review release package.|

|Browser UI berubah|Adapter isolation, smoke tests, NEEDS_ATTENTION fallback.|




## 14. Logging, Observability, dan Recovery


### 14.1 Log fields

{

"timestamp": "ISO-8601",

"level": "info",

"requestId": "req_...",

"jobId": "job_...",

"campaignId": "cmp_...",

"component": "publisher.youtube",

"event": "publish.verify",

"result": "success",

"durationMs": 1234,

"errorCode": null

}

Log tidak boleh menyimpan secret, cookie, full authorization headers, atau data pribadi yang tidak dibutuhkan.


### 14.2 Recovery startup

1. Jalankan migrasi dan validasi database.
1. Temukan lease kedaluwarsa.
1. Untuk job non-eksternal, kembalikan ke antrean atau retry sesuai state.
1. Untuk job yang mungkin sudah memulai upload eksternal, ubah menjadi NEEDS_ATTENTION/VERIFYING dan jalankan reconciliation.
1. Verifikasi file media yang direferensikan masih ada dan checksum sesuai.
1. Mulai scheduler setelah recovery selesai.

### 14.3 Retention

Tetapkan retensi configurable untuk log dan file sementara. Jangan menghapus aset yang masih direferensikan job atau dibutuhkan untuk verifikasi publikasi. Penghapusan permanen harus dicatat dalam audit.


## 15. Error Model dan Retry Policy


|Error class|Contoh|Perilaku|

|---|---|---|

|VALIDATION|Payload/schema/media invalid|Tidak retry otomatis; FAILED atau revisi.|

|AUTH|Token/session expired|Pause adapter; minta reauth.|

|RATE_LIMIT|429/quota|Hormati Retry-After dan jadwalkan ulang.|

|TRANSIENT_NETWORK|Timeout sebelum aksi eksternal|Retry terbatas dengan exponential backoff.|

|EXTERNAL_5XX|Service unavailable|Retry terbatas jika aman.|

|UI_CHANGED|Locator tidak ditemukan|Stop adapter, NEEDS_ATTENTION, update test.|

|SECURITY_CHALLENGE|CAPTCHA/login challenge|Stop dan minta intervensi pengguna.|

|AMBIGUOUS_RESULT|Upload timeout setelah submit|Reconciliation sebelum retry.|

|DISK|Storage penuh/file gagal ditulis|Stop download, beri peringatan.|

|CANCELLED|User stop|Jangan mulai langkah berikutnya.|




### 15.1 Backoff

delayMs = min(baseMs * (2 ** attempt), maxDelayMs) + randomJitterMs

Nilai awal yang disarankan: base 2 detik, maksimum 5 menit, maksimal 3 retry. Override wajib menghormati rate limit platform. Jangan retry operasi non-idempotent tanpa rekonsiliasi.


## 16. Testing Strategy


|Level|Cakupan|Kriteria|

|---|---|---|

|Unit|State machine, schema, scheduler, idempotency key, retry classifier|Deterministik; tanpa network/browser nyata.|

|Repository|SQLite migrations, claim job, lease recovery|Test transaction dan crash-like states.|

|Contract|Setiap adapter memenuhi interface|Capability, validation, result mapping konsisten.|

|Integration|DeepSeek mock, media probe, fake adapter|Workflow end-to-end di lingkungan test.|

|Browser smoke|Google Flow UI dengan akun uji yang sah|Manual/controlled run; tidak wajib pada CI publik.|

|E2E|Plan → generate → approve → publish test adapter → verify|Semua state dan audit dapat ditelusuri.|

|Security|Secret redaction, path traversal, local API access|Tidak ada secret bocor; path di luar root ditolak.|

|Recovery|Restart saat queued, generating, publishing|Tidak kehilangan job; aksi ambigu direkonsiliasi.|




### 16.1 Test cases wajib

- Output DeepSeek invalid JSON tidak menimbulkan aksi browser.
- Interval random selalu berada dalam rentang konfigurasi.
- Restart tidak mengubah next_run_at yang tersimpan.
- Dua worker tidak dapat mengklaim job yang sama.
- Approval lama ditolak setelah asset checksum berubah.
- Upload timeout setelah submit tidak memicu retry langsung.
- CAPTCHA menghentikan worker dan mengubah status menjadi NEEDS_ATTENTION.
- Secret redaction bekerja pada error dan HTTP request logging.
- Disk penuh tidak membuat media asset berstatus valid.
- Satu platform gagal tanpa mengubah hasil publikasi platform lain.

## 17. Acceptance Criteria


|ID|Kriteria lulus|Bukti|

|---|---|---|

|AC-01|Aplikasi start/stop dan database persisten|E2E startup/shutdown test.|

|AC-02|Planner output tervalidasi|Unit/contract tests.|

|AC-03|Flow worker mendeteksi login, generasi, download, validasi|Browser smoke test terdokumentasi.|

|AC-04|Scheduler fixed/random mematuhi batas|Property tests.|

|AC-05|Approval mengikat versi konten dan aset|Integration tests.|

|AC-06|Queue claim/lease aman|Concurrency tests.|

|AC-07|Retry dan reconciliation aman|Fault-injection tests.|

|AC-08|Adapter platform diuji terpisah|Contract tests per platform.|

|AC-09|Published memerlukan bukti|Status transition tests.|

|AC-10|Secret tidak masuk log/repo|Security scan dan redaction tests.|

|AC-11|Kill switch menghentikan job baru|E2E cancellation test.|

|AC-12|Recovery tidak menggandakan post|Restart/ambiguous result test.|



Kriteria platform-specific hanya dapat ditandai lulus setelah akses, izin, batas API, dan metode publikasi diuji pada akun yang berwenang.


## 18. Rencana Implementasi dan Definition of Done


|Sprint/fase|Output|Definition of Done|

|---|---|---|

|P1 — Foundation|Workspace, DB, API, logs, state machine, queue|Migrations, unit tests, health endpoint, restart recovery.|

|P2 — Agent|DeepSeek provider, planner, tool registry|Schema validation, budget/timeout, mock tests.|

|P3 — Flow|Playwright session manager, Flow adapter, media validation|Smoke test berhasil pada akun sah; file tervalidasi.|

|P4 — Approval/Scheduler|Approval UI, schedules, quota, pause/resume|Approval binding dan schedule persistence tests.|

|P5 — YouTube|First publishing adapter|Authorized test upload, verify, retry/reconciliation tests.|

|P6 — Remaining platforms|TikTok, Instagram, Facebook, X, Threads adapters|Capability and contract tests per adapter.|

|P7 — Hardening|Packaging, backup, security, runbook|Acceptance criteria dan release checklist terpenuhi.|




### 18.1 Definition of Done untuk setiap modul

- Interface dan schema terdokumentasi.
- Unit tests dan error-path tests tersedia.
- Tidak ada secret dalam source code atau fixtures.
- Log menggunakan correlation ID dan error code.
- Status job ditransisikan melalui domain state machine.
- Adapter memiliki timeout, cancellation, dan hasil terstruktur.
- Dokumentasi setup lokal dan troubleshooting diperbarui.

## 19. Risiko, Asumsi, dan Keputusan Terbuka


|Item|Status|Tindakan|

|---|---|---|

|API Google Flow|Belum diasumsikan tersedia|Validasi alur UI, kebijakan layanan, dan stabilitas sebelum implementasi produksi.|

|Direct publishing tiap platform|Bergantung izin dan akses|Verifikasi dokumentasi terbaru dan test account untuk tiap adapter.|

|SQLite queue scale|Cukup untuk MVP lokal|Ukur beban; pindah ke Redis/BullMQ hanya bila ada kebutuhan terukur.|

|Packaging desktop|Belum final|Pilih Electron/Tauri setelah worker lifecycle stabil.|

|OAuth redirect/credentials|Per platform|Tetapkan app registration, scopes, token refresh, dan secure storage.|

|Media retention|Perlu konfigurasi produk|Tentukan kapasitas disk dan kebijakan penghapusan.|

|Concurrency|Konservatif pada MVP|Mulai satu Flow worker; naikkan setelah uji stabilitas.|




### 19.1 Risiko utama

Risiko terbesar adalah ketergantungan pada UI Google Flow dan kebijakan API/izin publikasi platform. Karena itu, capability registry, adapter isolation, smoke tests, manual fallback, dan reconciliation merupakan bagian inti desain, bukan pekerjaan tambahan.


## Lampiran A — Contoh konfigurasi

APP_ENV=development

APP_HOST=127.0.0.1

APP_PORT=4317

APP_TIMEZONE=Asia/Jakarta

DATABASE_PATH=./data/database/app.sqlite

MEDIA_ROOT=./data/media

BROWSER_PROFILE_ROOT=./data/profiles

LOG_LEVEL=info

SCHEDULER_POLL_INTERVAL_MS=5000

FLOW_WORKER_CONCURRENCY=1

JOB_MAX_ATTEMPTS=3

File .env hanya untuk konfigurasi non-secret lokal. API key dan token tidak ditulis ke file ini untuk distribusi produksi.


## Lampiran B — Checklist sebelum rilis

- Migrasi database diuji pada database kosong dan database upgrade.
- Backup/restore database dan media metadata diuji.
- Secret redaction dan repository scan lulus.
- Google Flow smoke test dan batas browser dicatat.
- Setiap adapter memiliki capability snapshot dan status autentikasi.
- Ambiguous publication tidak memicu retry buta.
- Pause, resume, cancel, shutdown, dan restart diuji.
- Runbook untuk reauth, disk penuh, UI berubah, dan API rate limit tersedia.
- Akun uji dan konten uji digunakan untuk acceptance testing.
- Versi Node, pnpm, dependency, dan lockfile dipatok.