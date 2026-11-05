// Actual center layout with local presentation fixtures. No API, auth session,
// application environment, server process or database is opened by this preview.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import puppeteer from "puppeteer-core";

const root = process.cwd(), output = path.join(root, "tools/returns-center/artifacts");
const sharedFixture = `import React from 'react';
function Fixture({kind,search=''}) {
  const rows = kind==='suppliers' ? [
    {number:'RTN-2026-210004',item:'مضخة مياه',detail:'2 قطعة · المندوب: عبدالعزيز الحاج',status:'بانتظار تأكيد الاستلام',action:'عرض المرتجع'},
    {number:'RTN-2026-210005',item:'محول طاقة',detail:'1 قطعة · طلب الشراء PR-2026-0502',status:'بانتظار استلام البديل',action:'عرض المتابعة'}
  ] : kind==='specifications' ? [
    {number:'PR-2026-0430',item:'ألواح MDF',detail:'5 شيت · مرفوضة في مطابقة المواصفات',status:'بانتظار بدء الإرجاع',action:'بدء الإرجاع للمورد'}
  ] : kind==='documents' ? [
    {number:'RET-2026-000084',item:'محول طاقة',detail:'مرتجع إلى المورد · 1 قطعة',status:'02/11/2026',action:'طباعة الوثيقة'}
  ] : [
    {number:kind==='tickets'?'MT-2026-00646-01':kind==='pmv2'?'PMV2-2026-0048':'OI-2026-00042',item:'سلك ربط',detail:'3 كيس · مخزن الفريق',status:'مرتجع بانتظار استلام المستودع',action:'استلام المرتجع'}
  ];
  return <div className='space-y-3'>
    {kind==='suppliers'&&<div className='flex gap-2'><button className='rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground'>الجارية</button><button className='rounded-md border px-4 py-2 text-sm'>المكتملة</button></div>}
    {rows.filter(row=>!search||JSON.stringify(row).includes(search)).map(row=><article key={row.number} className='rounded-xl border bg-card p-4 sm:p-5'><div className='flex flex-wrap items-start justify-between gap-3'><div className='min-w-0 space-y-2'><p className='text-sm font-medium text-primary' dir='ltr'>{row.number}</p><h3 className='font-semibold'>{row.item}</h3><p className='text-sm text-muted-foreground'>{row.detail}</p></div><span className='rounded-md bg-amber-50 px-3 py-1 text-xs text-amber-800'>{row.status}</span></div><div className='mt-4 border-t pt-3'><button className='rounded-md border px-3 py-2 text-sm'>{row.action}</button></div></article>)}
  </div>;
}
`;
const fixtures = {
  SupplierReturns: `${sharedFixture} export function SupplierReturns(props){return <Fixture kind='suppliers' {...props}/>;}`,
  PurchaseSpecifications: `${sharedFixture} export function RejectedSpecificationReturns(props){return <Fixture kind='specifications' {...props}/>;}`,
  WarehouseReturnDocuments: `${sharedFixture} export function WarehouseReturnDocuments(props){return <Fixture kind='documents' {...props}/>;}`,
  TicketWarehouseRequests: `${sharedFixture} export default function TicketWarehouseRequests(props){return <Fixture kind='tickets' {...props}/>;}`,
  Pmv2WarehouseQueue: `${sharedFixture} export default function Pmv2WarehouseQueue(props){return <Fixture kind='pmv2' {...props}/>;}`,
  OperationalWarehouseRequests: `${sharedFixture} export default function OperationalWarehouseRequests(props){return <Fixture kind='operational' {...props}/>;}`,
};
const nodeRequire = createRequire(import.meta.url);
const context = vm.createContext({ React, URLSearchParams, console, __returnsPreview: null });
const loaded = new Map();
function load(file) {
  const candidates = [file, `${file}.ts`, `${file}.tsx`, path.join(file, "index.ts"), path.join(file, "index.tsx")];
  file = candidates.find(value => fs.existsSync(value) && fs.statSync(value).isFile());
  if (!file || file.includes(`${path.sep}server${path.sep}`)) throw Error("Only local client/shared preview modules are allowed");
  if (loaded.has(file)) return loaded.get(file).exports;
  const module = { exports: {} }; loaded.set(file, module);
  const name = path.basename(file, path.extname(file));
  const source = fixtures[name] || (name === "useAuth"
    ? "export const useAuth=()=>({authenticatedUser:{id:7,role:globalThis.__returnsPreview.role,isActive:1},loading:false});"
    : name === "LanguageContext"
      ? "export const useTranslation=()=>({language:globalThis.__returnsPreview.language,dir:globalThis.__returnsPreview.language==='en'?'ltr':'rtl'});"
      : fs.readFileSync(file, "utf8"));
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = value => {
    if (value === "wouter") return { useSearch: () => context.__returnsPreview.search, useLocation: () => ["/returns-center", () => { throw Error("Preview must not navigate"); }] };
    if (value.startsWith("@/")) return load(path.join(root, "client/src", value.slice(2)));
    if (value.startsWith("@shared/")) return load(path.join(root, "shared", value.slice(8)));
    if (value.startsWith(".")) return load(path.resolve(path.dirname(file), value));
    return nodeRequire(value);
  };
  vm.runInContext(`(function(require,module,exports){${code}\n})`, context, { filename: file })(require, module, module.exports);
  return module.exports;
}
const Page = load(path.join(root, "client/src/pages/returns/ReturnsCenter.tsx")).default;
function render(search, role = "warehouse", language = "ar") {
  context.__returnsPreview = { search, role, language };
  return renderToStaticMarkup(React.createElement(Page));
}
const assetPath = path.join(root, "dist/public/assets");
const cssName = fs.readdirSync(assetPath).find(name => /^index-.*\.css$/.test(name));
if (!cssName) throw Error("Build the client before generating the layout preview");
const css = fs.readFileSync(path.join(assetPath, cssName), "utf8");
fs.mkdirSync(output, { recursive: true });
const panels = ["suppliers", "materials", "specifications", "documents"];
for (const panel of panels) {
  const html = `<!doctype html><html lang='ar' dir='rtl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>${css}</style></head><body style='margin:0;background:#f6f7f9'>${render(`tab=${panel}&source=tickets`)}</body></html>`;
  fs.writeFileSync(path.join(output, `${panel}-preview.html`), html);
}

