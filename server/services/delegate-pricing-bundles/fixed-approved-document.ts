import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { PricingBundleSnapshot } from "../../../shared/delegate-pricing-bundles";

/** The twelve legacy documents reviewed on COPYCMMS2. No general PDF cache. */
export const LEGACY_DPB_CORRECTIONS = [2, 3, 5, 6, 8, 9, 22, 24, 29, 31, 33, 35]
  .map(number => `DPB-2026-${String(number).padStart(6, "0")}`);
const targets = new Set(LEGACY_DPB_CORRECTIONS);
export const fixedPdfHash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
export const LEGACY_CORRECTION_FORMAT = 2;

/** Display-only policy approved by the owner. Never updates a custody ledger. */
export function lowestLegacyCustody(approvals: NonNullable<PricingBundleSnapshot["financialApprovals"]>) {
  let minimum: { units: bigint; value: string } | null = null;
  for (const approval of approvals) {
    if (approval.custodyValue == null) continue;
    const value = String(approval.custodyValue).trim();
    if (!/^\d{1,14}(\.\d{1,4})?$/.test(value)) throw Error("رصيد عهدة تاريخي غير صالح؛ يلزم مراجعته");
    const [whole, fraction = ""] = value.split(".");
    const units = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, "0"));
    if (!minimum || units < minimum.units) minimum = { units, value };
  }
  if (!minimum) throw Error("لا يوجد رصيد عهدة مسجل لاختيار الأقل منه");
  return minimum.value;
}

function canonical(value: any): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

/** Stable database values, not fetched signature bytes or a server's local timezone. */
export async function legacyDocumentSource(database: any, bundle: { id: number; bundleNumber: string }) {
  if (!targets.has(bundle.bundleNumber)) throw Error("الحزمة خارج نطاق تصحيح المستندات القديمة");
  const [headers] = await database.execute(sql`SELECT snapshotJson,SHA2(CAST(snapshotJson AS CHAR),256) AS snapshotSqlHash
    FROM delegate_pricing_bundles WHERE id=${Number(bundle.id)} AND bundleNumber=${bundle.bundleNumber}`);
  if (headers.length !== 1) throw Error("تعذر التحقق من أصل المستند");
  const snapshot = typeof headers[0].snapshotJson === "string" ? JSON.parse(headers[0].snapshotJson) : headers[0].snapshotJson;
  const [approvals] = await database.execute(sql`SELECT l.purchaseOrderId,l.pricingBatchId,l.purchasePackageSubmissionId,
    p.poNumber,p.packageId,pb.batchNumber,pb.status AS batchStatus,pb.accountingApprovedById,pb.managementApprovedById,
    CAST(pb.accountingApprovedAt AS CHAR) AS batchAccountingAt,CAST(pb.managementApprovedAt AS CHAR) AS batchManagementAt,
    pb.accountingSignatureSnapshot,pb.accountingNotes,pb.custodyAmount,
    s.status AS submissionStatus,s.accountingApprovedById AS submissionAccountingId,s.managementApprovedById AS submissionManagementId,
    CAST(s.accountingApprovedAt AS CHAR) AS submissionAccountingAt,CAST(s.managementApprovedAt AS CHAR) AS submissionManagementAt,
    s.accountingSignatureSnapshot AS submissionSignature,s.custodyBalance,s.subNumber,pk.packageNumber
    FROM delegate_pricing_bundle_batches l JOIN purchase_orders p ON p.id=l.purchaseOrderId
    JOIN po_pricing_batches pb ON pb.id=l.pricingBatchId
    LEFT JOIN purchase_package_submissions s ON s.id=l.purchasePackageSubmissionId
    LEFT JOIN purchase_packages pk ON pk.id=s.purchasePackageId
    WHERE l.bundleId=${Number(bundle.id)} ORDER BY l.purchaseOrderId,l.pricingBatchId`);
  if (!approvals.length) throw Error("تعذر التحقق من مراجع الاعتماد");
  return {
    sourceHash: fixedPdfHash(canonical({ version: 1, bundleId: Number(bundle.id), number: bundle.bundleNumber, snapshot, approvals })),
    snapshotSqlHash: headers[0].snapshotSqlHash as string,
  };
}

function missingCorrectionTable(error: any): boolean {
  const cause = error?.cause || error;
  return cause?.code === "ER_NO_SUCH_TABLE" && Number(cause?.errno) === 1146
    && String(cause?.sqlMessage || cause?.message || "").includes("delegate_pricing_bundle_pdf_corrections");
}

/** Called ONLY after the existing fresh role, full-membership and approval guards. Never writes. */
export async function readFixedApprovedDocument(database: any, bundle: { id: number; bundleNumber: string }, approved: PricingBundleSnapshot): Promise<Buffer | null> {
  if (!targets.has(bundle.bundleNumber) || (approved.financialApprovals?.length || 0) < 2) return null;
  let records: any[];
  try {
    [records] = await database.execute(sql`SELECT bundleNumber,sourceHash,formatVersion,correctedPdf,correctedSha256
      FROM delegate_pricing_bundle_pdf_corrections WHERE bundleId=${Number(bundle.id)}`);
  } catch (error) {
    // Safe deployment before the owner's manual migration; infrastructure errors still propagate.
    if (missingCorrectionTable(error)) return null;
    throw error;
  }
  if (!records.length) return null;
  const row = records[0];
  if (records.length !== 1 || row.bundleNumber !== bundle.bundleNumber || Number(row.formatVersion) !== LEGACY_CORRECTION_FORMAT)
    throw Error("تعذر التحقق من هوية النسخة المصححة");
  const current = await legacyDocumentSource(database, bundle);
  if (current.sourceHash !== row.sourceHash) throw Error("تغيرت بيانات المستند أو اعتماده؛ يلزم مراجعة النسخة المصححة");
  if (!(Buffer.isBuffer(row.correctedPdf) || row.correctedPdf instanceof Uint8Array)) throw Error("النسخة المصححة غير صالحة");
  const bytes = Buffer.from(row.correctedPdf);
  if (!bytes.length || bytes.length > 8 * 1024 * 1024 || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
    || !bytes.subarray(-1024).includes(Buffer.from("%%EOF")) || fixedPdfHash(bytes) !== row.correctedSha256)
    throw Error("فشل التحقق من سلامة ملف المستند المصحح");
  return bytes;
}
