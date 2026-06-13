CREATE INDEX `catalog_items_node_id_idx` ON `catalog_items` (`nodeId`);--> statement-breakpoint
CREATE INDEX `catalog_items_is_active_idx` ON `catalog_items` (`isActive`);--> statement-breakpoint
CREATE INDEX `catalog_items_code_idx` ON `catalog_items` (`code`);--> statement-breakpoint
CREATE INDEX `catalog_items_name_ar_idx` ON `catalog_items` (`nameAr`);--> statement-breakpoint
CREATE INDEX `catalog_items_name_en_idx` ON `catalog_items` (`nameEn`);--> statement-breakpoint
CREATE INDEX `attachments_entity_type_id_idx` ON `attachments` (`entityType`,`entityId`);
