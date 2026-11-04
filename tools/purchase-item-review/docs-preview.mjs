// Isolated production HTML captured by docs.run.mjs, with frozen fixture signatures only.
import fs from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
const directory = path.resolve("tmp/purchase-item-review/docs");
const browser = await puppeteer.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--no-sandbox", "--disable-background-networking", "--disable-sync", "--no-first-run"] });
try {
  const page = await browser.newPage(); await page.setRequestInterception(true); page.on("request", request => /^data:/.test(request.url()) ? request.continue() : request.abort());
  await page.setViewport({ width: 794, height: 1123 });
  await page.setContent(fs.readFileSync(path.join(directory, "multiple-reviewers-approved.html"), "utf8"));
  await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {}))); });
  const details = await page.evaluate(() => ({ reviewers: Array.from(document.querySelectorAll("tr")).filter(row => row.firstElementChild?.textContent === "مراجع الطلب").map(row => ({ text: row.textContent, image: !!row.querySelector("img")?.naturalWidth })), finance: document.body.textContent.includes("الشؤون المالية والإجراءات المحاسبية"), accounting: document.body.textContent.includes("Senior actor at accounting stage") }));
  if (details.reviewers.length !== 2 || details.reviewers.some(row => !row.image) || !details.finance || !details.accounting) throw Error(JSON.stringify(details));
  await page.pdf({ path: path.join(directory, "multiple-reviewers-approved.pdf"), format: "A4", printBackground: true });
  await page.screenshot({ path: path.join(directory, "multiple-reviewers-approved-browser.png"), captureBeyondViewport: false });
  console.log(JSON.stringify({ pass: true, ...details, file: path.join(directory, "multiple-reviewers-approved.pdf") }));
} finally { await browser.close(); }
