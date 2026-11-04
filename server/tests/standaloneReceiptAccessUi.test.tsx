import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { APP_ROLE, canRoleAccessPath } from "../../shared/roles";
import { isOwnerOrAdminRole } from "../../shared/restricted-module-policy";

const state = vi.hoisted(() => ({ authenticatedUser: null as any, user: null as any, loading: false, initialized: [] as string[] }));
vi.mock("../../client/src/_core/hooks/useAuth", () => ({ useAuth: () => ({
  authenticatedUser: state.authenticatedUser, user: state.user, loading: state.loading,
}) }));
vi.mock("wouter", () => ({ useLocation: () => { state.initialized.push("form.location"); return ["/inventory/receive", vi.fn()]; } }));
vi.mock("../../client/src/lib/trpc", () => {
  const mutation = (name: string) => ({ useMutation: () => {
    state.initialized.push(name); return { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false };
  } });
  return { trpc: {
    warehouseReceiptsV2: {
      analyzeInvoice: mutation("analyzeInvoice"), receiveStandaloneV2: mutation("receiveStandaloneV2"),
      generateItemBarcodes: mutation("generateItemBarcodes"),
      findSimilarItems: { useQuery: () => { state.initialized.push("findSimilarItems"); return { data: [] }; } },
    },
    warehouseReceipts: { incrementPrint: mutation("incrementPrint") },
    useUtils: () => { state.initialized.push("form.utils"); return {}; },
  } };
});
vi.mock("../../client/src/components/common/DropZone", () => ({ default: ({ label }: { label: string }) => <div data-testid="receipt-upload">{label}</div> }));
vi.mock("../../client/src/components/inventory/ReceiptConversionFields", () => ({ ReceiptConversionFields: () => <div /> }));
vi.mock("../../client/src/lib/printInventoryLabels", () => ({ printInventoryLabels: vi.fn() }));
vi.mock("../../client/src/lib/printReceiptDocument", () => ({ printReceiptDocument: vi.fn() }));
vi.mock("qrcode", () => ({ default: { toCanvas: vi.fn() } }));

import InventoryStandaloneReceive from "../../client/src/pages/inventory/InventoryStandaloneReceive";

beforeEach(() => {
  state.authenticatedUser = null; state.user = null; state.loading = false; state.initialized = [];
});
const actualUser = (role: any, isActive: any = 1) => ({ id: 15, role, isActive });
const allowed = (role: any) => role === "owner" || role === "admin";
const roles = [...Object.values(APP_ROLE), "unknown-role", "", null, undefined];

describe("Independent invoice receipt page uses active authenticated identity", () => {
  it.each(roles)("%s mounts the form only with an active actual owner/admin identity", role => {
    state.authenticatedUser = actualUser(role);
    state.user = state.authenticatedUser;
    const html = renderToStaticMarkup(<InventoryStandaloneReceive />);
    if (allowed(role)) {
      expect(html).toContain("استلام فاتورة مستقلة");
      expect(html).toContain("إدخال يدوي بدون تحليل");
      expect(html).toContain("ارفع صورة الفاتورة أو PDF");
      expect(state.initialized).toEqual(["form.location", "analyzeInvoice", "form.utils", "incrementPrint", "receiveStandaloneV2", "generateItemBarcodes"]);
    } else {
      expect(html).toContain("استلام فاتورة مستقلة متاح للأدمن والمالك فقط");
      expect(html).toContain('role="alert"');
      expect(html).not.toContain("receipt-upload");
      expect(state.initialized).toHaveLength(0);
    }
  });

  it.each(["owner", "admin"])("does not initialize %s form hooks while identity is loading", role => {
    state.authenticatedUser = actualUser(role); state.user = state.authenticatedUser; state.loading = true;
    expect(renderToStaticMarkup(<InventoryStandaloneReceive />)).toContain("جارٍ تحميل الحساب");
    expect(state.initialized).toHaveLength(0);
  });

  it.each([0, false, null, undefined, "0"])("denies inactive/unverified admin state %s before form initialization", isActive => {
    state.authenticatedUser = { id: 15, role: "admin", isActive };
    state.user = actualUser("admin");
    expect(renderToStaticMarkup(<InventoryStandaloneReceive />)).toContain('role="alert"');
    expect(state.initialized).toHaveLength(0);
  });

  it.each(["observer", "warehouse", "senior_management", null])("cannot use displayed admin projection for actual %s", role => {
    state.authenticatedUser = role == null ? null : actualUser(role); state.user = actualUser("admin");
    expect(renderToStaticMarkup(<InventoryStandaloneReceive />)).toContain('role="alert"');
    expect(state.initialized).toHaveLength(0);
  });

  it("allows actual owner despite a different displayed role and reevaluates independent requests", () => {
    state.authenticatedUser = actualUser("owner"); state.user = actualUser("warehouse");
    expect(renderToStaticMarkup(<InventoryStandaloneReceive />)).toContain("إدخال يدوي بدون تحليل");
    state.initialized = []; state.authenticatedUser = actualUser("warehouse"); state.user = actualUser("admin");
    expect(renderToStaticMarkup(<InventoryStandaloneReceive />)).toContain('role="alert"');
    expect(state.initialized).toHaveLength(0);
    state.authenticatedUser = actualUser("admin");
    expect(renderToStaticMarkup(<InventoryStandaloneReceive />)).toContain("إدخال يدوي بدون تحليل");
    expect(state.initialized).toContain("receiveStandaloneV2");
  });
});

