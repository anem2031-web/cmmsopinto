import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

const contracts = read("server/pmv2/adapters/contracts.ts");
const adapters = read("server/pmv2/adapters/current-system.ts");
const service = read("server/pmv2/materials/team-issue-handoff-service.ts");
const warehouseRouter = read("server/routers/pmv2/warehouse.ts");
const technicianRouter = read("server/routers/pmv2/technician.ts");
const execution = read("server/pmv2/technician/execution-service.ts");
const warehousePage = read("client/src/pages/pmv2/Pmv2WarehouseQueue.tsx");
const technicianPage = read("client/src/pages/pmv2/Pmv2MyTasks.tsx");
const inventoryPage = read("client/src/pages/inventory/Inventory.tsx");
const purchaseRouter = read("server/routers/purchase/purchase-orders.router.ts");
const warehouseDb = read("server/_core/db/warehouse-returns.ts");

test("PM V2 uses explicit adapters for real issue and recipient return workflows", () => {
  assert.match(contracts, /interface InventoryIssueAdapter/);
  assert.match(contracts, /interface RecipientReturnAdapter/);
  assert.match(adapters, /currentInventoryIssueAdapter: InventoryIssueAdapter/);
  assert.match(adapters, /currentRecipientReturnAdapter: RecipientReturnAdapter/);
  assert.match(adapters, /issueDelivery\(/);
  assert.match(adapters, /createRecipientWarehouseReturn\(/);
});

test("PM V2 lot allocation reads authoritative positive lot balances", () => {
  assert.match(contracts, /listAvailableLots/);
  assert.match(adapters, /from\(inventoryLotBalances\)/);
  assert.match(adapters, /innerJoin\(inventoryLots/);
  assert.match(adapters, /gt\(inventoryLotBalances\.quantity/);
});

test("generic Inventory delivery no longer asks warehouse staff to choose a PM V2 task", () => {
  assert.doesNotMatch(inventoryPage, /ربط الصرف باحتياج PM V2/);
  assert.doesNotMatch(inventoryPage, /selectedPmv2TaskItemId/);
  assert.doesNotMatch(purchaseRouter, /pmv2TaskItemId/);
});

test("ready issue queue is driven by persisted material requirements, not operator matching", () => {
  assert.match(service, /MATERIAL_ROUTE_DECISION_ACTION = "material_route_decision"/);
  assert.match(service, /listReadyToIssueQueue/);
  assert.match(service, /eq\(pmv2TaskItems\.status, "waiting_material"\)/);
  assert.match(service, /eq\(pmv2TaskItems\.result, "needs_material"\)/);
  assert.match(warehouseRouter, /readyToIssueQueue/);
});

test("full remaining task need is calculated server-side and lot allocations are automatic", () => {
  assert.match(service, /remainingQuantity = roundQuantity\(requirement\.requestedQuantity - issuedQuantity\)/);
  assert.match(service, /allocateLots\(lots, remainingQuantity\)/);
  assert.match(service, /الرصيد الحالي لا يغطي كامل احتياج المهمة/);
  assert.match(warehousePage, /توزيع الـLots الآلي/);
  assert.match(warehousePage, /صرف كامل الاحتياج للمهمة/);
});

test("requesting technician is the default recipient but another active team technician may receive", () => {
  assert.match(service, /requesterUserId/);
  assert.match(service, /defaultRecipientUserId: requester\?\.id \|\| technicians\[0\]\?\.id/);
  assert.match(service, /المستلم الفعلي يجب أن يكون فنيًا نشطًا في فريق المهمة/);
  assert.match(warehousePage, /طالب المادة/);
  assert.match(warehousePage, /المستلم الفعلي/);
});

test("one logical PM V2 issue can post multiple existing Delivery Documents by lot", () => {
  assert.match(service, /for \(const allocation of allocations\)/);
  assert.match(service, /inventoryId: allocation\.inventoryId, quantity: allocation\.quantity, unit: allocation\.unit/);
  assert.match(service, /currentInventoryIssueAdapter\.issueDelivery/);
  assert.match(service, /lotTrackingToken: allocation\.trackingToken/);
  assert.match(service, /posted\.push/);
});

test("physical issue and PM V2 issue trace are separate from actual consumption", () => {
  assert.match(service, /MATERIAL_ISSUE_LINK_ACTION = "material_issue_linked"/);
  assert.match(service, /action: MATERIAL_ISSUE_LINK_ACTION/);
  const linkStart = service.indexOf("async linkConfirmedDelivery");
  const completionStart = service.indexOf("async listCompletionMaterials");
  const linkBlock = service.slice(linkStart, completionStart);
  assert.doesNotMatch(linkBlock, /insert\(pmv2MaterialUsages\)/);
});

test("Task Item becomes ready_to_complete only after all latest material requirements are issued", () => {
  assert.match(service, /areAllLatestRequirementsIssued/);
  assert.match(service, /issued \+ 0\.0005 < requirement\.snapshot\.requestedQuantity/);
  assert.match(service, /set\(\{ status: "ready_to_complete" \}\)/);
});

test("technician completion requests only actual used quantity", () => {
  assert.match(technicianRouter, /completionMaterials/);
  assert.match(technicianRouter, /materialUsages: z\.array/);
  assert.match(technicianPage, /الكمية المستخدمة فعليًا/);
  assert.match(technicianPage, /الباقي سيُسجل تلقائيًا كمرتجع معلق للمخزن/);
});

test("ready_to_complete is completed with fixed result and a material settlement", () => {
  assert.match(execution, /row\.itemStatus !== "in_progress" && row\.itemStatus !== "ready_to_complete"/);
  assert.match(execution, /row\.itemStatus === "ready_to_complete" && input\.result !== "fixed"/);
  assert.match(execution, /declareConsumptionWithDb/);
  assert.match(execution, /pendingReturnQuantity/);
});

test("issued, used and to-return quantities are explicitly separated", () => {
  assert.match(service, /issuedQuantity/);
  assert.match(service, /usedQuantity/);
  assert.match(service, /toReturnQuantity/);
  assert.match(service, /issuedQuantity - usedQuantity/);
});

test("technician save creates a pending return instead of mutating warehouse stock", () => {
  assert.match(service, /MATERIAL_CONSUMPTION_DECLARED_ACTION = "material_consumption_declared"/);
  assert.match(technicianPage, /مسجل للإرجاع إلى مخزن الفريق/);
  const declareStart = service.indexOf("async declareConsumptionWithDb");
  const pendingStart = service.indexOf("async listPendingReturns");
  const declareBlock = service.slice(declareStart, pendingStart);
  assert.doesNotMatch(declareBlock, /currentRecipientReturnAdapter\.createReturn/);
});

test("warehouse pending-return queue identifies original recipient and only original issue lots", () => {
  assert.match(service, /listPendingReturns/);
  assert.match(service, /previousRecipientName/);
  assert.match(service, /routeDecisionActionId === declaration\.routeDecisionActionId/);
  assert.match(warehousePage, /المستلم السابق/);
  assert.match(warehousePage, /فقط Lots الصرف الأصلي/);
});

test("single-lot return is fixed automatically without QR or lot selection", () => {
  assert.match(service, /if \(pending\.singleLot\) allocations = \[\{ lotId: pending\.lots\[0\]\.lotId, quantity: pending\.remainingReturnQuantity \}\]/);
  assert.match(warehousePage, /Lot المرتجع مثبت آليًا/);
  assert.doesNotMatch(warehousePage, /QR.*المرتجع|مسح.*المرتجع/);
});

test("multi-lot return requires warehouse allocation only across original issued lots", () => {
  assert.match(service, /مجموع توزيع المرتجع يجب أن يساوي/);
  assert.match(service, /كمية المرتجع للـLot أكبر من الكمية المصروفة القابلة للإرجاع/);
  assert.match(warehousePage, /returnQtyByLot/);
  assert.match(warehouseRouter, /lotAllocations/);
});

test("warehouse confirmation reuses the existing recipient return workflow before stock comes back", () => {
  assert.match(service, /currentRecipientReturnAdapter\.createReturn/);
  assert.match(service, /sourceDeliveryDocumentId: issue\.note\.deliveryDocumentId/);
  assert.match(warehouseDb, /Same Original Lot \+ Original Issue Cost \+ Original Issue Link/);
  assert.match(warehouseDb, /createRecipientWarehouseReturn/);
});

test("actual PM V2 usage is finalized from issued minus confirmed returns", () => {
  assert.match(service, /netQuantity: roundQuantity/);
  assert.match(service, /netTotal - declaration\.usedQuantity/);
  assert.match(service, /insert\(pmv2MaterialUsages\)/);
  assert.match(service, /MATERIAL_CONSUMPTION_FINALIZED_ACTION/);
});

test("shortage-request attribution is based on actual final consumption, not gross issue", () => {
  assert.match(service, /teamStockAtDecision/);
  assert.match(service, /requestBudget = roundQuantity\(Math\.max\(0, declaration\.usedQuantity - teamStockAtDecision\)\)/);
  assert.match(service, /eq\(pmv2MaterialRequestItems\.status, "issued_to_team"\)/);
  assert.match(service, /set\(\{ status: "consumed" \}\)/);
});

test("counted-unit quantity policy also protects technician actual-use input", () => {
  assert.match(service, /getPmv2MaterialQuantityValidationMessage/);
  assert.match(technicianPage, /pmv2MaterialUnitRequiresWholeQuantity\(item\.unit\)/);
});

test("PM V2 orchestration never directly updates Inventory or Lot balances", () => {
  assert.doesNotMatch(service, /update\(inventory\)|update\(inventoryLotBalances\)|consumeInventoryLotForIssue/);
  assert.match(service, /currentInventoryIssueAdapter/);
  assert.match(service, /currentRecipientReturnAdapter/);
});

test("no new PM V2 migration is required for issue-consumption-return state", () => {
  assert.match(service, /pmv2ItemActions/);
  assert.match(service, /pmv2MaterialUsages/);
  assert.match(service, /material_return_part_linked/);
});

test("a physical Delivery that fails PM V2 linking is persisted as relink-only recovery", () => {
  assert.match(service, /MATERIAL_ISSUE_LINK_PENDING_ACTION = "material_issue_link_pending"/);
  assert.match(service, /recordPendingIssueLink/);
  assert.match(service, /requiresRelink: true/);
  assert.match(service, /لا تكرر الصرف/);
  assert.match(service, /listUnlinkedPhysicalIssues/);
  assert.match(warehousePage, /إعادة ربط السند فقط — بدون صرف جديد/);
  assert.match(warehouseRouter, /linkConfirmedDelivery/);
});

test("decimal pending returns are blocked before task completion while the live recipient-return document is integer-only", () => {
  assert.match(service, /toReturnQuantity > 0 && !Number\.isInteger\(toReturnQuantity\)/);
  assert.match(service, /مرتجع المستودع الحالي يدعم الكميات الصحيحة فقط/);
  assert.match(warehouseDb, /warehouse_returns\.returnedQuantity \+ return_documents\.returnedQuantity are INT/);
});
