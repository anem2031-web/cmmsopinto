import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";
import * as timing from "../../shared/purchaseItemNeedDate";
import { isValidPurchaseRequiredDate } from "../../client/src/lib/purchaseOrderValidation";
import { PURCHASE_REVIEW_ROLES, purchaseReviewRoleSchema } from "../../shared/purchase-item-review";

// Execute the actual form's handlers with explicit in-memory state. No API/DB imports.
const source = readFileSync("client/src/pages/purchase/CreatePurchaseOrder.tsx", "utf8");
const ast = ts.createSourceFile("Create.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const initializers = new Map<string, string>();
let itemContext = "";
const effects: string[] = [];
function find(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.initializer) initializers.set(node.name.getText(ast), node.initializer.getText(ast));
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") effects.push(node.arguments[0].getText(ast));
  if (ts.isJsxElement(node) && node.openingElement.getText(ast).includes('className="rounded-md border bg-muted/20 p-3 space-y-3"')) itemContext = node.getText(ast);
  ts.forEachChild(node, find);
}
find(ast);
function evaluate(code: string, scope: any) {
  const js = ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  return vm.runInNewContext(js, { React, ...scope });
}
const fixture = (overrides = {}) => ({
  itemName: "صنف", sourceType: "catalog", catalogItemId: 10, description: "", notes: "", photoUrls: [],
  siteId: "1", sectionId: "11", categoryId: "7", assetId: "", unit: "قطعة", quantity: 2,
  reviewRole: "general_maintenance_manager",
  ...timing.purchaseNeedTimingFromDays(4), ...overrides,
});
function harness(items = [fixture()], overrides: any = {}) {
  const scope: any = {
    ...timing, isValidPurchaseRequiredDate, PURCHASE_REVIEW_ROLES, purchaseReviewRoleSchema, items, t: ar, itemMessage: (text: string, index: number) => text.replace("{item}", String(index + 1)),
    emptyPurchaseFormErrors: () => ({ items: {} }), formErrors: { items: {} },
    setFormErrors: (value: any) => { scope.formErrors = typeof value === "function" ? value(scope.formErrors) : value; },
    setItems: (value: any) => { scope.items = typeof value === "function" ? value(scope.items) : value; },
    toast: { error: vi.fn() }, focusValidationTarget: vi.fn(),
    hasMaterialPurchaseContext: false, materialCatalogItemId: undefined, materialMinimumPurchaseUnits: 1, materialPurchaseTotalUnits: 1,
    isReturnReplacement: false, initialContext: { siteId: "99", sectionId: "999", categoryId: "88", assetId: "888" },
    isTicketMaterial: false, isLinkedTicketActionBlocked: false, validateMaterialLinkedPurchase: () => true,
    createMut: { mutate: vi.fn() }, saveDraftMut: { mutate: vi.fn() }, updateDraftMut: { mutate: vi.fn() },
    fromIdeaId: undefined, ticketId: undefined, ticketItemId: undefined, supplierReturnPlanId: undefined,
    materialRequestItemId: undefined, draftId: undefined, notes: "note", ...overrides,
  };
  for (const name of ["purchaseItemsForSubmit", "buildItemsPayload", "purchaseContextPayload", "validatePurchaseForm", "validationMessageForPath", "updateItem", "handleSaveDraft", "handleUpdateDraft", "handleSubmit"]) {
    scope[name] = (...args: any[]) => evaluate(initializers.get(name)!, scope)(...args);
  }
  return scope;
}

