-- ============================================================
-- Migration: المرحلة الثانية - مسودة الفاتورة + الاعتماد
-- ============================================================

-- 1) تحديث حالات ocr_jobs + إضافة purchaseOrderItemId
ALTER TABLE `ocr_jobs`
  ADD COLUMN `purchaseOrderItemId` INT NULL COMMENT 'الصنف المحدد في طلب الشراء',
  ADD COLUMN `approvedById`        INT NULL COMMENT 'من اعتمد الفاتورة',
  ADD COLUMN `approvedAt`          TIMESTAMP NULL COMMENT 'وقت الاعتماد',
  ADD COLUMN `needsManualReview`   BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'يحتاج مراجعة يدوية',
  ADD COLUMN `confidenceScore`     DECIMAL(5,2) NULL COMMENT 'نسبة دقة OCR 0-100';

-- تعديل حالات ocr_jobs
ALTER TABLE `ocr_jobs`
  MODIFY COLUMN `status` ENUM(
    'pending',
    'processing',
    'ocr_completed',
    'needs_review',
    'approved',
    'failed'
  ) NOT NULL DEFAULT 'pending';

-- 2) إضافة حقول الفاتورة لـ warehouse_receipts
ALTER TABLE `warehouse_receipts`
  ADD COLUMN `vendorName`         VARCHAR(300) NULL  COMMENT 'اسم المورد',
  ADD COLUMN `vendorNameEn`       VARCHAR(300) NULL  COMMENT 'اسم المورد بالإنجليزي',
  ADD COLUMN `vendorTaxNumber`    VARCHAR(50)  NULL  COMMENT 'الرقم الضريبي للمورد',
  ADD COLUMN `invoiceNumber`      VARCHAR(100) NULL  COMMENT 'رقم الفاتورة',
  ADD COLUMN `invoiceDate`        DATE         NULL  COMMENT 'تاريخ الفاتورة',
  ADD COLUMN `subtotal`           DECIMAL(12,2) NULL COMMENT 'الإجمالي قبل الضريبة',
  ADD COLUMN `taxAmount`          DECIMAL(12,2) NULL COMMENT 'إجمالي الضريبة',
  ADD COLUMN `grandTotal`         DECIMAL(12,2) NULL COMMENT 'الإجمالي شامل الضريبة',
  ADD COLUMN `invoicePhotoUrl`    TEXT NULL          COMMENT 'صورة الفاتورة',
  ADD COLUMN `goodsPhotoUrl`      TEXT NULL          COMMENT 'صورة البضاعة',
  ADD COLUMN `isDraft`            BOOLEAN NOT NULL DEFAULT TRUE  COMMENT 'مسودة أم معتمدة',
  ADD COLUMN `approvedById`       INT NULL           COMMENT 'من اعتمد الاستلام',
  ADD COLUMN `approvedAt`         TIMESTAMP NULL     COMMENT 'وقت الاعتماد',
  ADD COLUMN `hasDiscrepancy`     BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'يوجد فروقات',
  ADD COLUMN `discrepancyNotes`   TEXT NULL          COMMENT 'تفاصيل الفروقات',
  MODIFY COLUMN `status` ENUM('draft','confirmed','approved','rejected') NOT NULL DEFAULT 'draft';

-- 3) إضافة حقول للمخزون (التي أضيفت بـ SQL سابق لكن ناقصة في Schema)
ALTER TABLE `inventory`
  ADD COLUMN IF NOT EXISTS `itemName_ar`      TEXT NULL,
  ADD COLUMN IF NOT EXISTS `itemName_en`      TEXT NULL,
  ADD COLUMN IF NOT EXISTS `itemType`         ENUM('spare_part','consumable','tool','food') NOT NULL DEFAULT 'consumable',
  ADD COLUMN IF NOT EXISTS `averageCost`      DECIMAL(12,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `totalCostValue`   DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `purchaseUnit`     VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS `issueUnit`        VARCHAR(50) NULL,
  ADD COLUMN IF NOT EXISTS `conversionFactor` DECIMAL(10,4) NOT NULL DEFAULT 1;
