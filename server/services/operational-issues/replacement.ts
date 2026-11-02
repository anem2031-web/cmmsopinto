import { sql } from "drizzle-orm";
import type { OperationalLine, OperationalStock, OperationalLotChoice } from "../../../shared/operational-issues";
import { allocateOperationalFifo } from "../../../shared/operational-dispatch";
import { dispatchContext } from "../../../shared/operational-dispatch";
import { exactOriginalAllocation, loadReplacementFulfillments, replacementAllocationQuantum, replacementOriginalToPhysical, replacementPhysicalToOriginal, representableReplacementAllocation, type ReplacementFulfillment } from "../../supplier-return-followup/fulfillment";
import { trialEnabled } from "../../supplier-return-followup/runtime";
import { decimal4 } from "../../supplier-return-followup/amounts";
async function rows(tx: any, query: any): Promise<any[]> {
  const [value] = await tx.execute(query);
  if (!Array.isArray(value)) throw Error("Invalid operational replacement read response");
  return value;
}

type LineReplacement = { line: OperationalLine; plans: ReplacementFulfillment[]; issued: number; originalIssued: number; physicalIssued: Map<number, number> };
export type OperationalReplacements = Map<number, LineReplacement>;
const precision = (n: number) => Math.round(n * 1000);
const fail = (message: string): never => { throw new Error(`تعويض الصرف التشغيلي: ${message}`); };
const identifiers = (ids: number[]) => sql.join(ids.map(id => sql`${id}`), sql`,`);
const totalPhysical = (plan: ReplacementFulfillment) => plan.lots.reduce((sum, lot) => sum + Number(lot.quantity), 0);
export async function operationalReplacementTablesReady(tx: any): Promise<boolean> {
  const tables = await rows(tx, sql`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
    AND TABLE_NAME IN ('supplier_return_cases','supplier_return_replacement_plans','supplier_return_replacement_links','operational_issue_purchase_links')`);
  const names = new Set(tables.map(row => row.TABLE_NAME));
  return ["supplier_return_cases", "supplier_return_replacement_plans", "supplier_return_replacement_links", "operational_issue_purchase_links"].every(name => names.has(name));
}

/** Optional layer: old installations and ordinary operational orders retain
 * their physical writers. Source and approval decisions are never cached. */
