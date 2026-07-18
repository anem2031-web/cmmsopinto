-- ============================================================
-- Phase: فصل خطط الصيانة الدورية عن شجرة preventive_plans بالكامل
-- Date: 2026-07-14
-- المبدأ: الشجرة (preventive_plans) تبقى هيكلاً تنظيمياً بحتاً (موقع ← قسم
-- تشغيلي ← أقسام صيانة) ولا تتأثر أبداً بإنشاء/تعديل/حذف الخطط. الخطط
-- (رئيسية وفرعية) تعيش في جداول مستقلة تماماً، وتشير لعقد الشجرة بمفاتيح
-- خارجية للقراءة فقط (بدون قيود FK فعلية بقاعدة البيانات، اتساقاً مع بقية
-- المشروع الذي يتحقق من التكامل المرجعي على مستوى التطبيق/الراوتر لا القاعدة).
--
-- ملاحظة مهمة: هذا Migration إضافي بحت — لا يعدّل ولا يحذف أي جدول أو عمود
-- قديم (pm_checklist_items, pm_work_order_branches, عمود planId في
-- pm_work_orders...). الجداول/الأعمدة القديمة تبقى موجودة بدون استخدام
-- لحين اكتمال واختبار التصميم الجديد بالكامل، وتُزال في Migration منفصل لاحقاً.
-- ============================================================

-- 1) pm_main_plans: البطاقة الرئيسية — واحدة فقط لكل "قسم تشغيلي" (فرع جذري
--    في preventive_plans، parentId IS NULL). العنوان يُشتق دائماً وقت العرض
--    من اسم الفرع + اسم الموقع، ولا يُخزَّن هنا لتفادي تكرار مصدر الحقيقة.
CREATE TABLE `pm_main_plans` (
  `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY,
  `branchId` int NOT NULL,
  `createdById` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP
);
-- قيد الفريدة: فرع تشغيلي واحد = بطاقة رئيسية واحدة بالضبط
CREATE UNIQUE INDEX `pm_main_plans_branch_unique` ON `pm_main_plans` (`branchId`);

-- 2) pm_sub_plans: الخطة الفرعية الفعلية — تحمل التكرار/المسؤول/الوصف،
--    وتشير لكل من الخطة الرئيسية و"قسم الصيانة" المسؤول (عقدة في الشجرة،
--    عادة ابن مباشر للفرع الجذري). هذا الجدول هو ما تتحول أوامر العمل
--    للإشارة إليه بدل الإشارة لعقدة الشجرة مباشرة.
CREATE TABLE `pm_sub_plans` (
  `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY,
  `mainPlanId` int NOT NULL,
  `sectionBranchId` int NOT NULL,
  `title` varchar(300) NOT NULL,
  `title_ar` varchar(300),
  `title_en` varchar(300),
  `title_ur` varchar(300),
  `originalLanguage` enum('ar','en','ur') NOT NULL DEFAULT 'ar',
  `frequency` enum('daily','weekly','monthly','quarterly','biannual','annual') NOT NULL,
  `frequencyValue` int NOT NULL DEFAULT 1,
  `estimatedDurationMinutes` int,
  `assignedToId` int,
  `description` text,
  `description_ar` text,
  `description_en` text,
  `description_ur` text,
  `isActive` boolean NOT NULL DEFAULT true,
  `nextDueDate` timestamp NULL,
  `lastGeneratedAt` timestamp NULL,
  `createdById` int NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX `pm_sub_plans_main_plan_idx` ON `pm_sub_plans` (`mainPlanId`);
CREATE INDEX `pm_sub_plans_section_branch_idx` ON `pm_sub_plans` (`sectionBranchId`);

-- 3) pm_sub_plan_checklist_items: قائمة التحقق الخاصة بكل خطة فرعية —
--    مستقلة تماماً عن pm_checklist_items القديم (المرتبط بالشجرة). لا قوالب
--    مشتركة؛ كل خطة فرعية تملك بنودها الخاصة كما هو متفق عليه.
CREATE TABLE `pm_sub_plan_checklist_items` (
  `id` int AUTO_INCREMENT NOT NULL PRIMARY KEY,
  `subPlanId` int NOT NULL,
  `orderIndex` int NOT NULL DEFAULT 0,
  `text` text NOT NULL,
  `text_ar` text,
  `text_en` text,
  `text_ur` text,
  `originalLanguage` enum('ar','en','ur') NOT NULL DEFAULT 'ar',
  `isRequired` boolean NOT NULL DEFAULT true,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX `pm_sub_plan_checklist_items_sub_plan_idx` ON `pm_sub_plan_checklist_items` (`subPlanId`);

-- 4) pm_work_orders: إضافة subPlanId (اختياري مؤقتاً لضمان توافق البيانات
--    القديمة أثناء الانتقال) — هذا هو المرجع الجديد والمعتمد لأمر العمل.
--    عمود planId القديم يبقى دون حذف، لكن يتوقف استخدامه فعلياً في التصميم
--    الجديد فور اكتمال طبقة الخادم (المرحلة الثانية).
ALTER TABLE `pm_work_orders`
  ADD COLUMN `subPlanId` int NULL AFTER `planId`;
CREATE INDEX `pm_work_orders_sub_plan_idx` ON `pm_work_orders` (`subPlanId`);
