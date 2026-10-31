/** Public-RPC fixture only. No DB connection or credential persistence. */
export async function createPmv2SourceFixture(rpc,input) {
  if(String(input.proof?.databaseName).toLowerCase()!=="copycmms2"||new URL(input.proof?.baseUrl).origin!=="http://localhost:4002") throw Error("PMV2 fixture requires localhost:4002/copycmms2 proof");
  const {teamId,siteId,sectionId,categoryId,catalogItemId,unit,quantity,date}=input;
  if(![teamId,siteId,sectionId,categoryId,catalogItemId].every(id=>Number.isSafeInteger(id)&&id>0)||!(quantity>0)||!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error("Resolve current fixture master references first");
  const references={teamId,siteId,sectionId,categoryId,catalogItemId,unit,quantity,date},s={...(input.resume??{})};
  const assert=(condition,message)=>{if(!condition)throw Error(message);},rows=value=>Array.isArray(value)?value:value?.items??[];
  const one=(list,name)=>{assert(list.length<=1,"Duplicate "+name+"; inspect before retry");return list[0];};
  if(s.references)assert(JSON.stringify(s.references)===JSON.stringify(references),"Resume references changed");
  s.references=references;s.label=s.label||input.label||`TEST-SUPPLIER-RETURN-PMV2-${Date.now()}`;
  if(input.label)assert(input.label===s.label,"Resume label changed");
  const save=async(stage)=>{s.stage=stage;await input.checkpoint?.(structuredClone(s));};
  await save("references");
  const team=rows(await rpc.query("pmv2.organization.teams.list")).find(row=>Number(row.id)===teamId);
  assert(team&&team.isActive!==false&&Number(team.isActive)!==0,"Recorded PMV2 team missing/inactive (maintenance-team IDs differ)");
  let checklist=s.checklistId?(await rpc.query("pmv2.checklists.get",{id:s.checklistId})).checklist:one(rows(await rpc.query("pmv2.checklists.list",{includeInactive:true})).filter(row=>row.name===s.label),"checklist");
  if(!checklist)checklist=await rpc.mutate("pmv2.checklists.create",{name:s.label});
  s.checklistId=Number(checklist.id);await save("checklist");
  const checked=await rpc.query("pmv2.checklists.get",{id:s.checklistId});assert(checked.checklist?.name===s.label,"Recorded checklist identity changed");
  let checklistItem=one(rows(checked.items).filter(row=>row.title===s.label),"checklist item");
  if(s.checklistItemId)assert(Number(checklistItem?.id)===Number(s.checklistItemId),"Recorded checklist item missing");
  if(!checklistItem)checklistItem=await rpc.mutate("pmv2.checklists.items.create",{checklistId:s.checklistId,title:s.label,frequency:"daily",isRequired:true,isActive:true});
  s.checklistItemId=Number(checklistItem.id);await save("checklistItem");
  let program=s.programId?(await rpc.query("pmv2.programs.get",{id:s.programId})).program:one(rows(await rpc.query("pmv2.programs.list",{includeInactive:true})).filter(row=>row.title===s.label),"program");
  if(!program)program=await rpc.mutate("pmv2.programs.create",{title:s.label,teamId,checklistId:s.checklistId});
  s.programId=Number(program.id);await save("program");
  const programState=await rpc.query("pmv2.programs.get",{id:s.programId});
  assert(programState.program?.title===s.label&&Number(programState.program.teamId)===teamId&&Number(programState.program.checklistId)===s.checklistId,"Recorded program/team/checklist mismatch");
  const targets=rows(programState.targets);assert(targets.every(row=>Number(row.sectionId)===sectionId&&row.siteId==null&&row.assetId==null),"Foreign target on fixture program; refusing scheduler");
  let target=one(targets,"target");if(s.targetId)assert(Number(target?.id)===Number(s.targetId),"Recorded target missing");
  if(!target)target=await rpc.mutate("pmv2.programs.targets.add",{programId:s.programId,type:"section",sectionId});
  s.targetId=Number(target.id);await save("target");
  // Idempotent retry is scoped to this single program, never a global schedule.
  const scheduled=await rpc.mutate("pmv2.scheduler.runForDate",{date,programId:s.programId});
  assert(!scheduled.errors?.length&&Number(scheduled.createdTasks||0)+Number(scheduled.existingTasks||0)===1,"Scoped scheduler failed: "+JSON.stringify(scheduled));
  await save("scheduled");
  const task=one(rows(await rpc.query("pmv2.tasks.list",{teamId,dateFrom:date,dateTo:date,search:s.label,pageSize:50})).filter(row=>Number(row.programId)===s.programId),"task");
  assert(task&&(!s.taskId||Number(s.taskId)===Number(task.id)),"Recorded task missing/changed");s.taskId=Number(task.id);await save("task");
  const item=one(rows(await rpc.query("pmv2.tasks.items",{taskId:s.taskId})).filter(row=>row.titleSnapshot===s.label||row.title===s.label),"task item");
  assert(item&&(!s.taskItemId||Number(s.taskItemId)===Number(item.id)),"Recorded task item missing/changed");s.taskItemId=Number(item.id);await save("taskItem");
  const taskInput={taskId:s.taskId,taskItemId:s.taskItemId};
  let materialState=await rpc.query("pmv2.technician.materialState",taskInput);
  if(materialState.itemStatus==="pending"){await rpc.mutate("pmv2.technician.startItem",taskInput);materialState=await rpc.query("pmv2.technician.materialState",taskInput);}
  if(materialState.itemStatus==="in_progress"){await rpc.mutate("pmv2.technician.submitDependencyResult",{...taskInput,result:"needs_material",note:s.label});materialState=await rpc.query("pmv2.technician.materialState",taskInput);}
  assert(Number(materialState.teamId)===teamId,"PMV2 execution team changed");
  let material=one(rows(materialState.requests).filter(row=>Number(row.catalogItemId)===catalogItemId&&Number(row.requestedQuantity)===quantity&&String(row.unitSnapshot).trim()===unit.trim()),"material request");
  if(s.requestItemId)assert(material&&Number(material.requestItemId)===Number(s.requestItemId)&&Number(material.requestId)===Number(s.requestId),"Recorded material source changed");
  if(!material){assert(materialState.itemStatus==="waiting_material"&&materialState.itemResult==="needs_material","Task no longer awaits material");const created=await rpc.mutate("pmv2.technician.submitMaterialNeed",{...taskInput,catalogItemId,quantity,unit});assert(created.route==="material_request"&&created.materialRequestItemId,"Original test item must have no team stock");material={requestId:created.requestId,requestItemId:created.materialRequestItemId};}
  s.requestId=Number(material.requestId);s.requestItemId=Number(material.requestItemId);await save("materialRequest");
  const queue=await rpc.query("pmv2.warehouse.waitingMaterialQueue"),request=rows(queue).find(row=>Number(row.requestItemId)===s.requestItemId),source=one(request?.purchaseLinks??[],"source purchase");
  if(source){if(s.purchaseOrderId)assert(Number(s.purchaseOrderId)===Number(source.purchaseOrderId),"Recorded order differs from actual PMV2 source");s.purchaseOrderId=Number(source.purchaseOrderId);}
  if(!s.purchaseOrderId){assert(request,"Request left queue; inspect before creating another order");s.handoff=await rpc.mutate("pmv2.warehouse.preparePurchaseHandoff",{requestItemId:s.requestItemId});await save("purchaseHandoff");const h=s.handoff,order=await rpc.mutate("purchaseOrders.create",{siteId,sectionId,categoryId,pmv2RequestItemId:s.requestItemId,notes:s.label,items:[{catalogItemId,itemName:h.itemName,quantity:Math.ceil(h.purchaseMinimumQuantity),unit:h.unit,unitId:h.unitId??undefined,deliveryLeadDays:4,photoUrl:input.photoUrl}]});s.purchaseOrderId=Number(order.id);await save("purchaseOrder");}
  const order=await rpc.query("purchaseOrders.getById",{id:s.purchaseOrderId});
  assert(String(order.notes??"").includes(s.label)&&Number(order.siteId)===siteId&&Number(order.sectionId)===sectionId&&rows(order.items).length===1&&Number(order.items[0].catalogItemId)===catalogItemId,"Recorded PO context/item differs from fixture");
  if(source)assert(order.items.some(row=>Number(row.id)===Number(source.purchaseOrderItemId)),"PMV2 source item does not belong to recorded PO");
  s.order={id:Number(order.id),poNumber:order.poNumber,itemId:Number(order.items[0].id)};await save("complete");return structuredClone(s);
}
