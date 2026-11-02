// Local UI fixtures only: no application environment, API or database imports.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { build } from "esbuild";

const root = process.cwd();
const assets = path.join(root, "dist/public/assets");
const css = fs.readFileSync(
  path.join(
    assets,
    fs.readdirSync(assets).find(name => /^index-.*\.css$/.test(name))
  ),
  "utf8"
);
let html = fs
  .readFileSync("tools/inventory-books/artifacts/preview.html", "utf8")
  .replace(
    '<link rel="stylesheet" href="/styles.css">',
    `<style>${css}</style>`
  );
const units = [
  "قطعة",
  "كيس",
  "لفة",
  "جالون",
  "باكج",
  "علبة",
  "كرتون",
  "حبة",
  "باكيت",
  "برميل",
  "درزن",
  "م2",
  "رول piece",
  "شيت",
  "كجم",
];
const amounts = [3525, 76, 13, 30, 13, 273, 34, 475, 11, 2, 1, 40, 1, 2, 8];
const totals = units.map((unit, index) => ({ unit, quantity: amounts[index] }));
const bundle = await build({
  stdin: {
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {flushSync} from 'react-dom';
      import {InventoryQuantitySummary} from './client/src/components/inventory/InventoryQuantitySummary';
      flushSync(() => createRoot(document.querySelector('main > .grid')).render(<InventoryQuantitySummary totals={${JSON.stringify(totals)}} />));
      window.__inventoryPreviewReady = true;`,
    resolveDir: root,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  alias: { "@": path.join(root, "client/src") },
  define: { "process.env.NODE_ENV": '"production"' },
});
html = html.replace(
  "</body>",
  `<script>${bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script")}</script></body>`
);
fs.mkdirSync("tmp/inventory-books-layout", { recursive: true });
let browser;
try {
  browser = await puppeteer.launch({
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
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => request.abort());
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  for (const width of [1440, 390]) {
    await page.setViewport({ width, height: 1000, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__inventoryPreviewReady === true);
    const metrics = await page.evaluate(() => ({
      bodyWidth: document.documentElement.scrollWidth,
      viewport: innerWidth,
      summaryHeight: document
        .querySelector("main > .grid")
        .getBoundingClientRect().height,
      tableRows: document.querySelectorAll(
        'table[aria-label="أصناف المستودع حسب دفتر الكتالوج"] tbody > tr'
      ).length,
    }));
    if (metrics.bodyWidth > width) throw Error("Page overflows viewport");
    await page.screenshot({
      path: `tmp/inventory-books-layout/${width}-closed.png`,
    });
    await page.click("main > .grid button");
    await page.waitForSelector('[role="dialog"]');
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('[role="dialog"]')).opacity ===
        "1"
    );
    const dialog = await page.evaluate(() => {
      const element = document.querySelector('[role="dialog"]');
      const rect = element.getBoundingClientRect();
      return {
        rows: element.querySelectorAll("tbody tr").length,
        left: rect.left,
        right: rect.right,
        viewport: innerWidth,
      };
    });
    if (dialog.rows !== 15 || dialog.left < 0 || dialog.right > width)
      throw Error("Quantity details layout failed");
    await page.screenshot({
      path: `tmp/inventory-books-layout/${width}-details.png`,
    });
    console.log(JSON.stringify({ width, metrics, dialogRows: dialog.rows }));
  }
  if (errors.length) throw Error(errors.join("\n"));
} finally {
  await browser?.close();
}