let browser;
try {
  browser = await puppeteer.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
    args: ["--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-sync", "--no-first-run"] });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => request.abort());
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const metrics = [];
  for (const width of [1365, 390, 320]) {
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    for (const panel of panels) {
      await page.setContent(fs.readFileSync(path.join(output, `${panel}-preview.html`), "utf8"), { waitUntil: "domcontentloaded" });
      const sizes = await page.evaluate(() => ({ viewport: innerWidth, body: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight, tabs: document.querySelectorAll('[role="tab"]').length,
        activeTabs: document.querySelectorAll('[role="tab"][aria-selected="true"]').length, contentSources: document.querySelectorAll('[data-returns-center-source]').length,
        clippedTabs: [...document.querySelectorAll('[role="tab"]')].some(element => { const rect = element.getBoundingClientRect(); return rect.left < 0 || rect.right > innerWidth; }) }));
      if (sizes.body > width || sizes.clippedTabs || sizes.activeTabs !== 1 || sizes.contentSources !== 1) throw Error(`Invalid layout for ${panel} at ${width}: ${JSON.stringify(sizes)}`);
      metrics.push({ panel, width, ...sizes });
      if (width !== 320) {
        // Chrome's beyond-viewport capture offsets some RTL documents. Capture
        // the explicitly sized viewport so the image matches the measured UI.
        await page.setViewport({ width, height: Math.max(1000, Math.ceil(sizes.height)), deviceScaleFactor: 1 });
        await page.screenshot({ path: path.join(output, `${panel}-${width}.png`), fullPage: false, captureBeyondViewport: false });
      }
    }
  }
  if (errors.length) throw Error(errors.join("\n"));
  fs.writeFileSync(path.join(output, "layout-metrics.json"), JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ previews: panels.length, layoutsChecked: metrics.length, browserErrors: errors.length, output }));
} finally { await browser?.close(); }
