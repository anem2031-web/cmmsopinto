import { beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "../routers/_shared/procedures";
import { APP_ROLE } from "../../shared/roles";
import { businessRpcAllowed } from "../../shared/business-role-policy";
import { isOwnerAdminOnlyRpc } from "../../shared/restricted-module-policy";

const fixture = vi.hoisted(() => ({ duplicate: vi.fn(), order: vi.fn(), job: vi.fn(), update: vi.fn(), ocr: vi.fn(), transaction: vi.fn() }));
vi.mock("../_core/db/client", () => ({ getDb: async () => { throw Error("live database forbidden"); } }));
vi.mock("../_core/llm", () => ({ invokeLLM: vi.fn() }));
vi.mock("../_core/ai-response-cache", () => ({ withAiResponseCache: vi.fn() }));
vi.mock("../services/ocr/invoiceOcr.service", () => ({ analyzeInvoiceFromUrl: fixture.ocr, analyzeInvoiceFromBase64: fixture.ocr }));
vi.mock("../_core/catalog-unit-governance", () => ({ getActiveCatalogUnitCanonicalName: async (unit: string) => unit }));
vi.mock("../_core/inventory-lots", () => ({ isInventoryLotsEnabled: () => false, createReceiptInventoryLot: vi.fn() }));
vi.mock("../_core/db", () => ({
  getDb: async () => { throw Error("database unavailable in permission fixture"); },
  checkDuplicateInvoice: fixture.duplicate, getPurchaseOrderById: fixture.order,
  createOcrJob: fixture.job, updateOcrJob: fixture.update, withTransaction: fixture.transaction,
}));
import { receiptsV2Router } from "../routers/inventory/receipts.v2.router";
import { assertReceiptAnalysisAccess } from "../_core/authz/standalone-receipt";
const api = router({ warehouseReceiptsV2: receiptsV2Router });
const actor = (role: string, isActive = 1) => ({ id: 50, role, isActive, name: "Permission fixture" });
function caller(role: string, isActive = 1, projected = false) {
  const authenticatedUser = actor(role, isActive);
  return api.createCaller({ user: projected ? { ...authenticatedUser, role: "admin", isActive: 1 } : authenticatedUser,
    authenticatedUser, req: {}, res: {} } as any);
}
const standaloneInput = () => ({ invoiceNumber: "EXISTS", notes: "سبب استلام مستقل للتجربة", items: [{
  linkedItemId: 100, itemName: "Item", receivedQuantity: 1, purchaseUnit: "piece", issueUnit: "piece", conversionFactor: 1, unitCost: "1",
}] });
beforeEach(() => {
  vi.clearAllMocks();
  fixture.duplicate.mockResolvedValue({ id: 9, receiptNumber: "RCV-EXISTS" });
  fixture.order.mockImplementation(async id => id === 1 ? { id: 1, status: "received", requestedById: 99 } : null);
  fixture.job.mockResolvedValue(7); fixture.update.mockResolvedValue(undefined);
  fixture.ocr.mockResolvedValue({ result: { items: [], overallConfidence: 1 }, rawResponse: "fixture", processingMs: 1 });
});

describe("independent invoice receipt is an owner/admin-only API capability", () => {
  it.each(["admin", "owner"])("active %s reaches the unchanged receipt validation", async role => {
    await expect(caller(role).warehouseReceiptsV2.receiveStandaloneV2(standaloneInput())).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("RCV-EXISTS") });
    expect(fixture.duplicate).toHaveBeenCalledOnce();
    expect(fixture.transaction).not.toHaveBeenCalled();
  });
  it.each(Object.values(APP_ROLE).filter(role => !["admin", "owner"].includes(role)))("%s cannot call the standalone writer directly", async role => {
    await expect(caller(role).warehouseReceiptsV2.receiveStandaloneV2(standaloneInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.duplicate).not.toHaveBeenCalled(); expect(fixture.transaction).not.toHaveBeenCalled();
  });
  it.each(["admin", "owner"])("inactive %s is denied before any receipt data or write", async role => {
    await expect(caller(role,0).warehouseReceiptsV2.receiveStandaloneV2(standaloneInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.duplicate).not.toHaveBeenCalled(); expect(fixture.transaction).not.toHaveBeenCalled();
  });
  it.each(["observer", "warehouse", "delegate"])("a projected admin cannot hide actual %s identity", async role => {
    await expect(caller(role,1,true).warehouseReceiptsV2.receiveStandaloneV2(standaloneInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.duplicate).not.toHaveBeenCalled();
  });
  it("rechecks actual active identity on independent consecutive operations", async () => {
    await expect(caller("owner").warehouseReceiptsV2.receiveStandaloneV2(standaloneInput())).rejects.toMatchObject({ code: "CONFLICT" });
    fixture.duplicate.mockClear();
    await expect(caller("owner",0,true).warehouseReceiptsV2.receiveStandaloneV2(standaloneInput())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.duplicate).not.toHaveBeenCalled();
  });
  it("does not let a forged PO field change the standalone capability", async () => {
    await expect(caller("warehouse").warehouseReceiptsV2.receiveStandaloneV2({ ...standaloneInput(), purchaseOrderId: 1 } as any)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.order).not.toHaveBeenCalled(); expect(fixture.transaction).not.toHaveBeenCalled();
  });
  it("removes only the independent writer from warehouse grants", () => {
    const warehouse = actor("warehouse");
    expect(businessRpcAllowed(warehouse,"mutation","warehouseReceiptsV2.receiveStandaloneV2")).toBe(false);
    expect(isOwnerAdminOnlyRpc("warehouseReceiptsV2.receiveStandaloneV2")).toBe(true);
    for(const method of ["receiveFromPurchaseV2","analyzeInvoice","generateItemBarcodes"])
      expect(businessRpcAllowed(warehouse,"mutation",`warehouseReceiptsV2.${method}`),method).toBe(true);
    expect(isOwnerAdminOnlyRpc("warehouseReceiptsV2.receiveFromPurchaseV2")).toBe(false);
  });
});

describe("invoice OCR keeps PO receipt access separate from standalone receipt", () => {
  it.each(["admin", "owner"])("active %s can analyze an independent invoice", async role => {
    await expect(caller(role).warehouseReceiptsV2.analyzeInvoice({ base64Image: "fixture" })).resolves.toMatchObject({ ocrJobId: 7, invoiceData: { items: [] } });
    expect(fixture.order).not.toHaveBeenCalled(); expect(fixture.ocr).toHaveBeenCalledOnce();
  });
  it.each([0,1])("warehouse active=%s cannot analyze an independent invoice", async active => {
    await expect(caller("warehouse",active).warehouseReceiptsV2.analyzeInvoice({ base64Image: "fixture" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.job).not.toHaveBeenCalled(); expect(fixture.ocr).not.toHaveBeenCalled(); expect(fixture.order).not.toHaveBeenCalled();
  });
  it.each(["admin", "owner"])("inactive %s cannot use independent OCR", async role => {
    await expect(caller(role,0).warehouseReceiptsV2.analyzeInvoice({ base64Image: "fixture" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.job).not.toHaveBeenCalled(); expect(fixture.ocr).not.toHaveBeenCalled();
  });
  it("preserves warehouse OCR for an actual visible PO", async () => {
    await expect(caller("warehouse").warehouseReceiptsV2.analyzeInvoice({ base64Image: "fixture", purchaseOrderId: 1 })).resolves.toMatchObject({ ocrJobId: 7 });
    expect(fixture.order).toHaveBeenCalledWith(1); expect(fixture.job).toHaveBeenCalledWith(expect.objectContaining({ purchaseOrderId: 1, createdById: 50 }));
  });
  it("rejects a fake or now-hidden PO before OCR jobs and external calls", async () => {
    await expect(caller("warehouse").warehouseReceiptsV2.analyzeInvoice({ base64Image: "fixture", purchaseOrderId: 999 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    fixture.order.mockResolvedValue({id:1,status:"draft",requestedById:99});
    await expect(caller("warehouse").warehouseReceiptsV2.analyzeInvoice({ base64Image: "fixture", purchaseOrderId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.job).not.toHaveBeenCalled(); expect(fixture.ocr).not.toHaveBeenCalled();
  });
  it("propagates parent-read infrastructure failure instead of reclassifying it as independent", async () => {
    const failure=Error("fixture database unavailable"); fixture.order.mockRejectedValue(failure);
    await expect(assertReceiptAnalysisAccess(actor("warehouse"),1,fixture.order)).rejects.toBe(failure);
    expect(fixture.job).not.toHaveBeenCalled(); expect(fixture.ocr).not.toHaveBeenCalled();
  });
  it("checks an actual observer before any PO data access despite an admin projection", async () => {
    await expect(caller("observer",1,true).warehouseReceiptsV2.analyzeInvoice({ base64Image: "fixture", purchaseOrderId: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fixture.order).not.toHaveBeenCalled(); expect(fixture.job).not.toHaveBeenCalled();
  });
});
