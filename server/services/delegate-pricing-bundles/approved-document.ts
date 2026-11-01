import { sql } from "drizzle-orm";
import { readAccountingSignature } from "../pdf/accountingSignature";
import type { PricingBundleSnapshot } from "../../../shared/delegate-pricing-bundles";
import { unifiedBundleApprovalsEnabled } from "./unified-feature";

/** Alias b is the document-center parent. Filter before counts and pagination. */
export function approvedBundleCondition() {
  const legacy=sql`EXISTS (SELECT 1 FROM delegate_pricing_bundle_batches l WHERE l.bundleId=b.id)
    AND EXISTS (SELECT 1 FROM delegate_pricing_bundle_items m WHERE m.bundleId=b.id AND m.removedAt IS NULL)
    AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_batches l WHERE l.bundleId=b.id
      AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_items m JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId
        WHERE m.bundleId=b.id AND m.removedAt IS NULL AND i.purchaseOrderId=l.purchaseOrderId))
    AND NOT EXISTS (
      SELECT 1 FROM delegate_pricing_bundle_items m
      LEFT JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId
      LEFT JOIN delegate_pricing_bundle_batches l ON l.bundleId=m.bundleId AND l.purchaseOrderId=i.purchaseOrderId
      WHERE m.bundleId=b.id AND m.removedAt IS NULL AND (i.id IS NULL OR l.pricingBatchId IS NULL))
    AND NOT EXISTS (
      SELECT 1 FROM delegate_pricing_bundle_batches l
      LEFT JOIN po_pricing_batches pb ON pb.id=l.pricingBatchId
      LEFT JOIN purchase_orders p ON p.id=l.purchaseOrderId
      LEFT JOIN purchase_package_submissions s ON s.id=l.purchasePackageSubmissionId
      WHERE l.bundleId=b.id AND (
        p.id IS NULL OR pb.id IS NULL OR pb.purchaseOrderId<>l.purchaseOrderId
        OR pb.status IS NULL OR pb.status<>'approved'
        OR COALESCE(pb.accountingApprovedById,0)<=0 OR pb.accountingApprovedAt IS NULL
        OR COALESCE(pb.managementApprovedById,0)<=0 OR pb.managementApprovedAt IS NULL
        OR (l.purchasePackageSubmissionId IS NULL AND pb.purchasePackageSubmissionId IS NOT NULL)
        OR (l.purchasePackageSubmissionId IS NOT NULL AND (
          s.id IS NULL OR pb.purchasePackageSubmissionId IS NULL OR pb.purchasePackageSubmissionId<>s.id
          OR p.packageId IS NULL OR p.packageId<>s.purchasePackageId
          OR s.status IS NULL OR s.status<>'approved'
          OR COALESCE(s.accountingApprovedById,0)<=0 OR s.accountingApprovedAt IS NULL
          OR COALESCE(s.managementApprovedById,0)<=0 OR s.managementApprovedAt IS NULL))))`;
  if(!unifiedBundleApprovalsEnabled())return legacy;
  return sql`((${legacy} AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_approvals a WHERE a.bundleId=b.id)) OR (
    EXISTS (SELECT 1 FROM delegate_pricing_bundle_approvals a WHERE a.bundleId=b.id AND a.status='approved'
      AND COALESCE(a.accountingApprovedById,0)>0 AND a.accountingApprovedAt IS NOT NULL
      AND COALESCE(a.managementApprovedById,0)>0 AND a.managementApprovedAt IS NOT NULL)
    AND EXISTS (SELECT 1 FROM delegate_pricing_bundle_batches l WHERE l.bundleId=b.id)
    AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_batches l WHERE l.bundleId=b.id AND NOT EXISTS
      (SELECT 1 FROM delegate_pricing_bundle_items m JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId WHERE m.bundleId=b.id AND m.removedAt IS NULL AND i.purchaseOrderId=l.purchaseOrderId))
    AND EXISTS (SELECT 1 FROM delegate_pricing_bundle_items m WHERE m.bundleId=b.id AND m.removedAt IS NULL)
    AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_items m LEFT JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId
      LEFT JOIN delegate_pricing_bundle_batches l ON l.bundleId=m.bundleId AND l.purchaseOrderId=i.purchaseOrderId
      WHERE m.bundleId=b.id AND m.removedAt IS NULL AND (i.id IS NULL OR l.pricingBatchId IS NULL))
    AND NOT EXISTS (SELECT 1 FROM delegate_pricing_bundle_batches l LEFT JOIN po_pricing_batches pb ON pb.id=l.pricingBatchId
      LEFT JOIN purchase_orders p ON p.id=l.purchaseOrderId LEFT JOIN purchase_package_submissions s ON s.id=l.purchasePackageSubmissionId
      WHERE l.bundleId=b.id AND (p.id IS NULL OR pb.id IS NULL OR pb.purchaseOrderId<>p.id OR pb.status IS NULL OR pb.status NOT IN ('approved','rejected')
        OR (l.purchasePackageSubmissionId IS NULL AND pb.purchasePackageSubmissionId IS NOT NULL)
        OR (l.purchasePackageSubmissionId IS NOT NULL AND (s.id IS NULL OR pb.purchasePackageSubmissionId IS NULL OR pb.purchasePackageSubmissionId<>s.id
          OR p.packageId IS NULL OR p.packageId<>s.purchasePackageId OR s.status IS NULL OR s.status NOT IN ('approved','rejected'))))) ))`;
}

