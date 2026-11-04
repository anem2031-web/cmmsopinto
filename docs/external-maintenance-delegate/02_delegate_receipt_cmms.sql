-- Manual execution only on cmms. Run the preflight first.
-- No data changes/backfill. DDL is not protected by START TRANSACTION/ROLLBACK.
-- Compare the current status ENUM with the seven-step definition below before
-- applying its MODIFY. Existing values keep their exact order; the new value
-- is appended. Run each ADD only if its column is absent.

SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='cmms' AND TABLE_NAME='external_maintenance_jobs'
  AND COLUMN_NAME IN ('status','purchaseTitle','delegateReceiptStatus','delegateReceiptById',
    'delegateReceiptAt','delegateReceiptReason','preparationRevision')
ORDER BY ORDINAL_POSITION;

-- 1: preserve the existing status order/default/not-null and append the stage.
ALTER TABLE `cmms`.`external_maintenance_jobs`
  MODIFY COLUMN `status` ENUM(
    'waiting_warehouse_preparation','waiting_gate_exit','purchase_cycle',
    'waiting_gate_entry','waiting_warehouse_receipt','waiting_technician_handover',
    'delivered_for_reinstall','reinstall_in_progress','ready_for_closure','closed',
    'waiting_delegate_receipt'
  ) NOT NULL DEFAULT 'waiting_warehouse_preparation';

-- 2: NULL preserves legacy jobs until explicit warehouse preparation.
ALTER TABLE `cmms`.`external_maintenance_jobs`
  ADD COLUMN `purchaseTitle` VARCHAR(300) NULL;

-- 3
ALTER TABLE `cmms`.`external_maintenance_jobs`
  ADD COLUMN `delegateReceiptStatus` ENUM('pending','accepted','rejected') NULL;

-- 4
ALTER TABLE `cmms`.`external_maintenance_jobs`
  ADD COLUMN `delegateReceiptById` INT NULL;

-- 5
ALTER TABLE `cmms`.`external_maintenance_jobs`
  ADD COLUMN `delegateReceiptAt` TIMESTAMP NULL DEFAULT NULL;

-- 6
ALTER TABLE `cmms`.`external_maintenance_jobs`
  ADD COLUMN `delegateReceiptReason` TEXT NULL;

-- 7
ALTER TABLE `cmms`.`external_maintenance_jobs`
  ADD COLUMN `preparationRevision` INT NOT NULL DEFAULT 0;

-- Verification: seven rows (status plus six new columns).
SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='cmms' AND TABLE_NAME='external_maintenance_jobs'
  AND COLUMN_NAME IN ('status','purchaseTitle','delegateReceiptStatus','delegateReceiptById',
    'delegateReceiptAt','delegateReceiptReason','preparationRevision')
ORDER BY ORDINAL_POSITION;

