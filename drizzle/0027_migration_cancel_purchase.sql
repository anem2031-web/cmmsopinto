-- ============================================================
-- Migration: إضافة ميزة إلغاء الشراء على مستوى الصنف فقط
-- (itemRevisionNote وأخواتها وneeds_item_revision موجودة مسبقاً ولن تُلمس)
-- ============================================================

-- 1) إضافة حالة purchase_cancelled فقط للحالات الموجودة حالياً
ALTER TABLE `purchase_order_items` 
  MODIFY COLUMN `status` ENUM(
    'pending','estimated','approved','rejected','funded','purchased',
    'delivered_to_warehouse','delivered_to_requester','pending_review',
    'cancelled','needs_item_revision','purchase_cancelled'
  ) NOT NULL DEFAULT 'pending';

-- 2) إضافة أعمدة إلغاء الشراء فقط (الأعمدة الأربعة الجديدة)
ALTER TABLE `purchase_order_items`
  ADD COLUMN `purchaseCancelReason` TEXT NULL,
  ADD COLUMN `purchaseCancelledById` INT NULL,
  ADD COLUMN `purchaseCancelledByName` VARCHAR(300) NULL,
  ADD COLUMN `purchaseCancelledAt` TIMESTAMP NULL;
