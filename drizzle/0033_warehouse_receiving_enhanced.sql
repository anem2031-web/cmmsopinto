-- ============================================================
-- Migration: تطوير وحدة استلام المستودع المتكاملة
-- Phase 1: استلام البضاعة + OCR + متوسط التكلفة + أنواع الأصناف
-- ============================================================

-- 1) تطوير جدول inventory - إضافة الحقول الجديدة
ALTER TABLE `inventory`
  ADD COLUMN `itemName_ar`        TEXT          NULL          COMMENT 'اسم الصنف بالعربي',
  ADD COLUMN `itemName_en`        TEXT          NULL          COMMENT 'اسم الصنف بالإنجليزي',
  ADD COLUMN `itemName_ur`        TEXT          NULL          COMMENT 'اسم الصنف بالأوردو',
  ADD COLUMN `itemType`           ENUM(
                                    'spare_part',
                                    'consumable',
                                    'tool',
                                    'food'
                                  )             NOT NULL DEFAULT 'consumable' COMMENT 'نوع الصنف',
  ADD COLUMN `averageCost`        DECIMAL(12,4) NOT NULL DEFAULT 0 COMMENT 'متوسط التكلفة المرجح',
  ADD COLUMN `totalCostValue`     DECIMAL(14,2) NOT NULL DEFAULT 0 COMMENT 'إجمالي قيمة المخزون',
  ADD COLUMN `purchaseUnit`       VARCHAR(50)   NULL          COMMENT 'وحدة الشراء (كرتون)',
  ADD COLUMN `issueUnit`          VARCHAR(50)   NULL          COMMENT 'وحدة الصرف (قطعة)',
  ADD COLUMN `conversionFactor`   DECIMAL(10,4) NOT NULL DEFAULT 1 COMMENT 'عدد وحدات الصرف في وحدة الشراء',
  ADD COLUMN `expiryDate`         DATE          NULL          COMMENT 'تاريخ انتهاء الصلاحية (للمواد الغذائية)',
  ADD COLUMN `linkedItemId`       INT           NULL          COMMENT 'ربط بصنف سابق (دمج المسميات)',
  ADD COLUMN `assetId`            INT           NULL          COMMENT 'ربط بمعدة أو أصل ثابت',
  ADD COLUMN `warehouseId`        INT           NULL          COMMENT 'المخزن الذي ينتمي إليه الصنف';

-- 2) تطوير جدول inventory_transactions - إضافة ربط بمشروع/قسم/معدة والتكلفة
ALTER TABLE `inventory_transactions`
  ADD COLUMN `unitCost`           DECIMAL(12,4) NULL          COMMENT 'تكلفة الوحدة وقت الحركة',
  ADD COLUMN `totalCost`          DECIMAL(14,2) NULL          COMMENT 'إجمالي تكلفة الحركة',
  ADD COLUMN `projectId`          INT           NULL          COMMENT 'المشروع المحمّل عليه',
  ADD COLUMN `departmentId`       INT           NULL          COMMENT 'القسم المحمّل عليه',
  ADD COLUMN `assetId`            INT           NULL          COMMENT 'المعدة المحمّلة عليها',
  ADD COLUMN `documentUrl`        TEXT          NULL          COMMENT 'مستند مرفق (صورة/PDF)',
  ADD COLUMN `invoiceNumber`      VARCHAR(100)  NULL          COMMENT 'رقم الفاتورة المرتبطة',
  MODIFY COLUMN `transactionType` ENUM(
                                    'purchase',
                                    'issue',
                                    'transfer',
                                    'disposal',
                                    'return_to_vendor',
                                    'return_internal',
                                    'adjustment',
                                    'delivery'
                                  ) NOT NULL DEFAULT 'adjustment';

-- 3) تطوير جدول warehouse_receipts - إضافة بيانات الفاتورة الكاملة
ALTER TABLE `warehouse_receipts`
  ADD COLUMN `vendorName`         VARCHAR(300)  NULL          COMMENT 'اسم المورد',
  ADD COLUMN `vendorNameEn`       VARCHAR(300)  NULL          COMMENT 'اسم المورد بالإنجليزي',
  ADD COLUMN `vendorTaxNumber`    VARCHAR(50)   NULL          COMMENT 'الرقم الضريبي للمورد',
  ADD COLUMN `invoiceNumber`      VARCHAR(100)  NULL          COMMENT 'رقم الفاتورة',
  ADD COLUMN `invoiceDate`        DATE          NULL          COMMENT 'تاريخ الفاتورة',
  ADD COLUMN `subtotal`           DECIMAL(12,2) NULL          COMMENT 'الإجمالي قبل الضريبة',
  ADD COLUMN `taxAmount`          DECIMAL(12,2) NULL          COMMENT 'إجمالي الضريبة',
  ADD COLUMN `grandTotal`         DECIMAL(12,2) NULL          COMMENT 'الإجمالي شامل الضريبة',
  ADD COLUMN `invoicePhotoUrl`    TEXT          NULL          COMMENT 'صورة الفاتورة الأصلية',
  ADD COLUMN `goodsPhotoUrl`      TEXT          NULL          COMMENT 'صورة البضاعة المستلمة',
  ADD COLUMN `ocrRawData`         JSON          NULL          COMMENT 'البيانات الخام من OCR',
  ADD COLUMN `ocrConfidence`      DECIMAL(5,2)  NULL          COMMENT 'نسبة دقة OCR 0-100',
  ADD COLUMN `isDuplicate`        BOOLEAN       NOT NULL DEFAULT FALSE COMMENT 'هل الفاتورة مكررة',
  ADD COLUMN `duplicateOfId`      INT           NULL          COMMENT 'معرف الفاتورة المكررة',
  ADD COLUMN `hasDiscrepancy`     BOOLEAN       NOT NULL DEFAULT FALSE COMMENT 'يوجد فرق مع طلب الشراء',
  ADD COLUMN `discrepancyNotes`   TEXT          NULL          COMMENT 'تفاصيل الفرق';

