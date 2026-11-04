import { sql } from "drizzle-orm";
import { loadReplacementFulfillments, replacementCoverageLimit, replacementPhysicalToOriginal,representableReplacementAllocation,replacementAllocationQuantum,exactOriginalAllocation, type ReplacementFulfillment } from "../../supplier-return-followup/fulfillment";
import { readRows,trialEnabled } from "../../supplier-return-followup/runtime";
import type { FollowupTx } from "../../supplier-return-followup/commands";
import { decimal4, format4 } from "../../supplier-return-followup/amounts";
import { getPmv2MaterialQuantityValidationMessage,pmv2MaterialUnitRequiresWholeQuantity } from "../../../shared/pmv2MaterialQuantity";
import { loadActiveCompensationCases } from "../../supplier-return-followup/active-cases";

export type Pmv2Replacement = { requestItemId: number; plan: ReplacementFulfillment; maximumOriginalQuantity: number };
export class Pmv2ReplacementCoverageError extends Error {}
export type Pmv2ReplacementStock = { lotId:number;inventoryId:number;warehouseId:number;catalogItemId:number;unit:string;quantity:number;lotCode:string;trackingToken:string };

/** Select exact physical document quantities below both stock and need caps.
 * Never round a physical balance or invent fractional original progress. */
export function planPmv2ReplacementLots(replacement:Pmv2Replacement,stock:Pmv2ReplacementStock[],maximumOriginal:number,originalUnit:string,alreadyAllocated=0) {
  if(replacement.plan.originalUnit.trim()!==originalUnit.trim()) throw new Pmv2ReplacementCoverageError("وحدة تعويض المرتجع لا تطابق الاحتياج الأصلي");
  let budget=Math.max(0,Math.min(maximumOriginal,Number((replacement.maximumOriginalQuantity-alreadyAllocated).toFixed(3))));
  const allocations:Array<Pmv2ReplacementStock&{originalQuantity:number;replacementPlanId:number}>=[];
  let unrepresentable=false;
  for(const lot of stock) {
    if(budget<=0) break;
    if(!replacement.plan.lots.some(source=>source.lotId===lot.lotId&&source.unit.trim()===lot.unit.trim())||lot.catalogItemId!==replacement.plan.catalogItemId) throw new Pmv2ReplacementCoverageError("مخزون البديل لا يطابق لوتات الخطة المعتمدة");
    const selected=representableReplacementAllocation(replacement.plan,{availablePhysical:String(lot.quantity),maxOriginal:String(budget),originalStep:pmv2MaterialUnitRequiresWholeQuantity(originalUnit)?"1":"0.001",physicalStep:"1"});
    if(Number(selected.physicalQuantity)<=0){unrepresentable ||=lot.quantity>0;continue;}
    const originalQuantity=Number(selected.originalQuantity);
    allocations.push({...lot,quantity:Number(selected.physicalQuantity),originalQuantity,replacementPlanId:replacement.plan.planId});
    budget=Number((budget-originalQuantity).toFixed(3));
  }
  return{allocations,originalCovered:Number(allocations.reduce((sum,part)=>sum+part.originalQuantity,0).toFixed(3)),unrepresentable};
}

/** Solve the whole original need before selecting physical lots. A valid later
 * plan must not be blocked by greedily consuming an incompatible earlier one. */