export async function loadOperationalReplacements(tx: any, lines: OperationalLine[]): Promise<OperationalReplacements> {
  const result: OperationalReplacements = new Map();
  if (!lines.length) return result;
  if (!await operationalReplacementTablesReady(tx)) return result;
  if (!await trialEnabled(tx)) return result;
  const ids = Array.from(new Set(lines.map(line => Number(line.id))));
  const links: any[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) links.push(...await rows(tx, sql`SELECT k.orderItemId,k.purchaseOrderId,k.purchaseOrderItemId,k.quantity,k.unit,
      original.orderId AS operationalOrderId,o.id AS operationalOrderExists,o.siteId AS operationalSiteId,o.sectionId AS operationalSectionId,
      source.id AS sourceItemExists,p.id AS sourceOrderExists,p.ticketId AS sourceTicketId,p.ticketItemId AS sourceTicketItemId,
      COALESCE(source.siteId,p.siteId) AS sourceSiteId,COALESCE(source.sectionId,p.sectionId) AS sourceSectionId,
      EXISTS(SELECT 1 FROM supplier_return_cases returned INNER JOIN supplier_return_replacement_plans substitute ON substitute.caseId=returned.id
        WHERE returned.purchaseOrderItemId=k.purchaseOrderItemId AND returned.purchaseOrderId=k.purchaseOrderId
          AND returned.handoverStatus='accepted' AND substitute.status='received') AS hasReplacement
    FROM operational_issue_purchase_links k LEFT JOIN operational_issue_items original ON original.id=k.orderItemId
    LEFT JOIN operational_issue_orders o ON o.id=original.orderId
    LEFT JOIN purchase_order_items source ON source.id=k.purchaseOrderItemId AND source.purchaseOrderId=k.purchaseOrderId
    LEFT JOIN purchase_orders p ON p.id=k.purchaseOrderId
    WHERE k.orderItemId IN (${identifiers(ids.slice(offset, offset + 500))})`));
  const expectedContexts = links.filter(link => Number(link.hasReplacement) === 1).map(link => {
    const line = lines.find(line => Number(line.id) === Number(link.orderItemId));
    const context = line && dispatchContext(line.dispatchContext);
    const expectedSiteId = context?.siteId ?? Number(link.operationalSiteId);
    const expectedSectionId = context?.sectionId ?? Number(link.operationalSectionId);
    if (!line || Number(link.operationalOrderId) !== Number(line.orderId) || Number(link.operationalOrderExists) !== Number(line.orderId)
      || Number(link.sourceItemExists) !== Number(link.purchaseOrderItemId) || Number(link.sourceOrderExists) !== Number(link.purchaseOrderId)
      || link.sourceTicketId != null || link.sourceTicketItemId != null
      || Number(link.sourceSiteId) !== expectedSiteId || Number(link.sourceSectionId) !== expectedSectionId)
      fail("سياق طلب الشراء أو ارتباطه لم يعد يطابق أمر الصرف الأصلي");
    return { siteId: expectedSiteId, sectionId: expectedSectionId };
  });
  const sectionIds = Array.from(new Set(expectedContexts.map(context => context.sectionId)));
  const scopes: any[] = [];
  for (let offset = 0; offset < sectionIds.length; offset += 500) scopes.push(...await rows(tx, sql`SELECT s.id,s.siteId FROM sections s
    INNER JOIN sites t ON t.id=s.siteId WHERE s.id IN (${identifiers(sectionIds.slice(offset, offset + 500))})`));
  if (expectedContexts.some(context => !scopes.some(scope => Number(scope.id) === context.sectionId && Number(scope.siteId) === context.siteId)))
    fail("موقع أو قسم الاحتياج الأصلي لم يعد متاحًا");
  const plans = await loadReplacementFulfillments(tx, Array.from(new Set(links.map(link => Number(link.purchaseOrderItemId)))));
  for (const line of lines) {
    const link = links.find(link => Number(link.orderItemId) === Number(line.id));
    const replacements: ReplacementFulfillment[] | undefined = link ? plans.get(Number(link.purchaseOrderItemId)) : undefined;
    if (!replacements?.length) {
      if (link && Number(link.hasReplacement) === 1) fail("خطة تعويض الاحتياج أو روابط استلامها غير متاحة");
      continue;
    }
    if (replacements.some(plan => plan.sourceCatalogItemId !== Number(line.catalogItemId)
      || plan.sourcePurchaseOrderId !== Number(link.purchaseOrderId) || plan.sourceUnit.trim() !== line.unit.trim())
      || String(link.unit).trim() !== line.unit.trim()
      || replacements.reduce((sum, plan) => sum + precision(Number(plan.quantityCovered)), 0) > precision(Math.min(Number(line.quantity), Number(link.quantity)))) fail("رابط البديل أو وحدته لا يطابق الاحتياج الأصلي");
    result.set(Number(line.id), { line, plans: replacements, issued: 0, originalIssued: 0, physicalIssued: new Map() });
  }
  if (!result.size) return result;
  const deliveryRows: any[] = [], involved = Array.from(result.keys());
  for (let offset = 0; offset < involved.length; offset += 500) deliveryRows.push(...await rows(tx, sql`SELECT x.orderItemId,x.quantity,d.lotId,d.unit,COALESCE(l.catalogItemId,i.linkedItemId) AS catalogItemId
    FROM operational_issue_deliveries x INNER JOIN delivery_documents d ON d.id=x.deliveryDocumentId
    LEFT JOIN inventory_lots l ON l.id=d.lotId LEFT JOIN inventory i ON i.id=d.inventoryId
    WHERE x.orderItemId IN (${identifiers(involved.slice(offset, offset + 500))}) ORDER BY x.id`));
  for (const delivery of deliveryRows) {
    const target = result.get(Number(delivery.orderItemId))!;
    const plan = target.plans.find(plan => plan.lots.some(lot => lot.lotId === Number(delivery.lotId)));
    const physical = Number(delivery.quantity);
    if (!Number.isFinite(physical) || physical <= 0) fail("كمية سند الصرف غير صالحة");
    if (plan) {
      const lot = plan.lots.find(lot => lot.lotId === Number(delivery.lotId))!;
      if (String(delivery.unit).trim() !== lot.unit || Number(delivery.catalogItemId) !== plan.catalogItemId) fail("هوية سند البديل لا تطابق اللوت المعتمد");
      target.physicalIssued.set(plan.planId, (target.physicalIssued.get(plan.planId) || 0) + physical);
      target.issued += Number(replacementPhysicalToOriginal(plan, String(physical)));
    } else {
      if (String(delivery.unit).trim() !== target.line.unit.trim() || Number(delivery.catalogItemId) !== Number(target.line.catalogItemId)) fail("سند صرف غير مرتبط بالاحتياج أو البديل المعتمد");
      target.originalIssued += physical; target.issued += physical;
    }
  }
  for (const target of Array.from(result.values())) {
    target.plans.sort((a, b) => a.planId - b.planId);
    if (precision(target.issued) > precision(Number(target.line.quantity))
      || target.plans.some(plan => precision(target.physicalIssued.get(plan.planId) || 0) > precision(totalPhysical(plan)))) fail("تجاوزت سندات الصرف كمية التعويض المعتمدة");
  }
  return result;
}

