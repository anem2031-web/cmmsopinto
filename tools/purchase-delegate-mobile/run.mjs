import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transformSync } from "esbuild";
import { compile } from "@tailwindcss/node";
import ts from "typescript";
import puppeteer from "puppeteer-core";

// Real card JSX and UI primitives; explicit in-memory data only. Never load the
// CMMS app, environment, RPC modules, server code, credentials, or a database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputArg = process.argv.indexOf("--output");
assert(outputArg >= 0 && process.argv[outputArg + 1], "Supply --output <artifact-directory> outside the checkout");
const output = path.resolve(process.argv[outputArg + 1]);
assert(output !== root && !output.startsWith(root + path.sep), "Preview artifacts must be outside the checkout");
fs.mkdirSync(output, { recursive: true });
const require = createRequire(import.meta.url);
const libraryImports = new Set(["react", "react/jsx-runtime", "@radix-ui/react-slot", "class-variance-authority", "clsx", "tailwind-merge"]);
const pureFiles = new Set([
  "client/src/components/ui/card.tsx", "client/src/components/ui/button.tsx", "client/src/components/ui/badge.tsx",
  "client/src/lib/utils.ts", "client/src/lib/purchaseItemTiming.ts", "shared/purchaseItemNeedDate.ts",
]);
const loadedFiles = new Set(), modules = new Map();
function load(relative) {
  const absolute = path.resolve(root, relative), key = path.relative(root, absolute).replaceAll("\\", "/");
  assert(pureFiles.has(key) || key.startsWith("client/src/i18n/"), `Forbidden fixture import: ${key}`);
  if (modules.has(absolute)) return modules.get(absolute).exports;
  const module = { exports: {} };
  modules.set(absolute, module); loadedFiles.add(key);
  const code = transformSync(fs.readFileSync(absolute, "utf8"), {
    loader: absolute.endsWith("tsx") ? "tsx" : "ts", format: "cjs", jsx: "automatic", target: "es2022",
  }).code;
  vm.runInNewContext(code, { module, exports: module.exports, Intl, Date, require(id) {
    if (libraryImports.has(id)) return require(id);
    assert(id.startsWith("@/") || id.startsWith("."), `Forbidden package/API import: ${id}`);
    const base = id.startsWith("@/") ? path.join(root, "client/src", id.slice(2)) : path.resolve(path.dirname(absolute), id);
    const found = [base, base + ".tsx", base + ".ts"].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    assert(found, `Missing fixture dependency: ${id}`);
    return load(path.relative(root, found));
  } }, { filename: absolute });
  return module.exports;
}
function parse(relative) {
  const source = fs.readFileSync(path.join(root, relative), "utf8");
  return ts.createSourceFile(relative, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function findNodes(ast, predicate) {
  const result = [];
  function walk(node) { if (predicate(node)) result.push(node); ts.forEachChild(node, walk); }
  walk(ast); return result;
}
const orders = parse("client/src/pages/purchase/PurchaseOrders.tsx");
const cards = findNodes(orders, node => ts.isJsxElement(node) && node.openingElement.tagName.getText(orders) === "Card"
  && node.openingElement.getText(orders).includes("delegate-action-item:"));
assert.equal(cards.length, 1, "Expected exactly one actual delegate actionable card");
const cardSource = cards[0].getText(orders);
const oldClasses = [
  ["py-3 flex flex-col items-stretch justify-between gap-4 lg:flex-row lg:items-center lg:flex-wrap", "py-3 flex items-center justify-between gap-4 flex-wrap"],
  ["min-w-0 w-full lg:w-auto lg:flex-1", "min-w-0 flex-1"],
  ["flex flex-wrap items-center gap-2 w-full lg:w-auto lg:shrink-0", "flex items-center gap-2 shrink-0"],
];
let baselineSource = cardSource;
for (const [current, previous] of oldClasses) {
  assert.equal(baselineSource.split(`className="${current}"`).length, 2, `Expected one responsive class: ${current}`);
  baselineSource = baselineSource.replace(`className="${current}"`, `className="${previous}"`);
}
const managerAst = parse("client/src/components/purchase/DelegateManagerAssignment.tsx");
const predicate = findNodes(managerAst, node => ts.isFunctionDeclaration(node) && node.name?.text === "canManagerAssignOwnItem");
assert.equal(predicate.length, 1);
const rolesAst = parse("shared/roles.ts");
const roleValues = findNodes(rolesAst, node => ts.isPropertyAssignment(node) && node.name.getText(rolesAst) === "DELEGATE_MANAGER" && ts.isStringLiteral(node.initializer));
assert.equal(roleValues.length, 1);
const canManagerAssignOwnItem = vm.runInNewContext(transformSync(`(${predicate[0].getText(managerAst).replace(/^export\s+/, "")})`, {
  loader: "ts", target: "es2022",
}).code, { APP_ROLE: { DELEGATE_MANAGER: roleValues[0].initializer.text } });
const { Card: ActualCard, CardContent } = load("client/src/components/ui/card.tsx");
const { Button: ActualButton } = load("client/src/components/ui/button.tsx");
const { Badge } = load("client/src/components/ui/badge.tsx");
const timing = load("client/src/lib/purchaseItemTiming.ts");
const need = load("shared/purchaseItemNeedDate.ts");
const bundleLabels = load("client/src/i18n/pricingBundles.ts").pricingBundleText;
const supplyLabels = load("client/src/i18n/purchaseSupplyWait.ts").purchaseSupplyWaitText;
const now = new Date("2026-11-09T09:00:00Z");
const variants = ["pending-short", "pending-long", "estimated-long", "purchase-short"];
const titles = {
  ar: ["فلتر", "مضخة مياه للصيانة بمواصفات فنية متعددة مع محرك كهربائي وقطع تركيب للمبنى الرئيسي " + "قطعة".repeat(16)],
  en: ["Filter", "Water pump for maintenance with electric motor and multiple technical specifications for the main building " + "COMPONENT".repeat(12)],
  ur: ["فلٹر", "مرکزی عمارت کی دیکھ بھال کے لیے پانی کا پمپ، برقی موٹر اور تنصیب کے متعدد پرزے " + "سامان".repeat(16)],
};
const eventChecks = [];
function renderCard(language, role, variant, before = false) {
  const t = load(`client/src/i18n/${language}.ts`).default;
  const events = { navigations: [], assignments: [], buttons: [], card: null, bundles: [] };
  const index = variants.indexOf(variant), item = {
    id: index + 1, purchaseOrderId: 42, purchaseOrderNumber: "PR-2026-00383", itemName: titles[language][variant.endsWith("long") ? 1 : 0],
    quantity: 7, unit: language === "ar" ? "حبة" : language === "ur" ? "عدد" : "Piece", requiredDate: "2026-11-12",
    delegateAssignedAt: "2026-11-08", requestedByName: language === "en" ? "Maintenance manager" : "مدير الصيانة",
    managerAssignable: true, delegateId: 20, status: variant.startsWith("estimated") ? "estimated" : variant.startsWith("purchase") ? "approved" : "pending",
    actionMode: variant.startsWith("purchase") ? "purchase" : "estimate",
  };
  function Card(props) { events.card = props; return React.createElement(ActualCard, props); }
  function Button(props) { events.buttons.push(props); return React.createElement(ActualButton, props); }
  // Match the actual optional RPC-linked control's span/Button shape, classes,
  // and translated label while exposing no hooks, API, or mutations.
  function PricingBundleAddButton({ itemId }) {
    return React.createElement("span", { onClick: event => event.stopPropagation() }, React.createElement(ActualButton, {
      size: "sm", className: "bg-teal-700 hover:bg-teal-800", onClick: () => events.bundles.push(itemId),
    }, bundleLabels[language].add));
  }
  function SupplyWaitExplanation() {
    if (variant !== "estimated-long") return null;
    return React.createElement("div", { className: "mt-2 w-full min-w-0 basis-full space-y-2 text-start", onClick: event => event.stopPropagation() },
      React.createElement(ActualButton, { size: "sm", className: "bg-blue-600 text-white h-auto max-w-full whitespace-normal py-2" }, supplyLabels[language].title));
  }
  const tree = vm.runInNewContext(transformSync(`(${before ? baselineSource : cardSource})`, { loader: "tsx", jsx: "transform", target: "es2022" }).code, {
    React, Card, CardContent, Button, Badge, PricingBundleAddButton, SupplyWaitExplanation,
    canManagerAssignOwnItem, authenticatedUser: { id: 20, role, isActive: 1 }, item, t, language,
    locale: language === "ar" ? "ar-SA" : language === "ur" ? "ur-PK" : "en-US",
    ...timing, remainingDays: need.remainingPurchaseCalendarDays(item.requiredDate, now), availableDays: timing.getAvailableCalendarDays(item.requiredDate, item.delegateAssignedAt),
    getLocalizedItemField: value => value.itemName, displayUnit: value => value,
    setLocation: value => events.navigations.push(value), setManagerAssignmentItem: value => events.assignments.push(value.id),
  });
  const html = renderToStaticMarkup(React.createElement("section", { "data-variant": variant }, tree));
  const expectedUrl = `/purchase-orders/42?action=${item.actionMode}&itemId=${item.id}`;
  events.card.onClick(); assert.deepEqual(events.navigations, [expectedUrl]); events.navigations = [];
  const open = events.buttons.find(button => button.children === t.workflow.purchase.openOrder);
  let stopped = false; open.onClick({ stopPropagation() { stopped = true; } });
  assert(stopped, "Open action must stop card bubbling"); assert.deepEqual(events.navigations, [expectedUrl]); events.navigations = [];
  const assign = events.buttons.find(button => button.children === t.purchaseOrders.managerAssignToDelegate);
  const shouldAssign = role === "delegate_manager" && variant.startsWith("pending");
  assert.equal(!!assign, shouldAssign, "Actual manager assignment predicate controls eligibility");
  if (assign) {
    stopped = false; assign.onClick({ stopPropagation() { stopped = true; } });
    assert(stopped); assert.deepEqual(events.assignments, [item.id]); assert.deepEqual(events.navigations, []);
  }
  eventChecks.push({ language, role, variant, before, navigation: true, assignmentVisible: !!assign });
  return html;
}
const documents = new Map();
for (const language of ["ar", "en", "ur"]) for (const role of ["delegate", "delegate_manager"]) {
  documents.set(`${language}/${role}/after`, variants.map(variant => renderCard(language, role, variant)).join(""));
  if (language === "ar" && role === "delegate_manager") documents.set(`${language}/${role}/before`, variants.map(variant => renderCard(language, role, variant, true)).join(""));
}
const classNames = new Set(["p-4", "space-y-4"]);
for (const body of documents.values()) for (const match of body.matchAll(/class="([^"]*)"/g)) for (const token of match[1].split(/\s+/)) classNames.add(token);
const compiler = await compile(fs.readFileSync(path.join(root, "client/src/index.css"), "utf8"), { base: path.join(root, "client/src"), onDependency() {} });
const css = compiler.build([...classNames]);
function documentHtml(language, body) {
  return `<!doctype html><html lang="${language}" dir="${language === "en" ? "ltr" : "rtl"}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Isolated delegate card fixture</title><style>${css}</style><body><main class="p-4 space-y-4">${body}</main></body></html>`;
}
const chromium = process.argv.indexOf("--chrome");
const executablePath = chromium >= 0 ? process.argv[chromium + 1] : "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const results = [], baseline = [], attemptedRequests = [];
let comparison;
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => { attemptedRequests.push(request.url()); void request.abort(); });
  async function measure(key, width) {
    const [language] = key.split("/");
    await page.setViewport({ width, height: 1100, deviceScaleFactor: 1 });
    await page.setContent(documentHtml(language, documents.get(key)), { waitUntil: "load" });
    return page.evaluate(() => ({
      viewportWidth: innerWidth, pageWidth: document.documentElement.scrollWidth,
      cards: [...document.querySelectorAll("section[data-variant]")].map(section => {
        const card = section.querySelector('[data-slot="card"]');
        const content = section.querySelector('[data-slot="card-content"]');
        const details = content.children[0], actions = content.children[1], title = details.children[0], meta = details.children[1];
        const rect = value => { const r = value.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const style = getComputedStyle(content), bounds = rect(content);
        return { variant: section.dataset.variant, card: rect(card), content: bounds, details: rect(details), title: rect(title), meta: rect(meta), actions: rect(actions),
          innerWidth: bounds.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), direction: style.flexDirection,
          controls: [...actions.querySelectorAll('button,[data-slot="badge"]')].map(control => ({ text: control.textContent, ...rect(control) })),
        };
      }),
    }));
  }
  for (const language of ["ar", "en", "ur"]) for (const role of ["delegate", "delegate_manager"]) for (const width of [320, 375, 390, 768, 1280]) {
    const key = `${language}/${role}/after`, metrics = await measure(key, width);
    assert(metrics.pageWidth <= width + 1, `${key}@${width}: horizontal overflow ${metrics.pageWidth}`);
    for (const card of metrics.cards) {
      if (width < 1024) {
        assert.equal(card.direction, "column", `${key}@${width}/${card.variant}: stacked layout`);
        assert(Math.abs(card.details.width - card.innerWidth) < 1, `${key}@${width}/${card.variant}: title column must use available width`);
        assert(card.actions.top >= card.meta.bottom + 15, `${key}@${width}/${card.variant}: actions below metadata`);
      } else assert.equal(card.direction, "row", `${key}@${width}: desktop row`);
      for (const control of card.controls) {
        assert(control.left >= card.content.left - 1 && control.right <= card.content.right + 1, `${key}@${width}/${card.variant}: control overflow ${control.text}`);
      }
      assert(card.title.width >= Math.min(230, card.innerWidth) - 1, `${key}@${width}/${card.variant}: readable title width`);
    }
    results.push({ language, role, width, ...metrics });
    if (role === "delegate_manager" && [375, 1280].includes(width)) await page.screenshot({ path: path.join(output, `${language}-manager-${width}-after.png`), fullPage: true });
  }
  for (const width of [320, 375, 390, 414, 768]) {
    const metrics = await measure("ar/delegate_manager/before", width);
    const failures = metrics.cards.filter(card => card.details.width < card.innerWidth - 1 || card.actions.top < card.meta.bottom + 15).map(card => card.variant);
    baseline.push({ width, failedVariants: failures, ...metrics });
    if ([375, 414].includes(width)) await page.screenshot({ path: path.join(output, `ar-manager-${width}-before.png`), fullPage: true });
  }
  comparison = await measure("ar/delegate_manager/after", 414);
  assert(comparison.cards.every(card => Math.abs(card.details.width - card.innerWidth) < 1 && card.actions.top >= card.meta.bottom + 15));
  await page.screenshot({ path: path.join(output, "ar-manager-414-after.png"), fullPage: true });
  assert(baseline.some(result => result.cards.some(card => card.details.width < 80)), "Original three classes must reproduce collapsed title column");
  assert(baseline.every(result => result.failedVariants.length > 0), "Original classes must fail mobile/tablet contract");
  assert.deepEqual(attemptedRequests, [], "Isolated fixture must make zero network requests");
} finally { await browser.close(); }
const report = { passed: true, layoutCases: results.length * variants.length, viewportRoleLanguageCases: results.length,
  eventCases: eventChecks.filter(result => !result.before).length, networkRequests: attemptedRequests.length,
  loadedFiles: [...loadedFiles].sort(), beforeClassReplacementsOnly: oldClasses, results, baseline, comparison, eventChecks };
fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: true, layoutCases: report.layoutCases, eventCases: report.eventCases, networkRequests: 0,
  baselineCollapsedWidths: baseline.flatMap(row => row.cards.filter(card => card.details.width < 80).map(card => ({ viewport: row.width, variant: card.variant, textWidth: card.details.width }))), artifacts: output }, null, 2));
