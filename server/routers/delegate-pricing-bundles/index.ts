import * as db from "../../_core/db";
import { createPricingBundlesRouter } from "./router";
import { pricingBundlesEnabled } from "../../services/delegate-pricing-bundles/reservations";
import { submitPricedBatchForPO, finalizePricedBatchForPO } from "../purchase/purchase-orders.router";
import { generatePurchaseRequestPDF } from "../../services/export/exportService";
import { getSignatureDataUrl } from "../../services/pdf/signatureImage";
import { unifiedApprovalPorts } from "./unified-ports";
import { UnifiedBundleApprovalService } from "../../services/delegate-pricing-bundles/unified-approval";
import { unifiedBundleApprovalsEnabled } from "../../services/delegate-pricing-bundles/unified-feature";
import { syncPathBTicketFromPurchaseOrder } from "../purchase/ticket-purchase-workflow";
import { sql } from "drizzle-orm";
import type { PricingBundlePorts } from "../../services/delegate-pricing-bundles/service";
import { createApprovedPricingDocumentsRouter } from "./approved-reader.router";
import { readFixedApprovedDocument } from "../../services/delegate-pricing-bundles/fixed-approved-document";
const pricingBundlePorts: PricingBundlePorts = {
  database: async () => { const database = await db.getDb(); if (!database) throw new Error("قاعدة البيانات غير متاحة"); return database; },
  submitPO: submitPricedBatchForPO,
  createPackageSubmission: db.createPurchasePackageSubmission,
  render: snapshot => generatePurchaseRequestPDF(0, snapshot.delegate.id, undefined, undefined, snapshot),
  fixedApprovedPdf: readFixedApprovedDocument,
  signature: getSignatureDataUrl,
  unified:unifiedApprovalPorts,
  finishUnifiedSend:async(actor,id)=>{
    const database=await unifiedApprovalPorts.database();const [existing]=await database.execute(sql`SELECT bundleId FROM delegate_pricing_bundle_approvals WHERE bundleId=${id}`);
    if((existing as any[]).length)await new UnifiedBundleApprovalService(unifiedApprovalPorts).finish(actor,id,'send');
  },
  sync: async (poId, actorId, batchId) => {
    const [po, batch, actor] = await Promise.all([db.getPurchaseOrderById(poId), db.getPOPricingBatchById(batchId), db.getUserById(actorId)]);
    if (!po || !batch || batch.purchaseOrderId !== poId || batch.submittedById !== actorId || !actor) throw new Error("تعذر استكمال توثيق دفعة التسعير");
    const items = (await db.getPOItems(poId)).filter((item: any) => item.batchId === batchId);
    if(unifiedBundleApprovalsEnabled()){
      const database=await unifiedApprovalPorts.database();const [managed]=await database.execute(sql`SELECT a.bundleId FROM delegate_pricing_bundle_approvals a JOIN delegate_pricing_bundle_batches l ON l.bundleId=a.bundleId WHERE l.pricingBatchId=${batchId} LIMIT 1`);
      if((managed as any[]).length){await syncPathBTicketFromPurchaseOrder(poId,actorId,'تم إرسال حزمة التسعير إلى الحسابات');return;}
    }
    await finalizePricedBatchForPO(poId, actor, po, batchId, batch.batchNumber, items);
  },
};
export const delegatePricingBundlesRouter = createPricingBundlesRouter(pricingBundlePorts, pricingBundlesEnabled);
export const approvedPricingDocumentsRouter = createApprovedPricingDocumentsRouter(pricingBundlePorts, pricingBundlesEnabled);
