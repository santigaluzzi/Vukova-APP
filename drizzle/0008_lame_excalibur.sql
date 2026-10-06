ALTER TABLE `payments` ADD `terminal` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `card_installments` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD `sales_plan_scenario_id` text REFERENCES sales_plan_scenarios(id);--> statement-breakpoint
ALTER TABLE `payments` ADD `request_id` text;--> statement-breakpoint
ALTER TABLE `payments` ADD `installment_number` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `uq_payments_request_id` ON `payments` (`request_id`);--> statement-breakpoint
ALTER TABLE `sales_plan_scenarios` ADD `member_id` text REFERENCES members(id);--> statement-breakpoint
ALTER TABLE `sales_plan_scenarios` ADD `origin` text DEFAULT 'projection' NOT NULL;