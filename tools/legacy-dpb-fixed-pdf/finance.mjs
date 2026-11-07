import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { lowestLegacyCustody } from "../../server/services/delegate-pricing-bundles/fixed-approved-document.ts";

const escape = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
function words(value) {
  const source = ts.createSourceFile("exportService.ts", fs.readFileSync("server/services/export/exportService.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const names = new Set(["threeDigitsToArabicWords", "arabicScaleWord", "numberToArabicWords", "amountToArabicCurrencyPhrase"]);
  const code = source.statements.filter(node => ts.isFunctionDeclaration(node) && names.has(node.name?.text)
    || ts.isVariableStatement(node) && node.declarationList.declarations.some(d => /^AR_/.test(d.name.getText(source))))
    .map(node => node.getText(source).replace(/^export /, "")).join("\n");
  return vm.runInNewContext(ts.transpileModule(`${code}\namountToArabicCurrencyPhrase(${Number(value)});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
}
export function financialFooterHtml(snapshot) {
  const approvals = snapshot.financialApprovals || [];
  const minimum = lowestLegacyCustody(approvals);
  const number = Number(minimum);
  if (!Number.isSafeInteger(Math.round(number * 100))) throw Error("Custody exceeds safe PDF currency rendering range");
  const value = number.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const accountants = new Map();
  approvals.forEach((approval, index) => {
    if (approval.accountingSignature && !/^data:image\//.test(approval.accountingSignature)) throw Error("Signature must already be captured as image bytes");
    const key = approval.accountingSignature ? JSON.stringify([approval.accountingName, approval.accountingSignature]) : String(index);
    if (!accountants.has(key)) accountants.set(key, approval);
  });
  const notes = [...new Set(approvals.map(a => a.notes).filter(Boolean))].join(" / ");
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;padding:0;background:white;color:#2d3748;font-family:'Times New Roman',serif;font-size:9pt;line-height:1.25}
    main{padding:2pt 12mm 3pt;width:210mm}.title{font-size:10pt;font-weight:bold;color:#1a365d;border-bottom:1px solid #cbd5e0;padding-bottom:4pt;margin:0 0 5pt}
    table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:5pt}td{border:1px solid #cbd5e0;padding:4pt;vertical-align:middle;text-align:right}
    .label{background:#f7fafc;font-weight:bold;width:25%}.signature{width:30%;text-align:center}.signature img{max-width:100pt;height:20pt;object-fit:contain}
    .line{padding:4pt 2pt}.ceo{font-weight:bold;font-size:10pt}.blank{display:inline-block;min-width:160pt;border-bottom:1px dotted #718096}
    </style></head><body><main><div class="title">الشؤون المالية والإجراءات المحاسبية</div>
      <div class="line">إجمالي رصيد العهد التي على المندوب: <strong>${value}</strong> ريال <strong>${escape(words(minimum))}</strong>.</div>
      <div class="line">ملاحظات مراجع الحسابات: ${notes ? escape(notes) : '<span class="blank"></span>'}</div>
      <table>${[...accountants.values()].map(a => `<tr><td class="label">الحسابات</td><td>${escape(a.accountingName)}</td><td class="signature">${a.accountingSignature ? `<img src="${escape(a.accountingSignature)}">` : ""}</td></tr>`).join("")}
      <tr><td class="label">رئيس الحسابات</td><td></td><td class="signature"></td></tr>
      <tr><td class="label">الرئيس التنفيذي</td><td class="ceo">المهندس/ زكري بن عبدالله الزكري</td><td class="signature"></td></tr></table>
      <table><tr><td class="label">رقم سند الصرف</td><td></td><td class="label">التاريخ</td><td></td></tr>
      <tr><td class="label">المبلغ</td><td></td><td class="label">التوقيع</td><td></td></tr></table>
    </main></body></html>`;
}
