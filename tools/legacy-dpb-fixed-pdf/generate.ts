// Offline only. Retains the delegate PDF and appends one owner-approved financial block.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import { sql } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { documentHtml } from "./render.mjs";
import { financialFooterHtml } from "./finance.mjs";
import { approvedBundleCondition } from "../../server/services/delegate-pricing-bundles/approved-document";
import { fixedPdfHash, LEGACY_DPB_CORRECTIONS, LEGACY_CORRECTION_FORMAT, lowestLegacyCustody } from "../../server/services/delegate-pricing-bundles/fixed-approved-document";

const argument = (key: string) => process.argv[process.argv.indexOf(key) + 1];
for (const key of ["--source", "--output", "--python"]) if (!process.argv.includes(key)) throw Error(`Required argument ${key}`);
const source = JSON.parse(fs.readFileSync(argument("--source"), "utf8")), output = argument("--output");
if (source.database !== "COPYCMMS2" || source.documents.length !== 12 || new Set(source.documents.map((d: any) => d.number)).size !== 12
  || source.documents.some((d: any) => !LEGACY_DPB_CORRECTIONS.includes(d.number) || !/^[a-f0-9]{64}$/.test(d.sourceHash) || !/^[a-f0-9]{64}$/.test(d.snapshotSqlHash))) throw Error("Invalid correction manifest");
for (const folder of ["originals", "corrected", "sql", "work"]) fs.mkdirSync(path.join(output, folder), { recursive: true });
process.env.DELEGATE_PRICING_BUNDLE_APPROVALS_ENABLED = "true";
const condition = new MySqlDialect().sqlToQuery(sql`${approvedBundleCondition()}`);
if (condition.params.length) throw Error("Unexpected SQL parameters");
const quote = (text: string) => `'${text.replaceAll("'", "''")}'`;
const browser = await puppeteer.launch({ executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--disable-gpu", "--no-sandbox"] });
const render = async (html: string, file: string, small = false) => {
  const page = await browser.newPage();
  try {
    await page.setRequestInterception(true);
    page.on("request", request => request.url().startsWith("data:") ? request.continue() : request.abort());
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(async () => { await document.fonts.ready; await Promise.all(Array.from(document.images, image => image.decode())); });
    const height = small ? await page.evaluate(() => Math.ceil(document.querySelector("main")!.getBoundingClientRect().height) + 2) : 0;
    const bytes = Buffer.from(await page.pdf(small ? { width: "210mm", height: `${height}px`, printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }
      : { format: "A4", printBackground: true, preferCSSPageSize: true }));
    fs.writeFileSync(file, bytes);
    return bytes;
  } finally { await page.close(); }
};
const manifest = [];
try {
  for (const doc of source.documents) {
    const baseFile = path.join(output, "work", `${doc.number}.delegate.pdf`);
    const financeFile = path.join(output, "work", `${doc.number}.finance.pdf`);
    const originalFile = path.join(output, "originals", `${doc.number}.pdf`);
    const correctedFile = path.join(output, "corrected", `${doc.number}.pdf`);
    let delegate: Buffer;
    if (doc.delegatePdfBase64) {
      delegate = Buffer.from(doc.delegatePdfBase64, "base64");
      if (delegate.subarray(0, 5).toString() !== "%PDF-") throw Error("Invalid original delegate PDF");
      fs.writeFileSync(baseFile, delegate);
    } else {
      if (!doc.delegateSnapshot || doc.delegateSnapshot.financialApprovals) throw Error("Missing original delegate snapshot");
      delegate = await render(await documentHtml(doc.delegateSnapshot), baseFile);
    }
    const original = await render(await documentHtml(doc.approved), originalFile);
    const footer = financialFooterHtml(doc.approved);
    fs.writeFileSync(path.join(output, "work", `${doc.number}.finance.html`), footer);
    await render(footer, financeFile, true);
    execFileSync(argument("--python"), ["tools/legacy-dpb-fixed-pdf/append_finance.py", "--base", baseFile, "--finance", financeFile, "--output", correctedFile], { stdio: "pipe" });
    const corrected = fs.readFileSync(correctedFile);
    if (corrected.length > 8 * 1024 * 1024 || corrected.subarray(0, 5).toString() !== "%PDF-") throw Error("Invalid corrected PDF");
    const originalHash = fixedPdfHash(original), correctedHash = fixedPdfHash(corrected);
    const statement = `-- COPYCMMS2 ONLY; format ${LEGACY_CORRECTION_FORMAT}: delegate PDF plus one finance block, lowest recorded custody.\n`
      + `-- Never changes original purchase records, custody balances, approvals or delegate PDFs.\n`
      + `INSERT INTO \`COPYCMMS2\`.\`delegate_pricing_bundle_pdf_corrections\` (bundleId,bundleNumber,sourceHash,formatVersion,originalPdf,originalSha256,correctedPdf,correctedSha256)\n`
      + `SELECT b.id,b.bundleNumber,${quote(doc.sourceHash)},${LEGACY_CORRECTION_FORMAT},UNHEX('${original.toString("hex")}'),${quote(originalHash)},UNHEX('${corrected.toString("hex")}'),${quote(correctedHash)}\n`
      + `FROM \`COPYCMMS2\`.\`delegate_pricing_bundles\` b WHERE b.id=${doc.id} AND b.bundleNumber=${quote(doc.number)}\n`
      + `AND SHA2(CAST(b.snapshotJson AS CHAR),256)=${quote(doc.snapshotSqlHash)}\n`
      + `AND NOT EXISTS (SELECT 1 FROM \`COPYCMMS2\`.\`delegate_pricing_bundle_approvals\` a WHERE a.bundleId=b.id)\n`
      + `AND NOT EXISTS (SELECT 1 FROM \`COPYCMMS2\`.\`delegate_pricing_bundle_pdf_corrections\` c WHERE c.bundleId=b.id OR c.bundleNumber=b.bundleNumber)\n`
      + `AND ${condition.sql.replaceAll(/\b(delegate_pricing_bundle_batches|delegate_pricing_bundle_items|purchase_order_items|po_pricing_batches|purchase_orders|purchase_package_submissions|delegate_pricing_bundle_approvals)\b/g, '`COPYCMMS2`.`$1`')};\n`;
    fs.writeFileSync(path.join(output, "sql", `${doc.number}.sql`), statement);
    const record = { number: doc.number, id: doc.id, formatVersion: LEGACY_CORRECTION_FORMAT, sourceHash: doc.sourceHash,
      originalHash, correctedHash, delegateBaseHash: fixedPdfHash(delegate), delegateBaseSource: doc.delegatePdfBase64 ? "stored-pdf" : "frozen-snapshot",
      displayedCustody: lowestLegacyCustody(doc.approved.financialApprovals), originalBytes: original.length, correctedBytes: corrected.length,
      financialScopes: doc.approved.financialApprovals.map((a: any) => ({ reference: a.reference, purchaseOrders: a.poNumbers, label: a.custodyLabel, value: a.custodyValue })) };
    manifest.push(record);
    console.log(JSON.stringify({ number: record.number, displayedCustody: record.displayedCustody, delegateBase: record.delegateBaseSource }));
  }
} finally { await browser.close(); }
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ database: source.database, formatVersion: LEGACY_CORRECTION_FORMAT, capturedAt: source.capturedAt, documents: manifest }, null, 2));
for (const file of ["01_storage_copycmms2.sql", "02_verify_copycmms2.sql"]) fs.copyFileSync(path.join("docs/legacy-dpb-fixed-pdf", file), path.join(output, file));
console.log("Generated final-format PDFs and manual imports only. No database or storage writes.");
