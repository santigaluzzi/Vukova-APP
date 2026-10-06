CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`method` text NOT NULL,
	`checked_in_at` text NOT NULL,
	`recorded_by_employee_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_attendance_member_id` ON `attendance` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_attendance_branch_id` ON `attendance` (`branch_id`);--> statement-breakpoint
CREATE INDEX `idx_attendance_checked_in_at` ON `attendance` (`checked_in_at`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`metadata_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_audit_logs_employee_id` ON `audit_logs` (`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_audit_logs_created_at` ON `audit_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_branches_code` ON `branches` (`code`);--> statement-breakpoint
CREATE TABLE `employees` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text NOT NULL,
	`email` text,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`password_iterations` integer NOT NULL,
	`role` text NOT NULL,
	`branch_scope` text DEFAULT 'all' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_employees_username` ON `employees` (`username`);--> statement-breakpoint
CREATE INDEX `idx_employees_role` ON `employees` (`role`);--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`email` text,
	`phone` text,
	`home_branch_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`service` text,
	`plan_name` text,
	`plan_starts_on` text,
	`plan_ends_on` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`home_branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_members_status` ON `members` (`status`);--> statement-breakpoint
CREATE INDEX `idx_members_home_branch_id` ON `members` (`home_branch_id`);--> statement-breakpoint
CREATE INDEX `idx_members_plan_ends_on` ON `members` (`plan_ends_on`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`member_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'ARS' NOT NULL,
	`method` text NOT NULL,
	`gross_amount_cents` integer,
	`costs_cents` integer,
	`net_amount_cents` integer,
	`due_on` text,
	`paid_on` text,
	`accredited_on` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_employee_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_payments_member_id` ON `payments` (`member_id`);--> statement-breakpoint
CREATE INDEX `idx_payments_status` ON `payments` (`status`);--> statement-breakpoint
CREATE INDEX `idx_payments_paid_on` ON `payments` (`paid_on`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_sessions_token_hash` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `idx_sessions_employee_id` ON `sessions` (`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires_at` ON `sessions` (`expires_at`);