export function planPmv2Fulfillment(input:{requiredOriginal:number;originalUnit:string;originalStock:Pmv2ReplacementStock[];replacements:Array<{replacement:Pmv2Replacement;stock:Pmv2ReplacementStock[];alreadyAllocated?:number}>}) {
  const originalStep=pmv2MaterialUnitRequiresWholeQuantity(input.originalUnit)?"1":"0.001";
  const usedLots=new Set<number>();
  for(const lot of [...input.originalStock,...input.replacements.flatMap(group=>group.stock)]) {
    if(usedLots.has(lot.lotId)) throw new Pmv2ReplacementCoverageError("لوت واحد مكرر في مصادر تغطية احتياج PMV2");
    usedLots.add(lot.lotId);
  }
  const originalCap=input.originalStock.reduce((sum,lot)=>{
    if(lot.unit.trim()!==input.originalUnit.trim()) throw new Pmv2ReplacementCoverageError("وحدة مخزون الصنف الأصلي لا تطابق احتياج PMV2");
    return sum+decimal4(String(lot.quantity))/decimal4("1")*decimal4("1");
  },BigInt(0));
  const groups=input.replacements.map(group=>({...group,capacity:planPmv2ReplacementLots(group.replacement,group.stock,input.requiredOriginal,input.originalUnit,group.alreadyAllocated??0)}));
  const candidates=[{maximum:format4(originalCap),quantum:"1"},...groups.map(group=>({maximum:String(group.capacity.originalCovered),quantum:replacementAllocationQuantum(group.replacement.plan,{originalStep,physicalStep:"1"}).originalQuantity}))];
  const availableOriginal=Number(format4(candidates.reduce((sum,candidate)=>sum+decimal4(candidate.maximum),BigInt(0))));
  const chosen=exactOriginalAllocation(String(input.requiredOriginal),candidates);
  if(!chosen) return{allocations:[] as Array<Pmv2ReplacementStock&{originalQuantity:number;replacementPlanId?:number}>,complete:false,originalCovered:0,availableOriginal,unrepresentable:availableOriginal>=input.requiredOriginal||groups.some(group=>group.capacity.unrepresentable)};
  const allocations:Array<Pmv2ReplacementStock&{originalQuantity:number;replacementPlanId?:number}>=[];
  let ordinary=decimal4(chosen[0]);
  for(const lot of input.originalStock) {
    const cap=decimal4(String(lot.quantity))/decimal4("1")*decimal4("1"),take=ordinary<cap?ordinary:cap;
    if(take>BigInt(0)){const quantity=Number(format4(take));allocations.push({...lot,quantity,originalQuantity:quantity});ordinary-=take;}
  }
  groups.forEach((group,index)=>{
    const target=Number(chosen[index+1]);if(target<=0)return;
    const selected=planPmv2ReplacementLots(group.replacement,group.stock,target,input.originalUnit,group.alreadyAllocated??0);
    if(Math.abs(selected.originalCovered-target)>.0005) throw new Pmv2ReplacementCoverageError("تعذر توزيع قرار التغطية على لوتات البديل دون تقريب");
    allocations.push(...selected.allocations);
  });
  return{allocations,complete:true,originalCovered:input.requiredOriginal,availableOriginal,unrepresentable:false};
}

/** This is provenance, never authorization. Call only after the PMV2 request or
 * execution scope has been checked, and reload it in each write transaction. */
export async function loadPmv2Replacements(tx: FollowupTx, requestItemIds: number[], options: { includeZeroCoverage?: boolean } = {}): Promise<Map<number, Pmv2Replacement[]>> {
  const ids = Array.from(new Set(requestItemIds));
  const result = new Map<number, Pmv2Replacement[]>();
  if (!ids.length) return result;
  if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw Error("مرجع احتياج PMV2 غير صالح");
  const links: any[] = [];
  for (let offset = 0; offset < ids.length; offset += 500) {
    links.push(...await readRows(tx, sql`SELECT k.materialRequestItemId,k.purchaseOrderItemId,k.linkedQuantity,n.catalogItemId,n.unitSnapshot
      FROM pmv2_material_purchase_links k
      INNER JOIN pmv2_material_request_items n ON n.id=k.materialRequestItemId
      INNER JOIN purchase_order_items i ON i.id=k.purchaseOrderItemId AND i.purchaseOrderId=k.purchaseOrderId AND i.catalogItemId=n.catalogItemId
      WHERE k.materialRequestItemId IN (${sql.join(ids.slice(offset,offset+500).map(id=>sql`${id}`),sql`,`)}) ORDER BY k.id`));
  }
  const replacements = await loadReplacementFulfillments(tx, links.map(link=>Number(link.purchaseOrderItemId)));
  for (const link of links) {
    let available = Number(link.linkedQuantity);
    for (const plan of replacements.get(Number(link.purchaseOrderItemId)) ?? []) {
      if (plan.sourceCatalogItemId !== Number(link.catalogItemId) || plan.originalUnit.trim() !== String(link.unitSnapshot ?? "").trim()) {
        throw Error("وحدة أو هوية تعويض المرتجع لا تطابق احتياج PMV2 الأصلي");
      }
      const maximumOriginalQuantity = Math.min(available, Number(replacementCoverageLimit(plan)));
      if (maximumOriginalQuantity <= 0 && !options.includeZeroCoverage) continue;
      const list = result.get(Number(link.materialRequestItemId)) ?? [];
      list.push({ requestItemId: Number(link.materialRequestItemId), plan, maximumOriginalQuantity });
      result.set(Number(link.materialRequestItemId), list);
      available = Number((available-maximumOriginalQuantity).toFixed(3));
    }
  }
  return result;
}

