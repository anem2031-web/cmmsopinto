/** Acceptance actions only. No imports of DB, application callers, cookies or
 * credentials. Parent supplies a real authenticated localhost:4002 transport. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export interface AcceptanceRpc {
  query(path: string, input?: unknown): Promise<any>;
  mutate(path: string, input?: unknown): Promise<any>;
}
export interface OperationalAcceptanceConfig {
  warehouseId?: number; siteId?: number; sectionId?: number; collectorId?: number;
  originalCatalogId?: number; replacementCatalogId?: number; categoryId?: number;
  delegateUsername?: string; originalPrice?: number; replacementPrice?: number;
  sourcePhotoOrderId?: number; sourcePhotoItemId?: number; statePath?: string;
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const defaultState = path.join(repo, "docs/runtime-uat/2026-10-30-compensation/operational-api-state.json");
const assert: (condition: unknown, message: string) => asserts condition = (condition, message) => { if (!condition) throw Error(message); };
const note = "UAT-COPYCMMS2-OPERATIONAL-COMPENSATION";
const id = (value: unknown) => { const n = Number(value); assert(Number.isSafeInteger(n) && n > 0, "Invalid acceptance ID"); return n; };
const dataArray = (value: any): any[] => Array.isArray(value) ? value : Array.isArray(value?.rows) ? value.rows : Array.isArray(value?.items) ? value.items : [];

/** Every invocation performs one explicitly named role stage. State contains
 * only public fixture references and operation keys, never authentication. */
