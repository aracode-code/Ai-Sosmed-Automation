import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  appendUsage,
  dayOf,
  decideGeneration,
  generateFlowMedia,
  inspectFlowReady,
  parseFlowGuard,
  parseLedger,
  updateLastStatus,
  type FlowMediaKind,
  type UsageLedger
} from '@saa/browser-engine';
import { AppError } from '@saa/domain';

/**
 * Membuat satu media via studio Flow yang sudah di-attach lewat CDP.
 * Guard: batas harian, wajib `--yes` bila FLOW_REQUIRE_CONFIRM, dan `--dry-run`
 * untuk memeriksa kesiapan tanpa memotong kredit.
 */

class UsageError extends Error {}

interface Args {
  kind: FlowMediaKind;
  prompt: string | null;
  dryRun: boolean;
  yes: boolean;
  endpoint: string;
}

function readValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new UsageError(`${flag} membutuhkan nilai`);
  }
  return value;
}

function parseArgs(argv: string[]): Args {
  const known = new Set(['--kind', '--prompt', '--endpoint']);
  const flags = new Set(['--dry-run', '--yes']);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (known.has(arg)) {
      index += 1;
      continue;
    }
    if (!flags.has(arg)) throw new UsageError(`argumen tidak dikenal: ${arg}`);
  }

  const kindRaw = readValue(argv, '--kind') ?? 'image';
  if (kindRaw !== 'image' && kindRaw !== 'video') {
    throw new UsageError(`--kind ${kindRaw} harus image atau video`);
  }
  const endpoint = readValue(argv, '--endpoint') ?? 'http://127.0.0.1:9222';
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(endpoint)) {
    throw new UsageError('--endpoint harus http://127.0.0.1:<port>');
  }

  return {
    kind: kindRaw,
    prompt: readValue(argv, '--prompt') ?? null,
    dryRun: argv.includes('--dry-run'),
    yes: argv.includes('--yes'),
    endpoint
  };
}

function ledgerPath(): string {
  const root = resolve(process.env.INIT_CWD ?? process.cwd(), 'data');
  mkdirSync(root, { recursive: true });
  return join(root, 'flow-usage.json');
}

function readLedger(path: string): UsageLedger {
  const raw = existsSync(path) ? readFileSync(path, 'utf8') : null;
  return parseLedger({ raw });
}

function writeLedger(path: string, ledger: UsageLedger): void {
  writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const guard = parseFlowGuard();
  const now = new Date().toISOString();
  const path = ledgerPath();
  const ledger = readLedger(path);
  const budget = decideGeneration(guard, ledger, now);

  console.log(`Mode        : ${args.dryRun ? 'dry-run (tanpa biaya)' : 'pembuatan nyata'}`);
  console.log(`Jenis media : ${args.kind}`);
  console.log(`Guard       : maks ${guard.maxPerDay}/hari · konfirmasi ${guard.requireConfirm ? 'wajib' : 'tidak'}`);
  console.log(`Pemakaian   : ${budget.usedToday}/${guard.maxPerDay} hari ini (${dayOf(now)} WIB)`);

  if (args.dryRun) {
    const readiness = await inspectFlowReady(args.endpoint);
    console.log(`URL         : ${readiness.url}`);
    console.log(`Judul       : ${readiness.title}`);
    console.log(`Prompt      : ${readiness.promptPresent ? 'ada' : 'TIDAK ADA'}`);
    console.log(`Tombol kirim: ${readiness.submitPresent ? 'ada' : 'TIDAK ADA'}`);
    console.log(`Tantangan   : ${readiness.challengeDetected ? 'TERDETEKSI (berhenti)' : 'tidak'}`);
    if (readiness.challengeDetected) process.exitCode = 1;
    return;
  }

  if (args.prompt === null || args.prompt.trim() === '') {
    throw new UsageError('--prompt wajib untuk pembuatan nyata');
  }
  if (!budget.allowed) {
    console.error(`Ditolak: ${budget.reason ?? 'batas pemakaian'}`);
    process.exitCode = 1;
    return;
  }
  if (guard.requireConfirm && !args.yes) {
    console.error('Ditolak: konfirmasi wajib. Ulangi dengan --yes untuk memotong kredit.');
    process.exitCode = 2;
    return;
  }

  const promptHash = createHash('sha256').update(args.prompt).digest('hex').slice(0, 16);

  try {
    const result = await generateFlowMedia({
      endpoint: args.endpoint,
      prompt: args.prompt,
      kind: args.kind,
      outputDirectory: resolve(process.env.INIT_CWD ?? process.cwd(), 'data', 'media', 'flow'),
      renderTimeoutMs: args.kind === 'video' ? 15 * 60 * 1000 : 5 * 60 * 1000,
      onSubmit: () => {
        // Dicatat hanya setelah tombol kirim ditekan: kegagalan sebelumnya tidak
        // memotong kredit dan tidak boleh mengurangi kuota harian.
        writeLedger(
          path,
          appendUsage(readLedger(path), {
            at: now,
            kind: args.kind,
            promptHash,
            status: 'started',
            dryRun: false,
            submitted: true
          })
        );
      }
    });
    writeLedger(path, updateLastStatus(readLedger(path), 'succeeded'));
    console.log(`Berkas      : ${result.filePath}`);
    console.log(`Nama asli   : ${result.suggestedName}`);
  } catch (error) {
    const ledgerNow = readLedger(path);
    const last = ledgerNow.entries[ledgerNow.entries.length - 1];
    if (last !== undefined && last.status === 'started' && last.submitted) {
      writeLedger(path, updateLastStatus(ledgerNow, 'failed'));
    }
    throw error;
  }
}

/*
 * Koneksi CDP yang dibuat Playwright tidak punya "disconnect" tanpa menutup
 * browser; proses keluar eksplisit setelah pekerjaan selesai agar Chrome milik
 * pengguna tetap terbuka.
 */
void main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(`Gagal: ${error.message}`);
      console.error(
        'Pemakaian: flow:generate [--kind image|video] [--prompt "<teks>"] [--dry-run] [--yes] [--endpoint http://127.0.0.1:9222]'
      );
      process.exit(2);
    }
    if (error instanceof AppError) {
      console.error(`Gagal [${error.errorClass}]: ${error.message}`);
      process.exit(error.errorClass === 'VALIDATION' ? 2 : 1);
    }
    if (error instanceof Error) {
      console.error(`Gagal: ${error.message}`);
      process.exit(1);
    }
    console.error('Gagal: kesalahan tidak dikenal');
    process.exit(1);
  });
