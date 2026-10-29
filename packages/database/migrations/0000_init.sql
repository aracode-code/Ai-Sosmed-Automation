CREATE TABLE `approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`content_version` integer NOT NULL,
	`asset_sha256` text NOT NULL,
	`caption_hash` text NOT NULL,
	`account_id` text NOT NULL,
	`platform` text NOT NULL,
	`decision` text NOT NULL,
	`decided_at` text NOT NULL,
	`decided_by` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`result` text NOT NULL,
	`metadata_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_resource` ON `audit_logs` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`niche` text NOT NULL,
	`status` text NOT NULL,
	`approval_mode` text DEFAULT 'required' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `content_items` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`topic` text NOT NULL,
	`prompt_json` text NOT NULL,
	`caption_json` text,
	`approval_status` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_content_items_id_version` ON `content_items` (`id`,`version`);--> statement-breakpoint
CREATE TABLE `job_dependencies` (
	`job_id` text NOT NULL,
	`depends_on_job_id` text NOT NULL,
	PRIMARY KEY(`job_id`, `depends_on_job_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text,
	`content_id` text,
	`parent_job_id` text,
	`job_type` text NOT NULL,
	`status` text NOT NULL,
	`payload_json` text NOT NULL,
	`run_at` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`lease_owner` text,
	`lease_until` text,
	`idempotency_key` text NOT NULL,
	`last_error_code` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`parent_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_idempotency_key_unique` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_jobs_due` ON `jobs` (`status`,`run_at`);--> statement-breakpoint
CREATE INDEX `idx_jobs_lease` ON `jobs` (`lease_until`);--> statement-breakpoint
CREATE INDEX `idx_jobs_created` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`content_id` text NOT NULL,
	`path` text NOT NULL,
	`sha256` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`duration_ms` integer,
	`validation_status` text NOT NULL,
	FOREIGN KEY (`content_id`) REFERENCES `content_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_media_assets_sha256_path` ON `media_assets` (`sha256`,`path`);--> statement-breakpoint
CREATE TABLE `publish_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`account_id` text NOT NULL,
	`platform` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`external_post_id` text,
	`permalink` text,
	`attempted_at` text NOT NULL,
	`verified_at` text,
	`error_code` text,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `social_accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `publish_attempts_idempotency_key_unique` ON `publish_attempts` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `idx_publish_attempts_job` ON `publish_attempts` (`job_id`);--> statement-breakpoint
CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`campaign_id` text NOT NULL,
	`mode` text NOT NULL,
	`min_minutes` integer,
	`max_minutes` integer,
	`window_start` text,
	`window_end` text,
	`timezone` text DEFAULT 'Asia/Jakarta' NOT NULL,
	`daily_limit` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `schema_migrations` (
	`version` text PRIMARY KEY NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `social_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`platform` text NOT NULL,
	`label` text NOT NULL,
	`connection_status` text NOT NULL,
	`secret_ref` text,
	`profile_key` text
);
