import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

const text = readFileSync("client/src/pages/purchase/PurchaseOrderDetail.tsx", "utf8");
const source = ts.createSourceFile("detail.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let footer = "";
const predicates: Record<string, string> = {};
function walk(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && ["isEditingReturnedItem", "isEditingRevisionItem"].includes(node.name.getText(source)))
    predicates[node.name.getText(source)] = node.initializer!.getText(source);
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === "DialogFooter" && node.getText(source).includes("editAndResubmitReturnedItemMut.mutate")) footer = node.getText(source);
  ts.forEachChild(node, walk);
}
walk(source);
function evaluate(code: string, context: object) {
  return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
}
function render(status: string, pending = false, canResolveReturnedItem = true) {
  const buttons: any[] = [], save = vi.fn(), send = vi.fn();
  const editingItem = { id: 12, status, updatedAt: "2026-11-05 10:20:30" };
  const context: any = { React, editingItem, canResolveReturnedItem, setEditingItem: vi.fn(), showExternalEditWorkshop: false,
    editForm: { itemName: "Name", description: "Updated specification", quantity: 3, estimatedUnitCost: "", unit: "piece", photoUrl: "", notes: "Clarified size" },
    po: { id: 9, status: "pending_estimate" }, getLastKnownUpdatedAt: (item: any) => item.updatedAt,
    editItemMut: { isPending: false, mutate: save }, editAndResubmitReturnedItemMut: { isPending: pending, mutate: send },
    t: { common: { cancel: "Cancel", save: "Save" }, purchaseOrders: { saveOnly: "Save only", saveAndResubmit: "Save and resubmit" } },
    DialogFooter: (props: any) => <footer>{props.children}</footer>, Loader2: () => <span>Loading</span>,
    Button: (props: any) => { buttons.push(props); return <button disabled={props.disabled}>{props.children}</button>; },
  };
  context.isEditingReturnedItem = evaluate(predicates.isEditingReturnedItem, context);
  context.isEditingRevisionItem = evaluate(predicates.isEditingRevisionItem, context);
  return { html: renderToStaticMarkup(evaluate(footer, context)), buttons, save, send };
}
describe("one save-and-resubmit action for items returned for revision", () => {
  it("renders one commit action and saves the entered fields through the existing combined endpoint", () => {
    const result = render("needs_item_revision");
    expect(result.html).not.toContain("Save only"); expect(result.buttons).toHaveLength(2); // Cancel plus one commit.
    const submit = result.buttons.find(b => b.children === "Save and resubmit");
    submit.onClick();
    expect(result.save).not.toHaveBeenCalled(); expect(result.send).toHaveBeenCalledTimes(1);
    expect(result.send).toHaveBeenCalledWith({ id: 12, purchaseOrderId: 9, lastKnownUpdatedAt: "2026-11-05 10:20:30", itemName: "Name", description: "Updated specification", quantity: 3, estimatedUnitCost: undefined, unit: "piece", photoUrl: undefined, notes: "Clarified size" });
  });
  it("disables the single commit while the combined request is pending", () => {
    const result = render("needs_item_revision", true);
    expect(result.buttons.filter(b => b.disabled === true)).toHaveLength(1); expect(result.html).toContain("Loading");
  });
  it("keeps the ordinary edit save path", () => {
    const result = render("pending");
    expect(result.html).not.toContain("Save and resubmit"); result.buttons.find(b => b.children === "Save").onClick();
    expect(result.save).toHaveBeenCalledTimes(1); expect(result.send).not.toHaveBeenCalled();
  });
  it("does not alter cancelled-purchase actions outside this revision request", () => {
    const result = render("purchase_cancelled");
    expect(result.html).toContain("Save only"); expect(result.html).toContain("Save and resubmit");
  });
  it("does not grant resubmission to an editor lacking creator/admin authority", () => {
    const result = render("needs_item_revision", false, false);
    expect(result.html).not.toContain("Save and resubmit"); expect(result.buttons).toHaveLength(2);
  });
  it("removes the card's independent revision resubmission call", () => {
    expect(text).not.toContain("resubmitItemRevisionMut");
    expect(text).toContain("resubmitCancelledPurchaseMut.mutate");
  });
});
