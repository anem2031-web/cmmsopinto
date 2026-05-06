-- ============================================================
-- Phase 1 Migration: Users Technician Preparation Layer
-- Date: 2026-05-06
-- Safe to run on live data: YES (additive only — no existing columns removed or modified)
-- Rollback: See rollback section at bottom
-- ============================================================
-- GOAL:
--   Prepare the `users` table to fully represent technician data,
--   enabling users with role='technician' to carry specialty/trade
--   information identical to the existing `technicians` table.
--   The `technicians` table and all its flows remain UNTOUCHED.
-- ============================================================

-- CHANGE 1: Add specialty (Arabic) to users
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `specialty` VARCHAR(200) NULL DEFAULT NULL
  COMMENT 'Technician trade/specialty in Arabic (e.g. كهرباء, سباكة)';

-- CHANGE 2: Add specialty in English
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `specialtyEn` VARCHAR(200) NULL DEFAULT NULL
  COMMENT 'Technician trade/specialty in English';

-- CHANGE 3: Add specialty in Urdu
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `specialtyUr` VARCHAR(200) NULL DEFAULT NULL
  COMMENT 'Technician trade/specialty in Urdu';

-- ============================================================
-- VERIFICATION QUERY (run after migration to confirm):
-- SHOW COLUMNS FROM `users` LIKE 'specialty%';
-- Expected: 3 rows (specialty, specialtyEn, specialtyUr)
-- ============================================================

-- ============================================================
-- ROLLBACK (only if needed — safe to run at any time):
-- ALTER TABLE `users` DROP COLUMN IF EXISTS `specialty`;
-- ALTER TABLE `users` DROP COLUMN IF EXISTS `specialtyEn`;
-- ALTER TABLE `users` DROP COLUMN IF EXISTS `specialtyUr`;
-- ============================================================
