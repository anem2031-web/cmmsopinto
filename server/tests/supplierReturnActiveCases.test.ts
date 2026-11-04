import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
const fulfillment = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../supplier-return-followup/fulfillment", async importOriginal => {
  const actual = await importOriginal<typeof import("../supplier-return-followup/fulfillment")>();
  return { ...actual, loadReplacementFulfillments: (...args: any[]) => fulfillment.load(...args) };
});
vi.mock("../supplier-return-followup/runtime", async importOriginal => {
  const actual = await importOriginal<typeof import("../supplier-return-followup/runtime")>();
  return { ...actual, trialEnabled: async () => true };
});
import { loadActiveCompensationCases } from "../supplier-return-followup/active-cases";
import { assertPmv2CompensationSettled, loadPmv2Replacements, Pmv2ReplacementCoverageError } from "../pmv2/materials/replacement-coverage";

function projectedPlan(id:number,maximum:string,physical="6",localCovered="4") {
  const root=id===11;
  return {planId:id,caseId:root?1:2,sourceItemId:10,sourcePurchaseOrderId:100,sourceCatalogItemId:44,
    sourceUnit:"piece",originalUnit:"piece",originalQuantityCovered:root?"2":localCovered,quantityCovered:maximum,maximumOriginalQuantity:maximum,
    replacementItemId:root?20:30,replacementPurchaseOrderId:root?200:300,catalogItemId:root?55:66,itemName:"Verified replacement",
    replacementUnit:root?"pack":"set",orderUnit:root?"pack":"set",replacementQuantity:root?"4":physical,orderQuantity:root?"4":physical,
    coverageRatio:{numerator:"1",denominator:root?"2":"3"},
    lots:[{lotId:root?201:301,trackingToken:"verified",unit:root?"pack":"set",issueUnit:root?"pack":"set",quantity:root?"4":physical,originalQuantity:root?"4":physical}]};
}
function verifiedPlans(...plans:ReturnType<typeof projectedPlan>[]) { fulfillment.load.mockResolvedValue(new Map([[10,plans]])); }
function transfer(planId:number,quantity:number,id=planId) {
  f.insert("pmv2_item_actions",{id,taskItemId:9,action:"material_transfer_linked",note:JSON.stringify({materialRequestItemId:8,replacementPlanId:planId,transferId:id,originalQuantity:quantity})});
}

let f: ReturnType<typeof purchaseSpecificationsDatabase>;
beforeEach(() => {
  f = purchaseSpecificationsDatabase();
  fulfillment.load.mockReset(); fulfillment.load.mockResolvedValue(new Map());
  f.memory.exec(`
    CREATE TABLE supplier_return_cases(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,parentReplacementPlanId INTEGER,
      returnedQuantity NUMERIC,returnedUnit TEXT,closedAt TEXT,handoverStatus TEXT,lotId INTEGER,receiptId INTEGER,receiptItemId INTEGER);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,caseId INTEGER,planNumber INTEGER,status TEXT,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER);
    CREATE TABLE supplier_return_replacement_links(id INTEGER PRIMARY KEY,caseId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,lotId INTEGER,receiptId INTEGER,receiptItemId INTEGER);
    CREATE TABLE pmv2_material_request_items(id INTEGER PRIMARY KEY,unitSnapshot TEXT,catalogItemId INTEGER);
    CREATE TABLE pmv2_material_purchase_links(id INTEGER PRIMARY KEY,materialRequestItemId INTEGER,purchaseOrderId INTEGER,purchaseOrderItemId INTEGER,linkedQuantity NUMERIC);
    CREATE TABLE pmv2_item_actions(id INTEGER PRIMARY KEY,taskItemId INTEGER,action TEXT,note TEXT);
  `);
  for (const [item, order] of [[10,100],[20,200],[30,300],[50,500]]) {
    f.insert("purchase_orders", { id: order });
    f.insert("purchase_order_items", { id: item, purchaseOrderId: order });
  }
  f.insert("supplier_return_cases", { id: 1, purchaseOrderId: 100, purchaseOrderItemId: 10, returnedQuantity: 2,
    returnedUnit: "piece", closedAt: "2026-11-04 12:00:00", handoverStatus: "accepted" });
  f.insert("supplier_return_replacement_plans", { id: 11, caseId: 1, planNumber: 1, status: "received", purchaseOrderId: 200, purchaseOrderItemId: 20 });
  f.insert("supplier_return_replacement_links", { id: 111, caseId: 1, purchaseOrderId: 200, purchaseOrderItemId: 20, lotId: 201, receiptId: 202, receiptItemId: 203 });
  f.insert("supplier_return_cases", { id: 2, purchaseOrderId: 200, purchaseOrderItemId: 20, parentReplacementPlanId: 11,
    returnedQuantity: 4, returnedUnit: "pack", closedAt: null, handoverStatus: "accepted", lotId: 201, receiptId: 202, receiptItemId: 203 });
  f.insert("supplier_return_replacement_plans", { id: 22, caseId: 2, planNumber: 1, status: "pending_management" });
  f.memory.exec("UPDATE purchase_order_items SET catalogItemId=44 WHERE id=10");
  f.insert("pmv2_material_request_items", { id: 8, unitSnapshot: "piece", catalogItemId: 44 });
  f.insert("pmv2_material_purchase_links", { id: 88, materialRequestItemId: 8, purchaseOrderId: 100, purchaseOrderItemId: 10, linkedQuantity: 2 });
});
afterEach(() => f.close());

