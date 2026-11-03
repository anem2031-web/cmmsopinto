// Actual transfer page with deterministic RPC fixtures; all network is intercepted.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
const root = process.cwd();
const mock = `
if(!crypto.randomUUID)crypto.randomUUID=()=> '00000000-0000-4000-8000-000000000001';
const inventory=[{id:100,warehouseId:10,linkedItemId:1,itemName:'مادة تجريبية',unit:'حبة',issueUnit:'حبة',quantity:11,internalCode:'INV-DEMO'}];
const lots=[2,3,5,1].map((balanceQuantity,n)=>({lotId:n+1,lotCode:'LOT-'+(n+1),trackingToken:'T'+(n+1),catalogItemId:1,issueUnit:'حبة',balanceQuantity,createdAt:'2026-10-0'+(n+1)}));
const warehouses=[{id:10,nameAr:'المستودع الرئيسي',type:'main'},{id:20,nameAr:'مخزن الفريق',type:'branch'}];
const enabled={enabled:true};
const empty=[];
window.__mutations=[];window.__lotReads=0;
function query(path,input,options){let data=empty;if(path==='inventory.list')data=inventory;if(path==='warehouse.list')data=warehouses;if(path==='inventoryCount.lotTrackingStatus')data=enabled;if(options?.enabled===false)data=undefined;
return {data,isLoading:false,error:null,refetch:async()=>({data})};}
async function mutate(path,input){window.__mutations.push({path,input});
if(path==='pmv2.warehouse.prepareTransferHandoff')return {sourceWarehouse:warehouses[0],destinationWarehouse:warehouses[1],remainingQuantity:6,fulfillmentAllocations:[{sourceInventoryId:100,catalogItemId:1,materialName:'مادة تجريبية',quantity:6,unit:'حبة',originalQuantity:6,lotId:1,lotCode:'LOT-1',trackingToken:'T1',allowedLotIds:[1,2,3,4]}]};
if(path==='pmv2.warehouse.linkConfirmedTransfers')return {status:'issued_to_team',remainingQuantity:0};
const form=input.form||input;
return {batchNumber:'TRB-DEMO',results:(form.items||[]).map((item,n)=>({success:true,fromInventoryId:item.fromInventoryId,transferNumber:'TR-'+n,lotCode:'LOT-'+item.lotTrackingToken.slice(1)}))};}
const proxy=(path='')=>new Proxy(()=>{},{get(_,key){if(key==='useUtils')return ()=>utils;if(key==='useQuery')return(input,options)=>query(path,input,options);if(key==='useMutation')return()=>({isPending:false,mutateAsync:input=>mutate(path,input)});if(key==='query')return async input=>{if(path==='utils.client.inventory.listLots'){window.__lotReads++;return lots;}return empty;};if(key==='mutate')return input=>mutate(path.replace('utils.client.',''),input);return proxy(path?path+'.'+key:String(key));}});
const utils=proxy('utils');export const trpc=proxy();export const useAuth=()=>({user:{id:9,role:'warehouse',isActive:1}});
export const useLocation=()=>[location.pathname,href=>{window.__navigation=href;}];
export const useTranslation=()=>({language:'ar',dir:'rtl'});
`;
const result = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import WarehouseTransfer from './client/src/pages/inventory/WarehouseTransfer';createRoot(document.getElementById('root')).render(<WarehouseTransfer/>);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  alias: {
    "@": path.join(root, "client/src"),
    "@shared": path.join(root, "shared"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [
    {
      name: "offline-fixture",
      setup(plugin) {
        plugin.onResolve(
          {
            filter:
              /^(?:@\/(?:lib\/trpc|_core\/hooks\/useAuth|contexts\/LanguageContext)|wouter)$/,
          },
          () => ({ path: "fixture", namespace: "offline" })
        );
        plugin.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
          contents: mock,
          loader: "js",
        }));
      },
    },
  ],
});
const assets = path.join(root, "dist/public/assets");
const css = fs
  .readdirSync(assets)
  .filter(name => /^index-.*\.css$/.test(name))
  .map(name => fs.readFileSync(path.join(assets, name), "utf8"))
  .join("\n");
