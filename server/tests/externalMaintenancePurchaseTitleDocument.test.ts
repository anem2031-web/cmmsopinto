import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";

/** Runs the production financial document renderer with immutable input only.
 * No application DB, environment, browser, or PDF process is loaded. */
function harness(title: string) {
  let html = "";
  const path = "server/services/export/exportService.ts";
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "generatePurchaseRequestPDF")!;
  const code = ts.transpileModule(`(${fn.getText(source).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const item = { id: 51, purchaseOrderId: 42, poNumber: "PR-EXTERNAL", itemName: title, description: "حالة الأصل قبل الخروج",
    quantity: 1, unit: "خدمة", delegateId: 7, status: "estimated", estimatedUnitCost: "120", estimatedTotalCost: "120" };
  const reads = { getPurchaseOrderById: vi.fn(async () => ({ id: 42, poNumber: "PR-EXTERNAL" })),
    getPOItems: vi.fn(async () => [item]), getUserById: vi.fn(async () => ({ id: 7, role: "delegate", name: "المندوب" })) };
  const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  const render = vm.runInNewContext(code, { db: new Proxy(reads, { get: (object, key: keyof typeof reads) => key in object ? object[key] : () => { throw Error(`Unexpected database call: ${String(key)}`); } }),
    getSignatureDataUrl: async () => "", readAccountingSignature: () => null, escapeHtml,
    fmtSAR: (value: number) => value.toFixed(2), amountToArabicCurrencyPhrase: String,
    htmlToPdf: async (value: string) => { html = value; return Buffer.from("%PDF-test"); } });
  return { render, html: () => html, item, reads, escapeHtml };
}

describe("External maintenance title reaches the existing financial material column unchanged", () => {
  it.each(["إصلاح مضخة الحديقة واستبدال مانع التسرب", "Epson L6270 printer repair", "فحص وضبط <لوحة> & تمديدات"])('preserves warehouse title "%s" in the ordinary custody request', async title => {
    const h = harness(title), before = JSON.stringify(h.item);
    await h.render(42, 7);
    const table = h.html().slice(h.html().indexOf('<table class="items-table">'), h.html().indexOf('<div class="declaration-box">'));
    expect(table).toContain("المادة المطلوبة");
    expect(table).toContain(h.escapeHtml(title));
    expect(table).not.toContain("صيانة خارجية:");
    expect(table).not.toContain("حالة الأصل قبل الخروج");
    expect(JSON.stringify(h.item)).toBe(before);
  });

  it.each([false, true])("preserves the same title in the %s approved grouped document without editing its template", async approved => {
    const title = "إصلاح أصل تجريبي — عنوان المستودع", h = harness(title);
    const snapshot = { number: "DPB-TITLE-TEST", submittedAt: "2026-11-04T08:00:00Z", delegate: { id: 7, name: "مندوب", signature: "" },
      signatures: [], rows: [h.item], ...(approved ? { financialApprovals: [{ reference: "DPB-TITLE-TEST", poNumbers: ["PR-EXTERNAL"],
        accountingName: "محاسب", accountingAt: "2026-11-04T09:00:00Z", accountingSignature: "", custodyBalance: "0",
        managementName: "إدارة", managementAt: "2026-11-04T10:00:00Z", managementSignature: "", notes: "" }] } : {}) };
    const before = JSON.stringify(snapshot);
    await h.render(0, 7, undefined, undefined, snapshot);
    expect(h.html()).toContain(h.escapeHtml(title)); expect(h.html()).not.toContain("صيانة خارجية:");
    expect(h.reads.getPurchaseOrderById).not.toHaveBeenCalled(); expect(h.reads.getPOItems).not.toHaveBeenCalled();
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
