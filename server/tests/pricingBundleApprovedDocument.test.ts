import { afterEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";
import { approvedBundleCondition, approvedBundleSnapshot } from "../services/delegate-pricing-bundles/approved-document";
import { PricingBundleService } from "../services/delegate-pricing-bundles/service";
import { captureDocumentSignature } from "../../shared/documentSignatureSnapshot";
import fs from "node:fs";
import ts from "typescript";
import vm from "node:vm";
import { readAccountingSignature } from "../services/pdf/accountingSignature";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
const close: Array<()=>void> = [];
afterEach(()=>close.splice(0).forEach(fn=>fn()));
function fixture() {
  const memory = new DatabaseSync(":memory:"); close.push(()=>memory.close());
  memory.exec(`
    CREATE TABLE delegate_pricing_bundles(id INTEGER,bundleNumber TEXT,delegateId INTEGER,status TEXT,revision INTEGER,createdAt TEXT,sentAt TEXT,effectsDone INTEGER,snapshotJson TEXT,pdfContent BLOB);
    CREATE TABLE delegate_pricing_bundle_batches(bundleId INTEGER,purchaseOrderId INTEGER,pricingBatchId INTEGER,purchasePackageSubmissionId INTEGER);
    CREATE TABLE delegate_pricing_bundle_items(bundleId INTEGER,purchaseOrderItemId INTEGER,removedAt TEXT);
    CREATE TABLE purchase_order_items(id INTEGER,purchaseOrderId INTEGER);
    CREATE TABLE purchase_orders(id INTEGER,poNumber TEXT,packageId INTEGER);
    CREATE TABLE purchase_packages(id INTEGER,packageNumber TEXT);
    CREATE TABLE users(id INTEGER,name TEXT);
    CREATE TABLE po_pricing_batches(id INTEGER,purchaseOrderId INTEGER,purchasePackageSubmissionId INTEGER,batchNumber INTEGER,status TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,accountingSignatureSnapshot TEXT,accountingNotes TEXT,custodyAmount TEXT);
    CREATE TABLE purchase_package_submissions(id INTEGER,purchasePackageId INTEGER,subNumber INTEGER,status TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,accountingSignatureSnapshot TEXT,custodyBalance TEXT);
    INSERT INTO users VALUES(7,'Accounting original'),(8,'Actual manager');
    INSERT INTO purchase_packages VALUES(1,'PB-A'),(2,'PB-B');
    INSERT INTO purchase_package_submissions VALUES(10,1,5,'approved',7,'2026-10-31 09:25:01',8,'2026-10-31 09:42:17',NULL,'45538.00'),(20,2,2,'approved',7,'2026-10-31 09:24:35',8,'2026-10-31 09:39:56',NULL,'45538.00');
    INSERT INTO purchase_orders VALUES(101,'PR-101',1),(102,'PR-102',2),(103,'PR-103',2);
    INSERT INTO po_pricing_batches VALUES(11,101,10,3,'approved',7,'2026-10-31',8,'2026-10-31',NULL,NULL,NULL),(12,102,20,1,'approved',7,'2026-10-31',8,'2026-10-31',NULL,NULL,NULL),(13,103,20,2,'approved',7,'2026-10-31',8,'2026-10-31',NULL,NULL,NULL);
    INSERT INTO delegate_pricing_bundle_batches VALUES(24,101,11,10),(24,102,12,20),(24,103,13,20);
  `);
  const snapshot: any = { number:"DPB-2026-000024",submittedAt:"2026-10-31T09:09:47Z",delegate:{id:11,name:"Delegate",signature:""},
    signatures:[101,102,103].map(id=>({purchaseOrderId:id,poNumber:`PR-${id}`,requesterName:"Requester",reviewerName:"Reviewer",requesterSignature:"",reviewerSignature:""})),
    rows:Array.from({length:8},(_,n)=>({id:n+1,purchaseOrderId:n===0?101:n<4?102:103,poNumber:n===0?"PR-101":n<4?"PR-102":"PR-103",delegateId:11,itemName:`Material ${n+1}`,quantity:1,unit:"قطعة",estimatedUnitCost:n===0?"100":"10",estimatedTotalCost:n===0?"100":"10",sectionName:"Section",supplierName:"Supplier"})) };
  memory.prepare("INSERT INTO delegate_pricing_bundles VALUES(24,?,11,'archived',1,'2026-10-31','2026-10-31',1,?,?)").run(snapshot.number,JSON.stringify(snapshot),Buffer.from("%PDF-delegate-original"));
  for(const row of snapshot.rows){memory.prepare("INSERT INTO purchase_order_items VALUES(?,?)").run(row.id,row.purchaseOrderId);memory.prepare("INSERT INTO delegate_pricing_bundle_items VALUES(24,?,NULL)").run(row.id);}
  const captured=captureDocumentSignature({id:7,name:"Frozen accountant",signatureUrl:"frozen-accounting-image"});
  memory.prepare("UPDATE purchase_package_submissions SET accountingSignatureSnapshot=?").run(captured);
  const dialect=new MySqlDialect();const queries:string[]=[];
  const database={execute:async(statement:any)=>{const query=dialect.sqlToQuery(statement);queries.push(query.sql);if(!query.sql.trim().startsWith("SELECT"))throw Error("WRITE FORBIDDEN");return [memory.prepare(query.sql).all(...query.params as any[]),[]];}};
  const signature=vi.fn(async(source:string|null)=>source?"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=":"");
  const render=vi.fn(async(value:any)=>Buffer.from("%PDF-"+JSON.stringify(value)));
  const service=new PricingBundleService({database:async()=>database,render,signature} as any);
  return {memory,snapshot,database,signature,queries,render,service};
}
function renderHarness() {
  let html = "";
  const file="server/services/export/exportService.ts";
  const source=ts.createSourceFile(file,fs.readFileSync(file,"utf8"),ts.ScriptTarget.Latest,true);
  const fn=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==="generatePurchaseRequestPDF")!;
  const code=ts.transpileModule(`(${fn.getText(source).replace(/^export /,"")})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  const render=vm.runInNewContext(code,{db:new Proxy({},{get:()=>()=>{throw Error("Live DB forbidden");}}),getSignatureDataUrl:async()=>"",readAccountingSignature,
    escapeHtml:(value:any)=>String(value).replaceAll("<","&lt;"),fmtSAR:(n:number)=>n.toFixed(2),amountToArabicCurrencyPhrase:(n:number)=>String(n),htmlToPdf:async(value:string)=>{html=value;return Buffer.from("%PDF-test");}});
  return {render,html:()=>html};
}
describe("Document-center DPB approved PDF, without changing delegate files or workflow",()=>{
  it("keeps all eight frozen rows and groups the three request approvals into their two actual financial scopes, without summing custody balances",async()=>{
    const f=fixture();const original=JSON.stringify(f.snapshot);
    const enriched=await approvedBundleSnapshot(f.database,{id:24},f.snapshot,f.signature);
    expect(JSON.stringify(f.snapshot)).toBe(original);expect(enriched.rows).toEqual(f.snapshot.rows);
    expect(enriched.financialApprovals).toHaveLength(2);
    expect(enriched.financialApprovals?.map(row=>[row.reference,row.custodyValue])).toEqual([["PB-A-5","45538.00"],["PB-B-2","45538.00"]]);
    expect(enriched.financialApprovals?.[1].poNumbers).toEqual(["PR-102","PR-103"]);
    expect(enriched.financialApprovals?.[0]).toMatchObject({accountingName:"Frozen accountant",managementName:"Actual manager"});
    expect(f.signature).toHaveBeenCalledTimes(2);expect(f.signature).toHaveBeenCalledWith("frozen-accounting-image");expect(f.queries).toHaveLength(1);
  });
  it.each([
    "UPDATE po_pricing_batches SET status='pending_management',managementApprovedAt=NULL WHERE id=13",
    "DELETE FROM purchase_orders WHERE id=103",
    "DELETE FROM purchase_package_submissions WHERE id=20",
    "UPDATE purchase_package_submissions SET managementApprovedAt=NULL WHERE id=20",
    "UPDATE purchase_orders SET packageId=1 WHERE id=103",
    "DELETE FROM delegate_pricing_bundle_batches WHERE purchaseOrderId=103",
    "DELETE FROM purchase_order_items WHERE id=8",
    "UPDATE po_pricing_batches SET purchasePackageSubmissionId=NULL WHERE id=13",
  ])("denies the entire document when an undisplayed member is incomplete or missing: %s",async(change)=>{
    const f=fixture();f.memory.exec(change);
    const [visible]=await f.database.execute(sql`SELECT b.id FROM delegate_pricing_bundles b WHERE ${approvedBundleCondition()} LIMIT 20`);
    expect(visible).toHaveLength(0);
    await expect(approvedBundleSnapshot(f.database,{id:24},f.snapshot,f.signature)).rejects.toThrow("اكتمال اعتماد");expect(f.signature).not.toHaveBeenCalled();
  });
  it("rechecks the current state for every download and never returns an earlier approved rendition after a subsequent denial",async()=>{
    const f=fixture();const admin={id:1,role:"admin",isActive:1};
    const file=await f.service.pdf(admin,24,true);expect(file.name).toBe("DPB-2026-000024.pdf");expect(f.render).toHaveBeenCalledTimes(1);
    f.memory.exec("UPDATE po_pricing_batches SET managementApprovedAt=NULL WHERE id=13");
    await expect(f.service.pdf(admin,24,true)).rejects.toThrow("اكتمال اعتماد");expect(f.render).toHaveBeenCalledTimes(1);
    expect(Buffer.from(f.memory.prepare("SELECT pdfContent FROM delegate_pricing_bundles").get()!.pdfContent as Uint8Array).toString()).toBe("%PDF-delegate-original");
  });
  it("keeps the delegate's original cached bytes even if a caller explicitly requests the approved variant; refuses unrelated actors",async()=>{
    const f=fixture();const delegate={id:11,role:"delegate",isActive:1};
    const original=await f.service.pdf(delegate,24);expect(await f.service.pdf(delegate,24,true)).toEqual(original);
    expect(Buffer.from(original.content,"base64").toString()).toBe("%PDF-delegate-original");expect(f.render).not.toHaveBeenCalled();expect(f.signature).not.toHaveBeenCalled();
    for(const actor of [{...delegate,id:99},{...delegate,role:"warehouse"},{...delegate,role:"observer"},{...delegate,isActive:0}])await expect(f.service.pdf(actor,24,true)).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it.each([['accountant',7],['senior_management',8]] as const)("preserves the exact approval actor guard for %s on the approved rendition",async(role,id)=>{
    const f=fixture();
    expect((await f.service.pdf({id,role,isActive:1},24,true)).name).toBe(f.snapshot.number+'.pdf');
    expect(f.render).toHaveBeenCalledTimes(1);
    await expect(f.service.pdf({id:99,role,isActive:1},24,true)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.render).toHaveBeenCalledTimes(1);
    expect(f.queries.every(query=>query.trim().startsWith('SELECT'))).toBe(true);
  });
  it("never substitutes a live profile signature for a missing historical accounting snapshot",async()=>{
    const f=fixture();f.memory.exec("UPDATE purchase_package_submissions SET accountingSignatureSnapshot=NULL");
    const result=await approvedBundleSnapshot(f.database,{id:24},f.snapshot,f.signature);
    expect(result.financialApprovals?.every(row=>row.accountingSignature==="")).toBe(true);expect(f.signature.mock.calls.every(([source])=>source===null)).toBe(true);
  });
  it("renders the PB reference form for approved DPB, preserving separate legacy financial scopes and all original rows",async()=>{
    const f=fixture();const approved=await approvedBundleSnapshot(f.database,{id:24},f.snapshot,f.signature);
    const h=renderHarness();await h.render(0,11,undefined,undefined,approved);const html=h.html();
    expect(html).not.toContain("اعتمادات الحسابات والإدارة العليا");expect(html).toContain("Frozen accountant");expect(html).not.toContain("Actual manager");expect(html).not.toContain("اعتماد إلكتروني");
    expect(html).toContain("رئيس الحسابات");expect(html).toContain("الرئيس التنفيذي");
    expect(html).not.toContain("القسم المستفيد</th>");expect(html).not.toContain("المورد:");
    expect(html.match(/<div class="section-title">الشؤون المالية والإجراءات المحاسبية/g)).toHaveLength(2);
    const body=html.slice(html.indexOf("<body>"));
    expect(body.indexOf("الحسابات</td>")).toBeLessThan(body.indexOf("الشؤون المالية والإجراءات المحاسبية"));
    expect(body.indexOf("الرئيس التنفيذي")).toBeLessThan(body.indexOf("رقم سند الصرف"));
    const reviewerRow=body.match(/<tr><td[^>]*>مراجع الطلب<\/td>[\s\S]*?<\/tr>/)?.[0];
    expect(reviewerRow).toContain("Reviewer");expect(reviewerRow).not.toContain("الطلبات:");expect(reviewerRow).not.toContain("PR-");
    const requesterRow=body.match(/<tr><td[^>]*>مقدّم الطلب<\/td>[\s\S]*?<\/tr>/)?.[0];
    expect(requesterRow).toContain("الطلبات:");
    expect(html).toContain("45538.00");expect(html).not.toContain("91076");expect(html).toContain("170.00");
    expect(approved.rows.map(row=>row.itemName).every(name=>html.includes(name))).toBe(true);
    fs.mkdirSync("tools/pricing-bundle-approved-document/artifacts",{recursive:true});fs.writeFileSync("tools/pricing-bundle-approved-document/artifacts/approved-preview.html",html.replace(/[ \t]+$/gm,""));
    await h.render(0,11,undefined,undefined,f.snapshot);const delegateHtml=h.html();
    expect(delegateHtml).not.toContain("اعتمادات الحسابات والإدارة العليا");expect(delegateHtml).not.toContain("الشؤون المالية والإجراءات المحاسبية</div>");expect(delegateHtml).toContain("170.00");
    expect(delegateHtml).toContain("القسم المستفيد</th>");expect(delegateHtml).toContain("المورد:");
    expect(delegateHtml.match(/<tr><td[^>]*>مراجع الطلب<\/td>[\s\S]*?<\/tr>/)?.[0]).toContain("الطلبات:");
  });
  it("uses one standard finance block and one custody balance for a unified approval without a duplicate approval appendix",async()=>{
    const f=fixture();const legacy=await approvedBundleSnapshot(f.database,{id:24},f.snapshot,f.signature);
    const approved={...legacy,approvedTotal:"170.00",financialApprovals:[{...legacy.financialApprovals![0],reference:f.snapshot.number,poNumbers:["PR-101","PR-102","PR-103"],managementSignature:"data:image/png;base64,test-management",notes:"ملاحظات الاعتماد"}]};
    const original=JSON.stringify(approved);const h=renderHarness();await h.render(0,11,undefined,undefined,approved);const html=h.html();
    expect(html.match(/<div class="section-title">الشؤون المالية والإجراءات المحاسبية/g)).toHaveLength(1);
    expect(html.match(/45538\.00/g)).toHaveLength(1);
    expect(html).not.toContain("test-management");expect(html).toContain("ملاحظات الاعتماد");
    expect(html).not.toContain("إجمالي الأصناف المعتمدة بعد قرارات الرفض");
    expect(html).toContain("المبلغ الإجمالي:");expect(html).toContain('colspan="6"');
    const table=html.slice(html.indexOf('<table class="items-table">'),html.indexOf('<div class="declaration-box">'));
    expect(table.match(/<th /g)).toHaveLength(7);
    expect(JSON.stringify(approved)).toBe(original);
  });
  it("prints only the accounting signature and a fixed bold CEO name with an empty signature cell without changing approval evidence",async()=>{
    const f=fixture();const legacy=await approvedBundleSnapshot(f.database,{id:24},f.snapshot,f.signature);
    const approved={...legacy,financialApprovals:[{...legacy.financialApprovals![0],accountingSignature:"data:image/png;base64,accounting-only",accountingAt:"ACCOUNTING-TIMESTAMP",managementName:"Stored actual approver",managementSignature:"data:image/png;base64,stored-ceo-signature",managementAt:"MANAGEMENT-TIMESTAMP"}]};
    const original=JSON.stringify(approved);const h=renderHarness();await h.render(0,11,undefined,undefined,approved);const html=h.html();
    const accountingRow=html.match(/<tr><td[^>]*>الحسابات<\/td>[\s\S]*?<\/tr>/)?.[0];
    expect(accountingRow).toContain("accounting-only");expect(accountingRow).not.toContain("<small");
    expect(html).not.toContain("اعتماد إلكتروني");expect(html).not.toContain("ACCOUNTING-TIMESTAMP");expect(html).not.toContain("MANAGEMENT-TIMESTAMP");
    const ceoRow=html.match(/<tr[^>]*>\s*<td[^>]*>الرئيس التنفيذي<\/td>[\s\S]*?<\/tr>/)?.[0];
    expect(ceoRow).toMatch(/<td[^>]*font-weight:bold[^>]*>المهندس\/ زكري بن عبدالله الزكري<\/td>/);
    expect(ceoRow).toMatch(/<td[^>]*><\/td>\s*<\/tr>$/);expect(ceoRow).not.toContain("<img");
    expect(html).not.toContain("Stored actual approver");expect(html).not.toContain("stored-ceo-signature");
    expect(JSON.stringify(approved)).toBe(original);
  });
  it("preserves rejection evidence and approved totals without rewriting or dropping frozen rows",async()=>{
    const f=fixture();const legacy=await approvedBundleSnapshot(f.database,{id:24},f.snapshot,f.signature);
    const approved={...legacy,approvedTotal:"160.00",rows:legacy.rows.map((row,index)=>index===1?{...row,approvalRejectionReason:"رفض بسبب السعر"}:row)};
    const original=JSON.stringify(approved);const h=renderHarness();await h.render(0,11,undefined,undefined,approved);const html=h.html();
    expect(html).toContain("غير معتمد: رفض بسبب السعر");expect(html).toContain("إجمالي التسعير الأصلي:");
    expect(html).toContain("170.00");expect(html).toContain("160.00");
    expect(approved.rows.every(row=>html.includes(row.itemName))).toBe(true);
    expect(JSON.stringify(approved)).toBe(original);
  });
  it("keeps full order numbers in their own single-line fitting cells without changing the source or other columns",async()=>{
    const f=fixture();const approved=await approvedBundleSnapshot(f.database,{id:24},f.snapshot,f.signature);
    approved.rows[0].poNumber="PR-2026-180486";approved.rows[1].poNumber="PR-2026-12345678901234567890";
    const original=JSON.stringify(approved);const h=renderHarness();await h.render(0,11,undefined,undefined,approved);const html=h.html();
    expect(html.match(/<td class="po-number-cell">/g)).toHaveLength(approved.rows.length);
    for(const row of approved.rows)expect(html).toContain(`<span class="po-number-text">${row.poNumber}</span>`);
    expect(html).toContain('white-space: nowrap');expect(html).toContain('width > available');expect(html).toContain("window.addEventListener('beforeprint', fitPurchaseOrderNumbers)");
    expect(html).toContain('<th style="width: 12%;">رقم الطلب</th>');expect(html).not.toContain('table-layout: fixed');
    expect(JSON.stringify(approved)).toBe(original);
  });
});
