-- READ ONLY. Run before the migration. No application or data changes.
SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'copycmms2'
  AND TABLE_NAME = 'purchase_order_items'
  AND COLUMN_NAME IN ('status', 'reviewRole', 'reviewedById', 'reviewedAt', 'reviewerSignatureSnapshot')
ORDER BY ORDINAL_POSITION;

SELECT TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'copycmms2'
  AND TABLE_NAME = 'purchase_order_items'
  AND INDEX_NAME IN ('idx_poi_review_queue', 'idx_poi_review_actor')
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
