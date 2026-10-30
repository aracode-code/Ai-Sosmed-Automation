import { randomUUID } from 'node:crypto';
import type { PlatformId, SocialAccount } from '@saa/domain';
import type { SqliteDatabase } from '../client';

interface AccountRow {
  id: string;
  platform: string;
  label: string;
  connection_status: string;
  secret_ref: string | null;
  profile_key: string | null;
}

function toAccount(row: AccountRow): SocialAccount {
  return {
    id: row.id,
    platform: row.platform as PlatformId,
    label: row.label,
    connectionStatus: row.connection_status as SocialAccount['connectionStatus'],
    secretRef: row.secret_ref,
    profileKey: row.profile_key
  };
}

export interface InsertAccountInput {
  platform: PlatformId;
  label: string;
  connectionStatus?: SocialAccount['connectionStatus'];
  /** Referensi ke credential store; nilai secret tidak pernah disimpan di database. */
  secretRef?: string | null;
  profileKey?: string | null;
  id?: string;
}

export function insertSocialAccount(
  raw: SqliteDatabase,
  input: InsertAccountInput
): SocialAccount {
  const id = input.id ?? `acc_${randomUUID()}`;
  raw
    .prepare(
      `INSERT INTO social_accounts (id, platform, label, connection_status, secret_ref, profile_key)
       VALUES (@id, @platform, @label, @connectionStatus, @secretRef, @profileKey)`
    )
    .run({
      id,
      platform: input.platform,
      label: input.label,
      connectionStatus: input.connectionStatus ?? 'disconnected',
      secretRef: input.secretRef ?? null,
      profileKey: input.profileKey ?? null
    });

  const account = getSocialAccount(raw, id);
  if (account === null) throw new Error(`akun ${id} gagal disimpan`);
  return account;
}

export interface UpdateAccountConnectionInput {
  connectionStatus: SocialAccount['connectionStatus'];
  /** `undefined` = biarkan nilai lama; `null` = kosongkan referensi kredensial. */
  secretRef?: string | null;
}

/** Hanya status koneksi dan referensi kredensial yang boleh berubah; label/platform tidak disentuh. */
export function updateAccountConnection(
  raw: SqliteDatabase,
  id: string,
  input: UpdateAccountConnectionInput
): SocialAccount | null {
  const existing = getSocialAccount(raw, id);
  if (existing === null) return null;

  raw
    .prepare(
      `UPDATE social_accounts SET connection_status = @connectionStatus, secret_ref = @secretRef
       WHERE id = @id`
    )
    .run({
      id,
      connectionStatus: input.connectionStatus,
      secretRef: input.secretRef === undefined ? existing.secretRef : input.secretRef
    });

  return getSocialAccount(raw, id);
}

export function getSocialAccount(raw: SqliteDatabase, id: string): SocialAccount | null {
  const row = raw.prepare('SELECT * FROM social_accounts WHERE id = ?').get(id) as
    | AccountRow
    | undefined;
  return row ? toAccount(row) : null;
}

export function listSocialAccounts(raw: SqliteDatabase): SocialAccount[] {
  const rows = raw.prepare('SELECT * FROM social_accounts ORDER BY id ASC').all() as AccountRow[];
  return rows.map(toAccount);
}
