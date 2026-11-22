-- DRAFT: do not execute until the simplified workflow and migration review are complete.
-- A maintenance team may have historical PMV2 identities for different warehouses.
-- Existing PMV2 identities without a link keep their original membership rules.
CREATE TABLE `pmv2_unified_team_links` (
  `pmv2TeamId` INT NOT NULL,
  `maintenanceTeamId` INT NOT NULL,
  `createdById` INT NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pmv2TeamId`),
  KEY `idx_pmv2_unified_maintenance_team` (`maintenanceTeamId`),
  CONSTRAINT `fk_pmv2_unified_team` FOREIGN KEY (`pmv2TeamId`)
    REFERENCES `pmv2_teams` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT,
  CONSTRAINT `fk_pmv2_unified_maintenance_team` FOREIGN KEY (`maintenanceTeamId`)
    REFERENCES `maintenance_teams` (`id`) ON UPDATE RESTRICT ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
