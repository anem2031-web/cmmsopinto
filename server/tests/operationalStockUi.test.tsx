import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { OperationalStock } from "../../shared/operational-issues";
import { requiresBranchTransferConfirmation } from "../../shared/branch-transfer-confirmation";
import { operationalIssueText } from "../../client/src/i18n/operationalIssues";
const state = vi.hoisted(() => ({ language: "ar" }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useTranslation: () => ({ language: state.language, dir: state.language === "en" ? "ltr" : "rtl" }) }));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: { operationalIssues: { issue: { useMutation: () => ({ isPending: false }) }, addToPurchaseDraft: { useMutation: () => ({ isPending: false }) } } } }));
import { OperationalStockPanel } from "../../client/src/pages/operational-issues/OperationalStockPanel";
const line = { id: 11, orderId: 1, catalogItemId: 5, itemName: "فلتر المكيف", quantity: 5, issuedQuantity: 1, unit: "حبة" };
const empty: OperationalStock = { itemId: 11, totalQuantity: 0, unit: "حبة", needsReview: false, purchase: null, lots: [] };
const props = { line, orderId: 1, approved: true, canProcess: true, showStock: true, loading: false, procurementReady: true, refresh: async () => {} };
describe("Operational stock and procurement presentation", () => {
  it.each(["ar", "en", "ur"])("displays lots, warehouse names and zero-stock draft action in %s", language => {
    state.language = language;
    const text = operationalIssueText[language as keyof typeof operationalIssueText];
    const stock: OperationalStock = { ...empty, totalQuantity: 3, lots: [{ inventoryId: 1, warehouseId: 1, warehouseNameAr: "مخزن التكييف", warehouseNameEn: "AC warehouse", lotId: 10, lotCode: "LOT-A", trackingToken: "token-a", quantity: 3, unit: "حبة", unitCost: 12 }] };
    const stocked = renderToStaticMarkup(<OperationalStockPanel {...props} stock={stock} />);
    expect(stocked).toContain(text.totalAvailable); expect(stocked).toContain('aria-expanded="false"'); expect(stocked).toContain(language === "ar" ? "مخزن التكييف" : "AC warehouse");
    expect(stocked).toContain(`${text.addToDraft} — 1 حبة`);
    expect(stocked).toMatch(new RegExp('disabled="">'+text.issue));
    const zero = renderToStaticMarkup(<OperationalStockPanel {...props} stock={empty} />);
    expect(zero).toContain(text.zeroStock); expect(zero).toContain(`${text.addToDraft} — 4 حبة`);
  });
  it("never shows purchase creation for loading, unavailable setup, non-approved, or read-only views", () => {
    state.language = "ar";
    for (const overrides of [{ stock: undefined, loading: true }, { procurementReady: false }, { approved: false }, { canProcess: false }]) {
      const html = renderToStaticMarkup(<OperationalStockPanel {...props} stock={empty} {...overrides} />);
      expect(html).not.toContain(operationalIssueText.ar.addToDraft);
    }
  });
  it("shows a stock discrepancy instead of a false zero-stock purchase button", () => {
    const html = renderToStaticMarkup(<OperationalStockPanel {...props} stock={{ ...empty, needsReview: true }} />);
    expect(html).toContain(operationalIssueText.ar.stockReview); expect(html).not.toContain(operationalIssueText.ar.addToDraft);
  });
  it("shows the original linked document and flags edited lines without offering duplicate purchase", () => {
    const stock = { ...empty, purchase: { orderItemId: 11, purchaseOrderId: 22, purchaseOrderItemId: 23, quantity: 4, unit: "حبة", poNumber: "DFT-2026-TEST", status: "draft", itemStatus: "pending", changed: true } };
    const html = renderToStaticMarkup(<OperationalStockPanel {...props} stock={stock} />);
    expect(html).toContain('href="/purchase-orders/22"'); expect(html).toContain("DFT-2026-TEST");
    expect(html).toContain(operationalIssueText.ar.purchaseChanged); expect(html).not.toContain(operationalIssueText.ar.addToDraft);
  });
});
describe("Branch transfer confirmation boundary", () => {
  it.each([
    ["branch", "branch", true], ["main", "branch", false], ["branch", "main", false], ["project", "branch", false], ["branch", "kitchen", false],
  ])("%s to %s requires confirmation: %s", (sourceType, targetType, expected) => {
    expect(requiresBranchTransferConfirmation({ id: 1, type: String(sourceType) }, { id: 2, type: String(targetType) })).toBe(expected);
  });
  it("does not confirm a missing warehouse or a self-transfer", () => {
    expect(requiresBranchTransferConfirmation(undefined, { id: 2, type: "branch" })).toBe(false);
    expect(requiresBranchTransferConfirmation({ id: 1, type: "branch" }, { id: 1, type: "branch" })).toBe(false);
  });
});