describe("active supplier compensation descendants stay attached to their original need", () => {
  it("finds an active child beyond a closed root and keeps unrelated roots independent", async () => {
    const active = await loadActiveCompensationCases(f.db, [10,50,10,20]);
    expect(active.get(10)?.map(row => row.id)).toEqual([2]);
    expect(active.get(20)?.map(row => row.id)).toEqual([2]);
    expect(active.has(50)).toBe(false);
    expect(active.get(10)?.[0]).toMatchObject({ parentReplacementPlanId: 11, returnedQuantity: "4", returnedUnit: "pack" });
  });
  it("blocks a duplicate ordinary PMV2 purchase while that child is pending", async () => {
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
    expect(fulfillment.load).not.toHaveBeenCalled();
  });
  it("checks the current operation independently after a child closes", async () => {
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
    f.memory.exec("UPDATE supplier_return_cases SET closedAt=CURRENT_TIMESTAMP WHERE id=2; UPDATE supplier_return_replacement_plans SET status='received',purchaseOrderId=300,purchaseOrderItemId=30 WHERE id=22");
    verifiedPlans(projectedPlan(11,"0"),projectedPlan(22,"2")); transfer(22,2);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).resolves.toBeUndefined();
    expect((await loadActiveCompensationCases(f.db,[10])).size).toBe(0);
  });
  it("permits a received legacy child only after its verified root-equivalent transfer is complete", async () => {
    f.memory.exec("UPDATE supplier_return_replacement_plans SET status='received',purchaseOrderId=300,purchaseOrderItemId=30 WHERE id=22");
    verifiedPlans(projectedPlan(11,"0"),projectedPlan(22,"2"));
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
    transfer(22,2);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).resolves.toBeUndefined();
    f.memory.exec("UPDATE pmv2_item_actions SET note='{}'");
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
  });
  it("keeps a closed received root pending physical team transfer", async () => {
    f.memory.exec("DELETE FROM supplier_return_cases WHERE id=2; DELETE FROM supplier_return_replacement_plans WHERE id=22");
    verifiedPlans(projectedPlan(11,"2"));
    expect((await loadActiveCompensationCases(f.db,[10])).size).toBe(0);
    expect((await loadActiveCompensationCases(f.db,[10],{includeReceived:true})).get(10)?.map(row=>row.id)).toEqual([1]);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
    transfer(11,2);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).resolves.toBeUndefined();
    f.memory.exec("DELETE FROM pmv2_item_actions");
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
  });
  it("proves a fully returned zero-coverage parent and requires only the closed received child transfer", async () => {
    f.memory.exec("UPDATE supplier_return_cases SET closedAt=CURRENT_TIMESTAMP WHERE id=2; UPDATE supplier_return_replacement_plans SET status='received',purchaseOrderId=300,purchaseOrderItemId=30 WHERE id=22");
    verifiedPlans(projectedPlan(11,"0"),projectedPlan(22,"2"));
    expect((await loadPmv2Replacements(f.db,[8])).get(8)?.map(row=>row.plan.planId)).toEqual([22]);
    expect((await loadPmv2Replacements(f.db,[8],{includeZeroCoverage:true})).get(8)?.map(row=>[row.plan.planId,row.maximumOriginalQuantity])).toEqual([[11,0],[22,2]]);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
    transfer(22,2);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).resolves.toBeUndefined();
    verifiedPlans(projectedPlan(22,"2"));
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
  });
  it("requires the parent's net one root unit and a child with a different one-to-three ratio independently", async () => {
    f.memory.exec("UPDATE supplier_return_cases SET closedAt=CURRENT_TIMESTAMP,returnedQuantity=2 WHERE id=2; UPDATE supplier_return_replacement_plans SET status='received',purchaseOrderId=300,purchaseOrderItemId=30 WHERE id=22");
    verifiedPlans(projectedPlan(11,"1"),projectedPlan(22,"1","3","2"));
    transfer(11,1);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
    transfer(22,1);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).resolves.toBeUndefined();
  });
  it("finds a further pending generation rather than stopping at the second closed case", async () => {
    f.memory.exec("UPDATE supplier_return_cases SET closedAt=CURRENT_TIMESTAMP WHERE id=2; UPDATE supplier_return_replacement_plans SET status='received',purchaseOrderId=300,purchaseOrderItemId=30 WHERE id=22");
    f.insert("supplier_return_replacement_links", { id: 222, caseId: 2, purchaseOrderId: 300, purchaseOrderItemId: 30, lotId: 301, receiptId: 302, receiptItemId: 303 });
    f.insert("supplier_return_cases", { id: 3, purchaseOrderId: 300, purchaseOrderItemId: 30, parentReplacementPlanId: 22,
      returnedQuantity: 6, returnedUnit: "set", handoverStatus: "accepted", lotId: 301, receiptId: 302, receiptItemId: 303 });
    expect((await loadActiveCompensationCases(f.db,[10])).get(10)?.map(row => row.id)).toEqual([3]);
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
  });
  it.each([
    "DELETE FROM purchase_orders WHERE id=100",
    "DELETE FROM purchase_order_items WHERE id=20",
    "UPDATE supplier_return_cases SET purchaseOrderId=999 WHERE id=2",
    "UPDATE supplier_return_cases SET parentReplacementPlanId=999 WHERE id=2",
    "UPDATE supplier_return_cases SET receiptItemId=999 WHERE id=2",
    "DELETE FROM supplier_return_replacement_links WHERE id=111",
  ])("does not hide a broken parent or accept unrelated lineage: %s", async change => {
    f.memory.exec(change);
    await expect(loadActiveCompensationCases(f.db,[10])).rejects.toThrow("روابط متابعة");
  });
  it("preserves ordinary needs and a root-level pending compensation", async () => {
    f.memory.exec("DELETE FROM supplier_return_cases WHERE id=2; DELETE FROM supplier_return_replacement_plans WHERE id=22; UPDATE supplier_return_cases SET closedAt=NULL WHERE id=1; UPDATE supplier_return_replacement_plans SET status='pending_management' WHERE id=11");
    await expect(assertPmv2CompensationSettled(f.db,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
    f.memory.exec("DELETE FROM supplier_return_cases; DELETE FROM supplier_return_replacement_plans");
    await expect(assertPmv2CompensationSettled(f.db,8,9)).resolves.toBeUndefined();
  });
  it("bounds reads by distinct IDs per generation without a row-wise reader", async () => {
    const queries: number[][] = [];
    const tx: any = { execute: async (query: any) => {
      const { params } = new MySqlDialect().sqlToQuery(query); queries.push(params);
      expect(params.length).toBeLessThanOrEqual(500);
      return [[]];
    } };
    const ids = Array.from({length:1001},(_,index)=>index+1);
    expect((await loadActiveCompensationCases(tx,[...ids,...ids])).size).toBe(0);
    expect(queries.map(part=>part.length)).toEqual([500,500,1]);
    queries.length=0;
    await loadActiveCompensationCases(tx,Array(1200).fill(10));
    expect(queries).toEqual([[10]]);
  });
  it("batches 1001 parallel descendant chains and preserves each root's own active case", async () => {
    const sizes:number[]=[];
    const tx:any={execute:async(query:any)=>{
      const {params}=new MySqlDialect().sqlToQuery(query); sizes.push(params.length);
      return [params.map((id:number)=>{
        const root=id>20000?id-20000:id,child=id>20000;
        return {id:(child?200000:100000)+root,sourceItemId:id,sourcePurchaseOrderId:(child?40000:5000)+root,
          sourceItemExists:id,sourceOrderExists:(child?40000:5000)+root,parentReplacementPlanId:child?10000+root:null,parentSourceValid:1,
          returnedQuantity:2,returnedUnit:"piece",closedAt:child?null:"closed",planId:child?null:10000+root,planStatus:child?null:"received",
          replacementItemId:child?null:20000+root,replacementOrderId:child?null:40000+root,
          replacementItemExists:child?null:20000+root,replacementOrderExists:child?null:40000+root};
      })];
    }};
    const active=await loadActiveCompensationCases(tx,Array.from({length:1001},(_,index)=>index+1));
    expect(sizes).toEqual([500,500,1,500,500,1]);
    expect(active.size).toBe(1001);
    for(let id=1;id<=1001;id++) expect(active.get(id)?.map(row=>row.id)).toEqual([200000+id]);
  });
  it("propagates an infrastructure failure instead of treating it as no active compensation", async () => {
    const failure=Error("database unavailable");
    await expect(loadActiveCompensationCases({execute:async()=>{throw failure;}} as any,[10])).rejects.toBe(failure);
  });
});
