import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";
import { appendInventoryBookSheet } from "../services/export/inventoryBookExcel";
import { inventoryBookExportFilterSchema } from "../../shared/inventory-export";
import { businessHttpAllowed } from "../../shared/business-role-policy";

const serviceFile = "server/services/export/exportService.ts";
const service = ts.createSourceFile(serviceFile, readFileSync(serviceFile, "utf8"), ts.ScriptTarget.Latest, true);
const index = ts.createSourceFile("index.ts", readFileSync("server/_core/index.ts", "utf8"), ts.ScriptTarget.Latest, true);
function snippet(ast: ts.SourceFile, name: string) {
  let text = "";
  function find(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) text = node.getText(ast).replace(/^export\s+/, "");
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) text = node.initializer.getText(ast);
    ts.forEachChild(node, find);
  } find(ast); if (!text) throw Error(`Missing production function ${name}`); return text;
}
function evaluate(text: string, scope: any) {
  return vm.runInNewContext(ts.transpileModule(`(${text})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, scope);
}
const book = (id: number, totals: any[] = [{ unit: "قطعة", quantity: 5, incoming: 9, outgoing: 4, isFrozen: 0 }]) => ({ id, code: `CAT-${id}`, nameAr: `صنف ${id}`, unit: "قطعة", pageCount: 3, totals });
const filters = { warehouseId: 7, search: "مسمى قديم", includeZero: false, nodeIds: [11, 12], sort: "name" as const, dateFrom: "2026-10-01", dateTo: "2026-11-03" };
async function xlsx(buffer: Buffer) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as any); return workbook; }
function exportFixture(books = [book(1)], legacy: any[] = []) {
  const calls: any[] = [];
  const db = {
    getDb: vi.fn(async () => ({ execute: () => { throw Error("Unexpected SQL in injected export fixture"); } })),
    getWarehouseById: vi.fn(async () => ({ id: 7, type: "main" })),
    getInventoryItems: vi.fn(async () => legacy),
    getInventoryCatalogTaxonomy: vi.fn(async () => []),
  };
  const readInventoryBooks = vi.fn(async (_db: any, input: any) => {
    calls.push(input); const page = books.slice(input.afterId, input.afterId + input.limit);
    return { books: page, nextId: input.afterId + page.length < books.length ? input.afterId + page.length : null };
  });
  const code = snippet(service, "exportInventoryToExcel")
    .replace('import("../../_core/inventory-lots")', "Promise.resolve(fixtureFeatureModule)")
    .replace('import("../../routers/inventory/books.procedure")', "Promise.resolve(fixtureBookModule)");
  const scope = { db, ExcelJS, Buffer, appendInventoryBookSheet, readInventoryBooks, isInventoryLotsEnabled: () => true,
    fixtureFeatureModule: { isInventoryLotsEnabled: (): boolean => scope.isInventoryLotsEnabled() }, fixtureBookModule: { readInventoryBooks },
    styleHeader: evaluate(snippet(service, "styleHeader"), {}), addRtlSupport: evaluate(snippet(service, "addRtlSupport"), {}) };
  return { db, calls, scope, run: (options?: any) => evaluate(code, scope)(options) };
}

describe("Warehouse book Excel export, using the production export function", () => {
  it("exports books even with no legacy IDs, numeric quantities and RTL/frozen/filter formatting", async () => {
    const f = exportFixture(); const result = await xlsx(await f.run({ itemIds: [], bookFilters: filters }));
    expect(result.worksheets.map(sheet => sheet.name)).toEqual(["المخزون"]);
    const sheet = result.worksheets[0];
    expect(sheet.getRow(2).values).toEqual([undefined, "صنف 1", "CAT-1", 5, "قطعة", 9, 4, 3]);
    expect(sheet.views[0]).toMatchObject({ rightToLeft: true, state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBe("A1:G1");
    expect(f.calls).toEqual([{ ...filters, afterId: 0, limit: 50 }]);
    expect(f.db.getInventoryItems).not.toHaveBeenCalled();
  });
  it("exports every matching page in the same order with bounded reads, not one query per row", async () => {
    const f = exportFixture(Array.from({ length: 121 }, (_, i) => book(200 - i)));
    const result = await xlsx(await f.run({ itemIds: [], bookFilters: filters }));
    const sheet = result.worksheets[0]; expect(sheet.rowCount).toBe(122);
    expect([sheet.getCell("B2").value, sheet.getCell("B122").value]).toEqual(["CAT-200", "CAT-80"]);
    expect(f.calls.map(call => call.afterId)).toEqual([0, 50, 100]);
    expect(f.calls.every(call => call.warehouseId === 7 && call.search === filters.search && call.nodeIds.join() === "11,12")).toBe(true);
  });
  it("keeps unit families and frozen historical totals on separate labeled rows", async () => {
    const f = exportFixture([book(1, [
      { unit: "حبة", quantity: "7", incoming: "9", outgoing: "2", isFrozen: 0 },
      { unit: "كجم", quantity: "0", incoming: "50", outgoing: "50", isFrozen: 1 },
    ])]);
    const sheet = (await xlsx(await f.run({ bookFilters: filters }))).worksheets[0];
    expect(sheet.getRow(2).values).toEqual([undefined, "صنف 1", "CAT-1", 7, "حبة", 9, 2, 3]);
    expect(sheet.getRow(3).values).toEqual([undefined, "صنف 1", "CAT-1", 0, "كجم — تاريخ مجمّد", 50, 50, 3]);
  });
  it("includes selected legacy records separately without duplicating linked pages or another warehouse", async () => {
    const f = exportFixture([book(1)], [
      { id: 2, warehouseId: 7, linkedItemId: 1, itemName: "already in book", quantity: 5 },
      { id: 3, warehouseId: null, itemName: "old main", quantity: 2, unit: "علبة" },
      { id: 4, warehouseId: 7, itemName: "unlinked", quantity: 1, unit: "قطعة" },
      { id: 5, warehouseId: 8, itemName: "foreign warehouse", quantity: 100 },
      { id: 6, warehouseId: 7, itemName: "zero", quantity: 0 },
    ]);
    const result = await xlsx(await f.run({ itemIds: [4, 2, 3, 5, 6], bookFilters: filters }));
    expect(result.worksheets.map(sheet => sheet.name)).toEqual(["المخزون", "سجلات غير مرتبطة"]);
    const sheet = result.worksheets[1]; expect(sheet.rowCount).toBe(3);
    expect([sheet.getCell("A2").value, sheet.getCell("A3").value]).toEqual(["unlinked", "old main"]);
    f.db.getWarehouseById.mockResolvedValueOnce({ id: 7, type: "branch" });
    expect((await xlsx(await f.run({ itemIds: [3, 4], bookFilters: filters }))).worksheets[1].rowCount).toBe(2);
  });
  it("preserves legacy-only format and selected order when book mode is off", async () => {
    const f = exportFixture([], [{ id: 2, itemName: "Second", quantity: 1, unit: "قطعة" }, { id: 3, itemName: "First", quantity: 7, unit: "كيس" }]);
    const result = await xlsx(await f.run({ itemIds: [3, 2] }));
    expect(result.worksheets).toHaveLength(1); expect(result.worksheets[0].columnCount).toBe(8);
    expect([result.worksheets[0].getCell("A2").value, result.worksheets[0].getCell("A3").value]).toEqual(["First", "Second"]);
    expect(f.db.getDb).not.toHaveBeenCalled(); expect(f.calls).toEqual([]);
  });
  it("keeps an empty result empty and refuses disabled books, missing warehouse and infrastructure errors", async () => {
    const f = exportFixture([]);
    expect((await xlsx(await f.run({ itemIds: [], bookFilters: filters }))).worksheets[0].rowCount).toBe(1);
    f.scope.isInventoryLotsEnabled = () => false;
    await expect(f.run({ itemIds: [], bookFilters: filters })).rejects.toThrow("غير مفعّلة");
    f.scope.isInventoryLotsEnabled = () => true;
    f.db.getWarehouseById.mockResolvedValueOnce(null as any);
    await expect(f.run({ itemIds: [], bookFilters: filters })).rejects.toThrow("غير موجود");
    f.db.getDb.mockRejectedValueOnce(Error("database offline"));
    await expect(f.run({ itemIds: [], bookFilters: filters })).rejects.toThrow("database offline");
  });
  it("refuses an overlapping/changing page or a failed later page instead of downloading partial results", async () => {
    const workbook = new ExcelJS.Workbook();
    await expect(appendInventoryBookSheet(workbook, filters, async input => ({ books: [book(1)], nextId: input.afterId ? null : 50 }))).rejects.toThrow("تغير ترتيب");
    await expect(appendInventoryBookSheet(new ExcelJS.Workbook(), filters, async input => {
      if (input.afterId) throw Error("later page failed"); return { books: [book(1)], nextId: 50 };
    })).rejects.toThrow("later page failed");
  });
});

describe("Actual inventory HTTP export boundary", () => {
  const make = snippet(index, "makeRequireExportRole"), handler = snippet(index, "handleInventoryExport");
  const allowed = evaluate(snippet(index, "INVENTORY_EXPORT_ALLOWED_ROLES"), {});
  const exported = vi.fn(async () => Buffer.from("xlsx"));
  async function request(user: any, body: any) {
    const res: any = { statusCode: 200, status(code: number) { this.statusCode = code; return this; }, json: vi.fn(), send: vi.fn(), setHeader: vi.fn() };
    const req: any = { method: "POST", path: "/api/export/inventory", body };
    const scope = { sdk: { authenticateRequest: async () => user }, businessHttpAllowed, isSessionAuthenticationError: () => false, console,
      inventoryBookExportFilterSchema, exportInventoryToExcel: exported };
    const guard = evaluate(make, scope)(allowed), run = evaluate(handler, scope); let running: Promise<void> | undefined;
    await guard(req, res, () => { running = run(req, res); }); await running; return res;
  }
  it.each(["owner", "admin", "warehouse", "accountant", "senior_management", "maintenance_manager", "supervisor"])("preserves %s export permission", async role => {
    exported.mockClear(); const res = await request({ id: 9, role, isActive: 1 }, { itemIds: [], bookFilters: filters });
    expect(res.statusCode).toBe(200); expect(exported).toHaveBeenCalledWith({ itemIds: [], bookFilters: filters });
  });
  it.each(["it_manager", "it_member", "observer", "technician", "delegate", "general_maintenance_manager", "food_warehouse_assistant"])("denies %s before loading export data", async role => {
    exported.mockClear(); const res = await request({ id: 9, role, isActive: 1 }, { itemIds: [], bookFilters: filters });
    expect(res.statusCode).toBe(403); expect(exported).not.toHaveBeenCalled();
  });
  it("freshly checks unauthenticated/disabled identities and rejects malformed filters without a data read", async () => {
    exported.mockClear(); expect((await request(null, {})).statusCode).toBe(401);
    expect((await request({ id: 9, role: "warehouse", isActive: 0 }, {})).statusCode).toBe(403);
    for (const bookFilters of [{ ...filters, warehouseId: -1 }, { ...filters, nodeIds: Array(501).fill(1) }, { ...filters, afterId: 50 }]) {
      expect((await request({ id: 9, role: "warehouse", isActive: 1 }, { itemIds: [], bookFilters })).statusCode).toBe(400);
    }
    expect(exported).not.toHaveBeenCalled();
    expect((await request({ id: 9, role: "warehouse", isActive: 1 }, { itemIds: [], bookFilters: filters })).statusCode).toBe(200);
  });
});

describe("Actual warehouse export button payload", () => {
  const file = "client/src/pages/inventory/Inventory.tsx";
  const ast = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let payload = "";
  function find(node: ts.Node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === "ExportButton") {
      const property = node.attributes.properties.find(p => ts.isJsxAttribute(p) && p.name.getText(ast) === "payload") as ts.JsxAttribute;
      payload = (property.initializer as ts.JsxExpression).expression!.getText(ast);
    }
    ts.forEachChild(node, find);
  } find(ast);
  const scope = { filteredItems: [{ id: 90 }, { id: 30 }], lotsEnabled: true, selectedWarehouseId: "7", searchQuery: filters.search,
    hideZeroStock: true, bookNodeIds: filters.nodeIds, sortBy: filters.sort, dateFrom: filters.dateFrom, dateTo: filters.dateTo };
  it("sends filters for all book results plus the full filtered legacy selection, not only the displayed page", () => {
    expect(evaluate(payload, scope)).toEqual({ itemIds: [90, 30], bookFilters: filters });
    expect(evaluate(payload, { ...scope, filteredItems: [] })).toEqual({ itemIds: [], bookFilters: filters });
    expect(evaluate(payload, { ...scope, hideZeroStock: false }).bookFilters.includeZero).toBe(true);
  });
  it("keeps the original legacy export contract when lots are off or no warehouse is selected", () => {
    expect(evaluate(payload, { ...scope, lotsEnabled: false })).toEqual({ itemIds: [90, 30] });
    expect(evaluate(payload, { ...scope, selectedWarehouseId: "" })).toEqual({ itemIds: [90, 30] });
  });
});
