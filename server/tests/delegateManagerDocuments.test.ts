import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { APP_ROLE, isDelegateRole } from "../../shared/roles";
import { protectedProcedure, router } from "../_core/trpc";

function evaluate(expression: string, context: object) {
  return vm.runInNewContext(ts.transpileModule(`(${expression})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
}
const rows = [
  { id: 1, delegateId: 7, fileKey: "own-one" },
  { id: 2, delegateId: 8, fileKey: "foreign" },
  { id: 3, delegateId: 7, fileKey: "own-two" },
];
const enrich = vi.fn(async (_user: unknown, values: unknown[]) => values);
const page = vi.fn(async (_kind: unknown, _input: unknown, own: number | undefined) => ({ rows: rows.filter(row => own == null || row.delegateId === own), total: 2 }));
const source = ts.createSourceFile("attachments.router.ts", readFileSync("server/routers/uploads/attachments.router.ts", "utf8"), ts.ScriptTarget.Latest, true);
const declaration = source.statements.flatMap(node => ts.isVariableStatement(node) ? [...node.declarationList.declarations] : [])
  .find(node => node.name.getText(source) === "attachmentsRouter")!;
const object = (declaration.initializer as ts.CallExpression).arguments[0] as ts.ObjectLiteralExpression;
const property = object.properties.find(node => ts.isPropertyAssignment(node) && node.name.getText(source) === "listByType") as ts.PropertyAssignment;
const api = router({ attachments: router({ listByType: evaluate(property.initializer.getText(source), {
  z, TRPCError, APP_ROLE, isDelegateRole, protectedProcedure,
  documentListPageInput: z.object({ page: z.number() }), documentRows: enrich,
  getAttachmentDocumentPage: page,
  db: { getDelegatePricingAttachmentsWithDelegate: async () => rows, getFinancialBatchAttachmentsWithDelegate: async () => rows },
}) }) });
const caller = (role: string, id = 7) => api.createCaller({ user: { id, role, isActive: 1 } } as any);
beforeEach(() => vi.clearAllMocks());

describe("Delegate-manager document scope equals delegate scope", () => {
  it.each(["delegate", "delegate_manager"])("enriches only the own archived documents for %s", async role => {
    const result = await caller(role).attachments.listByType({ entityType: "delegate_pricing_documents" });
    expect(result.map((row: any) => row.id)).toEqual([1, 3]);
    expect(enrich).toHaveBeenCalledOnce();
    expect(JSON.stringify(enrich.mock.calls)).not.toContain("foreign");
  });
  it.each(["delegate", "delegate_manager"])("filters in SQL before paginated enrichment for %s", async role => {
    await caller(role).attachments.listByType({ entityType: "delegate_pricing_documents", pagination: { page: 1 } });
    expect(page).toHaveBeenCalledWith("delegate_pricing_documents", { page: 1 }, 7);
    expect(enrich).toHaveBeenCalledOnce();
    expect(JSON.stringify(enrich.mock.calls)).not.toContain("foreign");
  });
  it("does not carry assignment scope between consecutive actors", async () => {
    const first = await caller("delegate_manager").attachments.listByType({ entityType: "delegate_pricing_documents" });
    const second = await caller("delegate_manager", 8).attachments.listByType({ entityType: "delegate_pricing_documents" });
    expect(first.map((row: any) => row.id)).toEqual([1, 3]);
    expect(second.map((row: any) => row.id)).toEqual([2]);
  });
  it("does not grant the new role access to financial attachment lists", async () => {
    await expect(caller("delegate_manager").attachments.listByType({ entityType: "po_financial_batch" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(enrich).not.toHaveBeenCalled();
  });
  it.each(["admin", "owner", "accountant", "senior_management"])("keeps the previous %s document list", async role => {
    expect(await caller(role).attachments.listByType({ entityType: "delegate_pricing_documents" })).toHaveLength(3);
  });
});

async function financialDocument(role: string) {
  let html = "";
  const file = ts.createSourceFile("exportService.ts", readFileSync("server/services/export/exportService.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const fn = file.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "generatePurchaseRequestPDF")!;
  const item = { id: 51, purchaseOrderId: 42, itemName: "مادة مرتبطة بالطلب", quantity: 1, unit: "قطعة", delegateId: 7, status: "estimated", estimatedUnitCost: "120", estimatedTotalCost: "120" };
  const reads = { getPurchaseOrderById: async () => ({ id: 42, poNumber: "PR-MANAGER" }), getPOItems: async () => [item], getUserById: async () => ({ id: 7, role, name: "المسئول" }) };
  const render = evaluate(fn.getText(file).replace(/^export /, ""), {
    db: new Proxy(reads, { get: (object, key: keyof typeof reads) => key in object ? object[key] : () => { throw Error(`Unexpected database read: ${String(key)}`); } }),
    getSignatureDataUrl: async () => "", readAccountingSignature: () => null,
    escapeHtml: (value: unknown) => String(value ?? ""), fmtSAR: (value: number) => value.toFixed(2), amountToArabicCurrencyPhrase: String,
    htmlToPdf: async (value: string) => { html = value; return Buffer.from("%PDF-test"); },
  });
  await render(42, 7);
  return html;
}
describe("Existing custody document variant for the new delegate role", () => {
  it("renders the same delegate document without internal financial sections", async () => {
    const ordinary = await financialDocument("delegate"), manager = await financialDocument("delegate_manager");
    expect(manager).toBe(ordinary);
    expect(manager).toContain("مادة مرتبطة بالطلب");
    expect(manager).not.toContain("الشؤون المالية والإجراءات المحاسبية");
    expect(manager).not.toContain('>الحسابات</td>');
  });
  it("keeps the existing accountant document variant", async () => {
    expect(await financialDocument("accountant")).toContain("الشؤون المالية والإجراءات المحاسبية");
  });
});

describe("Existing official package-document restriction", () => {
  const file = ts.createSourceFile("index.ts", readFileSync("server/_core/index.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let condition: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(file) === "mustUsePackageOfficialDocument") condition = node.initializer?.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  it.each([
    ["delegate", true], ["delegate_manager", true], ["accountant", true],
    ["admin", false], ["owner", false], ["senior_management", false],
  ])("keeps official submission-document selection for %s", (role, expected) => {
    if (!condition) throw Error("Missing production official-document restriction");
    expect(evaluate(condition, { user: { role } })).toBe(expected);
  });
});