/** Delivery documents use integer physical quantities. Choose the largest such
 * quantity whose original equivalent is representable at the need's 3dp;
 * no rounding up of either stock or fulfillment. */
export function assignableOperationalReplacement(plan: ReplacementFulfillment, unmet: number, availablePhysical: number): number {
  if (unmet <= 0 || availablePhysical <= 0) return 0;
  const whole = BigInt(10000), total = decimal4(totalPhysical(plan).toFixed(3)), covered = decimal4(plan.quantityCovered);
  const requested = decimal4(unmet.toFixed(3));
  let a = total, b = whole * covered;
  while (b !== BigInt(0)) { const next = a % b; a = b; b = next; }
  const step = total / a;
  const byNeed = requested * total / covered / whole;
  const byStock = BigInt(Math.floor(availablePhysical));
  const maximum = byNeed < byStock ? byNeed : byStock;
  return Number(maximum / step * step);
}

export function replacementStockLines(replacements: OperationalReplacements): OperationalLine[] {
  return Array.from(replacements.values()).flatMap(target => target.plans.map(plan => ({ ...target.line,
    id: -plan.planId, catalogItemId: plan.catalogItemId, itemName: plan.itemName,
    quantity: totalPhysical(plan), unit: plan.lots[0].unit, issuedQuantity: target.physicalIssued.get(plan.planId) || 0 })));
}

/** A fractional remainder in the oldest lot blocks consuming later lots. The
 * integer prefix is still issuable without rounding or skipping that lot. */
function fifoPhysicalCapacity(stock: OperationalStock): number {
  if (stock.needsReview) return 0;
  let capacity = 0;
  for (const lot of [...stock.lots].sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)) || a.lotId - b.lotId || a.inventoryId - b.inventoryId)) {
    const milli = Math.round(lot.quantity * 1000), whole = Math.floor(milli / 1000);
    capacity += whole;
    if (milli % 1000 !== 0) break;
  }
  return Math.min(capacity, Math.floor(stock.totalQuantity));
}

/** Response quantities remain original-need quantities; each allocation retains
 * its actual physical unit and lot. Both clients and the server use this plan. */
