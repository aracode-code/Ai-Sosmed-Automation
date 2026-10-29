import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findWorkspaceRoot, resolveWorkspacePath } from './index';

const cleanups: (() => void)[] = [];

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'saa-paths-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

describe('resolveWorkspacePath', () => {
  it('membiarkan path absolut apa adanya', () => {
    const absolute = join(tmpdir(), 'saa', 'app.sqlite');
    expect(resolveWorkspacePath(absolute)).toBe(absolute);
  });

  it('meresolusi path relatif terhadap root workspace, bukan cwd', () => {
    const root = tempRoot();
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const nested = join(root, 'packages', 'database', 'src');
    mkdirSync(nested, { recursive: true });

    expect(findWorkspaceRoot(nested)).toBe(root);
    expect(resolveWorkspacePath('./data/app.sqlite', nested)).toBe(join(root, 'data', 'app.sqlite'));
  });

  it('jatuh kembali ke cwd bila marker workspace tidak ditemukan', () => {
    const isolated = tempRoot();
    expect(findWorkspaceRoot(isolated)).toBeNull();
    expect(resolveWorkspacePath('./data/app.sqlite', isolated)).toBe(
      join(isolated, 'data', 'app.sqlite')
    );
  });
});
