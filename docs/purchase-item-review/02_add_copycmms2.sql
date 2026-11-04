-- MANUAL ONLY: trial database copycmms2. Never executed by the application.
-- First inspect with 01_inspect_copycmms2.sql. Execute only missing definitions.
-- The existing status enum must already include pending_review (as in the current schema).
-- Keep TiDB DDL statements separate. No backfill, record changes or FK changes.

ALTER TABLE `copycmms2`.`purchase_order_items`
  ADD COLUMN `reviewRole` ENUM('general_maintenance_manager','construction_procurement_manager','senior_management') NULL DEFAULT NULL;

ALTER TABLE `copycmms2`.`purchase_order_items`
  ADD COLUMN `reviewedById` INT NULL DEFAULT NULL;

ALTER TABLE `copycmms2`.`purchase_order_items`
  ADD COLUMN `reviewedAt` TIMESTAMP NULL DEFAULT NULL;

ALTER TABLE `copycmms2`.`purchase_order_items`
  ADD COLUMN `reviewerSignatureSnapshot` TEXT NULL;

ALTER TABLE `copycmms2`.`purchase_order_items`
  ADD INDEX `idx_poi_review_queue` (`reviewRole`,`status`,`purchaseOrderId`,`id`);

ALTER TABLE `copycmms2`.`purchase_order_items`
  ADD INDEX `idx_poi_review_actor` (`reviewRole`,`reviewedById`,`purchaseOrderId`,`id`);
