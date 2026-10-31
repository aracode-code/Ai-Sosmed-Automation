import { checkFlowBrowser, openFlowSession, resolveFlowProfileDir } from '@saa/browser-engine';
import { AppError } from '@saa/domain';

/**
 * Login manual profil Flow (OD-1): membuka Chromium dengan profil persisten,
 * pemilik akun login sendiri, lalu menutup jendela. Aplikasi tidak pernah
 * mengisi kredensial atau menembus CAPTCHA/verifikasi.
 */

class UsageError extends Error {}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
    throw new UsageError(`argumen tidak dikenal: ${args.join(' ')}`);
  }

  const profileDir = resolveFlowProfileDir();
  const browser = await checkFlowBrowser();

  if (args[0] === '--check') {
    console.log(`Profil Flow : ${profileDir}`);
    console.log(
      browser.available
        ? `Chromium    : ${browser.executablePath}`
        : `Chromium    : TIDAK SIAP — ${browser.reason ?? 'tidak diketahui'}`
    );
    process.exitCode = browser.available ? 0 : 1;
    return;
  }

  if (!browser.available) {
    console.error(`Gagal: ${browser.reason ?? 'browser tidak siap'}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Profil Flow : ${profileDir}`);
  console.log('Membuka Chromium. Login ke Google Flow di jendela itu, lalu tutup jendela bila selesai.');
  console.log('Aplikasi tidak mengisi kredensial dan tidak melewati CAPTCHA/verifikasi apa pun.');

  const session = await openFlowSession({
    profileDir,
    lockOwnerId: 'flow-login',
    tolerateGotoFailure: true
  });

  if (session.navigationError !== null) {
    console.log(
      `Peringatan   : halaman belum selesai dimuat (${session.navigationError}).`
    );
    console.log('               Muat ulang di jendela bila perlu, lalu login dan tutup jendela.');
  }

  try {
    await session.waitForClose();
    console.log('Jendela ditutup. Sesi tersimpan di profil; jalankan adapter Flow berikutnya.');
  } finally {
    session.releaseLock();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof UsageError) {
    console.error(`Gagal: ${error.message}`);
    console.error('Pemakaian: flow:login [--check]');
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
