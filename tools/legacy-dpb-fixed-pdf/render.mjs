// Reuse the production PDF template without importing application/DB/scheduler modules.
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export async function documentHtml(snapshot) {
  const source = ts.createSourceFile("exportService.ts", fs.readFileSync("server/services/export/exportService.ts", "utf8"), ts.ScriptTarget.Latest, true);
  const helpers = new Set(["threeDigitsToArabicWords", "arabicScaleWord", "numberToArabicWords", "amountToArabicCurrencyPhrase", "fmtSAR"]);
  const helperCode = source.statements.filter(node =>
    ts.isFunctionDeclaration(node) && helpers.has(node.name?.text) ||
    ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => /^AR_/.test(declaration.name.getText(source)))
  ).map(node => node.getText(source).replace(/^export /, "")).join("\n");
  const fn = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "generatePurchaseRequestPDF");
  if (!fn) throw Error("Production PDF template missing");
  let html = "";
  const code = ts.transpileModule(`${helperCode}\n(${fn.getText(source).replace(/^export /, "")})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const render = vm.runInNewContext(code, {
    db: new Proxy({}, { get: () => () => { throw Error("Database access forbidden in the document renderer"); } }),
    readAccountingSignature: () => null, getSignatureDataUrl: async () => "",
    escapeHtml: value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"),
    htmlToPdf: async value => { html = value; return Buffer.from("%PDF-preview"); },
  });
  await render(0, snapshot.delegate.id, undefined, undefined, snapshot);
  return html;
}
