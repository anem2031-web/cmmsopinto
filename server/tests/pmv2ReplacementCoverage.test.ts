import { describe,it,expect } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { loadPmv2Replacements,loadPmv2ReplacementStock,originalEquivalent,physicalEquivalent,replacementForPhysicalLot,validatePmv2PhysicalUsage,settlePmv2PhysicalConsumption,assertPmv2CompensationSettled,Pmv2ReplacementCoverageError,planPmv2ReplacementLots,planPmv2Fulfillment } from "../pmv2/materials/replacement-coverage";
import type { ReplacementFulfillment } from "../supplier-return-followup/fulfillment";

const plan:ReplacementFulfillment={planId:1,caseId:2,sourceItemId:3,sourcePurchaseOrderId:4,sourceCatalogItemId:10,sourceUnit:"قطعة",originalUnit:"قطعة",quantityCovered:"2.000",originalQuantityCovered:"2.000",replacementItemId:5,replacementPurchaseOrderId:6,catalogItemId:20,itemName:"بديل",replacementUnit:"كرتون",orderUnit:"كرتون",replacementQuantity:"1.000",orderQuantity:"1.000",lots:[{lotId:7,trackingToken:"TOKEN",unit:"حبة",issueUnit:"حبة",quantity:"4.000",originalQuantity:"4.000"}]};
const replacement={requestItemId:8,plan,maximumOriginalQuantity:2};
describe("PMV2 replacement physical/original allocation",()=>{
  it("solves competing plan quanta together instead of consuming an incompatible earlier plan",()=>{
    const make=(id:number,covered:number,physical:number)=>({requestItemId:8,maximumOriginalQuantity:covered,plan:{...plan,planId:id,caseId:id,sourceItemId:id,catalogItemId:20+id,quantityCovered:String(covered),originalQuantityCovered:String(covered),lots:[{...plan.lots[0],lotId:id,quantity:String(physical),originalQuantity:String(physical)}]}});
    const first=make(1,3,1),second=make(2,4,2);
    const stock=(replacement:any)=>[{lotId:replacement.plan.lots[0].lotId,inventoryId:30+replacement.plan.planId,warehouseId:40,catalogItemId:replacement.plan.catalogItemId,unit:"حبة",quantity:Number(replacement.plan.lots[0].quantity),lotCode:"LOT",trackingToken:"TOKEN"}];
    const selected=planPmv2Fulfillment({requiredOriginal:4,originalUnit:"قطعة",originalStock:[],replacements:[{replacement:first,stock:stock(first)},{replacement:second,stock:stock(second)}]});
    expect(selected.complete).toBe(true);expect(selected.originalCovered).toBe(4);
    expect(selected.allocations.map(part=>[part.replacementPlanId,part.quantity,part.originalQuantity])).toEqual([[2,2,4]]);
    const mixed=planPmv2Fulfillment({requiredOriginal:4,originalUnit:"قطعة",originalStock:[{lotId:99,inventoryId:99,warehouseId:40,catalogItemId:10,unit:"قطعة",quantity:2,lotCode:"ORIGINAL",trackingToken:"ORIGINAL"}],replacements:[{replacement:first,stock:stock(first)},{replacement:second,stock:stock(second)}]});
    expect(mixed.complete).toBe(true);expect(mixed.allocations.map(part=>part.originalQuantity)).toEqual([2,2]);
  });
  it("selects3 of5 available replacement units for2 remaining original units in a4-to6 plan",()=>{
    const fourToSix={...replacement,maximumOriginalQuantity:4,plan:{...plan,quantityCovered:"4.000",originalQuantityCovered:"4.000",lots:[{...plan.lots[0],quantity:"6.000",originalQuantity:"6.000"}]}};
    const stock=[{lotId:7,inventoryId:30,warehouseId:40,catalogItemId:20,unit:"حبة",quantity:5,lotCode:"LOT",trackingToken:"TOKEN"}];
    const selected=planPmv2ReplacementLots(fourToSix,stock,2,"قطعة");
    expect(selected.allocations.map(part=>[part.quantity,part.originalQuantity])).toEqual([[3,2]]);
    expect(2+selected.originalCovered).toBe(4); // 2 original stock + 3 actual replacement
    expect(selected.unrepresentable).toBe(false);
    expect(planPmv2ReplacementLots(fourToSix,stock,4,"قطعة",2).originalCovered).toBe(2);
    const unsupported=planPmv2ReplacementLots(fourToSix,stock,1,"قطعة");
    expect(unsupported.allocations).toEqual([]);expect(unsupported.unrepresentable).toBe(true);
  });
  it("keeps physical stock quantities separate from original need progress",()=>{
    const part={quantity:4,originalQuantity:2};
    expect(originalEquivalent(part)).toBe(2);
    expect(originalEquivalent(part,2)).toBe(1);
    expect(physicalEquivalent(part,1)).toBe(2);
    expect(originalEquivalent({quantity:3},1)).toBe(1);
  });
  it("rejects rounding, excess quantities, foreign lots and incorrect actual units",()=>{
    expect(()=>originalEquivalent({quantity:3,originalQuantity:1},1)).toThrow("بدقة");
    expect(()=>physicalEquivalent({quantity:3,originalQuantity:1},2)).toThrow("غير صالحة");
    expect(()=>replacementForPhysicalLot([replacement],{lotId:99,catalogItemId:20,unit:"حبة",quantity:4})).toThrow();
    expect(()=>replacementForPhysicalLot([replacement],{lotId:7,catalogItemId:20,unit:"كرتون",quantity:4})).toThrow();
    expect(()=>replacementForPhysicalLot([replacement],{lotId:7,catalogItemId:20,unit:"حبة",quantity:5})).toThrow("تتجاوز");
  });
  it("recognizes only the approved replacement lot for this original need",()=>{
    expect(replacementForPhysicalLot([replacement],{lotId:7,catalogItemId:20,unit:"حبة",quantity:2}).originalQuantity).toBe(1);
    expect(()=>replacementForPhysicalLot([{...replacement,maximumOriginalQuantity:.5}],{lotId:7,catalogItemId:20,unit:"حبة",quantity:2})).toThrow();
  });
  it("records actual use for mixed original and replacement lots without exchanging their costs",()=>{
    const issues=[{deliveryDocumentId:1,quantity:2,unit:"قطعة"},{deliveryDocumentId:2,quantity:4,originalQuantity:2,unit:"حبة"}];
    expect(validatePmv2PhysicalUsage(issues,[{deliveryDocumentId:1,usedQuantity:0},{deliveryDocumentId:2,usedQuantity:4}])).toEqual({hasReturns:true});
    expect(validatePmv2PhysicalUsage(issues,[{deliveryDocumentId:1,usedQuantity:2},{deliveryDocumentId:2,usedQuantity:2}])).toEqual({hasReturns:true});
    expect(()=>validatePmv2PhysicalUsage(issues,[{deliveryDocumentId:99,usedQuantity:2},{deliveryDocumentId:2,usedQuantity:2}])).toThrow("جميع سندات");
    expect(()=>validatePmv2PhysicalUsage(issues,[{deliveryDocumentId:1,usedQuantity:1},{deliveryDocumentId:1,usedQuantity:1}])).toThrow("جميع سندات");
    expect(()=>validatePmv2PhysicalUsage(issues,[{deliveryDocumentId:1,usedQuantity:1.5},{deliveryDocumentId:2,usedQuantity:2}])).toThrow();
  });
  it("accepts actual used5 of6 for a4-original replacement without inventing a rounded original consumption",()=>{
    const physical=[{deliveryDocumentId:1,quantity:6,originalQuantity:4,unit:"حبة"}];
    expect(()=>originalEquivalent(physical[0],5)).toThrow("بدقة");
    expect(validatePmv2PhysicalUsage(physical,[{deliveryDocumentId:1,usedQuantity:5}])).toEqual({hasReturns:true});
    expect(validatePmv2PhysicalUsage(physical,[{deliveryDocumentId:1,usedQuantity:6}])).toEqual({hasReturns:false});
    const actual=[{...physical[0],catalogItemId:20,materialRequestItemId:8,generalStockQuantity:0}];
    expect(settlePmv2PhysicalConsumption(actual,[{deliveryDocumentId:1,usedQuantity:5}],new Map([[1,1]]))).toEqual([{deliveryDocumentId:1,catalogItemId:20,unit:"حبة",quantity:5,materialRequestItemId:8}]);
    expect(()=>settlePmv2PhysicalConsumption(actual,[{deliveryDocumentId:1,usedQuantity:5}],new Map())).toThrow("صافي صرف");
  });
  it("loads distinct request parents by bounded chunks and denies missing source links",async()=>{
    const queries:string[]=[];
    const tx:any={execute:async(query:any)=>{
      const {sql:statement,params}=new MySqlDialect().sqlToQuery(query);queries.push(statement);
      if(statement.includes("FROM pmv2_material_purchase_links")) {
        expect(params.length).toBeLessThanOrEqual(500);
        return [[]];
      }
      throw Error("Unexpected query: "+statement);
    }};
    expect((await loadPmv2Replacements(tx,[...Array.from({length:1001},(_,index)=>index+1),1,1])).size).toBe(0);
    expect(queries).toHaveLength(3);
  });
  it("does not merge ambiguous physical stock cards",async()=>{
    const row={lotId:7,inventoryId:10,warehouseId:20,catalogItemId:20,unit:"حبة",quantity:"4",lotCode:"LOT",trackingToken:"TOKEN"};
    const tx:any={execute:async()=>[[row,{...row,inventoryId:11}]]};
    await expect(loadPmv2ReplacementStock(tx,[replacement],[20])).rejects.toThrow("غير فريدة");
  });
  it("blocks duplicate ordinary procurement while an existing compensation is pending",async()=>{
    const tx:any={execute:async(query:any)=>{
      const {sql:statement}=new MySqlDialect().sqlToQuery(query);
      if(statement.includes("SELECT DATABASE()")) return [[{databaseName:"copycmms2"}]];
      if(statement.includes("FROM pmv2_material_purchase_links")) return [[{id:2,returnedQuantity:"2",returnedUnit:"قطعة",linkedQuantity:"2",unitSnapshot:"قطعة",planId:1,planStatus:"pending_management"}]];
      if(statement.includes("FROM pmv2_item_actions")) return [[]];
      throw Error(statement);
    }};
    await expect(assertPmv2CompensationSettled(tx,8,9)).rejects.toBeInstanceOf(Pmv2ReplacementCoverageError);
  });
  it("does not change disabled production behavior or hide database failures",async()=>{
    let calls=0;
    await assertPmv2CompensationSettled({execute:async()=>{calls++;return [[{databaseName:"unrelated"}]];}} as any,8,9);
    expect(calls).toBe(1);
    const failure=Error("database unavailable");
    await expect(assertPmv2CompensationSettled({execute:async()=>{throw failure;}} as any,8,9)).rejects.toBe(failure);
  });
});