describe("Purchase creation with context entered on items only", () => {
  it("removes the header inputs while keeping independent context on every item", () => {
    expect(source).not.toContain("t.purchaseOrders.requestContext");
    expect(source).not.toContain('id="purchase-site"');
    expect(itemContext).toContain("item.siteId");
    expect(itemContext).toContain("item.sectionId");
    expect(itemContext).toContain("item.categoryId");
  });

  it.each(["handleSaveDraft", "handleSubmit", "handleUpdateDraft"])("%s derives the compatibility header from the first item without changing other items", handler => {
    const h = harness([fixture(), fixture({ siteId: "2", sectionId: "22", categoryId: "8", assetId: "222" })], { draftId: 50 });
    h[handler]();
    const mutation = handler === "handleSaveDraft" ? h.saveDraftMut : handler === "handleSubmit" ? h.createMut : h.updateDraftMut;
    expect(mutation.mutate).toHaveBeenCalledOnce();
    const payload = mutation.mutate.mock.calls[0][0];
    expect(payload).toMatchObject({ siteId: 1, sectionId: 11, categoryId: 7, assetId: null });
    expect(payload.items[1]).toMatchObject({ siteId: 2, sectionId: 22, categoryId: 8, assetId: 222 });
  });

  it.each(["siteId", "sectionId", "categoryId"])("blocks save, update and send for a missing %s on the second item", field => {
    for (const handler of ["handleSaveDraft", "handleSubmit", "handleUpdateDraft"]) {
      const h = harness([fixture(), fixture({ [field]: "" })]);
      h[handler]();
      expect(h.formErrors.items[1][field]).toBeTruthy();
      expect(h.focusValidationTarget).toHaveBeenCalledWith(`purchase-item-1-${field}`);
      expect(h.toast.error).toHaveBeenCalled();
      expect(h.createMut.mutate).not.toHaveBeenCalled();
      expect(h.saveDraftMut.mutate).not.toHaveBeenCalled();
      expect(h.updateDraftMut.mutate).not.toHaveBeenCalled();
    }
  });

  it("marks every missing field and focuses the first, with a visible red frame on each", () => {
    const h = harness([fixture({ siteId: "", sectionId: "", categoryId: "" }), fixture({ categoryId: "" })]);
    expect(h.validatePurchaseForm(false)).toBe(false);
    expect(Object.keys(h.formErrors.items[0])).toEqual(["siteId", "sectionId", "categoryId"]);
    expect(h.formErrors.items[1].categoryId).toBeTruthy();
    expect(h.focusValidationTarget).toHaveBeenCalledWith("purchase-item-0-siteId");
    const frame = ({ children }: any) => <div>{children}</div>;
    const trigger = ({ children, ...props }: any) => <button {...props}>{children}</button>;
    const html = renderToStaticMarkup(evaluate(itemContext, {
      item: h.items[0], idx: 0, itemErrors: h.formErrors.items[0], language: "ar", t: ar,
      Select: frame, SelectTrigger: trigger, SelectValue: () => null, SelectContent: frame, SelectItem: frame, Label: frame,
      sites: [], allSections: [], allAssets: [], purchaseCategories: [], updateItem: vi.fn(), cn: (...values: any[]) => values.filter(Boolean).join(" "),
      PURCHASE_REVIEW_ROLES,
    }));
    for (const field of ["siteId", "sectionId", "categoryId"]) {
      expect(html).toContain(`id="purchase-item-0-${field}" aria-invalid="true" class="border-destructive focus:ring-destructive"`);
      expect(html).toContain(h.formErrors.items[0][field]);
    }
  });

  it("clears dependent choices on one item and clears the corrected field's error only", () => {
    const h = harness([fixture({ assetId: "111" }), fixture({ siteId: "2", sectionId: "22" })]);
    h.formErrors = { items: { 0: { siteId: "site", sectionId: "section", categoryId: "category" } } };
    h.updateItem(0, "siteId", "3");
    expect(h.items[0]).toMatchObject({ siteId: "3", sectionId: "", assetId: "" });
    expect(h.items[1]).toMatchObject({ siteId: "2", sectionId: "22" });
    expect(h.formErrors.items[0]).toEqual({ sectionId: "section", categoryId: "category" });
    h.updateItem(0, "sectionId", "33");
    h.updateItem(0, "categoryId", "9");
    expect(h.formErrors.items[0]).toEqual({});
  });

  it("maps structured server errors onto visible item fields", () => {
    const h = harness();
    for (const path of [["siteId"], ["items", 1, "sectionId"], ["items", 1, "categoryId"]]) {
      const mapped = h.validationMessageForPath(path);
      mapped.apply(h.formErrors);
      expect(mapped.targetId).toBe(`purchase-item-${path.length === 1 ? 0 : 1}-${path.at(-1)}`);
    }
    expect(h.formErrors.items[0].siteId).toBeTruthy();
    expect(h.formErrors.items[1].categoryId).toBeTruthy();
  });

  it("loads legacy draft context into its items and updates the summary when the first item is removed", () => {
    const h = harness([], {
      draftPO: { id: 50, siteId: 1, sectionId: 11, categoryId: 7, assetId: 111, items: [
        { id: 100, itemName: "legacy", quantity: 1, requiredDate: fixture().requiredDate },
        { id: 101, itemName: "own context", quantity: 2, siteId: 2, sectionId: 22, categoryId: 8, assetId: 222, requiredDate: fixture().requiredDate },
      ] },
      draftLoaded: false, setNotes: vi.fn(), setDraftLoaded: vi.fn(), language: "ar",
      getLocalizedItemField: (item: any, key: string) => item[key],
    });
    const effect = effects.find(text => text.includes("if (draftPO && !draftLoaded)"))!;
    evaluate(effect, h)();
    expect(h.items[0]).toMatchObject({ siteId: "1", sectionId: "11", categoryId: "7", assetId: "111", _existingId: 100 });
    expect(h.items[1]).toMatchObject({ siteId: "2", sectionId: "22", categoryId: "8", assetId: "222", _existingId: 101 });
    h.items = h.items.slice(1);
    expect(h.purchaseContextPayload()).toEqual({ siteId: 2, sectionId: 22, categoryId: 8, assetId: 222 });
  });

  it("keeps replacement header context distinct from the original item's recorded context", () => {
    const h = harness([fixture()], { isReturnReplacement: true, supplierReturnPlanId: 40 });
    h.handleSubmit();
    expect(h.createMut.mutate.mock.calls[0][0]).toMatchObject({ supplierReturnPlanId: 40, siteId: 99, sectionId: 999, categoryId: 88,
      items: [{ siteId: 1, sectionId: 11, categoryId: 7 }] });
  });

  it.each([false, true])("retains shortage quantity and linkage for ticket materials=%s", isTicketMaterial => {
    const h = harness([fixture({ quantity: 3 })], {
      hasMaterialPurchaseContext: true, materialCatalogItemId: 10, materialMinimumPurchaseUnits: 3, materialPurchaseTotalUnits: 3,
      materialRequestItemId: 20, ticketId: 100, isTicketMaterial, ticketTeamAssignmentId: 8, ticketTeamNeedId: 20, ticketTeamRevision: 0,
      ticketWarehouseExtraQuantity: 0, ticketOperationKey: { current: null }, crypto: { randomUUID: () => "fixture-key" },
      params: new URLSearchParams(isTicketMaterial ? "ticketTeamNeedId=20" : "pmv2RequestItemId=20"),
    });
    h.handleSubmit();
    const payload = h.createMut.mutate.mock.calls[0][0];
    expect(payload).toMatchObject({ ticketId: 100, siteId: 1, items: [{ quantity: 3, siteId: 1 }] });
    if (isTicketMaterial) expect(payload.ticketTeam).toMatchObject({ assignmentId: 8, needId: 20, expectedRevision: 0 });
    else expect(payload.pmv2RequestItemId).toBe(20);
  });

  it("still blocks empty orders and preserves draft versus submission date rules", () => {
    const empty = harness([]);
    expect(empty.validatePurchaseForm()).toBe(false);
    const h = harness([fixture({ requiredDate: "", deliveryLeadDays: null })]);
    expect(h.validatePurchaseForm(false)).toBe(true);
    expect(h.validatePurchaseForm(true)).toBe(false);
  });

  it("requires each review department when sending, saving or updating a draft", () => {
    const h = harness([fixture(), fixture({ reviewRole: "" })]);
    expect(h.validatePurchaseForm(false)).toBe(false);
    h.handleSaveDraft();
    h.handleUpdateDraft();
    expect(h.saveDraftMut.mutate).not.toHaveBeenCalled();
    expect(h.updateDraftMut.mutate).not.toHaveBeenCalled();
    h.handleSubmit();
    expect(h.createMut.mutate).not.toHaveBeenCalled();
    expect(h.formErrors.items[1].reviewRole).toContain("2");
    expect(h.focusValidationTarget).toHaveBeenCalledWith("purchase-item-1-reviewRole");
    h.updateItem(1, "reviewRole", "senior_management");
    expect(h.formErrors.items[1].reviewRole).toBeUndefined();
    h.handleSubmit();
    expect(h.createMut.mutate.mock.calls[0][0].items.map((i: any) => i.reviewRole)).toEqual(["general_maintenance_manager", "senior_management"]);
  });

  it("hydrates routed draft departments and keeps legacy drafts awaiting explicit department selection", () => {
    const h = harness([], { draftPO: { id: 50, items: [fixture({ id: 1 }), fixture({ id: 2, reviewRole: null })] }, draftLoaded: false, setNotes: vi.fn(), setDraftLoaded: vi.fn(), language: "ar", getLocalizedItemField: (item: any, key: string) => item[key] });
    evaluate(effects.find(text => text.includes("if (draftPO && !draftLoaded)"))!, h)();
    expect(h.items.map((item: any) => item.reviewRole)).toEqual(["general_maintenance_manager", ""]);
    expect(h.validatePurchaseForm(true)).toBe(false);
    expect(h.formErrors.items[1].reviewRole).toBeTruthy();
  });

  it("prefills linked ticket context only when the user has not chosen a different hierarchy", () => {
    const h = harness([fixture({ siteId: "", sectionId: "", assetId: "" })], { ticket: { siteId: 1, sectionId: 11, assetId: 111 } });
    const effect = effects.find(text => text.includes("if (draftId || !ticket)"))!;
    evaluate(effect, h)();
    expect(h.items[0]).toMatchObject({ siteId: "1", sectionId: "11", assetId: "111" });
    h.updateItem(0, "siteId", "2");
    evaluate(effect, h)();
    expect(h.items[0]).toMatchObject({ siteId: "2", sectionId: "", assetId: "" });
  });
});
