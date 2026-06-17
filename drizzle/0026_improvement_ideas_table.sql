-- ============================================================
-- Migration: improvement_ideas_table.sql
-- Description: Create improvement_ideas table — مركز التحسين والتطوير
-- Date: 2026-06-17
-- Rules: NO triggers, NO existing table modifications, NO data population
-- ============================================================

CREATE TABLE IF NOT EXISTS `improvement_ideas` (
  `id`               INT           NOT NULL AUTO_INCREMENT,
  `requestNumber`    VARCHAR(20)   NOT NULL,
  `title`            VARCHAR(300)  NOT NULL,
  `description`      TEXT          NULL,
  `category`         ENUM('operational','technical','procedural','safety','quality','cost_reduction','productivity','innovative','work_note','recurring_problem') NOT NULL,
  `priority`         ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  `status`           ENUM('new','pending_decision','in_progress','completed','postponed','cancelled') NOT NULL DEFAULT 'new',
  `expectedBenefit`  TEXT          NULL,
  `siteId`           INT           NULL,
  `sectionId`        INT           NULL,
  `assetId`          INT           NULL,
  `submittedById`    INT           NOT NULL,
  `triagedById`      INT           NULL,
  `triagedAt`        TIMESTAMP     NULL,
  `decidedById`      INT           NULL,
  `decidedAt`        TIMESTAMP     NULL,
  `decisionNotes`    TEXT          NULL,
  `assignedToId`     INT           NULL,
  `postponedUntil`   TIMESTAMP     NULL,
  `cancelReason`     TEXT          NULL,
  `completedAt`      TIMESTAMP     NULL,
  `completionNotes`  TEXT          NULL,
  `originalLanguage` ENUM('ar','en','ur') NOT NULL DEFAULT 'ar',
  `title_ar`         TEXT          NULL,
  `title_en`         TEXT          NULL,
  `title_ur`         TEXT          NULL,
  `description_ar`   TEXT          NULL,
  `description_en`   TEXT          NULL,
  `description_ur`   TEXT          NULL,
  `createdAt`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `idx_improvement_ideas_requestNumber` (`requestNumber`),
  INDEX `idx_improvement_ideas_status`        (`status`),
  INDEX `idx_improvement_ideas_submittedById` (`submittedById`),
  INDEX `idx_improvement_ideas_siteId`        (`siteId`),
  INDEX `idx_improvement_ideas_sectionId`     (`sectionId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- ROLLBACK (run if needed):
-- DROP TABLE IF EXISTS `improvement_ideas`;
-- ============================================================
