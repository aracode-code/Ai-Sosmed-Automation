import { randomUUID } from 'node:crypto';
import type { AuditEvent } from '@saa/domain';
import type { SqliteDatabase } from '../client';

export interface AppendAuditInput {
  actorType: string;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  result: string;
  metadata?: unknown;
}

export function appendAudit(
  raw: SqliteDatabase,
  input: AppendAuditInput,
  now: string = new Date().toISOString()
): AuditEvent {
  const row: AuditEvent = {
    id: `evt_${randomUUID()}`,
    actorType: input.actorType,
    actorId: input.actorId ?? null,
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    result: input.result,
    metadata: input.metadata ?? null,
    createdAt: now
  };

  raw
    .prepare(
      `INSERT INTO audit_logs
       (id, actor_type, actor_id, action, resource_type, resource_id, result, metadata_json, created_at)
       VALUES (@id, @actorType, @actorId, @action, @resourceType, @resourceId, @result, @metadataJson, @createdAt)`
    )
    .run({
      id: row.id,
      actorType: row.actorType,
      actorId: row.actorId,
      action: row.action,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      result: row.result,
      metadataJson: row.metadata === null ? null : JSON.stringify(row.metadata),
      createdAt: row.createdAt
    });

  return row;
}

export function listAuditByResource(
  raw: SqliteDatabase,
  resourceType: string,
  resourceId: string
): AuditEvent[] {
  const rows = raw
    .prepare(
      `SELECT * FROM audit_logs
       WHERE resource_type = ? AND resource_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .all(resourceType, resourceId) as {
    id: string;
    actor_type: string;
    actor_id: string | null;
    action: string;
    resource_type: string;
    resource_id: string;
    result: string;
    metadata_json: string | null;
    created_at: string;
  }[];

  return rows.map((row) => ({
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    result: row.result,
    metadata: row.metadata_json === null ? null : (JSON.parse(row.metadata_json) as unknown),
    createdAt: row.created_at
  }));
}
