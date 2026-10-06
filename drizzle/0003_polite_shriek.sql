CREATE TABLE `sheet_active_visitors` (
	`normalized_name` text PRIMARY KEY NOT NULL,
	`source_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`declared_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sheet_corrections` (
	`id` text PRIMARY KEY NOT NULL,
	`payload_hash` text NOT NULL,
	`changes_json` text NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sheet_member_aliases` (
	`normalized_name` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `sheet_rosters` ADD `archived_at` text;