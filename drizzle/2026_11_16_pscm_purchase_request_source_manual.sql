-- Run each statement separately in the CMMS database before deploying the new code.
SELECT DATABASE() AS current_database;

ALTER TABLE `purchase_orders` ADD COLUMN `sourceSystem` VARCHAR(32) NULL;
ALTER TABLE `purchase_orders` ADD COLUMN `sourceInstanceId` VARCHAR(64) NULL;
ALTER TABLE `purchase_orders` ADD COLUMN `sourceRequestId` INT NULL;
ALTER TABLE `purchase_orders` ADD COLUMN `sourceReference` VARCHAR(64) NULL;
ALTER TABLE `purchase_orders` ADD COLUMN `sourcePayloadHash` CHAR(64) NULL;
ALTER TABLE `purchase_orders` ADD COLUMN `sourceRequesterName` VARCHAR(255) NULL;

CREATE UNIQUE INDEX `uq_purchase_orders_source_request`
  ON `purchase_orders` (`sourceSystem`, `sourceInstanceId`, `sourceRequestId`);

CREATE UNIQUE INDEX `uq_purchase_orders_source_reference`
  ON `purchase_orders` (`sourceSystem`, `sourceInstanceId`, `sourceReference`);

SELECT `COLUMN_NAME`, `COLUMN_TYPE`, `IS_NULLABLE`
FROM `information_schema`.`COLUMNS`
WHERE `TABLE_SCHEMA` = DATABASE()
  AND `TABLE_NAME` = 'purchase_orders'
  AND `COLUMN_NAME` IN ('sourceSystem', 'sourceInstanceId', 'sourceRequestId', 'sourceReference', 'sourcePayloadHash', 'sourceRequesterName')
ORDER BY `ORDINAL_POSITION`;

SHOW INDEX FROM `purchase_orders`
WHERE `Key_name` IN ('uq_purchase_orders_source_request', 'uq_purchase_orders_source_reference');