export function replacementForPhysicalLot(replacements: Pmv2Replacement[], input: { lotId: number | null; catalogItemId: number | null; unit: string | null; quantity: number }) {
  const candidates = replacements.filter(({plan})=>plan.catalogItemId===input.catalogItemId && plan.lots.some(lot=>lot.lotId===input.lotId && lot.unit.trim()===String(input.unit ?? "").trim()));
  if (candidates.length !== 1) throw Error("الصنف أو اللوت لا يطابق بديلًا معتمدًا لهذا الاحتياج");
  const replacement = candidates[0];
  const originalQuantity = Number(replacementPhysicalToOriginal(replacement.plan, String(input.quantity)));
  if (!(originalQuantity>0) || originalQuantity>replacement.maximumOriginalQuantity+0.0005) throw Error("كمية البديل تتجاوز تعويض احتياج PMV2 المعتمد");
  return { replacement, originalQuantity };
}

export function originalEquivalent(part: { quantity: number; originalQuantity?: number }, physicalQuantity = part.quantity) {
  if (!Number.isFinite(physicalQuantity) || physicalQuantity<0 || physicalQuantity>part.quantity+0.0005) throw Error("كمية الصرف أو المرتجع غير صالحة");
  const covered = part.originalQuantity ?? part.quantity;
  if (!(part.quantity>0) || !(covered>0)) throw Error("رابط كمية تعويض PMV2 غير صالح");
  return exactQuantityRatio(physicalQuantity,covered,part.quantity);
}

function exactQuantityRatio(value: number,numerator: number,denominator: number) {
  const product=decimal4(String(value))*decimal4(String(numerator)), divisor=decimal4(String(denominator));
  if (divisor<=BigInt(0) || product%divisor || (product/divisor)%BigInt(10)) throw Error("الكمية لا تحقق نسبة التعويض بدقة ثلاث منازل");
  return Number(format4(product/divisor));
}
export function physicalEquivalent(part: { quantity:number; originalQuantity?:number },originalQuantity:number) {
  const covered=part.originalQuantity??part.quantity;
  if (!Number.isFinite(originalQuantity) || originalQuantity<0 || originalQuantity>covered+0.0005) throw Error("كمية التعويض الأصلية غير صالحة");
  return exactQuantityRatio(originalQuantity,part.quantity,covered);
}

export function validatePmv2PhysicalUsage(issues:Array<{deliveryDocumentId:number;quantity:number;unit:string;originalQuantity?:number}>,usages:Array<{deliveryDocumentId:number;usedQuantity:number}>) {
  const byDelivery=new Map(usages.map(part=>[part.deliveryDocumentId,part.usedQuantity]));
  if(byDelivery.size!==usages.length || byDelivery.size!==issues.length || issues.some(part=>!byDelivery.has(part.deliveryDocumentId))) throw Error("توزيع الاستخدام لا يطابق جميع سندات احتياج PMV2");
  let hasReturns=false;
  for(const part of issues) {
    const used=Number(byDelivery.get(part.deliveryDocumentId));
    const validation=used>0 ? getPmv2MaterialQuantityValidationMessage(used,part.unit) : null;
    if(!Number.isFinite(used) || used<0 || used>part.quantity+0.0005 || validation) throw Error(validation||"الكمية المستخدمة لا تطابق الصنف واللوت الفعلي");
    if(!Number.isInteger(Number((part.quantity-used).toFixed(3)))) throw Error("الكمية المتبقية من اللوت لا يمكن إرجاعها بمستند المرتجع الحالي");
    hasReturns ||= used<part.quantity;
  }
  return {hasReturns};
}