export async function runOperationalCompensationAction(rpc: AcceptanceRpc, action: string, options: OperationalAcceptanceConfig = {}) {
  const file = path.resolve(options.statePath || defaultState);
  assert(!path.relative(repo, file).startsWith("..") && path.extname(file) === ".json", "State must remain in this checkout");
  let state: any;
  try { state = JSON.parse(await readFile(file, "utf8")); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  const actor = await rpc.query("auth.me");
  assert(actor?.id && actor.isActive === 1, "Active authenticated actor required");
  const statuses = await Promise.all([rpc.query("supplierReturns.status"), rpc.query("delegatePricingBundles.status"),
    ...(["owner", "admin"].includes(actor.role) ? [rpc.query("operationalIssues.status")] : [])]);
  assert(statuses.every(value => value.enabled === true), "Trial operational, supplier-return and pricing-bundle features must be enabled");
  const config = state?.config || {
    warehouseId: options.warehouseId ?? 1, siteId: options.siteId ?? 390001, sectionId: options.sectionId ?? 150011,
    collectorId: options.collectorId ?? 11640296, originalCatalogId: options.originalCatalogId ?? 180131,
    replacementCatalogId: options.replacementCatalogId ?? 180143, delegateUsername: options.delegateUsername ?? "AZIZ",
    originalPrice: options.originalPrice ?? 1, replacementPrice: options.replacementPrice ?? 2,
    sourcePhotoOrderId: options.sourcePhotoOrderId ?? 3810003, sourcePhotoItemId: options.sourcePhotoItemId ?? 3780003,
    categoryId: options.categoryId,
  };
  assert(config.originalCatalogId !== config.replacementCatalogId, "Different-item scenario required");
  assert(config.originalPrice > 0 && config.replacementPrice > config.originalPrice && config.replacementPrice <= 30, "Acceptance value is limited to 30 SAR with a positive difference");
  const save = async () => { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8"); await rename(temporary, file); };
  const owner = () => assert(["owner", "admin"].includes(actor.role), "This stage requires the real owner/admin login");
  const delegate = () => assert(actor.role === "delegate" && Number(actor.id) === Number(state.delegateId), "This stage requires the assigned delegate login");
  const key = (step: string) => `${state.runId}:${step}`;
  const order = async (which: "original" | "replacement") => rpc.query("purchaseOrders.getById", { id: id(state[which].orderId) });
  const item = (po: any) => { assert(po?.items?.length === 1, "Fixture purchase order must have exactly one item"); return po.items[0]; };
  const caseRow = async () => {
    for (let page = 1; page <= 20; page++) {
      const response = await rpc.query("supplierReturns.list", { page, pageSize: 50 });
      const found = response.items.find((row: any) => Number(row.id) === Number(state.caseId));
      if (found) return found;
      if (page * 50 >= Number(response.total)) break;
    }
    throw Error("Created supplier-return case is not visible to this actor");
  };
  const price = async (which: "original" | "replacement") => {
    delegate(); let po = await order(which), line = item(po);
    assert(Number(line.delegateId) === Number(state.delegateId), "Fixture delegate assignment changed");
    if (line.status === "pending") await rpc.mutate("purchaseOrders.estimateCost", { purchaseOrderId: po.id, items: [{ id: line.id, estimatedUnitCost: String(config[`${which}Price`]) }] });
    po = await order(which); line = item(po);
    if (!line.batchId) {
      assert(line.status === "estimated", "Fixture item is not ready for pricing bundle");
      for (const bundle of dataArray(await rpc.query("delegatePricingBundles.list"))) {
        if (bundle.status !== "open") continue;
        const current = await rpc.query("delegatePricingBundles.detail", { id: bundle.id });
        assert(current.items.every((entry: any) => Number(entry.id) === Number(line.id)), "Existing open bundle contains other items; do not send unrelated work");
      }
      const added = await rpc.mutate("delegatePricingBundles.add", { itemId: line.id });
      state[which].bundleId = id(added.id); await save();
      const bundle = await rpc.query("delegatePricingBundles.detail", { id: added.id });
      assert(bundle.items.length === 1 && Number(bundle.items[0].id) === Number(line.id), "Bundle membership changed");
      if (bundle.status === "open") await rpc.mutate("delegatePricingBundles.send", { id: bundle.id, revision: Number(bundle.revision) });
    }
    po = await order(which); line = item(po); state[which].itemId = id(line.id); state[which].batchId = id(line.batchId); await save();
    return { order: po.poNumber, itemId: line.id, batchId: line.batchId, bundleId: state[which].bundleId };
  };
  const approve = async (which: "original" | "replacement") => {
    owner(); const current = await order(which), line = item(current);
    let batches = await rpc.query("purchaseOrders.listPricingBatches", { purchaseOrderId: current.id });
    let batch = batches.find((entry: any) => Number(entry.id) === Number(line.batchId));
    assert(batch && batch.purchasePackageSubmissionId == null, "Fixture must use ordinary per-order bundle approval");
    const amount = which === "replacement" ? Number(batch.replacementFunding?.additionalFunding) : config.originalPrice;
    assert(Number.isFinite(amount) && amount >= 0 && amount <= 30, "Financial custody is out of test scope");
    if (which === "replacement") assert(Math.abs(amount - (config.replacementPrice - config.originalPrice)) < 0.0001, "Requested custody must be the difference only");
    if (batch.status === "pending_accounting") await rpc.mutate("purchaseOrders.approveAccountingBatch", { batchId: batch.id, custodyAmount: String(amount), notes: `${note}: accounting acceptance` });
    batches = await rpc.query("purchaseOrders.listPricingBatches", { purchaseOrderId: current.id }); batch = batches.find((entry: any) => Number(entry.id) === Number(line.batchId));
    if (batch.status === "pending_management") await rpc.mutate("purchaseOrders.approveManagementBatch", { batchId: batch.id, notes: `${note}: management acceptance` });
    const approved = item(await order(which)); assert(["approved", "funded", "purchased", "delivered_to_warehouse"].includes(approved.status), "Item did not reach approved purchase stage");
    state[which].funding = amount; await save(); return { itemStatus: approved.status, additionalFunding: amount };
  };
  const buy = async (which: "original" | "replacement") => {
    delegate(); const line = item(await order(which));
    if (["approved", "funded"].includes(line.status)) await rpc.mutate("purchaseOrders.confirmItemPurchase", { itemId: line.id, purchasedPhotoUrl: state.photos.goods, invoicePhotoUrl: state.photos.invoice });
    const result = item(await order(which)); assert(["purchased", "delivered_to_warehouse"].includes(result.status), "Purchase confirmation failed");
    state[which].purchased = true; await save(); return { itemStatus: result.status };
  };
  const receive = async (which: "original" | "replacement") => {
    owner(); let po = await order(which), line = item(po);
    const invoiceNumber = `${state.runId}-${which}`;
    if (line.status === "purchased") await rpc.mutate("purchaseOrders.confirmDeliveryToWarehouse", { itemId: line.id, receivedQuantity: 1, supplierInvoiceNumber: invoiceNumber, warehousePhotoUrl: state.photos.goods });
    po = await order(which); line = item(po); assert(line.status === "delivered_to_warehouse", "Receipt requires confirmed arrival");
    const receipts = dataArray(await rpc.query("warehouseReceipts.getByPO", { purchaseOrderId: po.id }));
    let receiptId = receipts.find(receipt => receipt.invoiceNumber === invoiceNumber)?.id;
    if (!receiptId) {
      const catalog = which === "original" ? state.originalCatalog : state.replacementCatalog, amount = config[`${which}Price`];
      const received = await rpc.mutate("warehouseReceiptsV2.receiveFromPurchaseV2", {
        purchaseOrderId: po.id, catalogSupplierId: state.supplier.id, vendorName: state.supplier.nameAr || state.supplier.nameEn,
        invoiceNumber, invoiceDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()),
        subtotal: amount, taxAmount: 0, grandTotal: amount, invoicePhotoUrl: state.photos.invoice, goodsPhotoUrl: state.photos.goods, notes: note,
        items: [{ purchaseOrderItemId: line.id, linkedItemId: catalog.id, itemName: catalog.nameAr || catalog.nameEn, receivedQuantity: 1,
          expectedQuantity: 1, purchaseUnit: line.unit, issueUnit: catalog.unit, conversionFactor: 1, unitCost: String(amount), taxRate: 0,
          taxAmount: "0", lineTotal: String(amount), warehouseId: config.warehouseId, manuallyEdited: true }],
      });
      receiptId = id(received.receiptId); state[which].receiptId = receiptId; state[which].receiptNumber = received.receiptNumber; await save();
    }
    const receipt = await rpc.query("warehouseReceipts.getForPrint", { id: receiptId });
    const receiptLine = receipt.items.find((entry: any) => Number(entry.purchaseOrderItemId) === Number(line.id));
    assert(receiptLine?.inventoryId, "Receipt inventory is missing");
    if (state[which].lot && Number(state[which].receiptId) === Number(receiptId) && Number(state[which].inventoryId) === Number(receiptLine.inventoryId))
      return { receiptId, lotId: state[which].lot.lotId, trackingToken: state[which].lot.trackingToken };
    const lots = await rpc.query("inventory.listLots", { inventoryId: receiptLine.inventoryId });
    const lot = lots.find((entry: any) => Number(entry.receiptId) === Number(receiptId));
    assert(lot && Number(lot.originalQuantity) === 1 && lot.issueUnit === (which === "original" ? state.originalCatalog.unit : state.replacementCatalog.unit), "Receipt lot provenance/quantity/unit mismatch");
    state[which].receiptId = receiptId; state[which].inventoryId = receiptLine.inventoryId; state[which].lot = lot; await save();
    return { receiptId, lotId: lot.lotId, trackingToken: lot.trackingToken };
  };

  if (action === "operational-prepare") {
    owner();
    if (!state) {
      const [originalCatalog, replacementCatalog, delegates, categories, suppliers, photoOrder] = await Promise.all([
        rpc.query("catalog.items.getById", config.originalCatalogId), rpc.query("catalog.items.getById", config.replacementCatalogId),
        rpc.query("supplierReturns.delegates"), rpc.query("centerCategories.list", { activeOnly: true }), rpc.query("catalog.suppliers.list", { activeOnly: true }),
        rpc.query("purchaseOrders.getById", { id: config.sourcePhotoOrderId }),
      ]);
      const selected = await rpc.query("operationalIssues.preparedSelection", { warehouseId: config.warehouseId, catalogItemIds: [config.originalCatalogId] });
      assert(selected.length === 1 && Number(selected[0].totalQuantity) === 0 && !selected[0].needsReview, "Original catalog must have zero consistent stock before creation");
      const assigned = delegates.find((entry: any) => String(entry.username).toUpperCase() === config.delegateUsername.toUpperCase()); assert(assigned, "Assigned trial delegate not found");
      const photoItem = photoOrder.items.find((entry: any) => Number(entry.id) === Number(config.sourcePhotoItemId));
      assert(photoItem?.purchasedPhotoUrl && photoItem?.invoicePhotoUrl, "Approved existing test images unavailable");
      config.categoryId ||= dataArray(categories)[0]?.id; assert(config.categoryId, "No active purchase category");
      assert(originalCatalog?.isActive && replacementCatalog?.isActive && originalCatalog.unit && replacementCatalog.unit && suppliers.length, "Active catalogs/units/supplier required");
      state = { version: 1, environment: "copycmms2", endpoint: "http://localhost:4002", runId: `OPCOMP-${randomUUID().slice(0, 16)}`, config,
        delegateId: assigned.id,
        originalCatalog: { id: originalCatalog.id, nameAr: originalCatalog.nameAr, nameEn: originalCatalog.nameEn, unit: originalCatalog.unit },
        replacementCatalog: { id: replacementCatalog.id, nameAr: replacementCatalog.nameAr, nameEn: replacementCatalog.nameEn, unit: replacementCatalog.unit },
        supplier: { id: suppliers[0].id, nameAr: suppliers[0].nameAr, nameEn: suppliers[0].nameEn },
        photos: { goods: photoItem.purchasedPhotoUrl, invoice: photoItem.invoicePhotoUrl }, original: {}, replacement: {} };
      await save();
    }
    assert(state.environment === "copycmms2" && state.endpoint === "http://localhost:4002", "Trial state only");
    const created = await rpc.mutate("operationalIssues.createPrepared", { warehouseId: config.warehouseId, reason: `${note} ${state.runId}`, operationKey: key("create"),
      items: [{ catalogItemId: config.originalCatalogId, quantity: 1, unit: state.originalCatalog.unit, siteId: config.siteId, sectionId: config.sectionId, collectorId: config.collectorId, source: "catalog" }] });
    state.operationalOrderId = id(created.id); await save();
    let detail = await rpc.query("operationalIssues.detail", { id: created.id }); assert(detail.items.length === 1, "Fixture must have one operational item");
    state.originalNeed = { id: detail.items[0].id, itemName: detail.items[0].itemName, catalogItemId: detail.items[0].catalogItemId, quantity: detail.items[0].quantity, unit: detail.items[0].unit }; await save();
    if (detail.order.status === "pending") await rpc.mutate("operationalIssues.approve", { id: created.id, revision: detail.order.revision });
    const draft = await rpc.mutate("operationalIssues.addToPurchaseDraft", { orderId: created.id, itemId: state.originalNeed.id });
    state.original.orderId = id(draft.purchaseOrderId); state.original.itemId = id(draft.purchaseOrderItemId); await save();
    let po = await order("original"), line = item(po);
    if (po.status === "draft") {
      await rpc.mutate("purchaseOrders.updateDraft", { id: po.id, categoryId: config.categoryId, siteId: config.siteId, sectionId: config.sectionId, assetId: null, notes: note,
        items: [{ id: line.id, catalogItemId: line.catalogItemId, itemName: line.itemName, quantity: line.quantity, unit: line.unit, deliveryLeadDays: 4,
          siteId: config.siteId, sectionId: config.sectionId, categoryId: config.categoryId, photoUrl: state.photos.goods }] });
      await rpc.mutate("purchaseOrders.submitDraft", { id: po.id });
    }
    po = await order("original"); line = item(po);
    if (po.status === "pending_review") await rpc.mutate("purchaseOrders.reviewItems", { poId: po.id, items: [{ id: line.id, action: "approve", delegateId: state.delegateId }] });
    state.original.orderNumber = po.poNumber; await save(); return { next: "AZIZ: operational-original-price", stateFile: file, operationalOrderId: state.operationalOrderId, originalOrderId: state.original.orderId };
  }
  assert(state?.version === 1 && state.environment === "copycmms2" && state.endpoint === "http://localhost:4002", "Prepare this acceptance fixture first");
  if (action === "operational-original-price") return price("original");
  if (action === "operational-original-approve") return approve("original");
  if (action === "operational-original-buy") return buy("original");
  if (action === "operational-original-receive-return") {
    owner(); await receive("original");
    const created = await rpc.mutate("supplierReturns.create", { operationKey: key("return"), warehouseId: config.warehouseId, trackingToken: state.original.lot.trackingToken,
      returnedQuantity: 1, delegateId: state.delegateId, reason: `${note}: different-item test` });
    state.caseId = id(created.caseId); state.returnId = id(created.returnId); await save(); return { caseId: state.caseId, next: "AZIZ: operational-return-accept" };
  }
  if (action === "operational-return-accept") {
    delegate(); let returned = await caseRow();
    if (returned.handoverStatus === "awaiting_delegate") await rpc.mutate("supplierReturns.command", { caseId: state.caseId, expectedRevision: returned.revision, operationKey: key("accept"), action: "accept" });
    returned = await caseRow();
    if (!returned.resolution) await rpc.mutate("supplierReturns.command", { caseId: state.caseId, expectedRevision: returned.revision, operationKey: key("change"), action: "resolve", resolution: "change_item" });
    return { returned: await caseRow(), next: "owner: operational-replacement-create" };
  }
  if (action === "operational-replacement-create") {
    owner(); let returned = await caseRow();
    if (!returned.replacementPlanId) await rpc.mutate("supplierReturns.chooseReplacement", { caseId: state.caseId, expectedRevision: returned.revision, operationKey: key("choose"), catalogItemId: config.replacementCatalogId, quantity: 1 });
    returned = await caseRow(); assert(returned.replacementPlanId && returned.replacementCatalogItemId === config.replacementCatalogId, "Approved replacement choice changed");
    if (!returned.replacementPurchaseOrderId) {
      const created = await rpc.mutate("purchaseOrders.create", { supplierReturnPlanId: returned.replacementPlanId, siteId: config.siteId, sectionId: config.sectionId, categoryId: config.categoryId, assetId: null, notes: note,
        items: [{ catalogItemId: config.replacementCatalogId, itemName: state.replacementCatalog.nameAr || state.replacementCatalog.nameEn, quantity: 1, unit: state.replacementCatalog.unit, photoUrl: state.photos.goods, deliveryLeadDays: 4,
          siteId: config.siteId, sectionId: config.sectionId, categoryId: config.categoryId, assetId: null }] });
      state.replacement.orderId = id(created.id); await save();
    } else state.replacement.orderId = id(returned.replacementPurchaseOrderId);
    const po = await order("replacement"), line = item(po); state.replacement.itemId = line.id; state.replacement.planId = returned.replacementPlanId; await save();
    if (po.status === "pending_review") await rpc.mutate("purchaseOrders.reviewItems", { poId: po.id, items: [{ id: line.id, action: "approve", delegateId: state.delegateId }] });
    return { orderId: po.id, orderNumber: po.poNumber, next: "AZIZ: operational-replacement-price" };
  }
  if (action === "operational-replacement-price") return price("replacement");
  if (action === "operational-replacement-approve") return approve("replacement");
  if (action === "operational-replacement-buy") return buy("replacement");
  if (action === "operational-replacement-receive-issue") {
    owner(); await receive("replacement");
    const before = await rpc.query("operationalIssues.detail", { id: state.operationalOrderId });
    assert(JSON.stringify({ id: before.items[0].id, itemName: before.items[0].itemName, catalogItemId: before.items[0].catalogItemId, quantity: before.items[0].quantity, unit: before.items[0].unit }) === JSON.stringify(state.originalNeed), "Original need was overwritten");
    let request = state.issueRequest, issued = state.issueResult;
    if (before.order.status !== "completed") {
      const availability = await rpc.query("operationalIssues.availability", { id: state.operationalOrderId }), stock = availability.items.find((entry: any) => entry.itemId === state.originalNeed.id);
      assert(stock?.fulfillment?.ready && stock.fulfillment.allocations.length === 1 && stock.fulfillment.allocations[0].lotId === state.replacement.lot.lotId, "Original need is not supplied by the approved replacement lot");
      request ||= { orderId: state.operationalOrderId, revision: before.order.revision, operationKey: key("issue"), items: [{ itemId: state.originalNeed.id, notes: note }] };
      state.issueRequest = request; await save();
      issued = await rpc.mutate("operationalIssues.issuePrepared", request); state.issueResult = issued; await save();
    }
    assert(request, "Completed issue has no checkpoint; inspect the fixture before resuming");
    issued ||= await rpc.mutate("operationalIssues.issuePrepared", request);
    const after = await rpc.query("operationalIssues.detail", { id: state.operationalOrderId });
    assert(after.order.status === "completed" && after.items[0].catalogItemId === config.originalCatalogId && Number(after.items[0].issuedQuantity) === 1, "Original need did not complete independently");
    assert(after.deliveries.length === 1 && Number(after.deliveries[0].quantity) === 1 && Number(after.deliveries[0].cost) === config.replacementPrice
      && after.deliveries[0].lotCode === state.replacement.lot.lotCode, "Physical alternative delivery or lot cost mismatch");
    const replay = await rpc.mutate("operationalIssues.issuePrepared", request); assert(isDeepStrictEqual(replay, issued), "Exact issue replay was not idempotent");
    let rejected = false; try { await rpc.mutate("operationalIssues.issuePrepared", { ...request, operationKey: key("second-issue") }); } catch { rejected = true; }
    assert(rejected, "A second issue key was not rejected");
    const final = await rpc.query("operationalIssues.detail", { id: state.operationalOrderId }); assert(final.deliveries.length === 1, "Replay created an extra physical delivery");
    state.completed = true; state.result = { originalNeed: final.items[0], physicalDeliveries: final.deliveries, cost: final.cost, replacement: await caseRow() }; await save();
    return { completed: true, stateFile: file, ...state.result };
  }
  if (action === "operational-inspect") { owner(); return { state, detail: await rpc.query("operationalIssues.detail", { id: state.operationalOrderId }), availability: await rpc.query("operationalIssues.availability", { id: state.operationalOrderId }) }; }
  throw Error(`Unknown operational compensation acceptance action: ${action}`);
}

export interface TrialPurchaseFlowRefs {
  purchaseOrderIds: number[]; delegateId: number; warehouseId: number; pricePerUnit: number;
  photos: { goods: string; invoice: string }; supplier: { id: number; nameAr?: string; nameEn?: string };
  runId: string; statePath?: string;
}
/** Reusable real-API purchase stages for operational/team/PMV2 fixture orders.
 * The harness confirms localhost:4002/COPYCMMS2 and supplies only newly-created
 * test IDs. No SQL, direct callers, role impersonation or auth material. */
export async function processTrialPurchaseOrders(rpc: AcceptanceRpc, phase: "inspect" | "review" | "price" | "approve" | "buy" | "receive", refs: TrialPurchaseFlowRefs) {
  const ids = Array.from(new Set(refs.purchaseOrderIds.map(id)));
  assert(ids.length > 0 && ids.length <= 20, "Acceptance scope must contain 1–20 exact source orders");
  assert(/^[A-Za-z0-9_-]{8,40}$/.test(refs.runId) && refs.pricePerUnit > 0 && refs.pricePerUnit <= 30, "Bound the test reference/value");
  const actor = await rpc.query("auth.me"); assert(actor?.isActive === 1, "Active authenticated actor required");
  if (["price", "buy"].includes(phase)) assert(actor.role === "delegate" && Number(actor.id) === refs.delegateId, "Use the assigned delegate's real login");
  else assert(["owner", "admin"].includes(actor.role), "Use the real owner/admin login for this stage");
  const file = path.resolve(refs.statePath || path.join(repo, "docs/runtime-uat/2026-10-30-compensation", `${refs.runId}-purchase-stages.json`));
  assert(!path.relative(repo, file).startsWith("..") && path.extname(file) === ".json", "Checkpoints stay in this checkout");
  let state: any = { runId: refs.runId, endpoint: "http://localhost:4002", environment: "copycmms2", orderIds: ids, receipts: {}, stages: [] };
  try { state = JSON.parse(await readFile(file, "utf8")); } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  assert(state.runId === refs.runId && state.environment === "copycmms2" && JSON.stringify(state.orderIds) === JSON.stringify(ids), "Checkpoint scope changed");
  const save = async () => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`); await rename(`${file}.tmp`, file); };
  const get = () => Promise.all(ids.map(orderId => rpc.query("purchaseOrders.getById", { id: orderId })));
  let orders = await get();
  for (const po of orders) {
    assert(po.items.length === 1 && Number(po.items[0].quantity) > 0 && Number(po.items[0].quantity) * refs.pricePerUnit <= 30, "One low-value item per fixture order required");
    assert(/UAT|TEST|COPYCMMS2/i.test(String(po.notes || "")), "Order is not marked as a test fixture");
  }
  if (phase === "review") for (const po of orders) {
    if (po.status === "pending_review") await rpc.mutate("purchaseOrders.reviewItems", { poId: po.id, items: [{ id: po.items[0].id, action: "approve", delegateId: refs.delegateId }] });
    else assert(po.status !== "draft", "Submit a fully configured fixture draft before review");
  }
  if (phase === "price") {
    const itemIds = orders.map(po => Number(po.items[0].id));
    for (const bundle of dataArray(await rpc.query("delegatePricingBundles.list"))) if (bundle.status === "open") {
      const current = await rpc.query("delegatePricingBundles.detail", { id: bundle.id });
      assert(current.items.every((entry: any) => itemIds.includes(Number(entry.id))), "Do not send an existing bundle containing other work");
    }
    const bundleIds = new Set<number>();
    for (const po of orders) {
      let line = po.items[0]; assert(Number(line.delegateId) === refs.delegateId, "Delegate assignment changed");
      if (line.status === "pending") await rpc.mutate("purchaseOrders.estimateCost", { purchaseOrderId: po.id, items: [{ id: line.id, estimatedUnitCost: String(refs.pricePerUnit) }] });
      line = (await rpc.query("purchaseOrders.getById", { id: po.id })).items[0];
      if (!line.batchId) {
        assert(line.status === "estimated", "Source item not ready for pricing bundle");
        const added = await rpc.mutate("delegatePricingBundles.add", { itemId: line.id }); bundleIds.add(id(added.id));
      }
    }
    assert(bundleIds.size <= 1, "Acceptance sources must use one pricing bundle");
    for (const bundleId of bundleIds) {
      state.bundleId = bundleId; await save();
      const bundle = await rpc.query("delegatePricingBundles.detail", { id: bundleId });
      assert(bundle.items.every((entry: any) => itemIds.includes(Number(entry.id))), "Bundle scope changed before send");
      if (bundle.status === "open") await rpc.mutate("delegatePricingBundles.send", { id: bundleId, revision: Number(bundle.revision) });
    }
  }
  if (phase === "approve") for (const po of orders) {
    const batches = await rpc.query("purchaseOrders.listPricingBatches", { purchaseOrderId: po.id });
    const batch = batches.find((entry: any) => Number(entry.id) === Number(po.items[0].batchId));
    assert(batch && batch.purchasePackageSubmissionId == null, "Fixture is missing an ordinary pricing batch");
    const amount = batch.replacementFunding ? Number(batch.replacementFunding.additionalFunding) : Number(po.items[0].estimatedTotalCost);
    assert(Number.isFinite(amount) && amount >= 0 && amount <= 30, "Approval amount outside acceptance budget");
    if (batch.replacementFunding) assert(Math.abs(amount - Math.max(0, Number(batch.replacementFunding.quotedTotal) - Number(batch.replacementFunding.creditAllocated))) < 0.0001, "Replacement custody must be the difference");
    if (batch.status === "pending_accounting") await rpc.mutate("purchaseOrders.approveAccountingBatch", { batchId: batch.id, custodyAmount: String(amount), notes: `${note} ${refs.runId}` });
    const refreshed = (await rpc.query("purchaseOrders.listPricingBatches", { purchaseOrderId: po.id })).find((entry: any) => Number(entry.id) === Number(batch.id));
    if (refreshed.status === "pending_management") await rpc.mutate("purchaseOrders.approveManagementBatch", { batchId: batch.id, notes: `${note} ${refs.runId}` });
  }
  if (phase === "buy") for (const po of orders) {
    const line = po.items[0]; assert(Number(line.delegateId) === refs.delegateId, "Delegate assignment changed");
    if (["approved", "funded"].includes(line.status)) await rpc.mutate("purchaseOrders.confirmItemPurchase", { itemId: line.id, purchasedPhotoUrl: refs.photos.goods, invoicePhotoUrl: refs.photos.invoice });
    else assert(["purchased", "delivered_to_warehouse", "delivered_to_requester"].includes(line.status), "Item is not approved for purchasing");
  }
  if (phase === "receive") for (const po of orders) {
    const line = po.items[0], invoiceNumber = `${refs.runId}-${po.id}`;
    if (line.status === "purchased") await rpc.mutate("purchaseOrders.confirmDeliveryToWarehouse", { itemId: line.id, receivedQuantity: Number(line.quantity), supplierInvoiceNumber: invoiceNumber, warehousePhotoUrl: refs.photos.goods });
    const existing = dataArray(await rpc.query("warehouseReceipts.getByPO", { purchaseOrderId: po.id })).find(receipt => receipt.invoiceNumber === invoiceNumber);
    let receiptId = existing?.id;
    if (!receiptId) {
      const catalog = await rpc.query("catalog.items.getById", id(line.catalogItemId));
      assert(catalog && catalog.unit === line.unit, "This fixture uses conversion factor 1; select matching order/catalog units");
      const total = Number(line.estimatedTotalCost), unitCost = Number(line.estimatedUnitCost);
      assert(total > 0 && total <= 30, "Receipt outside acceptance budget");
      const receipt = await rpc.mutate("warehouseReceiptsV2.receiveFromPurchaseV2", {
        purchaseOrderId: po.id, catalogSupplierId: refs.supplier.id, vendorName: refs.supplier.nameAr || refs.supplier.nameEn,
        invoiceNumber, invoiceDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()),
        subtotal: total, taxAmount: 0, grandTotal: total, invoicePhotoUrl: refs.photos.invoice, goodsPhotoUrl: refs.photos.goods, notes: `${note} ${refs.runId}`,
        items: [{ purchaseOrderItemId: line.id, linkedItemId: line.catalogItemId, itemName: line.itemName, receivedQuantity: Number(line.quantity), expectedQuantity: Number(line.quantity),
          purchaseUnit: line.unit, issueUnit: line.unit, conversionFactor: 1, unitCost: String(unitCost), taxRate: 0, taxAmount: "0", lineTotal: String(total), warehouseId: refs.warehouseId, manuallyEdited: true }],
      });
      receiptId = id(receipt.receiptId); state.receipts[po.id] = { receiptId, receiptNumber: receipt.receiptNumber }; await save();
    }
    const full = await rpc.query("warehouseReceipts.getForPrint", { id: receiptId });
    const received = full.items.find((entry: any) => Number(entry.purchaseOrderItemId) === Number(line.id)); assert(received?.inventoryId, "Receipt source item absent");
    const lots = await rpc.query("inventory.listLots", { inventoryId: received.inventoryId });
    const lot = lots.find((entry: any) => Number(entry.receiptId) === Number(receiptId));
    if (lot) state.receipts[po.id] = { receiptId, receiptNumber: full.receiptNumber, inventoryId: received.inventoryId, lot };
    else assert(state.receipts[po.id]?.lot, "Receipt has no currently visible lot or prior checkpoint; inspect before retrying");
    await save();
  }
  orders = await get(); state.stages.push({ phase, at: new Date().toISOString(), actorId: actor.id }); await save();
  return { phase, stateFile: file, bundleId: state.bundleId, receipts: state.receipts,
    orders: orders.map(po => ({ id: po.id, poNumber: po.poNumber, status: po.status, items: po.items.map((line: any) => ({ id: line.id, catalogItemId: line.catalogItemId, itemName: line.itemName, quantity: line.quantity, unit: line.unit, status: line.status, batchId: line.batchId })) })) };
}
