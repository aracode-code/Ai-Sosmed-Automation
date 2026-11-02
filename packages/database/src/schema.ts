import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const campaigns = sqliteTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  niche: text('niche').notNull(),
  status: text('status').notNull(),
  approvalMode: text('approval_mode').notNull().default('required'),
  generationMode: text('generation_mode').notNull().default('video'),
  platformsJson: text('platforms_json').notNull().default('[]'),
  createdAt: text('created_at').notNull()
});

export const socialAccounts = sqliteTable('social_accounts', {
  id: text('id').primaryKey(),
  platform: text('platform').notNull(),
  label: text('label').notNull(),
  connectionStatus: text('connection_status').notNull(),
  secretRef: text('secret_ref'),
  profileKey: text('profile_key')
});

export const contentItems = sqliteTable(
  'content_items',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    version: integer('version').notNull().default(1),
    topic: text('topic').notNull(),
    promptJson: text('prompt_json').notNull(),
    captionJson: text('caption_json'),
    approvalStatus: text('approval_status').notNull().default('pending')
  },
  (t) => [uniqueIndex('uq_content_items_id_version').on(t.id, t.version)]
);

export const mediaAssets = sqliteTable(
  'media_assets',
  {
    id: text('id').primaryKey(),
    contentId: text('content_id')
      .notNull()
      .references(() => contentItems.id),
    path: text('path').notNull(),
    sha256: text('sha256').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms'),
    validationStatus: text('validation_status').notNull()
  },
  (t) => [uniqueIndex('uq_media_assets_sha256_path').on(t.sha256, t.path)]
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id').references(() => campaigns.id),
    contentId: text('content_id').references(() => contentItems.id),
    parentJobId: text('parent_job_id').references((): AnySQLiteColumn => jobs.id),
    jobType: text('job_type').notNull(),
    status: text('status').notNull(),
    payloadJson: text('payload_json').notNull(),
    runAt: text('run_at'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    leaseOwner: text('lease_owner'),
    leaseUntil: text('lease_until'),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    lastErrorCode: text('last_error_code'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    index('idx_jobs_due').on(t.status, t.runAt),
    index('idx_jobs_lease').on(t.leaseUntil),
    index('idx_jobs_created').on(t.createdAt)
  ]
);

export const jobDependencies = sqliteTable(
  'job_dependencies',
  {
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    dependsOnJobId: text('depends_on_job_id')
      .notNull()
      .references(() => jobs.id)
  },
  (t) => [primaryKey({ columns: [t.jobId, t.dependsOnJobId] })]
);

export const schedules = sqliteTable(
  'schedules',
  {
    id: text('id').primaryKey(),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    mode: text('mode').notNull(),
    minMinutes: integer('min_minutes'),
    maxMinutes: integer('max_minutes'),
    windowStart: text('window_start'),
    windowEnd: text('window_end'),
    timezone: text('timezone')
      .notNull()
      .default('Asia/Jakarta'),
    dailyLimit: integer('daily_limit')
      .notNull()
      .default(1),
    enabled: integer('enabled')
      .notNull()
      .default(1),
    nextRunAt: text('next_run_at'),
    quietStart: text('quiet_start'),
    quietEnd: text('quiet_end')
  },
  (t) => [index('idx_schedules_due').on(t.enabled, t.nextRunAt)]
);

export const approvals = sqliteTable(
  'approvals',
  {
    id: text('id').primaryKey(),
    contentId: text('content_id')
      .notNull()
      .references(() => contentItems.id),
    contentVersion: integer('content_version').notNull(),
    assetSha256: text('asset_sha256').notNull(),
    captionHash: text('caption_hash').notNull(),
    accountId: text('account_id')
      .notNull()
      .references(() => socialAccounts.id),
    platform: text('platform').notNull(),
    decision: text('decision').notNull(),
    decidedAt: text('decided_at').notNull(),
    decidedBy: text('decided_by').notNull(),
    reason: text('reason')
  },
  (t) => [index('idx_approvals_content').on(t.contentId, t.contentVersion)]
);

export const planApprovals = sqliteTable(
  'plan_approvals',
  {
    id: text('id').primaryKey(),
    planJobId: text('plan_job_id')
      .notNull()
      .references(() => jobs.id),
    campaignId: text('campaign_id')
      .notNull()
      .references(() => campaigns.id),
    bindingHash: text('binding_hash').notNull(),
    itemCount: integer('item_count').notNull(),
    decision: text('decision').notNull(),
    decidedAt: text('decided_at').notNull(),
    decidedBy: text('decided_by').notNull(),
    reason: text('reason')
  },
  (t) => [
    uniqueIndex('uq_plan_approvals_plan').on(t.planJobId),
    index('idx_plan_approvals_campaign').on(t.campaignId)
  ]
);

export const publishAttempts = sqliteTable(  'publish_attempts',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => jobs.id),
    accountId: text('account_id')
      .notNull()
      .references(() => socialAccounts.id),
    platform: text('platform').notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    status: text('status').notNull(),
    externalPostId: text('external_post_id'),
    permalink: text('permalink'),
    attemptedAt: text('attempted_at').notNull(),
    verifiedAt: text('verified_at'),
    errorCode: text('error_code')
  },
  (t) => [index('idx_publish_attempts_job').on(t.jobId)]
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: text('id').primaryKey(),
    actorType: text('actor_type').notNull(),
    actorId: text('actor_id'),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    result: text('result').notNull(),
    metadataJson: text('metadata_json'),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('idx_audit_logs_resource').on(t.resourceType, t.resourceId)]
);

/** Dipakai oleh migrator internal; satu baris per file migrasi yang sudah diterapkan. */
export const schemaMigrations = sqliteTable('schema_migrations', {
  version: text('version').primaryKey(),
  appliedAt: text('applied_at').notNull()
});
