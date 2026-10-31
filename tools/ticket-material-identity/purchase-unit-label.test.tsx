import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import fs from "node:fs";
import { transformSync } from "esbuild";
import { expect, it } from "vitest";
import { getLocalizedCatalogUnitName } from "../../client/src/i18n/catalogMasterData";

// Compile the actual unit field with inert UI boundaries. Importing the full PO
// page would pull unrelated authenticated upload/API effects into this isolated check.
const source = fs.readFileSync("client/src/pages/purchase/CreatePurchaseOrder.tsx", "utf8");
const start = source.indexOf("<Select", source.indexOf("{/* الوحدة */}"));
const end = source.indexOf("</Select>", start) + "</Select>".length;
if (start < 0 || end < start) throw Error("Purchase unit field was not found");
const code = transformSync(`export function Field({ item, catalogUnits, language, t, itemErrors, isMaterialBoundItem, materialResolvedCatalogUnit, isReturnReplacement, idx, updateItem }: any) { return (${source.slice(start, end)}); }`,
  { loader: "tsx", format: "cjs", jsx: "transform" }).code;
const scope = { exports: {} as any };
const Select = ({ value, disabled, children }: any) => <div data-unit={value} data-disabled={String(Boolean(disabled))}>{children}</div>;
const Wrapper = ({ children }: any) => <div>{children}</div>;
const Value = ({ children, placeholder }: any) => <output>{children ?? placeholder}</output>;
new Function("module", "exports", "React", "Select", "SelectTrigger", "SelectValue", "SelectContent", "SelectItem", "cn", "getLocalizedCatalogUnitName", code)(
  scope, scope.exports, React, Select, Wrapper, Value, Wrapper, Wrapper, (...classes: unknown[]) => classes.filter(Boolean).join(" "), getLocalizedCatalogUnitName);
const Field = scope.exports.Field;

it.each([["ar", "قطعة"], ["en", "Piece"], ["ur", "Piece"]])("renders a stored English unit in disabled catalog field for %s without rewriting the snapshot", (language, label) => {
  const item = { sourceType: "catalog", catalogItemId: 1, unit: "Piece", _existingId: 10 };
  let changed = 0;
  const html = renderToStaticMarkup(<Field item={item} catalogUnits={[{ id: 1, nameAr: "قطعة", nameEn: "Piece" }]} language={language}
    t={{ purchaseOrders: { unit: "الوحدة" }, workflow: { purchase: { historicalDisabled: "تاريخية" } } }} itemErrors={{}} idx={0}
    isMaterialBoundItem={false} isReturnReplacement={false} updateItem={() => changed++} />);
  expect(html).toContain('data-unit="Piece"');
  expect(html).toContain('data-disabled="true"');
  expect(html).toContain(`<output>${label}</output>`);
  expect(item.unit).toBe("Piece"); expect(changed).toBe(0);
});
