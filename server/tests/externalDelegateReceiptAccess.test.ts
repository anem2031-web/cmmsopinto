import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
import { APP_ROLE, isDelegateRole } from "../../shared/roles";
import { externalDelegateRpcAllowed } from "../../shared/external-delegate-access";
const state=vi.hoisted(()=>({db:null as any,memory:null as any,rows:[] as any[],notes:[] as any[],events:[] as string[],prepare:vi.fn(),decide:vi.fn(),list:vi.fn(),users:vi.fn()}));
vi.mock("../_core/db/client",()=>({getDb:async()=>state.db}));
vi.mock("../services/translation/translationEngine",()=>({queueTranslation:vi.fn()}));
vi.mock("../services/translation/translation",()=>({detectLanguage:async()=>"ar"}));
vi.mock("../services/external-route-review",()=>({returnExternalRoute:vi.fn(),readExternalRouteReviews:vi.fn(),decideExternalRoute:vi.fn()}));
vi.mock("../routers/tickets/tickets.access",()=>({assertTicketReadable:async(user:any)=>{if(user.role==="delegate")throw Object.assign(Error("ticket forbidden"),{code:"FORBIDDEN"});}}));
vi.mock("../_core/db",()=>({getDb:async()=>state.db,
  getUserById:async(id:number)=>state.memory.prepare("SELECT * FROM users WHERE id=?").get(id),
  getTicketById:async(id:number)=>state.memory.prepare("SELECT * FROM tickets WHERE id=?").get(id),
  getTicketItemById:async(id:number)=>state.memory.prepare("SELECT * FROM ticket_items WHERE id=?").get(id),
  getTicketItems:async(id:number)=>state.memory.prepare("SELECT * FROM ticket_items WHERE ticketId=?").all(id),
  getExternalMaintenanceJobById:async(id:number)=>state.memory.prepare("SELECT * FROM external_maintenance_jobs WHERE id=?").get(id),
  getExternalMaintenanceJobByTicketId:async(id:number)=>state.memory.prepare("SELECT * FROM external_maintenance_jobs WHERE ticketId=?").get(id),
  listExternalMaintenanceJobsForDelegate:state.list,listExternalMaintenanceJobs:async()=>state.rows,
  listPathCTicketsWaitingWarehousePreparation:async()=>[],getUsersByRole:state.users,
  prepareExternalMaintenanceJob:state.prepare,decideExternalMaintenanceDelegateReceipt:state.decide,
  createNotification:async(input:any)=>{state.events.push("notification");state.notes.push(input);},createAuditLog:async()=>1,
}));
import { router } from "../routers/_shared/procedures";
import { externalMaintenanceRouter } from "../routers/external-maintenance/external-maintenance.router";
import { loadExternalDelegateScopes, isExternalDelegateJob, requireExternalDelegateJobs } from "../_core/authz/external-delegate-access";
import { assertMediaAccess, mediaAccessPort } from "../_core/authz/media-access";
import { isWaitingExternalWarehousePreparation } from "../_core/authz/external-preparation-photo";
const api=router({externalMaintenance:externalMaintenanceRouter});
let f:ReturnType<typeof purchaseSpecificationsDatabase>;
const actor=(id=30,role="delegate",isActive=1)=>({id,role,isActive});
const caller=(user=actor(),projected=false)=>api.createCaller({user:projected?{...user,role:"admin"}:user,authenticatedUser:user,req:{},res:{}} as any).externalMaintenance;
const imageKey="cmms/uploads/u-20/external.jpg";
const getJob=(id=1)=>state.memory.prepare("SELECT * FROM external_maintenance_jobs WHERE id=?").get(id);
const row=(id=1)=>({job:getJob(id),ticketNumber:"MT-TEST",ticketTitle:"Fault",ticketDescription:"Original fault description"});
beforeEach(()=>{
  vi.clearAllMocks();f=purchaseSpecificationsDatabase();state.db=f.db;state.memory=f.memory;state.notes=[];state.events=[];
  f.memory.exec(`CREATE TABLE tickets(id INTEGER PRIMARY KEY,ticketNumber TEXT,title TEXT,description TEXT,maintenancePath TEXT,status TEXT,beforePhotoUrl TEXT);
    CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER,itemNumber INTEGER,maintenancePath TEXT,status TEXT);
    CREATE TABLE external_maintenance_jobs(id INTEGER PRIMARY KEY,ticketId INTEGER,ticketItemId INTEGER,delegateId INTEGER,status TEXT,purchaseOrderId INTEGER,gateExitApprovedAt TEXT,
      assetBeforePhotoUrl TEXT,purchaseTitle TEXT,delegateReceiptStatus TEXT,delegateReceiptById INTEGER,delegateReceiptAt TEXT,warehousePreparedAt TEXT,preparationRevision INTEGER,warehousePreparedById INTEGER);`);
  for(const user of [actor(),actor(40),actor(20,"warehouse"),actor(9,"gate_security"),actor(1,"admin")])f.insert("users",user);
  f.insert("tickets",{id:100,ticketNumber:"MT-TEST",title:"Fault",description:"Original fault description",maintenancePath:"B",status:"work_approved",beforePhotoUrl:"/api/media?key=cmms%2Fticket.jpg"});
  f.insert("ticket_items",{id:200,ticketId:100,itemNumber:1,maintenancePath:"C",status:"work_approved"});
  f.insert("external_maintenance_jobs",{id:1,ticketId:100,ticketItemId:200,delegateId:30,status:"waiting_delegate_receipt",purchaseTitle:"Exact raw title",delegateReceiptStatus:"pending",
    assetBeforePhotoUrl:`/api/media?key=${encodeURIComponent(imageKey)}`,preparationRevision:1,warehousePreparedById:20,warehousePreparedAt:"2026-11-04 12:00:00"});
  state.rows=[row()];state.list.mockImplementation(async()=>state.rows);
  state.users.mockImplementation(async(role:string)=>f.memory.prepare("SELECT * FROM users WHERE role=?").all(role));
  state.prepare.mockImplementation(async(input:any)=>{state.events.push("prepared");return{jobId:1,ticketId:100,ticketItemId:200,delegateId:input.delegateId,exitDocumentNumber:"EX-1",preparationRevision:1};});
  state.decide.mockImplementation(async(input:any)=>{
    const job=getJob(input.jobId);if(job.delegateId!==input.delegateId)throw Error("EXTERNAL_DELEGATE_RECEIPT_FORBIDDEN");
    if(job.preparationRevision!==input.expectedRevision)throw Error("EXTERNAL_DELEGATE_RECEIPT_CONFLICT");
    state.events.push("committed");return{jobId:input.jobId,ticketId:100,ticketItemId:200,delegateId:input.delegateId,status:input.decision==="accept"?"waiting_gate_exit":"waiting_warehouse_preparation",preparationRevision:input.expectedRevision,exitDocumentNumber:"EX-1",warehousePreparedById:20};
  });
});
afterEach(()=>f.close());

