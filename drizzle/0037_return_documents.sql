-- ============================================================
-- 0037_return_documents.sql
-- جدول وثائق المرتجعات — يُنشأ تلقائياً بالخادم مع كل مرتجع،
-- ويظهر بتبويب "التوثيق" جنباً إلى جنب مع وثائق التسليم
-- ============================================================

CREATE TABLE `return_documents` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `returnNumber` VARCHAR(20) NOT NULL,
  `returnId` INT NOT NULL,
  `itemName` VARCHAR(300) NOT NULL,
  `returnedQuantity` INT NOT NULL,
  `unit` VARCHAR(50),
  `reason` TEXT NOT NULL,
  `returnedByName` VARCHAR(200) NOT NULL,
  -- معلومات مصدر الإرجاع (اختيارية: قد يكون إرجاعاً عاماً بلا مصدر)
  `receiptNumber` VARCHAR(20),
  `vendorName` VARCHAR(300),
  `poNumber` VARCHAR(100),
  `printCount` INT NOT NULL DEFAULT 0,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_return_documents_return_id ON `return_documents` (`returnId`);
