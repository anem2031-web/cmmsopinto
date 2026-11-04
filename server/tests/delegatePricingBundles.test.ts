import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { TRPCError } from "@trpc/server";
import { PricingBundleService } from "../services/delegate-pricing-bundles/service";
import { createPricingBundlesRouter } from "../routers/delegate-pricing-bundles/router";
import { router } from "../routers/_shared/procedures";
import { reservedPricingItemIds } from "../services/delegate-pricing-bundles/reservations";
import { canRoleAccessPath, isDelegateRole } from "../../shared/roles";
import { readAccountingSignature } from "../services/pdf/accountingSignature";
import { assertRoutedPurchaseItemReady } from "../services/purchase-review-routing";
import type { TrpcContext } from "../_core/context";
const actor = { id: 11, role: "delegate", isActive: 1, name: "Delegate" };
function extract(file: string, name: string) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (!fn) throw Error(name);
  return ts.transpileModule(`(${fn.getText(source).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
}
const submitCode = extract("server/routers/purchase/purchase-orders.router.ts", "submitPricedBatchForPO");
function fixture() {
  let state: any = { bundles: [], members: [], links: [], batches: [], submissions: [], items: Array.from({ length: 25 }, (_, index) => ({ id: index + 1, purchaseOrderId: index < 2 ? 101 : index % 2 ? 102 : 103, poNumber: index < 2 ? "PR-101" : index % 2 ? "PR-102" : "PR-103", packageId: index < 2 ? null : index % 2 ? 9 : 10, purchaseOrderStatus: "pending_estimate", delegateId: 11, catalogItemId: 55, itemName: `Material ${index + 1}`, sectionId: index + 1, sectionName: `Section ${index + 1}`, siteId: 1, siteName: "Site", categoryName: "Category", ticketId: index + 30, ticketItemId: index + 40, quantity: index === 0 ? 50 : 2, unit: "piece", estimatedUnitCost: "10.00", estimatedTotalCost: index === 0 ? "500.00" : "20.00", supplierName: `Supplier ${index + 1}`, status: "estimated", batchId: null })) };
  const flags = { renderFail: false, batchFailPo: 0, syncFail: false, replacementOrderId: 0, unifiedInitFail:false }; let queue = Promise.resolve(); let transactionDepth = 0;
  const queries: string[] = [];
  const tx: any = { execute: async (statement: any) => {
    const parsed = new MySqlDialect().sqlToQuery(statement), q = parsed.sql.replace(/\s+/g, " ").trim(), p: any[] = parsed.params; queries.push(q);
    const rows = (values: any[]) => [structuredClone(values), []];
    if (q === "SELECT DATABASE() AS databaseName") return rows([{ databaseName: "copycmms2" }]);
    if(q.startsWith('INSERT INTO delegate_pricing_bundle_approvals')){if(flags.unifiedInitFail)throw Error('unified approval table unavailable');state.unifiedApprovals??=[];state.unifiedApprovals.push({bundleId:p[0],status:'pending_accounting'});return [{affectedRows:1}];}
    if (q.startsWith("SELECT purchaseOrderId FROM supplier_return_replacement_plans")) return rows(p.includes(flags.replacementOrderId) ? [{ purchaseOrderId: flags.replacementOrderId }] : []);
    if (q.startsWith("SELECT id FROM users")) return rows(p[0] === 11 ? [{ id: 11 }] : []);
    if (q.startsWith("SELECT i.*,p.poNumber")) return rows(state.items.filter((i: any) => i.id === p[0]));
    if (q.startsWith("SELECT bundleId FROM delegate_pricing_bundle_items")) return rows(state.members.filter((m: any) => m.reservedItemId === p[0]));
    if (q.startsWith("SELECT reservedItemId FROM delegate_pricing_bundle_items")) return rows(state.members.filter((m: any) => p.includes(m.reservedItemId)));
    if (q.includes("FROM delegate_pricing_bundles WHERE openDelegateId=")) return rows(state.bundles.filter((b: any) => b.openDelegateId === p[0]));
    if (q.startsWith("INSERT INTO delegate_pricing_bundles")) { state.bundles.push({ id: state.bundles.length + 1, delegateId: p[0], openDelegateId: p[1], status: "open", revision: 0, effectsDone: 0, createdAt: "2026-10-17T12:00:00Z" }); return [{ insertId: state.bundles.length }]; }
    if (q.startsWith("UPDATE delegate_pricing_bundles SET bundleNumber=")) { state.bundles.find((b: any) => b.id === p[1]).bundleNumber = p[0]; return [{ affectedRows: 1 }]; }
    if (q.startsWith("SELECT COUNT(*) AS count")) return rows([{ count: state.members.filter((m: any) => m.bundleId === p[0] && !m.removedAt).length }]);
    if (q.startsWith("INSERT INTO delegate_pricing_bundle_items")) { state.members.push({ id: state.members.length + 1, bundleId: p[0], purchaseOrderItemId: p[1], reservedItemId: p[2], removedAt: null }); return [{ insertId: state.members.length }]; }
    if (q.startsWith("UPDATE delegate_pricing_bundles SET revision=revision+1")) { state.bundles.find((b: any) => b.id === p[0]).revision++; return [{ affectedRows: 1 }]; }
    if (q.startsWith("SELECT id,bundleNumber,delegateId,status")) return rows(state.bundles.filter((b: any) => b.id === p[0]).map(({ snapshotJson, pdfContent, ...b }: any) => b));
    if (q.startsWith("SELECT id FROM delegate_pricing_bundle_items WHERE")) return rows(state.members.filter((m: any) => m.bundleId === p[0] && m.purchaseOrderItemId === p[1] && !m.removedAt));
    if (q.startsWith("UPDATE delegate_pricing_bundle_items SET reservedItemId=NULL,removedAt=")) { Object.assign(state.members.find((m: any) => m.id === p[0]), { removedAt: "now", reservedItemId: null }); return [{ affectedRows: 1 }]; }
    if (q.startsWith("SELECT purchaseOrderItemId FROM delegate_pricing_bundle_items")) return rows(state.members.filter((m: any) => m.bundleId === p[0] && !m.removedAt).sort((a: any,b: any) => a.purchaseOrderItemId-b.purchaseOrderItemId));
    if (q.startsWith("SELECT id,name,signatureUrl FROM users")) return rows([{ id: 11, name: "Delegate", signatureUrl: "delegate-signature" }]);
    if (q.startsWith("SELECT id,name FROM users WHERE id IN")) return rows((state.reviewers || []).filter((user: any) => p.includes(user.id)));
    if (q.startsWith("SELECT p.poNumber,r.name")) return rows([{ poNumber: `PR-${p[0]}`, requesterId: p[0], requesterName: `Requester-${p[0]}`, reviewerId: Number(p[0]) + 1000, reviewerName: `Reviewer-${p[0]}`, requesterSignature: "requester-signature", reviewerSignature: "reviewer-signature" }]);
    if (q.startsWith("SELECT id FROM purchase_packages")) return rows([{ id: p[0] }]);
    if (q.startsWith("UPDATE purchase_orders SET requesterSignatureSnapshot=")) return [{ affectedRows: 1 }];
    if (q.startsWith("INSERT INTO delegate_pricing_bundle_batches")) { state.links.push({ bundleId: p[0], purchaseOrderId: p[1], pricingBatchId: p[2], purchasePackageSubmissionId: p[3], effectsDone: 0 }); return [{ insertId: state.links.length }]; }
    if (q.startsWith("UPDATE delegate_pricing_bundle_items SET reservedItemId=NULL WHERE")) { state.members.filter((m: any) => m.bundleId === p[0] && !m.removedAt).forEach((m: any) => { m.reservedItemId = null; }); return [{ affectedRows: 1 }]; }
    if (q.startsWith("UPDATE delegate_pricing_bundles SET status='archived',openDelegateId=")) { const bundle = state.bundles.find((b: any) => b.id === p[1]); Object.assign(bundle, { status: "archived", openDelegateId: null, snapshotJson: p[0], pdfContent: null, sentAt: "now", revision: bundle.revision + 1 }); return [{ affectedRows: 1 }]; }
    if (q.startsWith("UPDATE delegate_pricing_bundles SET pdfContent=")) {
      const bundle = state.bundles.find((b: any) => b.id === p[1]);
      if (bundle && ["sent", "archived"].includes(bundle.status) && bundle.pdfContent == null && bundle.revision === p[2]) { bundle.pdfContent = p[0]; return [{ affectedRows: 1 }]; }
      return [{ affectedRows: 0 }];
    }
    if (q.startsWith("SELECT purchaseOrderId,pricingBatchId FROM delegate_pricing_bundle_batches")) return rows(state.links.filter((m: any) => m.bundleId === p[0] && !m.effectsDone));
    if (q.startsWith("UPDATE delegate_pricing_bundle_batches SET effectsDone=1")) { state.links.find((m: any) => m.bundleId === p[0] && m.pricingBatchId === p[1]).effectsDone = 1; return [{ affectedRows: 1 }]; }
    if (q.startsWith("UPDATE delegate_pricing_bundles SET effectsDone=1")) { state.bundles.find((b: any) => b.id === p[0]).effectsDone = 1; return [{ affectedRows: 1 }]; }
    if (q.startsWith("UPDATE delegate_pricing_bundles SET status='archived'")) { state.bundles.find((b: any) => b.id === p[0]).status = "archived"; return [{ affectedRows: 1 }]; }
    if (q.startsWith("SELECT snapshotJson FROM delegate_pricing_bundles")) return rows(state.bundles.filter((b: any) => b.id === p[0]));
    if (q.startsWith("SELECT pdfContent")) return rows(state.bundles.filter((b: any) => b.id === p[0]));
    if (q.startsWith("SELECT name FROM users")) return rows([{ name: "Delegate" }]);
    if (q.startsWith("SELECT b.id,b.bundleNumber")) return rows(state.bundles.filter((b: any) => p.length === 0 || b.delegateId === p[0]).map((b:any)=>{const members=state.members.filter((m:any)=>m.bundleId===b.id&&!m.removedAt);const {snapshotJson,pdfContent,...header}=b;return {...header,itemCount:members.length,openTotal:members.reduce((sum:number,m:any)=>sum+Number(state.items.find((i:any)=>i.id===m.purchaseOrderItemId).estimatedTotalCost),0),sentTotals:b.snapshotJson?JSON.parse(b.snapshotJson).rows.map((i:any)=>i.estimatedTotalCost):null};}));
    if (q.startsWith("INSERT INTO audit_logs")) return [{ insertId: 1 }];
    throw Error(q);
  } };
  const database: any = { execute: tx.execute, transaction: (work: any) => { const next = queue.then(async () => { const old = structuredClone(state); transactionDepth++; try { return await work(tx); } catch (error) { state = old; throw error; } finally { transactionDepth--; } }); queue = next.catch(() => {}); return next; } };
  const submit = vm.runInNewContext(submitCode, {
    isDelegateRole,
    TRPCError, pricingBundlesEnabled: () => true, reservedPricingItemIds, assertRoutedPurchaseItemReady,
    reserveReplacementPricing: async () => null,
    isItemAssignedToPODelegate: (user: any, item: any) => user.id === item.delegateId,
    db: {
      getPurchaseOrderById: async (id: number, transaction: any) => { expect(transaction).toBe(tx); return { id, poNumber: `PR-${id}`, status: "pending_estimate" }; },
      getPOItems: async (id: number, transaction: any) => { expect(transaction).toBe(tx); return state.items.filter((i: any) => i.purchaseOrderId === id); },
      getNextBatchNumber: async (id: number, transaction: any) => { expect(transaction).toBe(tx); return state.batches.filter((b: any) => b.purchaseOrderId === id).length + 1; },
      createPOPricingBatch: async (data: any, transaction: any) => { expect(transaction).toBe(tx); if (data.purchaseOrderId === flags.batchFailPo) throw Error("accounting write failed"); const id = state.batches.length + 1; state.batches.push({ ...data, id }); return id; },
      updatePOItem: async (id: number, data: any, transaction: any) => { expect(transaction).toBe(tx); Object.assign(state.items.find((i: any) => i.id === id), data); },
      updatePurchaseOrder: async (_id: number, _data: any, transaction: any) => { expect(transaction).toBe(tx); },
      getUsersByRole: async () => [], createAuditLog: vi.fn(),
    },
    archiveDelegatePricingBatchPdf: () => { throw Error("Do not archive a second live-data PDF"); },
  });
  const ports = {
    database: vi.fn(async () => database), submitPO: vi.fn(submit),
    createPackageSubmission: vi.fn(async (packageId: number, userId: number, transaction: any) => { expect(transaction).toBe(tx); const result = { id: state.submissions.length + 1, packageId, userId }; state.submissions.push(result); return result; }),
    render: vi.fn(async (snapshot: any) => { expect(transactionDepth).toBe(0); if (flags.renderFail) throw Error("PDF failed"); return Buffer.from("%PDF-" + JSON.stringify(snapshot)); }),
    signature: vi.fn(async (value: string) => value ? `data:image/png;base64,${Buffer.from(value).toString("base64")}` : ""),
    sync: vi.fn(async () => { if (flags.syncFail) throw Error("ticket sync unavailable"); }),
  };
  return { service: new PricingBundleService(ports), ports, flags, tx, queries, state: () => state, async add(...ids: number[]) { let id = 0; for (const itemId of ids) id = (await this.service.add(actor,itemId)).id; return id; } };
}
describe("delegate manager keeps the delegate's own pricing bundle workflow",()=>{
  it("sends and downloads its frozen bundle while denying another manager's bundle",async()=>{
    const f=fixture(),manager={...actor,role:"delegate_manager"};
    const {id}=await f.service.add(manager,1);
    await expect(f.service.detail({...manager,id:12},id)).rejects.toMatchObject({code:"FORBIDDEN"});
    await f.service.send(manager,id,1);
    expect(f.state().bundles[0]).toMatchObject({delegateId:11,status:"archived"});
    expect(f.state().items.find((item:any)=>item.id===1)).toMatchObject({delegateId:11,status:"estimated"});
    const pdf=await f.service.pdf(manager,id);
    expect(pdf.name).toMatch(/\.pdf$/);expect(pdf.content).toBeTruthy();
    expect(f.queries.some(query=>query.includes("AND role=? FOR UPDATE"))).toBe(true);
  });
});
beforeEach(() => vi.stubEnv("DELEGATE_PRICING_BUNDLES_ENABLED", "true"));
afterEach(() => vi.unstubAllEnvs());
describe("Pricing bundle → existing accounting batches, isolated with no database", () => {
  it("freezes each included routed item's actual reviewer and review-time signature, excluding other items in the same order", async () => {
    const f = fixture();
    f.state().reviewers = [{ id: 201, name: "Construction reviewer", signatureUrl: "changed-profile" }, { id: 202, name: "Senior reviewer", signatureUrl: "new-profile-signature" }, { id: 203, name: "Unselected reviewer" }];
    Object.assign(f.state().items[0], { reviewRole: "construction_procurement_manager", reviewedById: 201, reviewedAt: "2026-11-03T08:00:00Z", reviewerSignatureSnapshot: "captured-construction" });
    Object.assign(f.state().items[1], { reviewRole: "senior_management", reviewedById: 202, reviewedAt: "2026-11-03T09:00:00Z", reviewerSignatureSnapshot: null });
    Object.assign(f.state().items[2], { purchaseOrderId: 101, reviewRole: "general_maintenance_manager", reviewedById: 203, reviewedAt: "2026-11-03T10:00:00Z", reviewerSignatureSnapshot: "unselected-signature" });
    const id = await f.add(1, 2); await f.service.send(actor, id, 2);
    const snapshot = JSON.parse(f.state().bundles[0].snapshotJson);
    expect(snapshot.reviewSignatureVersion).toBe(2);
    expect(snapshot.signatures.map((entry: any) => [entry.reviewerId, entry.reviewerName, entry.purchaseOrderItemIds])).toEqual([[201, "Construction reviewer", [1]], [202, "Senior reviewer", [2]]]);
    expect(snapshot.signatures[0].reviewerSource).toBe("captured-construction");
    expect(snapshot.signatures[1].reviewerSource).toBeNull(); expect(snapshot.signatures[1].reviewerSignature).toBe("");
    expect(JSON.stringify(snapshot)).not.toContain("Unselected reviewer"); expect(JSON.stringify(snapshot)).not.toContain("Reviewer-101");
    expect(f.ports.signature.mock.calls.flat()).not.toContain("changed-profile"); expect(f.ports.signature.mock.calls.flat()).not.toContain("new-profile-signature");
    const original = await f.service.pdf(actor, id);
    f.state().reviewers[0].name = "Changed after send"; f.state().items[0].reviewerSignatureSnapshot = "changed-after-send";
    expect(await f.service.pdf(actor, id)).toEqual(original);
    const parsed = JSON.parse(f.state().bundles[0].snapshotJson); expect(parsed.signatures[0].reviewerName).toBe("Construction reviewer");
    expect(f.queries.filter(q => q.startsWith("SELECT id,name FROM users WHERE id IN"))).toHaveLength(1);
    expect(f.queries.filter(q => q.startsWith("UPDATE purchase_orders SET requesterSignatureSnapshot=")).every(q => !q.includes("reviewerSignatureSnapshot="))).toBe(true);
    let html = "";
    const render = vm.runInNewContext(extract("server/services/export/exportService.ts", "generatePurchaseRequestPDF"), { db: new Proxy({}, { get: () => () => { throw Error("Live reads forbidden"); } }), getSignatureDataUrl: async () => "", escapeHtml: (v: any) => String(v).replaceAll("<", "&lt;"), fmtSAR: (n: number) => n.toFixed(2), amountToArabicCurrencyPhrase: String, readAccountingSignature, htmlToPdf: async (value: string) => { html = value; return Buffer.from("%PDF-local"); } });
    await render(0, actor.id, undefined, undefined, snapshot);
    expect(html).toContain("Construction reviewer"); expect(html).toContain("Senior reviewer"); expect(html).not.toContain("Unselected reviewer");
    expect(html.match(/>مراجع الطلب<\/td>/g)).toHaveLength(2);
    expect(html).toContain(Buffer.from("captured-construction").toString("base64"));
    fs.mkdirSync("tmp/purchase-item-review/docs", { recursive: true }); fs.writeFileSync("tmp/purchase-item-review/docs/multiple-reviewers.html", html);
  });
  it.each(["missing decision", "missing reviewer", "wrong frozen membership"])("refuses routed signature metadata that has %s", async issue => {
    const f = fixture(); f.state().reviewers = [{ id: 201, name: "Reviewer" }];
    Object.assign(f.state().items[0], { reviewRole: "senior_management", reviewedById: 201, reviewedAt: "2026-11-03T08:00:00Z", reviewerSignatureSnapshot: "captured" });
    const id = await f.add(1);
    if (issue === "missing decision") { f.state().items[0].reviewedAt = null; await expect(f.service.send(actor, id, 1)).rejects.toThrow(); expect(f.state().batches).toHaveLength(0); return; }
    if (issue === "missing reviewer") { f.state().reviewers = []; await expect(f.service.send(actor, id, 1)).rejects.toThrow("مراجع"); expect(f.state().batches).toHaveLength(0); return; }
    await f.service.send(actor, id, 1); const frozen = JSON.parse(f.state().bundles[0].snapshotJson);
    frozen.signatures[0].purchaseOrderItemIds = [999]; f.state().bundles[0].snapshotJson = JSON.stringify(frozen); f.state().bundles[0].pdfContent = null;
    await expect(f.service.pdf(actor, id)).rejects.toThrow("لقطة");
  });
  it('initializes unified approval atomically with the original send only when rollout is enabled',async()=>{
    const f=fixture();vi.stubEnv('DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED','true');const id=await f.add(1,3);await f.service.send(actor,id,2);
    expect(f.state().unifiedApprovals).toEqual([{bundleId:id,status:'pending_accounting'}]);expect(f.state().batches).toHaveLength(2);
    await f.service.send(actor,id,2);expect(f.state().unifiedApprovals).toHaveLength(1);expect(f.state().batches).toHaveLength(2);
  });
  it('rolls back every accounting batch and the archive if unified initialization fails during send',async()=>{
    const f=fixture();vi.stubEnv('DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED','true');f.flags.unifiedInitFail=true;const id=await f.add(1,3);
    await expect(f.service.send(actor,id,2)).rejects.toThrow('unified approval table unavailable');expect(f.state().batches).toHaveLength(0);expect(f.state().submissions).toHaveLength(0);expect(f.state().bundles[0].status).toBe('open');
  });
  it("rejects a replacement purchase in a purchase package before creating accounting documents", async () => {
    const f = fixture(); const id = await f.add(3); f.flags.replacementOrderId = 103;
    await expect(f.service.send(actor, id, 1)).rejects.toThrow("دفعة مستقلة");
    expect(f.state().submissions).toHaveLength(0);
    expect(f.state().batches).toHaveLength(0);
    expect(f.state().bundles[0].status).toBe("open");
  });
  it("does not allocate a number on read; allocates one open bundle for concurrent adds and duplicate clicks", async () => {
    const f = fixture(); expect(await f.service.list(actor)).toEqual([]); expect(f.state().bundles).toHaveLength(0);
    await Promise.all([f.service.add(actor,1), f.service.add(actor,2), f.service.add(actor,1)]);
    expect(f.state().bundles).toHaveLength(1); expect(f.state().members).toHaveLength(2); expect(f.state().bundles[0].bundleNumber).toMatch(/^DPB-\d{4}-000001$/);
    expect(f.state().items[0].quantity).toBe(50); expect(f.state().items[0].batchId).toBeNull();
  });
  it("limits by PO rows, keeps identical catalog items separate, and reuses the same empty bundle number", async () => {
    const f = fixture(); const id = await f.add(...Array.from({length:20},(_,i)=>i+1));
    await expect(f.service.add(actor,21)).rejects.toThrow("20"); await f.service.remove(actor,id,1); await f.service.add(actor,21);
    for (const itemId of Array.from({length:20},(_,i)=>i+2)) await f.service.remove(actor,id,itemId);
    await expect(f.service.send(actor,id,f.state().bundles[0].revision)).rejects.toThrow("1 إلى 20");
    await f.service.add(actor,1); expect(f.state().bundles).toHaveLength(1); expect(f.state().items[0].estimatedUnitCost).toBe("10.00");
  });
  it("keeps references and creates only selected rows in original single/package accounting scopes", async () => {
    const f = fixture(); const id = await f.add(1,3,4); await f.service.send(actor,id,3);
    expect(f.state().batches).toHaveLength(3); expect(f.state().batches[0].delegateSignatureSnapshot).toBe("delegate-signature"); expect(f.state().submissions.map((s: any)=>s.packageId).sort((a: number,b: number)=>a-b)).toEqual([9,10]);
    expect(f.state().batches.find((b: any)=>b.purchaseOrderId===101).purchasePackageSubmissionId).toBeUndefined();
    expect(f.state().batches.filter((b: any)=>b.scope==='multi')).toHaveLength(2);
    expect(f.state().items[1].batchId).toBeNull();
    const snapshot = JSON.parse(f.state().bundles[0].snapshotJson); expect(snapshot.rows.map((i: any)=>i.id)).toEqual([1,3,4]);
    expect(new Set(snapshot.rows.map((i: any)=>i.sectionId)).size).toBe(3); expect(snapshot.rows[0].ticketId).toBe(30);
    const next = await f.service.add(actor,2); expect(next.id).not.toBe(id); expect(f.state().bundles[1].status).toBe("open");
    expect(f.state().bundles[0].status).toBe("archived");
  });
  it("lists totals from frozen sent prices and preserves per-delegate list scope",async()=>{
    const f=fixture();const id=await f.add(1,2);expect((await f.service.list(actor))[0].total).toBe(520);
    await f.service.send(actor,id,2);f.state().items[0].estimatedTotalCost="99999";
    expect((await f.service.list(actor))[0]).toMatchObject({status:"archived",total:520,itemCount:2});
    const listing=(await f.service.list(actor))[0];for(const field of ["snapshotJson","pdfContent","sentTotals","openTotal"])expect(listing).not.toHaveProperty(field);
    expect(await f.service.list({...actor,id:22})).toEqual([]);
  });
  it("rolls back every batch, source batchId and membership on a later accounting failure", async () => {
    const f = fixture(); const id = await f.add(1,3,4); f.flags.batchFailPo=103;
    await expect(f.service.send(actor,id,3)).rejects.toThrow("accounting write failed");
    expect(f.state().batches).toHaveLength(0); expect(f.state().submissions).toHaveLength(0); expect(f.state().items.some((i: any)=>i.batchId)).toBe(false); expect(f.state().bundles[0].status).toBe("open");
  });
  it("does not send anything if selection is stale, or a source was cancelled/reassigned/unpriced", async () => {
    const f = fixture(); const id = await f.add(1);
    await expect(f.service.send(actor,id,0)).rejects.toThrow("تغيرت");
    f.state().items[0].delegateId=22; await expect(f.service.send(actor,id,1)).rejects.toThrow("مسندًا");
    f.state().items[0].delegateId=11; f.state().items[0].status="cancelled"; await expect(f.service.send(actor,id,1)).rejects.toThrow("جاهز");
    f.state().items[0].status="estimated"; f.state().items[0].estimatedUnitCost="0"; await expect(f.service.send(actor,id,1)).rejects.toThrow("تسعيرًا"); expect(f.state().batches).toHaveLength(0);
  });
  it("sends without rendering and retries a failed download without resending accounting", async () => {
    const f=fixture(); const id=await f.add(1); f.flags.renderFail=true;
    expect(await f.service.send(actor,id,1)).toEqual({success:true,effectsDone:true});
    expect(f.ports.render).not.toHaveBeenCalled(); expect(f.state().bundles[0].pdfContent).toBeNull();
    await expect(f.service.pdf(actor,id)).rejects.toThrow("أعد محاولة التنزيل");
    expect(f.state().batches).toHaveLength(1); expect(f.state().bundles[0].status).toBe("archived");
    f.flags.renderFail=false; expect((await f.service.pdf(actor,id)).name).toMatch(/DPB-.*\.pdf/);
    expect(f.state().batches).toHaveLength(1); expect(f.state().bundles[0].pdfContent).not.toBeNull();
  });
  it("does not send if preserving the signature snapshot fails",async()=>{
    const f=fixture();const id=await f.add(1);f.ports.signature.mockRejectedValueOnce(Error("signature unavailable"));
    await expect(f.service.send(actor,id,1)).rejects.toThrow("signature unavailable");
    expect(f.state().bundles[0].status).toBe("open");expect(f.state().batches).toHaveLength(0);expect(f.ports.render).not.toHaveBeenCalled();
  });
  it.each(["delegate","owner","admin","accountant"])("rejects PDF before send, including direct API access by %s",async role=>{
    const f=fixture(); const id=await f.add(1); f.ports.signature.mockClear();
    const api=router({delegatePricingBundles:createPricingBundlesRouter(f.ports,()=>true)});
    const caller=api.createCaller({user:{...actor,role},req:{headers:{}},res:{}} as TrpcContext);
    await expect(caller.delegatePricingBundles.pdf({id})).rejects.toMatchObject({code:"CONFLICT"});
    expect(f.ports.signature).not.toHaveBeenCalled(); expect(f.ports.render).not.toHaveBeenCalled();
    expect(f.state().batches).toHaveLength(0);
  });
  it("uses the frozen prices and signature bytes on first download without reading live sources",async()=>{
    const f=fixture(); const id=await f.add(1,3,4); await f.service.send(actor,id,3);
    expect(f.ports.signature).toHaveBeenCalledTimes(3); // One fetch per unique signature, shared across PRs.
    const frozen=JSON.parse(f.state().bundles[0].snapshotJson);
    f.state().items[0].estimatedUnitCost="999"; f.state().items[0].itemName="Changed after send";
    f.ports.signature.mockImplementation(async()=>{throw Error("Live signatures forbidden after send");});
    const afterSend=f.queries.length; const result=await f.service.pdf(actor,id);
    expect(Buffer.from(result.content,"base64").toString()).toBe("%PDF-"+JSON.stringify(frozen));
    expect(f.queries.slice(afterSend).some(q=>q.includes("FROM users")||q.includes("FROM purchase_order_items"))).toBe(false);
    await f.service.archive(actor,id); expect(await f.service.pdf(actor,id)).toEqual(result);
  });
  it("coalesces concurrent downloads but still authorizes each requester",async()=>{
    const f=fixture(); const id=await f.add(1); await f.service.send(actor,id,1);
    const [first,second]=await Promise.all([f.service.pdf(actor,id),f.service.pdf(actor,id)]);
    expect(first).toEqual(second); expect(f.ports.render).toHaveBeenCalledTimes(1);
    await expect(f.service.pdf({...actor,id:22},id)).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(f.service.pdf({...actor,isActive:0},id)).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(f.service.pdf({...actor,role:"observer"},id)).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("returns the same winning saved bytes when separate app instances render concurrently",async()=>{
    const f=fixture(); const id=await f.add(1); await f.service.send(actor,id,1);
    let release!:()=>void; const gate=new Promise<void>(resolve=>{release=resolve;}); let calls=0;
    f.ports.render.mockImplementation(async()=>{const attempt=++calls;if(calls===2)release();await gate;return Buffer.from(`%PDF-instance-${attempt}`);});
    const other=new PricingBundleService(f.ports);
    const [first,second]=await Promise.all([f.service.pdf(actor,id),other.pdf(actor,id)]);
    expect(first).toEqual(second); expect(calls).toBe(2);
    expect(Buffer.from(f.state().bundles[0].pdfContent).toString("base64")).toBe(first.content);
  });
  it("keeps existing historical PDF bytes without requiring or rebuilding the snapshot",async()=>{
    const f=fixture(); const id=await f.add(1); Object.assign(f.state().bundles[0],{status:"archived",snapshotJson:null,pdfContent:Buffer.from("%PDF-historical")});
    expect(Buffer.from((await f.service.pdf(actor,id)).content,"base64").toString()).toBe("%PDF-historical");
    expect(f.ports.render).not.toHaveBeenCalled(); expect(f.ports.signature).not.toHaveBeenCalled();
  });
  it.each([null,"broken JSON",'{}'])("does not guess missing snapshot data: %s",async snapshotJson=>{
    const f=fixture(); const id=await f.add(1); await f.service.send(actor,id,1); f.state().bundles[0].snapshotJson=snapshotJson;
    await expect(f.service.pdf(actor,id)).rejects.toThrow("لقطة الحزمة"); expect(f.ports.render).not.toHaveBeenCalled(); expect(f.state().batches).toHaveLength(1);
  });
  it.each([0,8*1024*1024+1])("does not save an invalid PDF of %i bytes",async size=>{
    const invalid=Buffer.alloc(size);
    const f=fixture(); const id=await f.add(1); await f.service.send(actor,id,1); f.ports.render.mockResolvedValueOnce(invalid);
    await expect(f.service.pdf(actor,id)).rejects.toThrow("أعد محاولة التنزيل");
    expect(f.state().bundles[0].pdfContent).toBeNull(); expect(f.state().batches).toHaveLength(1);
    await expect(f.service.pdf(actor,id)).resolves.toHaveProperty("content");
  });
  it("returns membership only, reflects resaved prices, and freezes exact sent rows and PDF", async () => {
    const f = fixture(); const id = await f.add(1,2); const initial = structuredClone(f.state().items[1]); await f.service.remove(actor,id,2);
    expect(f.state().items[1]).toEqual(initial); f.state().items[0].estimatedUnitCost="12"; f.state().items[0].estimatedTotalCost="600";
    await f.service.send(actor,id,3); const pdf = await f.service.pdf(actor,id); f.state().items[0].estimatedUnitCost="999";
    expect(await f.service.pdf(actor,id)).toEqual(pdf); expect((await f.service.detail(actor,id)).total).toBe(600); expect(f.ports.render).toHaveBeenCalledTimes(1);
    await expect(f.service.remove(actor,id,1)).rejects.toThrow("أُرسلت"); await f.service.archive(actor,id); expect(f.state().bundles[0].status).toBe("archived");
  });
  it("does not create duplicate accounting batches on concurrent or repeated sends", async () => {
    const f = fixture(); const id = await f.add(1,2); await Promise.all([f.service.send(actor,id,2),f.service.send(actor,id,2)]); expect(f.state().batches).toHaveLength(1); expect(f.state().links).toHaveLength(1);
  });
  it("retains a visible durable retry for failed ticket synchronization without resubmitting accounting", async () => {
    vi.spyOn(console,"error").mockImplementation(()=>{}); const f=fixture(); const id=await f.add(1); f.flags.syncFail=true;
    expect((await f.service.send(actor,id,1)).effectsDone).toBe(false); expect(f.state().batches).toHaveLength(1); expect(f.state().bundles[0].effectsDone).toBe(0);
    f.flags.syncFail=false; expect(await f.service.finish(actor,id)).toBe(true); expect(f.state().batches).toHaveLength(1); vi.restoreAllMocks();
  });
  it("enforces own bundle, parent/member identity, and read-only observer with no exports", async () => {
    const f=fixture(); const id=await f.add(1);
    await expect(f.service.detail({...actor,id:22},id)).rejects.toThrow("لا تخصك");
    await expect(f.service.remove(actor,id,2)).rejects.toThrow("لا ينتمي");
    const observer={...actor,role:"observer"}; expect((await f.service.detail(observer,id)).items).toHaveLength(1);
    await expect(f.service.pdf(observer,id)).rejects.toThrow("التصدير"); await expect(f.service.add(observer,2)).rejects.toThrow("للمندوب");
    expect(JSON.stringify(await f.service.detail(observer,id))).not.toMatch(/signature|pdfContent|snapshotJson/);
    expect(canRoleAccessPath("delegate","/delegate-pricing-bundles")).toBe(true); expect(canRoleAccessPath("warehouse","/delegate-pricing-bundles")).toBe(false);
  });
  it("does not read new tables before rollout and central observer guard rejects mutations", async () => {
    const f=fixture(); const api=router({delegatePricingBundles:createPricingBundlesRouter(f.ports,()=>false)});
    const ctx={user:actor,req:{headers:{}},res:{}} as TrpcContext; const caller=api.createCaller(ctx);
    expect(await caller.delegatePricingBundles.status()).toEqual({enabled:false}); expect(await caller.delegatePricingBundles.list()).toEqual([]); expect(f.ports.database).not.toHaveBeenCalled();
    await expect(caller.delegatePricingBundles.add({itemId:1})).rejects.toThrow("مفعلة");
    const observer=api.createCaller({...ctx,user:{...actor,role:"observer"}} as TrpcContext);
    expect(await observer.delegatePricingBundles.list()).toEqual([]); await expect(observer.delegatePricingBundles.pdf({id:1})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(observer.delegatePricingBundles.send({id:1,revision:0})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("only reads reservations after rollout, keeping existing paths free of new-table queries by default",async()=>{
    const f=fixture(); await f.add(1); expect(await reservedPricingItemIds(f.tx,[1,2])).toEqual(new Set([1]));
    vi.stubEnv("DELEGATE_PRICING_BUNDLES_ENABLED","false"); const calls=f.queries.length; expect(await reservedPricingItemIds(f.tx,[1])).toEqual(new Set()); expect(f.queries).toHaveLength(calls);
  });
});

describe("Existing PDF template with exact immutable bundle snapshot",()=>{
  it("shows the original transaction and only the VAT-inclusive difference as replacement custody",async()=>{
    const f=fixture(); const id=await f.add(1); await f.service.send(actor,id,1);
    const snapshot=JSON.parse(f.state().bundles[0].snapshotJson); let html="";
    snapshot.compensations=[{planId:9,caseId:3,purchaseOrderItemId:1,originalPoNumber:"PR-ORIGINAL",
      originalBundleNumber:"DPB-ORIGINAL",returnNumber:"RTN-ORIGINAL",returnedQuantity:"1",replacementQuantity:"1",
      originalPurchaseValue:"100.0000",total:"120.0000",creditAllocated:"100.0000",additionalFunding:"20.0000"}];
    const render=vm.runInNewContext(extract("server/services/export/exportService.ts","generatePurchaseRequestPDF"),{
      db:new Proxy({}, {get:()=>()=>{throw Error("Live reads/writes forbidden in immutable bundle PDF");}}),
      getSignatureDataUrl:async()=>"", escapeHtml:(s:any)=>String(s).replaceAll("<","&lt;"), fmtSAR:(n:number)=>n.toFixed(2), amountToArabicCurrencyPhrase:(n:number)=>`CUSTODY:${n}`,
      readAccountingSignature, htmlToPdf:async(value:string)=>{html=value;return Buffer.from("%PDF-local");},
    });
    await render(0,actor.id,undefined,undefined,snapshot);
    expect(html).toContain("PR-ORIGINAL"); expect(html).toContain("DPB-ORIGINAL"); expect(html).toContain("RTN-ORIGINAL");
    expect(html).toContain("فرق العهدة"); expect(html).toContain("20.00 ر.س");
    expect(html).toContain(`CUSTODY:${Math.max(0, snapshot.rows.reduce((sum:number,row:any)=>sum+Number(row.estimatedTotalCost),0)-100)}`);
  });
  it("renders original PR/section and groups each approval actor once without accessing live source data",async()=>{
    const f=fixture(); const id=await f.add(1,3); await f.service.send(actor,id,2); const snapshot=JSON.parse(f.state().bundles[0].snapshotJson); let html="";
    snapshot.signatures[1].requesterId=snapshot.signatures[0].requesterId;
    snapshot.signatures[1].requesterName=snapshot.signatures[0].requesterName;
    snapshot.signatures[1].requesterSignature=snapshot.signatures[0].requesterSignature;
    snapshot.signatures[1].reviewerId=snapshot.signatures[0].requesterId;
    snapshot.signatures[1].reviewerName=snapshot.signatures[0].requesterName;
    snapshot.signatures[1].reviewerSignature=snapshot.signatures[0].requesterSignature;
    snapshot.signatures[0].reviewerId=snapshot.signatures[0].requesterId;
    snapshot.signatures[0].reviewerName=snapshot.signatures[0].requesterName;
    snapshot.signatures[0].reviewerSignature=snapshot.signatures[0].requesterSignature;
    const render=vm.runInNewContext(extract("server/services/export/exportService.ts","generatePurchaseRequestPDF"),{
      db:new Proxy({}, {get:()=>()=>{throw Error("Live reads/writes forbidden in immutable bundle PDF");}}),
      getSignatureDataUrl:async()=>"", escapeHtml:(s: any)=>String(s).replaceAll("<","&lt;"), fmtSAR:(n:number)=>n.toFixed(2), amountToArabicCurrencyPhrase:(n:number)=>String(n),
      readAccountingSignature,
      htmlToPdf:async(value:string)=>{html=value;return Buffer.from("%PDF-local");},
    });
    await render(0,actor.id,undefined,undefined,snapshot);
    expect(html).toContain("items-table"); expect(html).toContain(snapshot.number); expect(html).toContain("PR-101"); expect(html).toContain("PR-103"); expect(html).toContain("Section 1"); expect(html).toContain("Section 3");
    expect(html.match(/Requester-101/g)).toHaveLength(2); // Once as requester and once as reviewer.
    expect(html.match(/مقدّم الطلب/g)).toHaveLength(1); expect(html.match(/مراجع الطلب/g)).toHaveLength(1);
    expect(html).toContain("الطلبات: PR-101، PR-103"); expect(html).not.toContain("Requester-103");
    expect(html).toContain("Supplier 3"); expect(html).not.toContain("Material 2"); expect(html).toContain("520.00");
  });

  it("keeps separate frozen signature rows and reports a request with no reviewer",async()=>{
    const f=fixture(); const id=await f.add(1,3); await f.service.send(actor,id,2); const snapshot=JSON.parse(f.state().bundles[0].snapshotJson); let html="";
    snapshot.signatures[1].requesterId=snapshot.signatures[0].requesterId;
    snapshot.signatures[1].requesterName=snapshot.signatures[0].requesterName;
    snapshot.signatures[1].requesterSignature="different-frozen-signature";
    snapshot.signatures[1].reviewerId=null; snapshot.signatures[1].reviewerName="—"; snapshot.signatures[1].reviewerSignature="";
    const render=vm.runInNewContext(extract("server/services/export/exportService.ts","generatePurchaseRequestPDF"),{
      db:new Proxy({}, {get:()=>()=>{throw Error("Live reads/writes forbidden in immutable bundle PDF");}}),
      getSignatureDataUrl:async()=>"", escapeHtml:(s: any)=>String(s).replaceAll("<","&lt;"), fmtSAR:(n:number)=>n.toFixed(2), amountToArabicCurrencyPhrase:(n:number)=>String(n),
      readAccountingSignature,
      htmlToPdf:async(value:string)=>{html=value;return Buffer.from("%PDF-local");},
    });
    await render(0,actor.id,undefined,undefined,snapshot);
    expect(html.match(/مقدّم الطلب/g)).toHaveLength(2);
    expect(html).toContain("طلبات بلا مراجع محدد: PR-103");
  });
});

describe("Compatibility with the existing submission outside the new delegate layer",()=>{
  it("the actual existing item editor blocks a reserved price/quantity and rejects a stale batch identity",async()=>{
    const reserved=vi.fn(async():Promise<void>=>{throw new Error("return item first");});let batchId:number|null=null;const write=vi.fn();
    const tx:any={select:()=>({from:()=>({where:()=>({for:async()=>[{id:1,batchId}]})})}),update:()=>({set:()=>({where:write})})};tx.transaction=async(work:any)=>work(tx);
    const edit=vm.runInNewContext(extract("server/_core/db/purchase.ts","updatePOItem"),{getDb:async()=>tx,pricingBundlesEnabled:()=>true,assertItemOutsidePricingBundle:reserved,purchaseOrderItems:{id:"id",batchId:"batchId"},eq:()=>null,readPOItemHistorySnapshot:vi.fn(),recordPOItemMutationHistory:vi.fn()});
    await expect(edit(1,{quantity:2},undefined,undefined,null)).rejects.toThrow("return item first");expect(write).not.toHaveBeenCalled();
    reserved.mockImplementation(async()=>{});batchId=17;
    await expect(edit(1,{quantity:2},undefined,undefined,null)).rejects.toThrow("تغير إرسال");expect(write).not.toHaveBeenCalled();
  });
  it("keeps original batch selection, accounting status, finalization and archive when disabled",async()=>{
    const items=[{id:1,delegateId:11,status:"estimated",batchId:null,estimatedTotalCost:"30"},{id:2,delegateId:22,status:"estimated",batchId:null},{id:3,delegateId:11,status:"pending",batchId:null}];
    const db={getPurchaseOrderById:vi.fn(async()=>({id:101,poNumber:"PR-101",status:"pending_estimate"})),getPOItems:vi.fn(async()=>items),getNextBatchNumber:vi.fn(async()=>2),createPOPricingBatch:vi.fn(async(..._args:any[])=>17),updatePOItem:vi.fn((..._args:any[])=>{}),updatePurchaseOrder:vi.fn()};
    const finalize=vi.fn(),archive=vi.fn(async()=>true);
    const submit=vm.runInNewContext(submitCode,{isDelegateRole,db:{...db,getDb:async()=>null},TRPCError,pricingBundlesEnabled:()=>false,reservedPricingItemIds,isItemAssignedToPODelegate:(user:any,item:any)=>item.delegateId===user.id,finalizePricedBatchForPO:finalize,archiveDelegatePricingBatchPdf:archive});
    vi.stubEnv("DELEGATE_PRICING_BUNDLES_ENABLED","false");const result=await submit(101,actor);
    expect(result).toMatchObject({batchId:17,itemCount:1,pricingDocumentArchived:true});expect(db.createPOPricingBatch.mock.calls[0][0]).toMatchObject({purchaseOrderId:101,batchNumber:2,itemCount:1,status:"pending_accounting"});
    expect(db.updatePOItem.mock.calls[0][0]).toBe(1); expect(finalize).toHaveBeenCalledOnce();expect(archive).toHaveBeenCalledOnce();
  });
  it("requires the new layer for delegates when enabled without changing other roles",async()=>{
    const database=vi.fn();const submit=vm.runInNewContext(submitCode,{isDelegateRole,TRPCError,pricingBundlesEnabled:()=>true,db:{getPurchaseOrderById:database}});
    await expect(submit(101,actor)).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(database).not.toHaveBeenCalled();
  });
  it("reuses the existing notification helper, ticket synchronization and audit for finalization",async()=>{
    const db={getUsersByRole:vi.fn(async()=>[{id:91}]),createNotification:vi.fn(),createAuditLog:vi.fn()},sync=vi.fn();
    const finalize=vm.runInNewContext(extract("server/routers/purchase/purchase-orders.router.ts","finalizePricedBatchForPO"),{db,syncPathBTicketFromPurchaseOrder:sync});
    await finalize(101,actor,{poNumber:"PR-101"},17,2,[{id:1}]);expect(db.createNotification).toHaveBeenCalledWith(expect.objectContaining({userId:91,relatedPoId:101}));expect(sync).toHaveBeenCalledWith(101,11,expect.any(String));expect(db.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({entityId:101,newValues:{batchId:17,batchNumber:2,itemCount:1}}));
  });
});
