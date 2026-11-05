-- Manual execution only on copycmms2; run the preflight first.
-- Run each ADD separately, only if its column is missing. No data backfill.
-- DDL is not protected by START TRANSACTION/ROLLBACK.
SELECT TABLE_SCHEMA,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='copycmms2' AND TABLE_NAME='external_maintenance_jobs'
  AND COLUMN_NAME IN ('workshopName','workshopPhone','expectedReturnDate','workshopLocationUrl','workshopNotes')
ORDER BY ORDINAL_POSITION;

-- 1
ALTER TABLE `copycmms2`.`external_maintenance_jobs`
  ADD COLUMN `workshopName` VARCHAR(300) NULL;

-- 2
ALTER TABLE `copycmms2`.`external_maintenance_jobs`
  ADD COLUMN `workshopPhone` VARCHAR(50) NULL;

-- 3: date only; UI countdown compares calendar days in Asia/Riyadh.
ALTER TABLE `copycmms2`.`external_maintenance_jobs`
  ADD COLUMN `expectedReturnDate` DATE NULL;

-- 4
ALTER TABLE `copycmms2`.`external_maintenance_jobs`
  ADD COLUMN `workshopLocationUrl` TEXT NULL;

-- 5
ALTER TABLE `copycmms2`.`external_maintenance_jobs`
  ADD COLUMN `workshopNotes` TEXT NULL;

-- Verification: five nullable columns with the exact types above.
SELECT TABLE_SCHEMA,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='copycmms2' AND TABLE_NAME='external_maintenance_jobs'
  AND COLUMN_NAME IN ('workshopName','workshopPhone','expectedReturnDate','workshopLocationUrl','workshopNotes')
ORDER BY ORDINAL_POSITION;

