CREATE TABLE `monthly_plan_offers` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`branch_id` text NOT NULL,
	`plan_key` text NOT NULL,
	`label` text NOT NULL,
	`service` text NOT NULL,
	`currency` text NOT NULL,
	`months` integer NOT NULL,
	`installments` integer NOT NULL,
	`amount_cents` integer NOT NULL,
	`methods_json` text NOT NULL,
	`surcharge_bps` integer NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_monthly_offer` ON `monthly_plan_offers` (`period`,`branch_id`,`plan_key`);--> statement-breakpoint
ALTER TABLE `sales_plan_scenarios` ADD `plan_starts_on` text;--> statement-breakpoint
-- Owner-confirmed correction: the member continued training after 19 September.
-- Keep the receipt on 29 September and move only membership coverage and due dates.
UPDATE sales_plan_scenarios SET plan_starts_on='2026-09-19'
WHERE id='e26f9718-ccf6-4d28-896e-14408ded7197'
  AND member_id='sheet-5f9ec1de5cc8e377daee28ea75451a9c6d3fb6904eb482049fde5578dad9b2fa'
  AND sale_on='2026-09-29' AND plan_id='gym-6-2' AND origin='member_sale';
--> statement-breakpoint
UPDATE payments SET due_on=date('2026-09-19','+'||(coalesce(installment_number,1)-1)||' months'),coverage_starts_on='2026-09-19'
WHERE sales_plan_scenario_id='e26f9718-ccf6-4d28-896e-14408ded7197'
  AND EXISTS(SELECT 1 FROM sales_plan_scenarios WHERE id=payments.sales_plan_scenario_id AND plan_starts_on='2026-09-19');
--> statement-breakpoint
UPDATE members SET plan_starts_on='2026-09-19',plan_ends_on='2027-03-19'
WHERE id='sheet-5f9ec1de5cc8e377daee28ea75451a9c6d3fb6904eb482049fde5578dad9b2fa'
  AND plan_starts_on='2026-09-29' AND plan_ends_on='2027-03-29'
  AND EXISTS(SELECT 1 FROM sales_plan_scenarios WHERE member_id=members.id AND id='e26f9718-ccf6-4d28-896e-14408ded7197' AND plan_starts_on='2026-09-19');
--> statement-breakpoint
INSERT INTO audit_logs (id,employee_id,action,entity_type,entity_id,metadata_json,created_at,updated_at)
SELECT 'owner-confirmed-renewal-start-20260919',updated_by,'membership.start_corrected','sale',id,'{"oldStart":"2026-09-29","newStart":"2026-09-19","reason":"Continuidad de uso confirmada por el propietario","source":"owner_requested_migration","employeeReference":"original_sale_operator"}',datetime('now'),datetime('now')
FROM sales_plan_scenarios WHERE id='e26f9718-ccf6-4d28-896e-14408ded7197' AND plan_starts_on='2026-09-19';
