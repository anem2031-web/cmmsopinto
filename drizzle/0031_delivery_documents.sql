CREATE TABLE `delivery_documents` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `deliveryNumber` varchar(20) NOT NULL,
  `poItemId` int NOT NULL,
  `itemName` varchar(300) NOT NULL,
  `deliveredByName` varchar(200) NOT NULL,
  `deliveredToName` varchar(200) NOT NULL,
  `quantity` int NOT NULL,
  `unit` varchar(50),
  `supplierName` varchar(300),
  `actualUnitCost` varchar(50),
  `poNumber` varchar(100),
  `warehousePhotoUrl` text,
  `notes` text,
  `pdfKey` text,
  `pdfUrl` text,
  `printCount` int NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
