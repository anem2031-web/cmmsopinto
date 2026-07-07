-- دفعات التسعير: تسمح للمندوب بإرسال الأصناف المسعّرة للحسابات على دفعات متعددة
-- بنفس رقم طلب الشراء، وكل دفعة تُعتمد من الحسابات بشكل مستقل عن الدفعات الأخرى.

CREATE TABLE `po_pricing_batches` (
  `id` int AUTO_INCREMENT NOT NULL,
  `purchaseOrderId` int NOT NULL,
  `batchNumber` int NOT NULL,
  `submittedById` int NOT NULL,
  `submittedAt` timestamp NOT NULL DEFAULT (now()),
  `itemCount` int NOT NULL DEFAULT 0,
  `totalEstimatedCost` decimal(12,2),
  `status` enum('pending_accounting','pending_management','approved','rejected') NOT NULL DEFAULT 'pending_accounting',
  `accountingApprovedById` int,
  `accountingApprovedAt` timestamp,
  `accountingNotes` text,
  `custodyAmount` decimal(12,2),
  `managementApprovedById` int,
  `managementApprovedAt` timestamp,
  `managementNotes` text,
  `rejectedById` int,
  `rejectedAt` timestamp,
  `rejectionReason` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()),
  CONSTRAINT `po_pricing_batches_id` PRIMARY KEY(`id`)
);

ALTER TABLE `purchase_order_items` ADD `batchId` int;

CREATE INDEX `po_pricing_batches_po_idx` ON `po_pricing_batches` (`purchaseOrderId`);
CREATE INDEX `purchase_order_items_batch_idx` ON `purchase_order_items` (`batchId`);
