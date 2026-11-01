// Controlled HTML/PDF preview only. No application imports, environment or DB.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import puppeteer from "puppeteer-core";

const file = "server/services/export/exportService.ts";
const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
const helpers = new Set(["threeDigitsToArabicWords", "arabicScaleWord", "numberToArabicWords", "amountToArabicCurrencyPhrase", "fmtSAR"]);
const helperCode = source.statements.filter(node =>
  ts.isFunctionDeclaration(node) && helpers.has(node.name?.text) ||
  ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => /^AR_/.test(declaration.name.getText(source)))
).map(node => node.getText(source).replace(/^export /, "")).join("\n");
const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "generatePurchaseRequestPDF");
if (!fn) throw Error("PDF renderer missing");
let html = "";
const code = ts.transpileModule(`${helperCode}\n(${fn.getText(source).replace(/^export /, "")})`, {compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const render = vm.runInNewContext(code, {
  db: new Proxy({}, {get: () => () => {throw Error("Database forbidden in preview");}}),
  readAccountingSignature: () => null,
  getSignatureDataUrl: async () => "",
  escapeHtml: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
  htmlToPdf: async value => {html = value; return Buffer.from("%PDF-preview");},
});
const signature = "data:image/svg+xml;charset=utf-8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="32"><text x="80" y="23" text-anchor="middle" font-size="18" font-family="serif">توقيع تجريبي</text></svg>');
const stress = process.argv.includes("--stress");
const rows = Array.from({length:stress?20:3},(_,index)=>index+1).map((id,index) => ({
  id,purchaseOrderId:100+id,poNumber:`PR-DEMO-${id}`,delegateId:11,
  itemName:`صنف تجريبي ${id}`,
  quantity:id,unit:"قطعة",estimatedUnitCost:"100.00",estimatedTotalCost:(id*100).toFixed(2),
  sectionName:"قسم تجريبي",supplierName:"مورد تجريبي",status:"estimated",
}));
const snapshot = {
  number:"DPB-DEMO-000001",submittedAt:"2026-11-01T09:00:00Z",approvedTotal:rows.reduce((sum,row)=>sum+Number(row.estimatedTotalCost),0).toFixed(2),
  delegate:{id:11,name:"مندوب تجريبي",signature},rows,
  signatures:rows.map(row => ({purchaseOrderId:row.purchaseOrderId,poNumber:row.poNumber,
    requesterId:1,requesterName:"مقدّم طلب تجريبي",requesterSignature:signature,
    reviewerId:2,reviewerName:"مراجع طلب تجريبي",reviewerSignature:signature})),
  financialApprovals:[{reference:"DPB-DEMO-000001",poNumbers:rows.map(row=>row.poNumber),
    accountingName:"محاسب تجريبي",accountingAt:"2026-11-01 12:00:00",accountingSignature:signature,
    managementName:"إدارة عليا (تجريبي)",managementAt:"2026-11-01 12:05:00",managementSignature:signature,
    custodyLabel:"إجمالي رصيد العهد التي على المندوب",custodyValue:"265.00",notes:""}],
};
await render(0,11,undefined,undefined,snapshot);
fs.mkdirSync("tools/pricing-bundle-approved-document/artifacts",{recursive:true});
if(!stress)fs.writeFileSync("tools/pricing-bundle-approved-document/artifacts/reference-preview.html",html.replace(/[ \t]+$/gm,""));
fs.mkdirSync("output/pdf",{recursive:true});
fs.mkdirSync("tmp/pdfs",{recursive:true});
const output = stress ? "tmp/pdfs/DPB-approved-20-items.pdf" : "output/pdf/DPB-approved-form-sample.pdf";
const browser = await puppeteer.launch({headless:true,executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",args:["--disable-gpu","--no-sandbox"]});
try {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request",request=>request.url().startsWith("data:")?request.continue():request.abort());
  await page.setContent(html,{waitUntil:"networkidle0"});
  await page.pdf({path:output,format:"A4",printBackground:true,preferCSSPageSize:true});
  console.log(`Created ${output} — demonstration data, no DB/network`);
} finally { await browser.close(); }