export function applyOperationalReplacementStock(stocks: OperationalStock[], physicalStocks: OperationalStock[], replacements: OperationalReplacements): OperationalStock[] {
  const reservedLots = Array.from(replacements.values()).flatMap(target => target.plans.flatMap(plan => plan.lots.map(lot => lot.lotId)));
  if (new Set(reservedLots).size !== reservedLots.length) fail("لوت البديل مرتبط بأكثر من احتياج");
  return stocks.map(stock => {
    const target = replacements.get(stock.itemId);
    if (!target) return stock;
    const unmet = Math.max(0, Number(target.line.quantity) - target.issued);
    const allocations: OperationalLotChoice[] = [];
    const lots: OperationalLotChoice[] = [];
    let available = 0, ready = true, needsReview = false;
    const planStocks: Array<{ plan: ReplacementFulfillment; stock: OperationalStock; maximum: string; quantum: string }> = [];
    const originalLots = stock.lots.filter(lot => !reservedLots.includes(lot.lotId));
    if (!stock.needsReview && unmet > 0) {
      lots.push(...originalLots.map(lot => ({ ...lot, quantity: Math.min(lot.quantity, unmet) })));
      available += Math.min(unmet, originalLots.reduce((sum, lot) => sum + lot.quantity, 0));
    }
    for (const plan of target.plans) {
      const physical = physicalStocks.find(stock => stock.itemId === -plan.planId);
      const remaining = totalPhysical(plan) - (target.physicalIssued.get(plan.planId) || 0);
      if (remaining <= 0 || unmet <= 0) continue;
      const choices = (physical?.lots || []).filter(lot => plan.lots.some(allowed => allowed.lotId === lot.lotId && allowed.trackingToken === lot.trackingToken && allowed.unit === lot.unit))
        .map(lot => ({ ...lot, quantity: Math.min(lot.quantity, assignableOperationalReplacement(plan, unmet, remaining)), replacementName: plan.itemName,
          originalPerUnit:Number(plan.originalQuantityCovered)/totalPhysical(plan),coverageKey:String(plan.planId),coverageLimit:Math.min(unmet,Number(plan.originalQuantityCovered)-Number(replacementPhysicalToOriginal(plan,String(target.physicalIssued.get(plan.planId)||0)))) }));
      lots.push(...choices);
      const count = choices.reduce((sum, lot) => sum + lot.quantity, 0);
      const availablePhysical = assignableOperationalReplacement(plan, unmet, Math.min(count, remaining));
      if (!physical?.needsReview) available += Number(replacementPhysicalToOriginal(plan, String(availablePhysical)));
      const selected = { itemId: stock.itemId, unit: plan.lots[0].unit, lots: choices,
        totalQuantity: count, needsReview: physical?.needsReview ?? true, purchase: null };
      const cap = representableReplacementAllocation(plan, {
        availablePhysical: Math.min(fifoPhysicalCapacity(selected), remaining).toFixed(3), maxOriginal: unmet.toFixed(3), originalStep: "1", physicalStep: "1",
      });
      const quantum = replacementAllocationQuantum(plan, { originalStep: "1", physicalStep: "1" });
      planStocks.push({ plan, stock: selected, maximum: quantum.feasible ? cap.originalQuantity : "0", quantum: quantum.originalQuantity });
    }
    const original = { ...stock, totalQuantity: originalLots.reduce((sum, lot) => sum + lot.quantity, 0), lots: originalLots };
    const originalMaximum = Math.min(unmet, fifoPhysicalCapacity(original));
    const solution = exactOriginalAllocation(unmet.toFixed(3), [...planStocks.map(candidate => ({ maximum: candidate.maximum, quantum: candidate.quantum })),
      { maximum: originalMaximum.toFixed(3), quantum: "1" }]);
    if (!solution) {
      ready = false; needsReview = original.needsReview || planStocks.some(candidate => candidate.stock.needsReview);
    } else {
      try {
        for (let index = 0; index < planStocks.length; index++) if (Number(solution[index]) > 0) {
          const candidate = planStocks[index];
          const physical = Number(replacementOriginalToPhysical(candidate.plan, solution[index]));
          allocations.push(...allocateOperationalFifo(candidate.stock, physical));
        }
        const originalQuantity = Number(solution[planStocks.length]);
        if (originalQuantity > 0) allocations.push(...allocateOperationalFifo(original, originalQuantity));
      } catch { ready = false; }
    }
    return { ...stock, lots, totalQuantity: Number(Math.min(unmet, available).toFixed(3)), needsReview,
      fulfillment: { remainingOriginalQuantity: Number(unmet.toFixed(3)), ready,
        allocations, replacements: target.plans.map(plan => ({ planId: plan.planId, purchaseOrderId: plan.replacementPurchaseOrderId, itemName: plan.itemName, quantity: totalPhysical(plan), unit: plan.lots[0].unit })) } };
  });
}

export async function assertOperationalReplacementIdentity(tx: any, line: OperationalLine, input: { catalogItemId: number | null; lotTrackingToken?: string; unit?: string; quantity: number }) {
  const targets = await loadOperationalReplacements(tx, [line]);
  const target = targets.get(Number(line.id));
  if (!target) {
    if (Number(line.catalogItemId) !== input.catalogItemId) fail("اللوت لا يطابق صنف أمر الصرف");
    if (input.unit && input.unit.trim() !== line.unit.trim()) fail("وحدة اللوت لا تطابق وحدة أمر الصرف؛ لا يتم تحويل الكمية تلقائيًا");
    return null;
  }
  const plan = target.plans.find(plan => plan.lots.some(lot => lot.trackingToken === input.lotTrackingToken));
  const remaining = Number(line.quantity) - target.issued;
  if (plan) {
    const lot = plan.lots.find(lot => lot.trackingToken === input.lotTrackingToken)!;
    if (plan.catalogItemId !== input.catalogItemId || (input.unit && input.unit.trim() !== lot.unit)) fail("الصنف أو الوحدة لا يطابقان البديل المعتمد");
    if (precision((target.physicalIssued.get(plan.planId) || 0) + input.quantity) > precision(totalPhysical(plan))
      || precision(Number(replacementPhysicalToOriginal(plan, String(input.quantity)))) > precision(remaining)) fail("الكمية تتجاوز المتبقي من البديل المعتمد");
  } else {
    if (Number(line.catalogItemId) !== input.catalogItemId || (input.unit && input.unit.trim() !== line.unit.trim())
      || precision(input.quantity) > precision(remaining)) fail("اللوت أو الكمية لا يطابقان الجزء الأصلي المتبقي من الاحتياج");
  }
  return target;
}
