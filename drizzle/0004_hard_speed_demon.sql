ALTER TABLE `sheet_rosters` ADD `source_spreadsheet_id` text DEFAULT '1uGZ-DU16NWo6PpI1xrtMEDMUAFoWAG1KdVfYDqCuU8s' NOT NULL;--> statement-breakpoint
ALTER TABLE `sheet_rosters` ADD `source_details_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `sheet_rosters` ADD `missing_since` text;