export function settlePmv2PhysicalConsumption(issues:Array<{deliveryDocumentId:number;quantity:number;unit:string;originalQuantity?:number;catalogItemId:number;materialRequestItemId:number|null;generalStockQuantity:number}>,usages:Array<{deliveryDocumentId:number;usedQuantity:number}>,returnedByDelivery:Map<number,number>) {
  validatePmv2PhysicalUsage(issues,usages);
  const declared=new Map(usages.map(part=>[part.deliveryDocumentId,part.usedQuantity]));
  const allocations:Array<{deliveryDocumentId:number;catalogItemId:number;unit:string;quantity:number;materialRequestItemId:number|null}>=[];
  for(const part of issues) {
    const actual=Number((part.quantity-Number(returnedByDelivery.get(part.deliveryDocumentId)||0)).toFixed(3));
    if(Math.abs(actual-Number(declared.get(part.deliveryDocumentId)??-1))>0.0005) throw Error("صافي صرف اللوت لا يطابق استخدام الصنف الفعلي المسجل");
    const general=Math.min(physicalEquivalent(part,Number(part.generalStockQuantity||0)),actual),request=Number((actual-general).toFixed(3));
    if(request>0&&part.materialRequestItemId==null) throw Error("مرجع استخدام احتياج PMV2 غير صالح");
    if(general>0) allocations.push({deliveryDocumentId:part.deliveryDocumentId,catalogItemId:part.catalogItemId,unit:part.unit,quantity:general,materialRequestItemId:null});
    if(request>0) allocations.push({deliveryDocumentId:part.deliveryDocumentId,catalogItemId:part.catalogItemId,unit:part.unit,quantity:request,materialRequestItemId:part.materialRequestItemId});
  }
  return allocations;
}

export async function loadPmv2ReplacementStock(tx:FollowupTx,replacements:Pmv2Replacement[],warehouseIds:number[]) {
  const lots=Array.from(new Set(replacements.flatMap(({plan})=>plan.lots.map(lot=>lot.lotId)))),warehouses=Array.from(new Set(warehouseIds));
  const provenance=new Map(replacements.flatMap(({plan})=>plan.lots.map(lot=>[lot.lotId,{catalogItemId:plan.catalogItemId,unit:lot.unit}] as const)));
  const result=new Map<string,Pmv2ReplacementStock>();
  for(let start=0;start<lots.length;start+=500) for(let ws=0;ws<warehouses.length;ws+=500) {
    const rows=await readRows(tx,sql`SELECT b.lotId,b.inventoryId,v.warehouseId,v.linkedItemId AS catalogItemId,COALESCE(v.issueUnit,v.unit) AS unit,b.quantity,l.lotCode,l.trackingToken
      FROM inventory_lot_balances b INNER JOIN inventory v ON v.id=b.inventoryId
      INNER JOIN inventory_lots l ON l.id=b.lotId AND l.catalogItemId=v.linkedItemId
      INNER JOIN warehouses w ON w.id=v.warehouseId AND w.isActive=1
      WHERE b.quantity>0 AND (l.specificationStatus IS NULL OR l.specificationStatus='approved') AND b.lotId IN (${sql.join(lots.slice(start,start+500).map(id=>sql`${id}`),sql`,`)})
        AND v.warehouseId IN (${sql.join(warehouses.slice(ws,ws+500).map(id=>sql`${id}`),sql`,`)}) ORDER BY l.createdAt,l.id`);
    for(const row of rows) {
      const expected=provenance.get(Number(row.lotId));
      if(!expected || expected.catalogItemId!==Number(row.catalogItemId) || expected.unit.trim()!==String(row.unit??"").trim()) throw Error("وحدة أو هوية مخزون لوت البديل لا تطابق الاستلام المعتمد");
      const key=`${Number(row.warehouseId)}:${Number(row.lotId)}`;
      if(result.has(key)) throw Error("هوية مخزون لوت البديل غير فريدة في المستودع");
      result.set(key,{lotId:Number(row.lotId),inventoryId:Number(row.inventoryId),warehouseId:Number(row.warehouseId),catalogItemId:Number(row.catalogItemId),unit:String(row.unit??""),quantity:Number(row.quantity),lotCode:String(row.lotCode),trackingToken:String(row.trackingToken)});
    }
  }
  return result;
}

