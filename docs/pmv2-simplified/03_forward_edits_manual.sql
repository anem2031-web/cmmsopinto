-- Apply manually to the intended CMMS database before deploying the forward-edit code.
-- This adds schema only. Existing plans, tasks, and translations need no data migration.
CREATE TABLE `pmv2_simplified_plan_revisions` (
  `programId` INT NOT NULL,
  `planId` INT NOT NULL,
  `revisionNumber` INT NOT NULL,
  `effectiveOn` DATE NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`programId`),
  UNIQUE KEY `uq_pmv2_simple_revision_plan_sequence` (`planId`,`revisionNumber`),
  CONSTRAINT `fk_pmv2_simple_revision_program` FOREIGN KEY (`programId`)
    REFERENCES `pmv2_programs` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_pmv2_simple_revision_plan` FOREIGN KEY (`planId`)
    REFERENCES `pmv2_simplified_plans` (`programId`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `pmv2_simplified_item_modes` ADD COLUMN `effectiveOn` DATE NULL;
