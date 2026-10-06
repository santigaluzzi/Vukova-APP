CREATE TABLE `sheet_attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`import_id` text NOT NULL,
	`normalized_name` text NOT NULL,
	`source_name` text NOT NULL,
	`attended_on` text NOT NULL,
	`marker` text NOT NULL,
	`source_rows_json` text NOT NULL,
	`version` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sheet_attendance_period` ON `sheet_attendance` (`import_id`);--> statement-breakpoint
CREATE INDEX `idx_sheet_attendance_name` ON `sheet_attendance` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `sheet_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`sheet_name` text NOT NULL,
	`spreadsheet_id` text NOT NULL,
	`sheet_id` integer NOT NULL,
	`period` text NOT NULL,
	`record_count` integer NOT NULL,
	`review_json` text NOT NULL,
	`synced_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sheet_name_links` (
	`normalized_name` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`linked_by` text NOT NULL,
	`linked_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sheet_rosters` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`source_sheet_id` integer NOT NULL,
	`source_row` integer NOT NULL,
	`source_name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`service` text NOT NULL,
	`source_state` text NOT NULL,
	`history_json` text NOT NULL,
	`review_json` text NOT NULL,
	`imported_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sheet_rosters_member` ON `sheet_rosters` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_sheet_rosters_name` ON `sheet_rosters` (`normalized_name`,`service`);--> statement-breakpoint
CREATE TABLE `sheet_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`last_used_at` text
);
