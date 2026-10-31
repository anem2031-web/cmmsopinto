import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatTicketMaterialsUsed } from "../../client/src/lib/ticketMaterialsUsed";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";

const state = vi.hoisted(() => ({ language: "ar", translations: undefined as any }));
vi.mock("../../client/src/contexts/LanguageContext", () => ({ useLanguage: () => ({ language: state.language }) }));
vi.mock("../../client/src/lib/trpc", () => ({ trpc: { translation: { getEntityTranslations: { useQuery: () => ({ data: state.translations, isLoading: false }) } } } }));
import { useResolvedTranslation } from "../../client/src/hooks/useTranslatedField";

beforeEach(() => { state.language = "ar"; state.translations = undefined; });
const materials = JSON.stringify([{ name: "فرشاة تنظيف المكيفات", unit: "قطعة", used: 2, requested: 3 }]);

describe("Existing materials snapshots are displayed as names and actual usage", () => {
  it("uses the recorded used quantity, not the requested quantity", () => {
    expect(formatTicketMaterialsUsed(materials)).toBe("فرشاة تنظيف المكيفات — 2 قطعة");
  });
  it("puts each material on its own line and retains zero and fractional quantities", () => {
    const input = JSON.stringify([{ name: "سلك", unit: "متر", used: 1.5 }, { name: "لمبة", unit: "حبة", used: 0 }]);
    expect(formatTicketMaterialsUsed(input)).toBe("سلك — 1.5 متر\nلمبة — 0 حبة");
  });
  it("does not guess usage from requested quantity when usage was not recorded", () => {
    expect(formatTicketMaterialsUsed(JSON.stringify([{ name: "لمبة", unit: "حبة", used: null, requested: 5 }]), undefined, "غير محدد"))
      .toBe("لمبة — غير محدد");
  });
  it("ignores prose translations of structured data so quantities remain authoritative", () => {
    expect(formatTicketMaterialsUsed(materials, "Used 300 brushes")).toBe("فرشاة تنظيف المكيفات — 2 قطعة");
  });
  it("shows physical replacement usage and returns without inventing original usage", () => {
    const value=JSON.stringify([{name:"سكين",requested:4,unit:"قطعة",used:null,actualDeliveries:[{itemName:"فرشاة",quantity:6,unit:"قطعة",used:5,returned:1}]}]);
    expect(formatTicketMaterialsUsed(value,"stale", "غير محدد")).toBe("الاحتياج الأصلي: سكين (4 قطعة)\nفرشاة — المستخدم: 5 قطعة · المرتجع: 1 قطعة");
    expect(formatTicketMaterialsUsed(value,undefined,"Unspecified","en")).toContain("Used: 5 قطعة · Returned: 1 قطعة");
  });
  it.each([null, undefined, "", "   ", "[]"])("does not display an empty material section for %s", value => {
    expect(formatTicketMaterialsUsed(value, "stale translated text")).toBe("");
  });
  it("preserves legacy free text and its line breaks", () => {
    const text = "استخدم الفني لمبة واحدة\nوسلكًا بطول متر";
    expect(formatTicketMaterialsUsed(text)).toBe(text);
    expect(formatTicketMaterialsUsed(text, "One lamp and one metre of cable")).toBe("One lamp and one metre of cable");
  });
  it.each(["[ملاحظات قديمة", '{"note":"manual material notes"}', '["free-text material"]'])("keeps unrecognized legacy content without crashing: %s", value => {
    expect(formatTicketMaterialsUsed(value)).toBe(value);
  });
});

// Render the actual TicketDetail field initializer and JSX block with the real
// translation resolver. No app router, database, network or browser is involved.
const source = readFileSync("client/src/pages/tickets/TicketDetail.tsx", "utf8");
const ast = ts.createSourceFile("TicketDetail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration = "";
let expression = "";
function findBlock(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === "materialsUsedText") declaration = node.getText(ast);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && node.left.getText(ast) === "materialsUsedText") expression = node.getText(ast);
  ts.forEachChild(node, findBlock);
}
findBlock(ast);
const compiled = ts.transpileModule(`const ${declaration}; (${expression});`, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 } }).outputText;
function renderField(original: string | null, language = "ar", translations?: any) {
  state.language = language; state.translations = translations;
  const ticket = { materialsUsed: original, originalLanguage: "ar" };
  function Field() {
    const { getField } = useResolvedTranslation("TICKET", 1, ticket, ticket.originalLanguage);
    if (!declaration || !expression) throw new Error("Actual materials field block not found");
    return vm.runInNewContext(compiled, { React, ticket, getField, formatTicketMaterialsUsed, language, t: language === "en" ? en : language === "ur" ? ur : ar });
  }
  return renderToStaticMarkup(<Field />);
}

describe("Actual ticket field and translation hook integration", () => {
  it.each(["ar", "en", "ur"])("displays the material and used quantity instead of materialsUsed in %s", language => {
    const html = renderField(materials, language);
    expect(html).toContain("فرشاة تنظيف المكيفات — 2 قطعة");
    expect(html).not.toContain("materialsUsed");
    expect(html).not.toContain('"requested"');
    expect(html).toContain('dir="auto"');
    expect(html).toContain("whitespace-pre-wrap");
  });
  it("retains existing translated prose for named-technician legacy notes", () => {
    const html = renderField("تم استخدام لمبة واحدة", "en", { materialsUsed: { text: "Used one lamp" } });
    expect(html).toContain("Used one lamp");
    expect(html).not.toContain(">materialsUsed<");
  });
  it("falls back to the saved prose when no translation exists", () => {
    expect(renderField("تم استخدام لمبة واحدة", "ur")).toContain("تم استخدام لمبة واحدة");
  });
  it("does not let translated JSON change the used quantity", () => {
    expect(renderField(materials, "en", { materialsUsed: { text: '[{"name":"brush","used":300}]' } })).toContain("2 قطعة");
  });
  it("hides the empty snapshot section", () => {
    expect(renderField("[]")).toBe("");
    expect(renderField(null)).toBe("");
  });
  it("renders material text literally without treating it as HTML", () => {
    const html = renderField(JSON.stringify([{ name: '<img src=x onerror="bad()">', unit: "قطعة", used: 1 }]));
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<img");
  });
});
