import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

/** Manual rollout only, after the owner installs the reviewed SQL. */
export const unifiedBundleApprovalsEnabled = () =>
  process.env.DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED === "true";

export async function assertLegacyApprovalOutsideUnifiedBundle(
  database: any,
  scope: {
    batchId?: number;
    submissionId?: number;
    poId?: number;
    pendingOnly?: boolean;
  }
) {
  if (!database) throw Error("قاعدة البيانات غير متاحة");
  if (!unifiedBundleApprovalsEnabled()) {
    const [tables] = await database.execute(
      sql`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='delegate_pricing_bundle_approvals'`
    );
    if (!Array.isArray(tables))
      throw Error("تعذر التحقق من نطاق اعتماد الحزمة");
    if (!tables.length) return;
  }
  const [rows] =
    await database.execute(sql`SELECT b.bundleNumber FROM delegate_pricing_bundle_approvals a
    JOIN delegate_pricing_bundles b ON b.id=a.bundleId JOIN delegate_pricing_bundle_batches l ON l.bundleId=a.bundleId
    WHERE ${scope.batchId ? sql`l.pricingBatchId=${scope.batchId}` : scope.submissionId ? sql`l.purchasePackageSubmissionId=${scope.submissionId}` : sql`l.purchaseOrderId=${scope.poId || 0}`}
    AND ${scope.pendingOnly ? sql`a.status IN ('pending_accounting','pending_management')` : sql`1=1`} LIMIT 1`);
  if (!Array.isArray(rows)) throw Error("تعذر التحقق من نطاق اعتماد الحزمة");
  if (rows.length)
    throw new TRPCError({
      code: "CONFLICT",
      message: `هذه الأصناف تُراجع من حزمة التسعير ${rows[0].bundleNumber}؛ افتح الحزمة للاعتماد أو رفض الصنف`,
    });
}

export async function initializeUnifiedApproval(tx: any, bundleId: number) {
  if (!unifiedBundleApprovalsEnabled()) return;
  await tx.execute(
    sql`INSERT INTO delegate_pricing_bundle_approvals (bundleId,status) VALUES (${bundleId},'pending_accounting')`
  );
}
