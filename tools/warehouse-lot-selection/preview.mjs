// Local component fixture only. No app environment, RPC, or database is loaded.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { build } from "esbuild";
import puppeteer from "puppeteer-core";
const root = process.cwd(),
  assets = path.join(root, "dist/public/assets");
const css = fs.readFileSync(
  path.join(
    assets,
    fs.readdirSync(assets).find(name => /^index-.*\.css$/.test(name))
  ),
  "utf8"
);
const bundle = await build({
  stdin: {
    contents: `
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {WarehouseLotSelection} from './client/src/components/inventory/WarehouseLotSelection';
 import {selectFullIssueLots} from './shared/warehouse-lot-selection';
 function Preview(){const [value,setValue]=useState({mode:'fifo'});const lots=[2,3,5,1].map((quantity,i)=>({lotId:i+1,lotCode:'LOT-'+(i+1),quantity,unit:'حبة',createdAt:'2026-10-0'+(i+1)}));let ready=true;let plan=[];try{plan=selectFullIssueLots(lots,6,'حبة',value);}catch{ready=false;}
 return <main dir="rtl" className="max-w-4xl mx-auto p-4 space-y-4"><h1>صرف احتياج كامل — بيانات تجربة</h1><WarehouseLotSelection lots={lots} required={6} unit="حبة" value={value} onChange={setValue}/><button id="confirm" disabled={!ready}>تأكيد الصرف الكامل</button><output id="plan">{plan.map(lot=>lot.lotCode+':'+lot.quantity).join(',')}</output></main>;}
 createRoot(document.getElementById('root')).render(<Preview/>);`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  alias: {
    "@": path.join(root, "client/src"),
    "@shared": path.join(root, "shared"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
});
const html = `<!doctype html><html lang="ar"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><body><div id="root"></div><script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
fs.mkdirSync("tmp/warehouse-lots-preview", { recursive: true });
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
  await page.setRequestInterception(true);
  page.on("request", request => request.abort());
  page.on("pageerror", error => errors.push(error.message));
  const report = [];
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 850, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#confirm");
    assert.equal(
      await page.$eval("#plan", e => e.textContent),
      "LOT-1:2,LOT-2:3,LOT-3:1"
    );
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .find(e => e.textContent.includes("اختيار اللوتات"))
        .click()
    );
    await page.waitForSelector("tbody tr");
    assert.equal(await page.$eval("#confirm", e => e.disabled), true);
    await page.evaluate(() =>
      document.querySelectorAll("tbody tr")[2].querySelector("button").click()
    );
    await page.waitForSelector("input");
    assert.equal(await page.$eval("#confirm", e => e.disabled), true);
    await page.evaluate(() =>
      document.querySelectorAll("tbody tr")[3].querySelector("button").click()
    );
    await page.waitForFunction(
      () => !document.querySelector("#confirm").disabled
    );
    assert.equal(
      await page.$eval("#plan", e => e.textContent),
      "LOT-3:5,LOT-4:1"
    );
    const metrics = await page.evaluate(() => ({
      width: innerWidth,
      bodyWidth: document.documentElement.scrollWidth,
      inputs: document.querySelectorAll("input").length,
    }));
    assert(metrics.bodyWidth <= width);
    assert.equal(metrics.inputs, 2);
    report.push(metrics);
    await page.screenshot({
      path: `tmp/warehouse-lots-preview/manual-${width}.png`,
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  fs.writeFileSync(
    "tmp/warehouse-lots-preview/report.json",
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify({ passed: true, viewports: report }));
} finally {
  await browser.close();
}
