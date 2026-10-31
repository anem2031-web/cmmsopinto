import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const contracts = read("server/pmv2/adapters/contracts.ts");
const adapters = read("server/pmv2/adapters/current-system.ts");
const queueService = read("server/pmv2/materials/warehouse-queue-service.ts");
const handoffService = read("server/pmv2/materials/warehouse-transfer-handoff-service.ts");
const queueRouter = read("server/routers/pmv2/warehouse.ts");
const queuePage = read("client/src/pages/pmv2/Pmv2WarehouseQueue.tsx");
const transferPage = read("client/src/pages/inventory/WarehouseTransfer.tsx");
const transferRouter = read("server/routers/inventory/transfers.router.ts");
const schema = read("drizzle/schema.ts");


test("Step 4.2B reads confirmed Warehouse Transfer rows through an adapter boundary", () => {
  assert.match(contracts, /interface WarehouseTransferAdapter/);
  assert.match(contracts, /getTransfersByNumbers/);
  assert.match(adapters, /currentWarehouseTransferAdapter/);
  assert.match(adapters, /from\(warehouseTransfers\)/);
  assert.match(adapters, /innerJoin\(inventory, eq\(inventory\.id, warehouseTransfers\.fromInventoryId\)\)/);
  assert.match(adapters, /catalogItemId: inventory\.linkedItemId/);
});

