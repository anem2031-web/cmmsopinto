import {readFile,writeFile} from "node:fs/promises";
import type {AcceptanceRpc} from "./operational-compensation-api";
const folder="docs/runtime-uat/2026-10-30-compensation";
export async function sourceReturnAction(rpc:AcceptanceRpc, action:string) {
  const shared=JSON.parse(await readFile(`${folder}/operational-api-state.json`,"utf8"));
  const sources=JSON.parse(await readFile(`${folder}/UAT-SOURCES-20261030-purchase-stages.json`,"utf8"));
  const team=JSON.parse(await readFile(`${folder}/team-source.json`,"utf8"));
  const pm=JSON.parse(await readFile(`${folder}/pmv2-source-b.json`,"utf8"));
  let state:any;
  try { state=JSON.parse(await readFile(`${folder}/source-return-state.json`,"utf8")); } catch {}
  state??={environment:"copycmms2",entries:[{kind:"team",originalOrderId:team.purchaseOrderId,alternativeId:180228},{kind:"pmv2",originalOrderId:pm.purchaseOrderId,alternativeId:180302}]};
  if(state.environment!=="copycmms2") throw Error("Trial state only");
  const save=()=>writeFile(`${folder}/source-return-state.json`,JSON.stringify(state,null,2));
  const me=await rpc.query("auth.me");
  if(action==="source-return-accept") {
    if(me.role!=="delegate"||me.id!==shared.delegateId) throw Error("Assigned delegate login required");
  } else if(!["owner","admin"].includes(me.role)) throw Error("Owner/admin login required");
  const getCase=async(caseId:number)=>{
    for(let page=1;page<=20;page++) {
      const list=await rpc.query("supplierReturns.list",{page,pageSize:50});
      const row=list.items.find((item:any)=>item.id===caseId); if(row)return row;
      if(page*50>=list.total)break;
    } throw Error("Fixture return not visible");
  };
  for(const entry of state.entries) {
    const key=`UAT-${entry.kind}-20261030`;
    if(action==="source-return-create") {
      const receipt=sources.receipts[entry.originalOrderId];
      if(!receipt?.lot?.trackingToken||Number(receipt.lot.originalQuantity)!==4) throw Error("Original source receipt missing");
      const created=await rpc.mutate("supplierReturns.create",{operationKey:`${key}:return`,warehouseId:1,trackingToken:receipt.lot.trackingToken,
        returnedQuantity:4,delegateId:shared.delegateId,reason:`TEST COPYCMMS2 ${entry.kind} original4 replacement6 — ${key}`});
      entry.caseId=created.caseId;entry.returnId=created.returnId;await save();
    } else if(action==="source-return-accept") {
      let row=await getCase(entry.caseId);
      if(row.handoverStatus==="awaiting_delegate") await rpc.mutate("supplierReturns.command",{caseId:row.id,expectedRevision:row.revision,operationKey:`${key}:accept`,action:"accept"});
      row=await getCase(entry.caseId);
      if(!row.resolution) await rpc.mutate("supplierReturns.command",{caseId:row.id,expectedRevision:row.revision,operationKey:`${key}:change`,action:"resolve",resolution:"change_item"});
      entry.accepted=true;await save();
    } else if(action==="source-return-replacements") {
      let row=await getCase(entry.caseId);
      if(!row.replacementPlanId) await rpc.mutate("supplierReturns.chooseReplacement",{caseId:row.id,expectedRevision:row.revision,operationKey:`${key}:choose`,catalogItemId:entry.alternativeId,quantity:6});
      row=await getCase(entry.caseId);entry.planId=row.replacementPlanId;
      if(!row.replacementPurchaseOrderId) {
        const original=await rpc.query("purchaseOrders.getById",{id:entry.originalOrderId});
        const catalog=await rpc.query("catalog.items.getById",entry.alternativeId);
        const created=await rpc.mutate("purchaseOrders.create",{supplierReturnPlanId:row.replacementPlanId,
          ticketId:original.ticketId??undefined,ticketItemId:original.ticketItemId??undefined,
          siteId:original.siteId,sectionId:original.sectionId,categoryId:original.categoryId,assetId:original.assetId,
          notes:`TEST COPYCMMS2 ${key} replacement — keep original need unchanged`,
          items:[{catalogItemId:catalog.id,itemName:catalog.nameAr||catalog.nameEn,quantity:6,unit:catalog.unit,deliveryLeadDays:4,
            photoUrl:shared.photos.goods,siteId:original.siteId,sectionId:original.sectionId,categoryId:original.categoryId,assetId:original.assetId}]});
        entry.replacementOrderId=created.id;
      } else entry.replacementOrderId=row.replacementPurchaseOrderId;
      await save();
    } else throw Error("Unknown source return action");
  }
  return state;
}
