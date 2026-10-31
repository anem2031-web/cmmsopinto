import {describe,it,expect}from"vitest";
import {createPmv2SourceFixture}from"../../tools/supplier-return-followup/pmv2-source-fixture.mjs";
const input={proof:{databaseName:"copycmms2",baseUrl:"http://localhost:4002"},teamId:30001,siteId:390001,sectionId:150011,categoryId:2,catalogItemId:180230,unit:"قطعة",quantity:4,date:"2026-10-30",label:"TEST-PMV2-RESUME"};
function fixture(){
  const state:any={checklist:null,item:null,program:null,target:null,task:false,status:"pending",result:null,requests:[],order:null,lostOrderResponse:false};
  const writes:string[]=[];
  const rpc={query:async(name:string,args?:any):Promise<any>=>{
    switch(name){
      case"pmv2.organization.teams.list":return[{id:30001,isActive:1}];
      case"pmv2.checklists.list":return state.checklist?[state.checklist]:[];
      case"pmv2.checklists.get":return{checklist:state.checklist,items:state.item?[state.item]:[]};
      case"pmv2.programs.list":return state.program?[state.program]:[];
      case"pmv2.programs.get":return{program:state.program,targets:state.target?[state.target]:[]};
      case"pmv2.tasks.list":return{items:state.task?[{id:15,programId:13}]:[]};
      case"pmv2.tasks.items":return[{id:16,titleSnapshot:input.label}];
      case"pmv2.technician.materialState":return{teamId:30001,itemStatus:state.status,itemResult:state.result,requests:state.requests};
      case"pmv2.warehouse.waitingMaterialQueue":return{items:[{requestItemId:20,purchaseLinks:state.order?[{purchaseOrderId:17,purchaseOrderItemId:18}]:[]}]};
      case"purchaseOrders.getById":expect(args.id).toBe(17);return state.order;
      default:throw Error(name);
    }
  },mutate:async(name:string,args:any):Promise<any>=>{
    writes.push(name);
    switch(name){
      case"pmv2.checklists.create":return state.checklist={id:11,name:args.name};
      case"pmv2.checklists.items.create":return state.item={id:12,title:args.title};
      case"pmv2.programs.create":return state.program={id:13,...args};
      case"pmv2.programs.targets.add":return state.target={id:14,sectionId:args.sectionId,siteId:null,assetId:null};
      case"pmv2.scheduler.runForDate":expect(args).toEqual({date:input.date,programId:13});const existing=state.task;state.task=true;return{errors:[],createdTasks:existing?0:1,existingTasks:existing?1:0};
      case"pmv2.technician.startItem":state.status="in_progress";return{};
      case"pmv2.technician.submitDependencyResult":state.status="waiting_material";state.result="needs_material";return{};
      case"pmv2.technician.submitMaterialNeed":state.requests=[{requestId:19,requestItemId:20,catalogItemId:args.catalogItemId,requestedQuantity:args.quantity,unitSnapshot:args.unit}];return{route:"material_request",requestId:19,materialRequestItemId:20};
      case"pmv2.warehouse.preparePurchaseHandoff":return{itemName:"Original",purchaseMinimumQuantity:4,unit:"قطعة"};
      case"purchaseOrders.create":state.order={id:17,poNumber:"TEST-PO",notes:args.notes,siteId:args.siteId,sectionId:args.sectionId,items:[{id:18,catalogItemId:180230}]};if(state.lostOrderResponse){state.lostOrderResponse=false;throw Error("response interrupted");}return{id:17};
      default:throw Error(name);
    }
  }};
  return{rpc,state,writes};
}
describe("resumable public PMV2 source fixture",()=>{
  it("resumes after program checkpoint and reuses all recorded sources without duplicate creates",async()=>{
    const f=fixture();let saved:any;
    await expect(createPmv2SourceFixture(f.rpc,{...input,checkpoint:async(state:any)=>{saved=state;if(state.stage==="program")throw Error("pause");}})).rejects.toThrow("pause");
    const result=await createPmv2SourceFixture(f.rpc,{...input,resume:saved,checkpoint:async(state:any)=>{saved=state;}});
    expect(result.order).toEqual({id:17,poNumber:"TEST-PO",itemId:18});
    await createPmv2SourceFixture(f.rpc,{...input,resume:result});
    for(const action of["pmv2.checklists.create","pmv2.checklists.items.create","pmv2.programs.create","pmv2.programs.targets.add","pmv2.technician.submitMaterialNeed","purchaseOrders.create"])expect(f.writes.filter(name=>name===action)).toHaveLength(1);
  });
  it("discovers an atomic source purchase after its successful commit lost the response",async()=>{
    const f=fixture();f.state.lostOrderResponse=true;let saved:any;
    await expect(createPmv2SourceFixture(f.rpc,{...input,checkpoint:async(state:any)=>{saved=state;}})).rejects.toThrow("response interrupted");
    const result=await createPmv2SourceFixture(f.rpc,{...input,resume:saved});
    expect(result.purchaseOrderId).toBe(17);expect(f.writes.filter(name=>name==="purchaseOrders.create")).toHaveLength(1);
  });
  it("rejects changed resume references before any mutation",async()=>{
    const f=fixture();await expect(createPmv2SourceFixture(f.rpc,{...input,resume:{references:{...input,teamId:99}}})).rejects.toThrow("references");expect(f.writes).toHaveLength(0);
  });
});
