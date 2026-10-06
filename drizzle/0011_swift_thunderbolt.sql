CREATE TABLE `sheet_branch_name_links` (
	`branch_id` text NOT NULL,
	`normalized_name` text NOT NULL,
	`member_id` text NOT NULL,
	`linked_by` text NOT NULL,
	`linked_at` text NOT NULL,
	PRIMARY KEY(`branch_id`, `normalized_name`),
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`member_id`) REFERENCES `members`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`linked_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `sheet_imports` ADD `branch_id` text REFERENCES branches(id);
--> statement-breakpoint
INSERT INTO `branches` (`id`,`name`,`code`,`active`) VALUES ('branch-acassuso','Vukova Acassuso','acassuso',1) ON CONFLICT(`id`) DO NOTHING;
--> statement-breakpoint
UPDATE `sheet_imports` SET `branch_id`='branch-acassuso' WHERE `kind`='attendance' AND `spreadsheet_id`='1wv6dOBXkbds30CZG0TnmNY7591s_uie6nxDSsxtKDCU';
