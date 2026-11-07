-- Read-only verification after the owner creates the table and imports all twelve files.
SELECT bundleId,bundleNumber,formatVersion,
  LENGTH(originalPdf) AS originalBytes,LENGTH(correctedPdf) AS correctedBytes,
  SHA2(originalPdf,256)=originalSha256 AS originalValid,
  SHA2(correctedPdf,256)=correctedSha256 AS correctedValid
FROM `COPYCMMS2`.`delegate_pricing_bundle_pdf_corrections`
WHERE bundleNumber IN ('DPB-2026-000002','DPB-2026-000003','DPB-2026-000005',
  'DPB-2026-000006','DPB-2026-000008','DPB-2026-000009','DPB-2026-000022',
  'DPB-2026-000024','DPB-2026-000029','DPB-2026-000031','DPB-2026-000033','DPB-2026-000035')
ORDER BY bundleId;

-- Expected: installed=12, finalFormat=12 and both integrity counts=12.
SELECT COUNT(*) AS installed,
  SUM(formatVersion=2) AS finalFormat,
  SUM(SHA2(originalPdf,256)=originalSha256) AS validOriginals,
  SUM(SHA2(correctedPdf,256)=correctedSha256) AS validCorrections
FROM `COPYCMMS2`.`delegate_pricing_bundle_pdf_corrections`;
