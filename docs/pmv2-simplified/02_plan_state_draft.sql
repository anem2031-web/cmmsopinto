-- DRAFT: do not execute until the simplified workflow and migration review are complete.
-- The program and checklist remain the existing PMV2 records so technicians
-- continue using the original task, visit, material and ticket workflows.
CREATE TABLE `pmv2_simplified_plans` (
  `programId` INT NOT NULL,
  `siteId` INT NOT NULL,
  `sectionId` INT NOT NULL,
  `state` ENUM('draft','active','paused') NOT NULL DEFAULT 'draft',
  `pausedOn` DATE NULL DEFAULT NULL,
  `createdById` INT NOT NULL,
  `updatedById` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`programId`),
  KEY `idx_pmv2_simple_plan_state` (`state`,`programId`),
  CONSTRAINT `fk_pmv2_simple_plan_program` FOREIGN KEY (`programId`)
    REFERENCES `pmv2_programs` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A custom every-N-days rule must remain distinct from an ordinary daily rule
-- so pause recovery can apply the approved policy correctly.
CREATE TABLE `pmv2_simplified_item_modes` (
  `checklistItemId` INT NOT NULL,
  `kind` ENUM('daily','weekly','monthly','custom') NOT NULL,
  PRIMARY KEY (`checklistItemId`),
  CONSTRAINT `fk_pmv2_simple_item` FOREIGN KEY (`checklistItemId`)
    REFERENCES `pmv2_checklist_items` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
