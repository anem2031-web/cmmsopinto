import{describe,it,expect}from"vitest";
import{completePmv2CompensationNeed}from"../../tools/supplier-return-followup/pmv2-complete-need.mjs";
const fixture={label:"TEST-PMV2-COMPENSATION",taskId:1,taskItemId:2,requestId:3,requestItemId:4,references:{catalogItemId:180300,quantity:4,unit:"قطعة"}};
const proof={databaseName:"copycmms2",baseUrl:"http://localhost:4002",expectedReplacementCatalogItemId:180302};
function rpcFixture(){
 const s:any={transfer:false,linked:false,issued:false,completed:false,returned:false,marker:"",lostTransfer:false};const writes:string[]=[];
 const part={deliveryDocumentId:44,lotCode:"LOT33",catalogItemId:180302,quantity:6,unit:"قطعة",originalQuantity:4,replacementPlanId:9};
 const need=()=>({requestId:3,requestItemId:4,catalogItemId:180300,requestedQuantity:4,unitSnapshot:"قطعة",itemNameSnapshot:"المفصلة الأصلية",issuedToTeamQuantity:s.linked?4:0,status:s.returned?"consumed":s.linked?"issued_to_team":"waiting_warehouse"});
 const rpc={query:async(name:string):Promise<any>=>{
  switch(name){
   case"pmv2.technician.materialState":return{itemStatus:s.completed?"completed":"waiting_material",itemResult:s.completed?"fixed":"needs_material",requests:[need()]};
   case"transfers.listCards":return s.transfer?[{key:"batch:1",notes:s.marker}]:[];
   case"transfers.getBatchDetail":return{fromWarehouseId:10,toWarehouseId:20,items:[{lotId:33,quantity:6,transferNumber:"TRB-TEST"}]};
   case"pmv2.technician.completionMaterials":return[{catalogItemId:180300,requiredQuantity:4,issuedQuantity:s.issued?4:0,physicalParts:s.issued?[part]:[]}];
   case"pmv2.warehouse.readyToIssueQueue":return s.issued?[]:[{taskId:1,taskItemId:2,materialRequestItemId:4,routeDecisionActionId:7,canIssue:true}];
   case"pmv2.warehouse.pendingReturns":return s.completed&&!s.returned?[{catalogItemId:180300,physicalMode:true,physicalUsages:[{deliveryDocumentId:44,usedQuantity:5}],declarationActionId:55,remainingReturnQuantity:1,lots:[{lotId:33,returnableQuantity:1}]}]:[];
   case"warehouseReturns.list":return s.returned?[{id:66,returnNumber:"RTN-TEST",returnedQuantity:1,sourceDeliveryDocumentId:44}]:[];
   default:throw Error(name);
  }
 },mutate:async(name:string,args:any):Promise<any>=>{
  writes.push(name);switch(name){
   case"pmv2.warehouse.prepareTransferHandoff":return{sourceWarehouse:{id:10},destinationWarehouse:{id:20},fulfillmentAllocations:[{sourceInventoryId:100,catalogItemId:180302,materialName:"البديل",quantity:6,unit:"قطعة",originalQuantity:4,lotId:33,lotCode:"LOT33",trackingToken:"TOKEN33",replacementPlanId:9}]};
   case"transfers.createBatch":expect(args.items).toMatchObject([{fromInventoryId:100,quantity:6,lotTrackingToken:"TOKEN33"}]);s.transfer=true;s.marker=args.notes;if(s.lostTransfer){s.lostTransfer=false;throw Error("lost transfer response");}return{results:[{success:true,transferNumber:"TRB-TEST"}]};
   case"pmv2.warehouse.linkConfirmedTransfers":s.linked=true;return{status:"issued_to_team",issuedToTeamQuantity:4};
   case"pmv2.warehouse.issueReadyRequirement":s.issued=true;return{completed:true,posted:[{deliveryDocumentId:44}]};
   case"pmv2.technician.submitBasicResult":expect(args.materialUsages).toEqual([{catalogItemId:180300,usedQuantity:0,physicalUsages:[{deliveryDocumentId:44,usedQuantity:5}]}]);s.completed=true;return{hasPhysicalReturns:true};
   case"pmv2.warehouse.confirmPendingReturn":expect(args.lotAllocations).toEqual([{lotId:33,quantity:1}]);s.returned=true;return{completed:true,posted:[{returnId:66,returnNumber:"RTN-TEST",returnedQuantity:1}]};
   default:throw Error(name);
  }
 }};return{s,rpc,writes};
}
describe("public PMV2 replacement completion fixture",()=>{
 it("moves6physical, records5actual use and returns1while retaining original need4",async()=>{
  const f=rpcFixture();let checkpoint:any;
  const result=await completePmv2CompensationNeed(f.rpc,fixture,{...proof,checkpoint:async(value:any)=>{checkpoint=value;}});
  expect(result.result).toMatchObject({originalQuantity:4,originalCatalogItemId:180300,physicalIssued:6,physicalUsed:5,physicalReturned:1,actualCatalogItemId:180302,deliveryDocumentIds:[44],returnIds:[66]});
  expect(result.originalAfter.itemNameSnapshot).toBe("المفصلة الأصلية");
  await completePmv2CompensationNeed(f.rpc,fixture,{...proof,resume:checkpoint});
  for(const action of["transfers.createBatch","pmv2.warehouse.issueReadyRequirement","pmv2.technician.submitBasicResult","pmv2.warehouse.confirmPendingReturn"])expect(f.writes.filter(name=>name===action)).toHaveLength(1);
 });
 it("recovers an already committed transfer after its response was lost without repeating it",async()=>{
  const f=rpcFixture();f.s.lostTransfer=true;let checkpoint:any;
  await expect(completePmv2CompensationNeed(f.rpc,fixture,{...proof,checkpoint:async(value:any)=>{checkpoint=value;}})).rejects.toThrow("lost transfer response");
  const result=await completePmv2CompensationNeed(f.rpc,fixture,{...proof,resume:checkpoint});
  expect(result.result.physicalReturned).toBe(1);expect(f.writes.filter(name=>name==="transfers.createBatch")).toHaveLength(1);
 });
});
