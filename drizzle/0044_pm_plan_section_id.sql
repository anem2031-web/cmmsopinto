-- إضافة عمود sectionId لجدول preventive_plans
-- يربط الفرع (عادة الفرع الجذر) بقسم حقيقي من جدول sections (إدارة الأقسام)
ALTER TABLE `preventive_plans` ADD COLUMN `sectionId` int;
