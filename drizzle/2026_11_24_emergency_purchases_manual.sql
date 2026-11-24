-- Manual rollout only. Select the intended database before running this script.
-- Apply to COPYCMMS2 first. Do not enable EMERGENCY_PURCHASES_ENABLED until verification.
SELECT DATABASE() AS current_database;

CREATE TABLE emergency_pricing_bundles (
  bundleId INT NOT NULL PRIMARY KEY,
  openDelegateId INT NULL,
  submittedAt TIMESTAMP NULL,
  cancelledAt TIMESTAMP NULL,
  receivedItemCount INT NOT NULL DEFAULT 0,
  requiredItemCount INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_emergency_open_delegate (openDelegateId),
  CONSTRAINT fk_emergency_bundle FOREIGN KEY (bundleId) REFERENCES delegate_pricing_bundles (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE emergency_purchase_items (
  purchaseOrderItemId INT NOT NULL PRIMARY KEY,
  markedById INT NOT NULL,
  markedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  bundleId INT NULL,
  cancelledAt TIMESTAMP NULL,
  cancelledById INT NULL,
  cancellationReason TEXT NULL,
  KEY idx_emergency_items_bundle (bundleId,cancelledAt),
  CONSTRAINT fk_emergency_item FOREIGN KEY (purchaseOrderItemId) REFERENCES purchase_order_items (id)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_emergency_item_bundle FOREIGN KEY (bundleId) REFERENCES emergency_pricing_bundles (bundleId)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append the new state to preserve the existing ENUM values and ordinals.
ALTER TABLE po_pricing_batches MODIFY COLUMN status
  ENUM('pending_accounting','pending_management','approved','rejected','awaiting_receipt')
  NOT NULL DEFAULT 'pending_accounting';
ALTER TABLE delegate_pricing_bundle_approvals MODIFY COLUMN status
  ENUM('pending_accounting','pending_management','approved','rejected','awaiting_receipt')
  NOT NULL DEFAULT 'pending_accounting';

SHOW CREATE TABLE emergency_pricing_bundles;
SHOW CREATE TABLE emergency_purchase_items;
SHOW COLUMNS FROM po_pricing_batches LIKE 'status';
SHOW COLUMNS FROM delegate_pricing_bundle_approvals LIKE 'status';
