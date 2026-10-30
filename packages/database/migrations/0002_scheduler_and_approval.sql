ALTER TABLE `schedules` ADD `next_run_at` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `quiet_start` text;--> statement-breakpoint
ALTER TABLE `schedules` ADD `quiet_end` text;--> statement-breakpoint
CREATE INDEX `idx_schedules_due` ON `schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
ALTER TABLE `approvals` ADD `reason` text;--> statement-breakpoint
CREATE INDEX `idx_approvals_content` ON `approvals` (`content_id`,`content_version`);
