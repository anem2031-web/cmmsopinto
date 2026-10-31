import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ar from "../../client/src/i18n/ar";
import en from "../../client/src/i18n/en";
import ur from "../../client/src/i18n/ur";

const fixture = vi.hoisted(() => ({
  hooks: [] as any[],
  index: 0,
  inputs: new Map<string, any>(),
  buttons: new Map<string, any>(),
  select: undefined as any,
  stock: { 101: 5, 102: 1 } as Record<number, number>,
  catalog: [
    { id: 101, name: "قاطع", code: "CAT-101", unit: "قطعة" },
    { id: 102, name: "فلتر", code: "CAT-102", unit: "قطعة" },
  ],
  currentNeeds: [] as any[],
  queries: [] as any[],
  submits: [] as any[],
  language: "ar",
  success: true,
  previewLoading: false,
  previewError: null as any,
  busy: false,
  unitsError: null as any,
  unitsLoading: false,
}));
function captureSelect(type: any, props: any) {
  if (type === "select" && props?.["aria-label"]) fixture.inputs.set(props["aria-label"], props);
}
vi.mock("react/jsx-runtime", async original => {
  const actual = await original<any>();
  return { ...actual, jsx: (...args: any[]) => { captureSelect(args[0], args[1]); return actual.jsx(...args); },
    jsxs: (...args: any[]) => { captureSelect(args[0], args[1]); return actual.jsxs(...args); } };
});
vi.mock("react/jsx-dev-runtime", async original => {
  const actual = await original<any>();
  return { ...actual, jsxDEV: (...args: any[]) => { captureSelect(args[0], args[1]); return actual.jsxDEV(...args); } };
});
// Only the tested component's hook state is retained between isolated SSR renders.
// UI primitives/API are replaced so no DOM, authentication, network or DB is used.
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (initial: any) => {
      const index = fixture.index++;
      if (!(index in fixture.hooks))
        fixture.hooks[index] =
          typeof initial === "function" ? initial() : initial;
      return [
        fixture.hooks[index],
        (value: any) => {
          fixture.hooks[index] =
            typeof value === "function" ? value(fixture.hooks[index]) : value;
        },
      ];
    },
  };
});
function textOf(node: any): string {
  if (node == null || typeof node === "boolean") return "";
  if (Array.isArray(node)) return node.map(textOf).join("");
  return typeof node === "object" ? textOf(node.props?.children) : String(node);
}
vi.mock("../../client/src/components/ui/button", () => ({
  Button: (props: any) => {
    fixture.buttons.set(textOf(props.children), props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));
vi.mock("../../client/src/components/ui/input", () => ({
  Input: (props: any) => {
    fixture.inputs.set(props["aria-label"] ?? props.id, props);
    return <input {...props} />;
  },
}));
// Material selection now crosses the PMV2-style combobox boundary instead of Select.
vi.mock("../../client/src/pages/maintenance-teams/TicketMaterialCatalogPicker", () => ({
  TicketMaterialCatalogPicker: (props: any) => {
    fixture.select = (value: string) => { const item = props.items.find((x: any) => x.id === Number(value)); if (item) props.onSelect(item); };
    return <div>{props.items.map((item: any) => <span key={item.id}>{item.name}{props.blockedIds.includes(item.id) ? ar.workflow.pmv2.alreadyRequested : ""}</span>)}</div>;
  },
}));
vi.mock("../../client/src/components/ui/alert-dialog", () => ({
  AlertDialog: (props: any) =>
    props.open ? <div role="alertdialog">{props.children}</div> : null,
  AlertDialogContent: (props: any) => <div>{props.children}</div>,
  AlertDialogHeader: (props: any) => <div>{props.children}</div>,
  AlertDialogTitle: (props: any) => <h2>{props.children}</h2>,
  AlertDialogDescription: (props: any) => <p>{props.children}</p>,
  AlertDialogFooter: (props: any) => <div>{props.children}</div>,
  AlertDialogCancel: (props: any) => (
    <button disabled={props.disabled}>{props.children}</button>
  ),
  AlertDialogAction: (props: any) => {
    fixture.buttons.set(textOf(props.children), props);
    return <button disabled={props.disabled}>{props.children}</button>;
  },
}));
vi.mock("../../client/src/lib/trpc", () => ({
  trpc: {
    ticketTeamExecution: {
      units: { useQuery: (input: any, options: any) => {
        fixture.queries.push({ endpoint: "units", input, options });
        return { data: [{ id: 1, nameAr: "قطعة", nameEn: "Piece" }, { id: 2, nameAr: "كرتون", nameEn: "Carton" }],
          error: fixture.unitsError, isFetching: fixture.unitsLoading, refetch: vi.fn() };
      } },
      catalog: {
        useQuery: (input: any, options: any) => {
          fixture.queries.push({ endpoint: "catalog", input, options });
          return { data: fixture.catalog, isLoading: false, error: null };
        },
      },
      preview: {
        useQuery: (input: any, options: any) => {
          fixture.queries.push({ endpoint: "preview", input, options });
          const need = input.needs[0],
            available = fixture.stock[need.catalogItemId] ?? 0;
          return {
            data: options.enabled
              ? {
                  rows: [
                    {
                      ...need,
                      available,
                      shortage: Math.max(0, need.quantity - available),
                    },
                  ],
                }
              : undefined,
            isFetching: fixture.previewLoading,
            error: fixture.previewError,
          };
        },
      },
    },
  },
}));
import {
  TicketMaterialNeedPanel,
  TicketMaterialReceiptButton,
} from "../../client/src/pages/maintenance-teams/TicketMaterialNeedPanel";

const t = () =>
  (fixture.language === "ar" ? ar : fixture.language === "ur" ? ur : en)
    .workflow.pmv2;
function render() {
  fixture.index = 0;
  fixture.buttons.clear();
  fixture.inputs.clear();
  return renderToStaticMarkup(
    <TicketMaterialNeedPanel
      assignmentId={12}
      currentNeeds={fixture.currentNeeds}
      warehouseName="مخزن الفريق"
      language={fixture.language}
      busy={fixture.busy}
      onSubmit={async (need, confirmReceipt) => {
        fixture.submits.push({ need, confirmReceipt });
        if (fixture.success)
          fixture.currentNeeds.push({
            ...need,
            id: 90,
            originalName: need.name,
            requested: need.quantity,
          });
        return fixture.success;
      }}
    />
  );
}
function type(label: string, value: string) {
  fixture.inputs.get(label).onChange({ target: { value } });
  render();
}
function choose(id: number) {
  fixture.select(String(id));
  render();
}
async function click(label: string) {
  const button = fixture.buttons.get(label);
  expect(button, label).toBeDefined();
  expect(button.disabled, label).toBeFalsy();
  button.onClick();
  await Promise.resolve();
  await Promise.resolve();
  render();
}
beforeEach(() => {
  Object.assign(fixture, {
    hooks: [],
    index: 0,
    currentNeeds: [],
    queries: [],
    submits: [],
    language: "ar",
    success: true,
    previewLoading: false,
    previewError: null,
    busy: false,
    unitsError: null,
    unitsLoading: false,
    stock: { 101: 5, 102: 1 },
  });
});
describe("ticket needs-material interactions at mocked boundaries", () => {
  it("unlisted input asks only name and quantity and never loads or sends a unit", async () => {
    render();
    await click(`${t().materialNotFoundPrompt} ${t().registerUnlistedMaterial}`);
    expect(render()).not.toContain('<select');
    expect(fixture.queries.filter(q => q.endpoint === "units")).toEqual([]);
    expect(fixture.inputs.has(t().unitPlaceholder)).toBe(false);
    type("unlisted-12", "مسمار"); type(t().requiredQuantityPlaceholder, "3");
    fixture.language = "en"; render();
    await click(t().registerUnlistedAction);
    expect(fixture.submits[0].need).toEqual({name:"مسمار",quantity:3});
  });
  it("catalog choice displays its unit read-only and updates it when the chosen item changes", () => {
    render(); choose(101);
    expect(fixture.inputs.get(t().unitPlaceholder)).toMatchObject({value:"قطعة",readOnly:true});
    expect(fixture.inputs.get(t().unitPlaceholder).onChange).toBeUndefined();
    fixture.catalog[1].unit = "كرتون";
    choose(102);
    expect(fixture.inputs.get(t().unitPlaceholder)).toMatchObject({value:"كرتون",readOnly:true});
    fixture.catalog[1].unit = "قطعة";
  });
  it("starts with PMV2 labels, empty quantity and catalog search; no manual list/check/submit steps", () => {
    const html = render();
    expect(html).toContain(t().identifyMaterial);
    expect(fixture.inputs.get(t().requiredQuantityPlaceholder).value).toBe("");
    expect(fixture.buttons.get(t().recordNeed).disabled).toBe(true);
    expect(html).not.toContain("فحص التوفر");
    expect(html).not.toContain("إرسال طلب المواد وتأكيد المحدد");
    expect(
      fixture.queries
        .filter(q => q.endpoint === "preview")
        .every(q => !q.options.enabled)
    ).toBe(true);
  });
  it("shows full availability and opens explicit confirmation before any actual receipt", async () => {
    render();
    choose(101);
    type(t().requiredQuantityPlaceholder, "2");
    expect(fixture.buttons.has(t().receiveFromTeamStore)).toBe(true);
    await click(t().receiveFromTeamStore);
    expect(render()).toContain('role="alertdialog"');
    expect(fixture.submits).toEqual([]);
    await click(t().confirmReceipt);
    expect(fixture.submits).toEqual([
      {
        need: { catalogItemId: 101, name: "قاطع", quantity: 2, unit: "قطعة" },
        confirmReceipt: true,
      },
    ]);
    expect(fixture.buttons.has(t().addAnotherMaterial)).toBe(true);
  });
  it("partial availability registers the full need without falsely receiving the available part", async () => {
    render();
    choose(102);
    type(t().requiredQuantityPlaceholder, "3");
    expect(render()).toContain(t().shortageLabel);
    await click(t().recordNeedRequestShortage);
    expect(fixture.submits[0]).toMatchObject({
      need: { catalogItemId: 102, quantity: 3 },
      confirmReceipt: false,
    });
  });
  it("allows another independent material while earlier needs are waiting", async () => {
    fixture.currentNeeds = [{ catalogItemId: 102, originalName: "فلتر" }];
    render();
    await click(t().addAnotherMaterial);
    choose(101);
    type(t().requiredQuantityPlaceholder, "1");
    await click(t().receiveFromTeamStore);
    await click(t().confirmReceipt);
    expect(fixture.submits).toHaveLength(1);
    expect(fixture.submits[0].need.catalogItemId).toBe(101);
    expect(fixture.currentNeeds).toHaveLength(2);
  });
  it("blocks duplicate items in both picker and submission", async () => {
    fixture.currentNeeds = [{ catalogItemId: 101, originalName: "قاطع" }];
    render();
    await click(t().addAnotherMaterial);
    choose(101);
    type(t().requiredQuantityPlaceholder, "1");
    expect(render()).toContain(t().alreadyRequested);
    expect(fixture.buttons.get(t().recordNeed).disabled).toBe(true);
    expect(fixture.submits).toEqual([]);
  });
  it("unlisted material preserves description without choosing a unit, catalog ID or receipt confirmation", async () => {
    render();
    await click(
      `${t().materialNotFoundPrompt} ${t().registerUnlistedMaterial}`
    );
    type("unlisted-12", "وصف الفني");
    type(t().requiredQuantityPlaceholder, "3");
    await click(t().registerUnlistedAction);
    expect(fixture.submits).toEqual([
      {
        need: { name: "وصف الفني", quantity: 3 },
        confirmReceipt: false,
      },
    ]);
    expect(
      fixture.queries
        .filter(q => q.endpoint === "preview")
        .every(q => !q.options.enabled)
    ).toBe(true);
  });
  it("stale preview while fetching and stock errors disable receipt", () => {
    render();
    choose(101);
    type(t().requiredQuantityPlaceholder, "2");
    fixture.previewLoading = true;
    render();
    expect(fixture.buttons.get(t().recordNeed).disabled).toBe(true);
    fixture.previewLoading = false;
    fixture.previewError = { message: "الرصيد يحتاج مراجعة" };
    expect(render()).toContain("الرصيد يحتاج مراجعة");
    expect(fixture.buttons.get(t().recordNeed).disabled).toBe(true);
  });
  it("failed submission retains material fields so the same command can be retried", async () => {
    fixture.success = false;
    render();
    choose(102);
    type(t().requiredQuantityPlaceholder, "3");
    await click(t().recordNeedRequestShortage);
    expect(fixture.inputs.get(t().requiredQuantityPlaceholder).value).toBe("3");
    expect(fixture.inputs.get(t().unitPlaceholder).value).toBe("قطعة");
    expect(fixture.currentNeeds).toEqual([]);
  });
  it.each(["0", "-1", "1.5"])(
    "%s retains the existing whole-quantity contract before sending",
    quantity => {
      render();
      choose(101);
      type(t().requiredQuantityPlaceholder, quantity);
      expect(fixture.buttons.get(t().recordNeed).disabled).toBe(true);
      expect(fixture.submits).toEqual([]);
    }
  );
  it.each(["ar", "en", "ur"])(
    "%s uses the existing PMV2 translations without changing a reference",
    language => {
      fixture.language = language;
      expect(render()).toContain(t().identifyMaterial);
      expect(
        fixture.queries.every(
          q => q.input.assignmentId === 12 && !("taskId" in q.input)
        )
      ).toBe(true);
    }
  );
  it("receipt after warehouse supply still requires confirmation and respects the disabled/pending guard", () => {
    let calls = 0;
    const receipt = () => {
      fixture.index = 0;
      fixture.buttons.clear();
      return renderToStaticMarkup(
        <TicketMaterialReceiptButton
          name="فلتر"
          quantity={3}
          unit="قطعة"
          warehouseName="مخزن الفريق"
          language="ar"
          busy={false}
          disabled={false}
          onConfirm={async () => {
            calls++;
            return true;
          }}
        />
      );
    };
    receipt();
    fixture.buttons.get(t().receiveFromTeamStore).onClick();
    expect(receipt()).toContain('role="alertdialog"');
    expect(calls).toBe(0);
    fixture.buttons.get(t().confirmReceipt).onClick();
    expect(calls).toBe(1);
  });
});
