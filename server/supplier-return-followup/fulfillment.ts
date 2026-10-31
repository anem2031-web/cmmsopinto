import { sql } from "drizzle-orm";
import { decimal4, format4 } from "./amounts";
import { readRows, trialEnabled } from "./runtime";
import type { FollowupTx } from "./commands";

export interface ReplacementLot {
  lotId: number;
  trackingToken: string;
  unit: string;
  issueUnit: string;
  quantity: string;
  originalQuantity: string;
}
export interface ReplacementFulfillment {
  planId: number;
  caseId: number;
  sourceItemId: number;
  sourcePurchaseOrderId: number;
  sourceTicketId: number | null;
  sourceTicketItemId: number | null;
  sourceCatalogItemId: number | null;
  /** The original warehouse return's issue unit, not necessarily the PO unit. */
  sourceUnit: string;
  originalUnit: string;
  quantityCovered: string;
  originalQuantityCovered: string;
  replacementItemId: number;
  replacementPurchaseOrderId: number;
  catalogItemId: number;
  itemName: string;
  replacementUnit: string;
  orderUnit: string;
  replacementQuantity: string;
  orderQuantity: string;
  lots: ReplacementLot[];
}

const positiveId = (value: unknown) => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const invalid = (message: string): never => { throw Error(`تعويض مرتجع المورد: ${message}`); };
const quantity3 = (value: string) => {
  const result = decimal4(value);
  if (result < BigInt(0) || result % BigInt(10)) invalid("دقة الكمية لا تتجاوز ثلاث منازل عشرية");
  return result;
};
const physicalTotal = (plan: ReplacementFulfillment) => {
  if (!plan.lots.length || new Set(plan.lots.map(lot => lot.unit.trim())).size !== 1) invalid("وحدات لوتات البديل غير متوافقة");
  const total = plan.lots.reduce((sum, lot) => sum + quantity3(lot.quantity), BigInt(0));
  if (total <= BigInt(0) || quantity3(plan.originalQuantityCovered) <= BigInt(0)) invalid("كمية التعويض غير صالحة");
  return total;
};
function exactRatio(value: bigint, numerator: bigint, denominator: bigint) {
  const product = value * numerator;
  if (product % denominator) invalid("الكمية الجزئية لا تمثل تعويضًا دقيقًا؛ اختر كمية تحقق النسبة المعتمدة");
  const result = product / denominator;
  if (result % BigInt(10)) invalid("كمية التعويض الناتجة تتجاوز دقة ثلاث منازل عشرية");
  return format4(result).slice(0, -1);
}
/** Physical delivery rows retain their actual unit; only need progress is converted. */
export function replacementPhysicalToOriginal(plan: ReplacementFulfillment, physical: string): string {
  return exactRatio(quantity3(physical), quantity3(plan.originalQuantityCovered), physicalTotal(plan));
}
export function replacementOriginalToPhysical(plan: ReplacementFulfillment, original: string): string {
  return exactRatio(quantity3(original), physicalTotal(plan), quantity3(plan.originalQuantityCovered));
}

/** A source PO may include warehouse extras beyond its assigned need link.
 * Keep the physical plan ratio intact and cap only its eligible need coverage. */
export function limitReplacementSourceCoverage(plans: ReplacementFulfillment[], sourceLinkedQuantity: string) {
  let remaining = quantity3(sourceLinkedQuantity);
  return plans.slice().sort((a, b) => a.planId - b.planId).map(plan => {
    const declared = quantity3(plan.originalQuantityCovered), eligible = remaining < declared ? remaining : declared;
    remaining -= eligible;
    return { ...plan, maximumOriginalQuantity: format4(eligible).slice(0, -1) };
  });
}

/** Select on the exact quantity lattice shared by the actual document and the
 * original need. A smaller valid portion is preferable to taking an available
 * portion whose ratio cannot be represented by the existing quantity fields. */
