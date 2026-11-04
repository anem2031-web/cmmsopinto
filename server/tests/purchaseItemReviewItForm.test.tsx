import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";
import * as review from "../../shared/purchase-item-review";
import { APP_ROLE } from "../../shared/roles";

const ast = ts.createSourceFile("IT.tsx", readFileSync("client/src/pages/tickets/ItTeamPanel.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let component = "";
function find(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === "NeedReview") component = node.getText(ast); ts.forEachChild(node, find); }
find(ast);
function fixture(roles: Array<string | undefined>, actorRole: string = APP_ROLE.IT_MANAGER) {
  const create = vi.fn(); const state: any[] = []; let cursor = 0;
  const Button = ({ children, ...props }: any) => <button {...props}>{children}</button>;
  const Input = (props: any) => <input {...props} />;
  const Textarea = (props: any) => <textarea {...props} />;
  const ui = vm.runInNewContext(ts.transpileModule(`(${component})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, {
    React, ...review, APP_ROLE, Button, Input, Textarea, selectClass: "border", toast: { error: vi.fn() }, localizeApiError: (s: string) => s,
    useAuth: () => ({ user: { role: actorRole } }), useTranslation: () => ({ t: ar, language: "ar" }), useLocation: () => ["", vi.fn()],
    useState: (initial: any) => { const index = cursor++; if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial; return [state[index], (value: any) => { state[index] = typeof value === "function" ? value(state[index]) : value; }]; },
    getDefaultRequiredDate: () => "2026-11-06", format: (s: string, values: any) => Object.entries(values).reduce((text, [key, value]) => text.replace(`{${key}}`, String(value)), s),
    trpc: { purchaseOrders: { create: { useMutation: () => ({ mutate: create, isPending: false }) } }, tickets: { returnItPurchaseNeed: { useMutation: () => ({ mutate: vi.fn() }) } } },
  });
  const need = { id: 88, ticketId: 55, ticketItemId: 66, status: "pending", reason: "IT need", items: roles.map((reviewRole, index) => ({ itemName: `IT ${index}`, quantity: index + 1, unit: "قطعة", requiredDate: "2026-11-06", reviewRole })) };
  const render = () => { cursor = 0; return ui({ need, onChanged: vi.fn() }); };
  function nodes(tree: any, predicate: (v: any) => boolean): any[] {
    if (!tree || typeof tree !== "object") return [];
    const children = React.Children.toArray(tree.props?.children);
    return [...(predicate(tree) ? [tree] : []), ...children.flatMap(child => nodes(child, predicate))];
  }
  return { create, need, state, render, nodes, submit: (tree: any) => nodes(tree, n => n.type === Button && n.props.children === ar.workflow.ticket.createOfficialPo)[0] };
}
describe("The existing inline IT purchase form carries the required review route", () => {
  it.each([[undefined], ["general_maintenance_manager", undefined]])("requires every item before creating the official PO (%j)", (...roles: any[]) => {
    const f = fixture(roles); const tree = f.render(); expect(f.submit(tree).props.disabled).toBe(true);
    const selects = f.nodes(tree, node => node.type === "select"); expect(selects).toHaveLength(roles.length);
    expect(selects.every(node => node.props.required)).toBe(true); expect(renderToStaticMarkup(tree)).toContain(ar.purchaseOrders.reviewRoleLabel);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("selects a route per item and preserves the exact original need, ticket and item identities", () => {
    const f = fixture([undefined, undefined]); let tree = f.render();
    f.nodes(tree, node => node.type === "select").forEach((node, index) => node.props.onChange({ target: { value: review.PURCHASE_REVIEW_ROLES[index] } }));
    tree = f.render(); expect(f.submit(tree).props.disabled).toBe(false); f.submit(tree).props.onClick();
    expect(f.create).toHaveBeenCalledWith(expect.objectContaining({ ticketId: 55, ticketItemId: 66, itPurchaseNeedId: 88,
      items: [expect.objectContaining({ itemName: "IT 0", quantity: 1, reviewRole: review.PURCHASE_REVIEW_ROLES[0] }), expect.objectContaining({ itemName: "IT 1", quantity: 2, reviewRole: review.PURCHASE_REVIEW_ROLES[1] })] }));
  });
  it("does not turn review-role selection into permission for another actor to create the IT request", () => {
    const f = fixture(["general_maintenance_manager"], APP_ROLE.IT_MEMBER); const tree = f.render();
    expect(f.nodes(tree, node => node.type === "select")[0].props.disabled).toBe(true);
    expect(f.submit(tree)).toBeUndefined(); expect(f.create).not.toHaveBeenCalled();
  });
});
