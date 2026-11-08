-- Manual execution only. Run the SELECT first; create only if the table is absent.
-- Additive information only: no backfill or updates to purchase/approval/stock records.
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA='COPYCMMS2' AND TABLE_NAME='purchase_item_supply_wait';

CREATE TABLE `COPYCMMS2`.`purchase_item_supply_wait` (
  `itemId` INT NOT NULL,
  `purchaseOrderId` INT NOT NULL,
  `kind` ENUM('waiting_availability','preparing') NOT NULL,
  `expectedReceiptDate` DATE NOT NULL,
  `reason` TEXT NOT NULL,
  `createdById` INT NOT NULL,
  `createdByName` VARCHAR(255) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL,
  `updatedById` INT NOT NULL,
  `updatedByName` VARCHAR(255) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  `revision` INT NOT NULL DEFAULT 0,
  PRIMARY KEY (`itemId`),
  KEY `idx_supply_wait_order` (`purchaseOrderId`,`itemId`),
  CONSTRAINT `fk_supply_wait_item` FOREIGN KEY (`itemId`)
    REFERENCES `COPYCMMS2`.`purchase_order_items` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Expected: 12 columns. UTC timestamps are written explicitly by the application.
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='COPYCMMS2' AND TABLE_NAME='purchase_item_supply_wait'
ORDER BY ORDINAL_POSITION;
SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='COPYCMMS2' AND TABLE_NAME='purchase_item_supply_wait'
ORDER BY INDEX_NAME,SEQ_IN_INDEX;
