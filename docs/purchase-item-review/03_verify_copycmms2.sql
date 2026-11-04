-- READ ONLY. Expected: four nullable columns and two non-unique four-column indexes.
SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'copycmms2' AND TABLE_NAME = 'purchase_order_items'
  AND COLUMN_NAME IN ('reviewRole','reviewedById','reviewedAt','reviewerSignatureSnapshot')
ORDER BY FIELD(COLUMN_NAME,'reviewRole','reviewedById','reviewedAt','reviewerSignatureSnapshot');

SELECT INDEX_NAME, NON_UNIQUE,
  GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ',') AS indexed_columns
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'copycmms2' AND TABLE_NAME = 'purchase_order_items'
  AND INDEX_NAME IN ('idx_poi_review_queue','idx_poi_review_actor')
GROUP BY INDEX_NAME, NON_UNIQUE
ORDER BY INDEX_NAME;
