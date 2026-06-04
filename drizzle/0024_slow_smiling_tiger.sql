CREATE TABLE `catalog_audit_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`action` varchar(50) NOT NULL,
	`entityType` varchar(50) NOT NULL,
	`entityId` int NOT NULL,
	`oldValues` text,
	`newValues` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_audit_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_item_images` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`url` text NOT NULL,
	`isPrimary` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_item_images_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_item_nodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`nodeId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_item_nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_item_specs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`keyAr` varchar(255) NOT NULL,
	`keyEn` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_item_specs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(100),
	`nameAr` varchar(255) NOT NULL,
	`nameEn` varchar(255) NOT NULL,
	`nameUr` varchar(255),
	`descriptionAr` text,
	`descriptionEn` text,
	`descriptionUr` text,
	`unit` varchar(50),
	`manufacturer` varchar(255),
	`nodeId` int NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_nodes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(20),
	`nameAr` varchar(255) NOT NULL,
	`nameEn` varchar(255) NOT NULL,
	`nameUr` varchar(255),
	`parentId` int,
	`level` int NOT NULL DEFAULT 1,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_nodes_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_nodes_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `catalog_settings` (
	`id` int AUTO_INCREMENT NOT NULL,
	`key` varchar(100) NOT NULL,
	`value` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `catalog_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `catalog_supplier_prices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`itemId` int NOT NULL,
	`supplierId` int NOT NULL,
	`price` decimal(12,2) NOT NULL,
	`currency` varchar(10) NOT NULL DEFAULT 'SAR',
	`isPreferred` boolean NOT NULL DEFAULT false,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_supplier_prices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nameAr` varchar(255) NOT NULL,
	`nameEn` varchar(255) NOT NULL,
	`contactName` varchar(255),
	`phone` varchar(50),
	`email` varchar(255),
	`address` text,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `catalog_suppliers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `catalog_units` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nameAr` varchar(100) NOT NULL,
	`nameEn` varchar(100) NOT NULL,
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `catalog_units_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `warehouse_receipts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receiptNumber` varchar(20) NOT NULL,
	`purchaseOrderId` int NOT NULL,
	`receivedById` int NOT NULL,
	`receivedAt` timestamp NOT NULL DEFAULT (now()),
	`notes` text,
	`totalItems` int DEFAULT 0,
	`status` enum('draft','confirmed') NOT NULL DEFAULT 'confirmed',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `warehouse_receipts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `warehouse_returns` (
	`id` int AUTO_INCREMENT NOT NULL,
	`returnNumber` varchar(20) NOT NULL,
	`receiptId` int NOT NULL,
	`purchaseOrderId` int NOT NULL,
	`purchaseOrderItemId` int NOT NULL,
	`inventoryId` int NOT NULL,
	`returnedQuantity` int NOT NULL,
	`reason` text NOT NULL,
	`returnedById` int NOT NULL,
	`returnedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `warehouse_returns_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `inventory` ADD `internalCode` varchar(20);--> statement-breakpoint
ALTER TABLE `inventory` ADD `manufacturerBarcode` varchar(200);--> statement-breakpoint
ALTER TABLE `inventory` ADD `receiptId` int;--> statement-breakpoint
ALTER TABLE `inventory_transactions` ADD `transactionType` enum('purchase','return','delivery','adjustment') DEFAULT 'adjustment';--> statement-breakpoint
ALTER TABLE `inventory_transactions` ADD `receiptId` int;--> statement-breakpoint
ALTER TABLE `inventory_transactions` ADD `returnId` int;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD `photoUrls` json;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD `returnedQuantity` int DEFAULT 0;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD `returnReason` text;--> statement-breakpoint
ALTER TABLE `purchase_order_items` ADD `returnedAt` timestamp;