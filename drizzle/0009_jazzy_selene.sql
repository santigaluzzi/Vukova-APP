CREATE TABLE `hourly_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`effective_from` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_hourly_employee_branch_date` ON `hourly_rates` (`employee_id`,`branch_id`,`effective_from`);--> statement-breakpoint
CREATE TABLE `payroll_bonuses` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`period` text NOT NULL,
	`eligible` integer NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_bonus_employee_branch_period` ON `payroll_bonuses` (`employee_id`,`branch_id`,`period`);--> statement-breakpoint
CREATE TABLE `payroll_month_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`period` text NOT NULL,
	`commission_bps` integer NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payroll_branch_period` ON `payroll_month_settings` (`branch_id`,`period`);--> statement-breakpoint
CREATE TABLE `work_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`work_on` text NOT NULL,
	`minutes` integer NOT NULL,
	`work_role` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_work_employee_branch_day` ON `work_entries` (`employee_id`,`branch_id`,`work_on`);--> statement-breakpoint
CREATE INDEX `idx_work_branch_day` ON `work_entries` (`branch_id`,`work_on`);--> statement-breakpoint
ALTER TABLE `payments` ADD `sale_kind` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `sale_branch_id` text REFERENCES branches(id);