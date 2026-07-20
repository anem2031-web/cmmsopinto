-- ============================================================================
-- إصلاح حرج #7: إضافة مفاتيح خارجية على purchase_order_items وwarehouse_receipt_items
-- وinventory_transactions.
--
-- ⚠️⚠️⚠️ تحذير إلزامي قبل تنفيذ هذا الملف على أي بيئة إنتاج ⚠️⚠️⚠️
-- لا يجوز تنفيذ هذا الملف مباشرة. يجب أولاً إتمام خطوات الاحتواء 1-4 الموثقة
-- في تقرير "السبب الجذري والثغرة الأمنية" (القسم 12.5) على قاعدة الإنتاج نفسها:
--   1) استخراج كل السجلات المخالفة (orphan rows) في الجداول الثلاثة.
--   2) تجميد الكتابة على مسارات: purchaseOrders.*, warehouseReceipts.*,
--      warehouseReceiptsV2.*, inventory.deliverToRequester (نافذة صيانة قصيرة).
--   3) تصحيح الروابط القابلة للإصلاح يدوياً (بالاستناد لصور الفواتير/OCR)،
--      وتحويل غير القابلة للإصلاح إلى NULL بقرار رسمي موثَّق.
--   4) إعادة تشغيل استعلامات الكشف والتأكد أنها تُرجع صفر صفوف مخالفة.
-- فقط بعد تأكيد الخطوة 4 بنتيجة صفر، يُنفَّذ هذا الملف (الخطوتان 5 و6).
--
-- كما يجب التأكد أولاً من دعم إصدار TiDB الفعلي للمفاتيح الخارجية:
--   SELECT VERSION(), @@foreign_key_checks;
-- (الدعم العام/GA متاح ابتداءً من TiDB 8.5.0 فقط)
-- ============================================================================

-- ── الخطوة 5: الفهارس أولاً (تمنع قفل الجدول لفترة طويلة عند إضافة FK لاحقاً) ──
CREATE INDEX idx_poi_purchaseOrderId        ON purchase_order_items   (purchaseOrderId);
CREATE INDEX idx_wri_purchaseOrderItemId    ON warehouse_receipt_items (purchaseOrderItemId);
CREATE INDEX idx_invtx_purchaseOrderItemId  ON inventory_transactions  (purchaseOrderItemId);

-- ── الخطوة 6: المفاتيح الخارجية ──────────────────────────────────────────────
ALTER TABLE purchase_order_items
  ADD CONSTRAINT fk_poi_purchase_order
  FOREIGN KEY (purchaseOrderId) REFERENCES purchase_orders(id)
  ON DELETE RESTRICT;
  -- RESTRICT: يمنع حذف طلب الشراء الأب طالما لديه بند واحد على الأقل
  -- (يدعم إصلاح خلل حذف الطلب الكامل في نفس التقرير، القسم 10.5)

ALTER TABLE warehouse_receipt_items
  ADD CONSTRAINT fk_wri_po_item
  FOREIGN KEY (purchaseOrderItemId) REFERENCES purchase_order_items(id)
  ON DELETE SET NULL;

ALTER TABLE inventory_transactions
  ADD CONSTRAINT fk_invtx_po_item
  FOREIGN KEY (purchaseOrderItemId) REFERENCES purchase_order_items(id)
  ON DELETE SET NULL;

-- ── الخطوة 7 (فحص ما بعد النشر) — نفّذها يدوياً بعد نجاح الملف أعلاه ──────────
-- SELECT CONSTRAINT_NAME, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME
-- FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
-- WHERE TABLE_SCHEMA = DATABASE()
--   AND TABLE_NAME IN ('purchase_order_items','warehouse_receipt_items','inventory_transactions')
--   AND REFERENCED_TABLE_NAME IS NOT NULL;