-- 4) جدول بنود وصول الفاتورة (تفاصيل كل صنف داخل فاتورة الاستلام)
CREATE TABLE IF NOT EXISTS `warehouse_receipt_items` (
  `id`                  INT           NOT NULL AUTO_INCREMENT,
  `receiptId`           INT           NOT NULL                COMMENT 'معرف فاتورة الاستلام',
  `inventoryId`         INT           NULL                    COMMENT 'الصنف في المخزون',
  `purchaseOrderItemId` INT           NULL                    COMMENT 'بند طلب الشراء',
  `itemName`            VARCHAR(300)  NOT NULL                COMMENT 'اسم الصنف كما في الفاتورة',
  `itemName_ar`         TEXT          NULL,
  `itemName_en`         TEXT          NULL,
  `receivedQuantity`    DECIMAL(12,3) NOT NULL                COMMENT 'الكمية المستلمة',
  `purchaseUnit`        VARCHAR(50)   NULL                    COMMENT 'وحدة الشراء',
  `unitCost`            DECIMAL(12,4) NOT NULL DEFAULT 0      COMMENT 'سعر الوحدة',
  `taxRate`             DECIMAL(5,2)  NOT NULL DEFAULT 15     COMMENT 'نسبة الضريبة %',
  `taxAmount`           DECIMAL(12,2) NOT NULL DEFAULT 0      COMMENT 'مبلغ الضريبة على الصنف',
  `lineTotal`           DECIMAL(12,2) NOT NULL DEFAULT 0      COMMENT 'إجمالي السطر شامل الضريبة',
  `expectedQuantity`    DECIMAL(12,3) NULL                    COMMENT 'الكمية المطلوبة في طلب الشراء',
  `quantityDiff`        DECIMAL(12,3) NULL                    COMMENT 'الفرق في الكمية',
  `expectedUnitCost`    DECIMAL(12,4) NULL                    COMMENT 'السعر المتوقع من طلب الشراء',
  `priceDiff`           DECIMAL(12,4) NULL                    COMMENT 'الفرق في السعر',
  `ocrExtracted`        BOOLEAN       NOT NULL DEFAULT FALSE   COMMENT 'استُخرج من OCR',
  `manuallyEdited`      BOOLEAN       NOT NULL DEFAULT FALSE   COMMENT 'عُدِّل يدوياً بعد OCR',
  `createdAt`           TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_receipt_items_receiptId` (`receiptId`),
  INDEX `idx_receipt_items_inventoryId` (`inventoryId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) جدول OCR jobs - تتبع عمليات التحليل الذكي للفواتير
CREATE TABLE IF NOT EXISTS `ocr_jobs` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `receiptId`       INT           NULL                    COMMENT 'معرف الفاتورة (بعد الإنشاء)',
  `purchaseOrderId` INT           NULL                    COMMENT 'طلب الشراء المرتبط',
  `status`          ENUM(
                      'pending',
                      'processing',
                      'completed',
                      'failed'
                    )             NOT NULL DEFAULT 'pending',
  `imageUrl`        TEXT          NOT NULL                COMMENT 'رابط صورة الفاتورة',
  `rawResponse`     JSON          NULL                    COMMENT 'استجابة AI الخام',
  `extractedData`   JSON          NULL                    COMMENT 'البيانات المستخرجة المنظمة',
  `confidence`      DECIMAL(5,2)  NULL                    COMMENT 'نسبة الدقة الكلية',
  `errorMessage`    TEXT          NULL                    COMMENT 'رسالة الخطأ إن وجدت',
  `processingMs`    INT           NULL                    COMMENT 'مدة المعالجة بالملي ثانية',
  `createdById`     INT           NOT NULL,
  `createdAt`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `completedAt`     TIMESTAMP     NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_ocr_jobs_receiptId` (`receiptId`),
  INDEX `idx_ocr_jobs_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6) جدول المخازن (هرمية المخازن)
CREATE TABLE IF NOT EXISTS `warehouses` (
  `id`              INT           NOT NULL AUTO_INCREMENT,
  `code`            VARCHAR(20)   NOT NULL UNIQUE           COMMENT 'رمز المخزن',
  `nameAr`          VARCHAR(200)  NOT NULL                  COMMENT 'اسم المخزن بالعربي',
  `nameEn`          VARCHAR(200)  NULL                      COMMENT 'اسم المخزن بالإنجليزي',
  `type`            ENUM(
                      'main',
                      'project',
                      'branch',
                      'kitchen'
                    )             NOT NULL DEFAULT 'main'   COMMENT 'نوع المخزن',
  `parentId`        INT           NULL                      COMMENT 'المخزن الأب',
  `siteId`          INT           NULL                      COMMENT 'الموقع المرتبط به',
  `projectId`       INT           NULL                      COMMENT 'المشروع المرتبط به',
  `isActive`        BOOLEAN       NOT NULL DEFAULT TRUE,
  `createdAt`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt`       TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7) إنشاء مخزن رئيسي افتراضي
INSERT IGNORE INTO `warehouses` (`id`, `code`, `nameAr`, `nameEn`, `type`)
VALUES (1, 'WH-MAIN', 'المخزن الرئيسي', 'Main Warehouse', 'main');
