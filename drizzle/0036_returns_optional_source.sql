-- ============================================================
-- 0036_returns_optional_source.sql
-- السماح بمرتجع بلا سند استلام / طلب شراء معروف —
-- لدعم إرجاع الأصناف المستقلة (0035) أو أصناف بلا سجل استلام مرتبط
-- ============================================================

ALTER TABLE `warehouse_returns`
  MODIFY COLUMN `receiptId` INT NULL COMMENT 'اختياري: NULL يعني إرجاع بلا سند استلام معروف',
  MODIFY COLUMN `purchaseOrderId` INT NULL COMMENT 'اختياري: NULL يعني لا يوجد طلب شراء وراء هذا الصنف',
  MODIFY COLUMN `purchaseOrderItemId` INT NULL COMMENT 'اختياري: نفس السبب أعلاه';
