CREATE TABLE `daily_history` (
	`project_id` text NOT NULL,
	`date` text NOT NULL,
	`content` text NOT NULL,
	`saved_at` text NOT NULL,
	PRIMARY KEY(`project_id`, `date`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `file_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`metadata` text NOT NULL,
	`sha256` text NOT NULL,
	`bytes` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `file_project_hash_unique` ON `file_versions` (`project_id`,`sha256`);--> statement-breakpoint
CREATE INDEX `file_project_date_idx` ON `file_versions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`metadata` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "revision_nonnegative" CHECK("projects"."revision" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_owner_unique` ON `projects` (`owner_id`);--> statement-breakpoint
CREATE TABLE `release_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`version_id` text,
	`status` text DEFAULT 'private' NOT NULL,
	`release_at` text NOT NULL,
	`time_zone` text NOT NULL,
	`auto_release_consent` integer DEFAULT 0 NOT NULL,
	`sales_enabled` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`version_id`) REFERENCES `file_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_project_unique` ON `release_artifacts` (`project_id`);--> statement-breakpoint
CREATE TABLE `restore_backups` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content` text NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `restore_project_idx` ON `restore_backups` (`project_id`);--> statement-breakpoint
CREATE TABLE `usage_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_nonnegative" CHECK("usage_limits"."value" >= 0)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`project_id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`saved_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
