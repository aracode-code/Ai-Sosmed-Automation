CREATE TABLE `plan_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_job_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`binding_hash` text NOT NULL,
	`item_count` integer NOT NULL,
	`decision` text NOT NULL,
	`decided_at` text NOT NULL,
	`decided_by` text NOT NULL,
	`reason` text,
	FOREIGN KEY (`plan_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_plan_approvals_plan` ON `plan_approvals` (`plan_job_id`);--> statement-breakpoint
CREATE INDEX `idx_plan_approvals_campaign` ON `plan_approvals` (`campaign_id`);