describe("external delegate capability and current record assignment",()=>{
  it("returns the assigned pre-purchase job without permitting ticket details",async()=>{
    expect(await caller().listForDelegate()).toEqual(state.rows);
    expect(state.list).toHaveBeenCalledWith(30);
    await expect(caller().getByTicket({ticketId:100})).rejects.toThrow("ticket forbidden");
  });
  it.each(Object.values(APP_ROLE).filter(role=>!isDelegateRole(role)))("%s cannot directly invoke delegate-only APIs",async role=>{
    const user=actor(1,role);
    await expect(caller(user).listForDelegate()).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(caller(user).decideDelegateReceipt({jobId:1,expectedRevision:1,decision:"accept"})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(state.list).not.toHaveBeenCalled();expect(state.decide).not.toHaveBeenCalled();
  });
  it("admits the active assigned delegate manager through the same list and decision APIs",async()=>{
    f.memory.exec("UPDATE users SET role='delegate_manager' WHERE id=30");
    const manager=actor(30,"delegate_manager");
    expect(await caller(manager).listForDelegate()).toHaveLength(1);
    await expect(caller(manager).decideDelegateReceipt({jobId:1,expectedRevision:1,decision:"accept"})).resolves.toMatchObject({delegateId:30});
    expect(state.decide).toHaveBeenCalledWith(expect.objectContaining({delegateId:30}));
  });
  it("denies inactive/current-role changes and admin projections",async()=>{
    await expect(caller(actor(30,"delegate",0),true).listForDelegate()).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(caller(actor(9,"observer"),true).listForDelegate()).rejects.toMatchObject({code:"FORBIDDEN"});
    f.memory.exec("UPDATE users SET role='warehouse' WHERE id=30");
    await expect(caller().listForDelegate()).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(state.list).not.toHaveBeenCalled();
  });
  it("filters mixed foreign and missing parents independently and preserves order",async()=>{
    f.insert("external_maintenance_jobs",{...getJob(),id:2,delegateId:40});
    f.insert("external_maintenance_jobs",{...getJob(),id:3,ticketId:999});
    state.rows=[row(2),row(1),row(3),row(1)];
    expect((await caller().listForDelegate()).map(value=>value.job.id)).toEqual([1,1]);
    await expect(caller().decideDelegateReceipt({jobId:2,expectedRevision:1,decision:"accept"})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(state.decide).not.toHaveBeenCalled();
  });
  it("rechecks assignment, revision and identity after an earlier successful list",async()=>{
    await caller().listForDelegate();f.memory.exec("UPDATE external_maintenance_jobs SET delegateId=40,preparationRevision=2 WHERE id=1");
    await expect(caller().decideDelegateReceipt({jobId:1,expectedRevision:1,decision:"accept"})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(caller(actor(40)).decideDelegateReceipt({jobId:1,expectedRevision:1,decision:"accept"})).rejects.toMatchObject({code:"CONFLICT"});
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=40");
    await expect(caller(actor(40)).decideDelegateReceipt({jobId:1,expectedRevision:2,decision:"accept"})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(state.notes).toEqual([]);
  });
  it("requires rejection reason and does not accept a client-selected actor",async()=>{
    await expect(caller().decideDelegateReceipt({jobId:1,expectedRevision:1,decision:"reject",reason:"  "})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(caller().decideDelegateReceipt({jobId:1,expectedRevision:1,decision:"accept",delegateId:40} as any)).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(state.decide).not.toHaveBeenCalled();
  });
  it("notifies gate only after acceptance commits; rejection notifies warehouse with reason",async()=>{
    await caller().decideDelegateReceipt({jobId:1,expectedRevision:1,decision:"accept"});
    expect(state.decide).toHaveBeenCalledWith({jobId:1,expectedRevision:1,decision:"accept",delegateId:30});
    expect(state.events).toEqual(["committed","notification"]);expect(state.notes.map(note=>note.userId)).toEqual([9]);
    state.events=[];state.notes=[];
    await caller().decideDelegateReceipt({jobId:1,expectedRevision:1,decision:"reject",reason:"لم يصل الأصل"});
    expect(state.notes).toEqual([expect.objectContaining({userId:20,message:expect.stringContaining("لم يصل الأصل")})]);
  });
  it("requires purchase title and notifies only the delegate on warehouse preparation",async()=>{
    const input={ticketId:100,ticketItemId:200,assetName:"Asset",assetBeforePhotoUrl:"https://fixture.invalid/before.jpg",assetBeforeCondition:"Broken",delegateId:30};
    await expect(caller(actor(20,"warehouse")).prepareByWarehouse(input as any)).rejects.toMatchObject({code:"BAD_REQUEST"});
    await caller(actor(20,"warehouse")).prepareByWarehouse({...input,purchaseTitle:"  Exact raw title  "});
    expect(state.prepare).toHaveBeenCalledWith(expect.objectContaining({purchaseTitle:"Exact raw title",warehousePreparedById:20}));
    expect(state.notes.map(note=>note.userId)).toEqual([30]);expect(state.events).toEqual(["prepared","notification"]);
  });
  it("hides pending and legacy-unaccepted gate cards without hiding historical post-gate records",async()=>{
    const accepted={...getJob(),status:"waiting_gate_exit",delegateReceiptStatus:"accepted",delegateReceiptById:30,delegateReceiptAt:"2026-11-04 12:01:00"};
    state.rows=[{job:{...accepted,id:2,delegateReceiptStatus:null}},{job:accepted},{job:{...accepted,id:3,status:"purchase_cycle",purchaseTitle:null,delegateReceiptStatus:null}}];
    expect((await caller(actor(1,"admin")).listForGate()).map(value=>value.job.id)).toEqual([1,3]);
  });
  it("bounds large lists by distinct job scope chunks, including repeated parents",async()=>{
    for(let id=2;id<=1001;id++)f.insert("external_maintenance_jobs",{...getJob(),id});
    state.rows=Array.from({length:1001},(_,index)=>row(index+1));
    expect(await caller().listForDelegate()).toHaveLength(1001);
    expect(f.queries.map(query=>query.params.length)).toEqual([500,500,1]);
    f.queries.length=0;state.rows=Array(1200).fill(row());
    expect(await caller().listForDelegate()).toHaveLength(1200);expect(f.queries).toHaveLength(1);
  });
  it("propagates scope infrastructure failure instead of returning an empty list",async()=>{
    state.db={execute:async()=>{throw Error("fixture database unavailable");}};
    await expect(caller().listForDelegate()).rejects.toThrow("fixture database unavailable");
  });
});

describe("only the current assigned delegate sees the original external asset photo",()=>{
  const media=()=>({references:async()=>[{kind:"external",id:1,parentId:100}],authorize:mediaAccessPort.authorize});
  it("allows the exact pre-purchase photo, then denies it after reassignment",async()=>{
    await expect(assertMediaAccess(actor(),imageKey,media())).resolves.toBe(imageKey);
    await expect(assertMediaAccess(actor(),"cmms/other.jpg",media())).rejects.toMatchObject({code:"FORBIDDEN"});
    f.memory.exec("UPDATE external_maintenance_jobs SET delegateId=40 WHERE id=1");
    await expect(assertMediaAccess(actor(),imageKey,media())).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(assertMediaAccess(actor(40),imageKey,media())).resolves.toBe(imageKey);
  });
  it.each(["UPDATE external_maintenance_jobs SET ticketId=999 WHERE id=1","UPDATE ticket_items SET ticketId=999 WHERE id=200","UPDATE ticket_items SET maintenancePath='B' WHERE id=200","UPDATE ticket_items SET status='closed' WHERE id=200"])("does not grant media through a bad parent: %s",async change=>{
    f.memory.exec(change);await expect(assertMediaAccess(actor(),imageKey,media())).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("keeps generic ticket photos unavailable and uses independent record decisions",async()=>{
    const scope=await loadExternalDelegateScopes([1]);expect(isExternalDelegateJob(actor(),scope.get(1)!)).toBe(true);
    expect(isExternalDelegateJob(actor(40),scope.get(1)!)).toBe(false);
    await expect(requireExternalDelegateJobs(actor(),[1,999])).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(assertMediaAccess(actor(),imageKey,{references:async()=>[{kind:"ticket",id:100,parentId:100}],authorize:mediaAccessPort.authorize})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("keeps exact RPC type grants closed",()=>{
    expect(externalDelegateRpcAllowed(actor(),"query","externalMaintenance.listForDelegate")).toBe(true);
    expect(externalDelegateRpcAllowed(actor(),"mutation","externalMaintenance.listForDelegate")).toBe(false);
    expect(externalDelegateRpcAllowed(actor(),"query","externalMaintenance.decideDelegateReceipt")).toBe(false);
  });
  it("preserves warehouse initial-photo access for rejection and legacy re-preparation only",async()=>{
    expect(await isWaitingExternalWarehousePreparation(100)).toBe(false);
    f.memory.exec("UPDATE external_maintenance_jobs SET status='waiting_warehouse_preparation',delegateReceiptStatus='rejected' WHERE id=1");
    expect(await isWaitingExternalWarehousePreparation(100)).toBe(true);
    f.memory.exec("UPDATE external_maintenance_jobs SET status='waiting_gate_exit',purchaseTitle=NULL,delegateReceiptStatus=NULL,preparationRevision=0 WHERE id=1");
    expect(await isWaitingExternalWarehousePreparation(100)).toBe(true);
    f.memory.exec("UPDATE external_maintenance_jobs SET purchaseTitle='Exact raw title',delegateReceiptStatus='accepted',delegateReceiptById=30,delegateReceiptAt='2026-11-04 12:01:00',preparationRevision=1 WHERE id=1");
    expect(await isWaitingExternalWarehousePreparation(100)).toBe(false);
    f.memory.exec("UPDATE external_maintenance_jobs SET delegateReceiptById=40 WHERE id=1");
    expect(await isWaitingExternalWarehousePreparation(100)).toBe(true);
    f.memory.exec("UPDATE external_maintenance_jobs SET purchaseOrderId=5 WHERE id=1");
    expect(await isWaitingExternalWarehousePreparation(100)).toBe(false);
  });
});
