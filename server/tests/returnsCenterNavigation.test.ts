import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { APP_ROLE, canRoleAccessPath } from "../../shared/roles";
import { businessPageAllowed, businessRpcAllowed, isBusinessGuardedRole } from "../../shared/business-role-policy";
import { canAccessReturnsCenter, canCreateReturn, getReturnsCenterPanels, RETURNS_CENTER_PATH, RETURNS_CENTER_SUPPLIER_ROLES, returnsCenterLink, warehouseReturnBackLink } from "../../shared/returns-center";

describe("Returns center navigation reuses existing source capabilities", () => {
  it.each(Object.values(APP_ROLE))("keeps %s in its existing return sources", role => {
    const panels = getReturnsCenterPanels(role);
    expect(canRoleAccessPath(role, `${RETURNS_CENTER_PATH}?tab=materials`)).toBe(canAccessReturnsCenter(role));
    expect(panels.includes("suppliers")).toBe((RETURNS_CENTER_SUPPLIER_ROLES as readonly string[]).includes(role));
    expect(panels.includes("materials")).toBe(["owner", "admin", "warehouse"].includes(role));
    expect(panels.includes("specifications")).toBe(["owner", "admin", "warehouse"].includes(role));
    expect(panels.includes("documents")).toBe(["owner", "admin", "warehouse", "senior_management"].includes(role));
    expect(canCreateReturn(role)).toBe(["owner", "admin", "warehouse"].includes(role));
    if (isBusinessGuardedRole(role)) {
      expect(businessPageAllowed(role, RETURNS_CENTER_PATH)).toBe(canAccessReturnsCenter(role));
      // A new page must not grant an API or a new return writer.
      expect(businessRpcAllowed({ id: 1, role, isActive: 1 }, "query", "returnsCenter.list")).toBe(false);
      expect(businessRpcAllowed({ id: 1, role, isActive: 1 }, "mutation", "returnsCenter.create")).toBe(false);
    }
  });
  it.each([undefined, null, "", "unknown_role"])("denies an unrecognized identity %s", role => {
    expect(getReturnsCenterPanels(role)).toEqual([]);
    expect(canAccessReturnsCenter(role)).toBe(false);
    expect(canRoleAccessPath(role, RETURNS_CENTER_PATH)).toBe(false);
  });
  it("keeps source pages and technician execution accessible exactly where they were", () => {
    expect(canRoleAccessPath("delegate", "/warehouse-returns-followup")).toBe(true);
    expect(canRoleAccessPath("warehouse", "/warehouse/return")).toBe(true);
    expect(canRoleAccessPath("senior_management", "/warehouse/returns")).toBe(true);
    expect(canRoleAccessPath("technician", "/scheduled-maintenance/my-tasks")).toBe(true);
    expect(canRoleAccessPath("observer", "/warehouse/returns")).toBe(true);
    expect(canAccessReturnsCenter("observer")).toBe(false);
    expect(canAccessReturnsCenter("technician")).toBe(false);
    expect(businessRpcAllowed({ id: 1, role: "accountant", isActive: 1 }, "query", "returnDocuments.list")).toBe(false);
  });
  it("returns from an explicitly center-opened wizard without an arbitrary redirect", () => {
    expect(warehouseReturnBackLink("")).toBe("/warehouse/returns");
    expect(warehouseReturnBackLink("?specificationId=7")).toBe("/warehouse/returns");
    expect(warehouseReturnBackLink("?returnTo=returns-center&returnTab=specifications&specificationId=7")).toBe(returnsCenterLink("specifications"));
    expect(warehouseReturnBackLink("?returnTo=returns-center&returnTab=documents")).toBe(returnsCenterLink("documents"));
    expect(warehouseReturnBackLink("?returnTo=https://example.invalid")).toBe("/warehouse/returns");
    expect(warehouseReturnBackLink("?returnTo=returns-center&returnTab=https://example.invalid")).toBe(returnsCenterLink());
    expect(returnsCenterLink("materials", "pmv2")).toBe("/returns-center?tab=materials&source=pmv2");
  });
  it("has one sidebar entry while preserving every legacy route", () => {
    const sidebar = ts.createSourceFile("Sidebar.tsx", readFileSync("client/src/components/layout/DashboardLayout.tsx", "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const paths: string[] = [];
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && node.name.getText(sidebar) === "path" && ts.isStringLiteral(node.initializer)) paths.push(node.initializer.text);
      ts.forEachChild(node, visit);
    }
    visit(sidebar);
    expect(paths.filter(path => path === RETURNS_CENTER_PATH)).toHaveLength(1);
    for (const old of ["/warehouse/return", "/warehouse/returns", "/warehouse-returns-followup"]) expect(paths).not.toContain(old);
    const app = readFileSync("client/src/App.tsx", "utf8");
    for (const path of [RETURNS_CENTER_PATH, "/warehouse/return", "/warehouse/returns", "/warehouse-returns-followup"]) expect(app).toContain(`path="${path}"`);
  });
});
