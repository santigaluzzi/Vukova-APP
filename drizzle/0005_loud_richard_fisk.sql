CREATE TABLE `member_month_events` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`period` text NOT NULL,
	`kind` text NOT NULL,
	`observed_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_member_month_events_period` ON `member_month_events` (`period`,`member_id`);--> statement-breakpoint
CREATE TABLE `renewal_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`period` text NOT NULL,
	`due_on` text NOT NULL,
	`plan_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`probability` integer DEFAULT 100 NOT NULL,
	`card_cost_bps` integer,
	`included` integer DEFAULT true NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_renewal_scenarios_member_period` ON `renewal_scenarios` (`member_id`,`period`);