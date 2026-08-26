CREATE TABLE `zenith_projects` (
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`schema_version` integer NOT NULL,
	`revision` integer NOT NULL,
	`archive_key` text NOT NULL,
	`archive_bytes` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `project_id`)
);
--> statement-breakpoint
CREATE INDEX `zenith_projects_owner_updated_idx` ON `zenith_projects` (`owner_id`,`updated_at`);