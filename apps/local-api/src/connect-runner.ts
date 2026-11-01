import { spawn as defaultSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Aksi connect dari UI: menjalankan CLI `flow:login` / `pair:youtube` sebagai proses
 * lokal terpisah. UI tidak pernah menerima kredensial; login dan consent tetap
 * dikerjakan pemilik akun di jendela browser yang dibuka CLI.
 */

export type ConnectActionKind = 'flow-login' | 'youtube-pair';

export type ConnectActionPhase =
  | 'idle'
  | 'running'
  | 'waiting'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'cancelled';

export interface ConnectActionSnapshot {
  kind: ConnectActionKind;
  phase: ConnectActionPhase;
  startedAt: string | null;
  endedAt: string | null;
  exitCode: number | null;
  /** Diisi saat proses menunggu interaksi manual (login/consent di browser). */
  waitingFor: string | null;
  error: string | null;
  /** Ringkasan log terakhir, sudah disunting dari nilai yang menyerupai token. */
  lines: string[];
}

export interface ConnectActionController {
  start(kind: ConnectActionKind, args?: readonly string[]): ConnectActionSnapshot;
  snapshot(kind: ConnectActionKind): ConnectActionSnapshot;
  cancel(kind: ConnectActionKind): ConnectActionSnapshot;
}

export class ConnectActionInProgressError extends Error {
  constructor(readonly kind: ConnectActionKind) {
    super(`aksi ${kind} masih berjalan`);
    this.name = 'ConnectActionInProgressError';
  }
}

export class ConnectActionNotRunningError extends Error {
  constructor(readonly kind: ConnectActionKind) {
    super(`aksi ${kind} tidak sedang berjalan`);
    this.name = 'ConnectActionNotRunningError';
  }
}

type SpawnFn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess;

export interface ConnectActionRunnerOptions {
  /** Direktori paket `@saa/local-api`; script CLI dicari relatif terhadap ini. */
  packageDir?: string;
  spawn?: SpawnFn;
  killTree?: (child: ChildProcess) => void;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: Partial<Record<ConnectActionKind, number>>;
}

const SCRIPTS: Record<ConnectActionKind, string> = {
  'flow-login': join('src', 'flow-login.ts'),
  'youtube-pair': join('src', 'pair-youtube.ts')
};

const WAITING_MARKERS: Record<ConnectActionKind, { needle: string; label: string }> = {
  'flow-login': {
    needle: 'Login ke Google Flow',
    label: 'menunggu login manual di jendela browser'
  },
  'youtube-pair': {
    needle: 'Membuka browser untuk consent',
    label: 'menunggu consent Google di browser'
  }
};

const DEFAULT_TIMEOUT_MS: Record<ConnectActionKind, number> = {
  'flow-login': 15 * 60_000,
  'youtube-pair': 10 * 60_000
};

const MAX_LINES = 60;
const MAX_LINE_LENGTH = 400;
const MAX_PENDING = 8_192;

const DEFAULT_PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SECRET_PATTERN =
  /(access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization)(\s*[:=]\s*)\S+/gi;

const ANSI_PATTERN = /\u001B\[[0-9;]*m/g;

function sanitizeLine(line: string): string {
  const clean = line
    .replace(/\r$/, '')
    .replace(ANSI_PATTERN, '')
    .replace(SECRET_PATTERN, '$1$2[disunting]');
  return clean.length > MAX_LINE_LENGTH ? `${clean.slice(0, MAX_LINE_LENGTH)}…` : clean;
}

function idleSnapshot(kind: ConnectActionKind): ConnectActionSnapshot {
  return {
    kind,
    phase: 'idle',
    startedAt: null,
    endedAt: null,
    exitCode: null,
    waitingFor: null,
    error: null,
    lines: []
  };
}

function cloneSnapshot(snapshot: ConnectActionSnapshot): ConnectActionSnapshot {
  return { ...snapshot, lines: [...snapshot.lines] };
}

function isBusy(snapshot: ConnectActionSnapshot): boolean {
  return snapshot.phase === 'running' || snapshot.phase === 'waiting';
}

function killTreeDefault(child: ChildProcess): void {
  if (child.pid === undefined) {
    child.kill('SIGTERM');
    return;
  }
  if (process.platform === 'win32') {
    const killer = defaultSpawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      windowsHide: true,
      stdio: 'ignore'
    });
    killer.on('error', () => {
      child.kill('SIGTERM');
    });
    return;
  }
  child.kill('SIGTERM');
}

