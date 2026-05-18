-- ============================================================
-- Phase 1 Migration: Add purchase_requester role
-- Date: 2026-05-18
-- Safe to run on live data: YES (enum expansion)
-- ============================================================

ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','operator','technician','maintenance_manager','supervisor','purchase_manager','purchase_requester','delegate','accountant','senior_management','warehouse','gate_security','owner') NOT NULL DEFAULT 'user';
