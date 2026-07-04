-- ============================================================
-- 0035_standalone_receipts.sql
-- السماح بسند استلام (فاتورة) بدون طلب شراء وراءه —
-- لدعم "الاستلام المستقل" من شاشة المخزون مباشرة (بلا دورة شراء)
-- ============================================================

ALTER TABLE `warehouse_receipts`
  MODIFY COLUMN `purchaseOrderId` INT NULL COMMENT 'اختياري: NULL يعني استلام مستقل بلا طلب شراء';

-- فهرس يساعد استعلامات "استلامات مستقلة فقط" (WHERE purchaseOrderId IS NULL)
CREATE INDEX IF NOT EXISTS idx_warehouse_receipts_po_null
  ON `warehouse_receipts` (`purchaseOrderId`);