const html = `<!doctype html><html dir="rtl" lang="ar"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main id="root" class="p-5 max-w-4xl mx-auto"></main><script>${result.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
const folder = "tmp/material-transfer-lots-preview";
fs.mkdirSync(folder, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
  ],
});
try {
  const page = await browser.newPage(),
    errors = [];
  page.setDefaultTimeout(8000);
  page.on("pageerror", error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on("request", request =>
    request.isNavigationRequest() &&
    request.url().startsWith("http://fixture.local/")
      ? request.respond({ status: 200, contentType: "text/html", body: html })
      : request.abort()
  );
  const click = async text =>
    page.evaluate(text => {
      const button = Array.from(document.querySelectorAll("button")).find(
        button =>
          button.textContent.trim() === text &&
          button.getAttribute("role") !== "tab"
      );
      if (!button || button.disabled)
        throw Error("Button unavailable: " + text);
      button.click();
    }, text);
  for (const source of ["tickets", "pmv2"])
    for (const width of [1280, 390]) {
      await page.setViewport({ width, height: 1100 });
      const params = new URLSearchParams({
        fromWarehouseId: "10",
        toWarehouseId: "20",
        inventoryId: "100",
        quantity: "6",
        unit: "حبة",
        ...(source === "tickets"
          ? {
              ticketTeamNeedId: "5",
              ticketTeamAssignmentId: "7",
              ticketTeamRevision: "1",
              ticketId: "200",
              ticketNumber: "MT-DEMO",
              ticketMaterialName: "مادة تجريبية",
            }
          : {
              pmv2RequestItemId: "5",
              pmv2RequestId: "7",
              pmv2TaskNumber: "PM-DEMO",
              pmv2MaterialName: "مادة تجريبية",
            }),
      });
      await page.goto("http://fixture.local/warehouse/transfer?" + params, {
        waitUntil: "domcontentloaded",
      });
      try {
        await page.waitForFunction(() =>
          Array.from(document.querySelectorAll("button")).some(
            button =>
              button.textContent === "إضافة اللوتات المحددة للعملية" &&
              !button.disabled
          )
        );
      } catch (error) {
        console.log(
          JSON.stringify({
            source,
            width,
            errors,
            text: await page.$eval("#root", node => node.textContent),
          })
        );
        throw error;
      }
      assert.equal(
        await page.$eval("#root", node =>
          node.textContent.includes("QR الدفعة / رقم اللوت *")
        ),
        false
      );
      await click("إضافة اللوتات المحددة للعملية");
      await page.waitForFunction(
        () =>
          document.querySelector("#root").textContent.includes("LOT-1") &&
          document.querySelector("#root").textContent.includes("LOT-3")
      );
      assert.ok(await page.evaluate(() => window.__lotReads >= 2));
      await click("▸ اختيار اللوتات");
      await page.waitForSelector("table");
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("tr"))
          .find(row => row.textContent.includes("LOT-3"))
          .querySelector("button")
          .click()
      );
      await page.waitForSelector('input[aria-label="كمية اللوت LOT-3"]');
      const input = 'input[aria-label="كمية اللوت LOT-3"]';
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("tr"))
          .find(row => row.textContent.includes("LOT-4"))
          .querySelector("button")
          .click()
      );
      await page.waitForSelector('input[aria-label="كمية اللوت LOT-4"]');
      await page.click(input, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(input, "4");
      assert.ok(
        await page.evaluate(
          () =>
            Array.from(document.querySelectorAll("button")).find(
              button => button.textContent === "إضافة اللوتات المحددة للعملية"
            ).disabled
        )
      );
      await page.click(input, { clickCount: 3 });
      await page.keyboard.press("Backspace");
      await page.type(input, "5");
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          button =>
            button.textContent === "إضافة اللوتات المحددة للعملية" &&
            !button.disabled
        )
      );
      await click("إضافة اللوتات المحددة للعملية");
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll("button")).some(
          button =>
            button.textContent.trim().startsWith("تنفيذ تحويل") &&
            button.getAttribute("role") !== "tab" &&
            !button.disabled
        )
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      );
      await page.screenshot({
        path: path.join(folder, source + "-" + width + ".png"),
      });
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("button"))
          .find(
            button =>
              button.textContent.trim().startsWith("تنفيذ تحويل") &&
              button.getAttribute("role") !== "tab"
          )
          .click()
      );
      await page.waitForFunction(() =>
        window.__mutations.some(
          call =>
            call.path === "ticketTeamExecution.transferFromForm" ||
            call.path === "transfers.createBatch"
        )
      );
      const calls = await page.evaluate(() => window.__mutations);
      const posted = calls.find(
        call =>
          call.path ===
          (source === "tickets"
            ? "ticketTeamExecution.transferFromForm"
            : "transfers.createBatch")
      );
      const form = posted.input.form || posted.input;
      assert.deepEqual(
        form.items
          .map(item => [item.lotTrackingToken, item.quantity])
          .sort((a, b) => a[0].localeCompare(b[0])),
        [
          ["T3", 5],
          ["T4", 1],
        ]
      );
      assert.ok(!calls.some(call => call.path === "transfers.resolveLot"));
      if (source === "pmv2")
        await page.waitForFunction(() =>
          window.__mutations.some(
            call => call.path === "pmv2.warehouse.linkConfirmedTransfers"
          )
        );
    }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: actual ticket/PMV2 transfer page, FIFO then manual 5+1, incomplete blocked, fresh reads, original submit/link RPCs, desktop/mobile."
  );
} finally {
  await browser.close();
}
