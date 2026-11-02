import { createRequire } from "node:module";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { vi } from "vitest";
import { ApprovedPricingDocumentReader } from "../../services/delegate-pricing-bundles/approved-reader";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export function approvedPricingFixture() {
  const memory = new DatabaseSync(":memory:");
  memory.exec(`
    CREATE TABLE users(id INTEGER,username TEXT,role TEXT,isActive INTEGER,name TEXT);
    CREATE TABLE delegate_pricing_bundles(id INTEGER,bundleNumber TEXT,delegateId INTEGER,status TEXT,snapshotJson TEXT,sentAt TEXT);
    CREATE TABLE delegate_pricing_bundle_batches(bundleId INTEGER,purchaseOrderId INTEGER,pricingBatchId INTEGER,purchasePackageSubmissionId INTEGER);
    CREATE TABLE delegate_pricing_bundle_items(bundleId INTEGER,purchaseOrderItemId INTEGER,removedAt TEXT);
    CREATE TABLE purchase_order_items(id INTEGER,purchaseOrderId INTEGER);
    CREATE TABLE purchase_orders(id INTEGER,poNumber TEXT,packageId INTEGER);
    CREATE TABLE purchase_packages(id INTEGER,packageNumber TEXT);
    CREATE TABLE po_pricing_batches(id INTEGER,purchaseOrderId INTEGER,purchasePackageSubmissionId INTEGER,batchNumber INTEGER,status TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,accountingSignatureSnapshot TEXT,accountingNotes TEXT,custodyAmount TEXT);
    CREATE TABLE purchase_package_submissions(id INTEGER,purchasePackageId INTEGER,subNumber INTEGER,status TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,accountingSignatureSnapshot TEXT,custodyBalance TEXT);
    CREATE TABLE delegate_pricing_bundle_approvals(bundleId INTEGER,status TEXT,accountingApprovedById INTEGER,accountingApprovedAt TEXT,managementApprovedById INTEGER,managementApprovedAt TEXT,accountingSignatureSnapshot TEXT,managementSignatureSnapshot TEXT,custodyBalance TEXT,accountingNotes TEXT,managementNotes TEXT,accountingRejections TEXT,managementRejections TEXT);
    INSERT INTO users VALUES(1,'ANIS','user',1,'أنيس'),(2,'ahmed1','user',1,'أحمد'),(3,'ADMIN','admin',1,'Admin'),(4,'OWNER','owner',1,'Owner'),(5,'OTHER','user',1,'Other'),(7,'ACCOUNTANT','accountant',1,'Accountant'),(8,'MANAGER','senior_management',1,'Manager'),(11,'AZIZ','delegate',1,'Delegate');
  `);
  const queries: Array<{sql:string,params:any[]}> = [], dialect = new MySqlDialect();
  const database = {execute:vi.fn(async (statement:any) => {
    const query = dialect.sqlToQuery(statement); queries.push(query);
    if (!query.sql.trim().startsWith("SELECT")) throw Error("Writes forbidden");
    return [memory.prepare(query.sql).all(...query.params as any[]),[]];
  })};
  const ports = {database:vi.fn(async()=>database),render:vi.fn(async(snapshot:any)=>Buffer.from("%PDF-"+snapshot.number)),signature:vi.fn(async()=>"")};
  const reader = new ApprovedPricingDocumentReader(ports,()=>true);
  const actor = (id=1) => ({...memory.prepare("SELECT id,username,role,isActive FROM users WHERE id=?").get(id)}) as {id:number,username:string,role:string,isActive:number};
  const add = (id:number, approved=true, poId=100+id, count=1) => {
    if (!memory.prepare("SELECT id FROM purchase_orders WHERE id=?").get(poId)) memory.prepare("INSERT INTO purchase_orders VALUES(?,?,NULL)").run(poId,`PR-${poId}`);
    memory.prepare("INSERT INTO po_pricing_batches VALUES(?,?,NULL,1,?,7,'2026-11-01 08:00:00',8,?,NULL,NULL,'20.00')").run(id,poId,approved?'approved':'pending_management',approved?'2026-11-02 09:00:00':null);
    memory.prepare("INSERT INTO delegate_pricing_bundle_batches VALUES(?,?,?,NULL)").run(id,poId,id);
    const rows = Array.from({length:count},(_,index)=>({id:id*100+index,purchaseOrderId:poId,poNumber:`PR-${poId}`,delegateId:11,itemName:`Material ${id}-${index}`,quantity:1,unit:'قطعة',estimatedUnitCost:'10.00',estimatedTotalCost:'10.00'}));
    const snapshot = {number:`DPB-${id}`,submittedAt:'2026-11-02 08:00:00',delegate:{id:11,name:'Delegate',signature:''},rows,
      signatures:[{purchaseOrderId:poId,poNumber:`PR-${poId}`,requesterName:'Requester',reviewerName:'Reviewer',requesterSignature:'',reviewerSignature:''}]};
    memory.prepare("INSERT INTO delegate_pricing_bundles VALUES(?,?,11,'archived',?,'2026-11-02 08:00:00')").run(id,snapshot.number,JSON.stringify(snapshot));
    for(const row of rows){memory.prepare("INSERT INTO purchase_order_items VALUES(?,?)").run(row.id,poId);memory.prepare("INSERT INTO delegate_pricing_bundle_items VALUES(?,?,NULL)").run(id,row.id);}
    return snapshot;
  };
  return {memory,queries,database,ports,reader,actor,add};
}
