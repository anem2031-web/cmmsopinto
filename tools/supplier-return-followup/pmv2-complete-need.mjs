/** Public-RPC acceptance sequence for a guarded copycmms2 test only. No DB API. */
export async function completePmv2CompensationNeed(rpc,fixture,proof) {
  if(String(proof?.databaseName).toLowerCase()!=="copycmms2"||new URL(proof?.baseUrl).origin!=="http://localhost:4002") throw Error("PMV2 completion fixture requires localhost:4002/copycmms2 proof");
  const s={...(proof.resume??{})},rows=value=>Array.isArray(value)?value:value?.items??[];
  const assert=(condition,message)=>{if(!condition)throw Error(message);};
  const source={taskId:Number(fixture.taskId),taskItemId:Number(fixture.taskItemId),requestItemId:Number(fixture.requestItemId),requestId:Number(fixture.requestId),catalogItemId:Number(fixture.references?.catalogItemId??fixture.catalogItemId),quantity:Number(fixture.references?.quantity??4),unit:String(fixture.references?.unit??"قطعة")};
  assert(Object.entries(source).filter(([key])=>key!=="unit").every(([,value])=>Number(value)>0),"Complete the PMV2 source fixture first");
  if(s.source)assert(JSON.stringify(s.source)===JSON.stringify(source),"PMV2 completion resume source changed");
  s.source=source;s.marker=s.marker||`${fixture.label}:replacement-transfer:${source.requestItemId}`;
  const save=async(stage)=>{s.stage=stage;await proof.checkpoint?.(structuredClone(s));};
  const taskInput={taskId:source.taskId,taskItemId:source.taskItemId};
  const readOriginal=async()=>{
    const state=await rpc.query("pmv2.technician.materialState",taskInput);
    const need=rows(state.requests).find(row=>Number(row.requestItemId)===source.requestItemId);
    assert(need&&Number(need.requestId)===source.requestId&&Number(need.catalogItemId)===source.catalogItemId&&Number(need.requestedQuantity)===source.quantity&&String(need.unitSnapshot).trim()===source.unit.trim(),"Original PMV2 need identity/quantity/unit changed");
    return {state,need};
  };
  const initial=await readOriginal();
  s.originalName=s.originalName??initial.need.itemNameSnapshot;
  assert(initial.need.itemNameSnapshot===s.originalName,"Original PMV2 need description changed");
  await save("sourceVerified");

  if(!s.transferHandoff) {
    s.transferHandoff=await rpc.mutate("pmv2.warehouse.prepareTransferHandoff",{requestItemId:source.requestItemId});
    assert(s.transferHandoff.fulfillmentAllocations?.length>0&&s.transferHandoff.fulfillmentAllocations.length<=20,"PMV2 transfer allocations unavailable");
    assert(Math.abs(s.transferHandoff.fulfillmentAllocations.reduce((sum,part)=>sum+Number(part.originalQuantity),0)-source.quantity)<.0005,"PMV2 transfer does not cover exact original need");
    await save("transferPrepared");
  }
  const handoff=s.transferHandoff;
  const cards=rows(await rpc.query("transfers.listCards",{warehouseId:handoff.sourceWarehouse.id})).filter(row=>row.notes===s.marker);
  assert(cards.length<=1,"More than one physical transfer matches this test marker; inspect before continuing");
  if(!cards.length) {
    assert(!s.transferAttempted,"Physical transfer response was interrupted and no confirmed card is visible yet; recheck before permitting a new physical transfer");
    s.transferAttempted=true;await save("transferAttempt");
    s.transferResult=await rpc.mutate("transfers.createBatch",{fromWarehouseId:handoff.sourceWarehouse.id,toWarehouseId:handoff.destinationWarehouse.id,notes:s.marker,items:handoff.fulfillmentAllocations.map(part=>({fromInventoryId:part.sourceInventoryId,quantity:part.quantity,lotTrackingToken:part.trackingToken,notes:s.marker}))});
    await save("transferPosted");
    assert(s.transferResult.results?.length===handoff.fulfillmentAllocations.length&&s.transferResult.results.every(row=>row.success),"Physical transfer batch partially failed; inspect its saved results before resuming");
  }
  const confirmedCards=cards.length?cards:rows(await rpc.query("transfers.listCards",{warehouseId:handoff.sourceWarehouse.id})).filter(row=>row.notes===s.marker);
  assert(confirmedCards.length===1,"Confirmed physical transfer card not found");
  const transfer=await rpc.query("transfers.getBatchDetail",{key:confirmedCards[0].key});
  assert(Number(transfer.fromWarehouseId)===Number(handoff.sourceWarehouse.id)&&Number(transfer.toWarehouseId)===Number(handoff.destinationWarehouse.id)&&rows(transfer.items).length===handoff.fulfillmentAllocations.length,"Physical transfer source/destination or line count mismatch");
  for(const part of handoff.fulfillmentAllocations)assert(rows(transfer.items).some(row=>Number(row.lotId)===Number(part.lotId)&&Number(row.quantity)===Number(part.quantity)),"Confirmed transfer does not match the prepared physical lot/quantity");
  s.transferNumbers=transfer.items.map(row=>row.transferNumber);s.transferDetail=transfer;await save("transferVerified");
  const transferState=(await readOriginal()).need;
  if(transferState.status==="waiting_warehouse") s.transferLink=await rpc.mutate("pmv2.warehouse.linkConfirmedTransfers",{requestItemId:source.requestItemId,transferNumbers:s.transferNumbers});
  else {
    assert(["issued_to_team","consumed"].includes(transferState.status)&&Number(transferState.issuedToTeamQuantity)===source.quantity,"Unexpected PMV2 source state after physical transfer");
    s.transferLink={recovered:true,status:transferState.status,issuedToTeamQuantity:transferState.issuedToTeamQuantity};
  }
  assert(["issued_to_team","consumed"].includes(s.transferLink.status)&&Number(s.transferLink.issuedToTeamQuantity)===source.quantity,"Replacement did not cover original PMV2 shortage");
  await save("transferLinked");

  const readCompletion=async()=>rows(await rpc.query("pmv2.technician.completionMaterials",taskInput)).find(row=>Number(row.catalogItemId)===source.catalogItemId);
  let material=await readCompletion();
  if(!material||Number(material.issuedQuantity)+.0005<source.quantity) {
    let queue=rows(await rpc.query("pmv2.warehouse.readyToIssueQueue"));
    let candidate=queue.find(row=>Number(row.taskId)===source.taskId&&Number(row.taskItemId)===source.taskItemId&&Number(row.materialRequestItemId)===source.requestItemId);
    assert(candidate,"PMV2 requirement missing from ready issue queue");
    s.routeDecisionActionId=Number(candidate.routeDecisionActionId);await save("issuePrepared");
    if(candidate.pendingRelink?.deliveryNumber) {
      s.relink=await rpc.mutate("pmv2.warehouse.linkConfirmedDelivery",{routeDecisionActionId:s.routeDecisionActionId,deliveryNumber:candidate.pendingRelink.deliveryNumber});
      await save("issueRelinked");
      material=await readCompletion();
      queue=rows(await rpc.query("pmv2.warehouse.readyToIssueQueue"));candidate=queue.find(row=>Number(row.routeDecisionActionId)===s.routeDecisionActionId);
    }
    if(!material||Number(material.issuedQuantity)+.0005<source.quantity) {
      assert(candidate?.canIssue||candidate?.canIssueToAuthorizedExecutor,candidate?.blocker||"PMV2 replacement is not issuable");
      s.issueResult=await rpc.mutate("pmv2.warehouse.issueReadyRequirement",{routeDecisionActionId:s.routeDecisionActionId,...(proof.deliveredToId?{deliveredToId:proof.deliveredToId}: {})});
      await save("issuePosted");assert(s.issueResult.completed,"PMV2 issue is partial or requires link-only recovery; saved result must be reviewed");
    }
    material=await readCompletion();
  }
  assert(material&&Number(material.requiredQuantity)===source.quantity&&Number(material.issuedQuantity)===source.quantity,"PMV2 readiness original coverage is incorrect");
  const parts=material.physicalParts??[];
  assert(parts.length>0&&parts.every(part=>part.replacementPlanId),"The test requires approved replacement-only physical deliveries");
  assert(new Set(parts.map(part=>part.catalogItemId)).size===1&&new Set(parts.map(part=>part.unit)).size===1,"Use a single replacement Catalog/unit for the5-of6 acceptance sample");
  if(proof.expectedReplacementCatalogItemId)assert(parts.every(part=>Number(part.catalogItemId)===Number(proof.expectedReplacementCatalogItemId)),"Unexpected replacement Catalog identity");
  const totalPhysical=parts.reduce((sum,part)=>sum+Number(part.quantity),0),actualUsed=Number(proof.usedPhysicalQuantity??5);
  assert(totalPhysical===Number(proof.expectedPhysicalQuantity??6)&&actualUsed>=0&&actualUsed<totalPhysical,"The acceptance sample expects6 issued/5 used/1 returned");
  s.physicalParts=parts;s.originalCompletion=material;await save("issueVerified");
  let remainingUsed=actualUsed;
  const physicalUsages=parts.map(part=>{const usedQuantity=Math.min(remainingUsed,Number(part.quantity));remainingUsed-=usedQuantity;return{deliveryDocumentId:part.deliveryDocumentId,usedQuantity};});
  const stateBeforeResult=await readOriginal();
  if(stateBeforeResult.state.itemStatus!=="completed") {
    s.physicalUsages=physicalUsages;await save("usagePrepared");
    s.completionResult=await rpc.mutate("pmv2.technician.submitBasicResult",{...taskInput,result:"fixed",note:s.marker,materialUsages:[{catalogItemId:source.catalogItemId,usedQuantity:0,physicalUsages}]});
    await save("usageDeclared");assert(s.completionResult.hasPhysicalReturns===true,"Actual unused replacement was not exposed for return");
  }
  const deliveries=new Set(parts.map(part=>Number(part.deliveryDocumentId)));
  const pending=rows(await rpc.query("pmv2.warehouse.pendingReturns")).filter(row=>row.physicalMode&&Number(row.catalogItemId)===source.catalogItemId&&row.physicalUsages?.length===parts.length&&row.physicalUsages.every(part=>deliveries.has(Number(part.deliveryDocumentId))));
  assert(pending.length<=1,"Duplicate PMV2 usage declarations found");
  if(pending.length) {
    const returnCase=pending[0];
    assert(Number(returnCase.remainingReturnQuantity)===totalPhysical-actualUsed,"Pending return does not equal actual unused quantity");
    s.declarationActionId=Number(returnCase.declarationActionId);s.pendingReturn=returnCase;await save("returnPrepared");
    if(s.returnAttempted&&!s.returnResult?.completed) {
      s.authoritativeReturns=rows(await rpc.query("warehouseReturns.list")).filter(row=>deliveries.has(Number(row.sourceDeliveryDocumentId)));
      await save("returnAttemptReview");
      throw Error("Previous physical return attempt was interrupted; inspect saved authoritative return rows and PMV2 linkage before repeating it");
    }
    s.returnAttempted=true;await save("returnAttempt");
    s.returnResult=await rpc.mutate("pmv2.warehouse.confirmPendingReturn",{declarationActionId:s.declarationActionId,lotAllocations:returnCase.lots.map(lot=>({lotId:lot.lotId,quantity:lot.returnableQuantity}))});
    await save("returnPosted");assert(s.returnResult.completed,"Actual unused replacement return did not complete");
  } else if(!s.returnResult?.completed) {
    const actual=rows(await rpc.query("warehouseReturns.list")).filter(row=>deliveries.has(Number(row.sourceDeliveryDocumentId)));
    assert(actual.reduce((sum,row)=>sum+Number(row.returnedQuantity),0)===totalPhysical-actualUsed,"No pending return is visible and exact physical return history was not found");
    s.returnResult={completed:true,recovered:true,posted:actual.map(row=>({returnId:row.id,returnNumber:row.returnNumber,returnedQuantity:row.returnedQuantity,sourceDeliveryDocumentId:row.sourceDeliveryDocumentId}))};await save("returnRecovered");
  }
  const after=await readOriginal();assert(after.need.itemNameSnapshot===s.originalName&&after.need.status==="consumed"&&after.state.itemStatus==="completed","Original PMV2 need was not preserved and reconciled after physical return");
  s.originalAfter=after.need;s.taskAfter={itemStatus:after.state.itemStatus,itemResult:after.state.itemResult};
  s.result={originalQuantity:source.quantity,originalCatalogItemId:source.catalogItemId,physicalIssued:totalPhysical,physicalUsed:actualUsed,physicalReturned:totalPhysical-actualUsed,actualCatalogItemId:Number(parts[0].catalogItemId),actualUnit:parts[0].unit,deliveryDocumentIds:parts.map(part=>part.deliveryDocumentId),transferNumbers:s.transferNumbers,returnIds:s.returnResult.posted?.map(row=>row.returnId)??[]};
  await save("complete");return structuredClone(s);
}
