import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  ConnectActionInProgressError,
  ConnectActionNotRunningError,
  ConnectActionRunner
} from './connect-runner';

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  pid = 4242;
  killed = false;
  kill(): boolean {
    this.killed = true;
    return true;
  }
}

interface SpawnCall {
  command: string;
  args: readonly string[];
  options: SpawnOptions;
}

function setup(options: { packageDir?: string; timeoutMs?: number } = {}) {
  const calls: SpawnCall[] = [];
  const children: FakeChild[] = [];
  const killed: FakeChild[] = [];
  const runner = new ConnectActionRunner({
    packageDir: options.packageDir ?? 'F:/repo/apps/local-api',
    spawn: (command, args, spawnOptions) => {
      calls.push({ command, args, options: spawnOptions });
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    },
    killTree: (child) => {
      const fake = child as unknown as FakeChild;
      fake.killed = true;
      killed.push(fake);
    },
    env: { PATH: 'uji' },
    now: () => new Date('2026-11-01T10:00:00.000Z'),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: { 'flow-login': options.timeoutMs, 'youtube-pair': options.timeoutMs } })
  });
  return { runner, calls, children, killed };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('ConnectActionRunner', () => {
  it('menjalankan script CLI lewat node + loader tsx tanpa shell', () => {
    const { runner, calls } = setup();
    const snapshot = runner.start('flow-login');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.command).toBe(process.execPath);
    expect(calls[0]?.args[0]).toBe('--import');
    expect(calls[0]?.args[1]).toContain('tsx');
    expect(calls[0]?.args[2]).toBe(join('F:/repo/apps/local-api', 'src', 'flow-login.ts'));
    expect(calls[0]?.options.cwd).toBe('F:/repo/apps/local-api');
    expect(calls[0]?.options.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    expect(snapshot).toMatchObject({ kind: 'flow-login', phase: 'running', exitCode: null });
    expect(snapshot.startedAt).toBe('2026-11-01T10:00:00.000Z');

    runner.dispose();
  });

  it('meneruskan argumen pairing dan menolak aksi ganda', () => {
    const { runner, calls } = setup();
    runner.start('youtube-pair', ['--label', 'Kanal Utama']);

    expect(calls[0]?.args.slice(2)).toEqual([
      join('F:/repo/apps/local-api', 'src', 'pair-youtube.ts'),
      '--label',
      'Kanal Utama'
    ]);
    expect(() => runner.start('youtube-pair')).toThrow(ConnectActionInProgressError);

    runner.dispose();
  });

  it('menandai fase menunggu interaksi dari keluaran CLI', async () => {
    const { runner, children } = setup();
    runner.start('flow-login');
    children[0]?.stdout.write('Profil Flow : C:\\profil\nLogin ke Google Flow di jendela itu.\n');
    await sleep(10);

    const snapshot = runner.snapshot('flow-login');
    expect(snapshot.phase).toBe('waiting');
    expect(snapshot.waitingFor).toContain('login manual');
    expect(snapshot.lines.at(-1)).toContain('Login ke Google Flow');

    runner.dispose();
  });

  it('menyunting nilai yang menyerupai token dan menandai stderr', async () => {
    const { runner, children } = setup();
    runner.start('youtube-pair');
    children[0]?.stdout.write('client_secret: rahasia-uji\n');
    children[0]?.stderr.write('Gagal: izin ditolak\n');
    await sleep(10);

    const snapshot = runner.snapshot('youtube-pair');
    expect(snapshot.lines).toContain('client_secret: [disunting]');
    expect(snapshot.lines).toContain('! Gagal: izin ditolak');
    expect(snapshot.lines.join('\n')).not.toContain('rahasia-uji');

    runner.dispose();
  });

  it('membuang kode warna ANSI dari keluaran Playwright', async () => {
    const { runner, children } = setup();
    runner.start('flow-login');
    children[0]?.stdout.write('Gagal: \u001B[2mpid=1\u001B[22m ditutup\n');
    await sleep(10);

    expect(runner.snapshot('flow-login').lines).toContain('Gagal: pid=1 ditutup');

    runner.dispose();
  });

  it('menutup aksi dengan sukses saat proses keluar 0', async () => {
    const { runner, children } = setup();
    runner.start('flow-login');
    children[0]?.stdout.write('Jendela ditutup.\n');
    children[0]?.emit('exit', 0, null);
    await sleep(5);

    const snapshot = runner.snapshot('flow-login');
    expect(snapshot.phase).toBe('succeeded');
    expect(snapshot.exitCode).toBe(0);
    expect(snapshot.endedAt).toBe('2026-11-01T10:00:00.000Z');
    expect(snapshot.lines).toContain('Jendela ditutup.');
  });

  it('menandai gagal dengan kode keluar bukan nol', async () => {
    const { runner, children } = setup();
    runner.start('youtube-pair');
    children[0]?.emit('exit', 2, null);
    await sleep(5);

    const snapshot = runner.snapshot('youtube-pair');
    expect(snapshot.phase).toBe('failed');
    expect(snapshot.error).toBe('proses keluar dengan kode 2');
  });

  it('menandai gagal saat proses tidak dapat dijalankan', async () => {
    const { runner, children } = setup();
    runner.start('flow-login');
    children[0]?.emit('error', new Error('spawn ENOENT'));
    await sleep(5);

    const snapshot = runner.snapshot('flow-login');
    expect(snapshot.phase).toBe('failed');
    expect(snapshot.error).toBe('spawn ENOENT');
  });

  it('menghentikan proses saat batas waktu tercapai', async () => {
    const { runner, killed } = setup({ timeoutMs: 20 });
    runner.start('flow-login');
    await sleep(60);

    const snapshot = runner.snapshot('flow-login');
    expect(snapshot.phase).toBe('timed_out');
    expect(snapshot.error).toContain('batas waktu');
    expect(killed).toHaveLength(1);

    runner.dispose();
  });

  it('membatalkan aksi yang sedang menunggu interaksi', () => {
    const { runner, killed } = setup();
    runner.start('youtube-pair');
    const snapshot = runner.cancel('youtube-pair');

    expect(snapshot.phase).toBe('cancelled');
    expect(snapshot.error).toBe('dihentikan dari UI');
    expect(killed).toHaveLength(1);
    expect(() => runner.cancel('youtube-pair')).toThrow(ConnectActionNotRunningError);

    runner.dispose();
  });

  it('tidak membocorkan state internal lewat snapshot', async () => {
    const { runner, children } = setup();
    runner.start('flow-login');
    children[0]?.stdout.write('baris satu\n');
    await sleep(10);

    const snapshot = runner.snapshot('flow-login');
    snapshot.lines.push('disisipkan pemanggil');
    expect(runner.snapshot('flow-login').lines).not.toContain('disisipkan pemanggil');

    runner.dispose();
  });
});
