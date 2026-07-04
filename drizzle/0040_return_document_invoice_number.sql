-- ============================================================
-- 0040_return_document_invoice_number.sql
-- إضافة رقم فاتورة المورد الأصلية لوثيقة المرتجع (منفصل عن
-- receiptNumber الداخلي الذي يولّده النظام)
-- ============================================================

ALTER TABLE `return_documents`
  ADD COLUMN `invoiceNumber` VARCHAR(100) NULL COMMENT 'رقم فاتورة المورد الأصلية (من سند الاستلام المرتبط)' AFTER `receiptNumber`;
