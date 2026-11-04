-- Manual execution on the trial database only, before running the updated code.
-- Run the preflight SELECT first. Apply each ALTER separately only when its
-- column/index is missing. DDL is not protected by START TRANSACTION/ROLLBACK.
-- No backfill: existing lots retain NULL and keep their current workflow.

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'copycmms2' AND TABLE_NAME = 'inventory_lots'
  AND COLUMN_NAME IN ('specificationStatus', 'specificationRevision',
    'specificationReviewedById', 'specificationReviewedAt', 'specificationNotes')
ORDER BY ORDINAL_POSITION;

SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'copycmms2' AND TABLE_NAME = 'inventory_lots'
  AND INDEX_NAME = 'idx_inventory_lots_specification_queue'
ORDER BY SEQ_IN_INDEX;

-- 1
ALTER TABLE `copycmms2`.`inventory_lots`
  ADD COLUMN `specificationStatus` ENUM('pending','approved','rejected') NULL;

-- 2
ALTER TABLE `copycmms2`.`inventory_lots`
  ADD COLUMN `specificationRevision` INT NOT NULL DEFAULT 0;

-- 3
ALTER TABLE `copycmms2`.`inventory_lots`
  ADD COLUMN `specificationReviewedById` INT NULL;

-- 4
ALTER TABLE `copycmms2`.`inventory_lots`
  ADD COLUMN `specificationReviewedAt` TIMESTAMP NULL DEFAULT NULL;

-- 5
ALTER TABLE `copycmms2`.`inventory_lots`
  ADD COLUMN `specificationNotes` TEXT NULL;

-- 6
ALTER TABLE `copycmms2`.`inventory_lots`
  ADD INDEX `idx_inventory_lots_specification_queue`
    (`specificationStatus`, `createdAt`, `id`);

-- Verification: five columns, then one index composed of three rows in order.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'copycmms2' AND TABLE_NAME = 'inventory_lots'
  AND COLUMN_NAME IN ('specificationStatus', 'specificationRevision',
    'specificationReviewedById', 'specificationReviewedAt', 'specificationNotes')
ORDER BY ORDINAL_POSITION;

SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'copycmms2' AND TABLE_NAME = 'inventory_lots'
  AND INDEX_NAME = 'idx_inventory_lots_specification_queue'
ORDER BY SEQ_IN_INDEX;
