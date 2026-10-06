CREATE TABLE `branch_geofences` (
	`branch_id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`latitude` real,
	`longitude` real,
	`radius_meters` integer DEFAULT 100 NOT NULL,
	`updated_by` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `branches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`updated_by`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO branch_geofences (branch_id,address,latitude,longitude,radius_meters,updated_by,created_at,updated_at)
SELECT b.id, CASE b.id
 WHEN 'branch-victoria' THEN 'Simón de Iriondo 840, B1644 Victoria, Provincia de Buenos Aires'
 WHEN 'branch-vilo' THEN 'Av. Maipú 545, B1638 Vicente López, Provincia de Buenos Aires'
 WHEN 'branch-delta' THEN 'Olivares 350, Rincón de Milberg, Provincia de Buenos Aires'
 WHEN 'branch-olivos' THEN 'Av. Maipú 3019, B1636AAK Olivos, Provincia de Buenos Aires'
 WHEN 'branch-acassuso' THEN 'Eduardo Costa 1228, B1641 Acassuso, Provincia de Buenos Aires' END,
 COALESCE(l.latitude, CASE WHEN b.id='branch-acassuso' THEN -34.4820062 END),
 COALESCE(l.longitude, CASE WHEN b.id='branch-acassuso' THEN -58.5013047 END),
 COALESCE(l.radius_meters,100),l.updated_by,COALESCE(l.created_at,CURRENT_TIMESTAMP),COALESCE(l.updated_at,CURRENT_TIMESTAMP)
FROM branches b LEFT JOIN branch_work_locations l ON l.branch_id=b.id
WHERE b.id IN ('branch-victoria','branch-vilo','branch-delta','branch-olivos','branch-acassuso');