interface RunningAction {
  child: ChildProcess;
  timer: NodeJS.Timeout;
  pending: { stdout: string; stderr: string };
  closed: boolean;
}

export class ConnectActionRunner implements ConnectActionController {
  private readonly running = new Map<ConnectActionKind, RunningAction>();
  private readonly states: Record<ConnectActionKind, ConnectActionSnapshot>;
  private readonly packageDir: string;
  private readonly spawn: SpawnFn;
  private readonly killTree: (child: ChildProcess) => void;
  private readonly now: () => Date;
  private readonly env: NodeJS.ProcessEnv;
  private readonly timeouts: Record<ConnectActionKind, number>;
  private loader: string | null = null;

  constructor(options: ConnectActionRunnerOptions = {}) {
    this.packageDir = options.packageDir ?? DEFAULT_PACKAGE_DIR;
    this.spawn = options.spawn ?? (defaultSpawn as SpawnFn);
    this.killTree = options.killTree ?? killTreeDefault;
    this.now = options.now ?? (() => new Date());
    this.env = options.env ?? process.env;
    this.timeouts = { ...DEFAULT_TIMEOUT_MS, ...options.timeoutMs };
    this.states = {
      'flow-login': idleSnapshot('flow-login'),
      'youtube-pair': idleSnapshot('youtube-pair')
    };
  }

