-- ============================================================
-- 0039_return_document_item_code.sql
-- إضافة رقم الصنف (الكود الداخلي) وباركود المصنّع لوثيقة المرتجع
-- لعرض رقم الصنف وطباعة الـQR Code الخاص به على الوثيقة
-- ============================================================

ALTER TABLE `return_documents`
  ADD COLUMN `internalCode` VARCHAR(50) NULL COMMENT 'رقم الصنف الداخلي' AFTER `itemName`,
  ADD COLUMN `manufacturerBarcode` VARCHAR(100) NULL COMMENT 'باركود المصنع — يُستخدم لتوليد QR الوثيقة' AFTER `internalCode`;
