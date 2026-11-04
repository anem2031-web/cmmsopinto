// Production review panel JSX with explicit fixtures; no app, API, environment or database.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import puppeteer from "puppeteer-core";
const require = createRequire(import.meta.url), root = process.cwd(), cache = new Map();
function load(file) {
  file = path.resolve(root, file);
  if (!file.startsWith(root + path.sep) || !/[\\/](client|shared)[\\/]/.test(file)) throw Error("Preview import outside client/shared");
  if (cache.has(file)) return cache.get(file).exports;
  const module = { exports: {} }; cache.set(file, module);
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  vm.runInNewContext(code, { React, module, exports: module.exports, console, require(id) {
    if (id.startsWith("@/") || id.startsWith("@shared/") || id.startsWith(".")) {
      const base = id.startsWith("@/") ? path.join(root, "client/src", id.slice(2)) : id.startsWith("@shared/") ? path.join(root, "shared", id.slice(8)) : path.resolve(path.dirname(file), id);
      const target = [base, base + ".tsx", base + ".ts"].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
      if (!target) throw Error(`Missing preview dependency: ${id}`);
      return load(target);
    }
    return require(id);
  } }, { filename: file });
  return module.exports;
}
const source = fs.readFileSync("client/src/pages/purchase/PurchaseOrderDetail.tsx", "utf8"), ast = ts.createSourceFile("Detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let panel;
function find(node) {
  if (ts.isJsxExpression(node) && node.expression?.getText(ast).startsWith("(hasRoutedReview ? reviewableItems.length")) panel = node.expression.getText(ast);
  ts.forEachChild(node, find);
}
find(ast); if (!panel) throw Error("Review panel not found");
const ui = { ...load("client/src/components/ui/card.tsx"), ...load("client/src/components/ui/button.tsx"), ...load("client/src/components/ui/select.tsx"), ...load("client/src/components/ui/label.tsx"), ...load("client/src/components/ui/input.tsx"), ...require("lucide-react") };
Object.assign(ui, load("client/src/components/ui/textarea.tsx"));
const listSource = fs.readFileSync("client/src/pages/purchase/PurchaseOrders.tsx", "utf8"), listAst = ts.createSourceFile("List.tsx", listSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const approvalSource = fs.readFileSync("client/src/components/purchase/UnifiedBundleApproval.tsx", "utf8"), approvalAst = ts.createSourceFile("Approval.tsx", approvalSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let stageNav, approvalPanel;
function sections(node, ast, kind) {
  if (ts.isJsxElement(node) && kind === "nav" && node.openingElement.getText(ast).includes('aria-label={t.purchaseOrders.reviewStages}')) stageNav = node.getText(ast);
  if (ts.isJsxElement(node) && kind === "approval" && node.openingElement.getText(ast) === '<section className="space-y-4">') approvalPanel = node.getText(ast);
  ts.forEachChild(node, child => sections(child, ast, kind));
}
sections(listAst, listAst, "nav"); sections(approvalAst, approvalAst, "approval");
function expression(code, scope) { return vm.runInNewContext(ts.transpileModule(`(${code})`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText, scope); }
const data = { id: 1, reviewRole: "general_maintenance_manager", status: "pending_review", itemName: "Maintenance materials — مواد صيانة", quantity: 2, unit: "قطعة" };
const reviewableItems = [data, { ...data, id: 2, itemName: "صنف آخر للمراجعة لاحقًا" }];
const assets = path.join(root, "dist/public/assets"), css = fs.readFileSync(path.join(assets, fs.readdirSync(assets).find(name => /^index-.*\.css$/.test(name))), "utf8");
const out = path.join(root, "tmp/purchase-item-review/ui"); fs.mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox", "--disable-background-networking", "--disable-sync", "--no-first-run"] });
try {
  const page = await browser.newPage(); await page.setRequestInterception(true); page.on("request", r => r.abort());
  for (const language of ["ar", "en", "ur"]) {
    const t = load(`client/src/i18n/${language}.ts`).default;
    const scope = { React, ...ui, t, isManager: false, po: { id: 10, status: "pending_accounting" }, hasRoutedReview: true, reviewableItems, selectedReviewItems: [data], selectedReviewItemIds: [1], reviewDecisions: { 1: { action: "approve", delegateId: 20 } }, bulkDelegateId: undefined, users: [{ id: 20, name: "المندوب", role: "delegate" }], reviewItemsMut: { isPending: false, mutate: () => {} }, getField: (i, key) => i[key], displayUnit: v => v, setBulkDelegateId: () => {}, handleBulkAssignDelegate: () => {}, handleBulkApprove: () => {}, setReviewDecisions: () => {}, setSelectedReviewItemIds: () => {} };
    const code = ts.transpileModule(`(${panel})`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
    const markup = renderToStaticMarkup(vm.runInNewContext(code, scope));
    const html = `<!doctype html><html lang="${language}" dir="${language === "en" ? "ltr" : "rtl"}"><head><meta charset="utf-8"><style>${css}</style><style>html{direction:${language === "en" ? "ltr" : "rtl"}}*{transition:none!important;animation:none!important}</style></head><body><main class="max-w-4xl mx-auto p-4">${markup}</main></body></html>`;
    fs.writeFileSync(path.join(out, `${language}.html`), html);
    for (const width of [390, 1280]) {
      await page.setViewport({ width, height: 900 }); await page.setContent(html);
      const layout = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, selects: document.querySelectorAll('[role="combobox"]').length, checkboxes: document.querySelectorAll('input[type="checkbox"]').length }));
      if (layout.overflow || layout.checkboxes !== 2 || layout.selects !== 2) throw Error(JSON.stringify({ language, width, layout }));
      await page.screenshot({ path: path.join(out, `${language}-${width}.png`), captureBeyondViewport: false });
      console.log(JSON.stringify({ language, width, ...layout, pass: true }));
    }
    for (const stage of ["review", "accounting", "management"]) {
      const nav = expression(stageNav, { React, ...ui, t, seniorActionTab: stage, seniorActionCounts: { review: 2, accounting: 1, management: 1 }, setSeniorActionTab: () => {} });
      const approval = stage === "review" ? vm.runInNewContext(code, scope) : expression(approvalPanel, { React, ...ui, t,
        Link: ({ children }) => React.createElement("span", {}, children), selectedOnly: true, busy: false, setLocation: () => {}, returnTo: "/purchase-orders", isSeniorReviewRole: true, requestedStage: stage, stageMatches: true, pendingFollowup: false, detail: {},
        data: { id: 24, bundleNumber: "DPB-2026-000024", delegateName: "المندوب", status: `pending_${stage}`, custodyBalance: stage === "management" ? "120" : null },
        displayedItems: [{ id: 1, itemName: "مواد الصيانة — Maintenance materials", purchaseOrderId: 10, poNumber: "PR-2026-0010", packageNumber: "PB-2026-0001", quantity: 2, unit: "قطعة", estimatedTotalCost: "100", currentStatus: "estimated" }], canApprove: true, reasons: {}, amount: "", notes: "", setAmount: () => {}, setNotes: () => {}, setReasons: () => {}, submit: () => {}, displayedTotal: 100, acceptedTotal: 100,
      });
      const content = renderToStaticMarkup(React.createElement("div", { className: "space-y-4" }, nav, approval));
      const stageHtml = html.replace(markup, content); fs.writeFileSync(path.join(out, `${language}-${stage}.html`), stageHtml);
      for (const width of [390, 1280]) {
        await page.setViewport({ width, height: 1100 }); await page.setContent(stageHtml);
        const controls = await page.evaluate(() => ({ count: document.querySelectorAll('[data-review-stage]').length, selected: document.querySelector('[data-review-stage][aria-pressed="true"]')?.getAttribute("data-review-stage"), overflow: document.documentElement.scrollWidth > innerWidth }));
        if (controls.count !== 3 || controls.selected !== stage || controls.overflow) throw Error(JSON.stringify({ language, stage, width, controls }));
        await page.screenshot({ path: path.join(out, `${language}-${stage}-${width}.png`), captureBeyondViewport: false });
        console.log(JSON.stringify({ language, stage, width, ...controls, pass: true }));
      }
    }
  }
} finally { await browser.close(); }
