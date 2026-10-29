import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { appliedMigrations, openDatabase, runMigrations, type DatabaseHandle } from './index';

const cleanups: (() => void)[] = [];

function tempDb(): DatabaseHandle {
  const dir = mkdtempSync(join(tmpdir(), 'saa-migrate-'));
  const handle = openDatabase(join(dir, 'test.sqlite'));
  cleanups.push(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return handle;
}

afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()?.();
});

describe('migrasi', () => {
  it('menerapkan migrasi awal sekali dan membuat 12 tabel', () => {
    const db = tempDb();
    expect(runMigrations(db.raw)).toEqual(['0000_init.sql', '0001_campaign_platforms.sql']);

    const tables = (db.raw
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]).map((row) => row.name);

    expect(tables).toEqual([
      'approvals',
      'audit_logs',
      'campaigns',
      'content_items',
      'job_dependencies',
      'jobs',
      'media_assets',
      'publish_attempts',
      'schedules',
      'schema_migrations',
      'settings',
      'social_accounts'
    ]);
  });

  it('idempoten: migrasi kedua tidak mengubah apa pun', () => {
    const db = tempDb();
    runMigrations(db.raw);
    expect(runMigrations(db.raw)).toEqual([]);
    expect(appliedMigrations(db.raw)).toEqual([
      '0000_init.sql',
      '0001_campaign_platforms.sql'
    ]);
  });

  it('menambahkan platforms_json pada campaign dengan default kosong', () => {
    const db = tempDb();
    runMigrations(db.raw);
    db.raw
      .prepare(
        `INSERT INTO campaigns (id, name, niche, status, approval_mode, created_at)
         VALUES ('c1', 'N', 'niche', 'active', 'required', '2026-01-01T00:00:00.000Z')`
      )
      .run();
    const row = db.raw.prepare("SELECT platforms_json FROM campaigns WHERE id = 'c1'").get() as {
      platforms_json: string;
    };
    expect(row.platforms_json).toBe('[]');
  });

  it('mengaktifkan WAL dan foreign keys', () => {
    const db = tempDb();
    expect(db.raw.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.raw.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('menolak baris dengan foreign key yang tidak ada', () => {
    const db = tempDb();
    runMigrations(db.raw);
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO content_items (id, campaign_id, version, topic, prompt_json, approval_status)
           VALUES ('c1', 'campaign-tidak-ada', 1, 't', '{}', 'pending')`
        )
        .run()
    ).toThrow(/FOREIGN KEY/i);
  });
});
