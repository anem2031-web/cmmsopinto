import { afterEach, describe, expect, it, vi } from "vitest";
import { approvedPricingFixture } from "./fixtures/approvedPricingDocuments";
import { canReadApprovedPricingDocuments, approvedPricingDocumentRpcAllowed, approvedPricingDocumentPageAllowed } from "../../shared/approved-pricing-documents";
import { createApprovedPricingDocumentsRouter } from "../routers/delegate-pricing-bundles/approved-reader.router";
import { router } from "../_core/trpc";
import { ApprovedPricingDocumentReader } from "../services/delegate-pricing-bundles/approved-reader";
import { documentListPageInput } from "../../shared/document-list";
import { canReadPricingBundles } from "../../shared/delegate-pricing-bundles";
const close:Array<()=>void>=[];
afterEach(()=>{close.splice(0).forEach(fn=>fn());vi.unstubAllEnvs();});
const fixture=()=>{vi.stubEnv("DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED","false");const f=approvedPricingFixture();close.push(()=>f.memory.close());return f;};
const page=documentListPageInput.parse({page:1});
const caller=(f:ReturnType<typeof fixture>,user:any,authenticatedUser?:any)=>router({approvedPricingDocuments:createApprovedPricingDocumentsRouter(f.ports,()=>true)}).createCaller({user,authenticatedUser,req:{headers:{}},res:{}} as any);

