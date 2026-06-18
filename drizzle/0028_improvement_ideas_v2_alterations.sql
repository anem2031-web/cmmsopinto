-- ============================================================
-- Migration: improvement_ideas_v2_alterations.sql
-- Description: ALTER improvement_ideas — يضيف حقول المجموعة/الربط بالبلاغ والشراء
--              ويوسّع حالات الفكرة لتشمل "تم الفرز والتصنيف" و"تمت الموافقة" كحالتين منفصلتين
-- يُشغَّل بعد migration السابق (improvement_ideas_table.sql) وعلى نفس الجدول الذي أنشأناه نحن فقط
-- Date: 2026-06-17
-- Rules: NO triggers, NO data population
-- ============================================================

ALTER TABLE `improvement_ideas`
  MODIFY COLUMN `status` ENUM('new','classified','approved','in_progress','completed','postponed','cancelled') NOT NULL DEFAULT 'new';

ALTER TABLE `improvement_ideas`
  ADD COLUMN `groupCategory` VARCHAR(50) NULL AFTER `category`;

ALTER TABLE `improvement_ideas`
  ADD COLUMN `linkedTicketId` INT NULL AFTER `assignedToId`;

ALTER TABLE `improvement_ideas`
  ADD COLUMN `linkedPurchaseOrderId` INT NULL AFTER `linkedTicketId`;

ALTER TABLE `improvement_ideas`
  ADD INDEX `idx_improvement_ideas_groupCategory` (`groupCategory`);

-- ============================================================
-- ROLLBACK (run if needed):
-- ALTER TABLE `improvement_ideas` DROP COLUMN `groupCategory`, DROP COLUMN `linkedTicketId`, DROP COLUMN `linkedPurchaseOrderId`;
-- ALTER TABLE `improvement_ideas` MODIFY COLUMN `status` ENUM('new','pending_decision','in_progress','completed','postponed','cancelled') NOT NULL DEFAULT 'new';
-- ============================================================
