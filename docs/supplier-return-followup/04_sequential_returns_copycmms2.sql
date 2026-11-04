-- Manual trial migration only. Run each statement separately.
-- Apply only missing column/index. No backfill or stock/financial changes.
-- DDL cannot be undone by START TRANSACTION / ROLLBACK.
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='copycmms2' AND TABLE_NAME='supplier_return_cases'
  AND COLUMN_NAME='parentReplacementPlanId';

SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='copycmms2' AND TABLE_NAME='supplier_return_cases'
  AND INDEX_NAME='idx_supplier_return_case_parent_plan' ORDER BY SEQ_IN_INDEX;

ALTER TABLE `copycmms2`.`supplier_return_cases`
  ADD COLUMN `parentReplacementPlanId` INT NULL;

ALTER TABLE `copycmms2`.`supplier_return_cases`
  ADD INDEX `idx_supplier_return_case_parent_plan` (`parentReplacementPlanId`);

-- Verification: one matching nullable INT column and one index row.
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='copycmms2' AND TABLE_NAME='supplier_return_cases'
  AND COLUMN_NAME='parentReplacementPlanId';

SELECT INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='copycmms2' AND TABLE_NAME='supplier_return_cases'
  AND INDEX_NAME='idx_supplier_return_case_parent_plan' ORDER BY SEQ_IN_INDEX;
