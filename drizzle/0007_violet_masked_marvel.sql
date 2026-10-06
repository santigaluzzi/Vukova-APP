ALTER TABLE `sales_plan_scenarios` ADD `terminal` text;--> statement-breakpoint
ALTER TABLE `sales_plan_scenarios` ADD `card_installments` integer;--> statement-breakpoint
UPDATE sales_plan_scenarios SET terminal=CASE WHEN method IN ('cash','transfer') THEN method WHEN lower(trim(coalesce(provider,'')))='nave' THEN 'nave' WHEN lower(trim(coalesce(provider,''))) IN ('mercado pago','mercadopago') THEN 'mercado_pago' ELSE NULL END,card_installments=CASE WHEN method='card' THEN installments ELSE NULL END;
