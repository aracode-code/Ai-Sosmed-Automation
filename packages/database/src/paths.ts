import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const WORKSPACE_MARKER = 'pnpm-workspace.yaml';

export function findWorkspaceRoot(startDir: string): string | null {
  let current = resolve(startDir);
  for (;;) {
    if (existsSync(join(current, WORKSPACE_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Path relatif diartikan relatif terhadap root workspace, bukan cwd proses.
 * Script pnpm berjalan di direktori paket, sehingga cwd tidak dapat dipakai.
 */
export function resolveWorkspacePath(path: string, startDir: string = process.cwd()): string {
  if (isAbsolute(path)) return path;
  const root = findWorkspaceRoot(startDir);
  return resolve(root ?? startDir, path);
}
