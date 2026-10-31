import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  checkFlowBrowser,
  collectPageOutline,
  openFlowSession,
  resolveFlowBrowserChannel,
  resolveFlowProfileDir
} from '@saa/browser-engine';
import { AppError } from '@saa/domain';

/**
 * Memetakan UI Flow dari sesi login yang sudah ada. Read-only: hanya membuka
 * halaman, membaca struktur DOM, menyimpan tangkapan layar, lalu menutup.
 * Tidak mengisi prompt dan tidak memicu generasi.
 */

class UsageError extends Error {}

function parseFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) throw new UsageError(`${flag} membutuhkan nilai`);
  return value;
}

function parseWait(args: string[]): number {
  const raw = parseFlag(args, '--wait');
  if (raw === undefined) return 8_000;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 1_000 || ms > 120_000) {
    throw new UsageError(`--wait ${raw} harus 1000–120000`);
  }
  return ms;
}

function parseUrl(args: string[]): string | undefined {
  const raw = parseFlag(args, '--url');
  if (raw === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UsageError(`--url ${raw} bukan URL valid`);
  }
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'flow.google.com') {
    throw new UsageError('--url harus https://flow.google.com/…');
  }
  return parsed.toString();
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const known = args.filter(
    (arg, index) => arg !== '--wait' && arg !== '--url' && !['--wait', '--url'].includes(args[index - 1] ?? '')
  );
  if (known.length > 0) throw new UsageError(`argumen tidak dikenal: ${known.join(' ')}`);
  const waitMs = parseWait(args);
  const url = parseUrl(args);

  const profileDir = resolveFlowProfileDir();
  const channel = resolveFlowBrowserChannel();
  const browser = await checkFlowBrowser(channel);
  if (!browser.available) {
    console.error(`Gagal: ${browser.reason ?? 'browser tidak siap'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Profil Flow : ${profileDir}`);
  console.log(`Browser     : ${channel}`);

  const session = await openFlowSession({
    profileDir,
    channel,
    lockOwnerId: 'flow-inspect',
    tolerateGotoFailure: true,
    gotoTimeoutMs: 60_000,
    ...(url === undefined ? {} : { url })
  });

  try {
    if (session.navigationError !== null) {
      console.log(`Peringatan   : ${session.navigationError}`);
    }
    const outline = await collectPageOutline(session.page, { waitMs });

    const outDir = resolve(process.env.INIT_CWD ?? process.cwd(), 'data');
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const jsonPath = join(outDir, `flow-inspect-${stamp}.json`);
    const shotPath = join(outDir, `flow-inspect-${stamp}.png`);
    writeFileSync(jsonPath, `${JSON.stringify(outline, null, 2)}\n`);
    if (session.page.screenshot !== undefined) {
      await session.page.screenshot({ path: shotPath, fullPage: true });
    }

    console.log(`URL         : ${outline.url}`);
    console.log(`Judul       : ${outline.title}`);
    console.log(`Halaman login? ${outline.looksLikeSignIn ? 'YA — sesi belum valid' : 'tidak'}`);
    console.log(`Input       : ${outline.inputs.length}`);
    for (const input of outline.inputs.slice(0, 8)) {
      console.log(
        `  - ${input.tag}${input.type === undefined ? '' : `[${input.type}]`} ${input.placeholder ?? input.ariaLabel ?? input.text ?? ''}`
      );
    }
    console.log(`Tombol      : ${outline.buttons.length}`);
    for (const button of outline.buttons.slice(0, 10)) {
      console.log(`  - ${button.ariaLabel ?? button.text ?? button.testId ?? '(tanpa label)'}`);
    }
    console.log(`Heading     : ${outline.headings.slice(0, 5).join(' | ')}`);
    console.log(`Bukti       : ${jsonPath}`);
    if (session.page.screenshot !== undefined) console.log(`Tangkapan   : ${shotPath}`);

    if (outline.looksLikeSignIn) {
      console.log('Sesi belum login: jalankan flow:login lalu ulangi flow:inspect.');
      process.exitCode = 1;
    }
  } finally {
    await session.close();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`Gagal: ${error.message}`);
    console.error('Pemakaian: flow:inspect [--wait <ms>]');
    process.exitCode = 2;
    return;
  }
  if (error instanceof AppError) {
    console.error(`Gagal [${error.errorClass}]: ${error.message}`);
    process.exitCode = error.errorClass === 'VALIDATION' ? 2 : 1;
    return;
  }
  if (error instanceof Error) {
    console.error(`Gagal: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  console.error('Gagal: kesalahan tidak dikenal');
  process.exitCode = 1;
});
