import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export type SqliteDatabase = InstanceType<typeof Database>;

export interface DatabaseHandle {
  readonly raw: SqliteDatabase;
  readonly orm: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export function openDatabase(filePath: string): DatabaseHandle {
  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const raw = new Database(filePath);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.pragma('busy_timeout = 5000');
  raw.pragma('synchronous = NORMAL');

  return {
    raw,
    orm: drizzle(raw, { schema }),
    close: () => raw.close()
  };
}