export function representableReplacementAllocation(plan: ReplacementFulfillment, input: {
  availablePhysical: string; maxOriginal: string; originalStep?: string; physicalStep?: string;
}): { physicalQuantity: string; originalQuantity: string } {
  const physical = physicalTotal(plan), original = quantity3(plan.originalQuantityCovered);
  const requestedAvailable = quantity3(input.availablePhysical), requestedCap = quantity3(input.maxOriginal);
  const available = requestedAvailable < physical ? requestedAvailable : physical;
  const cap = requestedCap < original ? requestedCap : original;
  const physicalStep = quantity3(input.physicalStep ?? "1"), originalStep = quantity3(input.originalStep ?? "0.001");
  if (physicalStep <= BigInt(0) || originalStep <= BigInt(0)) invalid("خطوة الكمية غير صالحة");
  const gcd = (a: bigint, b: bigint): bigint => {
    while (b !== BigInt(0)) { const remainder = a % b; a = b; b = remainder; }
    return a;
  };
  const lattice = physicalStep * (physical * originalStep / gcd(physicalStep * original, physical * originalStep));
  const byOriginal = cap * physical / original;
  const bound = available < byOriginal ? available : byOriginal;
  const selected = bound / lattice * lattice;
  return { physicalQuantity: format4(selected).slice(0, -1), originalQuantity: format4(selected * original / physical).slice(0, -1) };
}

export function replacementAllocationQuantum(plan: ReplacementFulfillment, input: { originalStep?: string; physicalStep?: string } = {}) {
  const selected = representableReplacementAllocation(plan, { availablePhysical: format4(physicalTotal(plan)),
    maxOriginal: plan.originalQuantityCovered, ...input });
  const fullPhysical = physicalTotal(plan), fullOriginal = quantity3(plan.originalQuantityCovered);
  const p = quantity3(input.physicalStep ?? "1"), o = quantity3(input.originalStep ?? "0.001");
  let a = p * fullOriginal, b = fullPhysical * o;
  while (b) { const r = a % b; a = b; b = r; }
  const quantum = p * (fullPhysical * o / a);
  return { physicalQuantity: format4(quantum).slice(0, -1), originalQuantity: format4(quantum * fullOriginal / fullPhysical).slice(0, -1),
    feasible: quantity3(selected.physicalQuantity) > BigInt(0) };
}

/** Bounded exact fill across approved plans and ordinary stock. Counts jump by
 * the suffix congruence, not one physical unit at a time. No quantity is rounded
 * into coverage; an exhausted search is an explicit review error. */
export function exactOriginalAllocation(target: string, candidates: Array<{ maximum: string; quantum: string }>, options: { maxStates?: number } = {}): string[] | null {
  const required = quantity3(target), selected = candidates.map(() => BigInt(0));
  const gcd = (a: bigint, b: bigint) => { while (b) { const r = a % b; a = b; b = r; } return a; };
  const active = candidates.map((candidate, index) => {
    const quantum = quantity3(candidate.quantum), declared = quantity3(candidate.maximum);
    if (quantum <= BigInt(0)) invalid("خطوة توزيع الاحتياج غير صالحة");
    const bounded = declared < required ? declared : required;
    return { index, quantum, maximum: bounded / quantum * quantum };
  }).filter(candidate => candidate.maximum > BigInt(0));
  const maxima = Array<bigint>(active.length + 1).fill(BigInt(0)), divisors = Array<bigint>(active.length + 1).fill(BigInt(0));
  for (let i = active.length - 1; i >= 0; i--) { maxima[i] = maxima[i + 1] + active[i].maximum; divisors[i] = gcd(active[i].quantum, divisors[i + 1]); }
  const inverse = (value: bigint, modulus: bigint) => {
    let a = value, b = modulus, x = BigInt(1), y = BigInt(0);
    while (b) { const q = a / b; [a, b] = [b, a - q * b]; [x, y] = [y, x - q * y]; }
    return ((x % modulus) + modulus) % modulus;
  };
  const limit = options.maxStates ?? 10000;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) invalid("حد مراجعة التوزيع غير صالح");
  let visits = 0;
  const failed = new Set<string>();
  function solve(index: number, left: bigint): boolean {
    if (++visits > limit) invalid("توزيع البدائل معقد؛ يلزم مراجعة توزيع اللوتات قبل الصرف");
    if (left === BigInt(0)) return true;
    if (index >= active.length || left > maxima[index] || left % divisors[index]) return false;
    const key = `${index}:${left}`;
    if (failed.has(key)) return false;
    const candidate = active[index], q = candidate.quantum;
    if (index === active.length - 1) {
      if (left > candidate.maximum || left % q) return false;
      selected[candidate.index] = left; return true;
    }
    const divisor = divisors[index + 1], common = gcd(q, divisor);
    if (left % common) return false;
    const period = divisor / common;
    const residue = period === BigInt(1) ? BigInt(0) : (left / common * inverse(q / common, period)) % period;
    const upper = (candidate.maximum < left ? candidate.maximum : left) / q;
    const deficit = left - maxima[index + 1];
    const lower = deficit > BigInt(0) ? (deficit + q - BigInt(1)) / q : BigInt(0);
    let count = upper - ((upper - residue) % period + period) % period;
    for (; count >= lower; count -= period) {
      selected[candidate.index] = count * q;
      if (solve(index + 1, left - count * q)) return true;
    }
    selected[candidate.index] = BigInt(0); failed.add(key); return false;
  }
  return solve(0, required) ? selected.map(value => format4(value).slice(0, -1)) : null;
}

