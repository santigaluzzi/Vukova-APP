CREATE TABLE `branch_work_locations` (
	`branch_id` text PRIMARY KEY NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`radius_meters` integer DEFAULT 100 NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `work_day_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`work_on` text NOT NULL,
	`slots_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_override_day` ON `work_day_overrides` (`employee_id`,`branch_id`,`work_on`);--> statement-breakpoint
CREATE TABLE `work_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`slots_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_schedule_date` ON `work_schedules` (`employee_id`,`branch_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `work_shift_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`work_on` text NOT NULL,
	`kind` text NOT NULL,
	`patch_json` text NOT NULL,
	`shift_start` integer,
	`shift_end` integer,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_by` text,
	`decision_note` text,
	`decided_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_shift_changes_date` ON `work_shift_changes` (`branch_id`,`work_on`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_pending_shift_change` ON `work_shift_changes` (`employee_id`,`branch_id`,`work_on`) WHERE status = 'pending';--> statement-breakpoint
CREATE TABLE `work_shift_records` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`work_on` text NOT NULL,
	`start_hour` integer NOT NULL,
	`end_hour` integer NOT NULL,
	`status` text NOT NULL,
	`confirmed_at` text,
	`distance_meters` integer,
	`accuracy_meters` integer,
	`updated_by` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_record_turn` ON `work_shift_records` (`employee_id`,`branch_id`,`work_on`,`start_hour`,`end_hour`);--> statement-breakpoint
CREATE INDEX `idx_work_record_date` ON `work_shift_records` (`branch_id`,`work_on`);