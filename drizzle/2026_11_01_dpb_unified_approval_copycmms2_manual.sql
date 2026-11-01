-- Manual execution by the owner on copycmms2 ONLY. No backfill, no change to old approvals.
-- CREATE TABLE is DDL and cannot be protected by START TRANSACTION / ROLLBACK.
SELECT DATABASE() AS current_database;
SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='copycmms2'
  AND TABLE_NAME IN ('delegate_pricing_bundles','delegate_pricing_bundle_approvals');

CREATE TABLE `copycmms2`.`delegate_pricing_bundle_approvals` (
  `bundleId` INT NOT NULL,
  `status` ENUM('pending_accounting','pending_management','approved','rejected') NOT NULL DEFAULT 'pending_accounting',
  `revision` INT NOT NULL DEFAULT 0,
  `custodyBalance` DECIMAL(12,2) NULL,
  `accountingApprovedById` INT NULL,
  `accountingApprovedAt` TIMESTAMP NULL DEFAULT NULL,
  `accountingSignatureSnapshot` TEXT NULL,
  `accountingNotes` TEXT NULL,
  `accountingRejections` TEXT NULL,
  `accountingOperationKey` CHAR(36) NULL,
  `accountingRequestHash` CHAR(64) NULL,
  `managementApprovedById` INT NULL,
  `managementApprovedAt` TIMESTAMP NULL DEFAULT NULL,
  `managementSignatureSnapshot` TEXT NULL,
  `managementNotes` TEXT NULL,
  `managementRejections` TEXT NULL,
  `managementOperationKey` CHAR(36) NULL,
  `managementRequestHash` CHAR(64) NULL,
  `sendEffectsDone` TINYINT NOT NULL DEFAULT 0,
  `accountingEffectsDone` TINYINT NOT NULL DEFAULT 0,
  `managementEffectsDone` TINYINT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`bundleId`),
  KEY `idx_dpb_approval_queue` (`status`,`bundleId`),
  CONSTRAINT `fk_dpb_approval_bundle` FOREIGN KEY (`bundleId`)
    REFERENCES `copycmms2`.`delegate_pricing_bundles` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SHOW CREATE TABLE `copycmms2`.`delegate_pricing_bundle_approvals`;
-- After isolated checks and manual SQL verification, enable the LOCAL test service only:
-- DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED=true
-- Newly sent bundles use unified approval. Existing bundles retain their previous workflow.