/** Provenance-only lookup. Actor/resource permission must be checked by the caller;
 * no identity or authorization snapshot is cached across operations. */
export async function loadReplacementFulfillments(tx: FollowupTx, sourceItemIds: number[]): Promise<Map<number, ReplacementFulfillment[]>> {
  const result = new Map<number, ReplacementFulfillment[]>();
  const ids = Array.from(new Set(sourceItemIds));
  if (!ids.length) return result;
  if (ids.some(id => !positiveId(id))) invalid("مرجع بند الشراء غير صالح");
  if (!await trialEnabled(tx)) return result;
  for (let offset = 0; offset < ids.length; offset += 500) {
    const included = new Set(ids.slice(offset, offset + 500));
    const rows = await readRows(tx, sql`SELECT p.id AS planId,p.caseId,c.purchaseOrderItemId AS sourceItemId,c.purchaseOrderId AS sourcePurchaseOrderId,
        source.catalogItemId AS sourceCatalogItemId,sourceOrder.ticketId AS sourceTicketId,sourceOrder.ticketItemId AS sourceTicketItemId,c.returnedUnit AS sourceUnit,p.originalQuantityCovered,
        p.purchaseOrderItemId AS replacementItemId,p.purchaseOrderId AS replacementPurchaseOrderId,
        p.catalogItemId,p.itemName,p.replacementUnit,p.replacementQuantity,
        link.id AS receiptLinkId,link.receivedQuantity,link.receivedUnit,link.compensatedOriginalQuantity,link.originalUnit,
        l.id AS lotId,l.trackingToken,l.issueUnit,l.originalQuantity AS lotQuantity
      FROM supplier_return_cases c
      INNER JOIN purchase_order_items source ON source.id=c.purchaseOrderItemId AND source.purchaseOrderId=c.purchaseOrderId
      INNER JOIN purchase_orders sourceOrder ON sourceOrder.id=source.purchaseOrderId
      INNER JOIN supplier_return_replacement_plans p ON p.caseId=c.id AND p.status='received'
      INNER JOIN purchase_order_items replacement ON replacement.id=p.purchaseOrderItemId AND replacement.purchaseOrderId=p.purchaseOrderId
        AND replacement.catalogItemId=p.catalogItemId
      INNER JOIN supplier_return_replacement_links link ON link.caseId=c.id AND link.purchaseOrderItemId=p.purchaseOrderItemId AND link.purchaseOrderId=p.purchaseOrderId
      INNER JOIN inventory_lots l ON l.id=link.lotId AND l.purchaseOrderItemId=p.purchaseOrderItemId
        AND l.receiptId=link.receiptId AND l.receiptItemId=link.receiptItemId AND l.catalogItemId=p.catalogItemId AND l.sourceType='receipt'
      INNER JOIN warehouse_receipt_items receipt ON receipt.id=link.receiptItemId AND receipt.receiptId=link.receiptId AND receipt.purchaseOrderItemId=p.purchaseOrderItemId
      WHERE c.handoverStatus='accepted' AND c.purchaseOrderItemId IN (${sql.join(ids.slice(offset, offset + 500).map(id => sql`${id}`), sql`,`)})
      ORDER BY p.id,link.id`);
    const byPlan = new Map<number, { plan: ReplacementFulfillment; received: bigint; covered: bigint; links: Set<number>; lots: Set<number> }>();
    for (const row of rows) {
      if (!included.has(Number(row.sourceItemId))) invalid("مصدر البديل خارج نطاق الاحتياج المطلوب");
      if (![row.planId, row.caseId, row.sourceItemId, row.replacementItemId, row.catalogItemId, row.lotId, row.receiptLinkId].every(positiveId)) invalid("رابط الاستلام غير صالح");
      let entry = byPlan.get(Number(row.planId));
      if (!entry) {
        const plan: ReplacementFulfillment = {
          planId: Number(row.planId), caseId: Number(row.caseId), sourceItemId: Number(row.sourceItemId),
          sourcePurchaseOrderId: Number(row.sourcePurchaseOrderId), sourceCatalogItemId: row.sourceCatalogItemId == null ? null : Number(row.sourceCatalogItemId),
          sourceTicketId: row.sourceTicketId == null ? null : Number(row.sourceTicketId), sourceTicketItemId: row.sourceTicketItemId == null ? null : Number(row.sourceTicketItemId),
          sourceUnit: String(row.sourceUnit).trim(), originalUnit: String(row.sourceUnit).trim(),
          quantityCovered: String(row.originalQuantityCovered), originalQuantityCovered: String(row.originalQuantityCovered),
          replacementItemId: Number(row.replacementItemId), replacementPurchaseOrderId: Number(row.replacementPurchaseOrderId),
          catalogItemId: Number(row.catalogItemId), itemName: String(row.itemName),
          replacementUnit: String(row.replacementUnit).trim(), orderUnit: String(row.replacementUnit).trim(),
          replacementQuantity: String(row.replacementQuantity), orderQuantity: String(row.replacementQuantity), lots: [],
        };
        if (!plan.sourceUnit || !plan.replacementUnit) invalid("وحدة التعويض غير محددة");
        entry = { plan, received: BigInt(0), covered: BigInt(0), links: new Set(), lots: new Set() };
        byPlan.set(plan.planId, entry);
      }
      if (entry.links.has(Number(row.receiptLinkId)) || entry.lots.has(Number(row.lotId))) invalid("لوت البديل مرتبط أكثر من مرة");
      if (String(row.receivedUnit).trim() !== entry.plan.orderUnit || String(row.originalUnit).trim() !== entry.plan.originalUnit || !String(row.issueUnit ?? "").trim() || !row.trackingToken) invalid("وحدة استلام البديل لا تطابق الخطة");
      entry.links.add(Number(row.receiptLinkId)); entry.lots.add(Number(row.lotId));
      entry.received += quantity3(String(row.receivedQuantity)); entry.covered += quantity3(String(row.compensatedOriginalQuantity));
      entry.plan.lots.push({ lotId: Number(row.lotId), trackingToken: String(row.trackingToken), unit: String(row.issueUnit).trim(), issueUnit: String(row.issueUnit).trim(), quantity: String(row.lotQuantity), originalQuantity: String(row.lotQuantity) });
    }
    for (const { plan, received, covered } of Array.from(byPlan.values())) {
      if (received !== quantity3(plan.orderQuantity) || covered !== quantity3(plan.originalQuantityCovered)) invalid("روابط الاستلام لا تغطي خطة البديل كاملة");
      physicalTotal(plan);
      const values = result.get(plan.sourceItemId) ?? []; values.push(plan); result.set(plan.sourceItemId, values);
    }
  }
  return result;
}
