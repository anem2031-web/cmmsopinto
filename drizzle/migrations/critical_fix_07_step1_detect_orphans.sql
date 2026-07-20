-- ============================================================================
-- إصلاح حرج #7 — الخطوة 1 و4 من خطة الاحتواء: كشف السجلات المخالفة (قراءة فقط)
-- شغّل هذا الملف أولاً، قبل أي تعديل، وقبل ملف critical_fix_07_purchase_fk_constraints.sql
-- كرّر تشغيله بعد أي تصحيح يدوي (الخطوة 3) للتأكد أن كل النتائج أصبحت صفراً
-- قبل الانتقال للفهارس والمفاتيح الخارجية.
-- ============================================================================

-- 1) أصناف طلبات شراء بلا طلب أب حقيقي
SELECT poi.id, poi.purchaseOrderId, poi.itemName, poi.createdAt
FROM purchase_order_items poi
LEFT JOIN purchase_orders po ON po.id = poi.purchaseOrderId
WHERE po.id IS NULL;

-- 2) سطور استلام مرتبطة بمعرّف صنف غير موجود (مصدر الروابط المفقودة الـ122 على الأرجح)
SELECT wri.id, wri.receiptId, wri.purchaseOrderItemId, wri.itemName, wr.purchaseOrderId, wr.receiptNumber
FROM warehouse_receipt_items wri
JOIN warehouse_receipts wr ON wr.id = wri.receiptId
LEFT JOIN purchase_order_items poi ON poi.id = wri.purchaseOrderItemId
WHERE wri.purchaseOrderItemId IS NOT NULL AND poi.id IS NULL;

-- 3) حركات مخزون مرتبطة بمعرّف صنف غير موجود
SELECT it.id, it.purchaseOrderItemId, it.inventoryId, it.createdAt, it.reason
FROM inventory_transactions it
LEFT JOIN purchase_order_items poi ON poi.id = it.purchaseOrderItemId
WHERE it.purchaseOrderItemId IS NOT NULL AND poi.id IS NULL;

-- 4) ملخص عددي سريع لكل نوع مخالفة (لتحديد حجم الجهد المطلوب في الخطوة 3)
SELECT
  (SELECT COUNT(*) FROM purchase_order_items poi
     LEFT JOIN purchase_orders po ON po.id = poi.purchaseOrderId WHERE po.id IS NULL) AS orphan_po_items,
  (SELECT COUNT(*) FROM warehouse_receipt_items wri
     LEFT JOIN purchase_order_items poi ON poi.id = wri.purchaseOrderItemId
     WHERE wri.purchaseOrderItemId IS NOT NULL AND poi.id IS NULL) AS orphan_receipt_items,
  (SELECT COUNT(*) FROM inventory_transactions it
     LEFT JOIN purchase_order_items poi ON poi.id = it.purchaseOrderItemId
     WHERE it.purchaseOrderItemId IS NOT NULL AND poi.id IS NULL) AS orphan_inventory_tx;

-- ── معلومات بيئة إضافية مطلوبة قبل تنفيذ ملف الـFK ──────────────────────────
SELECT VERSION() AS tidbVersion, @@foreign_key_checks AS fkChecksEnabled;
