import type { SqliteDatabase } from '../client';

interface SettingRow {
  key: string;
  value_json: string;
  updated_at: string;
}

export function getSetting<T = unknown>(raw: SqliteDatabase, key: string): T | null {
  const row = raw.prepare('SELECT * FROM settings WHERE key = ?').get(key) as
    | SettingRow
    | undefined;
  if (row === undefined) return null;
  try {
    return JSON.parse(row.value_json) as T;
  } catch {
    return null;
  }
}

/** Jangan pernah menyimpan secret di sini (LLD §5.1): nilai harus non-rahasia. */
export function setSetting(
  raw: SqliteDatabase,
  key: string,
  value: unknown,
  now: string = new Date().toISOString()
): void {
  raw
    .prepare(
      `INSERT INTO settings (key, value_json, updated_at)
       VALUES (@key, @valueJson, @now)
       ON CONFLICT (key) DO UPDATE SET value_json = @valueJson, updated_at = @now`
    )
    .run({ key, valueJson: JSON.stringify(value ?? null), now });
}

export function listSettings(raw: SqliteDatabase): Record<string, unknown> {
  const rows = raw.prepare('SELECT * FROM settings ORDER BY key ASC').all() as SettingRow[];
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value_json) as unknown;
    } catch {
      result[row.key] = null;
    }
  }
  return result;
}
