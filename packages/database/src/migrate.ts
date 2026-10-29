import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqliteDatabase } from './client';

export const DEFAULT_MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migrations'
);

export interface MigrationOptions {
  migrationsDir?: string;
  now?: () => string;
}

/**
 * Migrasi SQL versioned: satu baris `schema_migrations` per berkas yang diterapkan.
 * Idempoten — berkas yang sudah tercatat tidak dijalankan ulang.
 */
export function runMigrations(raw: SqliteDatabase, options: MigrationOptions = {}): string[] {
  const migrationsDir = options.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const now = options.now ?? (() => new Date().toISOString());

  const hasRegistry = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();

  const applied = new Set<string>(
    hasRegistry
      ? (raw.prepare('SELECT version FROM schema_migrations').all() as { version: string }[]).map(
          (row) => row.version
        )
      : []
  );

  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const appliedNow: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    raw.transaction(() => {
      raw.exec(sql);
      raw
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(file, now());
    })();

    appliedNow.push(file);
  }

  return appliedNow;
}

export function appliedMigrations(raw: SqliteDatabase): string[] {
  const hasRegistry = raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
    .get();
  if (!hasRegistry) return [];
  return (raw.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as {
    version: string;
  }[]).map((row) => row.version);
}