/** Existing procurement remains blocked until its supplier-return replacement
 * has physically reached this request's team warehouse. A received status is
 * not itself evidence of PMV2 fulfillment. */
export async function assertPmv2CompensationSettled(tx:FollowupTx,requestItemId:number,taskItemId:number) {
  if(!await trialEnabled(tx)) return;
  const links=await readRows(tx,sql`SELECT k.purchaseOrderItemId,k.linkedQuantity,n.unitSnapshot
    FROM pmv2_material_purchase_links k
    INNER JOIN pmv2_material_request_items n ON n.id=k.materialRequestItemId
    INNER JOIN purchase_order_items i ON i.id=k.purchaseOrderItemId AND i.purchaseOrderId=k.purchaseOrderId
    WHERE k.materialRequestItemId=${requestItemId}`);
  const active=await loadActiveCompensationCases(tx,links.map(link=>Number(link.purchaseOrderItemId)),{includeReceived:true});
  const cases=links.flatMap(link=>(active.get(Number(link.purchaseOrderItemId))??[]).map(record=>({...record,linkedQuantity:link.linkedQuantity,unitSnapshot:link.unitSnapshot})));
  if(!cases.length) return;
  const unsettled=()=>new Pmv2ReplacementCoverageError("استكمل تعويض المرتجع القائم وربط تحويله باحتياج PMV2 قبل إنشاء شراء آخر لهذا الاحتياج");
  if(cases.some(row=>row.planStatus!=="received")) throw unsettled();
  const verified=(await loadPmv2Replacements(tx,[requestItemId],{includeZeroCoverage:true})).get(requestItemId)??[];
  const actions=await readRows(tx,sql`SELECT note FROM pmv2_item_actions WHERE taskItemId=${taskItemId} AND action='material_transfer_linked'`);
  const fulfilled=new Map<number,number>(),transfers=new Set<number>();
  for(const row of actions) {
    let note:any;try{note=JSON.parse(String(row.note));}catch{continue;}
    if(Number(note.materialRequestItemId)!==requestItemId || !Number.isSafeInteger(note.replacementPlanId) || !Number.isSafeInteger(note.transferId) || !(Number(note.originalQuantity)>0) || transfers.has(note.transferId)) continue;
    transfers.add(note.transferId);fulfilled.set(note.replacementPlanId,(fulfilled.get(note.replacementPlanId)||0)+Number(note.originalQuantity));
  }
  for(const row of cases) {
    const received=verified.find(({plan})=>plan.planId===Number(row.planId)&&plan.caseId===Number(row.id));
    if(!received || received.plan.originalUnit.trim()!==String(row.unitSnapshot).trim()) throw unsettled();
    // Receipt closes follow-up, not team fulfillment. Only the verified net
    // root-equivalent coverage remains due here; fully returned ancestors have
    // zero coverage and never demand an old transfer a second time.
    const required=Math.min(received.maximumOriginalQuantity,Number(row.linkedQuantity));
    if(!Number.isFinite(required) || required<0 || Number(fulfilled.get(Number(row.planId))||0)+0.0005<required) throw unsettled();
  }
}
