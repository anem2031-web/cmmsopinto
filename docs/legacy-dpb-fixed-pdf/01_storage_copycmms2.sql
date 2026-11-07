-- Manual execution on COPYCMMS2 only. No changes to purchase/approval/delegate PDF records.
-- Run the preflight first. If the table exists, inspect it instead of recreating it.
SELECT TABLE_NAME FROM information_schema.TABLES
WHERE TABLE_SCHEMA = 'COPYCMMS2' AND TABLE_NAME = 'delegate_pricing_bundle_pdf_corrections';

CREATE TABLE `COPYCMMS2`.`delegate_pricing_bundle_pdf_corrections` (
  `bundleId` INT NOT NULL,
  `bundleNumber` VARCHAR(100) NOT NULL,
  `sourceHash` CHAR(64) NOT NULL,
  `formatVersion` INT NOT NULL DEFAULT 2,
  `originalPdf` LONGBLOB NOT NULL,
  `originalSha256` CHAR(64) NOT NULL,
  `correctedPdf` LONGBLOB NOT NULL,
  `correctedSha256` CHAR(64) NOT NULL,
  `createdAt` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`bundleId`),
  UNIQUE KEY `uq_dpb_pdf_correction_number` (`bundleNumber`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Import the generated per-document SQL only after reviewing the actual corrected PDFs.
-- DDL is not protected by START TRANSACTION / ROLLBACK.

SELECT bundleNumber,formatVersion,LENGTH(originalPdf) AS originalBytes,
  LENGTH(correctedPdf) AS correctedBytes,
  SHA2(originalPdf,256)=originalSha256 AS originalValid,
  SHA2(correctedPdf,256)=correctedSha256 AS correctedValid
FROM `COPYCMMS2`.`delegate_pricing_bundle_pdf_corrections` ORDER BY bundleId;
