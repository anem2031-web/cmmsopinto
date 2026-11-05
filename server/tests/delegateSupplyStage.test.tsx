import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";import vm from "node:vm";import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { delegateSupplyStage, isDelegateSupplyItemOpen } from "../../shared/delegateSupplyStage";
import { delegateFollowupText } from "../../client/src/i18n/delegateFollowup";
import { isDelegateOwnPurchaseDraft } from "../../shared/purchaseDraftVisibility";
import { isPurchasePdfApprover } from "../_core/authz/purchase-document";
import { isDelegateRole } from "../../shared/roles";
import { externalWorkshopForPurchaseItem } from "../services/external-maintenance-pricing";
const ui=vi.hoisted(()=>({language:"ar"}));
vi.mock("../../client/src/contexts/LanguageContext",()=>({useTranslation:()=>({language:ui.language})}));
vi.mock("../../client/src/hooks/useContentTranslation",()=>({getLocalizedItemField:(item:any)=>item.itemName}));
vi.mock("wouter",()=>({Link:({children,href,...props}:any)=><a href={href} {...props}>{children}</a>}));
import { DelegateSupplyRows } from "../../client/src/components/purchase/DelegateSupplyRows";
const file="server/routers/purchase/purchase-orders.router.ts",source=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
const workshopEnrichment=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==="enrichExternalWorkshopPricingItems")!;
const enrichExternalWorkshopPricingItems=vm.runInNewContext(ts.transpileModule(`(${workshopEnrichment.getText(source).replace(/^export /,"")})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{db:{getPurchaseOrderTicketContextBatch:async()=>new Map()},externalWorkshopForPurchaseItem});
function evaluate(code:string,context:any){return vm.runInNewContext(ts.transpileModule(`(${code})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{isDelegateOwnPurchaseDraft,isPurchasePdfApprover,isDelegateRole,externalWorkshopForPurchaseItem,enrichExternalWorkshopPricingItems,
  createPurchaseOrderReadScope:async(user:any,orders:any[])=>{for(const order of orders)await context.assertCanViewPurchaseOrder(user,order);return{assert:()=>{},projectOrder:(po:any)=>po,isRoutedReviewOnly:()=>false,hasLimitedItemScope:()=>false,filterItems:(_po:any,items:any[])=>items,filterComments:(_po:any,rows:any[])=>rows,filterBatches:(_po:any,rows:any[])=>rows};},
  localizeMasterDataReferences:async(value:any)=>value,...context});}
