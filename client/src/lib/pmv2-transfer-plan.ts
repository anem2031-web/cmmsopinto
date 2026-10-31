type Allocation={sourceInventoryId:number;catalogItemId:number;materialName:string;quantity:number;unit:string;originalQuantity:number;lotId:number;lotCode:string;trackingToken:string;replacementPlanId?:number};
type Handoff={sourceWarehouse:{id:number};destinationWarehouse:{id:number};remainingQuantity:number;fulfillmentAllocations:Allocation[]};
type Context={requestItemId:number;fromWarehouseId:number;toWarehouseId:number;quantity:number;materialName:string;unit:string};

/** Display the fresh server plan in physical units. The URL supplies only the
 * originating request and expected context, never inventory allocation truth. */
export function buildPmv2TransferCart(handoff:Handoff,context:Context,inventoryList:any[],maximumItems=20) {
  const allocations=handoff.fulfillmentAllocations;
  const originalTotal=Number(allocations.reduce((sum,part)=>sum+part.originalQuantity,0).toFixed(3));
  if(handoff.sourceWarehouse.id!==context.fromWarehouseId || handoff.destinationWarehouse.id!==context.toWarehouseId || Math.abs(handoff.remainingQuantity-context.quantity)>0.0005 || Math.abs(originalTotal-handoff.remainingQuantity)>0.0005 || !allocations.length || allocations.length>maximumItems || new Set(allocations.map(part=>part.trackingToken)).size!==allocations.length) throw Error("تغيرت خطة توفير مواد PMV2؛ ارجع إلى الطلب وحدّثه");
  const plannedByInventory=new Map<number,number>();
  return allocations.map(allocation=>{
    const item=inventoryList.find(candidate=>Number(candidate.id)===allocation.sourceInventoryId && Number(candidate.warehouseId)===handoff.sourceWarehouse.id);
    const planned=(plannedByInventory.get(allocation.sourceInventoryId)||0)+allocation.quantity;
    plannedByInventory.set(allocation.sourceInventoryId,planned);
    if(!item || !(allocation.quantity>0) || !(allocation.originalQuantity>0) || Number(item.quantity)<planned || !allocation.trackingToken || (item.linkedItemId!=null&&Number(item.linkedItemId)!==allocation.catalogItemId)) throw Error("رصيد أحد لوتات الصنف أو البديل تغير؛ ارجع إلى طلب PMV2");
    return {inventoryId:allocation.sourceInventoryId,itemName:allocation.materialName,internalCode:item.internalCode,manufacturerBarcode:item.manufacturerBarcode,unit:allocation.unit,balanceAtAddTime:Number(item.quantity),quantity:allocation.quantity,lotTrackingToken:allocation.trackingToken,lotCode:allocation.lotCode,lotBalanceAtAddTime:allocation.quantity,materialNeedId:context.requestItemId,originalQuantity:allocation.originalQuantity,notes:allocation.replacementPlanId ? `بديل معتمد للاحتياج ${context.materialName} — يغطي ${allocation.originalQuantity} ${context.unit}` : undefined};
  });
}
