import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { and,eq,isNull,getTableColumns } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { purchaseOrderItems,purchaseOrders,users } from "../../drizzle/schema";
import { router,protectedProcedure } from "../routers/_shared/procedures";
import { APP_ROLE,isDelegateRole } from "../../shared/roles";
import { purchaseSpecificationsDatabase } from "./fixtures/purchaseSpecificationsDatabase";
import { assignOwnDelegateItem,delegateAssignmentOptions,managerAssignableItemIds } from "../services/delegate-manager-assignment";

const actor={id:11,role:"delegate_manager",isActive:1};
let f:ReturnType<typeof purchaseSpecificationsDatabase>;
const item=(id=1)=>f.memory.prepare("SELECT * FROM purchase_order_items WHERE id=?").get(id) as any;
function expression(name:string,kind:"property"|"function",file="server/routers/purchase/purchase-orders.router.ts") {
  const source=ts.createSourceFile(file,readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);let text="";
  const visit=(node:ts.Node)=>{if(kind==="property"&&ts.isPropertyAssignment(node)&&node.name.getText(source)===name)text=node.initializer.getText(source);
    if(kind==="function"&&ts.isFunctionDeclaration(node)&&node.name?.text===name)text=node.getText(source).replace(/^export\s+/,"");ts.forEachChild(node,visit);};visit(source);
  if(!text)throw Error(name);return ts.transpileModule(`(${text})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
}
const notify=vi.fn();
function api() {
  const scope={z,TRPCError,protectedProcedure,assignOwnDelegateItem,delegateAssignmentOptions,console:{error:()=>{}},db:{getDb:async()=>f.db,withTransaction:(work:any)=>f.db.transaction(work),createNotification:notify}};
  return router({purchaseOrders:router({
    assignOwnDelegateItem:vm.runInNewContext(expression("assignOwnDelegateItem","property"),scope),
    delegateAssignmentOptions:vm.runInNewContext(expression("delegateAssignmentOptions","property"),scope),
  })});
}
const call=(user=actor)=>api().createCaller({user,authenticatedUser:user,req:{},res:{}} as any).purchaseOrders;
beforeEach(()=>{
  f=purchaseSpecificationsDatabase();notify.mockReset().mockResolvedValue(undefined);
  f.memory.exec(`ALTER TABLE users ADD COLUMN username TEXT;
    ALTER TABLE purchase_orders ADD COLUMN reviewedById INTEGER;ALTER TABLE purchase_orders ADD COLUMN reviewedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN delegateId INTEGER;ALTER TABLE purchase_order_items ADD COLUMN delegateAssignedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN batchId INTEGER;ALTER TABLE purchase_order_items ADD COLUMN delegateChangeRequestedAt TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedUnitCost TEXT;ALTER TABLE purchase_order_items ADD COLUMN estimatedTotalCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN estimatedById INTEGER;
    ALTER TABLE purchase_order_items ADD COLUMN actualUnitCost TEXT;ALTER TABLE purchase_order_items ADD COLUMN actualTotalCost TEXT;
    ALTER TABLE purchase_order_items ADD COLUMN purchasedAt TEXT;ALTER TABLE purchase_order_items ADD COLUMN purchasedById INTEGER;
    CREATE TABLE tickets(id INTEGER PRIMARY KEY,maintenancePath TEXT);CREATE TABLE ticket_items(id INTEGER PRIMARY KEY,ticketId INTEGER,maintenancePath TEXT);
    CREATE TABLE external_maintenance_jobs(id INTEGER PRIMARY KEY,purchaseOrderId INTEGER);
    CREATE TABLE supplier_return_replacement_plans(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER);
    CREATE TABLE delegate_pricing_bundle_items(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER,removedAt TEXT);
    CREATE TABLE purchase_order_item_history(id INTEGER PRIMARY KEY,purchaseOrderItemId INTEGER,purchaseOrderId INTEGER,eventType TEXT,previousStatus TEXT,newStatus TEXT,previousDelegateId INTEGER,newDelegateId INTEGER,actorUserId INTEGER,actorName TEXT,note TEXT,metadata TEXT);
  `);
  for(const user of [{...actor,name:"Manager",username:"manager"},{id:12,role:"delegate_manager",isActive:1,name:"Other manager"},{id:22,role:"delegate",isActive:1,name:"Delegate A",username:"a"},{id:23,role:"delegate",isActive:1,name:"Delegate B",username:"b"},{id:24,role:"delegate",isActive:0,name:"Disabled"},{id:1,role:"admin",isActive:1}])f.insert("users",user);
  f.insert("purchase_orders",{id:100,poNumber:"PR-TEST",status:"pending_estimate",reviewedById:9,reviewedAt:"2026-11-04 10:00:00",siteId:7,sectionId:8,packageId:90});
  for(let id=1;id<=3;id++)f.insert("purchase_order_items",{id,purchaseOrderId:100,itemName:`Item ${id}`,quantity:id+1,unit:"piece",status:"pending",reviewRole:"general_maintenance_manager",reviewedById:9,reviewedAt:"2026-11-04 10:00:00",delegateId:11,delegateAssignedAt:"2026-11-04 10:01:00",catalogItemId:50+id});
});
afterEach(()=>f.close());

describe("one-item delegation uses the existing reviewed purchase workflow",()=>{
  it("assigns against the actual item schema without invented test-only columns",async()=>{
    const allowed=new Set(Object.values(getTableColumns(purchaseOrderItems)).map(column=>column.name));
    const columns=f.memory.prepare("PRAGMA table_info(purchase_order_items)").all().map((column:any)=>column.name);
    expect(columns).not.toContain("estimatedAt");
    expect(columns.filter(name=>!allowed.has(name))).toEqual([]);
    expect(await call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22})).toEqual({itemId:1,delegateId:22,status:"pending"});
    expect(item().delegateId).toBe(22);
  });
  it("assigns two separate items to two delegates while the third remains with the manager and all source/financial fields stay exact",async()=>{
    const before=[item(1),item(2),item(3)],header=f.memory.prepare("SELECT * FROM purchase_orders").all();
    expect(await call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22})).toEqual({itemId:1,delegateId:22,status:"pending"});
    expect(await call().assignOwnDelegateItem({purchaseOrderId:100,itemId:2,delegateId:23})).toEqual({itemId:2,delegateId:23,status:"pending"});
    for(let index=0;index<3;index++) {
      const after=item(index+1),{delegateId:old,delegateAssignedAt:oldAt,...source}=before[index];
      const {delegateId:now,delegateAssignedAt:nowAt,...preserved}=after;
      expect(preserved).toEqual(source);expect(now).toBe([22,23,11][index]);
      if(index<2)expect(nowAt).not.toBe(oldAt);else expect(after).toEqual(before[index]);
    }
    expect(f.memory.prepare("SELECT * FROM purchase_orders").all()).toEqual(header);
    expect(f.memory.prepare("SELECT purchaseOrderItemId,previousDelegateId,newDelegateId,previousStatus,newStatus FROM purchase_order_item_history ORDER BY id").all()).toEqual([
      {purchaseOrderItemId:1,previousDelegateId:11,newDelegateId:22,previousStatus:"pending",newStatus:"pending"},
      {purchaseOrderItemId:2,previousDelegateId:11,newDelegateId:23,previousStatus:"pending",newStatus:"pending"}]);
    expect(f.memory.prepare("SELECT COUNT(*) AS total FROM audit_logs").get()).toMatchObject({total:2});
    expect(await managerAssignableItemIds(f.db,actor,[1,2,3])).toEqual(new Set([3]));
    expect(notify.mock.calls.map(([entry])=>entry.userId)).toEqual([22,23]);
  });
  it("returns only active ordinary delegate names without a user-directory grant",async()=>{
    expect(await call().delegateAssignmentOptions()).toEqual([{id:22,name:"Delegate A",username:"a"},{id:23,name:"Delegate B",username:"b"}]);
  });
  it.each(Object.values(APP_ROLE).filter(role=>role!=="delegate_manager"))("%s cannot invoke manager transfer or its directory directly",async role=>{
    const user={id:11,role,isActive:1};
    await expect(call(user).assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(call(user).delegateAssignmentOptions()).rejects.toMatchObject({code:"FORBIDDEN"});expect(item().delegateId).toBe(11);
  });
  it.each(["UPDATE users SET isActive=0 WHERE id=11","UPDATE users SET role='delegate' WHERE id=11"])("uses the actual current manager identity: %s",async change=>{
    f.memory.exec(change);await expect(call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(item().delegateId).toBe(11);
  });
  it.each([12,24,1,999])("rejects nonordinary/inactive/missing target %s",async delegateId=>{
    await expect(call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(item().delegateId).toBe(11);
  });
  it("rejects foreign item IDs, cross-parent IDs, multi-item payloads and old manager submissions",async()=>{
    await expect(call().assignOwnDelegateItem({purchaseOrderId:999,itemId:1,delegateId:22})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22,items:[2]} as any)).rejects.toMatchObject({code:"BAD_REQUEST"});
    await call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22});
    await expect(call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:23})).rejects.toMatchObject({code:"FORBIDDEN"});expect(item().delegateId).toBe(22);
  });
  it.each(["status='pending_review'","status='estimated'","status='approved'","status='purchased'","batchId=7","estimatedUnitCost='0'","estimatedTotalCost='0'","estimatedById=11","actualUnitCost='2'","purchasedAt='now'","delegateChangeRequestedAt='now'","reviewedById=NULL","reviewedAt=NULL"])("does not transfer an ineligible source: %s",async update=>{
    f.memory.exec(`UPDATE purchase_order_items SET ${update} WHERE id=1`);
    await expect(call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22})).rejects.toMatchObject({code:"CONFLICT"});
    expect(item().delegateId).toBe(11);expect(f.memory.prepare("SELECT COUNT(*) AS total FROM audit_logs").get()).toMatchObject({total:0});
  });
  it.each(["INSERT INTO external_maintenance_jobs VALUES(1,100)","INSERT INTO supplier_return_replacement_plans VALUES(1,1)","INSERT INTO delegate_pricing_bundle_items VALUES(1,1,NULL)","INSERT INTO tickets VALUES(7,'C');UPDATE purchase_orders SET ticketId=7 WHERE id=100","UPDATE purchase_orders SET ticketId=999 WHERE id=100"])("excludes external, compensation, pricing and missing sources: %s",async update=>{
    f.memory.exec(update);await expect(call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22})).rejects.toMatchObject({code:"CONFLICT"});
    expect(item().delegateId).toBe(11);
  });
  it("rolls assignment and history back when audit fails and preserves commit success if notification fails",async()=>{
    f.memory.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'audit offline'); END");
    await expect(call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22})).rejects.toThrow("audit offline");
    expect(item().delegateId).toBe(11);expect(f.memory.prepare("SELECT COUNT(*) AS total FROM purchase_order_item_history").get()).toMatchObject({total:0});
    f.memory.exec("DROP TRIGGER fail_audit");notify.mockRejectedValueOnce(Error("notification offline"));
    await expect(call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22})).resolves.toMatchObject({delegateId:22});
  });
  it("bounds managerAssignable facts by distinct chunks and keeps missing/foreign rows independent",async()=>{
    for(let id=4;id<=1001;id++)f.insert("purchase_order_items",{...item(3),id});
    f.queries.length=0;expect((await managerAssignableItemIds(f.db,actor,Array.from({length:1001},(_,index)=>index+1))).size).toBe(1001);
    expect(f.queries.map(query=>query.params.length)).toEqual([1,500,500,1]);
    f.memory.exec("UPDATE purchase_order_items SET delegateId=22 WHERE id=2");f.queries.length=0;
    expect(await managerAssignableItemIds(f.db,actor,[1,2,9999,...Array(1200).fill(1)])).toEqual(new Set([1]));expect(f.queries).toHaveLength(2);
    await expect(managerAssignableItemIds({execute:async()=>{throw Error("offline");}},actor,[1])).rejects.toThrow("offline");
  });
});

describe("stale pricing and editing cannot overtake manager reassignment",()=>{
  function pricingWriter() {
    return vm.runInNewContext(expression("updatePOItemIfDelegateChangeUnlocked","function","server/_core/db/purchase.ts"),{
      purchaseOrderItems,and,eq,isNull,getDb:async()=>f.db,pricingBundlesEnabled:()=>false,
      readPOItemHistorySnapshot:async()=>item(),recordPOItemMutationHistory:vi.fn(),
    });
  }
  it("rejects the old manager's price after transfer and permits the new delegate's ordinary pricing state",async()=>{
    await call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22});
    const write=pricingWriter();
    expect(await write(1,{estimatedUnitCost:"5",estimatedTotalCost:"10",status:"estimated"},"pending",undefined,undefined,undefined,11)).toBe(false);
    expect(item()).toMatchObject({delegateId:22,status:"pending",estimatedUnitCost:null});
    expect(await write(1,{estimatedUnitCost:"5",estimatedTotalCost:"10",status:"estimated"},"pending",undefined,undefined,undefined,22)).toBe(true);
    expect(item()).toMatchObject({purchaseOrderId:100,delegateId:22,status:"estimated",estimatedUnitCost:"5"});
  });
  it("does not accept an old manager's nonprice edit or an expired current role",async()=>{
    const guard=vi.fn(),write=vi.fn();const before=item();
    const lockedEdit=vm.runInNewContext(expression("withPendingReviewItemWrite","function"),{db:{withTransaction:(work:any)=>f.db.transaction(work)},isDelegateRole,purchaseOrders,purchaseOrderItems,users,eq,TRPCError,assertCanPerformPurchaseItemReviewAction:guard});
    await call().assignOwnDelegateItem({purchaseOrderId:100,itemId:1,delegateId:22});
    await expect(lockedEdit(actor,{id:100},before,"editItem",write)).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(write).not.toHaveBeenCalled();
    f.memory.exec("UPDATE users SET isActive=0 WHERE id=22");
    await expect(lockedEdit({id:22,role:"delegate",isActive:1},{id:100},item(),"editItem",write)).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(write).not.toHaveBeenCalled();expect(guard).not.toHaveBeenCalled();
  });
});
