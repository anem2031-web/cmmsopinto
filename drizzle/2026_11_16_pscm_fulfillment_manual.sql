-- CMMS only. Execute each statement separately before deploying the change.
CREATE TABLE IF NOT EXISTS pscm_purchase_items (
  purchaseOrderItemId INT NOT NULL PRIMARY KEY,
  purchaseOrderId INT NOT NULL,
  sequence INT NOT NULL,
  taskId INT NOT NULL,
  taskName VARCHAR(255) NOT NULL,
  projectId INT NOT NULL,
  projectName VARCHAR(255) NOT NULL,
  requestedQuantity INT NOT NULL,
  orderUnit VARCHAR(50) NOT NULL,
  UNIQUE KEY uq_pscm_purchase_order_sequence (purchaseOrderId, sequence)
);

CREATE TABLE IF NOT EXISTS pscm_fulfillment_issues (
  operationKey CHAR(36) NOT NULL PRIMARY KEY,
  purchaseOrderItemId INT NOT NULL,
  lotId INT NOT NULL,
  quantity INT NOT NULL,
  deliveredToId INT NOT NULL,
  deliveryDocumentId INT NULL,
  deliveryNumber VARCHAR(20) NOT NULL,
  orderQuantity DECIMAL(18,6) NOT NULL,
  KEY idx_pscm_issues_item_lot (purchaseOrderItemId, lotId)
);

-- Historical imports from PSCM store the task/project on their creation audit entry.
-- PSCM sends consecutive 1-based sequences, and CMMS inserts the items in that sequence.
-- Skip pre-existing mappings and orders with removed lines or edited order quantities/units.
INSERT INTO pscm_purchase_items
  (purchaseOrderItemId, purchaseOrderId, sequence, taskId, taskName, projectId, projectName, requestedQuantity, orderUnit)
SELECT i.id, p.id, ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY i.id),
  CAST(JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.task.id')) AS UNSIGNED),
  JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.task.name')),
  CAST(JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.project.id')) AS UNSIGNED),
  JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.project.name')),
  i.quantity, i.unit
FROM purchase_orders p
JOIN purchase_order_items i ON i.purchaseOrderId = p.id
JOIN audit_logs a ON a.entityId = p.id AND a.action = 'create_po' AND a.entityType = 'purchase_order'
  AND JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.system')) = 'PSCM'
  AND JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.instanceId')) = p.sourceInstanceId
  AND JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.requisitionNumber')) = p.sourceReference
  AND JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.requisitionId')) = CAST(p.sourceRequestId AS CHAR)
WHERE p.sourceSystem = 'PSCM'
  AND JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.task.id')) REGEXP '^[1-9][0-9]*$'
  AND JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.project.id')) REGEXP '^[1-9][0-9]*$'
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.task.name')), '') <> ''
  AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(a.newValues, '$.source.project.name')), '') <> ''
  AND NOT EXISTS (SELECT 1 FROM pscm_purchase_items m WHERE m.purchaseOrderId = p.id)
  AND NOT EXISTS (
    SELECT 1 FROM audit_logs removed
    WHERE removed.action = 'delete_po_item' AND removed.entityType = 'purchase_order_item'
      AND JSON_UNQUOTE(JSON_EXTRACT(removed.oldValues, '$.purchaseOrderId')) = CAST(p.id AS CHAR)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM purchase_order_items other
    LEFT JOIN audit_logs edited ON edited.entityId = other.id AND edited.entityType = 'purchase_order_item'
      AND edited.action IN ('update_po_item','edit_and_resubmit_item_revision','edit_and_resubmit_cancelled_purchase')
      AND ((JSON_EXTRACT(edited.newValues, '$.quantity') IS NOT NULL
        AND NOT (JSON_EXTRACT(edited.newValues, '$.quantity') <=> JSON_EXTRACT(edited.oldValues, '$.quantity')))
        OR (JSON_EXTRACT(edited.newValues, '$.unit') IS NOT NULL
        AND NOT (JSON_EXTRACT(edited.newValues, '$.unit') <=> JSON_EXTRACT(edited.oldValues, '$.unit'))))
    WHERE other.purchaseOrderId = p.id
      AND (other.quantity <= 0 OR TRIM(COALESCE(other.unit, '')) = '' OR edited.id IS NOT NULL)
  );

SELECT p.poNumber, p.sourceReference, COUNT(m.purchaseOrderItemId) AS linkedItems
FROM purchase_orders p
LEFT JOIN pscm_purchase_items m ON m.purchaseOrderId = p.id
WHERE p.sourceSystem = 'PSCM'
GROUP BY p.id, p.poNumber, p.sourceReference
ORDER BY p.id;