/** Fresh exact-batch checks for the approved PDF; source rows/prices stay frozen. */
export async function approvedBundleSnapshot(database: any, bundle: any, snapshot: PricingBundleSnapshot,
  signature: (source: string | null) => Promise<string>): Promise<PricingBundleSnapshot> {
  if(unifiedBundleApprovalsEnabled()){
    const [roots]=await database.execute(sql`SELECT a.* FROM delegate_pricing_bundle_approvals a JOIN delegate_pricing_bundles b ON b.id=a.bundleId
      WHERE a.bundleId=${Number(bundle.id)} AND ${approvedBundleCondition()}`);
    if(roots.length){
      const [members]=await database.execute(sql`SELECT m.purchaseOrderItemId,i.purchaseOrderId FROM delegate_pricing_bundle_items m
        JOIN purchase_order_items i ON i.id=m.purchaseOrderItemId WHERE m.bundleId=${Number(bundle.id)} AND m.removedAt IS NULL`);
      if(members.length!==snapshot.rows.length||members.some((item:any)=>!snapshot.rows.some(row=>row.id===Number(item.purchaseOrderItemId)&&row.purchaseOrderId===Number(item.purchaseOrderId))))throw Error('لا تتطابق أصناف الاعتماد مع لقطة حزمة التسعير');
      const root=roots[0];const accounting=readAccountingSignature(root.accountingSignatureSnapshot,Number(root.accountingApprovedById));
      const management=readAccountingSignature(root.managementSignatureSnapshot,Number(root.managementApprovedById));
      const parse=(value:any)=>typeof value==='string'?JSON.parse(value):value;
      const rejected=[...(parse(root.accountingRejections)||[]),...(parse(root.managementRejections)||[])];
      const rejectedIds=new Set(rejected.map((row:any)=>Number(row.itemId)));
      const approvedTotal=(snapshot.rows.filter(row=>!rejectedIds.has(Number(row.id))).reduce((sum,row)=>sum+Math.round(Number(row.estimatedTotalCost)*100),0)/100).toFixed(2);
      return {...snapshot,rows:snapshot.rows.map(row=>({...row,approvalRejectionReason:rejected.find((item:any)=>Number(item.itemId)===row.id)?.reason})),
        approvedTotal,compensations:snapshot.compensations?.filter(row=>!rejectedIds.has(Number(row.purchaseOrderItemId))),
        financialApprovals:[{reference:snapshot.number,poNumbers:Array.from(new Set(snapshot.rows.map(row=>row.poNumber))),
          accountingName:accounting?.name||`مستخدم #${root.accountingApprovedById}`,accountingAt:String(root.accountingApprovedAt),accountingSignature:await signature(accounting?.signatureUrl||null),
          managementName:management?.name||`مستخدم #${root.managementApprovedById}`,managementAt:String(root.managementApprovedAt),managementSignature:await signature(management?.signatureUrl||null),
          custodyLabel:'إجمالي رصيد العهد التي على المندوب',custodyValue:root.custodyBalance??null,notes:[root.accountingNotes?`الحسابات: ${root.accountingNotes}`:'',root.managementNotes?`الإدارة العليا: ${root.managementNotes}`:''].filter(Boolean).join(' / ')}]};}
    // A managed bundle that lost its final approval must not fall back to an old PDF.
    const [managed]=await database.execute(sql`SELECT bundleId FROM delegate_pricing_bundle_approvals WHERE bundleId=${Number(bundle.id)}`);
    if(managed.length)throw Error('الوثيقة المعتمدة متاحة بعد اكتمال اعتماد الإدارة العليا لحزمة DPB');
  }
  const [approvals] = await database.execute(sql`SELECT l.purchaseOrderId,p.poNumber,l.pricingBatchId,l.purchasePackageSubmissionId,
    pb.batchNumber,pb.accountingApprovedById,pb.accountingApprovedAt,pb.accountingSignatureSnapshot,pb.accountingNotes,pb.custodyAmount,
    pb.managementApprovedById,pb.managementApprovedAt,
    s.accountingApprovedById AS submissionAccountingId,s.accountingApprovedAt AS submissionAccountingAt,
    s.accountingSignatureSnapshot AS submissionSignature,s.managementApprovedById AS submissionManagementId,
    s.managementApprovedAt AS submissionManagementAt,s.custodyBalance,s.subNumber,pk.packageNumber,
    a.name AS accountingName,g.name AS managementName
    FROM delegate_pricing_bundle_batches l JOIN delegate_pricing_bundles b ON b.id=l.bundleId JOIN purchase_orders p ON p.id=l.purchaseOrderId
    JOIN po_pricing_batches pb ON pb.id=l.pricingBatchId
    LEFT JOIN purchase_package_submissions s ON s.id=l.purchasePackageSubmissionId
    LEFT JOIN purchase_packages pk ON pk.id=s.purchasePackageId
    LEFT JOIN users a ON a.id=COALESCE(s.accountingApprovedById,pb.accountingApprovedById)
    LEFT JOIN users g ON g.id=COALESCE(s.managementApprovedById,pb.managementApprovedById)
    WHERE b.id=${Number(bundle.id)} AND b.status IN ('sent','archived') AND ${approvedBundleCondition()} ORDER BY l.purchaseOrderId`);
  if (!approvals.length) throw Error("الوثيقة المعتمدة متاحة بعد اكتمال اعتماد الإدارة العليا لجميع دفعات الحزمة");
  const expected = new Set(snapshot.rows.map(row => row.purchaseOrderId));
  if (!expected.size || approvals.length !== expected.size || new Set(approvals.map((row: any) => Number(row.purchaseOrderId))).size !== expected.size
    || approvals.some((row: any) => !expected.has(Number(row.purchaseOrderId)))) throw Error("لا تتطابق دفعات الاعتماد مع لقطة حزمة التسعير");
  const groups = new Map<string, NonNullable<PricingBundleSnapshot["financialApprovals"]>[number]>();
  for (const row of approvals) {
    const packaged = row.purchasePackageSubmissionId != null;
    const key = packaged ? `submission:${row.purchasePackageSubmissionId}` : `batch:${row.pricingBatchId}`;
    const existing = groups.get(key);
    if (existing) { existing.poNumbers.push(row.poNumber); continue; }
    const captured = readAccountingSignature(packaged ? row.submissionSignature : row.accountingSignatureSnapshot,
      Number(packaged ? row.submissionAccountingId : row.accountingApprovedById));
    groups.set(key, {
      reference: packaged ? `${row.packageNumber || "PB"}-${row.subNumber}` : `${row.poNumber} / ${row.batchNumber}`,
      poNumbers: [row.poNumber], accountingName: captured?.name || row.accountingName || "غير مسجل",
      accountingAt: String(packaged ? row.submissionAccountingAt : row.accountingApprovedAt),
      accountingSignature: await signature(captured?.signatureUrl || null),
      managementName: row.managementName || "غير مسجل",
      managementAt: String(packaged ? row.submissionManagementAt : row.managementApprovedAt),
      custodyLabel: packaged ? "إجمالي رصيد العهد التي على المندوب" : "مبلغ العهدة المعتمد",
      custodyValue: (packaged ? row.custodyBalance : row.custodyAmount) ?? null,
      notes: packaged ? "" : row.accountingNotes || "",
    });
  }
  return { ...snapshot, financialApprovals: Array.from(groups.values()) };
}