function handler(name:string,context:any){let fn="";function walk(node:ts.Node){if(ts.isPropertyAssignment(node)&&node.name.getText(source)===name&&ts.isCallExpression(node.initializer)&&ts.isPropertyAccessExpression(node.initializer.expression)&&node.initializer.expression.name.text==="query")fn=node.initializer.arguments[0].getText(source);ts.forEachChild(node,walk);}walk(source);if(!fn)throw Error(name);return evaluate(fn,{TRPCError,...context});}
const fn=(name:string,context:any)=>evaluate((source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name)!).getText(source).replace(/^export /,""),context);
describe("Delegate supply stage from the item's batch and path",()=>{
  it.each([[{status:"pending"},"pricing"],[{status:"estimated"},"bundle"],[{status:"estimated",batchId:7,pricingBatchStatus:"pending_accounting",purchaseOrderStatus:"partial_purchase"},"accounting"],[{status:"estimated",batchId:7,pricingBatchStatus:"pending_management"},"management"],[{status:"approved",batchId:7},"purchase"],[{status:"funded"},"purchase"],[{status:"purchased"},"warehouse_delivery"],[{status:"approved",isExternalMaintenance:true,externalMaintenanceStatus:"purchase_cycle"},"external_execution"],[{status:"purchased",isExternalMaintenance:true,externalMaintenanceStatus:"waiting_gate_entry"},"external_waiting_gate_entry"],[{status:"purchased",isExternalMaintenance:true,externalMaintenanceStatus:"waiting_warehouse_receipt"},"external_waiting_warehouse_receipt"]] as const)("maps %j to %s",(item,stage)=>expect(delegateSupplyStage(item)).toBe(stage));
  it.each(["delivered_to_warehouse","delivered_to_requester","rejected","cancelled","purchase_cancelled"])("removes completed/withdrawn %s",status=>expect(isDelegateSupplyItemOpen({status})).toBe(false));
  it("retains purchased until warehouse receipt, including external return",()=>{
    expect(isDelegateSupplyItemOpen({status:"purchased"})).toBe(true);expect(isDelegateSupplyItemOpen({status:"purchased",isExternalMaintenance:true,externalMaintenanceStatus:"waiting_warehouse_receipt"})).toBe(true);
    expect(isDelegateSupplyItemOpen({status:"purchased",isExternalMaintenance:true,externalWarehouseReceivedAt:"2026-10-18"})).toBe(false);
    expect(isDelegateSupplyItemOpen({status:"purchased",isExternalMaintenance:true,externalMaintenanceStatus:"waiting_technician_handover"})).toBe(false);
  });
  it.each(["ar","en","ur"])("renders two columns and an item link in %s",language=>{
    ui.language=language;const text=delegateFollowupText[language as keyof typeof delegateFollowupText];const html=renderToStaticMarkup(<DelegateSupplyRows items={[{id:1,purchaseOrderId:7,itemName:"Own item",status:"estimated",batchId:5,pricingBatchStatus:"pending_accounting"}]}/>);
    expect(html.match(/<th /g)).toHaveLength(2);expect(html).toContain(text.stage);expect(html).toContain(text.stages.accounting);expect(html).toContain("/purchase-orders/7?itemId=1&amp;source=supply");
  });
});
describe("Actual delegate RPC read handlers with isolated source data",()=>{
  const ctx={user:{id:11,role:"delegate",preferredLanguage:"ar"}};
  const localizePurchaseUserNames=async(items:any[])=>items;
  it("scopes before enrichment, hides warehouse receipt, and reads context in one batch",async()=>{
    const db={getPurchaseSupplyTrackingItems:vi.fn(async()=>[{id:1,delegateId:11,purchaseOrderId:7,status:"estimated",batchId:8,pricingBatchStatus:"pending_accounting"},{id:2,delegateId:22,purchaseOrderId:8,status:"pending"},{id:3,delegateId:11,purchaseOrderId:9,status:"purchased",itemMaintenancePath:"C"}]),getPurchaseOrderTicketContextBatch:vi.fn(async()=>new Map([[7,{po:{poNumber:"PR7",status:"partial_purchase"},ticket:null,externalJob:null}],[9,{po:{poNumber:"PR9"},ticket:{maintenancePath:"B"},externalJob:{id:1,status:"waiting_technician_handover",warehouseReceivedAt:"2026-10-18"}}]]))};
    const shapeEnrichedPurchaseCycleItem=fn("shapeEnrichedPurchaseCycleItem",{});const enrichPurchaseCycleItemsBatch=fn("enrichPurchaseCycleItemsBatch",{db,shapeEnrichedPurchaseCycleItem});
    const call=handler("supplyTracking",{db,APP_ROLE:{DELEGATE:"delegate"},enrichPurchaseCycleItemsBatch,isDelegateSupplyItemOpen,localizePurchaseUserNames});
    const result=await call({ctx});expect(result.items.map((i:any)=>i.id)).toEqual([1]);expect(delegateSupplyStage(result.items[0])).toBe("accounting");expect(db.getPurchaseSupplyTrackingItems).toHaveBeenCalledWith(11);expect(db.getPurchaseOrderTicketContextBatch).toHaveBeenCalledWith([7,9]);
  });
  it.each(["delegate","admin","owner","warehouse"])("filters PO item details and comments only for %s when it is delegate",async role=>{
    const items=[{id:1,delegateId:11},{id:2,delegateId:22}],comments=[{purchaseOrderItemId:1},{purchaseOrderItemId:2},{purchaseOrderItemId:null}];const guard=vi.fn();
    const call=handler("getById",{db:{getPurchaseOrderById:async()=>({id:7}),getPOItems:async()=>items,getProcurementComments:async()=>comments},assertCanViewPurchaseOrder:guard,localizePurchaseUserNames});const result=await call({ctx:{user:{...ctx.user,role}},input:{id:7}});
    expect(result.items).toHaveLength(role==="delegate"?1:2);expect(result.comments).toHaveLength(role==="delegate"?2:3);expect(guard).toHaveBeenCalledOnce();
  });
  it("denies another delegate's item history before reading its timeline",async()=>{
    const read=vi.fn();const call=handler("itemHistory",{db:{getPOItemById:async()=>({id:2,delegateId:22}),getPOItemTimeline:read},assertPOItemAssignedToDelegate:()=>{throw new TRPCError({code:"FORBIDDEN"});}});
    await expect(call({ctx,input:{itemId:2}})).rejects.toMatchObject({code:"FORBIDDEN"});expect(read).not.toHaveBeenCalled();
  });
  it("filters batches to their submitting delegate after the PO guard",async()=>{
    const guard=vi.fn();const call=handler("listPricingBatches",{db:{getPurchaseOrderById:async()=>({id:7}),getPOPricingBatches:async()=>[{id:1,submittedById:11},{id:2,submittedById:22}]},assertCanViewPurchaseOrder:guard,rejectEmptyPendingPricingBatches:async()=>{}});
    expect(await call({ctx,input:{purchaseOrderId:7}})).toEqual([{id:1,submittedById:11,pdfAllowed:true,pdfBlockedReason:null}]);expect(guard).toHaveBeenCalledOnce();
  });
  it.each(["delegate","admin"])("keeps original purchase package details scoped for %s",async role=>{
    const file="server/routers/purchase/purchase-packages.router.ts",pkg=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);let code="";
    function find(node:ts.Node){if(ts.isPropertyAssignment(node)&&node.name.getText(pkg)==="getById"&&ts.isCallExpression(node.initializer))code=node.initializer.arguments[0].getText(pkg);ts.forEachChild(node,find);}find(pkg);
    const items=[{id:1,delegateId:11},{id:2,delegateId:22}];const call=evaluate(code,{TRPCError,db:{getPurchasePackageById:async()=>({id:7})},assertCanPerformPOAction:()=>{},getVisiblePackageOrdersWithItems:async()=>[{id:9,items}],withPurchaseSubmissionTime:(po:any)=>po});
    const result=await call({input:{id:7},ctx:{user:{id:11,role}}});expect(result.orders[0].items).toHaveLength(role==="delegate"?1:2);
  });
});
