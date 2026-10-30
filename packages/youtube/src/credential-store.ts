import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type CredentialStoreErrorCode =
  | 'INVALID_NAME'
  | 'NOT_SUPPORTED'
  | 'PROTECT_FAILED'
  | 'UNPROTECT_FAILED'
  | 'CORRUPT';

export class CredentialStoreError extends Error {
  constructor(
    readonly code: CredentialStoreErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

export interface CredentialStore {
  save(name: string, payload: unknown): Promise<void>;
  load<T = unknown>(name: string): Promise<T | null>;
  remove(name: string): Promise<boolean>;
}

export type SecretTransformer = (input: Buffer) => Promise<Buffer>;

export interface DpapiCredentialStoreOptions {
  rootDir?: string;
  protect?: SecretTransformer;
  unprotect?: SecretTransformer;
  timeoutMs?: number;
}

function defaultRootDir(): string {
  const base = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
  return join(base, 'saa', 'credentials');
}

function assertName(name: string): void {
  if (!NAME_PATTERN.test(name) || name.includes('..')) {
    throw new CredentialStoreError('INVALID_NAME', `nama kredensial tidak valid: ${name}`);
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  );
}

const PROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$raw=[Console]::In.ReadToEnd().Trim()',
  "if ($raw -eq '') { throw 'input kosong' }",
  '$bytes=[Convert]::FromBase64String($raw)',
  "$out=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,'CurrentUser')",
  '[Console]::Out.Write([Convert]::ToBase64String($out))'
].join('; ');

const UNPROTECT_SCRIPT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$raw=[Console]::In.ReadToEnd().Trim()',
  "if ($raw -eq '') { throw 'input kosong' }",
  '$bytes=[Convert]::FromBase64String($raw)',
  "$out=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,'CurrentUser')",
  '[Console]::Out.Write([Convert]::ToBase64String($out))'
].join('; ');

/**
 * Skrip PowerShell bersifat statis; rahasia dikirim lewat stdin (bukan argumen)
 * agar tidak muncul di daftar proses atau riwayat perintah.
 */
function runDpapi(
  script: string,
  input: Buffer,
  timeoutMs: number,
  failureCode: CredentialStoreErrorCode
): Promise<Buffer> {
  if (process.platform !== 'win32') {
    return Promise.reject(
      new CredentialStoreError('NOT_SUPPORTED', 'DPAPI hanya tersedia pada Windows')
    );
  }

  return new Promise((resolve, reject) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
      windowsHide: true
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (error: Error | null, value?: Buffer): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (error === null && value !== undefined) resolve(value);
      else reject(error ?? new CredentialStoreError(failureCode, 'DPAPI gagal tanpa keterangan'));
    };

    timer = setTimeout(() => {
      child.kill();
      finish(new CredentialStoreError(failureCode, `DPAPI melewati batas ${timeoutMs} ms`));
    }, timeoutMs);

    child.on('error', () =>
      finish(new CredentialStoreError(failureCode, 'powershell.exe tidak dapat dijalankan'))
    );
    child.stdout.on('data', (chunk: Buffer) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim().slice(0, 200);
        finish(
          new CredentialStoreError(
            failureCode,
            detail === '' ? `DPAPI gagal (exit ${code})` : `DPAPI gagal (exit ${code}): ${detail}`
          )
        );
        return;
      }
      const text = Buffer.concat(stdout).toString('utf8').trim();
      if (text === '') {
        finish(new CredentialStoreError(failureCode, 'DPAPI tidak mengembalikan data'));
        return;
      }
      try {
        finish(null, Buffer.from(text, 'base64'));
      } catch {
        finish(new CredentialStoreError(failureCode, 'keluaran DPAPI bukan base64 valid'));
      }
    });

    child.stdin.end(input.toString('base64'));
  });
}

async function dpapiProtect(input: Buffer, timeoutMs: number): Promise<Buffer> {
  return runDpapi(PROTECT_SCRIPT, input, timeoutMs, 'PROTECT_FAILED');
}

async function dpapiUnprotect(input: Buffer, timeoutMs: number): Promise<Buffer> {
  return runDpapi(UNPROTECT_SCRIPT, input, timeoutMs, 'UNPROTECT_FAILED');
}

/**
 * Menyimpan payload JSON terenkripsi DPAPI (user scope) satu berkas per nama.
 * Berkas ditulis di bawah `%LOCALAPPDATA%` yang ACL-nya sudah dibatasi per user,
 * dan ciphertext DPAPI tetap terikat ke akun Windows meski berkas disalin.
 */
export class DpapiCredentialStore implements CredentialStore {
  readonly rootDir: string;
  private readonly protectSecret: SecretTransformer;
  private readonly unprotectSecret: SecretTransformer;

  constructor(options: DpapiCredentialStoreOptions = {}) {
    this.rootDir = options.rootDir ?? defaultRootDir();
    const timeoutMs = options.timeoutMs ?? 10_000;
    this.protectSecret = options.protect ?? ((input) => dpapiProtect(input, timeoutMs));
    this.unprotectSecret = options.unprotect ?? ((input) => dpapiUnprotect(input, timeoutMs));
  }

  pathFor(name: string): string {
    assertName(name);
    return join(this.rootDir, `${name}.bin`);
  }

  async save(name: string, payload: unknown): Promise<void> {
    const target = this.pathFor(name);
    const temp = `${target}.tmp`;
    const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
    const ciphertext = await this.protectSecret(plaintext);

    await mkdir(this.rootDir, { recursive: true });
    try {
      await writeFile(temp, ciphertext, { mode: 0o600 });
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true });
      throw error;
    }
  }

  async load<T = unknown>(name: string): Promise<T | null> {
    const target = this.pathFor(name);
    let ciphertext: Buffer;
    try {
      ciphertext = await readFile(target);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw error;
    }

    let plaintext: Buffer;
    try {
      plaintext = await this.unprotectSecret(ciphertext);
    } catch (error) {
      if (error instanceof CredentialStoreError) throw error;
      throw new CredentialStoreError(
        'UNPROTECT_FAILED',
        `kredensial ${name} tidak dapat didekripsi`
      );
    }

    try {
      return JSON.parse(plaintext.toString('utf8')) as T;
    } catch {
      throw new CredentialStoreError('CORRUPT', `isi kredensial ${name} bukan JSON valid`);
    }
  }

  async remove(name: string): Promise<boolean> {
    const target = this.pathFor(name);
    try {
      await unlink(target);
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }
}