describe("Approved DPB named-account capability and complete document scope",()=>{
  it.each([1,2,3,4])("allows account %s only final documents and renders the approved variant",async id=>{
    const f=fixture();f.add(1);f.add(2,false);
    const api=caller(f,f.actor(id)), result=await api.approvedPricingDocuments.listPage({page:1});
    expect(result.rows.map(row=>row.bundleNumber)).toEqual(['DPB-1']);expect(result.total).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/snapshotJson|signature|pdfContent|fileKey|fileUrl/);
    expect(await api.approvedPricingDocuments.pdf({id:1})).toMatchObject({name:'DPB-1.pdf'});
    expect(f.ports.render.mock.calls[0][0].financialApprovals).toHaveLength(1);
    await expect(api.approvedPricingDocuments.pdf({id:2})).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it.each(['user','accountant','senior_management','delegate','warehouse','technician','gate_security','observer','it_member','executive_director'])("does not grant every %s access or accept a display-name match",async role=>{
    const f=fixture();f.add(1);const user={...f.actor(5),role,name:'ANIS'};
    expect(canReadApprovedPricingDocuments(user)).toBe(false);
    await expect(caller(f,user).approvedPricingDocuments.listPage({page:1})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(caller(f,user).approvedPricingDocuments.pdf({id:1})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.ports.database).not.toHaveBeenCalled();
  });
  it("keeps original identity, inactive accounts, forged original variants and unknown actions denied",async()=>{
    const f=fixture();f.add(1);
    await expect(caller(f,f.actor(3),f.actor(5)).approvedPricingDocuments.pdf({id:1})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(caller(f,{...f.actor(1),isActive:0}).approvedPricingDocuments.listPage({page:1})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(caller(f,null).approvedPricingDocuments.pdf({id:1})).rejects.toMatchObject({code:'UNAUTHORIZED'});
    for(const path of ['delegatePricingBundles.send','delegatePricingBundles.pdf','approvedPricingDocuments.approveAccounting','approvedPricingDocuments.other'])expect(approvedPricingDocumentRpcAllowed(f.actor(), 'mutation',path)).toBe(false);
    expect(canReadPricingBundles(f.actor())).toBe(false);
    await caller(f,f.actor()).approvedPricingDocuments.pdf({id:1,approvedDocument:false} as any);
    expect(f.ports.render.mock.calls[0][0].financialApprovals).toHaveLength(1);
  });
  it.each(["UPDATE users SET isActive=0 WHERE id=1","UPDATE users SET username='RENAMED' WHERE id=1","UPDATE users SET role='warehouse' WHERE id=1","DELETE FROM users WHERE id=1","INSERT INTO users VALUES(90,'anis','user',1,'duplicate')"])("freshly revokes list and PDF access after %s",async change=>{
    const f=fixture();f.add(1);const user=f.actor(), api=caller(f,user);
    await api.approvedPricingDocuments.listPage({page:1});f.memory.exec(change);
    await expect(api.approvedPricingDocuments.pdf({id:1})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(api.approvedPricingDocuments.listPage({page:1})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.ports.render).not.toHaveBeenCalled();
  });
  it.each(["DELETE FROM purchase_orders WHERE id=101","DELETE FROM po_pricing_batches WHERE id=1","DELETE FROM purchase_order_items WHERE id=100","DELETE FROM delegate_pricing_bundle_batches WHERE bundleId=1","UPDATE po_pricing_batches SET managementApprovedAt=NULL WHERE id=1","UPDATE po_pricing_batches SET accountingApprovedAt=NULL WHERE id=1","UPDATE delegate_pricing_bundles SET status='open' WHERE id=1"])("denies changed or missing parents independently: %s",async change=>{
    const f=fixture();f.add(1);f.add(2);const api=caller(f,f.actor());
    expect((await api.approvedPricingDocuments.listPage({page:1})).rows).toHaveLength(2);f.memory.exec(change);
    expect((await api.approvedPricingDocuments.listPage({page:1})).rows.map(row=>row.id)).toEqual([2]);
    await expect(api.approvedPricingDocuments.pdf({id:1})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(api.approvedPricingDocuments.pdf({id:999})).rejects.toMatchObject({code:'FORBIDDEN'});
    expect((await api.approvedPricingDocuments.pdf({id:2})).name).toBe('DPB-2.pdf');
  });
  it("checks all members of an aggregate PDF including undisplayed submission members",async()=>{
    const f=fixture();f.add(1);f.add(2,false);
    // Add an incomplete second PO to bundle 1 while its first row remains approved.
    f.memory.exec("INSERT INTO delegate_pricing_bundle_batches SELECT 1,purchaseOrderId,pricingBatchId,NULL FROM delegate_pricing_bundle_batches WHERE bundleId=2; INSERT INTO delegate_pricing_bundle_items SELECT 1,purchaseOrderItemId,NULL FROM delegate_pricing_bundle_items WHERE bundleId=2");
    expect((await f.reader.listPage(f.actor(),page)).rows).toHaveLength(0);
    await expect(f.reader.pdf(f.actor(),1)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.ports.signature).not.toHaveBeenCalled();
  });
  it("rejects a snapshot with missing/foreign members rather than showing or printing a partial document",async()=>{
    const f=fixture();const snapshot=f.add(1);f.add(2);
    snapshot.rows[0].purchaseOrderId=999;f.memory.prepare('UPDATE delegate_pricing_bundles SET snapshotJson=? WHERE id=1').run(JSON.stringify(snapshot));
    expect((await f.reader.listPage(f.actor(),page)).rows.map(row=>row.id)).toEqual([2]);
    await expect(f.reader.pdf(f.actor(),1)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
  it("propagates database failures and isolates consecutive allowed and denied requests without shared permission cache",async()=>{
    const f=fixture();f.add(1);await f.reader.listPage(f.actor(),page);
    await expect(f.reader.listPage(f.actor(5),page)).rejects.toMatchObject({code:'FORBIDDEN'});
    f.database.execute.mockRejectedValueOnce(Error('database unavailable'));
    await expect(f.reader.pdf(f.actor(),1)).rejects.toThrow('database unavailable');
    expect((await f.reader.listPage(f.actor(2),page)).rows).toHaveLength(1);
  });
  it("filters and paginates before scope loading with bounded queries for repeated parents and 1000 members",async()=>{
    const f=fixture();for(let id=1;id<=51;id++)f.add(id,true,101,20);
    const result=await f.reader.listPage(f.actor(),{...page,pageSize:50});
    expect(result.rows).toHaveLength(50);expect(result.total).toBe(51);expect(result.rows[0].id).toBe(51);
    expect(f.queries).toHaveLength(4);expect(f.queries[2].sql).toContain('LIMIT');
    const members=f.queries.filter(query=>query.sql.startsWith('SELECT m.bundleId,m.purchaseOrderItemId'));
    expect(members).toHaveLength(1);expect(members[0].params).toHaveLength(50);
    const filtered=await f.reader.listPage(f.actor(),{...page,search:'DPB-1'});
    expect(filtered.total).toBe(11);expect(filtered.rows.every(row=>row.bundleNumber.startsWith('DPB-1'))).toBe(true);
    f.queries.length=0;
    await (f.reader as any).scope(f.database,Array.from({length:1201},(_,i)=>i+1).flatMap(id=>[id,id]));
    expect(f.queries).toHaveLength(3);expect(f.queries.map(query=>query.params.length)).toEqual([500,500,201]);
  });
  it("keeps disabled rollout empty and denies PDF without reading document tables",async()=>{
    const f=fixture();const reader=new ApprovedPricingDocumentReader(f.ports,()=>false);
    expect((await reader.listPage(f.actor(),page)).rows).toEqual([]);
    await expect(reader.pdf(f.actor(),1)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(f.queries.every(query=>query.sql.includes('FROM users'))).toBe(true);
  });
  it("adds just the document-center route for the named accounts and preserves exact login matching",()=>{
    const actor={id:1,role:'user',isActive:1,username:'ANIS'};
    expect(approvedPricingDocumentPageAllowed(actor,'/documents?tab=approved')).toBe(true);
    for(const path of ['/purchase-orders','/documents/other','/delegate-pricing-bundles','/construction'])expect(approvedPricingDocumentPageAllowed(actor,path)).toBe(false);
    for(const username of ['ANIS2',' ANIS','@ANIS','other','ahmed10'])expect(canReadApprovedPricingDocuments({...actor,username})).toBe(false);
    expect(canReadApprovedPricingDocuments({...actor,username:'AhMeD1'})).toBe(true);
  });
  it("uses unified final approval and approved-only total without changing frozen source rows",async()=>{
    const f=fixture();const snapshot=f.add(1,true,101,2);vi.stubEnv('DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED','true');
    f.memory.prepare("INSERT INTO delegate_pricing_bundle_approvals VALUES(1,'approved',7,'2026-11-02 08:00:00',8,'2026-11-02 09:00:00',NULL,NULL,'265',NULL,NULL,?,'[]')").run(JSON.stringify([{itemId:100,reason:'Rejected item'}]));
    expect((await f.reader.listPage(f.actor(),page)).rows[0].total).toBe(10);
    await f.reader.pdf(f.actor(),1);expect(f.ports.render.mock.calls[0][0].rows).toHaveLength(2);
    expect(JSON.parse(String(f.memory.prepare('SELECT snapshotJson FROM delegate_pricing_bundles WHERE id=1').get()!.snapshotJson))).toEqual(snapshot);
    f.memory.exec("UPDATE delegate_pricing_bundle_approvals SET status='pending_management',managementApprovedAt=NULL");
    expect((await f.reader.listPage(f.actor(),page)).rows).toEqual([]);
    await expect(f.reader.pdf(f.actor(),1)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
});