describe("Direct independent-receipt path permissions", () => {
  it.each(roles)("restricts direct URL/query/hash/trailing slash for %s", role => {
    for (const path of ["/inventory/receive", "/inventory/receive?mode=manual", "/inventory/receive#upload", "/inventory/receive/", "/inventory/receive/?mode=manual#upload"])
      expect(canRoleAccessPath(role, path), `${String(role)} ${path}`).toBe(allowed(role));
  });

  it("retains warehouse access to ordinary inventory and purchase-order receipt pages", () => {
    expect(canRoleAccessPath("warehouse", "/inventory")).toBe(true);
    expect(canRoleAccessPath("warehouse", "/warehouse/receive-v2?purchaseOrderId=5")).toBe(true);
    expect(canRoleAccessPath("warehouse", "/scheduled-maintenance/warehouse-requests?source=tickets")).toBe(true);
  });
});

// Execute the actual Inventory JSX condition instead of importing its many
// unrelated stock writers, lot pickers and export dialogs into this gate test.
function inventoryAddButton() {
  const source = ts.createSourceFile("Inventory.tsx", readFileSync("client/src/pages/inventory/Inventory.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let condition = "", click = "";
  const visit = (node: ts.Node) => {
    if (ts.isJsxExpression(node) && node.expression && ts.isBinaryExpression(node.expression)
      && node.expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
      && node.expression.right.getText(source).includes('navigate("/inventory/receive")')) {
      condition = node.expression.left.getText(source);
      const findClick = (child: ts.Node) => {
        if (ts.isJsxAttribute(child) && child.name.getText(source) === "onClick" && child.initializer && ts.isJsxExpression(child.initializer) && child.initializer.expression)
          click = child.initializer.expression.getText(source);
        ts.forEachChild(child, findClick);
      };
      findClick(node.expression.right);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  expect(condition).not.toBe(""); expect(click).not.toBe("");
  return {
    shown: (authenticatedUser: any, user: any) => vm.runInNewContext(condition, { authenticatedUser, user, isOwnerOrAdminRole, Number }),
    click: (navigate: any) => vm.runInNewContext(`(${click})`, { navigate })(),
  };
}

describe("Inventory add-button gate", () => {
  const button = inventoryAddButton();
  it.each(roles)("uses actual active identity for %s regardless of a displayed admin role", role => {
    expect(button.shown(actualUser(role), actualUser("admin"))).toBe(allowed(role));
    expect(button.shown(actualUser(role, 0), actualUser("admin"))).toBe(false);
  });
  it("hides the button with no authenticated identity even if the displayed user is owner", () => {
    expect(button.shown(null, actualUser("owner"))).toBe(false);
    expect(button.shown(undefined, actualUser("admin"))).toBe(false);
  });
  it("preserves navigation to the independent receipt page", () => {
    const navigate = vi.fn(); button.click(navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/inventory/receive");
  });
});
