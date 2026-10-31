import {describe,it,expect}from"vitest";
import {buildPmv2TransferCart}from"../../client/src/lib/pmv2-transfer-plan";
import fs from"node:fs";
import path from"node:path";
const context={requestItemId:1,fromWarehouseId:10,toWarehouseId:20,quantity:6,materialName:"الأصل",unit:"قطعة"};
const inventory=[{id:100,warehouseId:10,quantity:2,linkedItemId:1},{id:101,warehouseId:10,quantity:6,linkedItemId:2}];
const handoff={sourceWarehouse:{id:10},destinationWarehouse:{id:20},remainingQuantity:6,fulfillmentAllocations:[{sourceInventoryId:100,catalogItemId:1,materialName:"الأصل",quantity:2,unit:"قطعة",originalQuantity:2,lotId:10,lotCode:"LOT10",trackingToken:"T10"},{sourceInventoryId:101,catalogItemId:2,materialName:"البديل",quantity:6,unit:"حبة",originalQuantity:4,lotId:11,lotCode:"LOT11",trackingToken:"T11",replacementPlanId:5}]};
describe("PMV2 physical transfer/usage UI contract",()=>{
  it("builds a mixed cart in actual units while retaining original need coverage and name",()=>{
    const cart=buildPmv2TransferCart(handoff,context,inventory);
    expect(cart.map(row=>[row.inventoryId,row.quantity,row.unit,row.originalQuantity])).toEqual([[100,2,"قطعة",2],[101,6,"حبة",4]]);
    expect(cart[1].notes).toContain("الأصل");expect(cart[1].notes).toContain("4 قطعة");
    expect(cart.every(row=>row.materialNeedId===1)).toBe(true);
  });
  it("rejects stale source/quantity, repeated lot tokens and insufficient aggregate stock",()=>{
    expect(()=>buildPmv2TransferCart(handoff,{...context,toWarehouseId:30},inventory)).toThrow();
    expect(()=>buildPmv2TransferCart(handoff,{...context,quantity:5},inventory)).toThrow();
    expect(()=>buildPmv2TransferCart({...handoff,fulfillmentAllocations:[handoff.fulfillmentAllocations[0],{...handoff.fulfillmentAllocations[1],trackingToken:"T10"}]},context,inventory)).toThrow();
    expect(()=>buildPmv2TransferCart(handoff,context,[inventory[0],{...inventory[1],quantity:5}])).toThrow();
  });
  it("loads the authoritative plan afresh and completion submits actual quantities per delivery",()=>{
    const transfer=fs.readFileSync(path.resolve("client/src/pages/inventory/WarehouseTransfer.tsx"),"utf8");
    const completion=fs.readFileSync(path.resolve("client/src/pages/pmv2/Pmv2MyTasks.tsx"),"utf8");
    expect(transfer).toContain("preparePmv2TransferMut.mutateAsync({requestItemId:materialHandoff.requestItemId})");
    expect(transfer).toContain("buildPmv2TransferCart(handoff,materialHandoff");
    expect(transfer).toContain("disabled={pmv2Prepared}");
    expect(completion).toContain("physicalUsages:item.physicalParts.map");
    expect(completion).toContain("deliveryDocumentId:part.deliveryDocumentId");
    expect(completion).toContain("usedByDelivery[part.deliveryDocumentId]");
  });
});
