-- ============================================================
-- Phase 2 Migration: Add food_warehouse_manager & food_warehouse_assistant roles
-- Date: 2026-07-09
-- Safe to run on live data: YES (enum expansion, no data loss)
--
-- ملاحظة: تمت إضافة 'executive_director' هنا أيضاً — كان موجوداً فعلياً بالقاعدة
-- الحية (مستخدَم من مستخدمين حاليين) لكنه لم يكن مضافاً بملف schema.ts أصلاً.
-- إغفاله عن هذا الـ ALTER كان سيحذفه من قائمة القيم المسموحة ويكسر أي مستخدم
-- بهذا الدور. تم أيضاً تصحيح schema.ts لإضافته رسمياً (انظر تعديل userRoles).
-- ============================================================

ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','operator','technician','maintenance_manager','supervisor','purchase_manager','purchase_requester','delegate','accountant','senior_management','executive_director','warehouse','gate_security','owner','food_warehouse_manager','food_warehouse_assistant') NOT NULL DEFAULT 'user';