test("the transfer adapter is read-only and never creates or mutates stock", () => {
  const adapterBlock = adapters.slice(adapters.indexOf("export const currentWarehouseTransferAdapter"));
  assert.doesNotMatch(adapterBlock, /createWarehouseTransfer|createBatch/);
  assert.doesNotMatch(adapterBlock, /\.insert\(|\.update\(|\.delete\(/);
});

test("prepareTransferHandoff rechecks a waiting listed request on the server", () => {
  assert.match(handoffService, /context\.status !== "waiting_warehouse"/);
  assert.match(handoffService, /context\.catalogItemId == null/);
  assert.match(handoffService, /requireSingleActiveMainWarehouse/);
  assert.match(handoffService, /requireActiveWarehouse\(context\.teamWarehouseId\)/);
  assert.match(handoffService, /requireActiveItem\(context\.catalogItemId\)/);
  assert.match(handoffService, /getCatalogAvailability/);
});

test("prepareTransferHandoff blocks ambiguous inventory and unit mismatch", () => {
  assert.match(handoffService, /availability\.ambiguous/);
  assert.match(handoffService, /normalizeUnit\(availability\.unit\) !== normalizeUnit\(context\.unitSnapshot\)/);
  assert.match(handoffService, /وحدة المخزون الحالية لا تطابق وحدة طلب PM V2/);
});

test("transfer handoff still computes current availability but new default requires the full shortage before opening transfer", () => {
  assert.match(handoffService, /requestedQuantity - issuedToTeamQuantity/);
  assert.match(handoffService, /planPmv2Fulfillment/);
  assert.match(handoffService, /fulfillmentAllocations/);
  assert.match(handoffService, /availableQuantity \+ 0\.0005 < remainingQuantity/);
  assert.match(handoffService, /لا يبدأ PM V2 تحويلًا جزئيًا افتراضيًا/);
});

test("PM V2 accepts only transfer numbers that already exist in the current transfer workflow", () => {
  assert.match(handoffService, /currentWarehouseTransferAdapter\.getTransfersByNumbers\(transferNumbers\)/);
  assert.match(handoffService, /missingNumbers/);
  assert.match(handoffService, /لم يتم العثور على تحويل مستودع مؤكد/);
});

test("confirmed transfers match Main and Team and either original identity/unit or verified replacement lot", () => {
  assert.match(handoffService, /transfer\.fromWarehouseId !== mainWarehouse/);
  assert.match(handoffService, /transfer\.toWarehouseId !== teamWarehouse/);
  assert.match(handoffService, /transfer\.catalogItemId !== context\.catalogItemId/);
  assert.match(handoffService, /normalizeUnit\(transfer\.unit\) !== normalizeUnit\(context\.unitSnapshot\)/);
  assert.match(handoffService, /replacementForPhysicalLot\(replacements/);
  assert.match(handoffService, /lotId: transfer\.inventoryLotId/);
  assert.match(handoffService, /maximumOriginalQuantity/);
});

test("each real transfer is traced in PM V2 and the same transfer cannot satisfy another request", () => {
  assert.match(handoffService, /MATERIAL_TRANSFER_LINK_ACTION = "material_transfer_linked"/);
  assert.match(handoffService, /materialRequestItemId: requestItemId/);
  assert.match(handoffService, /transferId: transfer\.id/);
  assert.match(handoffService, /transferNumber: transfer\.transferNumber/);
  assert.match(handoffService, /existing\.materialRequestItemId !== requestItemId/);
  assert.match(handoffService, /مرتبط مسبقًا بطلب مواد PM V2 آخر/);
});

test("duplicate retry is idempotent because fulfillment is recomputed from unique transfer IDs", () => {
  assert.match(handoffService, /linkedForRequest = new Map<number, MaterialTransferLinkSnapshot>/);
  assert.match(handoffService, /if \(linkedForRequest\.has\(transfer\.id\)\) continue/);
  assert.match(handoffService, /Array\.from\(linkedForRequest\.values\(\)\)\.reduce/);
  assert.match(handoffService, /idempotent: !changed/);
});

test("partial transfer stays waiting_warehouse and full confirmed quantity alone reaches issued_to_team", () => {
  assert.match(handoffService, /Math\.min\(requestedQuantity, confirmedQuantity\)/);
  assert.match(handoffService, /projectedIssuedQuantity >= requestedQuantity/);
  assert.match(handoffService, /\? "issued_to_team"\s*:\s*"waiting_warehouse"/s);
  assert.match(handoffService, /remainingQuantity: roundQuantity\(requestedQuantity - write\.issuedToTeamQuantity\)/);
});

test("PM V2 projection passes the frozen Material Request Item validation boundary", () => {
  assert.match(handoffService, /validatePmv2MaterialRequestItemWrite/);
  assert.match(handoffService, /receivedWarehouseQuantity: Number\(context\.receivedWarehouseQuantity/);
  assert.match(handoffService, /issuedToTeamQuantity: projectedIssuedQuantity/);
});

test("linking writes PM V2 projection/audit only, not Inventory or Warehouse Transfer rows", () => {
  assert.match(handoffService, /update\(pmv2MaterialRequestItems\)/);
  assert.match(handoffService, /writePmv2AuditWithDb/);
  assert.doesNotMatch(handoffService, /update\(inventory\)|insert\(warehouseTransfers\)|createWarehouseTransfer|createBatch/);
});

test("warehouse endpoints stay behind the dedicated PM V2 warehouse permission", () => {
  assert.match(queueRouter, /prepareTransferHandoff: pmv2WarehouseProcedure/);
  assert.match(queueRouter, /linkConfirmedTransfers: pmv2WarehouseProcedure/);
  assert.match(queueRouter, /transferNumbers: z\.array/);
});

test("warehouse queue explains the task need, team snapshot, Main-Warehouse need and remaining transfer", () => {
  assert.match(queueService, /pmv2ItemActions\.action, "material_route_decision"/);
  assert.match(queueService, /parseMaterialRequestRouteDecision/);
  assert.match(queueService, /taskNeedQuantity: routeDecision\?\.requestedQuantity \?\? null/);
  assert.match(queueService, /teamAvailableAtRequest: routeDecision\?\.availableQuantity \?\? null/);
  assert.match(queuePage, /احتياج المهمة/);
  assert.match(queuePage, /المتاح في مخزن الفريق وقت الطلب/);
  assert.match(queuePage, /النقص المسجل على المهمة/);
  assert.match(queuePage, /المتبقي المطلوب تغطيته/);
  assert.match(queuePage, /المتاح في الرئيسي الآن/);
  assert.doesNotMatch(queuePage, /المطلوب الأصلي/);
});

test("warehouse queue rechecks on the server before navigating to the existing transfer screen", () => {
  assert.match(queuePage, /prepareTransferHandoff\.useMutation/);
  assert.match(queuePage, /prepareTransfer\.mutateAsync\(\{ requestItemId \}\)/);
  assert.match(queuePage, /navigate\(`\/warehouse\/transfer\?\$\{params\.toString\(\)\}`\)/);
  assert.match(queuePage, /تحويل النقص إلى مخزن الفريق/);
});

test("existing Warehouse Transfer screen receives PM V2 context without replacing its transfer engine", () => {
  assert.match(transferPage, /readPmv2TransferHandoff/);
  assert.match(transferPage, /pmv2RequestItemId/);
  assert.match(transferPage, /fromWarehouseId/);
  assert.match(transferPage, /toWarehouseId/);
  assert.match(transferPage, /inventoryId/);
  assert.match(transferPage, /createBatchMut = trpc\.transfers\.createBatch\.useMutation/);
  assert.match(transferRouter, /createWarehouseTransferBatch/);
});

test("PM V2 handoff locks its route and exact source Inventory identity", () => {
  assert.match(transferPage, /disabled=\{!!pmv2Handoff \|\| cart\.length > 0\}/);
  assert.match(transferPage, /disabled=\{!!pmv2Handoff\}/);
  assert.match(transferPage, /Number\(foundItem\.id\) !== pmv2Handoff\.inventoryId/);
});

test("PM V2 quantity cap applies across multiple Lot rows", () => {
  assert.match(transferPage, /remainingPmv2HandoffQuantity/);
  assert.match(transferPage, /pmv2MaterialRequestItemId === pmv2Handoff\.requestItemId/);
  assert.match(transferPage, /qtyNum > pmv2Remaining/);
  assert.match(transferPage, /يمكنك تقسيمها على أكثر من Lot/);
});

test("Lot QR validation remains owned by the existing transfer workflow", () => {
  assert.match(transferPage, /resolveTransferLotMut/);
  assert.match(transferPage, /lotTrackingToken/);
  assert.match(transferRouter, /isInventoryLotsEnabled/);
  assert.match(transferRouter, /يجب مسح QR دفعة لكل بند تحويل/);
});

test("only successful real transfer numbers are linked back to PM V2", () => {
  assert.match(transferPage, /result\.success/);
  assert.match(transferPage, /result\.transferNumber/);
  assert.match(transferPage, /linkConfirmedPmv2TransfersMut\.mutateAsync/);
  assert.match(transferPage, /تم تنفيذ التحويل في المخزون، لكن تعذر تحديث PM V2/);
});

test("a posted PM V2 transfer freezes the stale handoff until the operator returns to the queue", () => {
  assert.match(transferPage, /pmv2TransferPosted/);
  assert.match(transferPage, /setPmv2TransferPosted\(true\)/);
  assert.match(transferPage, /The physical stock move already happened/);
  assert.match(transferPage, /ارجع إلى طلب PM V2 لإعادة فحص المتبقي قبل تحويل جديد/);
  assert.match(transferPage, /العودة إلى طلبات مواد PM V2 وإعادة الفحص/);
  assert.match(transferPage, /disabled=\{pmv2TransferPosted \|\| isSubmitting \|\| cart\.length === 0\}/);
});

test("operator can retry PM V2 linking without repeating the physical transfer", () => {
  assert.match(transferPage, /pmv2LinkRetry/);
  assert.match(transferPage, /إعادة ربط التحويل بطلب PM V2/);
  assert.match(transferPage, /العودة إلى طلبات مواد PM V2/);
});

test("current transfer receives a readable PM V2 reference while normal transfers remain unchanged", () => {
  assert.match(transferPage, /مرجع PM V2:/);
  assert.match(transferPage, /buildPmv2TransferNote\(c\.notes, pmv2Handoff\)/);
  assert.match(transferPage, /:\s*c\.notes/);
});

test("Step 4.2B transfer service remains purchase-free even after the later purchase handoff slice is added", () => {
  assert.doesNotMatch(handoffService, /purchaseOrders|purchaseOrderItems|pmv2MaterialPurchaseLinks|external_purchase|received_warehouse/);
  assert.match(queueRouter, /preparePurchaseHandoff: pmv2WarehouseProcedure/);
  assert.match(queueRouter, /linkPurchaseOrder: pmv2WarehouseProcedure/);
});

test("no new transfer-link table is introduced; frozen PM V2 schema remains the integration target", () => {
  assert.match(schema, /export const pmv2MaterialRequestItems/);
  assert.match(schema, /issuedToTeamQuantity/);
  assert.match(schema, /export const pmv2ItemActions/);
  assert.doesNotMatch(schema, /pmv2_material_transfer_links/);
});
