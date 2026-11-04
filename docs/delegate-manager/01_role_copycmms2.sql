-- Manual execution only. Read the preflight result before applying ALTER.
-- Preserve every existing value/order/default; append delegate_manager last.
-- No UPDATE/backfill; existing accounts retain their present roles.
SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='copycmms2' AND TABLE_NAME='users' AND COLUMN_NAME='role';

ALTER TABLE `copycmms2`.`users`
  MODIFY COLUMN `role` ENUM(
    'user','admin','operator','technician','it_manager','it_member',
    'maintenance_manager','general_maintenance_manager','construction_procurement_manager',
    'supervisor','purchase_manager','purchase_requester','delegate','accountant',
    'senior_management','executive_director','warehouse','gate_security','owner',
    'food_warehouse_manager','food_warehouse_assistant','observer','delegate_manager'
  ) NOT NULL DEFAULT 'user';

SELECT COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='copycmms2' AND TABLE_NAME='users' AND COLUMN_NAME='role';