  start(kind: ConnectActionKind, args: readonly string[] = []): ConnectActionSnapshot {
    if (this.running.has(kind)) throw new ConnectActionInProgressError(kind);

    const snapshot: ConnectActionSnapshot = {
      ...idleSnapshot(kind),
      phase: 'running',
      startedAt: this.now().toISOString()
    };
    this.states[kind] = snapshot;

    const child = this.spawn(
      process.execPath,
      ['--import', this.tsxLoader(), join(this.packageDir, SCRIPTS[kind]), ...args],
      {
        cwd: this.packageDir,
        env: { ...this.env, NO_COLOR: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    const action: RunningAction = {
      child,
      timer: setTimeout(() => this.handleTimeout(kind), this.timeouts[kind]),
      pending: { stdout: '', stderr: '' },
      closed: false
    };
    action.timer.unref();
    this.running.set(kind, action);

    this.consume(kind, 'stdout', child.stdout);
    this.consume(kind, 'stderr', child.stderr);

    child.on('exit', (code, signal) => this.handleExit(kind, code, signal));
    child.on('error', (error) => this.handleSpawnError(kind, error));

    return cloneSnapshot(snapshot);
  }

  snapshot(kind: ConnectActionKind): ConnectActionSnapshot {
    return cloneSnapshot(this.states[kind]);
  }

  cancel(kind: ConnectActionKind): ConnectActionSnapshot {
    const action = this.running.get(kind);
    if (action === undefined || !isBusy(this.states[kind])) {
      throw new ConnectActionNotRunningError(kind);
    }

    const snapshot = this.states[kind];
    snapshot.phase = 'cancelled';
    snapshot.waitingFor = null;
    snapshot.error = 'dihentikan dari UI';
    snapshot.endedAt = this.now().toISOString();
    this.killTree(action.child);
    return cloneSnapshot(snapshot);
  }

  /** Kill semua proses yang masih berjalan; dipanggil saat server ditutup. */
  dispose(): void {
    for (const [kind, action] of this.running) {
      clearTimeout(action.timer);
      action.closed = true;
      this.killTree(action.child);
      const snapshot = this.states[kind];
      if (isBusy(snapshot)) {
        snapshot.phase = 'cancelled';
        snapshot.error = 'server berhenti';
        snapshot.endedAt = this.now().toISOString();
      }
    }
    this.running.clear();
  }

  private consume(
    kind: ConnectActionKind,
    stream: 'stdout' | 'stderr',
    readable: NodeJS.ReadableStream | null
  ): void {
    if (readable === null) return;
    readable.setEncoding?.('utf8');
    readable.on('data', (chunk: string | Buffer) => {
      this.ingest(kind, stream, typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    });
  }

  private ingest(kind: ConnectActionKind, stream: 'stdout' | 'stderr', chunk: string): void {
    const action = this.running.get(kind);
    if (action === undefined || action.closed) return;

    const text = action.pending[stream] + chunk;
    const parts = text.split('\n');
    action.pending[stream] = parts.pop() ?? '';
    if (action.pending[stream].length > MAX_PENDING) {
      action.pending[stream] = action.pending[stream].slice(-MAX_PENDING);
    }
    for (const part of parts) this.pushLine(kind, stream, part);
  }

  private pushLine(kind: ConnectActionKind, stream: 'stdout' | 'stderr', raw: string): void {
    if (raw.trim() === '') return;
    const snapshot = this.states[kind];
    const line = sanitizeLine(raw);
    snapshot.lines.push(stream === 'stderr' ? `! ${line}` : line);
    if (snapshot.lines.length > MAX_LINES) snapshot.lines.splice(0, snapshot.lines.length - MAX_LINES);

    const marker = WAITING_MARKERS[kind];
    if (snapshot.phase === 'running' && line.includes(marker.needle)) {
      snapshot.phase = 'waiting';
      snapshot.waitingFor = marker.label;
    }
  }

  private flushPending(kind: ConnectActionKind, action: RunningAction): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      if (action.pending[stream].trim() !== '') this.pushLine(kind, stream, action.pending[stream]);
      action.pending[stream] = '';
    }
  }

  private handleExit(
    kind: ConnectActionKind,
    code: number | null,
    signal: NodeJS.Signals | null
  ): void {
    const action = this.running.get(kind);
    if (action === undefined || action.closed) return;
    action.closed = true;
    this.running.delete(kind);
    clearTimeout(action.timer);

    this.flushPending(kind, action);

    const snapshot = this.states[kind];
    snapshot.endedAt = this.now().toISOString();
    snapshot.exitCode = code;
    snapshot.waitingFor = null;

    if (snapshot.phase === 'timed_out' || snapshot.phase === 'cancelled') return;

    if (code === 0) {
      snapshot.phase = 'succeeded';
      return;
    }
    snapshot.phase = 'failed';
    snapshot.error =
      signal === null
        ? `proses keluar dengan kode ${code === null ? 'tidak diketahui' : String(code)}`
        : `proses berhenti oleh sinyal ${signal}`;
  }

  private handleSpawnError(kind: ConnectActionKind, error: Error): void {
    const action = this.running.get(kind);
    if (action === undefined || action.closed) return;
    action.closed = true;
    this.running.delete(kind);
    clearTimeout(action.timer);

    const snapshot = this.states[kind];
    snapshot.phase = 'failed';
    snapshot.waitingFor = null;
    snapshot.error = error.message;
    snapshot.endedAt = this.now().toISOString();
  }

  private handleTimeout(kind: ConnectActionKind): void {
    const action = this.running.get(kind);
    if (action === undefined || action.closed) return;

    const snapshot = this.states[kind];
    snapshot.phase = 'timed_out';
    snapshot.waitingFor = null;
    snapshot.error = `batas waktu ${Math.round(this.timeouts[kind] / 60_000)} menit tercapai`;
    snapshot.endedAt = this.now().toISOString();
    this.killTree(action.child);
  }

  private tsxLoader(): string {
    if (this.loader !== null) return this.loader;
    try {
      this.loader = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
    } catch {
      this.loader = 'tsx';
    }
    return this.loader;
  }
}
