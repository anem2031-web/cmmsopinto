-- Apply manually to the intended CMMS database before deploying plan deletion.
-- Keep existing states and append a terminal state for plans with recorded work.
ALTER TABLE `pmv2_simplified_plans`
  MODIFY COLUMN `state` ENUM('draft','active','paused','retired') NOT NULL DEFAULT 'draft';
