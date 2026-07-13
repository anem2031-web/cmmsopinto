-- ============================================================
-- Phase: إعادة تصميم الصيانة الدورية كشجرة هرمية (Phase 1 — Schema)
-- Date: 2026-07-12
-- Safe to run on live data: بيانات preventive_plans/pm_work_orders الحالية
-- تجريبية بحسب تأكيد صاحب المشروع — لا حاجة لخطة ترحيل. هذا الملف يفترض
-- تصفير هذه البيانات التجريبية قبل التطبيق (انظر التعليق أسفل).
-- ============================================================

-- 1) preventive_plans: إضافة الشجرة الهرمية (parentId) وعلم الفرع التجميعي
ALTER TABLE `preventive_plans`
  ADD COLUMN `parentId` int NULL AFTER `planNumber`,
  ADD COLUMN `isGroupOnly` boolean NOT NULL DEFAULT false AFTER `parentId`;

-- frequency/frequencyValue تصبح اختيارية على مستوى القاعدة (الفروع التجميعية
-- لا تحتاج جدولة). التحقق الإلزامي للفروع التنفيذية يبقى في طبقة الـ router.
ALTER TABLE `preventive_plans`
  MODIFY COLUMN `frequency` enum('daily','weekly','monthly','quarterly','biannual','annual') NULL,
  MODIFY COLUMN `frequencyValue` int NULL DEFAULT 1;

-- فهرس لتسريع جلب أبناء أي فرع
CREATE INDEX `preventive_plans_parent_idx` ON `preventive_plans` (`parentId`);

-- 2) pm_work_orders: planId يصبح اختيارياً (فرع رئيسي/مرجعي للعرض فقط)
--    + علم hasPendingMaterials لعرض شارة "معلّق" دون JOIN
ALTER TABLE `pm_work_orders`
  MODIFY COLUMN `planId` int NULL,
  ADD COLUMN `hasPendingMaterials` boolean NOT NULL DEFAULT false AFTER `status`;

-- 3) pm_work_order_branches: ربط أمر العمل بواحد أو أكثر من الفروع (الحل الهجين)
CREATE TABLE `pm_work_order_branches` (
  `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY,
  `workOrderId` int NOT NULL,
  `planId` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now())
);
CREATE INDEX `pm_wo_branches_wo_plan_idx` ON `pm_work_order_branches` (`workOrderId`, `planId`);

-- 4) pm_material_requests: رأس طلب المواد (يمر إلزامياً عبر المستودع)
CREATE TABLE `pm_material_requests` (
  `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY,
  `workOrderId` int NOT NULL,
  `checklistItemId` int NULL,
  `requestedById` int NOT NULL,
  `requestNote` text NULL,
  `status` enum('pending','processed') NOT NULL DEFAULT 'pending',
  `reviewedById` int NULL,
  `reviewedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX `pm_material_requests_wo_idx` ON `pm_material_requests` (`workOrderId`);

-- 5) pm_material_request_items: بنود الطلب — دورة حياة كل صنف مستقلة
CREATE TABLE `pm_material_request_items` (
  `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY,
  `requestId` int NOT NULL,
  `inventoryItemId` int NULL,
  `itemNameSnapshot` varchar(300) NOT NULL,
  `unit` varchar(50) NULL,
  `requestedQuantity` decimal(12,3) NOT NULL,
  `approvedQuantity` decimal(12,3) NULL,
  `status` enum('pending','approved','approved_partial','rejected_to_purchase','arrived_at_warehouse','ready_for_pickup','delivered') NOT NULL DEFAULT 'pending',
  `warehouseNote` text NULL,
  `linkedPurchaseOrderId` int NULL,
  `deliveredById` int NULL,
  `deliveredAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX `pm_material_request_items_request_idx` ON `pm_material_request_items` (`requestId`);
CREATE INDEX `pm_material_request_items_status_idx` ON `pm_material_request_items` (`status`);
