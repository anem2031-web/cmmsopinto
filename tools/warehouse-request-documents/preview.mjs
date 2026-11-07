// Actual page/components with local fixtures only. No RPC, session or database.
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
const root = process.cwd(), output = path.join(root, "tmp/warehouse-request-documents");
const fixtures = {
  auth: `export const useAuth=()=>({authenticatedUser:{id:1,role:'warehouse',isActive:1},user:{id:1,role:'warehouse',isActive:1}});`,
  language: `export const useTranslation=()=>({language:'ar',dir:'rtl'});`,
  navigation: `import {useSyncExternalStore} from 'react';let route='?source=tickets&panel=documents';const listeners=new Set();const subscribe=fn=>{listeners.add(fn);return()=>listeners.delete(fn)};export const useSearch=()=>useSyncExternalStore(subscribe,()=>route.split('?')[1]||'');export const useLocation=()=>['',url=>{route=url;listeners.forEach(fn=>fn())}];`,
  operations: `import React from 'react';export default function Operations(){return <p data-original-operations>العمليات الحالية — بيانات معاينة</p>}`,
  trpc: `
    const row={id:100,kind:'delivery',number:'DLV-2026-120100',createdAt:'2026-11-07T07:30:00Z',itemName:'مصباح إنارة موفر للطاقة',quantity:5,unit:'حبة',itemCount:1,recipientName:'محمد أحمد',issuerName:'ماجد ماهر',warehouseName:'المخزن الرئيسي',lotCode:'LOT-2026-120002',referenceNumber:'MT-2026-00672-01',referenceTitle:'صيانة إنارة الممر الرئيسي'};
    const sourceRow=source=>({...row,source,referenceNumber:source==='pmv2'?'PMV2-2026-00672':source==='operational'?'OPR-2026-000672':row.referenceNumber});
    const detail=async selection=>({row:sourceRow(selection.source),document:{...row,deliveryNumber:row.number,deliveredByName:row.issuerName,deliveredToName:row.recipientName,poItemId:0,returnedQuantity:1}});
    export const trpc={useUtils:()=>({warehouseRequestDocuments:{detail:{fetch:detail}}}),warehouseRequestDocuments:{list:{useQuery:input=>(window.__documentQuery=input,{data:{rows:[sourceRow(input.source),{...sourceRow(input.source),id:101,number:'DLV-2026-120101',itemName:'مواسير نحاس للورشة',referenceNumber:'MT-2026-00552-01'}].filter(r=>!input.search||Object.values(r).join(' ').includes(input.search)),total:2,page:1,pageSize:20},isLoading:false,refetch:async()=>{}})},recordPrint:{useMutation:()=>({mutateAsync:()=>{throw Error('No printing in layout preview')}})}}};`,
};
const result = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './client/src/pages/pmv2/WarehouseRequestsPage';createRoot(document.getElementById('root')).render(<main dir='rtl' className='mx-auto max-w-6xl p-4'><Page/></main>);`, loader: "tsx", resolveDir: root },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  alias: { "@": path.join(root, "client/src"), "@shared": path.join(root, "shared") }, define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "local-fixtures", setup(build) {
    build.onResolve({ filter: /useAuth$|LanguageContext$|^@\/lib\/trpc$|^wouter$|^\.\/(Pmv2WarehouseQueue)$|^\.\.\/maintenance-teams\/TicketWarehouseRequests$|^\.\.\/operational-issues\/OperationalWarehouseRequests$/ }, args => {
      const key = args.path.endsWith("useAuth") ? "auth" : args.path.endsWith("LanguageContext") ? "language" : args.path === "wouter" ? "navigation" : args.path === "@/lib/trpc" ? "trpc" : "operations";
      return { path: key, namespace: "fixtures" };
    });
    build.onLoad({ filter: /.*/, namespace: "fixtures" }, args => ({ contents: fixtures[args.path], loader: "tsx", resolveDir: root }));
  } }],
});
const assets = path.join(root, "dist/public/assets"), css = fs.readFileSync(path.join(assets, fs.readdirSync(assets).find(x => /^index-.*\.css$/.test(x))), "utf8");
const html = `<!doctype html><html lang='ar' dir='rtl'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><style>${css}</style><body><div id='root'></div><script>${result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox", "--disable-gpu", "--disable-background-networking", "--disable-sync", "--no-first-run"] });
try {
  const page = await browser.newPage(), errors = [], metrics = [];
  await page.setRequestInterception(true); page.on("request", r => r.abort()); page.on("pageerror", e => errors.push(e.message));
  for (const width of [1365, 390, 320]) {
    await page.setViewport({ width, height: 1000 }); await page.setContent(html); await page.waitForSelector("#warehouse-document-search");
    const metric = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    if (metric.scroll > width) throw Error(`Overflow: ${JSON.stringify(metric)}`); metrics.push(metric);
    const height = await page.evaluate(() => Math.max(1000, document.documentElement.scrollHeight));
    await page.setViewport({ width, height });
    await page.screenshot({ path: path.join(output, `documents-${width}.png`), fullPage: false, captureBeyondViewport: false });
    await page.type("#warehouse-document-search", "00672");
    await page.waitForFunction(() => !document.getElementById('root').textContent.includes("DLV-2026-120101"), { timeout: 5000 });
    await page.evaluate(() => [...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='تفاصيل').click());
    await page.waitForSelector('[role="dialog"]');
    if (!await page.evaluate(() => document.querySelector('[role="dialog"]').textContent.includes('الكمية المرتجعة'))) throw Error("Missing detail values");
  }
  if(errors.length)throw Error(errors.join('\n'));
  console.log(JSON.stringify({layouts:metrics,errors,output}));
} finally { await browser.close(); }
